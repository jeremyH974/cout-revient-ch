/**
 * Propriétés du barème appliqué à un foyer (fast-check, décision n° 169).
 *
 * Elles portent sur ce qui justifie l'existence même du mode « revenu + parts » : un gain qui
 * franchit une borne ne coûte ni le taux d'avant ni celui d'après, mais quelque chose entre les
 * deux. Un test par l'exemple ne dit ça que pour un couple de chiffres ; une propriété le dit pour
 * tous.
 *
 * 1. **L'impôt croît avec le revenu**, jamais l'inverse.
 * 2. **Le quotient familial est une division puis une multiplication** : l'impôt d'un foyer à `n`
 *    parts vaut exactement `n` fois celui du même quotient à une part.
 * 3. **Un supplément est encadré par ses deux tranches** : au moins ce que la tranche de départ
 *    prélèverait, au plus ce que prélèverait celle d'arrivée. C'est la propriété qui rend le mode
 *    rapide honnête — il se trompe, mais on sait dans quel sens et de combien au pire.
 * 4. **L'impôt ne dépasse jamais le taux le plus haut** du barème.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scaleFor } from '../domain/income-tax-fr';
import { D } from '../domain/money';
import { marginalRateFor, taxOnExtraIncome, taxOnIncome } from './household-tax';

const SCALE = scaleFor(2025)!;
const TOP_RATE = D(SCALE.brackets[SCALE.brackets.length - 1]!.rate);
/** Le quotient familial se divise à 30 décimales : l'encadrement se vérifie au milliardième. */
const EPSILON = D('0.000000001');

/** Un revenu plausible, au centime : de zéro à un demi-million. */
const income = fc.integer({ min: 0, max: 50_000_000 }).map((c) => D(String(c)).div(D('100')));
/** De une à cinq parts, par demi-part. */
const parts = fc.integer({ min: 2, max: 10 }).map((halves) => D(String(halves)).div(D('2')));

describe('propriétés du barème', () => {
  it('l’impôt croît avec le revenu', () => {
    fc.assert(
      fc.property(income, income, parts, (a, b, p) => {
        const [low, high] = a.lte(b) ? [a, b] : [b, a];
        expect(taxOnIncome(SCALE, high, p).gte(taxOnIncome(SCALE, low, p))).toBe(true);
      }),
    );
  });

  it('le quotient familial : n parts coûtent n fois le même quotient à une part', () => {
    fc.assert(
      fc.property(income, parts, (revenu, p) => {
        const whole = taxOnIncome(SCALE, revenu, p);
        const perPart = taxOnIncome(SCALE, revenu.div(p), D('1')).times(p);
        // Une division exacte des deux côtés : l'égalité doit être stricte, pas approchée.
        expect(whole.toString()).toBe(perPart.toString());
      }),
    );
  });

  it('un supplément coûte au moins sa tranche de départ et au plus celle d’arrivée', () => {
    fc.assert(
      fc.property(income, income, parts, (revenu, extra, p) => {
        const household = { taxableIncomeEur: revenu.toString(), parts: p.toString() };
        const result = taxOnExtraIncome(SCALE, household, extra);
        const cost = D(result.taxEur);
        expect(cost.plus(EPSILON).gte(extra.times(D(result.marginalRateBefore)))).toBe(true);
        expect(cost.minus(EPSILON).lte(extra.times(D(result.marginalRateAfter)))).toBe(true);
      }),
    );
  });

  it('l’impôt ne dépasse jamais le taux le plus haut du barème', () => {
    fc.assert(
      fc.property(income, parts, (revenu, p) => {
        expect(taxOnIncome(SCALE, revenu, p).minus(EPSILON).lte(revenu.times(TOP_RATE))).toBe(true);
        expect(D(marginalRateFor(SCALE, revenu, p)).lte(TOP_RATE)).toBe(true);
      }),
    );
  });
});
