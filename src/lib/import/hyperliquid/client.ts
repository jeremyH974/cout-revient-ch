/**
 * Client minimal de l'API `info` Hyperliquid (lecture seule, sans clé ni signature) : une seule
 * requête en vol à la fois, espacement minimal, nouvel essai avec délai exponentiel et jitter sur
 * 429 / 5xx / erreur réseau (`Retry-After` respecté). Aucune dépendance : six types de requêtes,
 * contrat stable, gardes runtime dans `api-types.ts`. Débit documenté le 23/08/2026 : 1 200 de
 * poids par minute et par IP (`userFills*` : 20 + 1 par tranche de 20 éléments).
 */
import { defaultFetch } from '../../history/providers/shared';
import type { FetchLike } from '../../history/types';
import { HL_INFO_ENDPOINT, parseSpotMeta, type HlSpotMeta } from './api-types';

export interface HlClientOptions {
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Espacement minimal entre deux requêtes (ms). */
  minIntervalMs?: number;
  /** Nombre maximal d'essais par requête (1 = aucun nouvel essai). */
  maxAttempts?: number;
  /** Délai de base du backoff (ms), doublé à chaque essai. */
  backoffMs?: number;
  /** Jitter : fraction aléatoire ajoutée au délai (0 = déterministe, pour les tests). */
  random?: () => number;
}

export interface HlClient {
  /** `POST /info` avec le corps donné ; renvoie le JSON brut (à passer aux gardes `parse*`). */
  info(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  /** `spotMeta`, mémoïsé 24 h (les paires changent rarement). */
  spotMeta(signal?: AbortSignal): Promise<HlSpotMeta>;
}

export class HlHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  constructor(status: number, retryAfterMs: number | null) {
    super(`Hyperliquid HTTP ${status}`);
    this.name = 'HlHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const SPOT_META_TTL_MS = 24 * 60 * 60 * 1000;
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const retryable = (error: unknown): boolean =>
  error instanceof HlHttpError ? error.status === 429 || error.status >= 500 : !isAbort(error);

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException ? error.name === 'AbortError' : false;

function retryAfter(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

export function createHlClient(options: HlClientOptions = {}): HlClient {
  const doFetch = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const minInterval = options.minIntervalMs ?? 120;
  const maxAttempts = options.maxAttempts ?? 3;
  const backoff = options.backoffMs ?? 1_000;
  const random = options.random ?? Math.random;

  let tail: Promise<unknown> = Promise.resolve();
  let lastAt = Number.NEGATIVE_INFINITY;
  let meta: { at: number; value: Promise<HlSpotMeta> } | null = null;

  async function once(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const wait = lastAt + minInterval - now();
    if (wait > 0) await sleep(wait);
    lastAt = now();
    const response = await doFetch(HL_INFO_ENDPOINT, {
      method: 'POST',
      signal: signal ?? null,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new HlHttpError(response.status, retryAfter(response));
    return (await response.json()) as unknown;
  }

  async function withRetry(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      if (signal?.aborted) throw new DOMException('Synchronisation annulée', 'AbortError');
      try {
        return await once(body, signal);
      } catch (error) {
        if (attempt >= maxAttempts || !retryable(error)) throw error;
        const hinted = error instanceof HlHttpError ? error.retryAfterMs : null;
        const delay = hinted ?? backoff * 2 ** (attempt - 1) * (1 + random() * 0.5);
        await sleep(delay);
      }
    }
  }

  function info(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    // File sérialisée : la requête suivante part quand la précédente est résolue (ou rejetée).
    const run = tail.then(
      () => withRetry(body, signal),
      () => withRetry(body, signal),
    );
    tail = run.catch(() => undefined);
    return run;
  }

  return {
    info,
    spotMeta(signal) {
      if (meta && now() - meta.at < SPOT_META_TTL_MS) return meta.value;
      const value = info({ type: 'spotMeta' }, signal).then(parseSpotMeta);
      meta = { at: now(), value };
      value.catch(() => {
        meta = null;
      });
      return value;
    },
  };
}
