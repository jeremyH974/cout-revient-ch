import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsvText } from '../csv';
import { confirmedMapping, proposeMapping } from './propose';
import { mergeModelMapping, MODEL_CONFIDENCE_CAP } from './merge';
import { CONFIRM_THRESHOLD } from './score';
import type { ConfirmedMapping } from './schema';
import { contextOf, firstFailure, verifyMapping } from './verify';

const FIXTURE = 'tests/fixtures/mapping/demo-inconnu.csv';
const RATE = (): string => '1.1';
const table = (): ReturnType<typeof parseCsvText> => parseCsvText(readFileSync(FIXTURE, 'utf8'));

function verdictOf(change: (base: ConfirmedMapping) => ConfirmedMapping = (m) => m) {
  const file = table();
  const proposal = proposeMapping(file);
  return verifyMapping(change(confirmedMapping(proposal)), contextOf(file, proposal, RATE));
}

describe('le vérificateur rejoue l’import, il ne juge pas l’appariement', () => {
  it('accepte la proposition déterministe, et dit pourquoi, contrôle par contrôle', () => {
    const verdict = verdictOf();
    expect(verdict.ok).toBe(true);
    expect(verdict.parsedRows).toBe(5);
    expect(verdict.checks.map((c) => [c.id, c.status])).toEqual([
      ['admissible', 'pass'],
      ['dry-run', 'pass'],
      ['shapes', 'pass'],
      ['invariant', 'pass'],
      ['blocked', 'pass'],
      ['unqualified', 'pass'],
      ['balance', 'not-applicable'],
    ]);
  });

  it('rapporte des codes, jamais du français', () => {
    for (const check of verdictOf().checks) {
      expect(check.code, check.id).toMatch(/^[a-z0-9+=<>,.\-/ ]+$/);
    }
  });

  it('refuse un appariement inadmissible, et s’arrête là', () => {
    const verdict = verdictOf((m) => {
      const { date: _dropped, ...withoutDate } = m.columns;
      void _dropped;
      return { ...m, columns: withoutDate };
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.checks).toHaveLength(1);
    expect(firstFailure(verdict)?.code).toBe('missing-date-or-pair');
  });

  it('refuse un appariement dont les dates ne se lisent pas', () => {
    // La colonne de description prise pour une date : l'analyse à blanc perd toutes ses lignes.
    const verdict = verdictOf((m) => ({ ...m, columns: { ...m.columns, date: 9 } }));
    expect(verdict.ok).toBe(false);
    expect(firstFailure(verdict)?.id).toBe('dry-run');
    expect(firstFailure(verdict)?.code).toMatch(/^rows-kept=/);
  });

  it('REFUSE DES JAMBES INVERSÉES — le contrôle le plus discriminant', () => {
    /*
     * Rien, dans la forme, ne distingue ce fichier du bon : mêmes dates, mêmes montants, mêmes
     * devises. Les contrôles 1 à 3 passent tous. Seul le moteur s'en aperçoit, en essayant de
     * céder des actifs qui n'ont jamais été acquis — une survente, c'est-à-dire une position
     * bloquée. C'est la raison d'être de ce vérificateur.
     */
    const verdict = verdictOf((m) => ({
      ...m,
      columns: {
        ...m.columns,
        sentAmount: m.columns.receivedAmount!,
        sentCurrency: m.columns.receivedCurrency!,
        receivedAmount: m.columns.sentAmount!,
        receivedCurrency: m.columns.sentCurrency!,
      },
    }));
    expect(verdict.ok).toBe(false);
    const statuses = Object.fromEntries(verdict.checks.map((c) => [c.id, c.status]));
    expect(statuses['admissible']).toBe('pass');
    expect(statuses['dry-run']).toBe('pass');
    expect(statuses['shapes']).toBe('pass');
    expect(firstFailure(verdict)?.id).toBe('blocked');
    expect(firstFailure(verdict)?.code).toMatch(/^blocked=/);
  });

  it('déclare l’écart de solde INAPPLICABLE quand le fichier n’en porte pas — jamais vert', () => {
    const balance = verdictOf().checks.find((c) => c.id === 'balance');
    expect(balance?.status).toBe('not-applicable');
    expect(balance?.status).not.toBe('pass');
    expect(balance?.code).toBe('no-balance-column');
  });

  it('contrôle l’écart de solde quand le fichier en porte un', () => {
    const good = parseCsvText(
      [
        'Date,Type,Quantité vendue,Devise vendue,Quantité achetée,Devise achetée,Solde',
        '2026-03-02 09:00:00,achat,1000,EUR,0.05,BTC,0.05',
        '2026-03-03 09:00:00,depot,,,0.01,BTC,0.06',
        '2026-03-04 09:00:00,retrait,0.02,BTC,,,0.04',
      ].join('\n'),
    );
    const proposal = proposeMapping(good);
    expect(proposal.balanceColumn).toBe(6);
    const verdict = verifyMapping(confirmedMapping(proposal), contextOf(good, proposal, RATE));
    const balance = verdict.checks.find((c) => c.id === 'balance');
    expect(balance?.status).toBe('pass');

    const wrong = parseCsvText(
      [
        'Date,Type,Quantité vendue,Devise vendue,Quantité achetée,Devise achetée,Solde',
        '2026-03-02 09:00:00,achat,1000,EUR,0.05,BTC,0.05',
        '2026-03-03 09:00:00,depot,,,0.01,BTC,9.99',
        '2026-03-04 09:00:00,retrait,0.02,BTC,,,8.88',
      ].join('\n'),
    );
    const other = proposeMapping(wrong);
    const broken = verifyMapping(confirmedMapping(other), contextOf(wrong, other, RATE));
    expect(broken.ok).toBe(false);
    expect(firstFailure(broken)?.id).toBe('balance');
  });
});

describe('contrôle 5 : le modèle ne peut que combler un trou', () => {
  it('écarte une proposition qui écraserait un appariement déterministe sûr', () => {
    const proposal = proposeMapping(table());
    const merged = mergeModelMapping(proposal, {
      colonnes: [{ i: 9, champ: 'date', confiance: 1 }],
      types: [],
    });
    expect(merged.filled).toBe(0);
    expect(merged.ignored).toBe(1);
    expect(merged.proposal.columns.find((c) => c.field === 'date')?.column).toBe(0);
  });

  it('accepte une proposition qui comble un champ non apparié', () => {
    const file = parseCsvText(
      [
        'Date,Type,Quantité vendue,Devise vendue,Quantité achetée,Devise achetée,Zorglub',
        '2026-03-02 09:00:00,achat,1000,EUR,0.05,BTC,0xabc',
      ].join('\n'),
    );
    const proposal = proposeMapping(file);
    expect(proposal.columns.some((c) => c.field === 'txHash')).toBe(false);
    const merged = mergeModelMapping(proposal, {
      colonnes: [{ i: 6, champ: 'txHash', confiance: 0.99 }],
      types: [],
    });
    expect(merged.filled).toBe(1);
    const added = merged.proposal.columns.find((c) => c.field === 'txHash');
    expect(added?.source).toBe('model');
    expect(added?.rule).toBe('model');
    // La confiance déclarée par le modèle n'est pas une preuve : elle est plafonnée SOUS le seuil
    // de pré-cochage, donc une proposition de modèle est toujours « à confirmer ».
    expect(added?.confidence).toBe(MODEL_CONFIDENCE_CAP);
    expect(added?.confidence).toBeLessThan(CONFIRM_THRESHOLD);
  });

  it('écarte un index hors des bornes de l’en-tête', () => {
    const proposal = proposeMapping(table());
    const merged = mergeModelMapping(proposal, {
      colonnes: [{ i: 99, champ: 'txHash', confiance: 1 }],
      types: [],
    });
    expect(merged.filled).toBe(0);
    expect(merged.ignored).toBe(1);
  });
});
