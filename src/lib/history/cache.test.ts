import { describe, expect, it } from 'vitest';
import {
  MemoryHistoryStore,
  createHistoryStore,
  isIndexedDbAvailable,
  isPriceHistory,
} from './cache';
import type { PriceHistory } from './types';

const history: PriceHistory = {
  asset: 'btc',
  points: [
    { day: '2026-08-21', priceEur: '60000' },
    { day: '2026-08-22', priceEur: '61000' },
  ],
  source: 'Kraken',
  fetchedAt: '2026-08-22T10:00:00.000Z',
  from: '2026-08-21',
  to: '2026-08-22',
  probedFrom: '2026-08-01',
};

describe('MemoryHistoryStore', () => {
  it('stocke des copies indépendantes et se vide', async () => {
    const store = new MemoryHistoryStore();
    expect(await store.getDaily('btc')).toBeNull();
    await store.putDaily(history);
    const read = await store.getDaily('btc');
    expect(read).toEqual(history);
    expect(read).not.toBe(history);
    read!.points.push({ day: '2026-08-23', priceEur: '1' });
    expect((await store.getDaily('btc'))!.points).toHaveLength(2);
    expect(store.assets()).toEqual(['btc']);

    await store.putMeta('lastLoadAt', { at: 1 });
    expect(await store.getMeta('lastLoadAt')).toEqual({ at: 1 });
    expect(await store.getMeta('absent')).toBeUndefined();

    await store.clear();
    expect(await store.getDaily('btc')).toBeNull();
    expect(await store.getMeta('lastLoadAt')).toBeUndefined();
  });

  it('isPriceHistory rejette les entrées corrompues', () => {
    expect(isPriceHistory(history)).toBe(true);
    expect(isPriceHistory(null)).toBe(false);
    expect(isPriceHistory({ asset: 'btc' })).toBe(false);
    expect(isPriceHistory({ ...history, points: 'x' })).toBe(false);
  });

  it('createHistoryStore retombe sur la mémoire sans IndexedDB (Node)', () => {
    expect(isIndexedDbAvailable()).toBe(false);
    expect(createHistoryStore()).toBeInstanceOf(MemoryHistoryStore);
  });
});
