/**
 * Propriétés de la fenêtre d'analyse du Rapport (fast-check, P118).
 *
 * Elles portent sur ce que le lecteur d'un rapport tient pour acquis quand il change de plage, et
 * qu'un exemple ne prouve que pour un jeu de chiffres :
 *
 * 1. **Le TWR se chaîne** : deux fenêtres contiguës se composent en leur réunion, (1 + R[a,c]) =
 *    (1 + R[a,b])·(1 + R[b+1,c]) — GIPS 2020, 2.A.24.f. C'est ce qui interdit à la convention des
 *    bornes de perdre ou de compter deux fois un jour à la couture.
 * 2. **« Depuis l'origine » est le XIRR du Rapport** : la fenêtre ouverte à gauche rend le chiffre
 *    qu'on affichait avant elle, et une fenêtre qui s'ouvre avant le premier flux aussi.
 * 3. **Les flux d'une partition s'additionnent exactement** en ceux de la fenêtre entière.
 * 4. **Les gains de fenêtres contiguës s'additionnent exactement**, sans tolérance.
 * 5. **Le gain se décompose en réalisé + variation du latent**, sur le vrai moteur : les flux lus
 *    sur l'historique et les stocks lus sur la série racontent la même fenêtre.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computePortfolio, holdings, type CashFlow } from '../domain/engine';
import { D, ONE, ZERO, type Big } from '../domain/money';
import type { TwrFlow, TwrResult } from '../domain/twr';
import {
  DEFAULT_ENGINE_SETTINGS,
  type FeeEvent,
  type IncomeEvent,
  type LedgerEvent,
  type TradeEvent,
} from '../domain/types';
import { xirrEur } from '../domain/xirr';
import { addDays, eachDay } from './days';
import { externalFlows } from './performance';
import { holdingOpsOf, holdingStep, valueSeries, type DayWindow, type ValuePoint } from './series';
import {
  openingDay,
  valueAt,
  windowFlows,
  windowGain,
  windowMwr,
  windowTwr,
  type WindowEntry,
  type WindowFlows,
} from './window';

const START = '2026-01-01';
const dayAt = (index: number): string => addDays(START, index);
const pad = (n: number): string => String(n).padStart(2, '0');
const at = (index: number, second: number): string =>
  `${dayAt(index)}T${pad(Math.floor(second / 3600))}:${pad(Math.floor(second / 60) % 60)}:${pad(second % 60)}`;
const big = (n: number): Big => D(String(n));

/** Trois bornes ordonnées i ≤ j < k : deux fenêtres contiguës [i, j] et [j + 1, k]. */
const cuts = (min: number, max: number) =>
  fc
    .tuple(fc.integer({ min, max }), fc.integer({ min, max }), fc.integer({ min, max }))
    .map((t) => [...t].sort((a, b) => a - b) as [number, number, number])
    .filter(([, j, k]) => j < k);

const flowArb = (days: number) =>
  fc.record({
    day: fc.integer({ min: 0, max: days - 1 }),
    second: fc.integer({ min: 0, max: 86_399 }),
    amount: fc.integer({ min: -20, max: 20 }),
  });

const twrFlows = (raw: readonly { day: number; second: number; amount: number }[]): TwrFlow[] =>
  raw.map((f) => ({ at: at(f.day, f.second), amountEur: big(f.amount) }));

describe('propriétés de la fenêtre d’analyse', () => {
  it('1. le TWR de deux fenêtres contiguës se chaîne en celui de leur réunion', () => {
    const cases = fc.integer({ min: 3, max: 40 }).chain((n) =>
      fc.record({
        // Valeurs et flux bornés : le produit chaîné reste dans [0,004 ; 130], loin de l'arrondi à
        // 18 décimales que `twrEur` applique à chaque pas.
        values: fc.array(fc.integer({ min: 950, max: 1050 }), { minLength: n, maxLength: n }),
        flows: fc.array(flowArb(n), { maxLength: 12 }),
        cuts: cuts(1, n - 1),
      }),
    );
    fc.assert(
      fc.property(cases, ({ values, flows, cuts: [i, j, k] }) => {
        const input = {
          series: values.map((v, index) => ({ day: dayAt(index), value: big(v) })),
          flows: twrFlows(flows),
        };
        const growth = (window: DayWindow): Big => {
          const result: TwrResult = windowTwr(input, window);
          if (!result.ok) throw new Error(`TWR impossible sur ${JSON.stringify(window)}`);
          return ONE.plus(result.cumulative);
        };
        const whole = growth({ from: dayAt(i), to: dayAt(k) });
        const linked = growth({ from: dayAt(i), to: dayAt(j) }).times(
          growth({ from: dayAt(j + 1), to: dayAt(k) }),
        );
        expect(
          linked.minus(whole).abs().lte(whole.times('1e-12')),
          `chaînage rompu à la couture du ${dayAt(j)} : ${linked.toString()} ≠ ${whole.toString()}`,
        ).toBe(true);
      }),
    );
  });

  it('2. depuis l’origine, le rendement pondéré par les flux est le XIRR du Rapport', () => {
    const cases = fc.record({
      raw: fc.array(
        fc.record({
          day: fc.integer({ min: 0, max: 400 }),
          second: fc.integer({ min: 0, max: 86_399 }),
          amount: fc.integer({ min: -5_000, max: 5_000 }).filter((a) => a !== 0),
        }),
        { minLength: 1, maxLength: 12 },
      ),
      closing: fc.integer({ min: 0, max: 100_000 }),
      extra: fc.integer({ min: 0, max: 30 }),
      earlier: fc.integer({ min: 0, max: 30 }),
    });
    fc.assert(
      fc.property(cases, ({ raw, closing, extra, earlier }) => {
        // Les flux tels que le moteur les écrit (signe de l'investisseur), puis tels que la fenêtre
        // les reçoit (`externalFlows`, signe du portefeuille) : le chemin du câblage.
        const cashFlows: CashFlow[] = raw.map((f, index) => ({
          at: at(f.day, f.second),
          amountEur: big(f.amount),
          eventId: `e${index}`,
        }));
        const first = Math.min(...raw.map((f) => f.day));
        const to = dayAt(Math.max(...raw.map((f) => f.day)) + extra);
        const legacy = xirrEur(cashFlows, { day: to, valueEur: big(closing) });
        // Portefeuille vide avant le premier flux : une série sans point vaut zéro partout.
        const input = {
          series: [],
          flows: externalFlows(cashFlows, {}),
          closingValue: big(closing),
        };
        expect(windowMwr(input, { from: null, to }), 'depuis l’origine ≠ XIRR du Rapport').toEqual(
          legacy,
        );
        expect(
          windowMwr(input, { from: dayAt(first - earlier), to }),
          'une fenêtre ouverte avant le premier flux change le XIRR',
        ).toEqual(legacy);
      }),
    );
  });

  it('3. les flux d’une partition s’additionnent exactement en ceux de la fenêtre entière', () => {
    const DAYS = 60;
    const entry = fc.record({
      day: fc.integer({ min: 0, max: DAYS - 1 }),
      second: fc.integer({ min: 0, max: 86_399 }),
      kind: fc.constantFrom('buy', 'sell', 'reward', 'split'),
      realized: fc.option(fc.integer({ min: -100_000, max: 100_000 }), { nil: null }),
      fee: fc.integer({ min: 0, max: 5_000 }),
      rebate: fc.integer({ min: 0, max: 1_000 }),
      value: fc.integer({ min: 0, max: 500_000 }),
    });
    const event = fc.record({
      day: fc.integer({ min: 0, max: DAYS - 1 }),
      second: fc.integer({ min: 0, max: 86_399 }),
      kind: fc.constantFrom('income', 'fee'),
      asset: fc.constantFrom(null, 'a', 'b', 'hors-perimetre'),
      cents: fc.integer({ min: -10_000, max: 10_000 }),
    });
    const cases = fc.record({
      a: fc.array(entry, { maxLength: 15 }),
      b: fc.array(entry, { maxLength: 15 }),
      events: fc.array(event, { maxLength: 15 }),
      cuts: cuts(0, DAYS - 1),
      openLeft: fc.boolean(),
    });
    const cents = (n: number): Big => big(n).div(big(100));
    fc.assert(
      fc.property(cases, ({ a, b, events, cuts: [i, j, k], openLeft }) => {
        const history = (raw: typeof a): WindowEntry[] =>
          raw.map((e) => ({
            at: at(e.day, e.second),
            kind: e.kind,
            realized: e.realized === null ? null : cents(e.realized),
            feeEur: cents(e.fee),
            rebateEur: cents(e.rebate),
            valueEur: cents(e.value),
          }));
        const ledger: LedgerEvent[] = events.map((e, index) => {
          const base = {
            id: `ev${index}`,
            at: at(e.day, e.second),
            source: 'manual' as const,
            scope: 'coinhouse' as const,
            accountId: 'ch:main' as const,
            rowKeys: [],
            warnings: [],
          };
          return e.kind === 'fee'
            ? ({
                ...base,
                kind: 'fee',
                amountEur: cents(e.cents).toString(),
                label: 'f',
              } satisfies FeeEvent)
            : ({
                ...base,
                kind: 'income',
                asset: e.asset,
                grossEur: cents(e.cents).toString(),
                withheldEur: '0',
                nature: 'dividend',
                label: 'r',
              } satisfies IncomeEvent);
        });
        const input = {
          positions: [
            { asset: 'a', history: history(a) },
            { asset: 'b', history: history(b) },
          ],
          events: ledger,
        };
        const from = openLeft ? null : dayAt(i);
        const left = windowFlows(input, { from, to: dayAt(j) });
        const right = windowFlows(input, { from: dayAt(j + 1), to: dayAt(k) });
        const whole = windowFlows(input, { from, to: dayAt(k) });
        for (const key of Object.keys(whole) as (keyof WindowFlows)[])
          expect(
            left[key].plus(right[key]).eq(whole[key]),
            `${key} : la partition au ${dayAt(j)} ne redonne pas la fenêtre entière`,
          ).toBe(true);
      }),
    );
  });

  it('4. les gains de deux fenêtres contiguës s’additionnent exactement', () => {
    const cases = fc.integer({ min: 2, max: 40 }).chain((n) =>
      fc.record({
        // Des zéros compris : un portefeuille soldé puis repris ne doit rien casser.
        values: fc.array(fc.integer({ min: 0, max: 5_000 }), { minLength: n, maxLength: n }),
        flows: fc.array(flowArb(n), { maxLength: 12 }),
        cuts: cuts(0, n - 1),
        openLeft: fc.boolean(),
      }),
    );
    fc.assert(
      fc.property(cases, ({ values, flows, cuts: [i, j, k], openLeft }) => {
        const input = {
          series: values.map((v, index) => ({ day: dayAt(index), value: big(v) })),
          flows: twrFlows(flows),
        };
        const from = openLeft ? null : dayAt(i);
        const left = windowGain(input, { from, to: dayAt(j) });
        const right = windowGain(input, { from: dayAt(j + 1), to: dayAt(k) });
        const whole = windowGain(input, { from, to: dayAt(k) });
        expect(
          right.startValue.eq(left.endValue),
          'la clôture d’une fenêtre n’ouvre pas la suivante',
        ).toBe(true);
        expect(
          left.gain.plus(right.gain).eq(whole.gain),
          `gains non additifs à la couture du ${dayAt(j)}`,
        ).toBe(true);
      }),
    );
  });

  it('5. sur le vrai moteur, le gain d’une fenêtre = réalisé + variation du latent', () => {
    const cases = fc.integer({ min: 2, max: 30 }).chain((n) =>
      fc.record({
        prices: fc.array(fc.integer({ min: 50, max: 150 }), { minLength: n, maxLength: n }),
        ops: fc.array(
          fc.record({
            day: fc.integer({ min: 0, max: n - 1 }),
            sell: fc.boolean(),
            units: fc.integer({ min: 1, max: 5 }),
            quarters: fc.integer({ min: 1, max: 4 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        window: fc
          .tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 }))
          .map(([x, y]) => [Math.min(x, y), Math.max(x, y)] as const),
        openLeft: fc.boolean(),
      }),
    );
    fc.assert(
      fc.property(cases, ({ prices, ops, window: [i, k], openLeft }) => {
        // Achats et ventes au cours du jour ; une vente cède un quart, une moitié… de ce qui est
        // détenu, jamais davantage. Des heures distinctes : l'ordre du moteur est celui d'ici.
        const sorted = ops
          .map((op, index) => ({ ...op, index }))
          .sort((x, y) => x.day - y.day || x.index - y.index);
        const events: TradeEvent[] = [];
        let held = ZERO;
        sorted.forEach((op, index) => {
          const price = big(prices[op.day]!);
          const when = at(op.day, 36_000 + index);
          const qty = op.sell ? held.times(big(op.quarters)).div(big(4)) : big(op.units);
          if (qty.eq(ZERO)) return;
          const eur = qty.times(price).toString();
          const legs = op.sell
            ? { out: { asset: 'x', qty: qty.toString() }, in: { asset: 'eur', qty: eur } }
            : { out: { asset: 'eur', qty: eur }, in: { asset: 'x', qty: qty.toString() } };
          events.push({
            id: `op${index}`,
            at: when,
            source: 'manual',
            scope: 'coinhouse',
            accountId: 'ch:main',
            rowKeys: [],
            warnings: [],
            kind: 'trade',
            ...legs,
            valueEur: eur,
            valueEurSource: 'manual',
            fee: null,
            quotePrice: null,
          });
          held = op.sell ? held.minus(qty) : held.plus(qty);
        });
        fc.pre(events.length > 0);
        const report = computePortfolio({ events, prices: {}, settings: DEFAULT_ENGINE_SETTINGS });
        const positions = [...holdings(report), ...report.closed];
        expect(report.blocked).toEqual([]);
        const values: ValuePoint[] = valueSeries({
          holdings: { x: holdingStep(holdingOpsOf(positions[0]!.history, {})) },
          prices: {
            x: { points: prices.map((p, index) => ({ day: dayAt(index), priceEur: String(p) })) },
          },
          days: eachDay(dayAt(-1), dayAt(prices.length - 1)),
        });
        const input = {
          series: values.map((p) => ({ day: p.day, value: p.value })),
          flows: externalFlows(report.cashFlows, {}),
        };
        const window: DayWindow = { from: openLeft ? null : dayAt(i), to: dayAt(k) };
        const latentAt = (day: string | null): Big => {
          if (day === null) return ZERO;
          const cost = valueAt(
            values.map((p) => ({ day: p.day, value: p.cost })),
            day,
          );
          return valueAt(input.series, day).minus(cost);
        };
        const gain = windowGain(input, window).gain;
        const realized = windowFlows({ positions, events }, window).realized;
        const explained = realized.plus(latentAt(window.to)).minus(latentAt(openingDay(window)));
        expect(
          gain.minus(explained).abs().lt('1e-9'),
          `gain ${gain.toString()} ≠ réalisé ${realized.toString()} + Δ latent sur ${JSON.stringify(window)}`,
        ).toBe(true);
      }),
    );
  });
});
