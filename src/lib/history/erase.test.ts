/**
 * L'effacement du cache, et son silence délibéré (décision n° 88).
 */
import { describe, expect, it } from 'vitest';
import { MemoryHistoryStore } from './cache';
import { eraseHistoryCache } from './erase';
import type { HistoryStore, PriceHistory } from './types';

const history = (asset: string): PriceHistory => ({
  asset,
  points: [{ day: '2026-01-01', priceEur: '100' }],
  source: 'test',
  fetchedAt: '2026-01-01T10:00:00Z',
  from: '2026-01-01',
  to: '2026-01-01',
});

describe('effacement du cache d’historique', () => {
  it('vide le magasin et le dit', async () => {
    const store = new MemoryHistoryStore();
    await store.putDaily(history('btc'));
    await store.putMeta('k', 1);
    expect(await eraseHistoryCache(store)).toBe(true);
    expect(await store.cachedAssets()).toEqual([]);
    expect(await store.getMeta('k')).toBeUndefined();
  });

  /**
   * Le silence est le point de conception : l'effacement des données principales a déjà eu lieu
   * quand on arrive ici. Lever ferait croire à l'utilisateur que rien n'a été effacé, alors que
   * l'essentiel l'a été — et ce qui reste n'est qu'un cache, qui se reconstruit.
   */
  it('un magasin en panne rend `false` plutôt que de lever', async () => {
    const broken = { clear: () => Promise.reject(new Error('quota')) } as unknown as HistoryStore;
    await expect(eraseHistoryCache(broken)).resolves.toBe(false);
  });
});
