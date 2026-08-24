import { describe, expect, it } from 'vitest';
import { createHlClient, HlHttpError } from './client';

interface Call {
  body: Record<string, unknown>;
  at: number;
}

/** `fetch` simulé : une file de réponses (statut, corps, en-têtes) consommée dans l'ordre. */
function fakeFetch(responses: { status: number; body?: unknown; retryAfter?: string }[]) {
  const calls: Call[] = [];
  let clock = 0;
  const sleeps: number[] = [];
  const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown>, at: clock });
    const next = responses.shift() ?? { status: 200, body: null };
    const headers = new Headers();
    if (next.retryAfter) headers.set('retry-after', next.retryAfter);
    return new Response(JSON.stringify(next.body ?? null), { status: next.status, headers });
  };
  const client = createHlClient({
    fetch,
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    random: () => 0,
    backoffMs: 100,
    minIntervalMs: 50,
  });
  return { client, calls, sleeps };
}

describe('createHlClient', () => {
  it('envoie un POST JSON et renvoie le corps', async () => {
    const { client, calls } = fakeFetch([{ status: 200, body: { BTC: '66000' } }]);
    await expect(client.info({ type: 'allMids' })).resolves.toEqual({ BTC: '66000' });
    expect(calls[0]?.body).toEqual({ type: 'allMids' });
  });

  it('sérialise les requêtes et respecte l’espacement minimal', async () => {
    const { client, calls, sleeps } = fakeFetch([
      { status: 200, body: 1 },
      { status: 200, body: 2 },
      { status: 200, body: 3 },
    ]);
    const results = await Promise.all([
      client.info({ type: 'a' }),
      client.info({ type: 'b' }),
      client.info({ type: 'c' }),
    ]);
    expect(results).toEqual([1, 2, 3]);
    expect(calls.map((c) => c.body['type'])).toEqual(['a', 'b', 'c']);
    // Deux attentes d'espacement (50 ms) entre les trois requêtes.
    expect(sleeps).toEqual([50, 50]);
  });

  it('réessaie sur 429 en respectant Retry-After, puis sur 5xx avec backoff exponentiel', async () => {
    const { client, sleeps } = fakeFetch([
      { status: 429, retryAfter: '2' },
      { status: 503 },
      { status: 200, body: 'ok' },
    ]);
    await expect(client.info({ type: 'x' })).resolves.toBe('ok');
    // 2 000 ms (Retry-After) puis 100 × 2¹ = 200 ms (2ᵉ essai, jitter nul).
    expect(sleeps.filter((ms) => ms >= 100)).toEqual([2000, 200]);
  });

  it('abandonne après le nombre maximal d’essais et n’insiste pas sur une erreur 4xx', async () => {
    const exhausted = fakeFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
    await expect(exhausted.client.info({ type: 'x' })).rejects.toBeInstanceOf(HlHttpError);
    expect(exhausted.calls).toHaveLength(3);
    const bad = fakeFetch([{ status: 400 }]);
    await expect(bad.client.info({ type: 'x' })).rejects.toMatchObject({ status: 400 });
    expect(bad.calls).toHaveLength(1);
  });

  it('mémoïse spotMeta et la relit après un échec', async () => {
    const { client, calls } = fakeFetch([
      { status: 500 },
      { status: 500 },
      { status: 500 },
      {
        status: 200,
        body: {
          tokens: [
            { name: 'USDC', index: 0 },
            { name: 'PURR', index: 1 },
          ],
          universe: [{ tokens: [1, 0], name: 'PURR/USDC', index: 0, isCanonical: true }],
        },
      },
    ]);
    await expect(client.spotMeta()).rejects.toBeInstanceOf(HlHttpError);
    const meta = await client.spotMeta();
    expect(meta.pairs).toEqual([
      { name: 'PURR/USDC', index: 0, base: 'PURR', quote: 'USDC', isCanonical: true },
    ]);
    await client.spotMeta();
    expect(calls.filter((c) => c.body['type'] === 'spotMeta')).toHaveLength(4);
  });
});
