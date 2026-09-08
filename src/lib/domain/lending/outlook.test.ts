/**
 * Échéancier à venir. Les tests qui comptent sont ceux des **exclusions** : un module qui
 * additionne des lignes d'échéancier est trivial, un module qui sait lesquelles ne comptent pas
 * l'est beaucoup moins. Un prêt remboursé par anticipation laisse derrière lui des échéances qui
 * n'arriveront jamais — les compter gonflerait la prévision d'autant, sans le moindre signe.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeLending } from './compute';
import { lendingOutlook, nextMonth } from './outlook';
import type { Loan, LoanEvent, ScheduledInstalment } from './types';

const loan = (id: string, over: Partial<Loan> = {}): Loan => ({
  id,
  accountId: 'acc:bp',
  platform: 'bienpreter',
  borrower: `EMP-${id}`,
  label: 'Facture',
  principal: '1000',
  rate: '0.12',
  dayCount: 'act/365',
  amortisation: 'in-fine',
  subscribedAt: '2026-01-01T00:00:00',
  maturity: '2027-01-15T00:00:00',
  currency: 'eur',
  sector: null,
  ...over,
});

const due = (month: string, principal: string, interest: string): ScheduledInstalment => ({
  due: `${month}-15T00:00:00`,
  principal,
  interest,
  outstanding: '0',
});

const subscribe = (id: string, at = '2026-01-01T00:00:00'): LoanEvent => ({
  id: `s:${id}`,
  loanId: id,
  at,
  kind: 'subscription',
  amount: '1000',
});

const outlookOf = (loans: Loan[], events: LoanEvent[], asOf = '2026-06-30', months = 4) =>
  lendingOutlook({ report: computeLending({ loans, events, asOf }), months });

describe('nextMonth', () => {
  it('passe l’année sans jamais construire de `Date`', () => {
    expect(nextMonth('2026-11')).toBe('2026-12');
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(nextMonth('2026-09')).toBe('2026-10');
  });

  it('reste un mois valide, douze fois de suite, depuis n’importe quel mois', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2000, max: 2098 }), fc.integer({ min: 1, max: 12 }), (y, m) => {
        let month = `${y}-${String(m).padStart(2, '0')}`;
        for (let i = 0; i < 12; i++) {
          month = nextMonth(month);
          expect(month).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
        }
      }),
    );
  });
});

describe('lendingOutlook', () => {
  it('agrège par mois et rend une fenêtre DENSE, mois vides compris', () => {
    const l = loan('a', { schedule: [due('2026-07', '100', '10'), due('2026-09', '200', '20')] });
    const o = outlookOf([l], [subscribe('a')]);
    expect(o.months.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(o.months.map((m) => m.total)).toEqual(['0', '110', '0', '220']);
    expect(o.peak).toBe('220');
  });

  it('additionne deux prêts qui tombent le même mois', () => {
    const a = loan('a', { schedule: [due('2026-07', '100', '10')] });
    const b = loan('b', { schedule: [due('2026-07', '50', '5')] });
    const o = outlookOf([a, b], [subscribe('a'), subscribe('b')]);
    expect(o.months[1]!.principal).toBe('150');
    expect(o.months[1]!.interest).toBe('15');
  });

  it('écarte les échéances DÉJÀ dues : ce sont des faits, pas des perspectives', () => {
    const l = loan('a', { schedule: [due('2026-05', '100', '10'), due('2026-07', '100', '10')] });
    const o = outlookOf([l], [subscribe('a')]);
    expect(o.expectedPrincipal).toBe('100');
    expect(o.months.map((m) => m.total)).toEqual(['0', '110', '0', '0']);
  });

  it('écarte un prêt remboursé, dont l’échéancier court pourtant encore', () => {
    const l = loan('a', { schedule: [due('2026-07', '1000', '100')] });
    const repaid: LoanEvent = {
      id: 'r:a',
      loanId: 'a',
      at: '2026-03-01T00:00:00',
      kind: 'repayment',
      principal: '1000',
      interest: '30',
      withheld: '0',
    };
    const o = outlookOf([l], [subscribe('a'), repaid]);
    expect(o.expectedPrincipal).toBe('0');
    expect(o.scheduled).toBe(0);
    expect(o.unscheduled).toBe(0); // il n'est pas « sans échéancier » : il n'est plus vivant
  });

  it('compte les prêts vivants SANS échéancier au lieu de les traiter comme vides', () => {
    const withPlan = loan('a', { schedule: [due('2026-07', '100', '10')] });
    const without = loan('b');
    const o = outlookOf([withPlan, without], [subscribe('a'), subscribe('b')]);
    expect(o.scheduled).toBe(1);
    expect(o.unscheduled).toBe(1);
  });

  it('somme au-delà de la fenêtre affichée : le total ne dépend pas du cadrage', () => {
    const l = loan('a', { schedule: [due('2026-07', '100', '10'), due('2027-07', '900', '90')] });
    const court = outlookOf([l], [subscribe('a')], '2026-06-30', 2);
    expect(court.months).toHaveLength(2);
    expect(court.expectedPrincipal).toBe('1000'); // les deux, pas seulement le mois visible
    expect(court.expectedInterest).toBe('100');
  });

  it('`total` vaut toujours `principal + interest`, sur n’importe quel échéancier', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            m: fc.integer({ min: 7, max: 10 }),
            p: fc.integer({ min: 0, max: 5000 }),
            i: fc.integer({ min: 0, max: 500 }),
          }),
          { maxLength: 12 },
        ),
        (rows) => {
          const schedule = rows.map((r) =>
            due(`2026-${String(r.m).padStart(2, '0')}`, String(r.p), String(r.i)),
          );
          // Cinq mois affichés — juin à octobre — pour que TOUT l'échéancier engendré y tombe.
          const o = outlookOf([loan('a', { schedule })], [subscribe('a')], '2026-06-30', 5);
          for (const m of o.months) {
            expect(Number(m.total)).toBeCloseTo(Number(m.principal) + Number(m.interest), 9);
          }
          const shown = o.months.reduce((t, m) => t + Number(m.principal), 0);
          expect(shown).toBeCloseTo(Number(o.expectedPrincipal), 9);
        },
      ),
    );
  });

  it('une fenêtre d’un mois reste une fenêtre : jamais zéro colonne', () => {
    const o = outlookOf([loan('a')], [subscribe('a')], '2026-06-30', 0);
    expect(o.months).toHaveLength(1);
  });
});
