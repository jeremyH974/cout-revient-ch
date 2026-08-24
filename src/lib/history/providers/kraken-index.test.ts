import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../types';
import { krakenEurPairIndex } from './kraken';

type Route = (url: string) => { status?: number; body?: unknown } | undefined;

function fakeFetch(route: Route): { calls: string[]; fetch: FetchLike } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const hit = route(url);
    const status = hit?.status ?? (hit ? 200 : 404);
    const body = hit ? (hit.body ?? null) : { message: 'NotFound' };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetch };
}

const assetPairs = {
  error: [],
  result: {
    XXBTZEUR: { altname: 'XBTEUR', wsname: 'XBT/EUR', base: 'XXBT', quote: 'ZEUR' },
    XETHZEUR: { altname: 'ETHEUR', wsname: 'ETH/EUR', base: 'XETH', quote: 'ZEUR' },
    XDGEUR: { altname: 'XDGEUR', wsname: 'XDG/EUR', base: 'XXDG', quote: 'ZEUR' },
    SOLUSD: { altname: 'SOLUSD', quote: 'ZUSD' },
  },
};

const signal = new AbortController().signal;

describe('krakenEurPairIndex', () => {
  it('construit altname → clé de résultat, ne garde que les paires cotées en EUR', async () => {
    const { fetch } = fakeFetch((url) =>
      url.endsWith('/AssetPairs') ? { body: assetPairs } : undefined,
    );
    const index = await krakenEurPairIndex(fetch, signal);
    expect(index.get('XBTEUR')).toBe('XXBTZEUR');
    expect(index.get('ETHEUR')).toBe('XETHZEUR');
    expect(index.get('XDGEUR')).toBe('XDGEUR');
    expect(index.has('SOLUSD')).toBe(false);
    expect(index.size).toBe(3);
  });

  it('mémoïse par identité de fetchLike : un seul appel réseau pour plusieurs invocations', async () => {
    const { calls, fetch } = fakeFetch((url) =>
      url.endsWith('/AssetPairs') ? { body: assetPairs } : undefined,
    );
    const [first, second] = await Promise.all([
      krakenEurPairIndex(fetch, signal),
      krakenEurPairIndex(fetch, signal),
    ]);
    expect(first).toBe(second); // même promesse mémoïsée
    await krakenEurPairIndex(fetch, signal);
    expect(calls).toHaveLength(1);
  });

  it('deux fetchLike distincts ont des caches isolés', async () => {
    const a = fakeFetch((url) => (url.endsWith('/AssetPairs') ? { body: assetPairs } : undefined));
    const b = fakeFetch((url) => (url.endsWith('/AssetPairs') ? { body: assetPairs } : undefined));
    await krakenEurPairIndex(a.fetch, signal);
    await krakenEurPairIndex(b.fetch, signal);
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
  });

  it('erreur Kraken → rejet, le cache est vidé pour permettre un nouvel essai', async () => {
    let attempt = 0;
    const { calls, fetch } = fakeFetch((url) => {
      if (!url.endsWith('/AssetPairs')) return undefined;
      attempt++;
      return attempt === 1 ? { body: { error: ['EService:Unavailable'] } } : { body: assetPairs };
    });
    await expect(krakenEurPairIndex(fetch, signal)).rejects.toThrow(
      'Kraken : EService:Unavailable',
    );
    const index = await krakenEurPairIndex(fetch, signal);
    expect(index.get('XBTEUR')).toBe('XXBTZEUR');
    expect(calls).toHaveLength(2);
  });

  it('erreur HTTP → rejet', async () => {
    const { fetch } = fakeFetch(() => ({ status: 500, body: {} }));
    await expect(krakenEurPairIndex(fetch, signal)).rejects.toThrow('Kraken HTTP 500');
  });
});
