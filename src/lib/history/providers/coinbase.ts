/**
 * Coinbase Exchange `GET /products/{SYM}-EUR/candles?granularity=86400&start=…&end=…` (sans clé).
 *
 * CORS vérifié le 22/08/2026 avec
 * `curl -s -D - -o /dev/null -H "Origin: https://jeremyh974.github.io" <url>` :
 * `access-control-allow-origin: *` sur `/products` et `/products/BTC-EUR/candles`, HTTP 200.
 *
 * 300 bougies maximum par appel (HTTP 400 « Count of aggregations requested exceeds 300 » au
 * delà) : pagination par fenêtres de 300 jours, de la plus récente à la plus ancienne ; une
 * fenêtre vide rencontrée après des données arrête la remontée (actif pas encore coté), mais les
 * fenêtres vides les plus récentes (produit délisté) ne l'arrêtent pas. `start`/`end` (ISO 8601)
 * sont inclusifs ;
 * bougies `[time, low, high, open, close, volume]` en nombres, de la plus récente à la plus
 * ancienne. Produit inconnu → 404. Les produits délistés servent encore leurs bougies passées
 * (vérifié sur MATIC-EUR) : on les garde. La liste des produits EUR est lue une seule fois via
 * `/products` (87 produits EUR le 22/08/2026) et mémorisée. Profondeur illimitée (depuis la
 * cotation du produit).
 */
import type { AssetCode } from '../../domain/types';
import { TICKERS } from '../../pricing/tickers';
import { addDays, maxDay, msToDay } from '../days';
import { RequestQueue } from '../queue';
import type { DayString, FetchLike, HistoryProvider, IntradayPoint } from '../types';
import { defaultFetch, memoizeAsync, pointsFromMap, priceFromJson, readJson } from './shared';

const ENDPOINT = 'https://api.exchange.coinbase.com';
const MAX_CANDLES = 300;
const WINDOW_DAYS = MAX_CANDLES;

/** Granularités (secondes) acceptées par l'API. */
const GRANULARITIES = [60, 300, 900, 3600, 21_600, 86_400];

export interface CoinbaseHistoryOptions {
  fetch?: FetchLike;
  queue?: RequestQueue;
  now?: () => number;
}

/** Limite publique : 10 requêtes/s ; on reste nettement en dessous. */
export function coinbaseQueue(): RequestQueue {
  return new RequestQueue({ minIntervalMs: 150, maxAttempts: 3, backoffMs: 1000 });
}

/** Identifiant de produit Coinbase (`BTC-EUR`) d'après la table curée des tickers. */
export function coinbaseProductId(asset: AssetCode): string | null {
  const symbol = TICKERS[asset]?.coinbase ?? null;
  return symbol ? `${symbol}-EUR` : null;
}

/** `[time, low, high, open, close, volume]` → `[ms, clôture]` ou `null`. */
function closeOf(row: unknown): [number, string] | null {
  if (!Array.isArray(row) || typeof row[0] !== 'number') return null;
  const priceEur = priceFromJson(row[4]);
  return priceEur === null ? null : [row[0] * 1000, priceEur];
}

export function coinbaseExchangeHistoryProvider(
  options: CoinbaseHistoryOptions = {},
): HistoryProvider {
  const doFetch = options.fetch ?? defaultFetch;
  const queue = options.queue ?? coinbaseQueue();
  const now = options.now ?? Date.now;

  function get(path: string, signal: AbortSignal): Promise<Response> {
    return queue.run(
      () => doFetch(`${ENDPOINT}${path}`, { signal, headers: { accept: 'application/json' } }),
      signal,
    );
  }

  const eurProducts = memoizeAsync(async (signal): Promise<Set<string>> => {
    const body = await readJson('Coinbase', await get('/products', signal));
    const ids = new Set<string>();
    if (Array.isArray(body)) {
      for (const product of body) {
        if (typeof product !== 'object' || product === null) continue;
        const { id, quote_currency } = product as { id?: unknown; quote_currency?: unknown };
        if (quote_currency === 'EUR' && typeof id === 'string') ids.add(id);
      }
    }
    return ids;
  });

  /** Bougies d'une fenêtre ; `null` si le produit est inconnu (404). */
  async function candles(
    id: string,
    granularity: number,
    startIso: string,
    endIso: string,
    signal: AbortSignal,
  ): Promise<unknown[] | null> {
    const response = await get(
      `/products/${id}/candles?granularity=${granularity}&start=${startIso}&end=${endIso}`,
      signal,
    );
    if (response.status === 404) return null;
    const body = await readJson('Coinbase', response);
    return Array.isArray(body) ? body : [];
  }

  return {
    name: 'Coinbase',
    maxDays: null,

    async supports(asset, signal) {
      const id = coinbaseProductId(asset);
      return id !== null && (await eurProducts(signal)).has(id);
    },

    async fetchDaily(asset, fromDay, toDay, signal) {
      const id = coinbaseProductId(asset);
      if (id === null || !(await eurProducts(signal)).has(id)) return [];
      const byDay = new Map<DayString, string>();
      let found = false;
      let end = toDay;
      while (end >= fromDay) {
        const start = maxDay(fromDay, addDays(end, -(WINDOW_DAYS - 1)));
        const rows = await candles(id, 86_400, `${start}T00:00:00Z`, `${end}T00:00:00Z`, signal);
        if (rows === null) break;
        let count = 0;
        for (const row of rows) {
          const close = closeOf(row);
          if (!close) continue;
          byDay.set(msToDay(close[0]), close[1]);
          count++;
        }
        if (count === 0 && found) break; // fenêtre vide après des données : pas encore coté
        found = found || count > 0;
        end = addDays(start, -1);
      }
      return pointsFromMap(byDay, fromDay, toDay);
    },

    async fetchIntraday(asset, hours, signal) {
      const id = coinbaseProductId(asset);
      if (id === null || !(await eurProducts(signal)).has(id)) return [];
      const granularity = GRANULARITIES.find((g) => g * MAX_CANDLES >= hours * 3600) ?? 86_400;
      const endMs = now();
      const startMs = endMs - hours * 3_600_000;
      const rows = await candles(
        id,
        granularity,
        new Date(startMs).toISOString(),
        new Date(endMs).toISOString(),
        signal,
      );
      const points: IntradayPoint[] = [];
      for (const row of rows ?? []) {
        const close = closeOf(row);
        if (close && close[0] >= startMs) {
          points.push({ at: new Date(close[0]).toISOString(), priceEur: close[1] });
        }
      }
      points.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      return points;
    },
  };
}
