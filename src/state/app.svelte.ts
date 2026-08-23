import { nowIso, nowMs } from '$lib/clock';
import {
  convertEvents,
  convertQuotes,
  earliestDay,
  frankfurterProvider,
  rateLookup,
  refreshRates,
  toEurConverter,
  type Currency,
} from '$lib/fx';
/**
 * Store applicatif (Svelte 5 runes) : état persisté + dérivés (événements, rapport, prix).
 * Les routes ne calculent rien : elles lisent `app.report`.
 */
import { computePortfolio, type PortfolioReport, type PriceQuoteInput } from '$lib/domain/engine';
import type {
  AssetCode,
  EventId,
  LedgerEvent,
  ManualEvent,
  Qualification,
  RowKey,
} from '$lib/domain/types';
import { balanceRecords } from '$lib/import/coinhouse/balances';
import { importCoinhouseCsv } from '$lib/import/coinhouse/index';
import { normalizeCoinhouseRows } from '$lib/import/coinhouse/normalize';
import { manualToLedgerEvent } from '$lib/import/manual';
import { defaultPriceProviders, refreshPrices } from '$lib/pricing';
import { mergeStates, parseBackup, serializeBackup } from '$lib/storage/json-io';
import {
  clearState,
  loadState,
  requestPersistentStorage,
  saveState,
} from '$lib/storage/local-storage';
import {
  emptyState,
  type AssetSettings,
  type StoredStateV1,
  type UiSettings,
} from '$lib/storage/schema';

export interface PriceStatus {
  loading: boolean;
  /** null = jamais tenté. */
  online: boolean | null;
  errors: string[];
  missing: AssetCode[];
  lastRefreshAt: string | null;
}

export interface QualifiedSummary {
  eventId: EventId;
  qualification: Qualification;
  at: string | null;
  rawType: string | null;
  lineNumbers: number[];
}

const EPOCH = '1970-01-01T00:00:00.000Z';
const PRICE_MAX_AGE_MS = 10 * 60_000;
const SAVE_DEBOUNCE_MS = 300;

export class AppState {
  state = $state<StoredStateV1>(emptyState());
  loadStatus = $state<'empty' | 'ok' | 'corrupt'>('empty');
  loadError = $state<string | null>(null);
  saveError = $state<string | null>(null);
  priceStatus = $state<PriceStatus>({
    loading: false,
    online: null,
    errors: [],
    missing: [],
    lastRefreshAt: null,
  });
  liveQuotes = $state<Record<AssetCode, PriceQuoteInput>>({});
  fxStatus = $state<{ loading: boolean; error: string | null }>({ loading: false, error: null });

  events = $derived.by((): LedgerEvent[] => {
    const { events } = normalizeCoinhouseRows(
      Object.values(this.state.rawRows),
      this.state.qualifications,
    );
    for (const manual of Object.values(this.state.manualEvents))
      events.push(manualToLedgerEvent(manual));
    return events;
  });

  /** Cotations utilisées par le moteur : prix manuels > cotations fraîches > cache. */
  quotes = $derived.by((): Record<AssetCode, PriceQuoteInput> => {
    const result: Record<AssetCode, PriceQuoteInput> = {
      ...this.state.priceCache,
      ...this.liveQuotes,
    };
    for (const [asset, settings] of Object.entries(this.state.assetSettings)) {
      if (settings.manualPriceEur) {
        result[asset] = {
          asset,
          priceEur: settings.manualPriceEur,
          at: settings.manualPriceAt ?? EPOCH,
          source: 'manuel',
          stale: false,
        };
      }
    }
    return result;
  });

  /** Devise d'affichage effective : l'euro si les taux de la devise choisie manquent. */
  currency = $derived.by((): Currency => {
    const wanted = this.state.ui.displayCurrency;
    if (wanted === 'EUR') return 'EUR';
    const series = this.state.fx.rates[wanted];
    return series && Object.keys(series).length > 0 ? wanted : 'EUR';
  });

  fxLookup = $derived.by(() => rateLookup(this.state.fx.rates[this.currency] ?? {}));

  /** Grand livre dans la devise d'affichage : chaque mouvement au taux BCE de son jour. */
  displayEvents = $derived.by((): LedgerEvent[] => {
    if (this.currency === 'EUR') return this.events;
    const converted = convertEvents(this.events, this.fxLookup);
    return converted.ok ? converted.events : this.events;
  });

  displayQuotes = $derived.by((): Record<AssetCode, PriceQuoteInput> =>
    this.currency === 'EUR' ? this.quotes : convertQuotes(this.quotes, this.fxLookup),
  );

  report = $derived.by((): PortfolioReport =>
    computePortfolio({
      events: this.displayEvents,
      prices: this.displayQuotes,
      settings: this.state.engineSettings,
      balances: balanceRecords(Object.values(this.state.rawRows)),
    }),
  );

  hasData = $derived(
    Object.keys(this.state.rawRows).length > 0 || Object.keys(this.state.manualEvents).length > 0,
  );
  heldAssets = $derived.by((): AssetCode[] =>
    [...this.report.positions, ...this.report.stablecoins].map((p) => p.asset),
  );

  /** Charge localStorage et installe la persistance automatique (débouncée). */
  init(): void {
    const loaded = loadState();
    this.state = loaded.state;
    this.loadStatus = loaded.status;
    this.loadError = loaded.status === 'corrupt' ? loaded.error : null;
    if (this.state.ui.displayCurrency !== 'EUR') void this.ensureRates();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: StoredStateV1 | null = null;
    const flush = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!pending) return;
      const result = saveState(pending);
      pending = null;
      this.saveError = result.ok ? null : result.error;
    };
    $effect.root(() => {
      $effect(() => {
        pending = $state.snapshot(this.state);
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
      });
    });
    // Un rechargement, une fermeture ou un passage en arrière-plan (mobile) juste après une
    // modification ne doit jamais perdre la sauvegarde en attente.
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
    }
  }

  /**
   * Charge le jeu de démonstration du dépôt (entièrement synthétique, `npm run fixture`) pour
   * essayer l'outil sans fichier.
   * Le CSV arrive dans un chunk séparé, chargé à la demande.
   */
  async loadDemo(): Promise<ReturnType<typeof importCoinhouseCsv>> {
    const { default: text } = await import('../../tests/fixtures/coinhouse/export-demo.csv?raw');
    const result = this.importCsv(text, 'export-demo.csv');
    if (result.ok) this.setUi({ demoMode: true });
    return result;
  }

  /** Quitte la démo : efface les données fictives en conservant les préférences d'affichage. */
  exitDemo(): void {
    if (!this.state.ui.demoMode) return;
    const ui: UiSettings = { ...this.state.ui, demoMode: false, lastBackupAt: null };
    this.clearAll();
    this.state.ui = ui;
  }

  importCsv(text: string, fileName: string, now = nowMs()): ReturnType<typeof importCoinhouseCsv> {
    this.exitDemo();
    const importId = `imp:${now.toString(36)}`;
    const result = importCoinhouseCsv(text, this.state.rawRows, importId);
    if (result.ok) {
      this.state.rawRows = result.rows;
      this.state.imports = [
        ...this.state.imports,
        {
          id: importId,
          at: nowIso(now),
          fileName,
          rows: result.report.parsedRows,
          newRows: result.report.newRows,
          format: result.report.format,
          header: result.report.header,
          unknownColumns: result.report.unknownColumns,
        },
      ];
      void requestPersistentStorage();
    }
    return result;
  }

  addManual(event: ManualEvent): void {
    this.exitDemo();
    this.state.manualEvents = { ...this.state.manualEvents, [event.id]: event };
  }

  removeManual(id: string): void {
    const { [id]: _removed, ...rest } = this.state.manualEvents;
    void _removed;
    this.state.manualEvents = rest;
  }

  qualify(eventId: EventId, q: Qualification | null): void {
    const next = { ...this.state.qualifications };
    if (q) next[eventId] = q;
    else delete next[eventId];
    this.state.qualifications = next;
  }

  /** Numéros de ligne (fichier importé) des lignes brutes d'un événement, triés. */
  lineNumbersOf(rowKeys: readonly RowKey[]): number[] {
    return rowKeys
      .map((key) => this.state.rawRows[key]?.lineNo ?? 0)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
  }

  /**
   * Qualifications enregistrées, décrites par les lignes brutes qu'elles réinterprètent (date,
   * libellé, numéros de ligne) : permet de les annuler depuis l'écran « À qualifier ».
   */
  qualified = $derived.by((): QualifiedSummary[] => {
    const rows = Object.values(this.state.rawRows);
    return Object.entries(this.state.qualifications).map(([eventId, qualification]) => {
      const own = rows.filter((r) => (r.id ? `ch:${r.id}` === eventId : `ch:${r.key}` === eventId));
      own.sort((a, b) => a.lineNo - b.lineNo);
      return {
        eventId,
        qualification,
        at: own[0]?.at ?? null,
        rawType: own[0]?.type ?? null,
        lineNumbers: own.map((r) => r.lineNo).filter((n) => n > 0),
      };
    });
  });

  assetSettings(asset: AssetCode): AssetSettings {
    return (
      this.state.assetSettings[asset] ?? {
        manualPriceEur: null,
        manualPriceAt: null,
        coingeckoId: null,
      }
    );
  }

  setManualPrice(asset: AssetCode, priceEur: string | null, now = nowMs()): void {
    const current = this.assetSettings(asset);
    this.state.assetSettings = {
      ...this.state.assetSettings,
      [asset]: {
        ...current,
        manualPriceEur: priceEur,
        manualPriceAt: priceEur ? nowIso(now) : null,
      },
    };
  }

  setCurrency(currency: Currency): void {
    this.setUi({ displayCurrency: currency });
    void this.ensureRates();
  }

  /**
   * Taux BCE de la première opération à aujourd'hui (incrémental, mis en cache), pour la devise
   * d'affichage par défaut, ou pour la devise demandée (USD : conversion des prix cotés en dollars).
   */
  async ensureRates(currency: Currency = this.state.ui.displayCurrency): Promise<void> {
    if (currency === 'EUR' || this.fxStatus.loading) return;
    this.fxStatus = { loading: true, error: null };
    const today = nowIso().slice(0, 10);
    const result = await refreshRates(currency, $state.snapshot(this.state.fx), {
      provider: frankfurterProvider(),
      fromDay: earliestDay(this.events, today),
      toDay: today,
      now: nowMs,
    });
    if (result.fetched) this.state.fx = result.cache;
    this.fxStatus = { loading: false, error: result.error };
  }

  setUi(patch: Partial<UiSettings>): void {
    this.state.ui = { ...this.state.ui, ...patch };
  }

  async refreshPrices(force = false): Promise<void> {
    if (this.state.ui.priceSource === 'off' || this.priceStatus.loading) return;
    const codes = this.heldAssets;
    if (codes.length === 0) return;
    this.priceStatus = { ...this.priceStatus, loading: true };
    const overrides = Object.fromEntries(
      Object.entries(this.state.assetSettings).map(([a, s]) => [a, s.coingeckoId]),
    );
    // Les fournisseurs cotés en dollars (Hyperliquid, DefiLlama) ont besoin du taux BCE du jour,
    // que l'affichage soit en euros ou non. Le taux se charge en parallèle des fournisseurs en
    // euros (premiers de la chaîne) ; sans taux, l'actif reste simplement sans prix.
    const today = nowIso().slice(0, 10);
    const usdToEur = this.ensureRates('USD').then(
      () => toEurConverter(this.state.fx.rates.USD ?? {}, today),
      () => toEurConverter({}, today),
    );
    const result = await refreshPrices(codes, this.state.priceCache, this.state.assetSettings, {
      providers: defaultPriceProviders({
        idOverrides: overrides,
        coingeckoDemoKey: this.state.ui.coingeckoDemoKey,
        usdToEur,
      }),
      maxAgeMs: force ? 0 : PRICE_MAX_AGE_MS,
      now: nowMs,
      // Cotations appliquées au fil des fournisseurs : les actifs déjà cotés s'affichent sans
      // attendre Kraken, Hyperliquid ou DefiLlama (dont la longue traîne peut prendre plusieurs s).
      onProgress: (quotes) => {
        this.liveQuotes = { ...this.liveQuotes, ...quotes };
      },
    });
    const fresh = Object.fromEntries(
      Object.entries(result.quotes).filter(
        ([, q]) => !q.stale && q.source !== 'manuel' && q.source !== 'parité €',
      ),
    );
    this.liveQuotes = result.quotes;
    this.state.priceCache = { ...this.state.priceCache, ...fresh };
    this.priceStatus = {
      loading: false,
      online: result.online ?? this.priceStatus.online,
      errors: result.errors,
      missing: result.missing,
      lastRefreshAt: nowIso(),
    };
  }

  exportBackup(now = nowMs()): string {
    this.state.ui = { ...this.state.ui, lastBackupAt: nowIso(now) };
    return serializeBackup($state.snapshot(this.state), nowIso(now));
  }

  restoreBackup(
    text: string,
    mode: 'replace' | 'merge',
  ): { ok: true } | { ok: false; error: string } {
    const parsed = parseBackup(text);
    if (!parsed.ok) return parsed;
    this.exitDemo();
    this.state =
      mode === 'replace' ? parsed.state : mergeStates($state.snapshot(this.state), parsed.state);
    return { ok: true };
  }

  clearAll(): void {
    clearState();
    this.state = emptyState();
    this.liveQuotes = {};
  }
}

export const app = new AppState();
