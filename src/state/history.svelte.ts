/** Historique des prix et séries d'évolution (portefeuille / actif) dans la devise d'affichage. */
import { nowIso, nowMs } from '$lib/clock';
import { isFiat } from '$lib/domain/assets';
import type { PositionReport } from '$lib/domain/engine';
import { D, ZERO, toDecimalString, type Big } from '$lib/domain/money';
import type { AssetCode } from '$lib/domain/types';
import {
  addDays,
  assetMetricPoints,
  createHistoryStore,
  dayOfNaive,
  defaultHistoryProviders,
  eachDay,
  holdingStep,
  holdingsByDay,
  isEurPegged,
  loadDailyHistory,
  loadIntraday,
  mergeLivePoint,
  todayOf,
  valueSeries,
  type DailyPoint,
  type FlowPoint,
  type HistoryStore,
  type HoldingOp,
  type IntradayPoint,
  type PriceHistory,
  type PriceSource,
  type ValuePoint,
} from '$lib/history';
import { intradayValueSeries, type IntradayValuePoint } from '$lib/history/intraday-series';
import type { MetricPoint } from '$lib/history/metrics';
import { app } from './app.svelte';

export interface HistoryStatus {
  loading: boolean;
  done: number;
  total: number;
  missing: AssetCode[];
  partial: AssetCode[];
  errors: string[];
  loadedAt: string | null;
  sources: string[];
}

export type Scope = 'portfolio' | AssetCode;

const INFLOW = ['buy', 'migration-in', 'deposit', 'opening-balance'];
const OUTFLOW = ['sell', 'migration-out', 'withdrawal'];

/** Au-delà de cet âge, la série 1J d'un actif est redemandée (le service garde un cache mémoire 10 min). */
export const INTRADAY_REFRESH_MS = 600_000;
/** Préfixe des erreurs intraday dans `status.errors` (remplacées à chaque rechargement). */
const INTRADAY_ERROR_PREFIX = 'Prix 24 h · ';

export class HistoryState {
  histories = $state<Record<AssetCode, PriceHistory>>({});
  status = $state<HistoryStatus>({
    loading: false,
    done: 0,
    total: 0,
    missing: [],
    partial: [],
    errors: [],
    loadedAt: null,
    sources: [],
  });
  intraday = $state<Record<AssetCode, IntradayPoint[]>>({});
  intradayLoading = $state<Record<AssetCode, boolean>>({});
  /** Horodatage (ms) du dernier chargement intraday par actif : fin de grille et rafraîchissement. */
  intradayLoadedAt = $state<Record<AssetCode, number>>({});
  private intradayErrors: Record<AssetCode, string[]> = {};
  private store: HistoryStore | null = null;
  private loadedKey = '';

  /** Toutes les positions du grand livre (hors devises), y compris clôturées et bloquées. */
  allPositions = $derived.by((): PositionReport[] => {
    const r = app.report;
    return [...r.positions, ...r.stablecoins, ...r.closed, ...r.blocked].filter(
      (p) => !isFiat(p.asset),
    );
  });
  assets = $derived(this.allPositions.map((p) => p.asset));
  firstDay = $derived.by((): string | null => this.firstDayOf(this.allPositions));

  private firstDayOf(positions: PositionReport[]): string | null {
    let min: string | null = null;
    for (const p of positions) {
      for (const h of p.history) {
        const day = dayOfNaive(h.at);
        if (min === null || day < min) min = day;
      }
    }
    return min;
  }

  private providers() {
    const overrides = Object.fromEntries(
      Object.entries(app.state.assetSettings).map(([a, s]) => [a, s.coingeckoId]),
    );
    return defaultHistoryProviders(overrides);
  }

  /** Erreurs du chargement quotidien suivies des erreurs intraday encore d'actualité. */
  private withIntradayErrors(errors: string[]): string[] {
    return [
      ...errors.filter((e) => !e.startsWith(INTRADAY_ERROR_PREFIX)),
      ...Object.values(this.intradayErrors)
        .flat()
        .map((e) => INTRADAY_ERROR_PREFIX + e),
    ];
  }

  /** Charge (ou complète) l'historique quotidien de tous les actifs du grand livre. */
  async ensure(): Promise<void> {
    const assets = this.assets;
    const from = this.firstDay;
    if (!from || assets.length === 0) return;
    const today = todayOf(nowMs());
    const key = `${assets.join(',')}|${from}|${today}`;
    if (this.status.loading || (this.loadedKey === key && this.status.loadedAt)) return;
    this.loadedKey = key;
    this.status = { ...this.status, loading: true, done: 0, total: assets.length, errors: [] };
    this.store ??= createHistoryStore();
    const result = await loadDailyHistory(assets, addDays(from, -1), today, {
      store: this.store,
      providers: this.providers(),
      now: nowMs,
      onProgress: (p) => {
        this.status = { ...this.status, done: p.done, total: p.total };
      },
    });
    this.histories = result.histories;
    this.status = {
      loading: false,
      done: assets.length,
      total: assets.length,
      missing: result.missing,
      partial: result.partial,
      errors: this.withIntradayErrors(result.errors),
      loadedAt: nowIso(),
      sources: Object.values(result.histories)
        .map((h) => h.source)
        .filter((source, index, all) => all.indexOf(source) === index),
    };
  }

  /**
   * Charge les 24 dernières heures des actifs demandés, et les recharge au-delà de
   * `INTRADAY_REFRESH_MS`. Les échecs des fournisseurs ne sont signalés que s'ils ont privé
   * l'actif de toute donnée.
   */
  async ensureIntraday(assets: AssetCode[]): Promise<void> {
    const now = nowMs();
    const pending = assets.filter((a) => {
      if (this.intradayLoading[a]) return false;
      const loadedAt = this.intradayLoadedAt[a];
      return loadedAt === undefined || now - loadedAt > INTRADAY_REFRESH_MS;
    });
    if (pending.length === 0) return;
    this.intradayLoading = {
      ...this.intradayLoading,
      ...Object.fromEntries(pending.map((a) => [a, true])),
    };
    const providers = this.providers();
    for (const asset of pending) {
      const result = await loadIntraday(asset, 24, { providers, now: nowMs });
      this.intraday = { ...this.intraday, [asset]: result.points };
      this.intradayLoadedAt = { ...this.intradayLoadedAt, [asset]: nowMs() };
      this.intradayLoading = { ...this.intradayLoading, [asset]: false };
      this.intradayErrors[asset] = result.points.length === 0 ? result.errors : [];
    }
    this.status = { ...this.status, errors: this.withIntradayErrors(this.status.errors) };
  }

  private positionsFor(scope: Scope): PositionReport[] {
    return scope === 'portfolio'
      ? this.allPositions
      : this.allPositions.filter((p) => p.asset === scope);
  }

  /** Multiplicateur devise du jour (1 en euros). */
  private rateOf(day: string): string {
    return app.currency === 'EUR' ? '1' : (app.fxLookup.rate(day) ?? '1');
  }

  /** Cotation du jour (devise d'affichage), `null` si absente ou antérieure à aujourd'hui (UTC). */
  private liveQuote(asset: AssetCode, today: string): string | null {
    const quote = app.displayQuotes[asset];
    return quote !== undefined && quote.at.slice(0, 10) >= today ? quote.priceEur : null;
  }

  /**
   * Prix quotidiens dans la devise d'affichage. Le point du jour est la cotation live de
   * l'application quand elle existe (sinon la clôture provisoire du fournisseur), pour que le
   * dernier point de la courbe coïncide avec la valeur affichée en tête de page.
   */
  private pricesFor(assets: AssetCode[], today: string): Record<AssetCode, PriceSource> {
    const out: Record<AssetCode, PriceSource> = {};
    for (const asset of assets) {
      const h = this.histories[asset];
      const live = this.liveQuote(asset, today);
      if (!h && live === null) continue;
      let points: readonly DailyPoint[] = !h
        ? []
        : app.currency === 'EUR'
          ? h.points
          : h.points.map((p) => ({
              ...p,
              priceEur: toDecimalString(D(p.priceEur).times(this.rateOf(p.day))),
            }));
      if (live !== null) points = mergeLivePoint(points, today, live);
      out[asset] = { points };
    }
    return out;
  }

  /** Vrai si chaque actif détenu du périmètre a une cotation du jour : le dernier point est « live ». */
  lastPointIsLive(scope: Scope): boolean {
    const today = todayOf(nowMs());
    return this.positionsFor(scope)
      .filter((p) => p.qty.gt(ZERO))
      .every((p) => isEurPegged(p.asset) || this.liveQuote(p.asset, today) !== null);
  }

  /** Série quotidienne valeur / coût, de la veille de la première opération à aujourd'hui. */
  dailySeries(scope: Scope): ValuePoint[] {
    const positions = this.positionsFor(scope);
    const firstDay = this.firstDayOf(positions);
    if (firstDay === null) return [];
    const ops: Record<AssetCode, HoldingOp[]> = {};
    for (const p of positions) ops[p.asset] = [...p.history].reverse();
    const today = todayOf(nowMs());
    return valueSeries({
      holdings: holdingsByDay(ops),
      prices: this.pricesFor(Object.keys(ops), today),
      days: eachDay(addDays(firstDay, -1), today),
    });
  }

  /** Apports (+) et retraits (−) par jour, pour la performance hors apports. */
  flows(scope: Scope): FlowPoint[] {
    const byDay: Record<string, Big> = {};
    const add = (day: string, amount: Big): void => {
      byDay[day] = (byDay[day] ?? ZERO).plus(amount);
    };
    if (scope === 'portfolio') {
      for (const e of app.displayEvents) {
        const day = dayOfNaive(e.at);
        if (e.kind === 'trade' && isFiat(e.out.asset)) add(day, D(e.valueEur));
        else if (e.kind === 'trade' && isFiat(e.in.asset)) add(day, D(e.valueEur).neg());
        else if (e.kind === 'deposit' && e.costEur) add(day, D(e.costEur));
        else if (e.kind === 'opening-balance') add(day, D(e.costEur));
        else if (e.kind === 'withdrawal' && e.proceedsEur) add(day, D(e.proceedsEur).neg());
      }
    } else {
      for (const p of this.positionsFor(scope)) {
        for (const h of p.history) {
          if (!h.valueEur) continue;
          if (INFLOW.includes(h.kind)) add(dayOfNaive(h.at), h.valueEur);
          else if (OUTFLOW.includes(h.kind)) add(dayOfNaive(h.at), h.valueEur.neg());
        }
      }
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, amountEur]) => ({ day, amountEur }));
  }

  /** Points de métrique quotidiens : valeur, coût, et pour un actif quantité + prix de marché. */
  metricPoints(scope: Scope): MetricPoint[] {
    if (scope === 'portfolio') {
      return this.dailySeries(scope).map((p) => ({
        day: p.day,
        value: p.value,
        cost: p.cost,
        qty: null,
        price: null,
        estimated: p.missing.length > 0,
      }));
    }
    const positions = this.positionsFor(scope);
    const firstDay = this.firstDayOf(positions);
    if (firstDay === null) return [];
    const today = todayOf(nowMs());
    return assetMetricPoints({
      step: holdingStep(positions.flatMap((p) => [...p.history].reverse())),
      points: this.pricesFor([scope], today)[scope]?.points ?? [],
      days: eachDay(addDays(firstDay, -1), today),
    });
  }

  /** Points intraday (24 h) : quantité et coût actuels, prix reconstitué. */
  intradayMetricPoints(scope: Scope): MetricPoint[] {
    const series = this.intradaySeries(scope);
    const positions = this.positionsFor(scope).filter((p) => p.qty.gt('0'));
    const qty = scope === 'portfolio' ? null : (positions[0]?.qty ?? null);
    return series.map((p) => ({
      day: p.at,
      value: p.value,
      cost: p.cost,
      qty,
      price: qty && qty.gt('0') ? p.value.div(qty) : null,
      estimated: false,
    }));
  }

  /** Série des dernières 24 h (pas de 15 min) à partir des avoirs actuels. */
  intradaySeries(scope: Scope): IntradayValuePoint[] {
    const positions = this.positionsFor(scope).filter((p) => p.qty.gt('0'));
    // Fin de grille = dernier chargement : la série glisse à chaque rafraîchissement (réactif).
    let to = 0;
    for (const p of positions) to = Math.max(to, this.intradayLoadedAt[p.asset] ?? 0);
    if (to === 0) to = nowMs();
    return intradayValueSeries({
      points: Object.fromEntries(positions.map((p) => [p.asset, this.intraday[p.asset] ?? []])),
      qty: Object.fromEntries(positions.map((p) => [p.asset, p.qty])),
      cost: Object.fromEntries(positions.map((p) => [p.asset, p.costBasis])),
      rate: this.rateOf(todayOf(to)),
      fromMs: to - 24 * 3_600_000,
      toMs: to,
      stepMs: 15 * 60_000,
    });
  }
}

export const history = new HistoryState();
