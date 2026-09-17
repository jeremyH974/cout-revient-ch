import { describe, expect, it } from 'vitest';
import type { Candle } from '../../domain/trading/equity-path';
import {
  CANDLE_DEPTH,
  CANDLE_INTERVALS,
  CandleCache,
  MAX_DETAIL_SAMPLES,
  candleFetcher,
  liveCandleFloor,
  loadPriceBook,
  needsReplan,
  parseCandles,
  planDetail,
  type CandleFetcher,
  type CandleInterval,
  type DetailPlan,
} from './candles';
import type { HlClient } from './client';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 10);
const anyAge = (): number => Number.NEGATIVE_INFINITY;
const interval = (id: string): CandleInterval => CANDLE_INTERVALS.find((i) => i.id === id)!;

describe('planDetail — la fenêtre à reconstituer et le pas de ses bougies', () => {
  const extent = { from: T0 - 30 * DAY, to: T0 };

  it('la vue plus sa marge, bornée à la série ; le pas le plus fin qui tienne en points', () => {
    const view = { from: T0 - 10 * HOUR, to: T0 - 2 * HOUR };
    const plan = planDetail(view, extent, [T0 - 5 * HOUR], anyAge)!;
    expect([plan.from, plan.to]).toEqual([T0 - 10.8 * HOUR, T0 - 1.2 * HOUR]);
    expect(plan.interval.id).toBe('1m');

    const edge = planDetail({ from: T0 - HOUR, to: T0 }, extent, [T0], anyAge)!;
    expect(edge.to).toBe(T0);

    const week = planDetail({ from: T0 - 7 * DAY, to: T0 }, extent, [T0], anyAge)!;
    // 7,7 jours : 11 088 bougies d'une minute, 3 696 de 3, 2 218 de 5 — 740 de 15 minutes.
    expect(week.interval.id).toBe('15m');
    expect((week.to - week.from) / week.interval.ms).toBeLessThanOrEqual(MAX_DETAIL_SAMPLES);
  });

  it('une fenêtre trop ancienne pour un pas passe au pas suivant que l’API sert encore', () => {
    const now = T0 + 5 * DAY;
    const view = { from: T0 - 10 * HOUR, to: T0 - 2 * HOUR };
    // 3,5 jours de bougies d'une minute : la vue, vieille de plus de cinq jours, n'y est plus.
    const plan = planDetail(view, extent, [T0 - 5 * HOUR], liveCandleFloor(now))!;
    expect(plan.interval.id).toBe('3m');
    expect(liveCandleFloor(now)(MIN)).toBe(now - CANDLE_DEPTH * MIN);
    expect(planDetail(view, extent, [T0 - 5 * HOUR], () => Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('sans point de la plateforme dans la vue, elle s’étend jusqu’au plus proche', () => {
    const view = { from: T0 - 10 * HOUR, to: T0 - 9 * HOUR };
    const before = planDetail(view, extent, [T0 - 12 * HOUR, T0 - 2 * HOUR], anyAge)!;
    expect([before.from, before.to]).toEqual([T0 - 12 * HOUR, T0 - 8.9 * HOUR]);
    const after = planDetail(view, extent, [T0 - 20 * HOUR, T0 - 8 * HOUR], anyAge)!;
    expect([after.from, after.to]).toEqual([T0 - 10.1 * HOUR, T0 - 8 * HOUR]);
    const onlyAfter = planDetail(view, extent, [T0 - 3 * HOUR], anyAge)!;
    expect(onlyAfter.to).toBe(T0 - 3 * HOUR);
    // Un point hors de la série ne compte pas.
    expect(planDetail(view, extent, [T0 + HOUR], anyAge)).toBeNull();
    expect(planDetail(view, extent, [], anyAge)).toBeNull();
  });

  it('une vue vide ou une série sans durée ne donnent rien', () => {
    expect(planDetail({ from: T0, to: T0 }, extent, [T0], anyAge)).toBeNull();
    expect(planDetail({ from: T0 - HOUR, to: T0 }, { from: T0, to: T0 }, [T0], anyAge)).toBeNull();
  });
});

describe('needsReplan — recharger seulement quand c’est utile', () => {
  const plan = (from: number, to: number, id = '1m'): DetailPlan => ({
    from,
    to,
    interval: interval(id),
  });

  it('rien à charger, première charge, vue sortie, pas changé', () => {
    expect(needsReplan(plan(0, 10), null)).toBe(false);
    expect(needsReplan(null, plan(0, 10))).toBe(true);
    expect(needsReplan(plan(0, 10), plan(2, 8))).toBe(false);
    expect(needsReplan(plan(0, 10), plan(-1, 8))).toBe(true);
    expect(needsReplan(plan(0, 10), plan(2, 11))).toBe(true);
    expect(needsReplan(plan(0, 10), plan(2, 8, '5m'))).toBe(true);
  });
});

describe('parseCandles — garde runtime de candleSnapshot', () => {
  it('garde les bougies complètes, accepte les nombres, trie par ouverture', () => {
    expect(parseCandles(null)).toEqual([]);
    expect(
      parseCandles([
        { t: 120_000, o: '2', h: '3', l: '1', c: '2.5', v: '9' },
        { t: 60_000, o: 1, h: 2, l: 0.5, c: 1.5 },
        { t: 'x', o: '1', h: '1', l: '1', c: '1' },
        { t: 180_000, o: '1', h: '1', l: '1' },
        null,
      ]),
    ).toEqual([
      { t: 60_000, o: '1', h: '2', l: '0.5', c: '1.5' },
      { t: 120_000, o: '2', h: '3', l: '1', c: '2.5' },
    ]);
  });

  it('la requête ne porte qu’un marché, un pas et deux instants', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client: HlClient = {
      info: (body) => {
        bodies.push(body);
        return Promise.resolve([{ t: 0, o: '1', h: '1', l: '1', c: '1' }]);
      },
      spotMeta: () => Promise.reject(new Error('inutile')),
    };
    const candles = await candleFetcher(client)('BTC', interval('15m'), 10, 20);
    expect(candles).toHaveLength(1);
    expect(bodies).toEqual([
      { type: 'candleSnapshot', req: { coin: 'BTC', interval: '15m', startTime: 10, endTime: 20 } },
    ]);
  });
});

describe('loadPriceBook — les cours d’une fenêtre, par marché du moteur', () => {
  it('un perp et un jeton spot du même nom restent deux marchés ; un jeton sans paire est laissé', async () => {
    const asked: string[] = [];
    const fetcher: CandleFetcher = (coin, _interval, from) => {
      asked.push(coin);
      return Promise.resolve([{ t: from, o: coin, h: '1', l: '1', c: '1' }]);
    };
    const plan: DetailPlan = { from: T0, to: T0 + HOUR, interval: interval('1h') };
    const book = await loadPriceBook(
      new CandleCache(),
      fetcher,
      { perps: ['HYPE'], tokens: ['HYPE', 'USDT0'] },
      plan,
      (token) => (token === 'HYPE' ? '@107' : null),
      T0 + DAY,
    );
    expect(Object.keys(book).sort()).toEqual(['perp:HYPE', 'spot:HYPE']);
    expect(book['perp:HYPE']!.candles[0]!.o).toBe('HYPE');
    expect(book['spot:HYPE']!.candles[0]!.o).toBe('@107');
    expect(asked).toEqual(['HYPE', '@107']);
  });
});

describe('CandleCache — ce qui est clos ne se redemande pas', () => {
  function recorder(): { fetcher: CandleFetcher; calls: [string, number, number][] } {
    const calls: [string, number, number][] = [];
    const fetcher: CandleFetcher = (coin, step, from, to) => {
      calls.push([coin, from, to]);
      const candles: Candle[] = [];
      for (let t = from; t <= to; t += step.ms) candles.push({ t, o: '1', h: '1', l: '1', c: '1' });
      return Promise.resolve(candles);
    };
    return { fetcher, calls };
  }
  const minute = interval('1m');

  it('une plage couverte sert le cache, alignée sur le pas et triée', async () => {
    const { fetcher, calls } = recorder();
    const cache = new CandleCache();
    const now = T0 + DAY;
    const first = await cache.series(
      fetcher,
      'BTC',
      minute,
      { from: T0 + 30_000, to: T0 + 10 * MIN },
      now,
    );
    expect(first.intervalMs).toBe(MIN);
    expect(first.candles.map((c) => c.t)).toEqual(
      Array.from({ length: 11 }, (_, k) => T0 + k * MIN),
    );
    const inner = await cache.series(
      fetcher,
      'BTC',
      minute,
      { from: T0 + 2 * MIN, to: T0 + 5 * MIN },
      now,
    );
    expect(inner.candles).toHaveLength(4);
    expect(calls).toEqual([['BTC', T0, T0 + 10 * MIN]]);
    // Un autre marché, un autre pas : leurs propres requêtes.
    await cache.series(fetcher, 'ETH', minute, { from: T0, to: T0 + MIN }, now);
    await cache.series(fetcher, 'BTC', interval('5m'), { from: T0, to: T0 + 10 * MIN }, now);
    expect(calls).toHaveLength(3);
  });

  it('une plage qui déborde recharge ; deux plages contiguës se fusionnent', async () => {
    const { fetcher, calls } = recorder();
    const cache = new CandleCache();
    const now = T0 + DAY;
    await cache.series(fetcher, 'BTC', minute, { from: T0, to: T0 + 10 * MIN }, now);
    await cache.series(fetcher, 'BTC', minute, { from: T0 + 11 * MIN, to: T0 + 20 * MIN }, now);
    const merged = await cache.series(fetcher, 'BTC', minute, { from: T0, to: T0 + 20 * MIN }, now);
    expect(merged.candles).toHaveLength(21);
    expect(calls).toHaveLength(2);
  });

  it('la bougie en cours n’est jamais tenue pour acquise', async () => {
    const { fetcher, calls } = recorder();
    const cache = new CandleCache();
    const now = T0 + 10 * MIN + 30_000;
    await cache.series(fetcher, 'BTC', minute, { from: T0, to: T0 + 10 * MIN }, now);
    await cache.series(fetcher, 'BTC', minute, { from: T0, to: T0 + 10 * MIN }, now);
    expect(calls).toHaveLength(2);
    // Plus tôt dans la même plage : les bougies closes, elles, restent servies.
    await cache.series(fetcher, 'BTC', minute, { from: T0, to: T0 + 8 * MIN }, now);
    expect(calls).toHaveLength(2);
    // Rien de clos du tout : rien de couvert, et pas d'erreur.
    await cache.series(fetcher, 'SOL', minute, { from: now, to: now }, now);
    await cache.series(fetcher, 'SOL', minute, { from: now, to: now }, now);
    expect(calls).toHaveLength(4);
  });
});
