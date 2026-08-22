/**
 * CoinGecko `GET /api/v3/coins/{id}/market_chart?vs_currency=eur&days=N` (plan public, sans clé).
 *
 * CORS vérifié le 22/08/2026 avec
 * `curl -s -D - -o /dev/null -H "Origin: https://jeremyh974.github.io" <url>` :
 * `access-control-allow-origin: *` (HTTP 200) pour `days=365` comme pour `days=1`.
 *
 * Limites du plan public : 365 jours d'historique maximum ; granularité automatique
 * (`days=1` → 5 min, 2–90 → horaire, > 90 → quotidienne à minuit UTC) ; ~5–15 requêtes/min,
 * d'où la file d'attente (une requête toutes les 2,5 s, backoff ×2 sur 429, 3 essais).
 *
 * Le dernier point renvoyé est le prix courant (pas une clôture). Un point tombant exactement
 * à minuit UTC est rattaché à la veille (`closeDayOf`) : les séries s'alignent ainsi sur les
 * clôtures quotidiennes des exchanges, quelle que soit la granularité.
 */
import type { AssetCode } from '../../domain/types';
import { TICKERS } from '../../pricing/tickers';
import { closeDayOf, daysBetween, todayOf } from '../days';
import { RequestQueue } from '../queue';
import type { DayString, FetchLike, HistoryProvider, IntradayPoint } from '../types';
import { defaultFetch, pointsFromMap, priceFromJson, readJson } from './shared';

const ENDPOINT = 'https://api.coingecko.com/api/v3';

/** Profondeur maximale du plan public. */
export const COINGECKO_MAX_DAYS = 365;

/** Au-delà, CoinGecko ne renvoie plus qu'un point par jour : inutile pour l'intraday. */
const HOURLY_MAX_DAYS = 90;

export interface CoingeckoHistoryOptions {
  /** Id CoinGecko par actif (réglages utilisateur), prioritaire sur la table des tickers. */
  idOverrides?: Record<AssetCode, string | null>;
  fetch?: FetchLike;
  queue?: RequestQueue;
  now?: () => number;
}

/** File d'attente adaptée au plan public : 1 requête / 2,5 s, backoff 2,5 s → 5 s, 3 essais. */
export function coingeckoQueue(): RequestQueue {
  return new RequestQueue({ minIntervalMs: 2500, maxAttempts: 3, backoffMs: 2500 });
}

type PricePair = [number, number];

function isPricePair(value: unknown): value is PricePair {
  return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number';
}

export function coingeckoHistoryProvider(options: CoingeckoHistoryOptions = {}): HistoryProvider {
  const doFetch = options.fetch ?? defaultFetch;
  const queue = options.queue ?? coingeckoQueue();
  const now = options.now ?? Date.now;
  const idOf = (asset: AssetCode): string | null =>
    options.idOverrides?.[asset] ?? TICKERS[asset]?.coingeckoId ?? null;

  async function marketChart(id: string, days: number, signal: AbortSignal): Promise<PricePair[]> {
    const url = `${ENDPOINT}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=eur&days=${days}`;
    const response = await queue.run(
      () => doFetch(url, { signal, headers: { accept: 'application/json' } }),
      signal,
    );
    if (response.status === 404) return []; // id inconnu
    const body = (await readJson('CoinGecko', response)) as { prices?: unknown };
    return Array.isArray(body.prices) ? body.prices.filter(isPricePair) : [];
  }

  return {
    name: 'CoinGecko',
    maxDays: COINGECKO_MAX_DAYS,
    supports: (asset) => Promise.resolve(idOf(asset) !== null),

    async fetchDaily(asset, fromDay, toDay, signal) {
      const id = idOf(asset);
      if (id === null) return [];
      const span = daysBetween(fromDay, todayOf(now()));
      if (span < 0) return [];
      const days = Math.min(COINGECKO_MAX_DAYS, Math.max(1, span + 1));
      const byDay = new Map<DayString, string>();
      for (const [ms, price] of await marketChart(id, days, signal)) {
        const priceEur = priceFromJson(price);
        // Le dernier point de chaque jour gagne (le tout dernier est le prix courant).
        if (priceEur !== null) byDay.set(closeDayOf(ms), priceEur);
      }
      return pointsFromMap(byDay, fromDay, toDay);
    },

    async fetchIntraday(asset, hours, signal) {
      const id = idOf(asset);
      if (id === null) return [];
      const days = Math.min(HOURLY_MAX_DAYS, Math.max(1, Math.ceil(hours / 24)));
      const since = now() - hours * 3_600_000;
      const points: IntradayPoint[] = [];
      for (const [ms, price] of await marketChart(id, days, signal)) {
        const priceEur = priceFromJson(price);
        if (ms >= since && priceEur !== null) {
          points.push({ at: new Date(ms).toISOString(), priceEur });
        }
      }
      return points; // CoinGecko renvoie déjà les points par ordre croissant
    },
  };
}
