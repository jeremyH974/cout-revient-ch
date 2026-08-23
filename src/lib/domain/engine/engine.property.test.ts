/**
 * Tests de propriétés (fast-check) : des séquences aléatoires d'achats, de ventes partielles,
 * de récompenses et d'achats en USDC doivent toujours respecter les invariants du moteur.
 * Quantités et montants dérivés d'entiers : jamais de flottant.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type Big from 'big.js';
import { D } from '../money';
import {
  DEFAULT_ENGINE_SETTINGS,
  type LedgerEvent,
  type RewardEvent,
  type TradeEvent,
} from '../types';
import { computePortfolio } from './aggregate';
import type { PortfolioReport, PositionReport, PriceQuoteInput } from './report';

type Crypto = 'a' | 'b';
type Step =
  | { kind: 'buy'; asset: Crypto; qty: number; cents: number; pay: 'eur' | 'usdc' }
  | { kind: 'sell'; asset: Crypto; pct: number; cents: number }
  | { kind: 'reward'; asset: Crypto; qty: number }
  | { kind: 'usdc'; cents: number };

const crypto = fc.constantFrom<Crypto>('a', 'b');
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('buy' as const),
    asset: crypto,
    qty: fc.integer({ min: 1, max: 100_000 }),
    cents: fc.integer({ min: 1, max: 10_000_000 }),
    pay: fc.constantFrom<'eur' | 'usdc'>('eur', 'usdc'),
  }),
  fc.record({
    kind: fc.constant('sell' as const),
    asset: crypto,
    pct: fc.integer({ min: 1, max: 100 }),
    cents: fc.integer({ min: 1, max: 10_000_000 }),
  }),
  fc.record({
    kind: fc.constant('reward' as const),
    asset: crypto,
    qty: fc.integer({ min: 1, max: 1000 }),
  }),
  fc.record({
    kind: fc.constant('usdc' as const),
    cents: fc.integer({ min: 100, max: 10_000_000 }),
  }),
);
const priceArb = fc.integer({ min: 1, max: 100_000_000 });

const milli = (n: number): string => D(String(n)).div('1000').toString();
const euros = (cents: number): string => D(String(cents)).div('100').toString();
const at = (i: number): string =>
  `2026-01-${String(1 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00`;

let seq = 0;
const base = (i: number) => ({
  id: `p${++seq}`,
  at: at(i),
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  rowKeys: [],
  warnings: [],
});
const trade = (
  i: number,
  out: { asset: string; qty: string },
  inn: { asset: string; qty: string },
  valueEur: string,
): TradeEvent => ({
  ...base(i),
  kind: 'trade',
  out,
  in: inn,
  valueEur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const reward = (i: number, asset: string, qty: string): RewardEvent => ({
  ...base(i),
  kind: 'reward',
  in: { asset, qty },
  fairValueEur: null,
});

/** Interprète les étapes en tenant les soldes : les ventes restent ≤ solde, l'USDC dépensé existe. */
function toEvents(steps: readonly Step[]): {
  events: LedgerEvent[];
  holdings: Record<string, Big>;
} {
  const holdings: Record<string, Big> = { a: D('0'), b: D('0'), usdc: D('0') };
  const events: LedgerEvent[] = [];
  steps.forEach((step, i) => {
    if (step.kind === 'usdc') {
      const amount = euros(step.cents);
      events.push(trade(i, { asset: 'eur', qty: amount }, { asset: 'usdc', qty: amount }, amount));
      holdings['usdc'] = holdings['usdc']!.plus(amount);
    } else if (step.kind === 'buy') {
      const cost = euros(step.cents);
      const qty = milli(step.qty);
      const pay = step.pay === 'usdc' && holdings['usdc']!.gte(cost) ? 'usdc' : 'eur';
      events.push(trade(i, { asset: pay, qty: cost }, { asset: step.asset, qty }, cost));
      holdings[step.asset] = holdings[step.asset]!.plus(qty);
      if (pay === 'usdc') holdings['usdc'] = holdings['usdc']!.minus(cost);
    } else if (step.kind === 'sell') {
      const held = holdings[step.asset]!;
      if (held.lte('0')) return;
      const qty = step.pct === 100 ? held : held.times(String(step.pct)).div('100');
      const proceeds = euros(step.cents);
      events.push(
        trade(
          i,
          { asset: step.asset, qty: qty.toString() },
          { asset: 'eur', qty: proceeds },
          proceeds,
        ),
      );
      holdings[step.asset] = held.minus(qty);
    } else {
      const qty = milli(step.qty);
      events.push(reward(i, step.asset, qty));
      holdings[step.asset] = holdings[step.asset]!.plus(qty);
    }
  });
  return { events, holdings };
}

const quote = (asset: string, cents: number): PriceQuoteInput => ({
  asset,
  priceEur: euros(cents),
  at: '2026-02-01T00:00:00Z',
  source: 'test',
  stale: false,
});
const run = (events: LedgerEvent[], pa: number, pb: number): PortfolioReport =>
  computePortfolio({
    events,
    prices: { a: quote('a', pa), b: quote('b', pb), usdc: quote('usdc', 92) },
    settings: DEFAULT_ENGINE_SETTINGS,
  });

const TOLERANCE = '0.000000000001';
const close = (x: Big, y: Big): boolean => x.minus(y).abs().lte(TOLERANCE);
const all = (r: PortfolioReport): PositionReport[] => [
  ...r.positions,
  ...r.stablecoins,
  ...r.closed,
];

describe('moteur — propriétés', () => {
  it('total = valeur + Σ produits − Σ achats, par actif et globalement ; lots et PRU cohérents', () => {
    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 1, maxLength: 30 }),
        priceArb,
        priceArb,
        (steps, pa, pb) => {
          const { events } = toEvents(steps);
          const report = run(events, pa, pb);
          expect(report.blocked).toEqual([]);
          for (const p of all(report)) {
            expect(p.qty.gte('0')).toBe(true);
            if (p.value !== null && p.total !== null) {
              expect(close(p.total, p.value.plus(p.proceedsTotal).minus(p.investedTotal))).toBe(
                true,
              );
            }
            if (p.qty.gt('0') && p.pru !== null) {
              expect(close(p.costBasis, p.qty.times(p.pru))).toBe(true);
              const lotQty = p.lots.reduce((acc, l) => acc.plus(l.qtyRemaining), D('0'));
              expect(close(lotQty, p.qty)).toBe(true);
              const lotCost = p.lots.reduce((acc, l) => acc.plus(l.costRemaining), D('0'));
              expect(close(lotCost, p.costBasis)).toBe(true);
            }
          }
          const t = report.totals;
          expect(close(t.total, t.value.plus(t.proceedsTotal).minus(t.investedTotal))).toBe(true);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("une vente partielle ne change pas le PRU (il ne bouge qu'à l'achat)", () => {
    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        priceArb,
        (steps, pct, cents, price) => {
          const { events, holdings } = toEvents(steps);
          fc.pre(holdings['a']!.gt('0'));
          const before = run(events, price, price);
          const pruBefore = before.positions.find((p) => p.asset === 'a')?.pru ?? null;
          fc.pre(pruBefore !== null);
          const sellQty = holdings['a']!.times(String(pct)).div('100').toString();
          // Le reste doit valoir au moins 1 € : en dessous de 0,01 € la position devient poussière (clôturée).
          const remainingValue = holdings['a']!.minus(sellQty).times(euros(price));
          fc.pre(remainingValue.gte('1'));
          const proceeds = euros(cents);
          const after = run(
            [
              ...events,
              trade(
                steps.length + 1,
                { asset: 'a', qty: sellQty },
                { asset: 'eur', qty: proceeds },
                proceeds,
              ),
            ],
            price,
            price,
          );
          const pruAfter = after.positions.find((p) => p.asset === 'a')?.pru ?? null;
          expect(pruAfter).not.toBeNull();
          expect(close(pruAfter!, pruBefore!)).toBe(true);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('une survente bloque l’actif sans jamais produire de quantité négative', () => {
    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 101, max: 500 }),
        priceArb,
        (steps, pct, price) => {
          const { events, holdings } = toEvents(steps);
          fc.pre(holdings['a']!.gt('0'));
          const sellQty = holdings['a']!.times(String(pct)).div('100').toString();
          const report = run(
            [
              ...events,
              trade(
                steps.length + 1,
                { asset: 'a', qty: sellQty },
                { asset: 'eur', qty: '1' },
                '1',
              ),
            ],
            price,
            price,
          );
          expect(report.blocked.map((p) => p.asset)).toContain('a');
          for (const p of [...all(report), ...report.blocked]) expect(p.qty.gte('0')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
