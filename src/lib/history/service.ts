/**
 * Chargement des historiques quotidiens : cache d'abord, fournisseurs uniquement pour la partie
 * manquante (tête et/ou queue), fusion avec priorité à l'ordre des fournisseurs (le premier qui
 * cote l'actif comble ce qu'il peut, les suivants ne servent qu'aux bords encore vides), trous
 * comblés par report de la dernière valeur connue (`filled: true`), écriture du cache.
 * Intraday (période 1J) en cache mémoire 10 min.
 */
import type { AssetCode } from '../domain/types';
import { EUR_PEGGED } from '../pricing/tickers';
import { addDays, eachDay, maxDay, minDay, todayOf } from './days';
import { abortError, throwIfAborted } from './queue';
import type {
  DailyPoint,
  DayString,
  HistoryProvider,
  HistoryStore,
  IntradayPoint,
  PriceHistory,
} from './types';

export interface LoadProgress {
  asset: AssetCode;
  done: number;
  total: number;
}

export interface LoadOptions {
  store: HistoryStore;
  providers: HistoryProvider[];
  now: () => number;
  onProgress?: (progress: LoadProgress) => void;
  /** Âge maximal du dernier point en cache avant de rafraîchir la queue (défaut 1 h). */
  maxAgeMs?: number;
  /** Délai avant de redemander une tête absente chez tous les fournisseurs (défaut 7 j). */
  reprobeAfterMs?: number;
  /** Délai maximal d'un appel fournisseur (défaut 30 s). */
  timeoutMs?: number;
  /** Actifs traités en parallèle (défaut 2 ; chaque fournisseur sérialise ses requêtes). */
  concurrency?: number;
  signal?: AbortSignal;
}

export interface LoadResult {
  histories: Record<AssetCode, PriceHistory>;
  /** Actifs sans aucun point (inconnus de tous les fournisseurs). */
  missing: AssetCode[];
  /** Actifs dont l'historique commence après `fromDay` (cotés plus tard ou profondeur limitée). */
  partial: AssetCode[];
  errors: string[];
}

interface DayRange {
  from: DayString;
  to: DayString;
}

interface Context {
  store: HistoryStore;
  providers: HistoryProvider[];
  now: () => number;
  maxAgeMs: number;
  reprobeAfterMs: number;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  errors: string[];
}

const DEFAULT_MAX_AGE_MS = 3_600_000;
const DEFAULT_REPROBE_MS = 7 * 86_400_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const INTRADAY_TTL_MS = 600_000;

/** Source des actifs à parité euro (1 € par construction, jamais mis en cache). */
export const PEGGED_SOURCE = 'parité €';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Actif valant 1 € par construction (euro ou stablecoin à parité euro). */
export function isEurPegged(asset: AssetCode): boolean {
  return asset === 'eur' || EUR_PEGGED.has(asset);
}

function peggedHistory(
  asset: AssetCode,
  from: DayString,
  to: DayString,
  nowMs: number,
): PriceHistory {
  return {
    asset,
    points: eachDay(from, to).map((day) => ({ day, priceEur: '1' })),
    source: PEGGED_SOURCE,
    fetchedAt: new Date(nowMs).toISOString(),
    from,
    to,
    probedFrom: from,
  };
}

/** Exécute `task` avec un signal combinant annulation externe et délai maximal. */
async function withTimeout<T>(ctx: Context, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  throwIfAborted(ctx.signal);
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(abortError(ctx.signal));
  ctx.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error(`délai dépassé (${ctx.timeoutMs} ms)`)),
    ctx.timeoutMs,
  );
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Comble les jours manquants entre le premier et le dernier point par report de la dernière
 * valeur connue (`filled: true`). Les points d'entrée doivent avoir des jours distincts.
 */
export function fillGaps(points: readonly DailyPoint[]): DailyPoint[] {
  const sorted = [...points].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const filled: DailyPoint[] = [];
  let previous: DailyPoint | null = null;
  for (const point of sorted) {
    if (previous) {
      for (let day = addDays(previous.day, 1); day < point.day; day = addDays(day, 1)) {
        filled.push({ day, priceEur: previous.priceEur, filled: true });
      }
    }
    filled.push(point);
    previous = point;
  }
  return filled;
}

/** Bords de `range` non couverts : tête avant le premier jour connu, queue après le dernier. */
function uncoveredEdges(range: DayRange, covered: ReadonlyMap<DayString, DailyPoint>): DayRange[] {
  if (covered.size === 0) return [range];
  let first = range.to;
  let last = range.from;
  for (const day of covered.keys()) {
    if (day < first) first = day;
    if (day > last) last = day;
  }
  const edges: DayRange[] = [];
  if (range.from < first) edges.push({ from: range.from, to: addDays(first, -1) });
  if (last < range.to) edges.push({ from: addDays(last, 1), to: range.to });
  return edges;
}

interface FetchOutcome {
  points: Map<DayString, DailyPoint>;
  sources: string[];
  failed: boolean;
}

/** Interroge les fournisseurs dans l'ordre ; chacun ne reçoit que les bords encore vides. */
async function fetchFromProviders(
  asset: AssetCode,
  range: DayRange,
  ctx: Context,
): Promise<FetchOutcome> {
  const points = new Map<DayString, DailyPoint>();
  const sources: string[] = [];
  let failed = false;
  const today = todayOf(ctx.now());
  for (const provider of ctx.providers) {
    const remaining = uncoveredEdges(range, points);
    if (remaining.length === 0) break;
    try {
      const supports = provider.supports;
      if (supports && !(await withTimeout(ctx, (s) => supports.call(provider, asset, s)))) continue;
      let added = false;
      for (const edge of remaining) {
        const from =
          provider.maxDays === null
            ? edge.from
            : maxDay(edge.from, addDays(today, -(provider.maxDays - 1)));
        if (from > edge.to) continue;
        const fetched = await withTimeout(ctx, (s) => provider.fetchDaily(asset, from, edge.to, s));
        for (const point of fetched) {
          if (point.day < from || point.day > edge.to || points.has(point.day)) continue;
          points.set(point.day, { day: point.day, priceEur: point.priceEur });
          added = true;
        }
      }
      if (added) sources.push(provider.name);
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      failed = true;
      ctx.errors.push(`${provider.name} (${asset}) : ${messageOf(error)}`);
    }
  }
  return { points, sources, failed };
}

function orderedSources(ctx: Context, sources: Iterable<string>): string {
  const rank = new Map(ctx.providers.map((provider, index) => [provider.name, index]));
  return [...new Set(sources)]
    .sort((a, b) => (rank.get(a) ?? ctx.providers.length) - (rank.get(b) ?? ctx.providers.length))
    .join('+');
}

/** Historique d'un actif : cache + compléments ; `null` si aucun point nulle part. */
async function loadAsset(
  asset: AssetCode,
  fromDay: DayString,
  toDay: DayString,
  ctx: Context,
): Promise<PriceHistory | null> {
  const nowMs = ctx.now();
  if (isEurPegged(asset)) return peggedHistory(asset, fromDay, toDay, nowMs);

  let cached: PriceHistory | null = null;
  try {
    cached = await ctx.store.getDaily(asset);
  } catch (error) {
    ctx.errors.push(`cache (${asset}) : ${messageOf(error)}`);
  }
  const real = new Map<DayString, DailyPoint>();
  for (const point of cached?.points ?? []) {
    if (!point.filled) real.set(point.day, { day: point.day, priceEur: point.priceEur });
  }
  const parsedAge = cached ? nowMs - Date.parse(cached.fetchedAt) : Number.POSITIVE_INFINITY;
  const age = Number.isFinite(parsedAge) ? parsedAge : Number.POSITIVE_INFINITY;
  const probed = cached?.probedFrom;

  const ranges: DayRange[] = [];
  if (real.size === 0) {
    const known = probed !== undefined && probed <= fromDay && age <= ctx.reprobeAfterMs;
    if (!known) ranges.push({ from: fromDay, to: toDay });
  } else {
    const days = [...real.keys()].sort();
    const first = days[0]!;
    const last = days[days.length - 1]!;
    if (fromDay < first && (probed === undefined || fromDay < probed || age > ctx.reprobeAfterMs)) {
      ranges.push({ from: fromDay, to: addDays(first, -1) });
    }
    // On redemande le dernier jour connu : sa clôture était peut-être encore provisoire.
    if (toDay > last || (toDay === last && age > ctx.maxAgeMs)) {
      ranges.push({ from: last, to: toDay });
    }
  }

  const sources = new Set((cached?.source ?? '').split('+').filter(Boolean));
  let failed = false;
  for (const range of ranges) {
    const outcome = await fetchFromProviders(asset, range, ctx);
    for (const [day, point] of outcome.points) real.set(day, point); // frais > cache
    for (const source of outcome.sources) sources.add(source);
    failed = failed || outcome.failed;
  }
  const fetched = ranges.length > 0;

  if (real.size === 0) {
    if (fetched && !failed) {
      const stub: PriceHistory = {
        asset,
        points: [],
        source: '',
        fetchedAt: new Date(nowMs).toISOString(),
        from: fromDay,
        to: toDay,
        probedFrom: minDay(fromDay, probed ?? fromDay),
      };
      await writeCache(ctx, stub);
    }
    return null;
  }

  const points = fillGaps([...real.values()]);
  const first = points[0]!.day;
  const last = points[points.length - 1]!.day;
  let probedFrom = probed;
  if (fetched && !failed) probedFrom = minDay(fromDay, probed ?? first);
  const history: PriceHistory = {
    asset,
    points,
    source: orderedSources(ctx, sources),
    fetchedAt: fetched ? new Date(nowMs).toISOString() : cached!.fetchedAt,
    from: first,
    to: last,
    ...(probedFrom !== undefined ? { probedFrom } : {}),
  };
  if (fetched) await writeCache(ctx, history);
  return history;
}

async function writeCache(ctx: Context, history: PriceHistory): Promise<void> {
  try {
    await ctx.store.putDaily(history);
  } catch (error) {
    ctx.errors.push(`cache (${history.asset}) : ${messageOf(error)}`);
  }
}

export async function loadDailyHistory(
  assets: AssetCode[],
  fromDay: DayString,
  toDay: DayString,
  options: LoadOptions,
): Promise<LoadResult> {
  if (fromDay > toDay) throw new RangeError(`Période invalide : ${fromDay} > ${toDay}`);
  const ctx: Context = {
    store: options.store,
    providers: options.providers,
    now: options.now,
    maxAgeMs: options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    reprobeAfterMs: options.reprobeAfterMs ?? DEFAULT_REPROBE_MS,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: options.signal,
    errors: [],
  };
  const unique = [...new Set(assets)];
  const histories: Record<AssetCode, PriceHistory> = {};
  const missing: AssetCode[] = [];
  const partial: AssetCode[] = [];
  const pending = [...unique];
  let done = 0;

  const worker = async (): Promise<void> => {
    for (let asset = pending.shift(); asset !== undefined; asset = pending.shift()) {
      throwIfAborted(ctx.signal);
      const history = await loadAsset(asset, fromDay, toDay, ctx);
      if (history === null) missing.push(asset);
      else {
        histories[asset] = history;
        if (history.from > fromDay) partial.push(asset);
      }
      done++;
      options.onProgress?.({ asset, done, total: unique.length });
    }
  };
  const workers = Math.max(1, Math.min(options.concurrency ?? 2, unique.length));
  await Promise.all(Array.from({ length: workers }, worker));

  const rank = new Map(unique.map((asset, index) => [asset, index]));
  const byInput = (a: AssetCode, b: AssetCode): number => rank.get(a)! - rank.get(b)!;
  return {
    histories,
    missing: missing.sort(byInput),
    partial: partial.sort(byInput),
    errors: ctx.errors,
  };
}

export interface IntradayOptions {
  providers: HistoryProvider[];
  now: () => number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface IntradayResult {
  asset: AssetCode;
  points: IntradayPoint[];
  source: string | null;
  errors: string[];
  /** Vrai si le résultat vient du cache mémoire (10 min). */
  cached: boolean;
}

const intradayCache = new Map<string, { atMs: number; result: IntradayResult }>();

export function clearIntradayCache(): void {
  intradayCache.clear();
}

/** Points des `hours` dernières heures (période 1J) ; premier fournisseur qui répond. */
export async function loadIntraday(
  asset: AssetCode,
  hours: number,
  options: IntradayOptions,
): Promise<IntradayResult> {
  const key = `${asset}:${hours}`;
  const nowMs = options.now();
  const hit = intradayCache.get(key);
  if (hit && nowMs - hit.atMs <= INTRADAY_TTL_MS) return { ...hit.result, cached: true };

  const errors: string[] = [];
  let points: IntradayPoint[] = [];
  let source: string | null = null;
  if (isEurPegged(asset)) {
    points = [
      { at: new Date(nowMs - hours * 3_600_000).toISOString(), priceEur: '1' },
      { at: new Date(nowMs).toISOString(), priceEur: '1' },
    ];
    source = PEGGED_SOURCE;
  } else {
    const ctx: Context = {
      store: null as unknown as HistoryStore,
      providers: options.providers,
      now: options.now,
      maxAgeMs: 0,
      reprobeAfterMs: 0,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: options.signal,
      errors,
    };
    for (const provider of options.providers) {
      const fetchIntraday = provider.fetchIntraday;
      if (!fetchIntraday) continue;
      try {
        const found = await withTimeout(ctx, (s) => fetchIntraday.call(provider, asset, hours, s));
        if (found.length > 0) {
          points = found;
          source = provider.name;
          break;
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        errors.push(`${provider.name} (${asset}) : ${messageOf(error)}`);
      }
    }
  }
  const result: IntradayResult = { asset, points, source, errors, cached: false };
  if (points.length > 0) intradayCache.set(key, { atMs: nowMs, result });
  return result;
}
