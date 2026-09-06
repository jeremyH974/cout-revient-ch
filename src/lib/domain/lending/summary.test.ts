/**
 * Synthèse d'un compte de prêts. Le test central est l'invariant `apports nets + résultat = valeur`
 * (décision n° 51) ; les autres protègent la distinction entre l'argent APPORTÉ et le capital
 * PRÊTÉ, et le fait que l'impôt ne soit jamais compté deux fois.
 */
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCsvText } from '../../import/csv';
import { parseBienPreter } from '../../import/bienpreter/parse';
import { computeLending } from './compute';
import { lendingSummary } from './summary';
import type { LoanEvent, WalletMovement } from './types';

const parsed = parseBienPreter(
  parseCsvText(readFileSync('tests/fixtures/bienpreter/export-demo.csv', 'utf8')),
  'acc:bp',
);
const report = computeLending({ loans: parsed.loans, events: parsed.events, asOf: '2025-12-31' });
const summary = lendingSummary(report, parsed.wallet);

describe('lendingSummary', () => {
  it('respecte `apports nets + résultat = valeur`', () => {
    expect(Number(summary.netContributions) + Number(summary.result)).toBeCloseTo(
      Number(summary.value),
      9,
    );
  });

  it('ne confond jamais l’argent apporté et le capital prêté', () => {
    expect(summary.netContributions).toBe('1000'); // un seul dépôt
    expect(summary.principalLent).toBe('800'); // deux prêts
    expect(summary.recycling).toBe('0.8');
  });

  it('compte le bonus dans le résultat, jamais dans les apports', () => {
    expect(summary.bonus).toBe('5');
    expect(summary.netContributions).toBe('1000');
    // 12,11 d'intérêts bruts − 2,93 de prélèvements + 5 de bonus.
    expect(summary.interestNet).toBe('9.18');
    expect(summary.result).toBe('14.18');
  });

  it('ne retranche l’impôt qu’une fois, et expose les deux totaux', () => {
    expect(summary.withheld).toBe('2.93'); // ventilé par prêt : fait foi
    expect(summary.taxDebitedFromWallet).toBe('1.63'); // ligne autonome : informatif
    // 1000 + 5 + 420 + 12,11 − 2,93 − 800
    expect(summary.cash).toBe('634.18');
    expect(summary.value).toBe('1014.18');
  });

  it('donne un rendement cumulé rapporté aux apports, pas au capital prêté', () => {
    expect(Number(summary.returnOnContributions)).toBeCloseTo(14.18 / 1000, 12);
    // Rapporté au capital prêté, on lirait 1,77 % au lieu de 1,42 % : c'est le piège.
    expect(Number(summary.returnOnContributions)).not.toBeCloseTo(14.18 / 800, 6);
  });

  it('n’annonce aucun rendement quand rien n’a été apporté', () => {
    const empty = computeLending({ loans: [], events: [], asOf: '2026-01-01' });
    expect(lendingSummary(empty, []).returnOnContributions).toBeNull();
    expect(lendingSummary(empty, []).recycling).toBeNull();
  });
});

describe('l’invariant tient sur des comptes tirés au hasard', () => {
  it('apports nets + résultat = valeur, quels que soient les flux', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000 }),
        fc.array(fc.integer({ min: 1, max: 5_000 }), { minLength: 0, maxLength: 6 }),
        fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 0, maxLength: 6 }),
        fc.integer({ min: 0, max: 200 }),
        (deposit, lends, repayments, bonus) => {
          const wallet: WalletMovement[] = [
            {
              id: 'w1',
              at: '2026-01-01T00:00:00',
              kind: 'deposit',
              amount: String(deposit),
              label: 'd',
            },
          ];
          if (bonus > 0)
            wallet.push({
              id: 'w2',
              at: '2026-02-01T00:00:00',
              kind: 'bonus',
              amount: String(bonus),
              label: 'b',
            });
          const loans = lends.map((amount, i) => ({
            id: `l${i}`,
            accountId: 'acc:bp',
            platform: 'bienpreter',
            borrower: `B${i}`,
            label: `P${i}`,
            principal: String(amount),
            rate: '0.1',
            dayCount: 'unknown' as const,
            amortisation: 'unknown' as const,
            subscribedAt: '2026-01-02T00:00:00',
            maturity: null,
            currency: 'eur',
            sector: null,
          }));
          const events: LoanEvent[] = loans.map((l, i) => ({
            id: `s${i}`,
            loanId: l.id,
            at: '2026-01-02T00:00:00',
            kind: 'subscription' as const,
            amount: l.principal,
          }));
          repayments.forEach((r, i) => {
            const target = loans[i % Math.max(1, loans.length)];
            if (!target) return;
            const principal = Math.min(r, Number(target.principal));
            events.push({
              id: `r${i}`,
              loanId: target.id,
              at: '2026-03-01T00:00:00',
              kind: 'repayment',
              principal: String(principal),
              interest: String(r % 7),
              withheld: String((r % 7) / 10),
            });
          });
          const input = { loans, events, asOf: '2026-06-01' };
          const s = lendingSummary(computeLending(input), wallet);
          expect(Number(s.netContributions) + Number(s.result)).toBeCloseTo(Number(s.value), 6);
        },
      ),
      { numRuns: 150 },
    );
  });
});
