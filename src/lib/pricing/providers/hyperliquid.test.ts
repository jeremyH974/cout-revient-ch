import Big from 'big.js';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../../history/types';
import type { UsdToEur } from '../types';
import { hyperliquidProvider } from './hyperliquid';

type RequestBody = { type: string };
type Route = (body: RequestBody) => { status?: number; body?: unknown } | undefined;

/** Les deux appels Hyperliquid ciblent la même URL : on route sur le `type` du corps JSON. */
function fakeFetch(route: Route): { calls: string[]; fetch: FetchLike } {
  const calls: string[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const parsed = init?.body ? (JSON.parse(String(init.body)) as RequestBody) : { type: '' };
    calls.push(parsed.type);
    const hit = route(parsed);
    const status = hit?.status ?? (hit ? 200 : 404);
    const body = hit ? (hit.body ?? null) : { message: 'NotFound' };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetch };
}

// Taux de conversion de test : 1 USD = 0,8 EUR (division par 1,25).
const usdToEur: UsdToEur = (priceUsd) => new Big(priceUsd).div('1.25').toString();

const spotMeta = {
  tokens: [
    { name: 'USDC', index: 0 },
    { name: 'HYPE', index: 150 },
    { name: 'PURR', index: 1 },
  ],
  universe: [
    // Paire spot non canonique : la clé de cotation est '@' + index, pas `name`.
    { tokens: [150, 0], name: 'HYPE/USDC', index: 107, isCanonical: false },
    { tokens: [1, 0], name: 'PURR/USDC', index: 0, isCanonical: true },
  ],
};

const allMids = {
  BTC: '77488.5', // perp uniquement (aucun token spot 'BTC')
  HYPE: '80.3195', // perp HYPE : ne doit PAS être choisi, le spot est préféré
  '@107': '80.2385', // spot HYPE/USDC (non canonique)
  'PURR/USDC': '0.122425', // spot PURR/USDC (canonique)
  '#12345': '999', // clé ignorée (non résolue par un code)
  NEG: '-5',
  BAD: 'abc',
};

const signal = new AbortController().signal;

function baseRoute(): Route {
  return (body) => {
    if (body.type === 'spotMeta') return { body: spotMeta };
    if (body.type === 'allMids') return { body: allMids };
    return undefined;
  };
}

describe('hyperliquidProvider', () => {
  it('nom du fournisseur', () => {
    expect(hyperliquidProvider({ usdToEur }).name).toBe('Hyperliquid');
  });

  it('préfère le spot USDC (canonique ou non) au perp, convertit en EUR', async () => {
    const { fetch } = fakeFetch(baseRoute());
    const provider = hyperliquidProvider({ usdToEur, fetch });
    const found = await provider.fetchPrices(['hype', 'purr'], signal);
    expect(found.get('hype')).toMatchObject({
      asset: 'hype',
      priceEur: new Big('80.2385').div('1.25').toString(),
      source: 'Hyperliquid',
      stale: false,
    });
    expect(found.get('purr')).toMatchObject({
      asset: 'purr',
      priceEur: new Big('0.122425').div('1.25').toString(),
      source: 'Hyperliquid',
      stale: false,
    });
  });

  it('se rabat sur le perp quand aucune paire spot USDC ne correspond', async () => {
    const { fetch } = fakeFetch(baseRoute());
    const provider = hyperliquidProvider({ usdToEur, fetch });
    const found = await provider.fetchPrices(['btc'], signal);
    expect(found.get('btc')).toMatchObject({
      asset: 'btc',
      priceEur: new Big('77488.5').div('1.25').toString(),
      source: 'Hyperliquid',
    });
  });

  it('actif inconnu ignoré', async () => {
    const { fetch } = fakeFetch(baseRoute());
    const provider = hyperliquidProvider({ usdToEur, fetch });
    const found = await provider.fetchPrices(['zzz'], signal);
    expect(found.has('zzz')).toBe(false);
  });

  it('valeurs invalides ou non positives ignorées', async () => {
    const { fetch } = fakeFetch(baseRoute());
    const provider = hyperliquidProvider({ usdToEur, fetch });
    const found = await provider.fetchPrices(['neg', 'bad'], signal);
    expect(found.size).toBe(0);
  });

  it('erreur HTTP → rejet', async () => {
    const { fetch } = fakeFetch(() => ({ status: 500, body: {} }));
    const provider = hyperliquidProvider({ usdToEur, fetch });
    await expect(provider.fetchPrices(['btc'], signal)).rejects.toThrow('Hyperliquid HTTP 500');
  });

  it('spotMeta chargé une seule fois pour deux appels fetchPrices, allMids à chaque fois', async () => {
    const { calls, fetch } = fakeFetch(baseRoute());
    const provider = hyperliquidProvider({ usdToEur, fetch });
    await provider.fetchPrices(['hype'], signal);
    await provider.fetchPrices(['hype'], signal);
    expect(calls.filter((type) => type === 'spotMeta')).toHaveLength(1);
    expect(calls.filter((type) => type === 'allMids')).toHaveLength(2);
  });

  it('deux instances avec des fetch distincts ne partagent pas le cache spotMeta', async () => {
    const a = fakeFetch(baseRoute());
    const b = fakeFetch(baseRoute());
    await hyperliquidProvider({ usdToEur, fetch: a.fetch }).fetchPrices(['hype'], signal);
    await hyperliquidProvider({ usdToEur, fetch: b.fetch }).fetchPrices(['hype'], signal);
    expect(a.calls.filter((type) => type === 'spotMeta')).toHaveLength(1);
    expect(b.calls.filter((type) => type === 'spotMeta')).toHaveLength(1);
  });
});
