/**
 * L'éviction, et surtout son garde-fou (décision n° 88).
 */
import { describe, expect, it } from 'vitest';
import { MemoryHistoryStore } from './cache';
import { assetsToEvict, pruneHistory } from './evict';
import type { PriceHistory } from './types';

const history = (asset: string): PriceHistory => ({
  asset,
  points: [{ day: '2026-01-01', priceEur: '100' }],
  source: 'test',
  fetchedAt: '2026-01-01T10:00:00Z',
  from: '2026-01-01',
  to: '2026-01-01',
});

describe('éviction du cache d’historique', () => {
  it('oublie ce qui n’est plus suivi, garde le reste', () => {
    expect(assetsToEvict(['btc', 'eth', 'doge'], ['btc', 'eth'])).toEqual(['doge']);
  });

  it('ne touche à rien quand tout est encore suivi', () => {
    expect(assetsToEvict(['btc', 'eth'], ['btc', 'eth', 'sol'])).toEqual([]);
  });

  /**
   * Le test qui justifie la fonction. Sans ce garde-fou, la purge tournerait au démarrage — avant
   * que le rapport ne soit calculé, donc avec une liste suivie vide — et effacerait TOUT.
   */
  it('une liste suivie vide ne prouve rien : on n’évince rien', () => {
    expect(assetsToEvict(['btc', 'eth'], []), 'purge au démarrage = perte totale').toEqual([]);
  });

  it('purge réellement le magasin, et rend ce qu’elle a oublié', async () => {
    const store = new MemoryHistoryStore();
    for (const asset of ['btc', 'eth', 'doge']) await store.putDaily(history(asset));
    expect(await pruneHistory(store, ['btc'])).toEqual(['eth', 'doge']);
    expect(await store.cachedAssets()).toEqual(['btc']);
    expect(await store.getDaily('eth')).toBeNull();
  });

  it('un magasin en panne ne fait pas échouer l’affichage', async () => {
    const broken = {
      cachedAssets: () => Promise.reject(new Error('indexedDB indisponible')),
    } as unknown as MemoryHistoryStore;
    await expect(pruneHistory(broken, ['btc'])).resolves.toEqual([]);
  });
});
