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
import { D, toDecimalString, type Big } from '$lib/domain/money';
import { computeTrading, type TradingReport } from '$lib/domain/trading/compute';
import {
  emptyJournalEntry,
  isEmptyJournalEntry,
  journaledTrips,
  type JournalEntry,
  type JournaledTrip,
  type ManualTrade,
} from '$lib/domain/trading/journal';
import { buildRoundTrips } from '$lib/domain/trading/round-trips';
import {
  COINHOUSE_ACCOUNT_ID,
  MANUAL_ACCOUNT_ID,
  MANUAL_TRADING_ACCOUNT_ID,
  type Account,
  type AccountId,
  type AssetCode,
  type EventId,
  type LedgerEvent,
  type ManualEvent,
  type OnchainChain,
  type Qualification,
  type RowKey,
} from '$lib/domain/types';
import { pairTransfers, type TransferOverride, type TransferPairing } from '$lib/domain/transfers';
import { balanceRecords } from '$lib/import/coinhouse/balances';
import { importCoinhouseCsv } from '$lib/import/coinhouse/index';
import { normalizeCoinhouseRows } from '$lib/import/coinhouse/normalize';
import { normalizeAddress } from '$lib/import/hyperliquid/api-types';
import { createHlClient, type HlClient } from '$lib/import/hyperliquid/client';
import { DEMO_HL_ACCOUNT_ID, emptyHlAccountData, hlAccountId } from '$lib/import/hyperliquid/data';
import { fixtureClient, type HlFixture } from '$lib/import/hyperliquid/fixture-client';
import { normalizeHlAccount, type NormalizedHlAccount } from '$lib/import/hyperliquid/normalize';
import { syncAccount, type SyncProgress } from '$lib/import/hyperliquid/sync';
import { manualAccountId, manualToLedgerEvent } from '$lib/import/manual';
import { importGhostfolioJson } from '$lib/import/ghostfolio/index';
import { BTC_ADDRESS_RE, syncBtcAddress } from '$lib/import/onchain/btc';
import { EVM_ADDRESS_RE, EVM_CHAINS, syncEvmAddress } from '$lib/import/onchain/evm';
import { movementsToDrafts, OnchainError } from '$lib/import/onchain/normalize';
import { pivotLedgerEvents } from '$lib/import/pivot/events';
import { ingestPivotRows, type PivotImportResult } from '$lib/import/pivot/index';
import { draftsToPivotRows } from '$lib/import/platforms/drafts';
import { importAnyCsv } from '$lib/import/platforms/index';
import { defaultPriceProviders, refreshPrices } from '$lib/pricing';
import { createLiveMids, type LiveMids, type LiveStatus } from '$lib/pricing/live';
import { hlSpotMeta, hlSpotMidKey, type HlMidsMeta } from '$lib/pricing/providers/hyperliquid';
import { defaultFetch } from '$lib/history/providers/shared';
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
import type { TradingCheckInput } from '$lib/support/self-check';
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

/** Synchronisation d'un compte Hyperliquid (adresse publique). */
export interface SyncStatus {
  syncing: boolean;
  progress: SyncProgress | null;
  error: string | null;
  /** Une borne de pages a été atteinte : relancer pour continuer. */
  truncated: boolean;
  /** Éléments nouveaux (fills + funding + mouvements) à la dernière synchronisation. */
  added: number;
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
  /** Chargements de taux en cours, par devise : les appels concurrents partagent la même promesse. */
  private fxInFlight: Partial<Record<Currency, Promise<void>>> = {};
  folderBackup = $state<FolderBackupStatus>({
    supported: false,
    folderName: null,
    permission: null,
    lastWriteAt: null,
    error: null,
  });
  private folderHandle: FileSystemDirectoryHandle | null = null;
  private folderTimer: ReturnType<typeof setTimeout> | null = null;
  syncStatus = $state<Record<AccountId, SyncStatus>>({});

  /** Prix « live » Hyperliquid (P26) : statut du WebSocket opt-in. */
  liveStatus = $state<LiveStatus>('off');
  private liveClient: LiveMids | null = null;
  private liveMeta: HlMidsMeta | null = null;
  private lastLiveApplyMs = 0;
  private liveVisibilityHandler: (() => void) | null = null;
  /** Client `info` Hyperliquid ; en démonstration, un client hors ligne servant la fixture. */
  private hlClient: HlClient | null = null;

  private assembledEvents = $derived.by((): LedgerEvent[] => {
    const { events } = normalizeCoinhouseRows(
      Object.values(this.state.rawRows),
      this.state.qualifications,
    );
    for (const manual of Object.values(this.state.manualEvents))
      events.push(manualToLedgerEvent(manual));
    // Spot Hyperliquid routé vers l'Investissement (option « traiter le spot comme de l'investissement »).
    for (const normalized of Object.values(this.hlNormalized))
      events.push(...normalized.investEvents);
    // Lignes du CSV pivot (Koinly/Waltio) : mêmes qualifications, taux BCE réactifs (une ligne
    // « taux manquant » se résout d'elle-même quand les taux arrivent).
    const pivotRows = Object.values(this.state.pivotRows);
    if (pivotRows.length > 0) {
      const usd = rateLookup(this.state.fx.rates.USD ?? {});
      events.push(
        ...pivotLedgerEvents(pivotRows, this.state.qualifications, (day) => usd.rate(day)).events,
      );
    }
    return events;
  });

  /** Virements internes appariés (décision n° 25) : paires, orphelins et événements décorés. */
  transferPairing = $derived.by((): TransferPairing =>
    pairTransfers(this.assembledEvents, this.state.transferOverrides),
  );

  events = $derived.by((): LedgerEvent[] => this.transferPairing.events);

  /** Comptes Hyperliquid déclarés (espace Trading). */
  hlAccounts = $derived.by((): Account[] =>
    Object.values(this.state.accounts)
      .filter((a) => a.kind === 'hyperliquid')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  );

  /** Bruts Hyperliquid normalisés par compte (exécutions, funding, flux, instantané, spot → invest). */
  hlNormalized = $derived.by((): Record<AccountId, NormalizedHlAccount> => {
    const usd = rateLookup(this.state.fx.rates.USD ?? {});
    const result: Record<AccountId, NormalizedHlAccount> = {};
    for (const account of this.hlAccounts) {
      const data = this.state.hyperliquid.accounts[account.id];
      if (!data) continue;
      result[account.id] = normalizeHlAccount(data, {
        accountId: account.id,
        spotPairs: this.state.hyperliquid.spotPairs,
        spotAsInvestment: account.spotAsInvestment === true,
        eurUsdRate: (day) => usd.rate(day),
      });
    }
    return result;
  });

  /** Rapport Trading (USDC) : équités sommées, P&L séparés de l'Investissement. */
  tradingReport = $derived.by((): TradingReport =>
    computeTrading(Object.values(this.hlNormalized).map((n) => n.trading)),
  );

  hasTrading = $derived(this.hlAccounts.length > 0);

  /**
   * Aller-retours (perps reconstruits par compte + trades manuels) fusionnés avec le journal,
   * du plus récent au plus ancien.
   */
  roundTrips = $derived.by((): JournaledTrip[] => {
    const trips = Object.values(this.hlNormalized).flatMap((n) =>
      buildRoundTrips(n.trading.executions, n.trading.funding),
    );
    return journaledTrips(trips, Object.values(this.state.manualTrades), this.state.journal);
  });

  tripOf(id: string): JournaledTrip | undefined {
    return this.roundTrips.find((t) => t.trip.id === id);
  }

  journalOf(tradeId: string): JournalEntry {
    return this.state.journal[tradeId] ?? emptyJournalEntry(tradeId);
  }

  /** Enregistre (ou efface, si vide) l'entrée de journal d'un trade. */
  saveJournal(entry: JournalEntry): void {
    const next = { ...this.state.journal };
    if (isEmptyJournalEntry(entry)) delete next[entry.tradeId];
    else next[entry.tradeId] = entry;
    this.state.journal = next;
  }

  addManualTrade(input: Omit<ManualTrade, 'id'>): ManualTrade {
    this.exitDemo();
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const trade: ManualTrade = { ...input, id };
    this.state.manualTrades = { ...this.state.manualTrades, [id]: trade };
    // Un trade coté en dollars a besoin du taux BCE pour s'afficher : sans lui, son P&L reste
    // « — » jusqu'à ce qu'un autre écran charge les taux.
    if (trade.quote !== 'EUR') void this.ensureRates('USD');
    return trade;
  }

  updateManualTrade(trade: ManualTrade): void {
    if (!this.state.manualTrades[trade.id]) return;
    this.state.manualTrades = { ...this.state.manualTrades, [trade.id]: trade };
    if (trade.quote !== 'EUR') void this.ensureRates('USD');
  }

  /** Supprime un trade manuel et l'entrée de journal qui lui est rattachée. */
  removeManualTrade(id: string): void {
    const { [id]: _removed, ...rest } = this.state.manualTrades;
    void _removed;
    this.state.manualTrades = rest;
    const journalId = `man:${id}`;
    if (journalId in this.state.journal) {
      const { [journalId]: _entry, ...journal } = this.state.journal;
      void _entry;
      this.state.journal = journal;
    }
  }

  /** Entrée « trading » des auto-vérifications (`runSelfChecks`) : un élément par compte. */
  tradingChecks = $derived.by((): TradingCheckInput[] =>
    this.hlAccounts.map((account) => {
      const report = this.tradingReport.accounts.find((a) => a.accountId === account.id);
      const normalized = this.hlNormalized[account.id];
      return {
        label: account.label,
        gap: report?.reconciliation?.gap ?? null,
        lastSyncAt: this.state.hyperliquid.accounts[account.id]?.lastSyncAt ?? null,
        syncError: this.syncStatus[account.id]?.error ?? null,
        unknownLedgerTypes: normalized?.unknownLedgerTypes ?? [],
        fxMissing: normalized?.fxMissing ?? 0,
      };
    }),
  );

  /**
   * Montant USDC (assimilé USD, décision n° 18) → devise d'affichage : identité en dollars,
   * division par le taux BCE EUR→USD du jour en euros ; `null` tant qu'aucun taux n'est connu.
   */
  usdcToDisplay = $derived.by((): ((value: Big) => Big | null) => {
    if (this.currency === 'USD') return (value) => value;
    const convert = toEurConverter(this.state.fx.rates.USD ?? {}, nowIso().slice(0, 10));
    return (value) => {
      const converted = convert(toDecimalString(value));
      return converted === null ? null : D(converted);
    };
  });

  /** Montant d'une devise de cotation (USDC/USD ou EUR) → devise d'affichage. */
  quoteToDisplay = $derived.by((): ((quote: string, value: Big) => Big | null) => {
    const usdc = this.usdcToDisplay;
    const usdRate = rateLookup(this.state.fx.rates.USD ?? {}).rate(nowIso().slice(0, 10));
    return (quote, value) => {
      if (quote.toUpperCase() === 'EUR')
        return this.currency === 'EUR' ? value : usdRate === null ? null : value.times(usdRate);
      return usdc(value);
    };
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
    Object.keys(this.state.rawRows).length > 0 ||
      Object.keys(this.state.pivotRows).length > 0 ||
      Object.keys(this.state.manualEvents).length > 0 ||
      Object.keys(this.state.manualTrades).length > 0 ||
      this.hlAccounts.length > 0,
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
    const manualTrades = Object.values(this.state.manualTrades);
    if (manualTrades.some((t) => t.accountId === MANUAL_TRADING_ACCOUNT_ID)) {
      list.push({
        id: MANUAL_TRADING_ACCOUNT_ID,
        kind: 'manual',
        label: 'Trades manuels',
        space: 'trading',
        createdAt: '',
      });
    }
    const declared = Object.values(this.state.accounts).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    return [...list, ...declared];
  });

  /** Comptes de l'espace Investissement (dont les comptes Hyperliquid routés en `spotAsInvestment`). */
  investAccounts = $derived.by((): Account[] =>
    this.accounts.filter((a) => a.space === 'invest' || a.spotAsInvestment === true),
  );

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
    return (
      Object.values(this.state.manualEvents).filter((m) => manualAccountId(m) === accountId)
        .length +
      Object.values(this.state.manualTrades).filter((t) => t.accountId === accountId).length
    );
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
    // Compte CSV : ses lignes pivot, leurs qualifications et ses overrides partent avec lui
    // (même logique que les bruts Hyperliquid ci-dessous).
    const prefix = `pv:${id}:`;
    if (Object.keys(this.state.pivotRows).some((k) => k.startsWith(prefix))) {
      const rows = { ...this.state.pivotRows };
      const quals = { ...this.state.qualifications };
      for (const key of Object.keys(rows)) {
        if (!key.startsWith(prefix)) continue;
        delete rows[key];
        delete quals[key];
      }
      const overrides: typeof this.state.transferOverrides = {};
      for (const [wId, value] of Object.entries(this.state.transferOverrides)) {
        if (wId.startsWith(prefix) || (value !== 'none' && value.startsWith(prefix))) continue;
        overrides[wId] = value;
      }
      this.state.pivotRows = rows;
      this.state.qualifications = quals;
      this.state.transferOverrides = overrides;
    }
    if (id in this.state.hyperliquid.accounts) {
      const { [id]: _data, ...others } = this.state.hyperliquid.accounts;
      void _data;
      this.state.hyperliquid = { ...this.state.hyperliquid, accounts: others };
    }
    if (id in this.syncStatus) {
      const { [id]: _status, ...statuses } = this.syncStatus;
      void _status;
      this.syncStatus = statuses;
    }
    return true;
  }

  // --- Comptes on-chain (adresse publique, lecture seule) ----------------------------------------

  /** Suit une adresse publique BTC/EVM : compte Investissement, mouvements à apparier/qualifier. */
  addOnchainAccount(input: {
    chain: OnchainChain;
    address: string;
    label: string;
  }): { ok: true; account: Account } | { ok: false; error: string } {
    const chain = input.chain;
    const address = chain === 'btc' ? input.address.trim() : input.address.trim().toLowerCase();
    const valid = chain === 'btc' ? BTC_ADDRESS_RE.test(address) : EVM_ADDRESS_RE.test(address);
    if (!valid) return { ok: false, error: 'Adresse invalide pour cette chaîne.' };
    const existing = Object.values(this.state.accounts).find(
      (a) => a.kind === 'onchain' && a.chain === chain && a.address === address,
    );
    if (existing) return { ok: false, error: `Cette adresse est déjà suivie (${existing.label}).` };
    this.exitDemo();
    const id = `oc:${chain}-${Date.now().toString(36)}`;
    const account: Account = {
      id,
      kind: 'onchain',
      label:
        input.label.trim().slice(0, 60) ||
        `Adresse ${chain === 'btc' ? 'Bitcoin' : EVM_CHAINS[chain].label}`,
      space: 'invest',
      address,
      chain,
      createdAt: nowIso(),
    };
    this.state.accounts = { ...this.state.accounts, [id]: account };
    return { ok: true, account };
  }

  /** Synchronise les mouvements d'un compte on-chain (idempotent, clés par txid). */
  async syncOnchain(accountId: AccountId): Promise<void> {
    const account = this.state.accounts[accountId];
    if (!account || account.kind !== 'onchain' || !account.address || !account.chain) return;
    if (this.syncStatus[accountId]?.syncing) return;
    const patch = (p: Partial<SyncStatus>): void => {
      const current = this.syncStatus[accountId] ?? {
        syncing: false,
        progress: null,
        error: null,
        truncated: false,
        added: 0,
      };
      this.syncStatus = { ...this.syncStatus, [accountId]: { ...current, ...p } };
    };
    patch({ syncing: true, error: null });
    try {
      const result =
        account.chain === 'btc'
          ? await syncBtcAddress(account.address)
          : await syncEvmAddress(account.chain, account.address);
      const now = nowMs();
      const importId = `imp:${now.toString(36)}`;
      const parsed = draftsToPivotRows(movementsToDrafts(result.movements), importId, accountId);
      let added = 0;
      if (parsed.rows.length > 0) {
        const usd = rateLookup(this.state.fx.rates.USD ?? {});
        const ingested = ingestPivotRows(
          parsed,
          {
            format: 'onchain-sync',
            header: [],
            unknownColumns: [],
            totalRows: result.movements.length,
            skippedInternal: result.ignored,
          },
          this.state.pivotRows,
          accountId,
          (day) => usd.rate(day),
          this.state.qualifications,
        );
        if (!ingested.ok) {
          patch({ syncing: false, error: ingested.error });
          return;
        }
        added = ingested.report.newRows;
        if (added > 0) {
          this.state.pivotRows = ingested.rows;
          this.state.imports = [
            ...this.state.imports,
            {
              id: importId,
              at: nowIso(now),
              fileName: `Synchronisation ${account.chain === 'btc' ? 'Bitcoin' : EVM_CHAINS[account.chain].label}`,
              rows: ingested.report.parsedRows,
              newRows: added,
              format: ingested.report.format,
              header: [],
              unknownColumns: [],
              accountId,
            },
          ];
          void this.ensureRates('USD');
          void requestPersistentStorage();
        }
      }
      patch({ syncing: false, added, truncated: result.truncated, error: null });
    } catch (error) {
      patch({
        syncing: false,
        error:
          error instanceof OnchainError
            ? error.message
            : `Synchronisation impossible : ${String(error)}`,
      });
    }
  }

  // --- Hyperliquid (lecture seule, adresse publique) --------------------------------------------

  addHyperliquidAccount(input: {
    address: string;
    label: string;
    spotAsInvestment: boolean;
  }): { ok: true; account: Account } | { ok: false; error: string } {
    const address = normalizeAddress(input.address);
    if (!address)
      return {
        ok: false,
        error: 'Adresse invalide : attendu « 0x » suivi de 40 caractères hexadécimaux.',
      };
    const id = hlAccountId(address);
    if (this.state.accounts[id] && !this.state.ui.demoMode)
      return { ok: false, error: 'Cette adresse est déjà suivie.' };
    this.exitDemo();
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    const account: Account = {
      id,
      kind: 'hyperliquid',
      label: input.label.trim().slice(0, 60) || `Hyperliquid ${short}`,
      space: 'trading',
      address,
      createdAt: nowIso(),
    };
    if (input.spotAsInvestment) account.spotAsInvestment = true;
    this.state.accounts = { ...this.state.accounts, [id]: account };
    this.state.hyperliquid = {
      ...this.state.hyperliquid,
      accounts: { ...this.state.hyperliquid.accounts, [id]: emptyHlAccountData(address) },
    };
    void requestPersistentStorage();
    return { ok: true, account };
  }

  setSpotAsInvestment(id: AccountId, value: boolean): void {
    const existing = this.state.accounts[id];
    if (!existing) return;
    const { spotAsInvestment: _flag, ...rest } = existing;
    void _flag;
    this.state.accounts = {
      ...this.state.accounts,
      [id]: value ? { ...rest, spotAsInvestment: true } : rest,
    };
  }

  private client(): HlClient {
    this.hlClient ??= createHlClient();
    return this.hlClient;
  }

  /** Synchronise un compte Hyperliquid (ou tous) : fills, funding, mouvements, instantané. */
  async syncHyperliquid(accountId?: AccountId): Promise<void> {
    const targets = this.hlAccounts.filter((a) => !accountId || a.id === accountId);
    await Promise.all(targets.map((a) => this.syncOne(a)));
    // Taux BCE EUR→USD : conversion des montants USDC à l'affichage et du spot → investissement.
    if (targets.length > 0) void this.ensureRates('USD');
  }

  private async syncOne(account: Account): Promise<void> {
    const id = account.id;
    if (this.syncStatus[id]?.syncing) return;
    const status = (patch: Partial<SyncStatus>): void => {
      const current = this.syncStatus[id] ?? {
        syncing: false,
        progress: null,
        error: null,
        truncated: false,
        added: 0,
      };
      this.syncStatus = { ...this.syncStatus, [id]: { ...current, ...patch } };
    };
    status({ syncing: true, progress: null, error: null });
    const previous = this.state.hyperliquid.accounts[id];
    const result = await syncAccount(
      this.client(),
      previous ? $state.snapshot(previous) : null,
      account.address ?? '',
      { now: nowMs, onProgress: (progress) => status({ progress }) },
    );
    this.state.hyperliquid = {
      accounts: { ...this.state.hyperliquid.accounts, [id]: result.data },
      spotPairs: { ...this.state.hyperliquid.spotPairs, ...result.spotPairs },
    };
    status({
      syncing: false,
      progress: null,
      error: result.error,
      truncated: result.truncated,
      added: result.added.fills + result.added.funding + result.added.ledger,
    });
  }

  heldAssets = $derived.by((): AssetCode[] => {
    const assets = [...this.report.positions, ...this.report.stablecoins].map((p) => p.asset);
    for (const account of this.tradingReport.accounts)
      for (const holding of account.snapshot?.spot ?? [])
        if (!assets.includes(holding.asset)) assets.push(holding.asset);
    return assets;
  });

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
    // Taux EUR→USD nécessaires hors affichage dollar : lignes pivot en USD/stables, spot HL.
    if (Object.keys(this.state.pivotRows).length > 0 || this.hlAccounts.length > 0)
      void this.ensureRates('USD');
    // Prix live opt-in : reprend seulement si l'utilisateur l'avait activé.
    if (this.state.ui.liveMids) this.startLive();
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
      Object.keys(snapshot.manualEvents).length === 0 &&
      Object.keys(snapshot.manualTrades).length === 0 &&
      Object.keys(snapshot.hyperliquid.accounts).length === 0
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
    if (result.ok) {
      this.setUi({ demoMode: true });
      await this.loadDemoTrading();
    }
    return result;
  }

  /**
   * Volet Trading de la démo : un compte Hyperliquid fictif (adresse de la fixture synthétique,
   * `npm run fixture:hl`) synchronisé hors ligne par le même code que la vraie API.
   */
  private async loadDemoTrading(): Promise<void> {
    const { default: text } = await import('../../tests/fixtures/hyperliquid/demo.json?raw');
    const fixture = JSON.parse(text) as HlFixture;
    const address = normalizeAddress(fixture.address);
    if (!address) return;
    const id = hlAccountId(address);
    const account: Account = {
      id,
      kind: 'hyperliquid',
      label: 'Hyperliquid (démo)',
      space: 'trading',
      address,
      createdAt: nowIso(),
    };
    this.state.accounts = { ...this.state.accounts, [id]: account };
    this.state.hyperliquid = {
      ...this.state.hyperliquid,
      accounts: { ...this.state.hyperliquid.accounts, [id]: emptyHlAccountData(address) },
    };
    this.hlClient = fixtureClient(fixture);
    await this.syncHyperliquid(id);
  }

  /** Quitte la démo : efface les données fictives en conservant les préférences d'affichage. */
  exitDemo(): void {
    if (!this.state.ui.demoMode) return;
    const ui: UiSettings = { ...this.state.ui, demoMode: false, lastBackupAt: null };
    // Les comptes déclarés pendant la démo sont ceux de l'utilisateur, pas des données d'exemple :
    // ils survivent à la sortie de la démo, avec leurs bruts ; seul le compte Hyperliquid de la
    // démo (adresse fictive) disparaît.
    const accounts = $state.snapshot(this.state.accounts);
    delete accounts[DEMO_HL_ACCOUNT_ID];
    const hyperliquid = $state.snapshot(this.state.hyperliquid);
    delete hyperliquid.accounts[DEMO_HL_ACCOUNT_ID];
    this.clearAll();
    this.state.ui = ui;
    this.state.accounts = accounts;
    this.state.hyperliquid = hyperliquid;
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

  /** Compte destinataire d'un import pivot (kind `csv`, espace Investissement). */
  addPivotAccount(label: string): Account {
    const id = `csv:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const account: Account = {
      id,
      kind: 'csv',
      label: label.trim().slice(0, 60) || 'Compte CSV',
      space: 'invest',
      createdAt: nowIso(),
    };
    this.state.accounts = { ...this.state.accounts, [id]: account };
    return account;
  }

  /** Importe un CSV pivot (Koinly « Universal » ou export Koinly, lu par Waltio) dans un compte. */
  importPivot(
    text: string,
    fileName: string,
    accountId: AccountId,
    now = nowMs(),
  ): PivotImportResult {
    this.exitDemo();
    const importId = `imp:${now.toString(36)}`;
    const usd = rateLookup(this.state.fx.rates.USD ?? {});
    const result = importAnyCsv(
      text,
      this.state.pivotRows,
      accountId,
      importId,
      (day) => usd.rate(day),
      this.state.qualifications,
    );
    if (result.ok) {
      this.state.pivotRows = result.rows;
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
          accountId,
        },
      ];
      // Les montants USD/stables du fichier ont besoin des taux BCE de leurs jours.
      void this.ensureRates('USD');
      void requestPersistentStorage();
    }
    return result;
  }

  /** Importe un export JSON Ghostfolio dans un compte (même pipeline que le pivot). */
  importGhostfolio(
    text: string,
    fileName: string,
    accountId: AccountId,
    now = nowMs(),
  ): PivotImportResult {
    this.exitDemo();
    const importId = `imp:${now.toString(36)}`;
    const usd = rateLookup(this.state.fx.rates.USD ?? {});
    const result = importGhostfolioJson(
      text,
      this.state.pivotRows,
      accountId,
      importId,
      (day) => usd.rate(day),
      this.state.qualifications,
    );
    if (result.ok) {
      this.state.pivotRows = result.rows;
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
          accountId,
        },
      ];
      void this.ensureRates('USD');
      void requestPersistentStorage();
    }
    return result;
  }

  /** Corrige l'appariement d'un virement : dépôt imposé, « none », ou retour à l'automatique. */
  setTransferOverride(withdrawalId: EventId, value: TransferOverride | null): void {
    const next = { ...this.state.transferOverrides };
    if (value === null) delete next[withdrawalId];
    else next[withdrawalId] = value;
    this.state.transferOverrides = next;
  }

  /** Lignes pivot rattachées à un compte. */
  pivotCountOf(accountId: AccountId): number {
    return Object.values(this.state.pivotRows).filter((r) => r.accountId === accountId).length;
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
      const pivotRow = this.state.pivotRows[eventId];
      if (pivotRow) {
        return {
          eventId,
          qualification,
          at: pivotRow.at,
          rawType: pivotRow.label ?? 'ligne pivot',
          lineNumbers: pivotRow.lineNo > 0 ? [pivotRow.lineNo] : [],
        };
      }
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
  /**
   * Taux BCE d'une devise, chargés au plus une fois à la fois. Un appel concurrent ATTEND la
   * requête déjà en vol au lieu d'abandonner : sinon `refreshPrices`, lancé en même temps que le
   * chargement des données, construisait son convertisseur sur un cache encore vide et les actifs
   * cotés en dollars (Hyperliquid, DefiLlama) restaient sans prix jusqu'à un « Actualiser » manuel.
   */
  async ensureRates(currency: Currency = this.state.ui.displayCurrency): Promise<void> {
    if (currency === 'EUR') return;
    const inFlight = this.fxInFlight[currency];
    if (inFlight) return inFlight;
    const run = (async () => {
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
    })();
    this.fxInFlight[currency] = run;
    try {
      await run;
    } finally {
      delete this.fxInFlight[currency];
    }
  }

  setUi(patch: Partial<UiSettings>): void {
    this.state.ui = { ...this.state.ui, ...patch };
  }

  // --- Prix « live » Hyperliquid (P26, opt-in) ---------------------------------------------------

  /** Active/coupe le flux de prix WebSocket (persisté ; jamais actif sans ce choix explicite). */
  setLiveMids(enabled: boolean): void {
    this.setUi({ liveMids: enabled });
    if (enabled) this.startLive();
    else this.stopLive();
  }

  private startLive(): void {
    if (this.liveClient || typeof document === 'undefined') return;
    void this.ensureRates('USD');
    if (!this.liveMeta) {
      hlSpotMeta(defaultFetch, new AbortController().signal)
        .then((meta) => {
          this.liveMeta = meta;
        })
        .catch(() => {
          // sans spotMeta, les perps restent résolus par leur nom ; le spot attendra.
        });
    }
    this.liveClient = createLiveMids({
      onMids: (mids) => this.applyLiveMids(mids),
      onStatus: (status) => {
        this.liveStatus = status;
      },
    });
    // Onglet caché → socket fermé (batterie, débit) ; visible → reprise si toujours activé.
    this.liveVisibilityHandler = () => {
      if (!this.liveClient) return;
      if (document.visibilityState === 'hidden') this.liveClient.stop();
      else if (this.state.ui.liveMids) this.liveClient.start();
    };
    document.addEventListener('visibilitychange', this.liveVisibilityHandler);
    if (document.visibilityState !== 'hidden') this.liveClient.start();
  }

  private stopLive(): void {
    this.liveClient?.stop();
    this.liveClient = null;
    if (this.liveVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.liveVisibilityHandler);
      this.liveVisibilityHandler = null;
    }
    this.liveStatus = 'off';
  }

  /** Mids reçus → cotations d'affichage (throttle 3 s) ; jamais écrit dans le cache persisté. */
  private applyLiveMids(mids: Record<string, string>): void {
    const now = nowMs();
    if (now - this.lastLiveApplyMs < 3000) return;
    const usdToEur = toEurConverter(this.state.fx.rates.USD ?? {}, nowIso().slice(0, 10));
    const at = nowIso();
    const quotes: Record<AssetCode, PriceQuoteInput> = {};
    for (const code of this.heldAssets) {
      const upper = code.toUpperCase();
      const key = this.liveMeta ? (hlSpotMidKey(this.liveMeta, upper) ?? upper) : upper;
      const mid = mids[key];
      if (mid === undefined) continue;
      const priceEur = usdToEur(mid);
      if (priceEur === null) continue;
      quotes[code] = { asset: code, priceEur, at, source: 'Hyperliquid (live)', stale: false };
    }
    if (Object.keys(quotes).length === 0) return;
    this.lastLiveApplyMs = now;
    this.liveQuotes = { ...this.liveQuotes, ...quotes };
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
    this.syncStatus = {};
    this.hlClient = null;
  }
}

export const app = new AppState();
