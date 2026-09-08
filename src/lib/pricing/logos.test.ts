import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../history/types';
import { fetchLogos } from './logos';

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

const wanted = { 'eq:aapl': 'AAPL' };

describe('logos des titres', () => {
  it('sans clé, ne contacte rien', async () => {
    const { calls, fetch } = fakeFetch(() => ({ body: {} }));
    expect(await fetchLogos(wanted, { apiKey: null, fetch })).toEqual({});
    expect(calls).toEqual([]);
  });

  it('retient l’URL rendue par le fournisseur', async () => {
    const { fetch } = fakeFetch(() => ({
      body: { meta: { symbol: 'AAPL' }, url: 'https://api.twelvedata.com/logo/apple.com' },
    }));
    const found = await fetchLogos(wanted, { apiKey: 'clef-de-test', fetch });
    expect(found['eq:aapl']?.url).toBe('https://api.twelvedata.com/logo/apple.com');
  });

  it('refuse une URL d’une autre origine : le fournisseur ne choisit pas où l’app va chercher', async () => {
    // Une réponse détournée pointerait ailleurs ; la CSP le bloquerait, mais mieux vaut ne pas
    // même l'écrire dans l'état de l'utilisateur.
    const { fetch } = fakeFetch(() => ({ body: { url: 'https://ailleurs.example/logo.png' } }));
    const found = await fetchLogos(wanted, { apiKey: 'clef-de-test', fetch });
    expect(found['eq:aapl']?.url).toBeNull();
  });

  it('mémorise l’absence de logo : une réponse négative reste une réponse', async () => {
    const { fetch } = fakeFetch(() => ({ body: { status: 'error', code: 404 } }));
    const found = await fetchLogos(wanted, { apiKey: 'clef-de-test', fetch });
    expect(found['eq:aapl']).toBeDefined();
    expect(found['eq:aapl']?.url).toBeNull();
  });

  it('ne mémorise rien quand le débit est dépassé : ce n’est pas une absence de logo', async () => {
    // Le palier gratuit accorde huit crédits par minute et un logo en coûte un. Prendre ce refus
    // pour un « pas de logo » condamnerait le symbole à rester sans image pour toujours.
    const { fetch } = fakeFetch(() => ({
      body: { code: 429, status: 'error', message: 'You have run out of API credits' },
    }));
    const found = await fetchLogos(wanted, { apiKey: 'clef-de-test', fetch });
    expect(found).toEqual({});
  });

  it('ne mémorise rien après une panne : il faudra retenter', async () => {
    const { fetch } = fakeFetch(() => ({ status: 503, body: { message: 'indisponible' } }));
    const found = await fetchLogos(wanted, { apiKey: 'clef-de-test', fetch });
    expect(found).toEqual({});
  });

  it('demande un logo par symbole, et rien de plus', async () => {
    const { calls, fetch } = fakeFetch(() => ({ body: { url: null } }));
    await fetchLogos({ 'eq:aapl': 'AAPL', 'eq:msft': 'MSFT' }, { apiKey: 'clef', fetch });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('symbol=AAPL');
    expect(calls[1]).toContain('symbol=MSFT');
  });
});
