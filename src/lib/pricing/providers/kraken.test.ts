import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../../history/types';
import { krakenTickerProvider } from './kraken';

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
    XXBTZEUR: { altname: 'XBTEUR', quote: 'ZEUR' },
    XETHZEUR: { altname: 'ETHEUR', quote: 'ZEUR' },
  },
};

const signal = new AbortController().signal;

describe('krakenTickerProvider', () => {
  it('lit le dernier cours EUR de chaque paire connue', async () => {
    const { fetch } = fakeFetch((url) => {
      if (url.endsWith('/AssetPairs')) return { body: assetPairs };
      if (url.includes('/Ticker') && url.includes('pair=XBTEUR,ETHEUR')) {
        return {
          body: {
            error: [],
            result: {
              XXBTZEUR: { c: ['61250.5', '0.001'] },
              XETHZEUR: { c: ['3200.25', '0.01'] },
            },
          },
        };
      }
      return undefined;
    });
    const provider = krakenTickerProvider({ fetch });
    expect(provider.name).toBe('Kraken');
    const found = await provider.fetchPrices(['btc', 'eth'], signal);
    expect(found.get('btc')).toMatchObject({
      asset: 'btc',
      priceEur: '61250.5',
      source: 'Kraken',
      stale: false,
    });
    expect(found.get('eth')).toMatchObject({
      asset: 'eth',
      priceEur: '3200.25',
      source: 'Kraken',
      stale: false,
    });
    expect(typeof found.get('btc')!.at).toBe('string');
    expect(() => new Date(found.get('btc')!.at).toISOString()).not.toThrow();
  });

  it('ignore les actifs sans paire EUR connue (non demandés à Ticker)', async () => {
    const { calls, fetch } = fakeFetch((url) => {
      if (url.endsWith('/AssetPairs')) return { body: assetPairs };
      if (url.includes('/Ticker')) {
        return { body: { error: [], result: { XXBTZEUR: { c: ['61250.5', '0'] } } } };
      }
      return undefined;
    });
    const provider = krakenTickerProvider({ fetch });
    const found = await provider.fetchPrices(['btc', 'zzz'], signal);
    expect(found.has('zzz')).toBe(false);
    expect(found.has('btc')).toBe(true);
    const tickerUrl = calls.find((url) => url.includes('/Ticker'));
    expect(tickerUrl).toContain('pair=XBTEUR');
    expect(tickerUrl).not.toContain('ZZZ');
  });

  it('aucune paire connue : pas de requête Ticker', async () => {
    const { calls, fetch } = fakeFetch((url) =>
      url.endsWith('/AssetPairs') ? { body: assetPairs } : undefined,
    );
    const provider = krakenTickerProvider({ fetch });
    const found = await provider.fetchPrices(['zzz'], signal);
    expect(found.size).toBe(0);
    expect(calls.filter((url) => url.includes('/Ticker'))).toHaveLength(0);
  });

  it('valeurs invalides ou non positives ignorées', async () => {
    const { fetch } = fakeFetch((url) => {
      if (url.endsWith('/AssetPairs')) return { body: assetPairs };
      if (url.includes('/Ticker')) {
        return {
          body: {
            error: [],
            result: {
              XXBTZEUR: { c: ['-100', '0'] }, // négatif
              XETHZEUR: { c: ['abc', '0'] }, // invalide
            },
          },
        };
      }
      return undefined;
    });
    const provider = krakenTickerProvider({ fetch });
    const found = await provider.fetchPrices(['btc', 'eth'], signal);
    expect(found.size).toBe(0);
  });

  it('erreur Kraken (en bande) → rejet', async () => {
    const { fetch } = fakeFetch((url) => {
      if (url.endsWith('/AssetPairs')) return { body: assetPairs };
      if (url.includes('/Ticker')) return { body: { error: ['EGeneral:Invalid arguments'] } };
      return undefined;
    });
    const provider = krakenTickerProvider({ fetch });
    await expect(provider.fetchPrices(['btc'], signal)).rejects.toThrow(
      'Kraken : EGeneral:Invalid arguments',
    );
  });

  it('erreur HTTP sur Ticker → rejet', async () => {
    const { fetch } = fakeFetch((url) => {
      if (url.endsWith('/AssetPairs')) return { body: assetPairs };
      if (url.includes('/Ticker')) return { status: 400, body: {} };
      return undefined;
    });
    const provider = krakenTickerProvider({ fetch });
    await expect(provider.fetchPrices(['btc'], signal)).rejects.toThrow('Kraken HTTP 400');
  });

  it('découpe les requêtes Ticker par lots de 20 paires', async () => {
    const codes = Array.from({ length: 25 }, (_, i) => `c${i}`);
    const pairsResult: Record<string, unknown> = {};
    const tickerResult: Record<string, unknown> = {};
    for (const code of codes) {
      const altname = `${code.toUpperCase()}EUR`;
      const key = `X${altname}`;
      pairsResult[key] = { altname, quote: 'ZEUR' };
      tickerResult[key] = { c: ['10', '0'] };
    }
    const { calls, fetch } = fakeFetch((url) => {
      if (url.endsWith('/AssetPairs')) return { body: { error: [], result: pairsResult } };
      if (url.includes('/Ticker')) return { body: { error: [], result: tickerResult } };
      return undefined;
    });
    const provider = krakenTickerProvider({ fetch });
    const found = await provider.fetchPrices(codes, signal);
    expect(found.size).toBe(25);
    expect(calls.filter((url) => url.includes('/Ticker'))).toHaveLength(2);
  }, 10_000);
});
