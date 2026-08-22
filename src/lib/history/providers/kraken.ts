/**
 * Kraken `GET /0/public/OHLC?pair=XBTEUR&interval=1440&since=…` (sans clé).
 *
 * CORS vérifié le 22/08/2026 avec
 * `curl -s -D - -o /dev/null -H "Origin: https://jeremyh974.github.io" <url>` :
 * `Access-Control-Allow-Origin: https://jeremyh974.github.io` (l'origine demandée est renvoyée
 * telle quelle) sur `/0/public/OHLC` et `/0/public/AssetPairs`, HTTP 200.
 *
 * 720 bougies maximum par appel → 720 jours en quotidien ; `since` (secondes) est inclusif.
 * Réponse `{ error: string[], result: { <clé>: [[time, open, high, low, close, vwap, volume,
 * count], …], last } }` : la clé varie (`XXBTZEUR` pour XBTEUR, `XDGEUR` pour XDGEUR), on prend
 * la première clé ≠ `last` ; les prix sont des chaînes. Paire inconnue → `EQuery:Unknown asset
 * pair`. Les paires EUR existantes sont lues une seule fois via `/AssetPairs` (≈ 1,1 Mo,
 * 544 paires `quote: 'ZEUR'` le 22/08/2026) et mémorisées ; on n'appelle que celles-là.
 */
import type { AssetCode } from '../../domain/types';
import { dayToMs, msToDay } from '../days';
import { RequestQueue } from '../queue';
import type { DayString, FetchLike, HistoryProvider, IntradayPoint } from '../types';
import { defaultFetch, memoizeAsync, pointsFromMap, priceFromJson, readJson } from './shared';

const ENDPOINT = 'https://api.kraken.com/0/public';
const MAX_CANDLES = 720;

/** Profondeur maximale en quotidien (720 bougies). */
export const KRAKEN_MAX_DAYS = MAX_CANDLES;

/** Tickers dont le nom Kraken diffère du ticker usuel. */
const KRAKEN_ALIASES: Record<AssetCode, string> = { btc: 'XBT', doge: 'XDG' };

/** Intervalles (minutes) disponibles pour l'intraday. */
const INTRADAY_INTERVALS = [1, 5, 15, 30, 60, 240];

export interface KrakenHistoryOptions {
  fetch?: FetchLike;
  queue?: RequestQueue;
  now?: () => number;
}

/** Kraken tolère ~1 requête publique par seconde. */
export function krakenQueue(): RequestQueue {
  return new RequestQueue({ minIntervalMs: 1000, maxAttempts: 3, backoffMs: 1000 });
}

/** Nom de paire (`altname`) Kraken : `XBTEUR`, `XDGEUR`, `ETHEUR`… */
export function krakenPairName(asset: AssetCode): string {
  return `${KRAKEN_ALIASES[asset] ?? asset.toUpperCase()}EUR`;
}

interface KrakenBody {
  error?: unknown;
  result?: unknown;
}

function krakenErrors(body: KrakenBody): string[] {
  return Array.isArray(body.error)
    ? body.error.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Lignes OHLC : première clé de `result` différente de `last`. */
function ohlcRows(result: unknown): unknown[] {
  if (typeof result !== 'object' || result === null) return [];
  for (const [key, value] of Object.entries(result)) {
    if (key !== 'last' && Array.isArray(value)) return value;
  }
  return [];
}

/** `[time, open, high, low, close, …]` → `[ms, clôture]` ou `null`. */
function closeOf(row: unknown): [number, string] | null {
  if (!Array.isArray(row) || typeof row[0] !== 'number') return null;
  const priceEur = priceFromJson(row[4]);
  return priceEur === null ? null : [row[0] * 1000, priceEur];
}

export function krakenHistoryProvider(options: KrakenHistoryOptions = {}): HistoryProvider {
  const doFetch = options.fetch ?? defaultFetch;
  const queue = options.queue ?? krakenQueue();
  const now = options.now ?? Date.now;

  async function get(path: string, signal: AbortSignal): Promise<KrakenBody> {
    const response = await queue.run(
      () => doFetch(`${ENDPOINT}/${path}`, { signal, headers: { accept: 'application/json' } }),
      signal,
    );
    return (await readJson('Kraken', response)) as KrakenBody;
  }

  const eurPairs = memoizeAsync(async (signal): Promise<Set<string>> => {
    const body = await get('AssetPairs', signal);
    const errors = krakenErrors(body);
    if (errors.length > 0) throw new Error(`Kraken : ${errors.join(', ')}`);
    const pairs = new Set<string>();
    if (typeof body.result === 'object' && body.result !== null) {
      const entries = Object.entries(body.result as Record<string, unknown>);
      for (const [key, info] of entries) {
        if (typeof info !== 'object' || info === null) continue;
        const { altname, quote } = info as { altname?: unknown; quote?: unknown };
        if (quote !== 'ZEUR' && quote !== 'EUR') continue;
        pairs.add(key);
        if (typeof altname === 'string') pairs.add(altname);
      }
    }
    return pairs;
  });

  async function ohlc(
    pair: string,
    interval: number,
    sinceSec: number,
    signal: AbortSignal,
  ): Promise<unknown[]> {
    const body = await get(`OHLC?pair=${pair}&interval=${interval}&since=${sinceSec}`, signal);
    const errors = krakenErrors(body);
    if (errors.some((item) => item.includes('Unknown asset pair'))) return [];
    if (errors.length > 0) throw new Error(`Kraken : ${errors.join(', ')}`);
    return ohlcRows(body.result);
  }

  return {
    name: 'Kraken',
    maxDays: KRAKEN_MAX_DAYS,

    async supports(asset, signal) {
      return (await eurPairs(signal)).has(krakenPairName(asset));
    },

    async fetchDaily(asset, fromDay, toDay, signal) {
      const pair = krakenPairName(asset);
      if (!(await eurPairs(signal)).has(pair)) return [];
      const since = Math.floor(dayToMs(fromDay) / 1000) - 86_400;
      const byDay = new Map<DayString, string>();
      for (const row of await ohlc(pair, 1440, since, signal)) {
        const close = closeOf(row);
        if (close) byDay.set(msToDay(close[0]), close[1]);
      }
      return pointsFromMap(byDay, fromDay, toDay);
    },

    async fetchIntraday(asset, hours, signal) {
      const pair = krakenPairName(asset);
      if (!(await eurPairs(signal)).has(pair)) return [];
      const interval = INTRADAY_INTERVALS.find((m) => m * MAX_CANDLES >= hours * 60) ?? 1440;
      const sinceMs = now() - hours * 3_600_000;
      const points: IntradayPoint[] = [];
      for (const row of await ohlc(pair, interval, Math.floor(sinceMs / 1000), signal)) {
        const close = closeOf(row);
        if (close && close[0] >= sinceMs) {
          points.push({ at: new Date(close[0]).toISOString(), priceEur: close[1] });
        }
      }
      points.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      return points;
    },
  };
}
