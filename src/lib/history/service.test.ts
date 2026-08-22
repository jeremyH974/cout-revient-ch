import { beforeEach, describe, expect, it } from 'vitest';
import type { AssetCode } from '../domain/types';
import { MemoryHistoryStore } from './cache';
import { eachDay } from './days';
import {
  PEGGED_SOURCE,
  clearIntradayCache,
  fillGaps,
  loadDailyHistory,
  loadIntraday,
} from './service';
import type { DayString, HistoryProvider, PriceHistory } from './types';

const NOW = Date.UTC(2026, 7, 22, 16, 0);
const now = (): number => NOW;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Table = Record<AssetCode, Record<DayString, string>>;

interface FakeProvider {
  provider: HistoryProvider;
  calls: { asset: AssetCode; from: DayString; to: DayString }[];
  intradayCalls: number;
}

function fakeProvider(
  name: string,
  data: Table,
  options: { maxDays?: number | null; fail?: boolean } = {},
): FakeProvider {
  const fake: FakeProvider = {
    calls: [],
    intradayCalls: 0,
    provider: {
      name,
      maxDays: options.maxDays ?? null,
      supports: async (asset) => asset in data,
      async fetchDaily(asset, from, to) {
        fake.calls.push({ asset, from, to });
        if (options.fail) throw new Error('HTTP 500');
        return Object.entries(data[asset] ?? {})
          .filter(([day]) => day >= from && day <= to)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([day, priceEur]) => ({ day, priceEur }));
      },
      async fetchIntraday(asset, hours) {
        fake.intradayCalls++;
        if (options.fail) throw new Error('HTTP 500');
        if (!(asset in data)) return [];
        return [{ at: new Date(NOW - hours * HOUR).toISOString(), priceEur: '9' }];
      },
    },
  };
  return fake;
}

/** Table jour → prix constant sur une plage. */
function flat(from: DayString, to: DayString, price: string): Record<DayString, string> {
  return Object.fromEntries(eachDay(from, to).map((day) => [day, price]));
}

function cached(
  asset: AssetCode,
  table: Record<DayString, string>,
  fetchedAt: number,
  extra: Partial<PriceHistory> = {},
): PriceHistory {
  const days = Object.keys(table).sort();
  return {
    asset,
    points: days.map((day) => ({ day, priceEur: table[day]! })),
    source: 'A',
    fetchedAt: new Date(fetchedAt).toISOString(),
    from: days[0]!,
    to: days[days.length - 1]!,
    ...extra,
  };
}

describe('fillGaps', () => {
  it('reporte la dernière valeur connue avec filled: true', () => {
    const points = fillGaps([
      { day: '2026-08-21', priceEur: '4' },
      { day: '2026-08-18', priceEur: '1' },
      { day: '2026-08-19', priceEur: '2' },
    ]);
    expect(points).toEqual([
      { day: '2026-08-18', priceEur: '1' },
      { day: '2026-08-19', priceEur: '2' },
      { day: '2026-08-20', priceEur: '2', filled: true },
      { day: '2026-08-21', priceEur: '4' },
    ]);
  });
});

describe('loadDailyHistory', () => {
  it('cache vide : interroge les fournisseurs, comble les trous, écrit le cache', async () => {
    const store = new MemoryHistoryStore();
    const a = fakeProvider('A', {
      btc: { '2026-08-18': '1', '2026-08-19': '2', '2026-08-21': '4', '2026-08-22': '5' },
    });
    const result = await loadDailyHistory(['btc'], '2026-08-18', '2026-08-22', {
      store,
      providers: [a.provider],
      now,
    });
    const btc = result.histories['btc']!;
    expect(btc.points.map((p) => `${p.day}:${p.priceEur}${p.filled ? '*' : ''}`)).toEqual([
      '2026-08-18:1',
      '2026-08-19:2',
      '2026-08-20:2*',
      '2026-08-21:4',
      '2026-08-22:5',
    ]);
    expect(btc).toMatchObject({
      asset: 'btc',
      source: 'A',
      from: '2026-08-18',
      to: '2026-08-22',
      probedFrom: '2026-08-18',
      fetchedAt: new Date(NOW).toISOString(),
    });
    expect(a.calls).toEqual([{ asset: 'btc', from: '2026-08-18', to: '2026-08-22' }]);
    expect(await store.getDaily('btc')).toEqual(btc);
    expect(result.missing).toEqual([]);
    expect(result.partial).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('cache partiel : seule la queue est demandée et le frais remplace le cache', async () => {
    const store = new MemoryHistoryStore();
    await store.putDaily(
      cached('btc', flat('2026-08-18', '2026-08-20', '1'), NOW - 2 * DAY, {
        probedFrom: '2026-08-18',
      }),
    );
    const a = fakeProvider('A', { btc: flat('2026-08-18', '2026-08-22', '7') });
    const result = await loadDailyHistory(['btc'], '2026-08-18', '2026-08-22', {
      store,
      providers: [a.provider],
      now,
    });
    expect(a.calls).toEqual([{ asset: 'btc', from: '2026-08-20', to: '2026-08-22' }]);
    const prices = result.histories['btc']!.points.map((p) => p.priceEur);
    expect(prices).toEqual(['1', '1', '7', '7', '7']);
  });

  it('cache frais et complet : aucune requête, historique rendu tel quel', async () => {
    const store = new MemoryHistoryStore();
    const entry = cached('btc', flat('2026-08-18', '2026-08-22', '1'), NOW - 10 * 60_000, {
      probedFrom: '2026-08-18',
    });
    await store.putDaily(entry);
    const a = fakeProvider('A', { btc: flat('2026-08-18', '2026-08-22', '7') });
    const result = await loadDailyHistory(['btc'], '2026-08-18', '2026-08-22', {
      store,
      providers: [a.provider],
      now,
    });
    expect(a.calls).toEqual([]);
    expect(result.histories['btc']).toEqual(entry);
  });

  it('tête manquante : demandée une fois, puis mémorisée par probedFrom', async () => {
    const store = new MemoryHistoryStore();
    await store.putDaily(cached('btc', flat('2026-08-20', '2026-08-22', '1'), NOW - 10 * 60_000));
    const a = fakeProvider('A', { btc: flat('2026-08-20', '2026-08-22', '1') });
    const opts = { store, providers: [a.provider], now };
    const first = await loadDailyHistory(['btc'], '2026-08-18', '2026-08-22', opts);
    expect(a.calls).toEqual([{ asset: 'btc', from: '2026-08-18', to: '2026-08-19' }]);
    expect(first.histories['btc']).toMatchObject({ from: '2026-08-20', probedFrom: '2026-08-18' });
    expect(first.partial).toEqual(['btc']);
    await loadDailyHistory(['btc'], '2026-08-18', '2026-08-22', opts);
    expect(a.calls).toHaveLength(1);
  });

  it('priorité à l’ordre des fournisseurs, le suivant comble la tête', async () => {
    const store = new MemoryHistoryStore();
    const a = fakeProvider('A', { btc: flat('2026-08-20', '2026-08-22', '100') }, { maxDays: 3 });
    const b = fakeProvider('B', { btc: flat('2026-08-10', '2026-08-22', '1') });
    const result = await loadDailyHistory(['btc'], '2026-08-18', '2026-08-22', {
      store,
      providers: [a.provider, b.provider],
      now,
    });
    const btc = result.histories['btc']!;
    expect(btc.points.map((p) => p.priceEur)).toEqual(['1', '1', '100', '100', '100']);
    expect(btc.source).toBe('A+B');
    expect(a.calls).toEqual([{ asset: 'btc', from: '2026-08-20', to: '2026-08-22' }]);
    expect(b.calls).toEqual([{ asset: 'btc', from: '2026-08-18', to: '2026-08-19' }]);
  });

  it('fournisseur en échec : erreur consignée, suivant utilisé, tête non mémorisée', async () => {
    const store = new MemoryHistoryStore();
    const a = fakeProvider('A', { btc: {} }, { fail: true });
    const b = fakeProvider('B', { btc: flat('2026-08-18', '2026-08-22', '1') });
    const result = await loadDailyHistory(['btc'], '2026-08-18', '2026-08-22', {
      store,
      providers: [a.provider, b.provider],
      now,
    });
    expect(result.errors).toEqual(['A (btc) : HTTP 500']);
    expect(result.histories['btc']).toMatchObject({ source: 'B', from: '2026-08-18' });
    expect(result.histories['btc']!.probedFrom).toBeUndefined();
  });

  it('actif inconnu partout : listé manquant, sondage mémorisé', async () => {
    const store = new MemoryHistoryStore();
    const a = fakeProvider('A', { btc: flat('2026-08-18', '2026-08-22', '1') });
    const opts = { store, providers: [a.provider], now };
    const result = await loadDailyHistory(['zzz', 'btc'], '2026-08-18', '2026-08-22', opts);
    expect(result.missing).toEqual(['zzz']);
    expect(result.histories['zzz']).toBeUndefined();
    expect(await store.getDaily('zzz')).toMatchObject({ points: [], probedFrom: '2026-08-18' });
    expect(a.calls.filter((c) => c.asset === 'zzz')).toEqual([]);
    const again = await loadDailyHistory(['zzz'], '2026-08-18', '2026-08-22', opts);
    expect(again.missing).toEqual(['zzz']);
    expect(a.calls).toHaveLength(1);
  });

  it('parité euro : 1 € par jour sans requête ni cache', async () => {
    const store = new MemoryHistoryStore();
    const a = fakeProvider('A', {});
    const result = await loadDailyHistory(['eurcv', 'eur'], '2026-08-20', '2026-08-22', {
      store,
      providers: [a.provider],
      now,
    });
    expect(result.histories['eurcv']).toMatchObject({ source: PEGGED_SOURCE });
    expect(result.histories['eur']!.points.map((p) => p.priceEur)).toEqual(['1', '1', '1']);
    expect(a.calls).toEqual([]);
    expect(store.assets()).toEqual([]);
  });

  it('maxDays borne la demande, progression par actif, doublons ignorés', async () => {
    const store = new MemoryHistoryStore();
    const a = fakeProvider('A', { btc: flat('2026-08-01', '2026-08-22', '1') }, { maxDays: 3 });
    const progress: string[] = [];
    await loadDailyHistory(['btc', 'btc'], '2026-08-10', '2026-08-22', {
      store,
      providers: [a.provider],
      now,
      onProgress: (p) => progress.push(`${p.asset} ${p.done}/${p.total}`),
    });
    expect(a.calls).toEqual([{ asset: 'btc', from: '2026-08-20', to: '2026-08-22' }]);
    expect(progress).toEqual(['btc 1/1']);
  });

  it('lecture du cache en échec : erreur notée, fournisseurs quand même interrogés', async () => {
    const store = new MemoryHistoryStore();
    store.getDaily = async () => {
      throw new Error('quota');
    };
    const a = fakeProvider('A', { btc: flat('2026-08-20', '2026-08-22', '1') });
    const result = await loadDailyHistory(['btc'], '2026-08-20', '2026-08-22', {
      store,
      providers: [a.provider],
      now,
    });
    expect(result.errors).toEqual(['cache (btc) : quota']);
    expect(result.histories['btc']!.points).toHaveLength(3);
  });

  it('annulation : rejette ; période inversée : RangeError', async () => {
    const store = new MemoryHistoryStore();
    const a = fakeProvider('A', { btc: flat('2026-08-20', '2026-08-22', '1') });
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadDailyHistory(['btc'], '2026-08-20', '2026-08-22', {
        store,
        providers: [a.provider],
        now,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      loadDailyHistory(['btc'], '2026-08-22', '2026-08-20', { store, providers: [], now }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe('loadIntraday', () => {
  beforeEach(() => clearIntradayCache());

  it('premier fournisseur qui répond, cache mémoire 10 min', async () => {
    const a = fakeProvider('A', {}, { fail: true });
    const b = fakeProvider('B', { btc: {} });
    let clock = NOW;
    const opts = { providers: [a.provider, b.provider], now: () => clock };
    const first = await loadIntraday('btc', 24, opts);
    expect(first).toMatchObject({ source: 'B', cached: false, errors: ['A (btc) : HTTP 500'] });
    expect(first.points).toHaveLength(1);
    clock += 9 * 60_000;
    const second = await loadIntraday('btc', 24, opts);
    expect(second.cached).toBe(true);
    expect(b.intradayCalls).toBe(1);
    clock += 2 * 60_000;
    await loadIntraday('btc', 24, opts);
    expect(b.intradayCalls).toBe(2);
  });

  it('actif inconnu : vide et non mis en cache ; parité euro sans requête', async () => {
    const b = fakeProvider('B', { btc: {} });
    const opts = { providers: [b.provider], now };
    expect(await loadIntraday('zzz', 24, opts)).toMatchObject({ points: [], source: null });
    expect((await loadIntraday('zzz', 24, opts)).cached).toBe(false);
    const pegged = await loadIntraday('eurc', 24, opts);
    expect(pegged.source).toBe(PEGGED_SOURCE);
    expect(pegged.points.map((p) => p.priceEur)).toEqual(['1', '1']);
    expect(b.intradayCalls).toBe(2);
  });
});
