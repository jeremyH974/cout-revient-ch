/**
 * Propriétés de la traçabilité (fast-check). Mêmes arbitraires que `engine.property.test.ts`
 * — achats en euros ou en USDC, ventes partielles, récompenses —, recopiés ici parce qu'un fichier
 * de test n'exporte rien : importer l'autre rejouerait ses `describe`. Chaque étape produit en plus
 * ses **lignes brutes**, sans quoi les feuilles de provenance ne seraient jamais exercées.
 *
 * Quatre garanties, et pas une de plus :
 *
 * 1. **Ça boucle.** Sous `sum` et `difference`, les enfants font le parent. Comparaisons en `Big` :
 *    un flottant sur des montants décimaux prouverait le contraire de ce qu'on cherche.
 * 2. **Pas de provenance fantôme.** Tout ce qui est cité existe dans l'entrée.
 * 3. **Rien d'inventé.** Une feuille de ligne brute n'affiche jamais plus que ce que sa ligne porte.
 * 4. **Déterminisme.** Deux appels, le même arbre.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, ZERO, type Big } from '../money';
import {
  DEFAULT_ENGINE_SETTINGS,
  type AssetCode,
  type EngineSettings,
  type LedgerEvent,
  type RewardEvent,
  type RowKey,
  type TradeEvent,
} from '../types';
import { computePortfolio } from './aggregate';
import type { PriceQuoteInput } from './report';
import {
  traceMetric,
  type Trace,
  type TraceMetric,
  type TraceNode,
  type TraceRowSnapshot,
} from './trace';

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

interface Scenario {
  events: LedgerEvent[];
  rows: Map<RowKey, TraceRowSnapshot>;
  holdings: Record<string, Big>;
}

/**
 * Interprète les étapes en tenant les soldes (les ventes restent ≤ solde, l'USDC dépensé existe),
 * et fabrique pour chaque opération les deux lignes brutes de l'export : la contrepartie, qui
 * porte la vraie contre-valeur en euros, et la jambe actif, dont la colonne « EUR » ment quand on
 * paie en USDC.
 */
function toScenario(steps: readonly Step[]): Scenario {
  const holdings: Record<string, Big> = { a: D('0'), b: D('0'), usdc: D('0') };
  const events: LedgerEvent[] = [];
  const rows = new Map<RowKey, TraceRowSnapshot>();
  let lineNo = 1;

  const addRow = (
    key: RowKey,
    when: string,
    rawType: string,
    asset: AssetCode,
    signedQty: string,
    valueEur: string | null,
  ): RowKey => {
    rows.set(key, {
      key,
      importId: 'imp:prop',
      lineNo: ++lineNo,
      at: when,
      rawType,
      legs: [{ asset, signedQty, valueEur }],
    });
    return key;
  };

  const trade = (
    i: number,
    out: { asset: string; qty: string },
    inn: { asset: string; qty: string },
    valueEur: string,
    /** Contre-valeur affichée sur la jambe actif : mensongère quand on paie en USDC. */
    assetLegValue: string,
  ): TradeEvent => {
    const id = `p${i}`;
    const when = at(i);
    const counterIsOut = out.asset === 'eur' || out.asset === 'usdc';
    const counter = counterIsOut ? out : inn;
    const assetLeg = counterIsOut ? inn : out;
    const counterKey = addRow(
      `ch:${id}:${counter.asset}`,
      when,
      'Echange',
      counter.asset,
      counterIsOut ? `-${counter.qty}` : counter.qty,
      counterIsOut ? `-${valueEur}` : valueEur,
    );
    const assetKey = addRow(
      `ch:${id}:${assetLeg.asset}`,
      when,
      'Echange',
      assetLeg.asset,
      counterIsOut ? assetLeg.qty : `-${assetLeg.qty}`,
      counterIsOut ? assetLegValue : `-${assetLegValue}`,
    );
    return {
      kind: 'trade',
      id,
      at: when,
      source: 'coinhouse-csv',
      scope: 'coinhouse',
      accountId: 'ch:main',
      rowKeys: [counterKey, assetKey],
      warnings: [],
      out,
      in: inn,
      valueEur,
      valueEurSource: 'counter-leg',
      fee: null,
      quotePrice: null,
      counterRowKey: counterKey,
      assetRowKey: assetKey,
    };
  };

  const reward = (i: number, asset: string, qty: string): RewardEvent => {
    const id = `p${i}`;
    const when = at(i);
    return {
      kind: 'reward',
      id,
      at: when,
      source: 'coinhouse-csv',
      scope: 'coinhouse',
      accountId: 'ch:main',
      rowKeys: [addRow(`ch:${id}:${asset}`, when, 'Staking', asset, qty, null)],
      warnings: [],
      in: { asset, qty },
      fairValueEur: null,
    };
  };

  steps.forEach((step, i) => {
    if (step.kind === 'usdc') {
      const amount = euros(step.cents);
      events.push(
        trade(i, { asset: 'eur', qty: amount }, { asset: 'usdc', qty: amount }, amount, amount),
      );
      holdings['usdc'] = holdings['usdc']!.plus(amount);
    } else if (step.kind === 'buy') {
      const cost = euros(step.cents);
      const qty = milli(step.qty);
      const pay = step.pay === 'usdc' && holdings['usdc']!.gte(cost) ? 'usdc' : 'eur';
      // Payé en USDC : la jambe actif affiche des USDC dans une colonne intitulée « EUR ».
      const shown = pay === 'usdc' ? D(cost).times('1.087').toString() : cost;
      events.push(trade(i, { asset: pay, qty: cost }, { asset: step.asset, qty }, cost, shown));
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
  return { events, rows, holdings };
}

const quote = (asset: string, cents: number): PriceQuoteInput => ({
  asset,
  priceEur: euros(cents),
  at: '2026-02-01T00:00:00Z',
  source: 'test',
  stale: false,
});

const METRICS: readonly TraceMetric[] = [
  'pru',
  'cost-basis',
  'invested',
  'proceeds',
  'realized',
  'unrealized',
  'fees',
  'value',
  'total',
];

function traces(
  scenario: Scenario,
  pa: number,
  pb: number,
  settings: EngineSettings = DEFAULT_ENGINE_SETTINGS,
): Trace[] {
  const report = computePortfolio({
    events: scenario.events,
    prices: { a: quote('a', pa), b: quote('b', pb), usdc: quote('usdc', 92) },
    settings,
  });
  const call = (metric: TraceMetric, asset: string): Trace =>
    traceMetric({
      report,
      target: { metric, scope: { kind: 'position', asset } },
      settings,
      events: scenario.events,
      row: (key) => scenario.rows.get(key) ?? null,
    });
  const out: Trace[] = [];
  for (const metric of METRICS) {
    out.push(call(metric, 'a'), call(metric, 'b'), call(metric, 'usdc'));
    out.push(
      traceMetric({
        report,
        target: { metric, scope: { kind: 'portfolio' } },
        settings,
        events: scenario.events,
        row: (key) => scenario.rows.get(key) ?? null,
      }),
    );
  }
  return out;
}

const flatten = (node: TraceNode): TraceNode[] => [node, ...node.children.flatMap(flatten)];

/** Tolérance de bouclage : un centime aurait suffi, un demi-centime ne laisse aucune marge. */
const BALANCE_TOLERANCE = D('0.005');
const ROOT_TOLERANCE = D('0.01');

describe('traçabilité — propriétés', () => {
  const scenarioArb = fc
    .array(stepArb, { minLength: 1, maxLength: 25 })
    .map((steps) => toScenario(steps));

  it('bouclage : sous un opérateur additif, les enfants font le parent', () => {
    fc.assert(
      fc.property(scenarioArb, priceArb, priceArb, (scenario, pa, pb) => {
        for (const trace of traces(scenario, pa, pb)) {
          for (const node of flatten(trace.root)) {
            if (node.operator !== 'sum' && node.operator !== 'difference') continue;
            if (node.amount === null) continue;
            // Un nœud additif chiffré n'a que des enfants chiffrés : sans quoi la somme mentirait.
            expect(node.children.every((c) => c.amount !== null)).toBe(true);
            const sum = node.children.reduce((acc, c) => acc.plus(D(c.amount ?? '0')), ZERO);
            expect(sum.minus(D(node.amount)).abs().lte(BALANCE_TOLERANCE)).toBe(true);
          }
          expect(D(trace.residual).abs().lte(ROOT_TOLERANCE)).toBe(true);
          // Un résidu non nul n'est tolérable que si l'arbre annonce un trou.
          if (!D(trace.residual).eq(ZERO)) expect(trace.gaps.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('pas de provenance fantôme : tout ce qui est cité existe dans l’entrée', () => {
    fc.assert(
      fc.property(scenarioArb, priceArb, priceArb, (scenario, pa, pb) => {
        const eventIds = new Set(scenario.events.map((e) => e.id));
        // Identifiants de lots possibles, déduits des événements SEULS (jamais du rapport).
        const lotIds = new Set<string>();
        for (const event of scenario.events) {
          if ('in' in event) lotIds.add(`${event.id}:${event.in.asset}`);
        }
        for (const trace of traces(scenario, pa, pb)) {
          for (const node of flatten(trace.root)) {
            const p = node.provenance;
            if (p.kind === 'raw-row') expect(scenario.rows.has(p.rowKey)).toBe(true);
            if (p.kind === 'event') {
              expect(eventIds.has(p.eventId)).toBe(true);
              for (const key of p.rowKeys) expect(scenario.rows.has(key)).toBe(true);
              if (p.counterRowKey !== null) expect(scenario.rows.has(p.counterRowKey)).toBe(true);
            }
            if (p.kind === 'lot') {
              expect(lotIds.has(p.lotId)).toBe(true);
              expect(eventIds.has(p.eventId)).toBe(true);
            }
            if (p.kind === 'unqualified') {
              expect(eventIds.has(p.eventId)).toBe(true);
              for (const key of p.rowKeys) expect(scenario.rows.has(key)).toBe(true);
            }
            if (p.kind === 'setting') expect(Object.keys(DEFAULT_ENGINE_SETTINGS)).toContain(p.key);
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it('rien d’inventé : une feuille n’affiche jamais plus que ce que sa ligne contient', () => {
    fc.assert(
      fc.property(scenarioArb, priceArb, priceArb, (scenario, pa, pb) => {
        for (const trace of traces(scenario, pa, pb)) {
          let shown = ZERO;
          let available = ZERO;
          for (const node of flatten(trace.root)) {
            if (node.provenance.kind !== 'raw-row') continue;
            const cited = scenario.rows.get(node.provenance.rowKey);
            expect(cited).toBeDefined();
            const capacity = (cited?.legs ?? []).reduce(
              (acc, leg) => acc.plus(leg.valueEur === null ? ZERO : D(leg.valueEur).abs()),
              ZERO,
            );
            const amount = node.amount === null ? ZERO : D(node.amount).abs();
            expect(amount.lte(capacity)).toBe(true);
            shown = shown.plus(amount);
            available = available.plus(capacity);
          }
          expect(shown.lte(available)).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('déterminisme : deux appels rendent exactement le même arbre', () => {
    fc.assert(
      fc.property(scenarioArb, priceArb, priceArb, (scenario, pa, pb) => {
        const first = traces(scenario, pa, pb);
        const second = traces(scenario, pa, pb);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      }),
      { numRuns: 30 },
    );
  });

  it('le bouclage tient aussi quand les récompenses sont valorisées à leur juste valeur', () => {
    const settings: EngineSettings = { ...DEFAULT_ENGINE_SETTINGS, rewardValuation: 'fair-value' };
    fc.assert(
      fc.property(scenarioArb, priceArb, priceArb, (scenario, pa, pb) => {
        for (const trace of traces(scenario, pa, pb, settings)) {
          for (const node of flatten(trace.root)) {
            if (node.operator !== 'sum' && node.operator !== 'difference') continue;
            if (node.amount === null) continue;
            const sum = node.children.reduce((acc, c) => acc.plus(D(c.amount ?? '0')), ZERO);
            expect(sum.minus(D(node.amount)).abs().lte(BALANCE_TOLERANCE)).toBe(true);
          }
          expect(D(trace.residual).abs().lte(ROOT_TOLERANCE)).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });
});
