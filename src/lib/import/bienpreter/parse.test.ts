/**
 * Convertisseur BienPrêter. La fixture `tests/fixtures/bienpreter/export-demo.csv` est
 * INVENTÉE DE TOUTES PIÈCES (décision n° 17) : elle ne dérive d'aucun export réel. Elle reproduit
 * en revanche fidèlement la STRUCTURE observée, y compris les trois pièges du format — la colonne
 * `Montant` qui change de sens, le remboursement anticipé éclaté en plusieurs lignes au même
 * (contrat, date), et l'impôt inscrit des deux côtés.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeLending } from '../../domain/lending/compute';
import { parseCsvText } from '../csv';
import { detectBienPreter, parseBienPreter } from './parse';

const table = parseCsvText(readFileSync('tests/fixtures/bienpreter/export-demo.csv', 'utf8'));
const parsed = parseBienPreter(table, 'acc:bp');

describe('detectBienPreter', () => {
  it('reconnaît l’export à ses quatre colonnes ventilées', () => {
    expect(detectBienPreter(table.header)).toBe(true);
  });

  it('ne réclame pas un export qui n’est pas le sien', () => {
    expect(detectBienPreter(['Date', 'Type', 'Montant', 'Devise'])).toBe(false);
  });
});

describe('parseBienPreter', () => {
  it('lit le point-virgule, les accents et les décimales à la virgule', () => {
    expect(table.delimiter).toBe(';');
    expect(parsed.problems).toEqual([]);
    expect(parsed.loans).toHaveLength(2);
    expect(parsed.loans.map((l) => l.id).sort()).toEqual(['bp:C-001', 'bp:C-002']);
  });

  it('prend l’emprunteur et le projet dans leurs colonnes, et laisse en `unknown` ce que l’export ne dit pas', () => {
    const first = parsed.loans.find((l) => l.id === 'bp:C-001')!;
    expect(first.borrower).toBe('ALPHA SARL');
    expect(first.label).toBe('Rénovation atelier');
    expect(first.principal).toBe('500');
    expect(first.subscribedAt).toBe('2025-02-05T00:00:00');
    // Ni taux, ni échéance, ni convention : l'export ne les porte pas, on n'invente rien.
    expect(first.dayCount).toBe('unknown');
    expect(first.amortisation).toBe('unknown');
    expect(first.maturity).toBeNull();
  });

  it('sépare les mouvements de portefeuille des événements de prêt', () => {
    expect(parsed.wallet.map((w) => w.kind).sort()).toEqual(['bonus', 'deposit', 'tax']);
    // Les prélèvements autonomes ne sont PAS des événements de prêt : les compter deux fois
    // gonflerait l'impôt retenu.
    expect(parsed.events.every((e) => e.loanId.startsWith('bp:'))).toBe(true);
    expect(parsed.wallet.find((w) => w.kind === 'tax')!.amount).toBe('-1.63');
  });

  it('signale un libellé d’opération inconnu au lieu de l’avaler', () => {
    expect(parsed.unknown).toEqual([
      { label: 'Vente aux enchères de licornes', count: 1, lines: [13] },
    ]);
  });

  it('signale la ligne dont le montant net contredit la ventilation', () => {
    expect(parsed.inconsistent).toHaveLength(1);
    expect(parsed.inconsistent[0]).toMatchObject({
      contract: 'C-001',
      expected: '42.35',
      found: '99',
    });
  });
});

describe('les trois pièges du format', () => {
  it('PIÈGE A : ignore `Montant`, dont le sens change entre l’ancien flux et le nouveau', () => {
    // Ligne « mensuel » : Montant = 42,35 (net). Ligne « mensuel (new) » : Montant = 43 (brut).
    // Les deux doivent produire EXACTEMENT le même événement.
    const monthly = parsed.events.filter(
      (e) => e.kind === 'repayment' && e.loanId === 'bp:C-001' && e.at.startsWith('2025-03'),
    );
    const monthlyNew = parsed.events.filter(
      (e) => e.kind === 'repayment' && e.loanId === 'bp:C-001' && e.at.startsWith('2025-09'),
    );
    expect(monthly).toHaveLength(1);
    expect(monthlyNew).toHaveLength(1);
    const strip = (e: (typeof monthly)[number]): unknown =>
      e.kind === 'repayment' ? { p: e.principal, i: e.interest, w: e.withheld } : null;
    expect(strip(monthly[0]!)).toEqual({ p: '40', i: '3', w: '0.65' });
    expect(strip(monthlyNew[0]!)).toEqual(strip(monthly[0]!));
  });

  it('PIÈGE B : garde les trois lignes d’un remboursement anticipé au même (contrat, date)', () => {
    const sameDay = parsed.events.filter(
      (e) => e.loanId === 'bp:C-002' && e.at.startsWith('2025-04-10'),
    );
    expect(sameDay).toHaveLength(3);
    expect(new Set(sameDay.map((e) => e.id)).size).toBe(3);
  });

  it('PIÈGE C : avertit que le même impôt figure des deux côtés, sans les additionner', () => {
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0]).toContain('même impôt');
    // 0,65 × 3 + 0,06 + 0,92 ventilés par prêt, contre 1,63 débités du portefeuille.
    expect(parsed.notes[0]).toContain('2.93');
    expect(parsed.notes[0]).toContain('1.63');
  });
});

describe('bout en bout : de l’export au rapport', () => {
  const report = computeLending({ loans: parsed.loans, events: parsed.events, asOf: '2025-12-31' });

  it('solde le prêt intégralement remboursé et garde l’encours de l’autre', () => {
    const c1 = report.loans.find((l) => l.loan.id === 'bp:C-001')!;
    const c2 = report.loans.find((l) => l.loan.id === 'bp:C-002')!;
    expect(c2.status).toBe('repaid');
    expect(c2.outstanding).toBe('0');
    // Les trois lignes du même jour ont bien toutes compté.
    expect(c2.interestReceived).toBe('3.11');
    expect(c2.withheld).toBe('0.98');
    expect(c1.outstanding).toBe('380'); // 500 − 3 × 40
    expect(c1.status).toBe('performing');
  });

  it('respecte l’invariant d’encours sur l’ensemble du portefeuille', () => {
    const { disbursed, principalRepaid, writtenOff, outstanding } = report.totals;
    expect(Number(principalRepaid) + Number(writtenOff) + Number(outstanding)).toBeCloseTo(
      Number(disbursed),
      9,
    );
    expect(disbursed).toBe('800');
  });

  it('n’invente aucun intérêt couru faute de taux et de convention, et le rend visible', () => {
    expect(report.totals.accrualUnavailable).toBe(1);
    expect(report.totals.value).toBe('380');
  });
});
