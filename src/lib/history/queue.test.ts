import { describe, expect, it } from 'vitest';
import { RequestQueue, sleep } from './queue';

function fakeClock() {
  const state = { t: 0, sleeps: [] as number[] };
  return {
    state,
    now: () => state.t,
    sleep: async (ms: number) => {
      state.sleeps.push(ms);
      state.t += ms;
    },
  };
}

const response = (status: number, headers: Record<string, string> = {}): Response =>
  new Response(null, { status, headers });

describe("file d'attente de requêtes", () => {
  it('espace les départs de minIntervalMs et sérialise', async () => {
    const clock = fakeClock();
    const queue = new RequestQueue({
      minIntervalMs: 2500,
      maxAttempts: 3,
      backoffMs: 2500,
      ...clock,
    });
    const starts: number[] = [];
    const fetcher = async (): Promise<Response> => {
      starts.push(clock.state.t);
      return response(200);
    };
    const results = await Promise.all([queue.run(fetcher), queue.run(fetcher), queue.run(fetcher)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(starts).toEqual([0, 2500, 5000]);
    expect(clock.state.sleeps).toEqual([2500, 2500]);
  });

  it('rejoue un 429 avec backoff ×2 puis renvoie le succès', async () => {
    const clock = fakeClock();
    const queue = new RequestQueue({
      minIntervalMs: 2500,
      maxAttempts: 3,
      backoffMs: 2500,
      ...clock,
    });
    const statuses = [429, 429, 200];
    let calls = 0;
    const result = await queue.run(async () => response(statuses[calls++]!));
    expect(result.status).toBe(200);
    expect(calls).toBe(3);
    expect(clock.state.sleeps).toEqual([2500, 5000]);
  });

  it('abandonne après maxAttempts et rend la dernière réponse', async () => {
    const clock = fakeClock();
    const queue = new RequestQueue({ minIntervalMs: 0, maxAttempts: 3, backoffMs: 1000, ...clock });
    let calls = 0;
    const result = await queue.run(async () => {
      calls++;
      return response(429);
    });
    expect(result.status).toBe(429);
    expect(calls).toBe(3);
    expect(clock.state.sleeps).toEqual([1000, 2000]);
  });

  it('honore Retry-After quand il dépasse le backoff et ne rejoue pas un 404', async () => {
    const clock = fakeClock();
    const queue = new RequestQueue({ minIntervalMs: 0, maxAttempts: 2, backoffMs: 1000, ...clock });
    const statuses = [response(429, { 'retry-after': '10' }), response(200)];
    let calls = 0;
    await queue.run(async () => statuses[calls++]!);
    expect(clock.state.sleeps).toEqual([10_000]);

    let notFoundCalls = 0;
    const result = await queue.run(async () => {
      notFoundCalls++;
      return response(404);
    });
    expect(result.status).toBe(404);
    expect(notFoundCalls).toBe(1);
  });

  it('rejette sans appeler le réseau si le signal est déjà annulé, et libère la file', async () => {
    const clock = fakeClock();
    const queue = new RequestQueue({ minIntervalMs: 0, maxAttempts: 1, backoffMs: 0, ...clock });
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await expect(
      queue.run(async () => {
        calls++;
        return response(200);
      }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(0);
    const next = await queue.run(async () => response(204));
    expect(next.status).toBe(204);
  });

  it('sleep réel est annulable', async () => {
    const controller = new AbortController();
    const pending = sleep(60_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(sleep(1)).resolves.toBeUndefined();
  });
});
