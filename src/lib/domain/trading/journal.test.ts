import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, ZERO } from '../money';
import {
  emptyJournalEntry,
  isEmptyJournalEntry,
  journaledTrip,
  journaledTrips,
  manualTradeToRoundTrip,
  naiveToMs,
  riskOf,
  type JournalEntry,
  type ManualTrade,
  type TradePlan,
} from './journal';
import type { RoundTrip } from './round-trips';

const manualTrade = (over: Partial<ManualTrade> = {}): ManualTrade => ({
  id: 'm1',
  accountId: 'man:trading',
  symbol: 'BTC',
  direction: 'long',
  qty: '2',
  entryPrice: '100',
  exitPrice: '110',
  openedAt: '2026-08-01T10:00:00',
  closedAt: '2026-08-01T12:00:00',
  fees: '5',
  quote: 'USD',
  ...over,
});

let seq = 0;
const trip = (over: Partial<RoundTrip> = {}): RoundTrip => {
  seq += 1;
  const openedAt = over.openedAt ?? '2026-08-01T08:00:00';
  const closedAt = over.closedAt !== undefined ? over.closedAt : '2026-08-01T09:00:00';
  return {
    id: `rt:hl:a:BTC:${seq}`,
    accountId: 'hl:a',
    market: 'perp',
    symbol: 'BTC',
    quote: 'USDC',
    direction: 'long',
    status: 'closed',
    openedAt,
    openedTime: naiveToMs(openedAt),
    closedAt,
    closedTime: closedAt === null ? null : naiveToMs(closedAt),
    executionIds: [`x${seq}`],
    qtyOpened: D('1'),
    qtyClosed: D('1'),
    qtyMax: D('1'),
    avgEntry: D('100'),
    avgExit: D('110'),
    grossPnl: D('10'),
    fees: D('0'),
    funding: D('0'),
    netPnl: D('10'),
    holdSeconds: 3_600,
    liquidated: false,
    incomplete: false,
    source: 'hyperliquid-api',
    ...over,
  };
};

describe('manualTradeToRoundTrip', () => {
  it('long clos : gross = (sortie − entrée) × qty, net = gross − frais, holdSeconds exact', () => {
    const rt = manualTradeToRoundTrip(
      manualTrade({ id: 'a', qty: '2', entryPrice: '100', exitPrice: '110', fees: '5' }),
    );
    expect(rt.id).toBe('man:a');
    expect(rt.status).toBe('closed');
    expect(rt.direction).toBe('long');
    expect(rt.grossPnl.toString()).toBe('20');
    expect(rt.netPnl.toString()).toBe('15');
    expect(rt.qtyOpened.toString()).toBe('2');
    expect(rt.qtyClosed.toString()).toBe('2');
    expect(rt.avgEntry?.toString()).toBe('100');
    expect(rt.avgExit?.toString()).toBe('110');
    expect(rt.holdSeconds).toBe(7_200);
  });

  it('short clos : le gain est inversé par rapport à un long', () => {
    const rt = manualTradeToRoundTrip(
      manualTrade({
        id: 'b',
        direction: 'short',
        qty: '2',
        entryPrice: '100',
        exitPrice: '90',
        fees: '1',
      }),
    );
    expect(rt.id).toBe('man:b');
    expect(rt.direction).toBe('short');
    expect(rt.grossPnl.toString()).toBe('20');
    expect(rt.netPnl.toString()).toBe('19');
  });

  it('trade ouvert (exitPrice null) : status open, gross et qtyClosed nuls, holdSeconds null', () => {
    const rt = manualTradeToRoundTrip(manualTrade({ id: 'c', exitPrice: null, closedAt: null }));
    expect(rt.id).toBe('man:c');
    expect(rt.status).toBe('open');
    expect(rt.grossPnl.eq(ZERO)).toBe(true);
    expect(rt.qtyClosed.eq(ZERO)).toBe(true);
    expect(rt.avgExit).toBeNull();
    expect(rt.holdSeconds).toBeNull();
  });
});

describe('riskOf', () => {
  it('risque explicite du plan prioritaire sur |entrée − stop| × taille', () => {
    const t = trip({ qtyMax: D('3') });
    const plan: TradePlan = { entry: '100', stop: '90', target: null, risk: '50' };
    expect(riskOf(t, plan)?.toString()).toBe('50');
  });

  it('à défaut de risque explicite : |entrée − stop| × qtyMax', () => {
    const t = trip({ qtyMax: D('3') });
    const plan: TradePlan = { entry: '100', stop: '95', target: null, risk: null };
    expect(riskOf(t, plan)?.toString()).toBe('15');
  });

  it('null si le plan est nul', () => {
    expect(riskOf(trip(), null)).toBeNull();
  });

  it('null si le risque explicite est ≤ 0', () => {
    const t = trip();
    expect(riskOf(t, { entry: null, stop: null, target: null, risk: '0' })).toBeNull();
    expect(riskOf(t, { entry: null, stop: null, target: null, risk: '-10' })).toBeNull();
  });

  it('null si l’entrée ou le stop du plan manquent (et aucun risque explicite)', () => {
    const t = trip();
    expect(riskOf(t, { entry: '100', stop: null, target: null, risk: null })).toBeNull();
    expect(riskOf(t, { entry: null, stop: '90', target: null, risk: null })).toBeNull();
  });
});

describe('journaledTrip', () => {
  it('R = netPnl ÷ risque, uniquement sur un trade clos avec un risque connu', () => {
    const t = trip({ status: 'closed', netPnl: D('30'), qtyMax: D('2') });
    const entry: JournalEntry = {
      ...emptyJournalEntry(t.id),
      plan: { entry: '100', stop: '95', target: null, risk: null }, // risque = |100−95| × 2 = 10
    };
    expect(journaledTrip(t, entry).r?.toString()).toBe('3');
  });

  it('R est nul sur un trade encore ouvert, même avec un risque connu', () => {
    const t = trip({ status: 'open', netPnl: D('30'), closedAt: null });
    const entry: JournalEntry = {
      ...emptyJournalEntry(t.id),
      plan: { entry: '100', stop: '95', target: null, risk: null },
    };
    expect(journaledTrip(t, entry).r).toBeNull();
  });

  it('R est nul si aucun risque n’est connu (pas de journal)', () => {
    const t = trip({ status: 'closed', netPnl: D('30') });
    expect(journaledTrip(t, null).r).toBeNull();
  });

  it('entrySlippage = (entrée réelle − entrée prévue) ÷ entrée prévue, signé', () => {
    const t = trip({ avgEntry: D('105') });
    const entry: JournalEntry = {
      ...emptyJournalEntry(t.id),
      plan: { entry: '100', stop: null, target: null, risk: null },
    };
    expect(journaledTrip(t, entry).entrySlippage?.toString()).toBe('0.05');
  });

  it('entrySlippage est nul si l’entrée réelle ou l’entrée prévue manquent', () => {
    const withoutAvgEntry = trip({ avgEntry: null });
    const planned: JournalEntry = {
      ...emptyJournalEntry(withoutAvgEntry.id),
      plan: { entry: '100', stop: null, target: null, risk: null },
    };
    expect(journaledTrip(withoutAvgEntry, planned).entrySlippage).toBeNull();

    const withAvgEntry = trip({ avgEntry: D('105') });
    expect(journaledTrip(withAvgEntry, null).entrySlippage).toBeNull();
  });
});

describe('journaledTrips', () => {
  it('fusionne trips reconstruits et manuels, triés du plus récent au plus ancien, journal rattaché par id (null sinon)', () => {
    const older = trip({ id: 'rt:a', openedAt: '2026-08-01T08:00:00' });
    const newer = trip({ id: 'rt:b', openedAt: '2026-08-05T08:00:00' });
    const manual = manualTrade({ id: 'm1', openedAt: '2026-08-10T08:00:00' });
    const journal: Record<string, JournalEntry> = {
      'rt:a': { ...emptyJournalEntry('rt:a'), thesis: 'pourquoi a' },
    };

    const result = journaledTrips([older, newer], [manual], journal);

    expect(result.map((r) => r.trip.id)).toEqual(['man:m1', 'rt:b', 'rt:a']);
    expect(result[0]!.journal).toBeNull();
    expect(result[1]!.journal).toBeNull();
    expect(result[2]!.journal?.thesis).toBe('pourquoi a');
  });
});

describe('isEmptyJournalEntry / emptyJournalEntry', () => {
  it('emptyJournalEntry est vide', () => {
    expect(isEmptyJournalEntry(emptyJournalEntry('t1'))).toBe(true);
  });

  it('un plan entièrement nul compte comme vide', () => {
    const entry: JournalEntry = {
      ...emptyJournalEntry('t1'),
      plan: { entry: null, stop: null, target: null, risk: null },
    };
    expect(isEmptyJournalEntry(entry)).toBe(true);
  });

  it('tout champ renseigné rend l’entrée non vide', () => {
    expect(isEmptyJournalEntry({ ...emptyJournalEntry('t1'), thesis: 'x' })).toBe(false);
    expect(isEmptyJournalEntry({ ...emptyJournalEntry('t1'), review: 'x' })).toBe(false);
    expect(isEmptyJournalEntry({ ...emptyJournalEntry('t1'), setup: 'Cassure' })).toBe(false);
    expect(isEmptyJournalEntry({ ...emptyJournalEntry('t1'), tags: ['a'] })).toBe(false);
    expect(isEmptyJournalEntry({ ...emptyJournalEntry('t1'), mistakes: ['a'] })).toBe(false);
    expect(isEmptyJournalEntry({ ...emptyJournalEntry('t1'), rating: 3 })).toBe(false);
    expect(
      isEmptyJournalEntry({
        ...emptyJournalEntry('t1'),
        plan: { entry: '100', stop: null, target: null, risk: null },
      }),
    ).toBe(false);
  });
});

describe('propriété', () => {
  it('netPnl = grossPnl − fees ; le signe du gross respecte la direction', () => {
    fc.assert(
      fc.property(
        fc.record({
          direction: fc.constantFrom('long', 'short'),
          qty: fc.integer({ min: 1, max: 10_000 }),
          entryPrice: fc.integer({ min: 1, max: 100_000 }),
          exitPrice: fc.integer({ min: 1, max: 100_000 }),
          fees: fc.integer({ min: 0, max: 5_000 }),
        }),
        ({ direction, qty, entryPrice, exitPrice, fees }) => {
          const rt = manualTradeToRoundTrip(
            manualTrade({
              direction: direction as 'long' | 'short',
              qty: String(qty),
              entryPrice: String(entryPrice),
              exitPrice: String(exitPrice),
              fees: String(fees),
            }),
          );
          expect(rt.netPnl.eq(rt.grossPnl.minus(rt.fees))).toBe(true);
          const priceDiff = D(String(exitPrice)).minus(String(entryPrice));
          if (priceDiff.eq(ZERO)) {
            expect(rt.grossPnl.eq(ZERO)).toBe(true);
          } else if (direction === 'long') {
            expect(rt.grossPnl.gt(ZERO)).toBe(priceDiff.gt(ZERO));
          } else {
            expect(rt.grossPnl.gt(ZERO)).toBe(priceDiff.lt(ZERO));
          }
        },
      ),
    );
  });
});
