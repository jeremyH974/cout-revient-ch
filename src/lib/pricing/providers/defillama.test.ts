import Big from 'big.js';
import { describe, expect, it } from 'vitest';
import type { AssetCode } from '../../domain/types';
import type { FetchLike } from '../../history/types';
import type { UsdToEur } from '../types';
import { defillamaProvider } from './defillama';

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

// Taux de conversion de test : division par 1,25 (cohérent avec la config big.js du projet).
const usdToEur: UsdToEur = (priceUsd) => new Big(priceUsd).div('1.25').toString();

const idOverrides: Record<AssetCode, string | null> = {
  foo: 'foo-id',
  bar: 'bar-id',
  zero: 'zero-id',
  neg: 'neg-id',
  lowconf: 'lowconf-id',
  noconf: 'noconf-id',
  missing: 'missing-id',
};

const coins = {
  'coingecko:foo-id': { price: 100, symbol: 'FOO', timestamp: 1787495680, confidence: 0.99 },
  'coingecko:bar-id': { price: 50.5, symbol: 'BAR', confidence: 0.85 }, // pas de timestamp
  'coingecko:zero-id': { price: 0, confidence: 0.9 }, // ≤ 0 : ignoré
  'coingecko:neg-id': { price: -5, confidence: 0.9 }, // négatif : ignoré
  'coingecko:lowconf-id': { price: 10, confidence: 0.5 }, // confiance < 0,8 : ignoré
  'coingecko:noconf-id': { price: 20 }, // pas de confidence : accepté
  // 'coingecko:missing-id' absent de la réponse : ignoré
};

const signal = new AbortController().signal;

function baseRoute(): Route {
  return (url) =>
    url.startsWith('https://coins.llama.fi/prices/current/') ? { body: { coins } } : undefined;
}

describe('defillamaProvider', () => {
  it('nom du fournisseur', () => {
    expect(defillamaProvider({ usdToEur }).name).toBe('DefiLlama');
  });

  it('lit le prix USD, convertit en EUR, dérive `at` du timestamp quand présent', async () => {
    const { calls, fetch } = fakeFetch(baseRoute());
    const provider = defillamaProvider({ usdToEur, idOverrides, fetch });
    const found = await provider.fetchPrices(['foo', 'bar'], signal);
    expect(found.get('foo')).toMatchObject({
      asset: 'foo',
      priceEur: new Big('100').div('1.25').toString(),
      source: 'DefiLlama',
      stale: false,
      at: new Date(1787495680 * 1000).toISOString(),
    });
    const bar = found.get('bar');
    expect(bar).toMatchObject({ asset: 'bar', priceEur: new Big('50.5').div('1.25').toString() });
    expect(Date.now() - Date.parse(bar!.at)).toBeLessThan(5000); // pas de timestamp → nowIso()
    expect(calls[0]).toContain('searchWidth=4h');
  });

  it('résout l’id via la table TICKERS quand aucune surcharge n’est fournie', async () => {
    const { fetch } = fakeFetch((url) =>
      url.includes('coingecko:bitcoin')
        ? { body: { coins: { 'coingecko:bitcoin': { price: 77419.25, confidence: 0.99 } } } }
        : undefined,
    );
    const provider = defillamaProvider({ usdToEur, fetch });
    const found = await provider.fetchPrices(['btc'], signal);
    expect(found.get('btc')).toMatchObject({
      priceEur: new Big('77419.25').div('1.25').toString(),
    });
  });

  it('actif sans id CoinGecko ignoré (aucune requête si rien à demander)', async () => {
    const { calls, fetch } = fakeFetch(baseRoute());
    const provider = defillamaProvider({ usdToEur, idOverrides: { eurcv: null }, fetch });
    const found = await provider.fetchPrices(['eurcv'], signal);
    expect(found.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('prix ≤ 0, confiance < 0,8 et identifiant sans donnée sont ignorés', async () => {
    const { fetch } = fakeFetch(baseRoute());
    const provider = defillamaProvider({ usdToEur, idOverrides, fetch });
    const found = await provider.fetchPrices(['zero', 'neg', 'lowconf', 'missing'], signal);
    expect(found.size).toBe(0);
  });

  it('confiance absente : acceptée', async () => {
    const { fetch } = fakeFetch(baseRoute());
    const provider = defillamaProvider({ usdToEur, idOverrides, fetch });
    const found = await provider.fetchPrices(['noconf'], signal);
    expect(found.get('noconf')).toMatchObject({ priceEur: new Big('20').div('1.25').toString() });
  });

  it('erreur HTTP → rejet', async () => {
    const { fetch } = fakeFetch(() => ({ status: 500, body: {} }));
    const provider = defillamaProvider({ usdToEur, idOverrides, fetch });
    await expect(provider.fetchPrices(['foo'], signal)).rejects.toThrow('DefiLlama HTTP 500');
  });

  it('découpe les requêtes par lots de 50 identifiants', async () => {
    const codes = Array.from({ length: 55 }, (_, i) => `c${i}`);
    const overrides: Record<AssetCode, string | null> = {};
    const manyCoins: Record<string, { price: number; confidence: number }> = {};
    for (const code of codes) {
      overrides[code] = `${code}-id`;
      manyCoins[`coingecko:${code}-id`] = { price: 1, confidence: 0.9 };
    }
    const { calls, fetch } = fakeFetch((url) =>
      url.startsWith('https://coins.llama.fi/prices/current/')
        ? { body: { coins: manyCoins } }
        : undefined,
    );
    const provider = defillamaProvider({ usdToEur, idOverrides: overrides, fetch });
    const found = await provider.fetchPrices(codes, signal);
    expect(found.size).toBe(55);
    expect(calls).toHaveLength(2);
  });
});
