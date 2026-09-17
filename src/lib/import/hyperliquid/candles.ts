/**
 * Bougies Hyperliquid (`candleSnapshot`) pour la courbe détaillée (décision n° 164) : quel pas
 * demander pour une fenêtre, la requête elle-même, et un cache de session.
 *
 * Ce que la plateforme sert (relevé du 17/09/2026) : **les 5 000 bougies les plus récentes** de
 * chaque pas, soit 3,5 jours en 1 min, 17 jours en 5 min, 52 jours en 15 min et 208 jours en 1 h.
 * Une fenêtre plus ancienne qu'un pas n'est donc servie qu'à un pas plus large : le choix du pas
 * dépend de la fenêtre ET de son ancienneté. Poids d'une requête : 20, plus 1 par tranche de 60
 * bougies rendues. On en demande au plus ~1 500, en une requête par marché.
 *
 * La requête ne porte **aucune adresse** : un marché et deux instants. Elle ne dit rien du compte
 * qu'on regarde.
 */
import {
  perpMarket,
  tokenMarket,
  type Candle,
  type PriceBook,
  type PriceSeries,
} from '../../domain/trading/equity-path';
import { numberToDecimal } from '../../pricing/types';
import type { HlClient } from './client';

export interface CandleInterval {
  /** Libellé de l'API (`1m`, `15m`, `1h`…). */
  id: string;
  ms: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Pas proposés par l'API, du plus fin au plus large (on s'arrête au jour). */
export const CANDLE_INTERVALS: readonly CandleInterval[] = [
  { id: '1m', ms: MIN },
  { id: '3m', ms: 3 * MIN },
  { id: '5m', ms: 5 * MIN },
  { id: '15m', ms: 15 * MIN },
  { id: '30m', ms: 30 * MIN },
  { id: '1h', ms: HOUR },
  { id: '2h', ms: 2 * HOUR },
  { id: '4h', ms: 4 * HOUR },
  { id: '8h', ms: 8 * HOUR },
  { id: '12h', ms: 12 * HOUR },
  { id: '1d', ms: 24 * HOUR },
];

/** Bougies servies par pas : les plus récentes seulement. */
export const CANDLE_DEPTH = 5_000;
/** Au-delà, un pas plus large : l'écran n'a pas plus de pixels que ça, et la requête pèse moins. */
export const MAX_DETAIL_SAMPLES = 1_500;
/** Marge chargée de part et d'autre de la vue : un léger glissement ne recharge rien. */
export const DETAIL_MARGIN = 0.1;
/** Zoom le plus serré permis quand le détail est possible : vingt bougies d'une minute. */
export const DETAIL_MIN_SPAN_MS = 20 * MIN;

/** Instant le plus ancien servi à chaque pas, pour l'API réelle. */
export const liveCandleFloor =
  (now: number) =>
  (intervalMs: number): number =>
    now - CANDLE_DEPTH * intervalMs;

export interface TimeRange {
  from: number;
  to: number;
}

export interface DetailPlan extends TimeRange {
  interval: CandleInterval;
}

/**
 * Fenêtre à reconstituer et pas des bougies, ou `null` si aucun pas n'est servi pour elle.
 *
 * La vue est élargie de sa marge, bornée à la série de la plateforme — la courbe détaillée n'en
 * sort jamais — puis, faute de point de la plateforme à l'intérieur, étendue jusqu'au plus proche :
 * sans lui, rien ne cale la trésorerie. Le pas est ensuite le plus fin qui tienne en
 * `MAX_DETAIL_SAMPLES` points et que l'API serve encore à cette date.
 */
export function planDetail(
  view: TimeRange,
  extent: TimeRange,
  anchorTimes: readonly number[],
  oldest: (intervalMs: number) => number,
): DetailPlan | null {
  const span = view.to - view.from;
  if (!(span > 0) || !(extent.to > extent.from)) return null;
  let from = Math.max(extent.from, Math.floor(view.from - span * DETAIL_MARGIN));
  let to = Math.min(extent.to, Math.ceil(view.to + span * DETAIL_MARGIN));
  if (!anchorTimes.some((t) => t >= from && t <= to)) {
    const before = anchorTimes.filter((t) => t < from && t >= extent.from);
    const after = anchorTimes.filter((t) => t > to && t <= extent.to);
    if (before.length === 0 && after.length === 0) return null;
    const earlier = before.length > 0 ? Math.max(...before) : null;
    const later = after.length > 0 ? Math.min(...after) : null;
    if (later === null || (earlier !== null && from - earlier <= later - to)) from = earlier!;
    else to = later;
  }
  for (const interval of CANDLE_INTERVALS) {
    const first = Math.floor(from / interval.ms) * interval.ms;
    if ((to - first) / interval.ms > MAX_DETAIL_SAMPLES) continue;
    if (first < oldest(interval.ms)) continue;
    return { from, to, interval };
  }
  return null;
}

/**
 * Faut-il recharger ? Oui si la vue sort de ce qui est chargé, ou si son pas idéal a changé —
 * zoomer plus près mérite des bougies plus fines, s'éloigner n'en demande pas tant.
 */
export function needsReplan(current: DetailPlan | null, next: DetailPlan | null): boolean {
  if (next === null) return false;
  if (current === null) return true;
  return (
    next.interval.id !== current.interval.id || next.from < current.from || next.to > current.to
  );
}

/** Garde runtime de `candleSnapshot` : les bougies valides, triées par ouverture. */
export function parseCandles(body: unknown): Candle[] {
  if (!Array.isArray(body)) return [];
  const candles: Candle[] = [];
  for (const item of body) {
    if (typeof item !== 'object' || item === null) continue;
    const raw = item as Record<string, unknown>;
    const t = raw['t'];
    const o = numberToDecimal(raw['o']);
    const h = numberToDecimal(raw['h']);
    const l = numberToDecimal(raw['l']);
    const c = numberToDecimal(raw['c']);
    if (typeof t !== 'number' || !Number.isFinite(t) || !o || !h || !l || !c) continue;
    candles.push({ t, o, h, l, c });
  }
  return candles.sort((a, b) => a.t - b.t);
}

export type CandleFetcher = (
  coin: string,
  interval: CandleInterval,
  from: number,
  to: number,
  signal?: AbortSignal,
) => Promise<Candle[]>;

/** `candleSnapshot` : bougies ouvertes dans `[from, to]` (bornes incluses). */
export function candleFetcher(client: HlClient): CandleFetcher {
  return async (coin, interval, from, to, signal) =>
    parseCandles(
      await client.info(
        {
          type: 'candleSnapshot',
          req: { coin, interval: interval.id, startTime: from, endTime: to },
        },
        signal,
      ),
    );
}

/**
 * Cache de session des bougies, par marché et par pas. Une bougie close ne change plus : ce qui a
 * été chargé ne se redemande pas. La bougie en cours, elle, n'est jamais tenue pour acquise.
 */
export class CandleCache {
  readonly #candles = new Map<string, Map<number, Candle>>();
  readonly #covered = new Map<string, TimeRange[]>();

  async series(
    fetcher: CandleFetcher,
    coin: string,
    interval: CandleInterval,
    range: TimeRange,
    now: number,
    signal?: AbortSignal,
  ): Promise<PriceSeries> {
    const key = `${coin}|${interval.id}`;
    const first = Math.floor(range.from / interval.ms) * interval.ms;
    const last = Math.floor(range.to / interval.ms) * interval.ms;
    const covered = this.#covered.get(key) ?? [];
    let stored = this.#candles.get(key);
    if (!covered.some((r) => r.from <= first && r.to >= last)) {
      const fresh = await fetcher(coin, interval, first, last, signal);
      stored ??= new Map();
      for (const candle of fresh) stored.set(candle.t, candle);
      this.#candles.set(key, stored);
      // La bougie ouverte à `now` n'est pas close : elle reste à recharger.
      const complete = Math.min(last, Math.floor(now / interval.ms) * interval.ms - interval.ms);
      if (complete >= first)
        this.#covered.set(
          key,
          mergeRanges([...covered, { from: first, to: complete }], interval.ms),
        );
    }
    const candles = [...(stored?.values() ?? [])]
      .filter((c) => c.t >= first && c.t <= last)
      .sort((a, b) => a.t - b.t);
    return { intervalMs: interval.ms, candles };
  }
}

/**
 * Bougies des marchés d'une fenêtre, rangées par marché du moteur. Un jeton sans paire cotée en
 * trésorerie est laissé de côté : le moteur le nommera « sans cours » plutôt que de le deviner.
 */
export async function loadPriceBook(
  cache: CandleCache,
  fetcher: CandleFetcher,
  held: { perps: readonly string[]; tokens: readonly string[] },
  plan: DetailPlan,
  coinOfToken: (token: string) => string | null,
  now: number,
  signal?: AbortSignal,
): Promise<PriceBook> {
  const book: Record<string, PriceSeries> = {};
  for (const coin of held.perps)
    book[perpMarket(coin)] = await cache.series(fetcher, coin, plan.interval, plan, now, signal);
  for (const token of held.tokens) {
    const coin = coinOfToken(token);
    if (coin)
      book[tokenMarket(token)] = await cache.series(
        fetcher,
        coin,
        plan.interval,
        plan,
        now,
        signal,
      );
  }
  return book;
}

/** Fusionne des plages qui se chevauchent ou se touchent (à un pas près). */
function mergeRanges(ranges: readonly TimeRange[], step: number): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to + step) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}
