/**
 * TWR : rendement hors apports. La propriété qui le DÉFINIT — et donc le test qui compte — est
 * l'invariance au calendrier des apports : à trajectoire de prix identique, deux investisseurs qui
 * ont apporté à des dates et pour des montants différents doivent afficher le même TWR.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, ZERO, type Big } from './money';
import { TWR_MIN_SPAN_DAYS, remainingDayFraction, twrEur, type TwrDay, type TwrFlow } from './twr';
import { xirrEur } from './xirr';

const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
};
const grid = (from: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => addDays(from, i));
const near = (value: Big | null, expected: number, tolerance = 1e-9): void => {
  expect(value).not.toBeNull();
  expect(Math.abs(Number(value!.toString()) - expected)).toBeLessThan(tolerance);
};

describe('remainingDayFraction', () => {
  it('vaut 1 à minuit, 0,5 à midi, presque 0 en fin de journée', () => {
    near(remainingDayFraction('2026-03-01T00:00:00'), 1);
    near(remainingDayFraction('2026-03-01T12:00:00'), 0.5);
    near(remainingDayFraction('2026-03-01T23:59:59'), 1 / 86400);
  });

  it('retombe sur 0,5 sans heure exploitable', () => {
    near(remainingDayFraction('2026-03-01'), 0.5);
    near(remainingDayFraction('2026-03-01T99:99:99'), 0.5);
  });
});

describe('twrEur', () => {
  it('sans aucun flux, le chaînage télescope : TWR = valeur finale ÷ valeur initiale − 1', () => {
    const days = grid('2026-01-01', 366);
    const series: TwrDay[] = days.map((day, i) => ({
      day,
      value: D('1000').plus(D(String(i)).times('0.2739726')),
    }));
    const result = twrEur(series, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    near(result.cumulative, 0.1, 1e-6);
    near(result.annualized, 0.1, 1e-6); // 365 jours pile : cumulé = annualisé
    expect(result.days).toBe(365);
  });

  it('série plate : rendement nul', () => {
    const series = grid('2026-01-01', 60).map((day) => ({ day, value: D('500') }));
    const result = twrEur(series, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    near(result.cumulative, 0);
    near(result.annualized, 0);
  });

  it('coïncide avec le XIRR quand il n’y a qu’un seul apport, au départ', () => {
    // 1 000 € placés, 1 210 € deux ans plus tard : +21 % cumulés, 10 % par an, quelle que soit la
    // méthode. Deux implémentations indépendantes doivent tomber d'accord.
    const days = grid('2024-01-01', 731);
    const series: TwrDay[] = days.map((day, i) => ({
      day,
      value: D('1000').plus(D('210').times(String(i)).div('730')),
    }));
    const twr = twrEur(series, []);
    const xirr = xirrEur([{ at: '2024-01-01T00:00:00', amountEur: D('-1000') }], {
      day: days[730]!,
      valueEur: D('1210'),
    });
    expect(twr.ok && xirr.ok).toBe(true);
    if (!twr.ok || !xirr.ok) return;
    near(twr.cumulative, 0.21, 1e-9);
    expect(
      Math.abs(Number(twr.annualized!.toString()) - Number(xirr.rate.toString())),
    ).toBeLessThan(1e-6);
  });

  it('un apport en cours de route ne change pas le TWR (c’est toute sa raison d’être)', () => {
    const days = grid('2026-01-01', 61);
    // Prix ×1,5 sur la période ; l'investisseur A ne fait rien, B double sa mise au 30ᵉ jour.
    const price = (i: number): Big => D('100').plus(D(String(i)).times('0.8333333333'));
    const seriesA: TwrDay[] = days.map((day, i) => ({ day, value: price(i).times('10') }));
    const seriesB: TwrDay[] = days.map((day, i) => ({
      day,
      value: price(i).times(i >= 30 ? '25' : '10'),
    }));
    const flowB: TwrFlow[] = [{ at: `${days[30]!}T23:59:59`, amountEur: price(30).times('15') }];
    const a = twrEur(seriesA, []);
    const b = twrEur(seriesB, flowB);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(
      Math.abs(Number(a.cumulative.toString()) - Number(b.cumulative.toString())),
    ).toBeLessThan(1e-4);
  });

  it('neutralise un jour sans base (portefeuille vide au départ du jour)', () => {
    const days = grid('2026-01-01', 40);
    const series: TwrDay[] = days.map((day, i) => ({ day, value: i === 0 ? ZERO : D('1000') }));
    const flows: TwrFlow[] = [{ at: `${days[1]!}T23:59:59`, amountEur: D('1000') }];
    const result = twrEur(series, flows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Le jour de l'apport n'a produit aucun rendement : le chaînage repart de 1.
    near(result.cumulative, 0, 1e-3);
    expect(result.neutralizedDays).toBe(0); // base > 0 grâce à la pondération intra-journalière
  });

  it('compte les jours estimés et refuse une série trop courte', () => {
    const days = grid('2026-01-01', 5);
    const series: TwrDay[] = days.map((day, i) => ({
      day,
      value: D('100'),
      estimated: i % 2 === 0,
    }));
    const result = twrEur(series, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimatedDays).toBe(2); // jours 2 et 4 (le jour 0 n'est qu'un état de départ)
    expect(result.annualized).toBeNull(); // moins de 30 jours : pas d'annualisation
    expect(result.days).toBeLessThan(TWR_MIN_SPAN_DAYS);
    expect(twrEur([{ day: '2026-01-01', value: D('1') }], []).ok).toBe(false);
  });

  it('la précision du produit chaîné reste bornée sur un long historique', () => {
    // Sans arrondi à chaque pas, `Big` garde toute la précision de chaque facteur : le nombre de
    // décimales enfle d'une journée à l'autre et le calcul devient quadratique (repéré par la CI,
    // où l'instrumentation de couverture faisait dépasser le délai d'un test de deux ans).
    const days = grid('2020-01-01', 2000);
    const series: TwrDay[] = days.map((day, i) => ({
      day,
      value: D('1000').plus(D('7').times(String(i)).div('3')),
    }));
    const result = twrEur(series, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decimals = (result.cumulative.toString().split('.')[1] ?? '').length;
    expect(decimals).toBeLessThanOrEqual(18);
    // Sans flux, le chaînage télescope : valeur finale ÷ valeur initiale − 1.
    near(result.cumulative, (7 * 1999) / 3 / 1000, 1e-9);
  });

  it('propriété : quel que soit le calendrier des apports, le TWR suit la trajectoire du prix', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 80, max: 140 }), { minLength: 12, maxLength: 40 }),
        fc.array(fc.tuple(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 9 })), {
          minLength: 0,
          maxLength: 6,
        }),
        (rawPrices, rawFlows) => {
          const days = grid('2026-01-01', rawPrices.length);
          const prices = rawPrices.map((p) => D(String(p)));
          // Quantité en escalier : chaque apport achète au prix de clôture du jour (donc en toute
          // fin de journée, cas où le Dietz intra-journalier est exact).
          const buys = new Map<number, Big>();
          for (const [index, qty] of rawFlows) {
            const i = index % rawPrices.length;
            if (i === 0) continue; // le premier point est un état de départ
            buys.set(i, (buys.get(i) ?? ZERO).plus(String(qty)));
          }
          let qty = D('1');
          const series: TwrDay[] = [];
          const flows: TwrFlow[] = [];
          days.forEach((day, i) => {
            const bought = buys.get(i);
            if (bought) {
              qty = qty.plus(bought);
              flows.push({ at: `${day}T23:59:59`, amountEur: bought.times(prices[i]!) });
            }
            series.push({ day, value: qty.times(prices[i]!) });
          });
          const result = twrEur(series, flows);
          if (!result.ok) return false;
          const expected = Number(prices[prices.length - 1]!.div(prices[0]!).minus('1').toString());
          return Math.abs(Number(result.cumulative.toString()) - expected) < 1e-3;
        },
      ),
      { numRuns: 250 },
    );
  });
});
