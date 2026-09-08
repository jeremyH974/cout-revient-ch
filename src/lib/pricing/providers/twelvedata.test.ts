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

  it('lève quand la clé est refusée — un 200 en erreur reste une non-réponse', async () => {
    const { fetch } = fakeFetch(() => ({
      body: { code: 401, status: 'error', message: 'Invalid API key' },
    }));
    const provider = twelveDataProvider({ apiKey: 'clef-de-test', usdToEur, fetch });
    await expect(provider.fetchPrices([aapl], signal)).rejects.toThrow('Invalid API key');
  });

  it('ne demande que huit symboles par appel : le palier gratuit en accorde huit par minute', async () => {
    // Un lot coûte un crédit PAR SYMBOLE. Grouper plus large ne fait aucune économie, ça garantit
    // le refus — c'est ce que faisait un `CHUNK_SIZE` de vingt, et rien ne le voyait.
    const { calls, fetch } = fakeFetch(() => ({ body: {} }));
    const codes = Array.from({ length: 9 }, (_, i) => equityCode(`T${i}`));
    const provider = twelveDataProvider({ apiKey: 'clef-de-test', usdToEur, fetch });
    await provider.fetchPrices(codes, signal);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0]!).searchParams.get('symbol')?.split(',')).toHaveLength(8);
    expect(new URL(calls[1]!).searchParams.get('symbol')?.split(',')).toHaveLength(1);
  });

  it('garde les lots obtenus quand le débit est dépassé en cours de route', async () => {
    // Huit cours acquis puis un refus de débit : lever perdrait les huit, et l'utilisateur
    // n'aurait aucun prix au lieu de la moitié. Le refus n'est pas une panne, c'est une attente.
    let call = 0;
    const { fetch } = fakeFetch(() => {
      call += 1;
      if (call === 1) return { body: { T0: { close: '100', currency: 'EUR' } } };
      return { body: { code: 429, status: 'error', message: 'You have run out of API credits' } };
    });
    const codes = Array.from({ length: 9 }, (_, i) => equityCode(`T${i}`));
    const provider = twelveDataProvider({ apiKey: 'clef-de-test', usdToEur, fetch });
    const found = await provider.fetchPrices(codes, signal);
    expect(found.get(equityCode('T0'))?.priceEur).toBe('100');
    expect(found.size).toBe(1);
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

describe('Twelve Data — titres identifiés par ISIN', () => {
  const isinCode = equityCode('US0378331005');

  it('résout l’ISIN en symbole avant de demander une cotation', async () => {
    const { calls, fetch } = fakeFetch((url) => {
      if (url.includes('symbol_search')) return { body: { data: [{ symbol: 'AAPL' }] } };
      return { body: { AAPL: { close: '200', currency: 'USD' } } };
    });
    const provider = twelveDataProvider({ apiKey: 'clef-de-test', usdToEur, fetch });
    const found = await provider.fetchPrices([isinCode], signal);
    expect(calls[0]).toContain('symbol_search');
    expect(calls[0]).toContain('US0378331005');
    expect(found.get(isinCode)?.priceEur).toBe('180');
  });

  it('ne redemande pas une résolution déjà faite : un crédit ne se dépense qu’une fois', async () => {
    const { calls, fetch } = fakeFetch((url) => {
      if (url.includes('symbol_search')) return { body: { data: [{ symbol: 'AAPL' }] } };
      return { body: { AAPL: { close: '100', currency: 'EUR' } } };
    });
    const provider = twelveDataProvider({ apiKey: 'clef-de-test', usdToEur, fetch });
    await provider.fetchPrices([isinCode], signal);
    const before = calls.filter((u) => u.includes('symbol_search')).length;
    await provider.fetchPrices([isinCode], signal);
    expect(calls.filter((u) => u.includes('symbol_search')).length).toBe(before);
  });

  it('laisse un ISIN introuvable sans prix, plutôt que d’interroger au hasard', async () => {
    const unknown = equityCode('XX9999999999');
    const { fetch } = fakeFetch((url) =>
      url.includes('symbol_search') ? { body: { data: [] } } : { body: {} },
    );
    const provider = twelveDataProvider({ apiKey: 'clef-de-test', usdToEur, fetch });
    const found = await provider.fetchPrices([unknown], signal);
    expect(found.size).toBe(0);
  });
});
