/**
 * Propriétés de la règle de présentation (fast-check, P118).
 *
 * 1. **Jamais annualisé sous un an** (GIPS 2020, 2.A.12), quelle que soit la mesure, sa forme
 *    native ou son signe — et toujours annualisé à partir d'un an quand un taux existe. La règle
 *    tient en une comparaison ; c'est précisément ce qui se dérègle en silence le jour où
 *    quelqu'un y met le plancher de bruit du moteur (30 jours) à la place.
 * 2. **Les deux conversions sont réciproques** : ramener un taux annuel à sa période puis
 *    l'annualiser redonne le taux, à l'arrondi des douze décimales près.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, type Big } from '../domain/money';
import { annualizedRate, periodRate, presentReturn, type ReturnBasis } from './presented-return';

/**
 * La règle, écrite ici en toutes lettres plutôt qu'importée : une propriété qui tirerait son
 * domaine de `ANNUALIZE_MIN_DAYS` suivrait la constante qu'elle surveille. La contre-épreuve l'a
 * montré — seuil ramené à 30 jours, la propriété restait verte, puisqu'elle ne tirait plus que
 * des périodes de moins de 30 jours.
 */
const ONE_YEAR = 365;

const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const basis = fc.constantFrom<ReturnBasis>('cumulative', 'annual');
/** Un rendement de −99,9 % à +10 000 %, au millième. */
const rate = fc.integer({ min: -999, max: 100_000 }).map((k) => D(String(k)).div(D('1000')));
const since = fc.integer({ min: 0, max: 20_000 }).map((offset) => addDays('2000-01-01', offset));

describe('propriétés de la règle de présentation', () => {
  it('1a. sous 365 jours, jamais « annualisé »', () => {
    fc.assert(
      fc.property(
        since,
        fc.integer({ min: 0, max: ONE_YEAR - 1 }),
        basis,
        rate,
        (start, span, b, value) => {
          const presented = presentReturn({
            basis: b,
            value,
            since: start,
            until: addDays(start, span),
          });
          expect(presented.kind, `annualisé sur ${span} jours : GIPS 2.A.12 l’interdit`).not.toBe(
            'annualized',
          );
          expect(presented.kind).toBe('cumulative');
        },
      ),
    );
  });

  it('1b. à partir de 365 jours, toujours annualisé', () => {
    fc.assert(
      fc.property(
        since,
        fc.integer({ min: ONE_YEAR, max: 20_000 }),
        basis,
        rate,
        (start, span, b, value) => {
          const presented = presentReturn({
            basis: b,
            value,
            since: start,
            until: addDays(start, span),
          });
          expect(presented.kind, `${span} jours présentés sans annualisation`).toBe('annualized');
        },
      ),
    );
  });

  it('2. ramener à la période puis annualiser redonne le taux annuel', () => {
    const annual = fc.integer({ min: -500, max: 10_000 }).map((k) => D(String(k)).div(D('1000')));
    fc.assert(
      fc.property(annual, fc.integer({ min: 1, max: 3_650 }), (r: Big, days) => {
        const back = annualizedRate(periodRate(r, days)!, days)!;
        const tolerance = 1e-9 * (1 + Math.abs(Number(r.toString())));
        expect(
          Math.abs(Number(back.minus(r).toString())),
          `aller-retour sur ${days} jours : ${r.toString()} → ${back.toString()}`,
        ).toBeLessThan(tolerance);
      }),
    );
  });
});
