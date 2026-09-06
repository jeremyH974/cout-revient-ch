import { describe, expect, it } from 'vitest';
import { equityCode } from '../../domain/assets';
import type { FetchLike } from '../../history/types';
import { twelveDataProvider } from './twelvedata';

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

const signal = new AbortController().signal;
const usdToEur = (usd: string): string => String(Number(usd) * 0.9);
const aapl = equityCode('AAPL');
const iwda = equityCode('IWDA');

describe('Twelve Data', () => {
  it('sans clé, ne contacte rien et laisse les actifs aux suivants', async () => {
    const { calls, fetch } = fakeFetch(() => ({ body: {} }));
    const provider = twelveDataProvider({ apiKey: null, usdToEur, fetch });
    const found = await provider.fetchPrices([aapl], signal);
    expect(found.size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('ne demande que des titres : une crypto homonyme ne part jamais dans la requête', async () => {
    const { calls, fetch } = fakeFetch(() => ({
      body: { AAPL: { close: '10', currency: 'USD' } },
    }));
    const provider = twelveDataProvider({ apiKey: 'clef-de-test', usdToEur, fetch });
    await provider.fetchPrices([aapl, 'sol', 'btc'], signal);
    expect(calls).toHaveLength(1);
    // La liste exacte, pas une recherche de sous-chaîne : le code envoie les symboles en
    // majuscules, si bien qu'un `not.toContain('sol')` resterait vert sur une URL contenant
    // « SOL ». La contre-épreuve de la décision n° 75 a attrapé le test creux, pas le code.
    expect(new URL(calls[0]!).searchParams.get('symbol')).toBe('AAPL');
  });

  it('prend le cours tel quel en euros, et convertit celui en dollars', async () => {
    const { fetch } = fakeFetch(() => ({
      body: {
        AAPL: { close: '200', currency: 'USD' },
        IWDA: { close: '100', currency: 'EUR' },
      },
    }));
    const provider = twelveDataProvider({ apiKey: 'clef-de-test', usdToEur, fetch });
    const found = await provider.fetchPrices([aapl, iwda], signal);
    expect(found.get(aapl)?.priceEur).toBe('180');
    expect(found.get(iwda)?.priceEur).toBe('100');
    expect(found.get(aapl)?.source).toBe('Twelve Data');
  });

  it('laisse sans prix une devise qu’il ne sait pas convertir, plutôt qu’un prix faux', async () => {
    const { fetch } = fakeFetch(() => ({ body: { AAPL: { close: '200', currency: 'CHF' } } }));
    const provider = twelveDataProvider({ apiKey: 'clef-de-test', usdToEur, fetch });
    const found = await provider.fetchPrices([aapl], signal);
    expect(found.size).toBe(0);
  });

  it('lit une cotation isolée, que l’API rend à plat sans clé de symbole', async () => {
    const { fetch } = fakeFetch(() => ({
      body: { symbol: 'AAPL', close: '200', currency: 'EUR' },
    }));
    const provider = twelveDataProvider({ apiKey: 'clef-de-test', usdToEur, fetch });
    const found = await provider.fetchPrices([aapl], signal);
    expect(found.get(aapl)?.priceEur).toBe('200');
  });

  it('lève quand le débit est dépassé — un 200 en erreur reste une non-réponse', async () => {
    const { fetch } = fakeFetch(() => ({
      body: { code: 429, status: 'error', message: 'You have run out of API credits' },
    }));
    const provider = twelveDataProvider({ apiKey: 'clef-de-test', usdToEur, fetch });
    await expect(provider.fetchPrices([aapl], signal)).rejects.toThrow('API credits');
  });

  it('ignore un symbole en erreur sans perdre les autres', async () => {
    const { fetch } = fakeFetch(() => ({
      body: {
        AAPL: { status: 'error', code: 404 },
        IWDA: { close: '100', currency: 'EUR' },
      },
    }));
    const provider = twelveDataProvider({ apiKey: 'clef-de-test', usdToEur, fetch });
    const found = await provider.fetchPrices([aapl, iwda], signal);
    expect(found.has(aapl)).toBe(false);
    expect(found.get(iwda)?.priceEur).toBe('100');
  });
});
