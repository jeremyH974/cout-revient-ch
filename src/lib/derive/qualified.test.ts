/**
 * Le rattachement d'une qualification à ce qu'elle réinterprète (décision n° 94).
 *
 * Sans lui, l'écran « À qualifier » ne pourrait montrer qu'un identifiant technique — et personne
 * ne saurait ce qu'il annule.
 */
import { describe, expect, it } from 'vitest';
import type { Qualification, RawCoinhouseRow, RawPivotRow } from '../domain/types';
import { qualifiedSummaries } from './qualified';

const reward: Qualification = { kind: 'reward', fairValueEur: null };

const row = (over: Partial<RawCoinhouseRow>): RawCoinhouseRow =>
  ({
    key: 'k',
    importId: 'imp',
    lineNo: 1,
    id: null,
    at: '2026-01-01T10:00:00',
    type: 'Echange',
    ...over,
  }) as RawCoinhouseRow;

const pivot = (over: Partial<RawPivotRow>): RawPivotRow =>
  ({
    key: 'p1',
    importId: 'imp',
    lineNo: 7,
    accountId: 'man:invest',
    date: '2026-01-01 09:00:00',
    at: '2026-01-01T10:00:00',
    sent: null,
    received: null,
    fee: null,
    netWorth: null,
    label: null,
    description: null,
    txHash: null,
    ...over,
  }) as RawPivotRow;

describe('qualifications rattachées à leur origine', () => {
  it('une ligne pivot porte elle-même son instant et son numéro', () => {
    const [summary] = qualifiedSummaries({ p1: reward }, { p1: pivot({ label: 'Staking' }) }, {});
    expect(summary).toEqual({
      eventId: 'p1',
      qualification: reward,
      at: '2026-01-01T10:00:00',
      rawType: 'Staking',
      lineNumbers: [7],
    });
  });

  it('une ligne pivot sans libellé se nomme quand même', () => {
    const [summary] = qualifiedSummaries({ p1: reward }, { p1: pivot({}) }, {});
    expect(summary?.rawType).toBe('ligne pivot');
  });

  /**
   * Le cas qui justifie la fonction : une opération Coinhouse s'étale sur PLUSIEURS lignes du
   * fichier, qu'il faut retrouver par préfixe puis remettre dans l'ordre du fichier. Les rendre
   * dans le désordre ferait pointer l'utilisateur sur la mauvaise ligne de son export.
   */
  it('une opération Coinhouse rassemble toutes ses lignes, dans l’ordre du fichier', () => {
    const [summary] = qualifiedSummaries(
      { 'ch:op1': reward },
      {},
      {
        b: row({ key: 'b', id: 'op1', lineNo: 12, type: 'Retrait' }),
        a: row({ key: 'a', id: 'op1', lineNo: 4, type: 'Depot' }),
        other: row({ key: 'other', id: 'op2', lineNo: 9 }),
      },
    );
    expect(summary?.lineNumbers, 'triées par numéro de ligne').toEqual([4, 12]);
    expect(summary?.rawType, 'le type vient de la PREMIÈRE ligne').toBe('Depot');
  });

  it('une ligne sans identifiant se rattache par sa clé', () => {
    const [summary] = qualifiedSummaries(
      { 'ch:k9': reward },
      {},
      {
        k9: row({ key: 'k9', id: null, lineNo: 3, type: 'Achat' }),
      },
    );
    expect(summary?.lineNumbers).toEqual([3]);
    expect(summary?.rawType).toBe('Achat');
  });

  it('une qualification orpheline ne fait rien disparaître, elle reste sans origine', () => {
    const [summary] = qualifiedSummaries({ 'ch:disparu': reward }, {}, {});
    expect(summary?.at).toBeNull();
    expect(summary?.rawType).toBeNull();
    expect(summary?.lineNumbers).toEqual([]);
  });

  it('les numéros de ligne nuls sont écartés, jamais affichés comme « ligne 0 »', () => {
    const [summary] = qualifiedSummaries(
      { 'ch:k0': reward },
      {},
      {
        k0: row({ key: 'k0', lineNo: 0 }),
      },
    );
    expect(summary?.lineNumbers).toEqual([]);
  });

  it('le pivot l’emporte quand un identifiant existe des deux côtés', () => {
    const [summary] = qualifiedSummaries(
      { p1: reward },
      { p1: pivot({ label: 'Pivot' }) },
      { p1: row({ key: 'p1', id: 'p1', type: 'Coinhouse' }) },
    );
    expect(summary?.rawType).toBe('Pivot');
  });
});
