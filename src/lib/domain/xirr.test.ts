/**
 * XIRR : vecteurs vérifiés (exemple canonique Microsoft, formes fermées à deux flux), robustesse
 * (tri, agrégation par jour, taux très négatifs via bissection) et garde-fous. Base 365 fixe.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { epochDayOf } from './date';
import { D } from './money';
import { xirrEur, type XirrFlow } from './xirr';

const flow = (at: string, amount: string): XirrFlow => ({ at, amountEur: D(amount) });

const rateOf = (flows: XirrFlow[], valuation: { day: string; valueEur: string } | null): number => {
  const result = xirrEur(
    flows,
    valuation ? { day: valuation.day, valueEur: D(valuation.valueEur) } : null,
  );
  if (!result.ok) throw new Error(`xirr a échoué : ${result.reason}`);
  return Number(result.rate.toString());
};

describe('xirrEur', () => {
  it('retrouve l’exemple canonique de la documentation Microsoft (≈ 0,373362535)', () => {
    const rate = rateOf(
      [
        flow('2008-01-01', '-10000'),
        flow('2008-03-01', '2750'),
        flow('2008-10-30', '4250'),
        flow('2009-02-15', '3250'),
        flow('2009-04-01', '2750'),
      ],
      null,
    );
    expect(rate).toBeCloseTo(0.373362535, 6);
  });

  it('forme fermée : −1000 puis +1100 exactement 365 jours plus tard → 10 %', () => {
    const rate = rateOf([flow('2025-01-01', '-1000'), flow('2026-01-01', '1100')], null);
    expect(Math.abs(rate - 0.1)).toBeLessThan(1e-9);
  });

  it('base 365 fixe même à cheval sur une année bissextile', () => {
    // 2024 compte 366 jours : le 365e jour après le 2024-01-01 est le 2024-12-31.
    expect(epochDayOf('2024-12-31')! - epochDayOf('2024-01-01')!).toBe(365);
    const rate = rateOf([flow('2024-01-01', '-1000'), flow('2024-12-31', '1100')], null);
    expect(Math.abs(rate - 0.1)).toBeLessThan(1e-9);
  });

  it('rendement négatif en forme fermée : −1000 puis +800 à 365 jours → −20 %', () => {
    const rate = rateOf([flow('2025-01-01', '-1000'), flow('2026-01-01', '800')], null);
    expect(Math.abs(rate - -0.2)).toBeLessThan(1e-9);
  });

  it('perte quasi totale (−99,5 %) : le repli par bissection converge', () => {
    const rate = rateOf([flow('2025-01-01', '-1000'), flow('2026-01-01', '5')], null);
    expect(Math.abs(rate - -0.995)).toBeLessThan(1e-9);
  });

  it('l’ordre d’entrée des flux est indifférent et un même jour est agrégé', () => {
    const reference = rateOf(
      [flow('2025-06-15', '-1000'), flow('2025-01-01', '-500'), flow('2026-03-01', '1900')],
      null,
    );
    const shuffled = rateOf(
      [
        flow('2026-03-01', '1900'),
        flow('2025-01-01T10:00:00', '-250'),
        flow('2025-06-15', '-1000'),
        flow('2025-01-01T18:30:00', '-250'),
      ],
      null,
    );
    expect(Math.abs(reference - shuffled)).toBeLessThan(1e-12);
  });

  it('la valeur finale du portefeuille compte comme un flux positif au jour donné', () => {
    const withValuation = rateOf([flow('2025-01-01', '-1000')], {
      day: '2026-01-01',
      valueEur: '1100',
    });
    expect(Math.abs(withValuation - 0.1)).toBeLessThan(1e-9);
  });

  it('garde-fous : flux insuffisants, même signe, période trop courte', () => {
    expect(xirrEur([flow('2025-01-01', '-1000')], null)).toEqual({
      ok: false,
      reason: 'insufficient-flows',
    });
    expect(xirrEur([flow('2025-01-01', '-1000'), flow('2025-06-01', '-50')], null)).toEqual({
      ok: false,
      reason: 'same-sign',
    });
    expect(xirrEur([flow('2025-01-01', '-1000'), flow('2025-01-11', '1010')], null)).toEqual({
      ok: false,
      reason: 'too-recent',
    });
  });

  it('un portefeuille soldé (valeur nulle) se calcule sur les seuls produits', () => {
    const result = xirrEur([flow('2025-01-01', '-1000'), flow('2026-01-01', '1050')], {
      day: '2026-02-01',
      valueEur: D('0'),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.since).toBe('2025-01-01');
      expect(result.until).toBe('2026-01-01');
      expect(Number(result.rate.toString())).toBeCloseTo(0.05, 9);
    }
  });

  it('propriété : un achat unique puis la valeur V à d jours vaut (V/C)^(365/d) − 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10000 }),
        fc.integer({ min: 1, max: 50000 }),
        fc.integer({ min: 31, max: 3000 }),
        (cost, value, span) => {
          const start = epochDayOf('2020-01-06')!;
          // Reconstruit le jour cible par balayage grossier (mois de 28 jours sûrs).
          const targetDay = start + span;
          let year = 2020;
          let month = 1;
          let dayOfMonth = 6 + span;
          while (dayOfMonth > 28) {
            dayOfMonth -= 28;
            month++;
            if (month > 12) {
              month = 1;
              year++;
            }
          }
          const iso = `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
          const actualSpan = epochDayOf(iso)! - start;
          fc.pre(actualSpan >= 31);
          void targetDay;
          const expected = Math.pow(value / cost, 365 / actualSpan) - 1;
          fc.pre(expected > -0.9999 && expected < 1e6);
          const rate = rateOf([flow('2020-01-06', `-${cost}`)], {
            day: iso,
            valueEur: String(value),
          });
          expect(Math.abs(rate - expected)).toBeLessThan(1e-6 * Math.max(1, Math.abs(expected)));
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('xirrEur — vecteurs contradictoires (vérifiés en float64 et Decimal-60)', () => {
  it('perte sévère et rapide : Newton nu divergerait sous −1, le solveur converge (−88,889 %)', () => {
    // (0,3)^(365/200) − 1 = −0.888891754470 ; f(0.1) pousse Newton nu à r₁ = −4.94 → NaN.
    const rate = rateOf([flow('2000-01-01', '-1000'), flow('2000-07-19', '300')], null);
    expect(rate).toBeCloseTo(-0.88889175447, 9);
  });

  it('année de 366 jours : base 365 fixe → 9,9714 %, pas 10 %', () => {
    const rate = rateOf([flow('2015-03-01', '-1000'), flow('2016-03-01', '1100')], null);
    expect(rate).toBeCloseTo(0.099713585934141, 9);
  });

  it('racines multiples : renvoie celle proche du guess 0,1 (comme Excel), déterministe', () => {
    // −1600, +10000 à 365 j, −10000 à 730 j (2020 bissextile : dates décalées) : racines exactes 0.25 et 4 (x² − x + 0.16 = 0).
    const rate = rateOf(
      [flow('2020-01-01', '-1600'), flow('2020-12-31', '10000'), flow('2021-12-31', '-10000')],
      null,
    );
    expect(rate).toBeCloseTo(0.25, 9);
  });

  it('valeur canonique Microsoft au 1e-9 recalculé (0.373362533519)', () => {
    const rate = rateOf(
      [
        flow('2008-01-01', '-10000'),
        flow('2008-03-01', '2750'),
        flow('2008-10-30', '4250'),
        flow('2009-02-15', '3250'),
        flow('2009-04-01', '2750'),
      ],
      null,
    );
    expect(rate).toBeCloseTo(0.373362533519, 9);
  });
});
