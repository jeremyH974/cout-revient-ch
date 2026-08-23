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
import {
  computePortfolio,
  computePortfolioByAccount,
  type PortfolioReport,
  type PriceQuoteInput,
} from '$lib/domain/engine';
import {
  COINHOUSE_ACCOUNT_ID,
  MANUAL_ACCOUNT_ID,
  type Account,
  type AccountId,
  type AssetCode,
  type EventId,
  type LedgerEvent,
  type ManualEvent,
  type Qualification,
  type RowKey,
} from '$lib/domain/types';
import { balanceRecords } from '$lib/import/coinhouse/balances';
import { importCoinhouseCsv } from '$lib/import/coinhouse/index';
import { normalizeCoinhouseRows } from '$lib/import/coinhouse/normalize';
import { manualAccountId, manualToLedgerEvent } from '$lib/import/manual';
import { defaultPriceProviders, refreshPrices } from '$lib/pricing';
import { mergeStates, parseBackup, serializeBackup } from '$lib/storage/json-io';
import {
  chooseBackupFolder,
  forgetBackupFolder,
  isFolderBackupSupported,
  loadBackupFolder,
  queryFolderPermission,
  requestFolderPermission,
  writeBackupFile,
  type FolderPermission,
} from '$lib/storage/backup-folder';
import { requestPersistentStorage } from '$lib/storage/local-storage';
import {
  clearPersistedState,
  loadPersistedState,
  mirrorStateSync,
  savePersistedState,
} from '$lib/storage/state-store';
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

/** Sauvegarde automatique dans un dossier (Chrome/Edge sur ordinateur). */
export interface FolderBackupStatus {
  supported: boolean;
  folderName: string | null;
  permission: FolderPermission | null;
  lastWriteAt: string | null;
  error: string | null;
}

export interface QualifiedSummary {
  eventId: EventId;
  qualification: Qualification;
  at: string | null;
  rawType: string | null;
  lineNumbers: number[];
}

const EPOCH = '1970-01-01T00:00:00.000Z';
const FOLDER_WRITE_DEBOUNCE_MS = 2_000;
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
  folderBackup = $state<FolderBackupStatus>({
    supported: false,
    folderName: null,
    permission: null,
    lastWriteAt: null,
    error: null,
  });
  private folderHandle: FileSystemDirectoryHandle | null = null;
  private folderTimer: ReturnType<typeof setTimeout> | null = null;

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

  /**
   * Comptes : les deux comptes implicites (Coinhouse dès qu'un export existe, « Saisies manuelles »
   * dès qu'une saisie hors Coinhouse existe) puis les comptes déclarés, par date de création.
   */
  accounts = $derived.by((): Account[] => {
    const list: Account[] = [];
    if (Object.keys(this.state.rawRows).length > 0) {
      list.push({
        id: COINHOUSE_ACCOUNT_ID,
        kind: 'coinhouse',
        label: 'Coinhouse',
        space: 'invest',
        createdAt: '',
      });
    }
    const manual = Object.values(this.state.manualEvents);
    if (manual.some((m) => manualAccountId(m) === MANUAL_ACCOUNT_ID)) {
      list.push({
        id: MANUAL_ACCOUNT_ID,
        kind: 'manual',
        label: 'Saisies manuelles (hors Coinhouse)',
        space: 'invest',
        createdAt: '',
      });
    }
    const declared = Object.values(this.state.accounts).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    return [...list, ...declared];
  });

  accountLabels = $derived.by((): Record<AccountId, string> =>
    Object.fromEntries(this.accounts.map((a) => [a.id, a.label])),
  );

  /** Rapport par compte (vue « par plateforme ») ; calculé à la demande. */
  reportsByAccount = $derived.by((): Map<AccountId, PortfolioReport> =>
    computePortfolioByAccount({
      events: this.displayEvents,
      prices: this.displayQuotes,
      settings: this.state.engineSettings,
      balances: balanceRecords(Object.values(this.state.rawRows)),
    }),
  );

  /** Nombre de saisies rattachées à un compte (un compte utilisé ne se supprime pas). */
  manualCountOf(accountId: AccountId): number {
    return Object.values(this.state.manualEvents).filter((m) => manualAccountId(m) === accountId)
      .length;
  }

  addAccount(input: Pick<Account, 'label' | 'space'> & Partial<Pick<Account, 'kind'>>): Account {
    const id = `man:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const account: Account = {
      id,
      kind: input.kind ?? 'manual',
      label: input.label.trim().slice(0, 60),
      space: input.space,
      createdAt: nowIso(),
    };
    this.state.accounts = { ...this.state.accounts, [id]: account };
    return account;
  }

  renameAccount(id: AccountId, label: string): void {
    const existing = this.state.accounts[id];
    if (!existing) return;
    this.state.accounts = {
      ...this.state.accounts,
      [id]: { ...existing, label: label.trim().slice(0, 60) },
    };
  }

  removeAccount(id: AccountId): boolean {
    if (!this.state.accounts[id] || this.manualCountOf(id) > 0) return false;
    const { [id]: _removed, ...rest } = this.state.accounts;
    void _removed;
    this.state.accounts = rest;
    return true;
  }
  heldAssets = $derived.by((): AssetCode[] =>
    [...this.report.positions, ...this.report.stablecoins].map((p) => p.asset),
  );

  /**
   * Charge l'état persisté (IndexedDB, sinon miroir localStorage) et installe la persistance
   * automatique débouncée. Appelée (et attendue) avant le montage de l'application.
   */
  async init(): Promise<void> {
    const loaded = await loadPersistedState();
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
      const snapshot = pending;
      pending = null;
      void savePersistedState(snapshot, nowIso()).then((result) => {
        this.saveError = result.ok ? null : result.error;
        if (result.ok) this.scheduleFolderWrite(snapshot);
      });
    };
    // Fermeture ou arrière-plan : une écriture IndexedDB asynchrone peut ne jamais aboutir (onglet
    // gelé sur iOS) ; le miroir localStorage, synchrone, est alors la seule écriture garantie.
    const flushSync = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!pending) return;
      const snapshot = pending;
      pending = null;
      const savedAt = nowIso();
      mirrorStateSync(snapshot, savedAt);
      void savePersistedState(snapshot, savedAt).then((result) => {
        if (!result.ok) this.saveError = result.error;
      });
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
      window.addEventListener('pagehide', flushSync);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushSync();
      });
    }
    void this.initFolderBackup();
  }

  // --- Sauvegarde automatique dans un dossier ---------------------------------------------------

  private async initFolderBackup(): Promise<void> {
    const supported = isFolderBackupSupported();
    this.folderBackup = { ...this.folderBackup, supported };
    if (!supported) return;
    const handle = await loadBackupFolder();
    if (!handle) return;
    this.folderHandle = handle;
    this.folderBackup = {
      ...this.folderBackup,
      folderName: handle.name,
      permission: await queryFolderPermission(handle),
    };
  }

  /**
   * Écriture différée du fichier de sauvegarde : jamais en mode démo (le fichier de l'utilisateur
   * serait écrasé par des données fictives) ni sans données (après « Effacer », le dernier bon
   * fichier reste sur le disque).
   */
  private scheduleFolderWrite(snapshot: StoredStateV1): void {
    if (!this.folderHandle || this.folderBackup.permission !== 'granted') return;
    if (snapshot.ui.demoMode) return;
    if (
      Object.keys(snapshot.rawRows).length === 0 &&
      Object.keys(snapshot.manualEvents).length === 0
    )
      return;
    if (this.folderTimer) clearTimeout(this.folderTimer);
    this.folderTimer = setTimeout(() => {
      this.folderTimer = null;
      void this.writeFolderBackup(snapshot);
    }, FOLDER_WRITE_DEBOUNCE_MS);
  }

  private async writeFolderBackup(snapshot: StoredStateV1): Promise<void> {
    if (!this.folderHandle) return;
    try {
      await writeBackupFile(this.folderHandle, serializeBackup(snapshot, nowIso()));
      this.folderBackup = { ...this.folderBackup, lastWriteAt: nowIso(), error: null };
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      this.folderBackup = {
        ...this.folderBackup,
        permission: denied ? 'prompt' : this.folderBackup.permission,
        error: denied ? null : `Écriture impossible : ${String(error)}`,
      };
    }
  }

  /** Depuis un clic : choisit le dossier, puis écrit tout de suite une première sauvegarde. */
  async chooseBackupFolder(): Promise<boolean> {
    const handle = await chooseBackupFolder();
    if (!handle) return false;
    this.folderHandle = handle;
    this.folderBackup = {
      ...this.folderBackup,
      folderName: handle.name,
      permission: 'granted',
      error: null,
    };
    await this.writeFolderBackup($state.snapshot(this.state));
    return true;
  }

  /** Depuis un clic : redemande la permission après un rechargement du navigateur. */
  async reconnectBackupFolder(): Promise<void> {
    if (!this.folderHandle) return;
    const permission = await requestFolderPermission(this.folderHandle);
    this.folderBackup = { ...this.folderBackup, permission };
    if (permission === 'granted') await this.writeFolderBackup($state.snapshot(this.state));
  }

  async stopBackupFolder(): Promise<void> {
    if (this.folderTimer) clearTimeout(this.folderTimer);
    this.folderTimer = null;
    this.folderHandle = null;
    await forgetBackupFolder();
    this.folderBackup = {
      ...this.folderBackup,
      folderName: null,
      permission: null,
      lastWriteAt: null,
      error: null,
    };
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
    // Les comptes déclarés pendant la démo sont ceux de l'utilisateur, pas des données d'exemple
    // (le jeu de démonstration n'en contient aucun) : ils survivent à la sortie de la démo.
    const accounts = $state.snapshot(this.state.accounts);
    this.clearAll();
    this.state.ui = ui;
    this.state.accounts = accounts;
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
    void clearPersistedState();
    this.state = emptyState();
    this.liveQuotes = {};
  }
}

export const app = new AppState();
