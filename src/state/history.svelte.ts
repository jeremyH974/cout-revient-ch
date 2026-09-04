/** Historique des prix et séries d'évolution (portefeuille / actif) dans la devise d'affichage. */
import { nowIso, nowMs } from '$lib/clock';
import { isFiat } from '$lib/domain/assets';
import type { PositionReport } from '$lib/domain/engine';
import { D, ZERO, toDecimalString, type Big, type DecimalString } from '$lib/domain/money';
import { estimateSpread, type SpreadEstimate } from '$lib/domain/spread';
import { computeFrenchTax, type TaxLedger } from '$lib/domain/tax-fr';
import type { AssetCode } from '$lib/domain/types';
import { toEurAtDay } from '$lib/fx';
import {
  addDays,
  assetMetricPoints,
  createHistoryStore,
  dayOfNaive,
  defaultHistoryProviders,
  eachDay,
  holdingOpsOf,
  holdingStep,
  holdingsByDay,
  isEurPegged,
  lastPointAtOrBefore,
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
import { pruneHistory } from '$lib/history/evict';
import { intradayValueSeries, type IntradayValuePoint } from '$lib/history/intraday-series';
import type { MetricPoint } from '$lib/history/metrics';
import {
  cumulativeContributions,
  netWorthSeries,
  tradingEquityContribution,
  valueSeriesContribution,
  type Contribution,
  type NetWorthPoint,
} from '$lib/history/net-worth';
import { computePerformance, toBenchmarkPrices } from '$lib/history/performance';
import { rateLookup } from '$lib/fx/convert';
import { msToParisDay } from '$lib/import/time';
import type { ReportPerformance } from '$lib/export/report-model';
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
  /** Actifs des trades (aller-retours) : leurs symboles ont aussi droit à un historique de prix. */
  private tradeAssets = $derived.by((): AssetCode[] => {
    const seen: AssetCode[] = [];
    for (const t of app.roundTrips) {
      const asset = t.trip.symbol.toLowerCase();
      if (!seen.includes(asset)) seen.push(asset);
    }
    return seen;
  });
  assets = $derived.by((): AssetCode[] => {
    const list = this.allPositions.map((p) => p.asset);
    for (const asset of this.tradeAssets) if (!list.includes(asset)) list.push(asset);
    return list;
  });
  firstDay = $derived.by((): string | null => {
    let min = this.firstDayOf(this.allPositions);
    for (const t of app.roundTrips) {
      const day = dayOfNaive(t.trip.openedAt);
      if (min === null || day < min) min = day;
    }
    return min;
  });

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
    // Conversion USD → EUR au taux BCE du jour, pour le fournisseur profond DefiLlama — seul de la
    // couche à coter en dollars (décision n° 42). On lit `fx.rates.USD` directement : `app.fxLookup`
    // suit la **devise d'affichage** et serait vide dès que l'utilisateur affiche en euros, alors
    // que la série USD est chargée dans tous les cas (elle sert déjà aux prix spot en dollars).
    return defaultHistoryProviders(overrides, toEurAtDay(app.state.fx.rates.USD ?? {}));
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
    // Le fournisseur profond cote en dollars : sans la série de taux, tous ses points seraient
    // écartés. L'appel est dédoublonné et mis en cache par `ensureRates`.
    await app.ensureRates('USD');
    this.store ??= createHistoryStore();
    // Le cache ne connaissait que l'ajout (décision n° 88). On purge AVANT de charger, et seulement
    // ici : `assets` est non vide (garde ligne 158), donc la liste suivie est bien celle d'un
    // rapport calculé, pas celle d'un démarrage à froid.
    void pruneHistory(this.store, assets);
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
    const internal = app.internalTransferLegs;
    for (const p of positions) ops[p.asset] = holdingOpsOf([...p.history].reverse(), internal);
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

  /**
   * Les producteurs de valeur du patrimoine (P38). Les avoirs d'investissement viennent du grand
   * livre au pas quotidien ; chaque compte de trading vient de la plateforme, rééchantillonné au
   * jour. Demain, P36 (actif valorisé) et P41 (actions, ETF) ajouteront un producteur ici, et rien
   * d'autre ne bougera — c'est la raison d'être de cette forme.
   *
   * Les **apports** de chaque producteur sont ses flux externes cumulés, jamais son assiette de
   * coût (décision n° 55). Les virements internes s'annulent d'eux-mêmes : un retrait d'USDC de
   * l'espace Investissement vers la plateforme de trading sort d'un côté et rentre de l'autre.
   */
  netWorthContributions = $derived.by((): Contribution[] => {
    const investPoints = this.dailySeries('portfolio');
    const list: Contribution[] = [
      valueSeriesContribution(
        'invest',
        'Investissement',
        investPoints,
        cumulativeContributions(this.flows('portfolio')),
      ),
    ];
    const usd = rateLookup(app.state.fx.rates.USD ?? {});
    // Même unité que le côté Investissement, que `pricesFor` a déjà converti dans la devise
    // d'affichage : en dollars il ne faut PAS diviser. Même règle qu'à `Trading.svelte:105`.
    const usdPerDisplay = (day: string): DecimalString | null =>
      app.currency === 'USD' ? '1' : usd.rate(day);
    const today = todayOf(nowMs());
    for (const account of app.hlAccounts) {
      const data = app.state.hyperliquid.accounts[account.id];
      const series = data?.portfolio?.['allTime'];
      const equity = data?.snapshot?.perps.accountValue ?? null;
      /*
       * Un compte sans série ET sans instantané reste dans la liste (décision n° 97). Il en
       * sortait, et c'était la disparition la plus trompeuse de l'écran : ses apports quittaient
       * le total avec lui, sans un mot. Sa contribution rend désormais `null` chaque jour, ce qui
       * la marque `unavailable` : la ligne existe, dit « non valorisé », et le total se déclare
       * incomplet.
       */
      const cash = app.hlNormalized[account.id]?.trading.cashFlows ?? [];
      /*
       * TOUS les mouvements de trésorerie, et pas seulement les dépôts et retraits : la
       * contribution suit l'**équité du compte perps**, or un virement vers le spot ou vers un
       * coffre en sort tout autant qu'un retrait vers l'extérieur. C'est exactement le `netFlows`
       * sur lequel `computeTradingAccount` bâtit sa propre réconciliation, et c'est ce qui rend
       * l'égalité vérifiable : `équité − apports = réalisé − frais + funding + latent`.
       *
       * Ne retenir que dépôts et retraits comptait un virement perps → spot comme une perte de
       * plusieurs centaines d'euros. Les avoirs spot ne sont pas dans la courbe (sauf option
       * « traiter le spot comme de l'investissement », qui les fait entrer par le grand livre) :
       * les sortir des apports en même temps que de la valeur est la seule lecture cohérente.
       */
      const flows: FlowPoint[] = cash.map((c) => ({
        day: dayOfNaive(c.at),
        amountEur: D(c.amount),
      }));
      const cumulativeUsd = cumulativeContributions(flows);
      const reconciliationGap =
        app.tradingReport.accounts.find((a) => a.accountId === account.id)?.reconciliation?.gap ??
        null;
      list.push(
        tradingEquityContribution({
          id: account.id,
          // Préfixé par l'espace : sans lui, une ligne « Investissement » côtoie une ligne portant
          // un nom de compte, et le lecteur compare deux niveaux différents sans le savoir.
          label: `Trading · ${account.label}`,
          history: series?.accountValueHistory ?? [],
          dayOfMs: msToParisDay,
          usdPerDisplay,
          contributedAt: (day) => {
            const rate = usdPerDisplay(day);
            const divisor = rate === null ? null : D(rate);
            return divisor === null || !divisor.gt(ZERO) ? ZERO : cumulativeUsd(day).div(divisor);
          },
          // L'instantané est plus frais que la dernière clôture servie par `portfolio` : sans ce
          // remplacement, le dernier point divergerait du total affiché dans le bandeau.
          live: equity === null ? null : { day: today, usd: equity },
          // L'écart que le moteur calcule déjà pour ce compte : au-delà du résultat lui-même, il
          // interdit d'en déduire un (décision n° 97).
          gap:
            reconciliationGap === null
              ? null
              : { day: today, usd: toDecimalString(reconciliationGap) },
        }),
      );
    }
    return list;
  });

  /**
   * Courbe de valeur nette consolidée. Définie ICI et non dans le graphique : le bandeau de la Vue
   * d'ensemble, la carte d'évolution et la réconciliation doivent lire la MÊME série, sinon deux
   * chiffres qui devraient être le même finissent par diverger.
   */
  netWorth = $derived.by((): NetWorthPoint[] => {
    const investPoints = this.dailySeries('portfolio');
    if (investPoints.length === 0) return [];
    return netWorthSeries({
      contributions: this.netWorthContributions,
      days: investPoints.map((p) => p.day),
    });
  });

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
      step: holdingStep(
        positions.flatMap((p) => holdingOpsOf([...p.history].reverse(), app.internalTransferLegs)),
      ),
      points: this.pricesFor([scope], today)[scope]?.points ?? [],
      days: eachDay(addDays(firstDay, -1), today),
    });
  }

  /**
   * Performance du Rapport : TWR du portefeuille et repère « mêmes apports sur un seul actif ».
   * Nécessite l'historique quotidien (`ensure()`) ; sans cotation du repère, seul le TWR est rendu.
   */
  performance(benchmarkAsset: AssetCode = 'btc'): ReportPerformance {
    const today = todayOf(nowMs());
    const prices = toBenchmarkPrices(
      this.pricesFor([benchmarkAsset], today)[benchmarkAsset]?.points ?? [],
    );
    return computePerformance({
      series: this.metricPoints('portfolio'),
      cashFlows: app.report.cashFlows,
      internalTransferLegs: app.internalTransferLegs,
      benchmark: prices.length > 0 ? { asset: benchmarkAsset, prices } : null,
      partialAssets: this.status.partial.length + this.status.missing.length,
    });
  }

  /**
   * Estimation fiscale française (décision n° 43) : rejoue les cessions avec la méthode globale de
   * l'article 150 VH bis. Toujours EN EUROS, quelle que soit la devise d'affichage — c'est une
   * obligation française. Nécessite l'historique quotidien (`ensure()`) pour connaître la valeur
   * globale du portefeuille au jour de chaque cession passée ; sans lui, le module le dit au lieu
   * d'inventer une plus-value.
   */
  frenchTax(): TaxLedger {
    // Un Record plutôt qu'une Map : la règle `prefer-svelte-reactivity` proscrit `new Map` ici.
    const closingByDay: Record<string, Big> = {};
    for (const point of this.metricPoints('portfolio')) {
      const day = point.day.slice(0, 10);
      const eur = app.eurFromDisplay(point.value, day);
      if (eur !== null) closingByDay[day] = eur;
    }
    const annotations: Record<string, DecimalString | null> = {};
    for (const [id, entry] of Object.entries(app.state.taxAnnotations))
      annotations[id] = entry.portfolioValueEur;
    return computeFrenchTax({
      // `app.events` est le grand livre en euros ; `displayEvents` serait converti.
      events: app.events,
      closingValueAt: (day) => closingByDay[day] ?? null,
      annotations,
    });
  }

  /**
   * Spread implicite (décision n° 49) : compare le prix affiché par Coinhouse au cours de
   * référence du jour. Un point REPORTÉ (`filled` : jour sans cotation) est écarté — comparer une
   * opération à un cours de la veille ajouterait un jour entier de mouvement au bruit mesuré.
   */
  spread(): SpreadEstimate {
    return estimateSpread(app.events, (asset, day) => {
      const points = this.histories[asset]?.points;
      if (!points) return null;
      const point = lastPointAtOrBefore(points, day);
      if (!point || point.day !== day || point.filled === true) return null;
      return D(point.priceEur);
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
