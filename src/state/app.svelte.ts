import { nowIso, nowMs } from '$lib/clock';
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
} from '$lib/domain/types';
import { balanceRecords } from '$lib/import/coinhouse/balances';
import { importCoinhouseCsv } from '$lib/import/coinhouse/index';
import { normalizeCoinhouseRows } from '$lib/import/coinhouse/normalize';
import { manualToLedgerEvent } from '$lib/import/manual';
import { coinbaseProvider, coingeckoProvider, refreshPrices } from '$lib/pricing';
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

  report = $derived.by((): PortfolioReport =>
    computePortfolio({
      events: this.events,
      prices: this.quotes,
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
    let timer: ReturnType<typeof setTimeout> | null = null;
    $effect.root(() => {
      $effect(() => {
        const snapshot = $state.snapshot(this.state);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const result = saveState(snapshot);
          this.saveError = result.ok ? null : result.error;
        }, SAVE_DEBOUNCE_MS);
      });
    });
  }

  importCsv(text: string, fileName: string, now = nowMs()): ReturnType<typeof importCoinhouseCsv> {
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
        },
      ];
      void requestPersistentStorage();
    }
    return result;
  }

  addManual(event: ManualEvent): void {
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
    const result = await refreshPrices(codes, this.state.priceCache, this.state.assetSettings, {
      providers: [coingeckoProvider(overrides), coinbaseProvider()],
      maxAgeMs: force ? 0 : PRICE_MAX_AGE_MS,
      now: nowMs,
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
