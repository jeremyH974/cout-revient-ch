/** Rafraîchissement incrémental du cache de taux (tête manquante → tout ; sinon queue). */
import type { Currency, FxCache, FxProvider, RateSeries } from './types';

export interface RefreshRatesOptions {
  provider: FxProvider;
  fromDay: string;
  toDay: string;
  now: () => number;
  timeoutMs?: number;
  /** Ne pas re-demander la queue si la dernière mise à jour est plus récente (ms). */
  minIntervalMs?: number;
}

export interface RefreshRatesResult {
  cache: FxCache;
  fetched: boolean;
  error: string | null;
}

const SLACK_DAYS = 4; // week-ends et jours fériés BCE

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export function seriesBounds(series: RateSeries): { first: string; last: string } | null {
  const days = Object.keys(series).sort();
  const first = days[0];
  const last = days[days.length - 1];
  return first && last ? { first, last } : null;
}

export async function refreshRates(
  currency: Currency,
  cache: FxCache,
  options: RefreshRatesOptions,
): Promise<RefreshRatesResult> {
  if (currency === 'EUR') return { cache, fetched: false, error: null };
  const existing = cache.rates[currency] ?? {};
  const bounds = seriesBounds(existing);
  const headMissing = !bounds || bounds.first > addDays(options.fromDay, SLACK_DAYS);
  const tailStale = !bounds || bounds.last < addDays(options.toDay, -SLACK_DAYS);
  const updatedAt = cache.updatedAt[currency];
  const recentlyUpdated =
    updatedAt !== undefined &&
    options.now() - Date.parse(updatedAt) < (options.minIntervalMs ?? 6 * 3_600_000);
  if (!headMissing && (!tailStale || recentlyUpdated))
    return { cache, fetched: false, error: null };

  const fromDay = headMissing ? options.fromDay : bounds!.last;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const fresh = await options.provider.fetchRange(
      currency,
      fromDay,
      options.toDay,
      controller.signal,
    );
    const merged: RateSeries = { ...existing, ...fresh };
    return {
      cache: {
        ...cache,
        rates: { ...cache.rates, [currency]: merged },
        updatedAt: { ...cache.updatedAt, [currency]: new Date(options.now()).toISOString() },
        source: options.provider.name,
      },
      fetched: true,
      error: null,
    };
  } catch (error) {
    return { cache, fetched: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
