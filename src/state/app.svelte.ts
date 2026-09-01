import { nowIso, nowMs } from '$lib/clock';
import {
  alertConditionMet,
  alertThresholdEur,
  evaluateAlerts,
  initialAlertState,
  type AlertEvent,
  type AlertFire,
  type AlertPositionInput,
  type AlertRule,
  type AlertRuleState,
} from '$lib/domain/alerts';
import { fmtPrice } from '$lib/format/fr';
import { loadFearGreed, type FearGreedPoint } from '$lib/pricing/fear-greed';
import {
  buildAlertWatchSnapshot,
  syncAlertWatchTask,
  takePendingSwFires,
  writeAlertWatchSnapshot,
  type BackgroundSyncStatus,
} from '$lib/notify/background-sync';
import { alertsUrl, notifIconUrl, showSystemNotification } from '$lib/notify/notifications';
import { toasts } from './ui.svelte';
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
  coinhouseTraceRow,
  computePortfolio,
  computePortfolioByAccount,
  pivotTraceRow,
  traceMetric,
  type PortfolioReport,
  type PositionReport,
  type PriceQuoteInput,
  type Trace,
  type TraceTarget,
} from '$lib/domain/engine';
import { computeDeclarations, type DeclarationReport } from '$lib/domain/declarations-fr';
import {
  accountLabels as accountLabelsOf,
  allAccounts,
  investAccounts as investAccountsOf,
} from '$lib/derive/accounts';
import { qualifiedSummaries, type QualifiedSummary } from '$lib/derive/qualified';
import { effectiveQuotes } from '$lib/derive/quotes';
import { eraseHistoryCache } from '$lib/history/erase';
import { buildInsights, type Insight } from '$lib/domain/insights';
import { D, toDecimalString, type Big, type DecimalString } from '$lib/domain/money';
import { analyzeSubscription, type SubscriptionAnalysis } from '$lib/domain/subscription';
import { xirrEur, type XirrResult } from '$lib/domain/xirr';
import { realizedEvents, type RealizedEvent } from '$lib/domain/trading/calendar';
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
  type Account,
  type AccountId,
  type AssetCode,
  type CountryCode,
  type EventId,
  type LedgerEvent,
  type ManualEvent,
  type OnchainChain,
  type Qualification,
  type RawCoinhouseRow,
  type RawPivotRow,
  type RowKey,
  type StoredColumnMapping,
} from '$lib/domain/types';
import { pairTransfers, type TransferOverride, type TransferPairing } from '$lib/domain/transfers';
import type { DuplicateReview } from '$lib/domain/reconciliation';
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
import {
  BTC_ADDRESS_RE,
  syncBtcAddress,
  syncBtcWallet,
  type BtcScanProgress,
} from '$lib/import/onchain/btc';
import { EXTENDED_PRIVATE_RE, EXTENDED_PUBLIC_RE } from '$lib/import/onchain/xpub-detect';
import { EVM_ADDRESS_RE, EVM_CHAINS } from '$lib/import/onchain/evm';
import { syncEvmWithFallback } from '$lib/import/onchain/evm-sync';
import {
  movementsToDrafts,
  OnchainError,
  type OnchainSyncResult,
} from '$lib/import/onchain/normalize';
import { fnv1a } from '$lib/import/pivot/rows';
import { importMappedCsv, normalizeHeader, type ConfirmedMapping } from '$lib/import/mapping/index';
import { pivotLedgerEvents } from '$lib/import/pivot/events';
import { ingestPivotRows, type PivotImportResult } from '$lib/import/pivot/index';
import { draftsToPivotRows } from '$lib/import/platforms/drafts';
import { importAnyCsv, PLATFORM_CONVERTERS } from '$lib/import/platforms/index';
import { defaultPriceProviders, refreshPrices } from '$lib/pricing';
import { parseMids } from '$lib/pricing/live';
import { createLiveSocket, type LiveSocket, type LiveStatus } from '$lib/live/socket';
import {
  liveFillSubscriptions,
  mergeLiveEnvelope,
  readLiveEnvelope,
} from '$lib/import/hyperliquid/live-fills';
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

/**
 * Empreinte de l'en-tête d'un fichier : c'est à elle qu'un appariement mémorisé est lié (P64).
 *
 * Les en-têtes sont NORMALISÉS avant hachage (accents, casse, séparateurs) : un export qui
 * changerait « Date UTC » en « Date (UTC) » retrouve son appariement, alors qu'un export qui
 * ajoute, retire ou déplace une colonne ne le retrouve pas — et repose donc la question, ce qui
 * est exactement ce qu’on veut : un appariement rejoué sur des colonnes décalées produirait des
 * montants faux sans que rien ne le signale.
 */
export const headerFingerprint = (header: readonly string[]): string =>
  fnv1a(header.map((h) => normalizeHeader(h).text).join('|'));
import type { TradingCheckInput } from '$lib/support/self-check';
import {
  clearPersistedState,
  loadPersistedState,
  mirrorStateSync,
  savePersistedState,
} from '$lib/storage/state-store';
import {
  MAX_ALERT_EVENTS,
  emptyState,
  type AlertsSettings,
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
  /** Balayage d'un portefeuille Bitcoin dérivé d'une clé étendue (adresses vues, utilisées). */
  scan: BtcScanProgress | null;
  /** Fournisseur EVM qui a réellement répondu : l'origine d'un chiffre doit rester lisible. */
  provider: string | null;
}

export type { QualifiedSummary };

const FOLDER_WRITE_DEBOUNCE_MS = 2_000;
const PRICE_MAX_AGE_MS = 10 * 60_000;
const SAVE_DEBOUNCE_MS = 300;
/** Le planificateur de veille des alertes se réveille souvent mais n'actualise qu'à échéance. */
const ALERT_WATCH_TICK_MS = 30_000;

/** Égalité des états d'armement : évite de réécrire (et re-sauvegarder) un état identique. */
function sameAlertStates(
  a: Readonly<Record<string, AlertRuleState>>,
  b: Readonly<Record<string, AlertRuleState>>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => {
    const x = a[k];
    const y = b[k];
    return (
      x !== undefined &&
      y !== undefined &&
      x.armed === y.armed &&
      x.lastTriggeredAtMs === y.lastTriggeredAtMs &&
      x.triggerCount === y.triggerCount
    );
  });
}

export class AppState {
  state = $state<StoredStateV1>(emptyState());
  loadStatus = $state<'empty' | 'ok' | 'corrupt'>('empty');
  loadError = $state<string | null>(null);
  saveError = $state<string | null>(null);
  /**
   * Le miroir `localStorage` a échoué alors que l'enregistrement a réussi (décision n° 79). Non
   * bloquant : c'est le **repli** qui n'est plus à jour, pas les données.
   */
  mirrorError = $state<string | null>(null);
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
  /** Dernière exécution reçue en direct (ISO 8601) et compteur de la session. */
  liveFillsAt = $state<string | null>(null);
  liveFillsCount = $state(0);
  private liveClient: LiveSocket | null = null;
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

  /**
   * Jambes des virements internes appariés, par identifiant d'événement. Les vues consolidées
   * (courbe d'évolution, TWR) doivent les neutraliser : les coins n'ont jamais quitté le
   * patrimoine, seulement changé de compte. Un `Record` et non un `Set` (règle ESLint
   * `svelte/prefer-svelte-reactivity`).
   */
  internalTransferLegs = $derived.by((): Record<EventId, 'out' | 'in'> => {
    const legs: Record<EventId, 'out' | 'in'> = {};
    for (const pair of this.transferPairing.pairs) {
      legs[pair.withdrawalId] = 'out';
      legs[pair.depositId] = 'in';
    }
    return legs;
  });

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

  /**
   * Montants réalisés datés de l'instant où ils l'ont été (calendrier de P&L) : même source et
   * même règle que les totaux du tableau de bord (`computeTotals`), pour que les deux écrans ne
   * puissent pas se contredire.
   */
  realized = $derived.by((): RealizedEvent[] => {
    const accounts = Object.values(this.hlNormalized).map((n) => n.trading);
    return realizedEvents(
      this.roundTrips,
      accounts.flatMap((a) => a.executions),
      accounts.flatMap((a) => a.funding),
    );
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
  quotes = $derived.by((): Record<AssetCode, PriceQuoteInput> =>
    effectiveQuotes(this.state.priceCache, this.liveQuotes, this.state.assetSettings),
  );

  /** Devise d'affichage effective : l'euro si les taux de la devise choisie manquent. */
  currency = $derived.by((): Currency => {
    const wanted = this.state.ui.displayCurrency;
    if (wanted === 'EUR') return 'EUR';
    const series = this.state.fx.rates[wanted];
    return series && Object.keys(series).length > 0 ? wanted : 'EUR';
  });

  fxLookup = $derived.by(() => rateLookup(this.state.fx.rates[this.currency] ?? {}));

  /** Taux BCE EUR→USD du jour (dernier connu) ; `null` tant que la série n'est pas chargée. */
  usdPerEurToday = $derived.by((): DecimalString | null =>
    rateLookup(this.state.fx.rates.USD ?? {}).rate(nowIso().slice(0, 10)),
  );

  /**
   * Montant EUR → devise d'affichage, au taux BCE du jour demandé (aujourd'hui par défaut) :
   * identité en euros, `null` si le taux manque. Frontière d'affichage uniquement — l'évaluation
   * des alertes et le simulateur travaillent en euros.
   */
  displayFromEur(value: Big | DecimalString | null, day?: string): Big | null {
    if (value === null) return null;
    const big = D(value);
    if (this.currency === 'EUR') return big;
    const rate = this.fxLookup.rate(day ?? nowIso().slice(0, 10));
    return rate === null ? null : big.times(rate);
  }

  /**
   * Contexte de marché (décision n° 44) : indice Fear & Greed du jour, `null` tant qu'il n'a pas
   * été demandé. Chargé UNIQUEMENT si le réglage opt-in est coché — jamais au démarrage.
   */
  marketContext = $state<FearGreedPoint | null>(null);
  marketContextLoading = $state(false);

  /** Recharge l'indice si l'opt-in est actif ; sans opt-in, efface ce qui traînerait en mémoire. */
  async refreshMarketContext(): Promise<void> {
    if (!this.state.ui.marketContext) {
      this.marketContext = null;
      return;
    }
    if (this.marketContextLoading) return;
    this.marketContextLoading = true;
    try {
      this.marketContext = await loadFearGreed();
    } finally {
      this.marketContextLoading = false;
    }
  }

  /**
   * Retour à l'euro depuis la devise d'affichage, au taux du jour indiqué. Réciproque exacte de
   * `displayFromEur` : les calculs qui doivent rester en euros quoi qu'affiche l'app (la fiscalité
   * française, par exemple) repassent par ici.
   */
  eurFromDisplay(value: Big | DecimalString | null, day?: string): Big | null {
    if (value === null) return null;
    const big = D(value);
    if (this.currency === 'EUR') return big;
    const rate = this.fxLookup.rate(day ?? nowIso().slice(0, 10));
    if (rate === null) return null;
    const perEur = D(rate);
    return perEur.eq(D('0')) ? null : big.div(perEur);
  }

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

  /**
   * Analyse de l'abonnement Coinhouse (décision n° 39) : calculée sur les événements dans la
   * DEVISE D'AFFICHAGE (mêmes montants que le rapport) ; le frais fixe du contrefactuel (0,12 €)
   * est converti au même taux du jour.
   */
  subscriptionAnalysis = $derived.by((): SubscriptionAnalysis =>
    analyzeSubscription(this.displayEvents, {
      fixedPerTrade: toDecimalString(this.displayFromEur('0.12') ?? D('0.12')),
    }),
  );

  /**
   * Rendement personnel (XIRR) des flux du rapport, valorisé au JOUR DE LA COTATION retenue par le
   * moteur — pas « aujourd'hui » : un `$derived` qui lirait l'horloge se figerait au premier calcul.
   */
  portfolioXirr = $derived.by((): XirrResult | null => {
    const value = this.report.totals.value;
    const pricedAt = this.report.pricedAt;
    if (value === null || pricedAt === null) return null;
    return xirrEur(this.report.cashFlows, { day: pricedAt.slice(0, 10), valueEur: value });
  });

  /**
   * Constats (décision n° 40) : calculés à partir du rapport déjà en devise d'affichage. Le repère
   * BTC exige l'historique de prix (écran Rapport) ; sans lui, la règle correspondante se tait.
   */
  insights = $derived.by((): Insight[] =>
    this.hasData
      ? buildInsights({
          report: this.report,
          subscription: this.subscriptionAnalysis,
          xirr: this.portfolioXirr,
        })
      : [],
  );

  /**
   * Comptes à déclarer au formulaire 3916-bis (P66) : classement déterministe, sans historique de
   * prix (contrairement à la fiscalité 150 VH bis) — disponible partout, pas seulement au Rapport.
   * Année = l'année civile en cours ; seul `status` compte pour l'écran Comptes, qui n'est pas
   * scopé à un millésime (`usedInYear`/`possiblyClosedInYear` le sont, pour le Rapport).
   */
  declarations = $derived.by((): DeclarationReport =>
    computeDeclarations({
      accounts: this.accounts,
      events: this.events,
      year: Number(nowIso().slice(0, 4)),
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
  accounts = $derived.by((): Account[] =>
    allAccounts({
      rawRowKeys: Object.keys(this.state.rawRows),
      manualEvents: Object.values(this.state.manualEvents),
      manualTrades: Object.values(this.state.manualTrades),
      declared: Object.values(this.state.accounts),
    }),
  );

  /** Comptes de l'espace Investissement (dont les comptes Hyperliquid routés en `spotAsInvestment`). */
  investAccounts = $derived.by((): Account[] => investAccountsOf(this.accounts));

  accountLabels = $derived.by((): Record<AccountId, string> => accountLabelsOf(this.accounts));

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
    // Une clé PRIVÉE étendue donne accès aux fonds : refus immédiat, avant toute écriture.
    if (EXTENDED_PRIVATE_RE.test(address))
      return {
        ok: false,
        error:
          'Ceci est une clé PRIVÉE étendue (xprv/yprv/zprv) : elle donne accès à vos fonds. ' +
          'Ne la collez nulle part. Utilisez la clé PUBLIQUE étendue (xpub, ypub ou zpub).',
      };
    const isWallet = chain === 'btc' && EXTENDED_PUBLIC_RE.test(address);
    const valid = isWallet
      ? true
      : chain === 'btc'
        ? BTC_ADDRESS_RE.test(address)
        : EVM_ADDRESS_RE.test(address);
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
        (isWallet
          ? 'Portefeuille Bitcoin (clé étendue)'
          : `Adresse ${chain === 'btc' ? 'Bitcoin' : EVM_CHAINS[chain].label}`),
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
        scan: null,
        provider: null,
      };
      this.syncStatus = { ...this.syncStatus, [accountId]: { ...current, ...p } };
    };
    patch({ syncing: true, error: null });
    try {
      // Clé étendue : dérivation locale + balayage avec gap limit ; les mouvements sont nets sur
      // TOUTES les adresses du portefeuille, sinon la monnaie rendue passerait pour une réception.
      let result: OnchainSyncResult;
      if (account.chain === 'btc' && EXTENDED_PUBLIC_RE.test(account.address)) {
        const wallet = await syncBtcWallet(account.address, {
          onProgress: (p) => patch({ scan: p }),
        });
        patch({
          scan: { scanned: wallet.derived, used: wallet.used, txs: wallet.movements.length },
        });
        result = wallet;
      } else if (account.chain === 'btc') {
        result = await syncBtcAddress(account.address);
      } else {
        // EVM : Blockscout tant qu'il répond sans clé, sinon les secours (décision n° 32).
        const outcome = await syncEvmWithFallback(account.chain, account.address, {
          explorerKey: this.state.ui.explorerKey,
          explorerFlavor: this.state.ui.explorerFlavor,
        });
        patch({ provider: outcome.provider });
        result = outcome;
      }
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

  /**
   * Pays de l'organisme (P66, 3916-bis) : renseigné par l'utilisateur depuis l'écran Comptes, pour
   * un compte au statut `unknown` (les comptes implicites Coinhouse/Saisies manuelles n'existent
   * pas dans `state.accounts` et ne sont donc jamais éditables ici). `null` efface le champ — le
   * compte redevient `unknown`, jamais un pays deviné.
   */
  setAccountCountry(id: AccountId, country: CountryCode | null): void {
    const existing = this.state.accounts[id];
    if (!existing) return;
    if (country === null) {
      const { country: _country, ...rest } = existing;
      void _country;
      this.state.accounts = { ...this.state.accounts, [id]: rest };
      return;
    }
    this.state.accounts = { ...this.state.accounts, [id]: { ...existing, country } };
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
        scan: null,
        provider: null,
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
    // Taux EUR→USD nécessaires hors affichage dollar : lignes pivot en USD/stables, spot HL,
    // et seuils d'alerte ancrés en dollars (dormants tant que le taux du jour manque).
    if (
      Object.keys(this.state.pivotRows).length > 0 ||
      this.hlAccounts.length > 0 ||
      Object.values(this.state.alerts.rules).some((r) => r.threshold.kind === 'price-usd')
    )
      void this.ensureRates('USD');
    // Prix live opt-in : reprend seulement si l'utilisateur l'avait activé.
    if (this.liveWanted) this.startLive();
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
        this.mirrorError = result.mirrorError;
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
        this.mirrorError = result.mirrorError;
      });
    };
    $effect.root(() => {
      $effect(() => {
        /*
         * NE PAS déplacer ce clone au `flush` (décision n° 81).
         *
         * `$state.snapshot` **est le traqueur de dépendances** : en parcourant le proxy, il lit
         * chaque propriété et enregistre chacune comme dépendance de cet effet. C'est ce qui fait
         * qu'une mutation profonde — une note d'alerte, un réglage imbriqué — réveille la
         * sauvegarde. Ne lire que `this.state` ne suivrait que la référence de tête, et les
         * modifications imbriquées cesseraient **silencieusement** d'être enregistrées : la pire
         * classe de bogue pour cette application.
         *
         * Son coût est réel — un clone profond par mutation, que le debounce de 300 ms ne couvre
         * pas — mais le supprimer demande de remplacer le suivi par un compteur de version bougé
         * par les mutateurs, ce qui appartient à l'extraction de ce fichier (P84). `src/state` n'a
         * aucun test unitaire : optimiser ici sans filet reviendrait à parier sur la persistance.
         */
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
        // Retour au premier plan : rapatrier ce que le service worker a déclenché app fermée.
        else void this.ingestSwFires();
      });
    }
    this.ensureAlertWatch();
    this.updateAppBadge();
    void this.ingestSwFires();
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
      // Pays par défaut de l'organisme (P66), déclaré sur le CONVERTISSEUR (jamais une table à
      // resynchroniser) : posé UNE SEULE FOIS, seulement si le compte n'a encore aucun pays — un
      // réimport ultérieur, ou un choix déjà fait par l'utilisateur, ne sont jamais écrasés.
      const account = this.state.accounts[accountId];
      const defaultCountry = PLATFORM_CONVERTERS.find(
        (c) => c.id === result.report.format,
      )?.country;
      if (account && !account.country && defaultCountry)
        this.state.accounts = {
          ...this.state.accounts,
          [accountId]: { ...account, country: defaultCountry },
        };
      // Les montants USD/stables du fichier ont besoin des taux BCE de leurs jours.
      void this.ensureRates('USD');
      void requestPersistentStorage();
    }
    return result;
  }

  /**
   * Importe un CSV inconnu avec un appariement de colonnes **confirmé par l'utilisateur** (P64),
   * et **mémorise cet appariement sur le compte**.
   *
   * La mémorisation est liée à l'empreinte de l'en-tête (`headerKey`) : l'export du mois suivant,
   * s'il a le même en-tête, retrouve l'appariement tout seul ; un en-tête différent repose la
   * question. Sans elle, l'utilisateur referait le même travail à chaque export mensuel — et un
   * appariement rejoué sur des colonnes décalées produirait des montants faux en silence.
   */
  importMapped(
    text: string,
    fileName: string,
    accountId: AccountId,
    mapping: ConfirmedMapping,
    now = nowMs(),
  ): PivotImportResult {
    this.exitDemo();
    const importId = `imp:${now.toString(36)}`;
    const usd = rateLookup(this.state.fx.rates.USD ?? {});
    const result = importMappedCsv(
      text,
      mapping,
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
      this.rememberMapping(accountId, result.report.header, mapping, now);
      void this.ensureRates('USD');
      void requestPersistentStorage();
    }
    return result;
  }

  /**
   * Le taux BCE EUR/USD d'un jour, tel que l'import l'emploie. Exposé pour que l'écran
   * d'appariement puisse **rejouer l'import à blanc** avec exactement les mêmes taux que l'import
   * réel : un vérificateur qui verrait d'autres taux ne vérifierait pas l'import qui va se faire.
   */
  usdRate(day: string): string | null {
    return rateLookup(this.state.fx.rates.USD ?? {}).rate(day);
  }

  /** Pose l'appariement confirmé sur le compte, sous l'empreinte de l'en-tête qu'il décrit. */
  private rememberMapping(
    accountId: AccountId,
    header: readonly string[],
    mapping: ConfirmedMapping,
    now: number,
  ): void {
    const account = this.state.accounts[accountId];
    if (!account) return;
    const stored: StoredColumnMapping = {
      headerKey: headerFingerprint(header),
      columns: { ...mapping.columns } as Record<string, number>,
      typeLabels: { ...mapping.typeLabels },
      confirmedAt: nowIso(now),
    };
    if (mapping.impliedCurrencies && Object.keys(mapping.impliedCurrencies).length > 0)
      stored.impliedCurrencies = { ...mapping.impliedCurrencies } as Record<string, string>;
    this.state.accounts = {
      ...this.state.accounts,
      [accountId]: { ...account, columnMapping: stored },
    };
  }

  /**
   * L'appariement mémorisé d'un compte, **s'il décrit le même en-tête**. `null` sinon : une
   * plateforme qui renomme, ajoute ou retire une colonne repose la question.
   */
  rememberedMapping(accountId: AccountId, header: readonly string[]): ConfirmedMapping | null {
    const stored = this.state.accounts[accountId]?.columnMapping;
    if (!stored || stored.headerKey !== headerFingerprint(header)) return null;
    const implied = stored.impliedCurrencies;
    return implied === undefined
      ? { columns: stored.columns as ConfirmedMapping['columns'], typeLabels: stored.typeLabels }
      : {
          columns: stored.columns as ConfirmedMapping['columns'],
          typeLabels: stored.typeLabels,
          impliedCurrencies: implied as NonNullable<ConfirmedMapping['impliedCurrencies']>,
        };
  }

  /**
   * **Annule un import**, par identifiant : ses lignes partent, ses qualifications aussi, et le
   * portefeuille se recalcule.
   *
   * Une fonctionnalité qui *propose* un appariement doit pouvoir défaire son erreur. Un
   * appariement confirmé à tort pollue le portefeuille d'un second jeu de clés que le
   * dédoublonnage par hachage (décision n° 26) ne rattrapera **pas** — les clés d'un mauvais
   * appariement sont, elles, parfaitement valides. Sans « annuler », le seul recours serait de
   * supprimer le compte entier, donc aussi les imports corrects qu'il porte.
   *
   * Seules les lignes que CET import a réellement ajoutées partent : une ligne déjà connue garde
   * l'identifiant de l'import qui l'a insérée la première (le pipeline n'écrase jamais), donc un
   * ré-import annulé ne retire jamais les lignes d'un import antérieur.
   */
  undoImport(importId: string): { removed: number } | null {
    const batch = this.state.imports.find((i) => i.id === importId);
    if (!batch) return null;
    let removed = 0;
    const pivotRows: Record<RowKey, RawPivotRow> = {};
    const qualifications = { ...this.state.qualifications };
    for (const [key, row] of Object.entries(this.state.pivotRows)) {
      if (row.importId === importId) {
        removed += 1;
        delete qualifications[key];
        continue;
      }
      pivotRows[key] = row;
    }
    const rawRows: Record<RowKey, RawCoinhouseRow> = {};
    for (const [key, row] of Object.entries(this.state.rawRows)) {
      if (row.importId === importId) {
        removed += 1;
        delete qualifications[key];
        continue;
      }
      rawRows[key] = row;
    }
    this.state.pivotRows = pivotRows;
    this.state.rawRows = rawRows;
    this.state.qualifications = qualifications;
    this.state.imports = this.state.imports.filter((i) => i.id !== importId);
    // L'appariement mémorisé n'est pas retiré : l'utilisateur annule un import, pas forcément le
    // travail d'appariement qu'il vient de faire. L'écran lui propose de le corriger et de
    // recommencer, ce qui serait impossible s'il disparaissait avec les lignes.
    return { removed };
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

  /**
   * Tranche un doublon candidat (P68) : confirmé ou écarté, il n'est plus reproposé — `null` le
   * remet en attente. `pairKey` vient de `duplicatePairKey(a, b)` (`$lib/domain/reconciliation`) :
   * jamais de suppression de données, seulement la décision de l'utilisateur.
   */
  setDuplicateReview(pairKey: string, review: DuplicateReview | null): void {
    const next = { ...this.state.duplicateOverrides };
    if (review === null) delete next[pairKey];
    else next[pairKey] = review;
    this.state.duplicateOverrides = next;
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

  /**
   * Rapport **en euros**, quelle que soit la devise d'affichage : socle de la traçabilité (P61).
   * Une trace convertie ajouterait un arrondi par niveau et cesserait de boucler ; c'est le même
   * choix que les montants fiscaux (docs/DECISIONS.md n° 43). En euros, c'est le rapport affiché.
   */
  eurReport = $derived.by((): PortfolioReport =>
    this.currency === 'EUR'
      ? this.report
      : computePortfolio({
          events: this.events,
          prices: this.quotes,
          settings: this.state.engineSettings,
          balances: balanceRecords(Object.values(this.state.rawRows)),
        }),
  );

  /**
   * « Pourquoi ce chiffre ? » — la chaîne complète d'un montant affiché, jusqu'aux lignes brutes.
   * L'accesseur de lignes couvre les DEUX magasins (export Coinhouse et format pivot) : sans cela,
   * la moitié des utilisateurs ne verraient que des trous.
   */
  trace(target: TraceTarget): Trace {
    return traceMetric({
      report: this.eurReport,
      target,
      settings: this.state.engineSettings,
      events: this.events,
      row: (key) => {
        const raw = this.state.rawRows[key];
        if (raw) return coinhouseTraceRow(raw);
        const pivot = this.state.pivotRows[key];
        return pivot ? pivotTraceRow(pivot) : null;
      },
    });
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
  qualified = $derived.by((): QualifiedSummary[] =>
    qualifiedSummaries(this.state.qualifications, this.state.pivotRows, this.state.rawRows),
  );

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
    this.runAlertEvaluation();
  }

  /**
   * Force l'identifiant CoinGecko d'un actif. C'est le rattrapage de la couverture automatique :
   * un symbole **ambigu** ne reçoit délibérément aucun identifiant — deux projets peuvent partager
   * un ticker, et un mauvais identifiant donne un prix faux, donc un PRU faux — et c'est
   * l'utilisateur qui tranche. Le champ existait dans le modèle depuis longtemps sans qu'aucun
   * écran ne permette de le saisir.
   */
  setCoingeckoId(asset: AssetCode, id: string | null): void {
    const current = this.assetSettings(asset);
    this.state.assetSettings = {
      ...this.state.assetSettings,
      [asset]: { ...current, coingeckoId: id },
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
    this.restartLive();
  }

  /** Exécutions en direct (P26) : opt-in séparé des prix, sur le même socket. */
  setLiveFills(enabled: boolean): void {
    this.setUi({ liveFills: enabled });
    this.restartLive();
  }

  /** Vrai si au moins un des deux flux est demandé (le socket n'existe que dans ce cas). */
  private get liveWanted(): boolean {
    return this.state.ui.liveMids || (this.state.ui.liveFills && this.hlAccounts.length > 0);
  }

  /** Un réglage a changé : le socket est reconstruit avec la nouvelle liste d'abonnements. */
  private restartLive(): void {
    this.stopLive();
    if (this.liveWanted) this.startLive();
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
    this.liveClient = createLiveSocket({
      // Relue à chaque connexion : un compte ajouté après coup est pris en compte, et une
      // reconnexion ne repart jamais amputée de ses abonnements.
      subscriptions: () => [
        ...(this.state.ui.liveMids ? [{ type: 'allMids' }] : []),
        ...(this.state.ui.liveFills
          ? liveFillSubscriptions(this.hlAccounts.map((a) => a.address ?? ''))
          : []),
      ],
      onMessage: (channel, data) => this.onLiveMessage(channel, data),
      onStatus: (status) => {
        this.liveStatus = status;
      },
    });
    // Onglet caché → socket fermé (batterie, débit) ; visible → reprise si toujours activé.
    this.liveVisibilityHandler = () => {
      if (!this.liveClient) return;
      if (document.visibilityState === 'hidden') this.liveClient.stop();
      else if (this.liveWanted) this.liveClient.start();
    };
    document.addEventListener('visibilitychange', this.liveVisibilityHandler);
    if (document.visibilityState !== 'hidden') this.liveClient.start();
  }

  /** Aiguillage des messages du socket partagé (prix d'un côté, exécutions de l'autre). */
  private onLiveMessage(channel: string, data: unknown): void {
    if (channel === 'allMids') {
      const mids = parseMids(data);
      if (mids !== null) this.applyLiveMids(mids);
      return;
    }
    const envelope = readLiveEnvelope(channel, data);
    if (envelope === null || envelope.user === null) return;
    const accountId = hlAccountId(envelope.user);
    const current = this.state.hyperliquid.accounts[accountId];
    if (!current) return; // message pour une adresse qu'on ne suit plus : ignoré
    const { data: merged, added } = mergeLiveEnvelope(current, envelope);
    if (added === 0) return; // le snapshot rejoue l'historique : ne rien réécrire pour rien
    this.state.hyperliquid = {
      ...this.state.hyperliquid,
      accounts: { ...this.state.hyperliquid.accounts, [accountId]: merged },
    };
    this.liveFillsAt = nowIso();
    this.liveFillsCount += added;
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
    this.runAlertEvaluation();
  }

  // --- Alertes de prix (P29, décision n° 36) ----------------------------------------------------

  private alertWatchTimer: ReturnType<typeof setInterval> | null = null;
  private alertVisibilityHandler: (() => void) | null = null;
  /** Vérification en arrière-plan (Periodic Background Sync, décision n° 38) : état affiché. */
  backgroundSyncStatus = $state<BackgroundSyncStatus>('idle');
  private lastAlertSnapshotJson: string | null = null;
  private lastBackgroundWanted: boolean | null = null;

  /**
   * Positions vues par les alertes : PRU et quantité EUR par actif détenu.
   *
   * **En euros**, parce que les seuils sont stockés en euros — la devise des données — et que leur
   * évaluation ne doit jamais dépendre de la devise d'affichage. C'est exactement ce que fait déjà
   * `eurReport` pour la traçabilité : un second dérivé au corps identique existait ici, qui
   * recalculait tout le portefeuille une deuxième fois à chaque changement d'état (décision n° 94).
   */
  alertPositions = $derived.by((): Record<AssetCode, AlertPositionInput> => {
    const result: Record<AssetCode, AlertPositionInput> = {};
    const report = this.eurReport;
    for (const p of [...report.positions, ...report.stablecoins])
      result[p.asset] = {
        pruEur: p.pru ? toDecimalString(p.pru) : null,
        qty: toDecimalString(p.qty),
      };
    return result;
  });

  /** Position du rapport EN EUROS (simulateur, alertes) ; `null` si l'actif est inconnu. */
  positionEur(asset: AssetCode): PositionReport | null {
    const report = this.eurReport;
    return (
      [...report.positions, ...report.stablecoins, ...report.closed, ...report.blocked].find(
        (p) => p.asset === asset,
      ) ?? null
    );
  }

  /** Règles triées par actif puis ancienneté (ordre stable de la page Alertes). */
  alertRules = $derived.by((): AlertRule[] =>
    Object.values(this.state.alerts.rules).sort(
      (a, b) => a.asset.localeCompare(b.asset) || a.createdAt.localeCompare(b.createdAt),
    ),
  );

  unreadAlertCount = $derived(this.state.alerts.events.filter((e) => !e.read).length);

  /** Règles actives et armées : la veille n'a de raison de tourner que s'il y en a. */
  armedAlertCount = $derived(
    this.alertRules.filter((r) => r.enabled && (this.state.alerts.states[r.id]?.armed ?? false))
      .length,
  );

  /** Cotations EUR fraîches uniquement : le cache périmé ne déclenche jamais une alerte. */
  private alertPricesEur(): Record<AssetCode, string> {
    const prices: Record<AssetCode, string> = {};
    for (const [asset, quote] of Object.entries(this.quotes))
      if (!quote.stale) prices[asset] = quote.priceEur;
    return prices;
  }

  /**
   * Évalue toutes les règles sur les cotations fraîches ; journalise, notifie et ré-évalue la
   * veille. Appelée après chaque arrivée de prix (actualisation, live, prix manuel) — jamais en
   * boucle réactive : le flux reste lisible et testable.
   */
  private runAlertEvaluation(): void {
    const rules = Object.values(this.state.alerts.rules);
    if (rules.length === 0) return;
    const { states, fired } = evaluateAlerts({
      rules,
      states: this.state.alerts.states,
      pricesEur: this.alertPricesEur(),
      positions: this.alertPositions,
      usdPerEur: this.usdPerEurToday,
      // Contexte de marché : `null` si l'opt-in est décoché — les règles qui en dépendent dorment.
      fearGreed: this.marketContext?.value ?? null,
      nowMs: nowMs(),
    });
    if (fired.length > 0) {
      const at = nowIso();
      const stamp = nowMs().toString(36);
      const events: AlertEvent[] = fired.map((f, i) => ({
        id: `al:e${stamp}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        ruleId: f.rule.id,
        asset: f.rule.asset,
        direction: f.rule.direction,
        thresholdEur: f.thresholdEur,
        priceEur: f.priceEur,
        pruEur: f.pruEur,
        at,
        read: false,
      }));
      this.state.alerts = {
        ...this.state.alerts,
        states,
        events: [...events, ...this.state.alerts.events].slice(0, MAX_ALERT_EVENTS),
      };
      for (const fire of fired) this.notifyAlert(fire);
    } else if (!sameAlertStates(states, this.state.alerts.states)) {
      this.state.alerts = { ...this.state.alerts, states };
    }
    this.updateAppBadge();
    this.ensureAlertWatch();
  }

  /** Toast in-app systématique + notification système si l'utilisateur l'a activée. */
  private notifyAlert(fire: AlertFire): void {
    const asset = fire.rule.asset.toUpperCase();
    const sign = fire.rule.direction === 'below' ? '≤' : '≥';
    // Montants dans la devise d'affichage (repli euro si le taux du jour manque).
    const show = (v: DecimalString): string => {
      const converted = this.displayFromEur(v);
      return converted === null ? fmtPrice(v) : fmtPrice(converted, this.currency);
    };
    const body = `${show(fire.priceEur)} ${sign} seuil ${show(fire.thresholdEur)}${
      fire.pruEur !== null ? ` · PRU ${show(fire.pruEur)}` : ''
    }`;
    toasts.push(`Alerte ${asset} : ${body}`, 'info', 8000);
    if (this.state.alerts.settings.systemNotifications)
      void showSystemNotification({ title: `Alerte ${asset}`, body, tag: fire.rule.id });
  }

  /** Pastille d'application (PWA installée, Chromium/iOS) : nombre d'alertes non lues. */
  private updateAppBadge(): void {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    try {
      const unread = this.unreadAlertCount;
      if (unread > 0) void nav.setAppBadge?.(unread)?.catch(() => {});
      else void nav.clearAppBadge?.()?.catch(() => {});
    } catch {
      // Badging API absente : le badge in-app suffit.
    }
  }

  /** Crée une règle, armée sans jamais déclencher à la création (franchissement seulement). */
  addAlertRule(
    input: Pick<AlertRule, 'asset' | 'direction' | 'threshold' | 'repeat' | 'note'>,
  ): AlertRule {
    const id = `al:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const rule: AlertRule = {
      id,
      asset: input.asset,
      direction: input.direction,
      threshold: input.threshold,
      repeat: input.repeat,
      enabled: true,
      note: input.note.trim().slice(0, 200),
      createdAt: nowIso(),
    };
    this.state.alerts = {
      ...this.state.alerts,
      rules: { ...this.state.alerts.rules, [id]: rule },
      states: { ...this.state.alerts.states, [id]: this.freshAlertState(rule) },
    };
    // Seuil ancré en dollars : il a besoin du taux BCE du jour pour s'évaluer.
    if (rule.threshold.kind === 'price-usd') void this.ensureRates('USD');
    this.ensureAlertWatch();
    return rule;
  }

  /** État neuf d'une règle : armée seulement si la condition n'est pas déjà remplie. */
  private freshAlertState(rule: AlertRule): AlertRuleState {
    const threshold = alertThresholdEur(
      rule,
      this.alertPositions[rule.asset] ?? null,
      this.usdPerEurToday,
    );
    const price = this.alertPricesEur()[rule.asset];
    const condition =
      threshold !== null &&
      price !== undefined &&
      alertConditionMet(rule.direction, D(price), threshold);
    return initialAlertState(condition);
  }

  /** Modifie une règle ; le seuil ayant pu changer, l'armement est recalculé (compteurs gardés). */
  updateAlertRule(rule: AlertRule): void {
    const existing = this.state.alerts.rules[rule.id];
    if (!existing) return;
    const previous = this.state.alerts.states[rule.id];
    const fresh = this.freshAlertState(rule);
    this.state.alerts = {
      ...this.state.alerts,
      rules: { ...this.state.alerts.rules, [rule.id]: { ...rule, note: rule.note.slice(0, 200) } },
      states: {
        ...this.state.alerts.states,
        [rule.id]: previous
          ? {
              ...fresh,
              lastTriggeredAtMs: previous.lastTriggeredAtMs,
              triggerCount: previous.triggerCount,
            }
          : fresh,
      },
    };
    this.ensureAlertWatch();
  }

  removeAlertRule(id: string): void {
    if (!this.state.alerts.rules[id]) return;
    const { [id]: _rule, ...rules } = this.state.alerts.rules;
    void _rule;
    const { [id]: _state, ...states } = this.state.alerts.states;
    void _state;
    this.state.alerts = { ...this.state.alerts, rules, states };
    this.ensureAlertWatch();
  }

  setAlertRuleEnabled(id: string, enabled: boolean): void {
    const rule = this.state.alerts.rules[id];
    if (!rule) return;
    this.updateAlertRule({ ...rule, enabled });
  }

  /** Ré-arme une règle déclenchée (sans déclenchement immédiat si la condition tient encore). */
  rearmAlertRule(id: string): void {
    const rule = this.state.alerts.rules[id];
    const previous = this.state.alerts.states[id];
    if (!rule || !previous) return;
    this.state.alerts = {
      ...this.state.alerts,
      states: {
        ...this.state.alerts.states,
        [id]: {
          ...this.freshAlertState(rule),
          lastTriggeredAtMs: null,
          triggerCount: previous.triggerCount,
        },
      },
    };
    this.ensureAlertWatch();
  }

  markAlertEventsRead(): void {
    if (this.unreadAlertCount === 0) return;
    this.state.alerts = {
      ...this.state.alerts,
      events: this.state.alerts.events.map((e) => (e.read ? e : { ...e, read: true })),
    };
    this.updateAppBadge();
  }

  clearAlertEvents(): void {
    if (this.state.alerts.events.length === 0) return;
    this.state.alerts = { ...this.state.alerts, events: [] };
    this.updateAppBadge();
  }

  setAlertsSettings(patch: Partial<AlertsSettings>): void {
    this.state.alerts = {
      ...this.state.alerts,
      settings: { ...this.state.alerts.settings, ...patch },
    };
    this.ensureAlertWatch();
  }

  /**
   * Démarre/arrête la veille des prix : seulement si elle est activée, qu'au moins une règle est
   * armée et que la source de prix automatique n'est pas coupée. Onglet ouvert uniquement — le
   * navigateur regroupe les réveils en arrière-plan à la minute, ce qu'une cadence ≥ 1 min
   * absorbe ; au retour au premier plan, un tick immédiat rattrape un franchissement manqué.
   */
  private ensureAlertWatch(): void {
    if (typeof document === 'undefined') return;
    const wanted =
      this.state.alerts.settings.watch &&
      this.armedAlertCount > 0 &&
      this.state.ui.priceSource !== 'off';
    if (wanted && this.alertWatchTimer === null) {
      this.alertWatchTimer = setInterval(() => this.alertWatchTick(), ALERT_WATCH_TICK_MS);
      this.alertVisibilityHandler = () => {
        if (document.visibilityState === 'visible') this.alertWatchTick();
      };
      document.addEventListener('visibilitychange', this.alertVisibilityHandler);
    } else if (!wanted && this.alertWatchTimer !== null) {
      clearInterval(this.alertWatchTimer);
      this.alertWatchTimer = null;
      if (this.alertVisibilityHandler) {
        document.removeEventListener('visibilitychange', this.alertVisibilityHandler);
        this.alertVisibilityHandler = null;
      }
    }
    this.syncAlertBackground();
  }

  /**
   * Aligne l'instantané du service worker et l'enregistrement Periodic Background Sync
   * (décision n° 38) sur l'état courant : mêmes conditions que la veille, plus les notifications
   * système accordées (sans elles, un réveil app fermée n'aurait aucun canal). Appelée par
   * `ensureAlertWatch`, donc après chaque évaluation, règle ou réglage modifiés.
   */
  private syncAlertBackground(): void {
    if (typeof window === 'undefined') return;
    // `systemNotifications` vaut intention : il ne s'active que via un `requestPermission`
    // accordé, et l'affichage re-vérifie la permission au dernier moment (une révocation rend
    // la notification muette, jamais fautive). Ne PAS relire `Notification.permission` ici :
    // le getter statique peut différer du résultat de `requestPermission` (vu en headless).
    const wanted =
      this.state.alerts.settings.watch &&
      this.state.alerts.settings.systemNotifications &&
      this.state.ui.priceSource !== 'off' &&
      this.armedAlertCount > 0;
    const snapshot = wanted
      ? buildAlertWatchSnapshot({
          rules: Object.values(this.state.alerts.rules),
          states: this.state.alerts.states,
          positions: this.alertPositions,
          usdPerEur: this.usdPerEurToday,
          idOverrides: Object.fromEntries(
            Object.entries(this.state.assetSettings).map(([a, s]) => [a, s.coingeckoId]),
          ),
          coingeckoDemoKey: this.state.ui.coingeckoDemoKey,
          notifUrl: alertsUrl(),
          icon: notifIconUrl(),
          nowMs: nowMs(),
        })
      : null;
    // L'horodatage change à chaque appel : la comparaison l'ignore pour n'écrire que l'utile.
    const comparable = snapshot === null ? null : JSON.stringify({ ...snapshot, updatedAtMs: 0 });
    if (comparable !== this.lastAlertSnapshotJson) {
      this.lastAlertSnapshotJson = comparable;
      void writeAlertWatchSnapshot(snapshot);
    }
    const effective = wanted && snapshot !== null && snapshot.rules.some((r) => r.armed);
    if (effective !== this.lastBackgroundWanted) {
      this.lastBackgroundWanted = effective;
      void syncAlertWatchTask(effective, this.state.alerts.settings.watchMinutes).then((status) => {
        this.backgroundSyncStatus = status;
      });
    }
  }

  /**
   * Journalise les déclenchements survenus APP FERMÉE (déposés par le service worker) : états
   * désarmés, événements ajoutés, badge — mais jamais de nouvelle notification système (le
   * service worker l'a déjà montrée). Un déclenchement plus vieux que le dernier connu de
   * l'app est ignoré (l'app a déjà mieux).
   */
  private async ingestSwFires(): Promise<void> {
    const fires = await takePendingSwFires();
    if (fires.length === 0) return;
    const rules = this.state.alerts.rules;
    let states = this.state.alerts.states;
    const events: AlertEvent[] = [];
    for (const fire of fires) {
      if (!rules[fire.ruleId]) continue;
      const previous = states[fire.ruleId];
      const last = previous?.lastTriggeredAtMs ?? null;
      if (last !== null && fire.atMs <= last) continue;
      states = {
        ...states,
        [fire.ruleId]: {
          armed: false,
          lastTriggeredAtMs: fire.atMs,
          triggerCount: (previous?.triggerCount ?? 0) + 1,
        },
      };
      events.push({
        id: `al:sw${fire.atMs.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        ruleId: fire.ruleId,
        asset: fire.asset,
        direction: fire.direction,
        thresholdEur: fire.thresholdEur,
        priceEur: fire.priceEur,
        pruEur: fire.pruEur,
        at: nowIso(fire.atMs),
        read: false,
      });
    }
    if (events.length === 0) return;
    this.state.alerts = {
      ...this.state.alerts,
      states,
      events: [...events, ...this.state.alerts.events].slice(0, MAX_ALERT_EVENTS),
    };
    toasts.push(
      events.length === 1
        ? 'Une alerte s’est déclenchée en arrière-plan (app fermée).'
        : `${events.length} alertes se sont déclenchées en arrière-plan (app fermée).`,
      'info',
      8000,
    );
    this.updateAppBadge();
    this.ensureAlertWatch();
  }

  /** Un tick n'actualise que si la dernière cotation est plus vieille que la cadence choisie. */
  private alertWatchTick(): void {
    this.ensureAlertWatch();
    if (this.alertWatchTimer === null || this.priceStatus.loading) return;
    const last = this.priceStatus.lastRefreshAt ? Date.parse(this.priceStatus.lastRefreshAt) : 0;
    if (nowMs() - last >= this.state.alerts.settings.watchMinutes * 60_000)
      void this.refreshPrices(true);
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
    this.runAlertEvaluation();
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
    this.ensureAlertWatch();
    this.updateAppBadge();
    return { ok: true };
  }

  /**
   * L'effacement DEMANDÉ par l'utilisateur — à ne pas confondre avec `clearAll()` (décision n° 88).
   *
   * `clearAll()` sert aussi à quitter la démo : y loger la purge du cache d'historique viderait
   * les cours réels de l'utilisateur au retour de la démonstration. L'effacement est donc un geste
   * à part, et c'est LUI qui doit tenir la promesse faite par la boîte de dialogue — « supprime
   * l'historique importé, vos saisies et vos réglages ». Sans la ligne ci-dessous, la base
   * `crch-history` survivait à cet effacement, avec une entrée par actif : la liste complète de
   * tout ce qui a été détenu, sur une machine peut-être partagée.
   */
  async eraseAll(): Promise<void> {
    this.clearAll();
    await eraseHistoryCache();
  }

  clearAll(): void {
    void clearPersistedState();
    this.state = emptyState();
    this.liveQuotes = {};
    this.syncStatus = {};
    this.hlClient = null;
    this.ensureAlertWatch();
    this.updateAppBadge();
  }
}

export const app = new AppState();
