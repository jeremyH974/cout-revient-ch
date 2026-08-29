/**
 * Propriétés de la réconciliation (fast-check) — même garantie que `engine/trace.property.test.ts` :
 * **pas de preuve fantôme**. Sur des séquences aléatoires d'achats, de dépôts, de retraits et de
 * lignes non qualifiées, réparties sur plusieurs comptes :
 *
 * 1. Toute `rowKeys` citée par un item existe réellement parmi les lignes de l'entrée (jamais
 *    inventée).
 * 2. Tout `eventIds` cité existe réellement parmi les événements de l'entrée.
 * 3. Toute `TraceTarget` produite se résout sans lever, via le VRAI moteur (`computePortfolio` +
 *    `traceMetric`), exactement comme `WhySheet` la résoudrait à l'écran.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computePortfolio } from './engine/aggregate';
import { traceMetric } from './engine/trace';
import { D } from './money';
import { buildReconciliation, type ReconciliationContext } from './reconciliation';
import { pairTransfers } from './transfers';
import {
  DEFAULT_ENGINE_SETTINGS,
  type DepositEvent,
  type LedgerEvent,
  type TradeEvent,
  type UnqualifiedEvent,
  type WithdrawalEvent,
} from './types';

type Account = 'ch:main' | 'man:default';
type Step =
  | { kind: 'buy'; account: Account; qty: number; cents: number }
  | { kind: 'deposit'; account: Account; qty: number }
  | { kind: 'withdrawal'; account: Account; qty: number }
  | { kind: 'unqualified'; account: Account };

const accountArb = fc.constantFrom<Account>('ch:main', 'man:default');
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('buy' as const),
    account: accountArb,
    qty: fc.integer({ min: 1, max: 1000 }),
    cents: fc.integer({ min: 1, max: 1_000_000 }),
  }),
  fc.record({
    kind: fc.constant('deposit' as const),
    account: accountArb,
    qty: fc.integer({ min: 1, max: 1000 }),
  }),
  fc.record({
    kind: fc.constant('withdrawal' as const),
    account: accountArb,
    qty: fc.integer({ min: 1, max: 1000 }),
  }),
  fc.record({ kind: fc.constant('unqualified' as const), account: accountArb }),
);

const milli = (n: number): string => D(String(n)).div('1000').toString();
const euros = (cents: number): string => D(String(cents)).div('100').toString();
const at = (i: number): string =>
  `2026-03-${String(1 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00`;

function toEvents(steps: readonly Step[]): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  steps.forEach((step, i) => {
    const when = at(i);
    const id = `s${i}`;
    const rowKeys = [`row:${i}`];
    const common = {
      id,
      at: when,
      scope: 'coinhouse' as const,
      accountId: step.account,
      rowKeys,
      warnings: [],
    };
    if (step.kind === 'buy') {
      const qty = milli(step.qty);
      const cost = euros(step.cents);
      const buy: TradeEvent = {
        ...common,
        kind: 'trade',
        source: 'coinhouse-csv',
        out: { asset: 'eur', qty: cost },
        in: { asset: 'btc', qty },
        valueEur: cost,
        valueEurSource: 'counter-leg',
        fee: null,
        quotePrice: null,
      };
      events.push(buy);
    } else if (step.kind === 'deposit') {
      const dep: DepositEvent = {
        ...common,
        kind: 'deposit',
        source: 'pivot-csv',
        in: { asset: 'btc', qty: milli(step.qty) },
        costEur: null,
      };
      events.push(dep);
    } else if (step.kind === 'withdrawal') {
      const wd: WithdrawalEvent = {
        ...common,
        kind: 'withdrawal',
        source: 'pivot-csv',
        out: { asset: 'btc', qty: milli(step.qty) },
        proceedsEur: null,
      };
      events.push(wd);
    } else {
      const u: UnqualifiedEvent = {
        ...common,
        kind: 'unqualified',
        source: 'coinhouse-csv',
        rawType: 'Type inconnu',
        legs: [{ asset: 'btc', signedQty: '1', valueEur: null }],
        reason: 'type inconnu',
      };
      events.push(u);
    }
  });
  return events;
}

/** Grand livre → contexte de réconciliation, exactement comme `state/checks.svelte.ts` l'assemble. */
function toContext(events: readonly LedgerEvent[]): ReconciliationContext {
  const transfers = pairTransfers(events);
  const report = computePortfolio({
    events: transfers.events,
    prices: {},
    settings: DEFAULT_ENGINE_SETTINGS,
  });
  return {
    report,
    events: transfers.events,
    transfers,
    declarations: { year: 2026, accounts: [], includedCount: 0, uncertainCount: 0 },
    tax: null,
    trading: [],
    duplicateOverrides: {},
  };
}

describe('réconciliation — propriétés', () => {
  const scenarioArb = fc.array(stepArb, { minLength: 0, maxLength: 20 });

  it('pas de preuve fantôme : rowKeys et eventIds cités existent dans l’entrée', () => {
    fc.assert(
      fc.property(scenarioArb, (steps) => {
        const events = toEvents(steps);
        const ctx = toContext(events);
        const rowKeys = new Set(events.flatMap((e) => e.rowKeys));
        const eventIds = new Set(ctx.events.map((e) => e.id));
        const report = buildReconciliation(ctx);
        for (const item of report.items) {
          for (const key of item.evidence.rowKeys) expect(rowKeys.has(key)).toBe(true);
          for (const id of item.evidence.eventIds) expect(eventIds.has(id)).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('toute TraceTarget produite se résout sans lever, via le vrai moteur', () => {
    fc.assert(
      fc.property(scenarioArb, (steps) => {
        const events = toEvents(steps);
        const ctx = toContext(events);
        const report = buildReconciliation(ctx);
        for (const item of report.items) {
          if (item.evidence.trace === null) continue;
          expect(() =>
            traceMetric({
              report: ctx.report,
              target: item.evidence.trace!,
              settings: DEFAULT_ENGINE_SETTINGS,
              events: ctx.events,
              row: () => null,
            }),
          ).not.toThrow();
        }
      }),
      { numRuns: 60 },
    );
  });

  it('déterminisme : deux appels sur le même contexte rendent exactement la même liste', () => {
    fc.assert(
      fc.property(scenarioArb, (steps) => {
        const ctx = toContext(toEvents(steps));
        const first = buildReconciliation(ctx);
        const second = buildReconciliation(ctx);
        expect(second).toEqual(first);
      }),
      { numRuns: 40 },
    );
  });

  it('l’ordre est toujours trié par priorité décroissante, puis par id', () => {
    fc.assert(
      fc.property(scenarioArb, (steps) => {
        const items = buildReconciliation(toContext(toEvents(steps))).items;
        for (let i = 1; i < items.length; i++) {
          const prev = items[i - 1]!;
          const cur = items[i]!;
          expect(prev.priority >= cur.priority).toBe(true);
          if (prev.priority === cur.priority) expect(prev.id <= cur.id).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });
});
