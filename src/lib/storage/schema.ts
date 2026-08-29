/** État persisté (localStorage + sauvegarde JSON), versionné. */
import type { AlertGate, AlertEvent, AlertRule, AlertRuleState } from '../domain/alerts';
import type { PriceQuoteInput } from '../domain/engine/report';
import { EMPTY_FX_CACHE, type Currency, type FxCache } from '../fx/types';
import { METRICS, type Metric } from '../history/metrics';
import { KEYED_FLAVORS, type ExplorerFlavor } from '../import/onchain/etherscan';
import type { JournalEntry, ManualTrade, TradePlan } from '../domain/trading/journal';
import { emptyHlState, type HlState } from '../import/hyperliquid/data';
import { sanitizeHlState } from '../import/hyperliquid/sanitize';
import {
  DEFAULT_ENGINE_SETTINGS,
  type Account,
  type AccountId,
  type AssetCode,
  type DecimalString,
  type EngineSettings,
  type EventId,
  type ManualEvent,
  type Qualification,
  type RawCoinhouseRow,
  type RawPivotRow,
  type RowKey,
} from '../domain/types';
import type { PivotAmount } from '../domain/types';
import type { TransferOverride } from '../domain/transfers';

export const SCHEMA_VERSION = 1 as const;
export const APP_ID = 'cout-revient-ch';

export interface ImportBatchMeta {
  id: string;
  /** ISO 8601. */
  at: string;
  fileName: string;
  rows: number;
  newRows: number;
  /** Diagnostic (jamais de données) ; absent sur les imports antérieurs à cette version. */
  format?: string;
  header?: string[];
  unknownColumns?: string[];
  /** Compte de destination (imports pivot) ; absent pour l'export Coinhouse. */
  accountId?: string;
}

export interface AssetSettings {
  manualPriceEur: DecimalString | null;
  manualPriceAt: string | null;
  coingeckoId: string | null;
}

export interface UiSettings {
  theme: 'auto' | 'dark' | 'light';
  discreet: boolean;
  hideClosed: boolean;
  priceSource: 'auto' | 'off';
  /** Devise d'affichage ; l'euro reste la devise des données. */
  displayCurrency: Currency;
  /** Métrique tracée par défaut sur les cartes « Évolution ». */
  chartMetric: Metric;
  /** Métrique par défaut sur la page d'un actif (PRU vs prix). */
  assetChartMetric: Metric;
  lastBackupAt: string | null;
  disclaimerAcceptedAt: string | null;
  /** Données d'exemple (jeu synthétique) chargées pour essayer l'outil : bandeau + garde-fous. */
  demoMode: boolean;
  /** Dernière version dont l'utilisateur a vu (ou ignoré) les nouveautés ; null = première visite. */
  lastSeenVersion: string | null;
  /**
   * Clé CoinGecko « Demo » (gratuite, optionnelle) : lève les limites de débit du plan public.
   * Propre à l'appareil (jamais dans une sauvegarde fusionnée), envoyée en en-tête uniquement.
   */
  coingeckoDemoKey: string | null;
  /**
   * Clé d'explorateur de blocs (Etherscan V2 ou Blockscout Pro), gratuite et facultative : elle ne
   * lit que des données publiques et ne peut rien signer — à la différence d'une clé d'exchange,
   * qui reste refusée (décision n° 32). Propre à l'appareil, envoyée au seul explorateur choisi.
   */
  explorerKey: string | null;
  explorerFlavor: ExplorerFlavor;
  /** Prix « live » Hyperliquid (WebSocket) : opt-in, jamais actif par défaut. */
  liveMids: boolean;
  /**
   * Contexte de marché (indice Fear & Greed d’alternative.me) : opt-in RÉSEAU distinct des prix,
   * décoché par défaut — c’est la seule donnée qui ne vienne ni de vos opérations ni de vos actifs.
   */
  marketContext: boolean;
  /** Exécutions en direct (`userFills`) : opt-in distinct des prix, même socket. */
  liveFills: boolean;
}

/** Réglages des alertes de prix (P29, décision n° 36). */
export interface AlertsSettings {
  /** Veille automatique des prix quand des alertes sont armées (onglet ouvert uniquement). */
  watch: boolean;
  /** Cadence de la veille en minutes (1 à 60 ; ≥ 1 min pour rester sous le throttling navigateur). */
  watchMinutes: number;
  /** Notifications système (opt-in explicite, en plus du centre in-app). */
  systemNotifications: boolean;
}

/** Alertes de prix : règles, états d'armement, journal des déclenchements, réglages. */
export interface AlertsState {
  rules: Record<string, AlertRule>;
  states: Record<string, AlertRuleState>;
  /** Déclenchements, du plus récent au plus ancien, bornés à `MAX_ALERT_EVENTS`. */
  events: AlertEvent[];
  settings: AlertsSettings;
}

export const DEFAULT_ALERTS_SETTINGS: AlertsSettings = {
  watch: false,
  watchMinutes: 2,
  systemNotifications: false,
};

export const MAX_ALERT_EVENTS = 100;

export function emptyAlertsState(): AlertsState {
  return { rules: {}, states: {}, events: [], settings: { ...DEFAULT_ALERTS_SETTINGS } };
}

export interface StoredStateV1 {
  schemaVersion: typeof SCHEMA_VERSION;
  imports: ImportBatchMeta[];
  rawRows: Record<RowKey, RawCoinhouseRow>;
  /** Lignes du CSV pivot (Koinly/Waltio) par clé de contenu ; le compte est porté par la ligne. */
  pivotRows: Record<RowKey, RawPivotRow>;
  manualEvents: Record<string, ManualEvent>;
  qualifications: Record<EventId, Qualification>;
  /** Corrections d'appariement de virements : id de retrait → id de dépôt imposé ou « none ». */
  transferOverrides: Record<EventId, TransferOverride>;
  /** Réservé au futur mode fiscal (valeur globale du portefeuille au jour de chaque cession). */
  taxAnnotations: Record<EventId, { portfolioValueEur: DecimalString | null }>;
  assetSettings: Record<AssetCode, AssetSettings>;
  /** Comptes déclarés par l'utilisateur (les comptes implicites `ch:main` / `man:default` n'y sont pas). */
  accounts: Record<AccountId, Account>;
  /** Bruts Hyperliquid par compte (fills, funding, grand livre, instantané) et paires spot. */
  hyperliquid: HlState;
  /** Journal de trading : une entrée par trade (aller-retour reconstruit ou trade manuel). */
  journal: Record<string, JournalEntry>;
  /** Trades saisis à la main (plateformes sans API) ; le P&L est calculé, jamais stocké. */
  manualTrades: Record<string, ManualTrade>;
  engineSettings: EngineSettings;
  priceCache: Record<AssetCode, PriceQuoteInput>;
  /** Taux de change BCE mis en cache (EUR → devises d'affichage). */
  fx: FxCache;
  /** Alertes de prix relatives au PRU (règles, états, journal, réglages). */
  alerts: AlertsState;
  ui: UiSettings;
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  theme: 'auto',
  discreet: false,
  hideClosed: false,
  priceSource: 'auto',
  displayCurrency: 'EUR',
  chartMetric: 'value',
  assetChartMetric: 'pru',
  lastBackupAt: null,
  disclaimerAcceptedAt: null,
  demoMode: false,
  lastSeenVersion: null,
  coingeckoDemoKey: null,
  explorerKey: null,
  explorerFlavor: 'etherscan',
  liveMids: false,
  marketContext: false,
  liveFills: false,
};

export function emptyState(): StoredStateV1 {
  return {
    schemaVersion: SCHEMA_VERSION,
    imports: [],
    rawRows: {},
    pivotRows: {},
    manualEvents: {},
    qualifications: {},
    transferOverrides: {},
    taxAnnotations: {},
    assetSettings: {},
    accounts: {},
    hyperliquid: emptyHlState(),
    journal: {},
    manualTrades: {},
    engineSettings: { ...DEFAULT_ENGINE_SETTINGS },
    priceCache: {},
    fx: { ...EMPTY_FX_CACHE, rates: {}, updatedAt: {} },
    alerts: emptyAlertsState(),
    ui: { ...DEFAULT_UI_SETTINGS },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Garde runtime minimale : structure générale et types des conteneurs. */
export function isStoredStateV1(value: unknown): value is StoredStateV1 {
  if (!isRecord(value) || value['schemaVersion'] !== SCHEMA_VERSION) return false;
  return (
    Array.isArray(value['imports']) &&
    isRecord(value['rawRows']) &&
    isRecord(value['manualEvents']) &&
    isRecord(value['qualifications']) &&
    isRecord(value['engineSettings'])
  );
}

/** Complète les clés absentes (compatibilité ascendante au sein de la v1). */
export function withDefaults(state: StoredStateV1): StoredStateV1 {
  const empty = emptyState();
  return {
    ...empty,
    ...state,
    engineSettings: { ...empty.engineSettings, ...state.engineSettings },
    ui: { ...empty.ui, ...(isRecord(state.ui) ? state.ui : {}) },
    pivotRows: isRecord(state.pivotRows) ? state.pivotRows : {},
    transferOverrides: isRecord(state.transferOverrides) ? state.transferOverrides : {},
    taxAnnotations: isRecord(state.taxAnnotations) ? state.taxAnnotations : {},
    assetSettings: isRecord(state.assetSettings) ? state.assetSettings : {},
    accounts: isRecord(state.accounts) ? state.accounts : {},
    hyperliquid: isRecord(state.hyperliquid)
      ? { ...empty.hyperliquid, ...state.hyperliquid }
      : empty.hyperliquid,
    journal: isRecord(state.journal) ? state.journal : {},
    manualTrades: isRecord(state.manualTrades) ? state.manualTrades : {},
    priceCache: isRecord(state.priceCache) ? state.priceCache : {},
    fx: isRecord(state.fx) ? { ...empty.fx, ...state.fx } : empty.fx,
    alerts: isRecord(state.alerts)
      ? {
          ...empty.alerts,
          ...state.alerts,
          settings: {
            ...empty.alerts.settings,
            ...(isRecord(state.alerts.settings) ? state.alerts.settings : {}),
          },
        }
      : empty.alerts,
  };
}

// --- Assainissement des entrées (sauvegardes éditées, versions futures) -----------------------

const DECIMAL = /^-?\d+(\.\d+)?$/;
const NAIVE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const isDecimal = (v: unknown): v is string => typeof v === 'string' && DECIMAL.test(v);
const isDecimalOrNull = (v: unknown): v is string | null =>
  v === null || v === undefined || isDecimal(v);
const decOrNull = (v: unknown): string | null => (isDecimal(v) ? v : null);
const MANUAL_KINDS = new Set(['buy', 'sell', 'reward', 'deposit', 'withdrawal', 'opening-balance']);
const QUALIFICATION_KINDS = new Set([
  'ignore',
  'reward',
  'deposit',
  'withdrawal',
  'purchase',
  'sale',
  'trade',
]);

function sanitizeRow(key: string, raw: unknown): RawCoinhouseRow | null {
  if (!isRecord(raw)) return null;
  const r = raw;
  if (typeof r['at'] !== 'string' || !NAIVE.test(r['at'])) return null;
  if (typeof r['type'] !== 'string' || typeof r['asset'] !== 'string' || r['asset'] === '')
    return null;
  if (!isDecimal(r['qty'])) return null;
  for (const c of ['marketPrice', 'valueEur', 'feeAsset', 'feeEur', 'feeRebate', 'balance']) {
    if (!isDecimalOrNull(r[c])) return null;
  }
  return {
    key,
    importId: typeof r['importId'] === 'string' ? r['importId'] : '',
    lineNo: typeof r['lineNo'] === 'number' ? r['lineNo'] : 0,
    id: typeof r['id'] === 'string' && r['id'] !== '' ? r['id'] : null,
    at: r['at'],
    type: r['type'],
    qty: r['qty'],
    asset: r['asset'],
    marketPrice: decOrNull(r['marketPrice']),
    valueEur: decOrNull(r['valueEur']),
    feeAsset: decOrNull(r['feeAsset']),
    feeEur: decOrNull(r['feeEur']),
    feeRebate: decOrNull(r['feeRebate']),
    balance: decOrNull(r['balance']),
    account: typeof r['account'] === 'string' ? r['account'] : '',
    extra: isRecord(r['extra']) ? (r['extra'] as Record<string, string>) : {},
  };
}

function sanitizePivotAmount(raw: unknown): PivotAmount | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) return undefined;
  if (!isDecimal(raw['amount']) || typeof raw['currency'] !== 'string' || raw['currency'] === '')
    return undefined;
  return { amount: raw['amount'], currency: raw['currency'] };
}

function sanitizePivotRow(key: string, raw: unknown): RawPivotRow | null {
  if (!isRecord(raw)) return null;
  const r = raw;
  if (typeof r['at'] !== 'string' || !NAIVE.test(r['at'])) return null;
  if (typeof r['date'] !== 'string' || r['date'] === '') return null;
  if (typeof r['accountId'] !== 'string' || !ACCOUNT_ID.test(r['accountId'])) return null;
  const sent = sanitizePivotAmount(r['sent']);
  const received = sanitizePivotAmount(r['received']);
  const fee = sanitizePivotAmount(r['fee']);
  const netWorth = sanitizePivotAmount(r['netWorth']);
  if (sent === undefined || received === undefined || fee === undefined || netWorth === undefined)
    return null;
  if (sent === null && received === null) return null;
  const text = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v !== '' ? v.slice(0, max) : null;
  return {
    key,
    importId: typeof r['importId'] === 'string' ? r['importId'] : '',
    lineNo: typeof r['lineNo'] === 'number' ? r['lineNo'] : 0,
    accountId: r['accountId'],
    date: r['date'].slice(0, 40),
    at: r['at'],
    sent,
    received,
    fee,
    netWorth,
    label: text(r['label'], 40),
    description: text(r['description'], 500),
    txHash: text(r['txHash'], 120),
  };
}

const EVENT_ID = /^[A-Za-z0-9:._#+-]{1,200}$/;

function sanitizeManual(id: string, raw: unknown): ManualEvent | null {
  if (!isRecord(raw)) return null;
  const m = raw;
  if (typeof m['kind'] !== 'string' || !MANUAL_KINDS.has(m['kind'])) return null;
  if (typeof m['at'] !== 'string' || !NAIVE.test(m['at'])) return null;
  if (typeof m['asset'] !== 'string' || m['asset'] === '' || !isDecimal(m['qty'])) return null;
  if (!isDecimalOrNull(m['amountEur'])) return null;
  return {
    id,
    at: m['at'],
    kind: m['kind'] as ManualEvent['kind'],
    asset: m['asset'],
    qty: m['qty'],
    amountEur: decOrNull(m['amountEur']),
    scope: m['scope'] === 'external' ? 'external' : 'coinhouse',
    ...(typeof m['accountId'] === 'string' && ACCOUNT_ID.test(m['accountId'])
      ? { accountId: m['accountId'] }
      : {}),
    note: typeof m['note'] === 'string' ? m['note'] : '',
  };
}

const ACCOUNT_ID = /^[a-z]{2,3}:[A-Za-z0-9._-]{1,80}$/;

// --- Journal de trading et trades manuels (P21) -----------------------------------------------

const textOrEmpty = (v: unknown, maxLength: number): string =>
  typeof v === 'string' ? v.slice(0, maxLength) : '';
const RATINGS = new Set([1, 2, 3, 4, 5]);

function sanitizePlan(raw: unknown): TradePlan | null {
  if (!isRecord(raw)) return null;
  const plan: TradePlan = {
    entry: decOrNull(raw['entry']),
    stop: decOrNull(raw['stop']),
    target: decOrNull(raw['target']),
    risk: decOrNull(raw['risk']),
  };
  return plan.entry === null && plan.stop === null && plan.target === null && plan.risk === null
    ? null
    : plan;
}

function sanitizeJournalEntry(tradeId: string, raw: unknown): JournalEntry | null {
  if (!isRecord(raw) || tradeId === '' || tradeId.length > 200) return null;
  return {
    tradeId,
    thesis: textOrEmpty(raw['thesis'], 4000),
    review: textOrEmpty(raw['review'], 4000),
    setup:
      typeof raw['setup'] === 'string' && raw['setup'] !== '' ? raw['setup'].slice(0, 60) : null,
    tags: textList(raw['tags']) ?? [],
    mistakes: textList(raw['mistakes']) ?? [],
    rating: RATINGS.has(raw['rating'] as number) ? (raw['rating'] as JournalEntry['rating']) : null,
    plan: sanitizePlan(raw['plan']),
  };
}

const DIRECTIONS = new Set(['long', 'short']);
const QUOTES = new Set(['USD', 'EUR']);

function sanitizeManualTrade(id: string, raw: unknown): ManualTrade | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['symbol'] !== 'string' || raw['symbol'].trim() === '') return null;
  if (typeof raw['direction'] !== 'string' || !DIRECTIONS.has(raw['direction'])) return null;
  if (typeof raw['accountId'] !== 'string' || !ACCOUNT_ID.test(raw['accountId'])) return null;
  if (typeof raw['openedAt'] !== 'string' || !NAIVE.test(raw['openedAt'])) return null;
  if (!isDecimal(raw['qty']) || !isDecimal(raw['entryPrice'])) return null;
  const closedAt =
    typeof raw['closedAt'] === 'string' && NAIVE.test(raw['closedAt']) ? raw['closedAt'] : null;
  return {
    id,
    accountId: raw['accountId'],
    symbol: raw['symbol'].trim().slice(0, 20),
    direction: raw['direction'] as ManualTrade['direction'],
    qty: raw['qty'],
    entryPrice: raw['entryPrice'],
    exitPrice: decOrNull(raw['exitPrice']),
    openedAt: raw['openedAt'],
    closedAt,
    fees: decOrNull(raw['fees']) ?? '0',
    quote: QUOTES.has(raw['quote'] as string) ? (raw['quote'] as ManualTrade['quote']) : 'USD',
  };
}
// --- Alertes de prix (P29) --------------------------------------------------------------------

const ALERT_DIRECTIONS = new Set(['below', 'above']);
const ALERT_REPEATS = new Set(['once', 'recurring']);
const ALERT_ID = /^[A-Za-z0-9:._-]{1,80}$/;
/** Pourcentage d'écart raisonnable (magnitude) : au-delà, la saisie est manifestement corrompue. */
const isPct = (v: unknown): v is string => isDecimal(v) && !v.startsWith('-');

function sanitizeAlertFee(raw: unknown): { pctFee: string; fixedEur: string } | null {
  if (!isRecord(raw)) return null;
  if (!isPct(raw['pctFee']) || !isPct(raw['fixedEur'])) return null;
  return { pctFee: raw['pctFee'], fixedEur: raw['fixedEur'] };
}

function sanitizeAlertThreshold(raw: unknown): AlertRule['threshold'] | null {
  if (!isRecord(raw)) return null;
  if (raw['kind'] === 'price' && isDecimal(raw['priceEur']) && !raw['priceEur'].startsWith('-'))
    return { kind: 'price', priceEur: raw['priceEur'] };
  if (raw['kind'] === 'price-usd' && isDecimal(raw['priceUsd']) && !raw['priceUsd'].startsWith('-'))
    return { kind: 'price-usd', priceUsd: raw['priceUsd'] };
  if (raw['kind'] === 'pru-pct' && isPct(raw['percent']))
    return { kind: 'pru-pct', percent: raw['percent'] };
  if (raw['kind'] === 'pru-net-pct' && isPct(raw['percent'])) {
    const fee = sanitizeAlertFee(raw['fee']);
    if (fee) return { kind: 'pru-net-pct', percent: raw['percent'], fee };
  }
  return null;
}

function sanitizeAlertRule(id: string, raw: unknown): AlertRule | null {
  if (!isRecord(raw) || !ALERT_ID.test(id)) return null;
  if (typeof raw['asset'] !== 'string' || raw['asset'] === '' || raw['asset'].length > 30)
    return null;
  if (typeof raw['direction'] !== 'string' || !ALERT_DIRECTIONS.has(raw['direction'])) return null;
  if (typeof raw['repeat'] !== 'string' || !ALERT_REPEATS.has(raw['repeat'])) return null;
  const threshold = sanitizeAlertThreshold(raw['threshold']);
  if (!threshold) return null;
  const gate = sanitizeAlertGate(raw['gate']);
  return {
    id,
    asset: raw['asset'],
    direction: raw['direction'] as AlertRule['direction'],
    threshold,
    repeat: raw['repeat'] as AlertRule['repeat'],
    enabled: raw['enabled'] !== false,
    note: textOrEmpty(raw['note'], 200),
    createdAt: typeof raw['createdAt'] === 'string' ? raw['createdAt'] : '',
    // Champs de la version 2.8.0 : ÉMIS SEULEMENT s'ils portent une valeur, pour qu'une règle
    // ordinaire garde exactement la forme qu'elle avait dans les sauvegardes existantes.
    // Une date illisible vaut « sans limite » : jamais une règle muette par accident.
    ...(typeof raw['expiresAt'] === 'string' && Number.isFinite(Date.parse(raw['expiresAt']))
      ? { expiresAt: raw['expiresAt'] }
      : {}),
    ...(gate === null ? {} : { gate }),
  };
}

/** Condition composée : rejetée en bloc au moindre doute (une règle sans condition se déclenche). */
function sanitizeAlertGate(raw: unknown): AlertGate | null {
  if (!isRecord(raw) || raw['kind'] !== 'fear-greed') return null;
  if (typeof raw['direction'] !== 'string' || !ALERT_DIRECTIONS.has(raw['direction'])) return null;
  const value = Number(raw['value']);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return { kind: 'fear-greed', direction: raw['direction'] as AlertGate['direction'], value };
}

function sanitizeAlertRuleState(raw: unknown): AlertRuleState | null {
  if (!isRecord(raw)) return null;
  const last = raw['lastTriggeredAtMs'];
  if (last !== null && last !== undefined && (typeof last !== 'number' || !Number.isFinite(last)))
    return null;
  return {
    armed: raw['armed'] === true,
    lastTriggeredAtMs: typeof last === 'number' ? last : null,
    triggerCount:
      typeof raw['triggerCount'] === 'number' && Number.isFinite(raw['triggerCount'])
        ? Math.max(0, Math.floor(raw['triggerCount']))
        : 0,
  };
}

function sanitizeAlertEvent(raw: unknown): AlertEvent | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['id'] !== 'string' || !ALERT_ID.test(raw['id'])) return null;
  if (typeof raw['ruleId'] !== 'string' || !ALERT_ID.test(raw['ruleId'])) return null;
  if (typeof raw['asset'] !== 'string' || raw['asset'] === '' || raw['asset'].length > 30)
    return null;
  if (typeof raw['direction'] !== 'string' || !ALERT_DIRECTIONS.has(raw['direction'])) return null;
  if (!isDecimal(raw['thresholdEur']) || !isDecimal(raw['priceEur'])) return null;
  if (!isDecimalOrNull(raw['pruEur'])) return null;
  if (typeof raw['at'] !== 'string') return null;
  return {
    id: raw['id'],
    ruleId: raw['ruleId'],
    asset: raw['asset'],
    direction: raw['direction'] as AlertEvent['direction'],
    thresholdEur: raw['thresholdEur'],
    priceEur: raw['priceEur'],
    pruEur: decOrNull(raw['pruEur']),
    at: raw['at'],
    read: raw['read'] === true,
  };
}

const ACCOUNT_KINDS = new Set(['coinhouse', 'manual', 'hyperliquid', 'csv', 'onchain']);
const ONCHAIN_CHAINS = new Set(['btc', 'eth', 'arbitrum', 'base']);
const ACCOUNT_SPACES = new Set(['invest', 'trading']);
/** ISO 3166-1 alpha-2 : deux lettres majuscules, rien d'autre (P66, `Account.country`). */
const COUNTRY_CODE = /^[A-Z]{2}$/;

function sanitizeAccount(id: string, raw: unknown): Account | null {
  if (!isRecord(raw) || !ACCOUNT_ID.test(id)) return null;
  const a = raw;
  if (typeof a['kind'] !== 'string' || !ACCOUNT_KINDS.has(a['kind'])) return null;
  if (typeof a['space'] !== 'string' || !ACCOUNT_SPACES.has(a['space'])) return null;
  if (typeof a['label'] !== 'string' || a['label'].trim() === '') return null;
  const account: Account = {
    id,
    kind: a['kind'] as Account['kind'],
    label: a['label'].trim().slice(0, 60),
    space: a['space'] as Account['space'],
    createdAt: typeof a['createdAt'] === 'string' ? a['createdAt'] : '',
  };
  if (a['spotAsInvestment'] === true) account.spotAsInvestment = true;
  if (typeof a['address'] === 'string' && a['address'].length <= 120)
    account.address = a['address'];
  if (typeof a['chain'] === 'string' && ONCHAIN_CHAINS.has(a['chain']))
    account.chain = a['chain'] as 'btc' | 'eth' | 'arbitrum' | 'base';
  // Absent sur toute sauvegarde écrite avant P66 : reste `undefined`, le compte redevient `unknown`
  // au premier calcul de déclaration — jamais une perte de compte, jamais un pays inventé.
  if (typeof a['country'] === 'string' && COUNTRY_CODE.test(a['country']))
    account.country = a['country'];
  return account;
}

function validQualification(raw: unknown): raw is Qualification {
  if (!isRecord(raw) || typeof raw['kind'] !== 'string' || !QUALIFICATION_KINDS.has(raw['kind']))
    return false;
  return ['fairValueEur', 'costEur', 'proceedsEur', 'valueEur'].every((c) =>
    isDecimalOrNull(raw[c]),
  );
}

const MAX_LIST = 40;
const MAX_TEXT = 120;
/** Clé d'API CoinGecko : jeton court sans espace ; tout le reste est écarté. */
const API_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const sanitizeApiKey = (v: unknown): string | null =>
  typeof v === 'string' && API_KEY.test(v.trim()) ? v.trim() : null;
const textList = (v: unknown): string[] | null =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string')
        .slice(0, MAX_LIST)
        .map((s) => s.slice(0, MAX_TEXT))
    : null;

function sanitizeImport(raw: unknown): ImportBatchMeta | null {
  if (!isRecord(raw)) return null;
  const { id, at, fileName } = raw;
  if (typeof id !== 'string' || typeof at !== 'string' || typeof fileName !== 'string') return null;
  if (typeof raw['rows'] !== 'number' || typeof raw['newRows'] !== 'number') return null;
  const meta: ImportBatchMeta = {
    id,
    at,
    fileName: fileName.slice(0, 200),
    rows: raw['rows'],
    newRows: raw['newRows'],
  };
  if (typeof raw['format'] === 'string') meta.format = raw['format'].slice(0, 60);
  if (typeof raw['accountId'] === 'string' && ACCOUNT_ID.test(raw['accountId']))
    meta.accountId = raw['accountId'];
  const header = textList(raw['header']);
  if (header) meta.header = header;
  const unknownColumns = textList(raw['unknownColumns']);
  if (unknownColumns) meta.unknownColumns = unknownColumns;
  return meta;
}

/** Écarte les entrées invalides plutôt que de laisser le moteur planter ; renvoie le nombre écarté. */
export function sanitizeState(input: StoredStateV1): { state: StoredStateV1; dropped: number } {
  let state = input;
  let dropped = 0;
  const imports: ImportBatchMeta[] = [];
  for (const raw of state.imports) {
    const meta = sanitizeImport(raw);
    if (meta) imports.push(meta);
    else dropped++;
  }
  const rawRows: Record<RowKey, RawCoinhouseRow> = {};
  for (const [key, raw] of Object.entries(state.rawRows)) {
    const row = sanitizeRow(key, raw);
    if (row) rawRows[key] = row;
    else dropped++;
  }
  const pivotRows: Record<RowKey, RawPivotRow> = {};
  for (const [key, raw] of Object.entries(state.pivotRows)) {
    const row = sanitizePivotRow(key, raw);
    if (row) pivotRows[key] = row;
    else dropped++;
  }
  const manualEvents: Record<string, ManualEvent> = {};
  for (const [id, raw] of Object.entries(state.manualEvents)) {
    const event = sanitizeManual(id, raw);
    if (event) manualEvents[id] = event;
    else dropped++;
  }
  const qualifications: Record<EventId, Qualification> = {};
  for (const [id, raw] of Object.entries(state.qualifications)) {
    if (validQualification(raw)) qualifications[id] = raw;
    else dropped++;
  }
  const transferOverrides: Record<EventId, TransferOverride> = {};
  for (const [id, raw] of Object.entries(state.transferOverrides)) {
    if (EVENT_ID.test(id) && (raw === 'none' || (typeof raw === 'string' && EVENT_ID.test(raw))))
      transferOverrides[id] = raw;
    else dropped++;
  }
  const priceCache: Record<AssetCode, PriceQuoteInput> = {};
  for (const [asset, raw] of Object.entries(state.priceCache)) {
    if (isRecord(raw) && isDecimal(raw['priceEur']) && typeof raw['at'] === 'string') {
      priceCache[asset] = {
        asset,
        priceEur: raw['priceEur'],
        at: raw['at'],
        source: typeof raw['source'] === 'string' ? raw['source'] : 'cache',
        stale: true,
      };
    } else dropped++;
  }
  const assetSettings: Record<AssetCode, AssetSettings> = {};
  for (const [asset, raw] of Object.entries(state.assetSettings)) {
    if (!isRecord(raw)) {
      dropped++;
      continue;
    }
    assetSettings[asset] = {
      manualPriceEur: decOrNull(raw['manualPriceEur']),
      manualPriceAt: typeof raw['manualPriceAt'] === 'string' ? raw['manualPriceAt'] : null,
      coingeckoId: typeof raw['coingeckoId'] === 'string' ? raw['coingeckoId'] : null,
    };
  }
  const accounts: Record<AccountId, Account> = {};
  for (const [id, raw] of Object.entries(state.accounts)) {
    const account = sanitizeAccount(id, raw);
    if (account) accounts[id] = account;
    else dropped++;
  }
  const hl = sanitizeHlState(state.hyperliquid);
  dropped += hl.dropped;
  const journal: Record<string, JournalEntry> = {};
  for (const [tradeId, raw] of Object.entries(state.journal)) {
    const entry = sanitizeJournalEntry(tradeId, raw);
    if (entry) journal[tradeId] = entry;
    else dropped++;
  }
  const manualTrades: Record<string, ManualTrade> = {};
  for (const [id, raw] of Object.entries(state.manualTrades)) {
    const trade = sanitizeManualTrade(id, raw);
    if (trade) manualTrades[id] = trade;
    else dropped++;
  }
  const taxAnnotations: Record<EventId, { portfolioValueEur: DecimalString | null }> = {};
  for (const [id, raw] of Object.entries(state.taxAnnotations)) {
    if (isRecord(raw) && isDecimalOrNull(raw['portfolioValueEur']))
      taxAnnotations[id] = { portfolioValueEur: decOrNull(raw['portfolioValueEur']) };
    else dropped++;
  }
  // Alertes de prix : règles et journal assainis champ par champ ; les états orphelins (règle
  // disparue) sont écartés sans bruit — ils ne sont pas des données de l'utilisateur.
  const alertRules: Record<string, AlertRule> = {};
  for (const [id, raw] of Object.entries(state.alerts.rules)) {
    const rule = sanitizeAlertRule(id, raw);
    if (rule) alertRules[id] = rule;
    else dropped++;
  }
  const alertStates: Record<string, AlertRuleState> = {};
  for (const [id, raw] of Object.entries(state.alerts.states)) {
    if (!(id in alertRules)) continue;
    const ruleState = sanitizeAlertRuleState(raw);
    if (ruleState) alertStates[id] = ruleState;
    else dropped++;
  }
  const alertEvents: AlertEvent[] = [];
  for (const raw of Array.isArray(state.alerts.events) ? state.alerts.events : []) {
    const event = sanitizeAlertEvent(raw);
    if (event) alertEvents.push(event);
    else dropped++;
  }
  alertEvents.sort((a, b) => b.at.localeCompare(a.at));
  const rawWatchMinutes = state.alerts.settings.watchMinutes;
  const alerts: AlertsState = {
    rules: alertRules,
    states: alertStates,
    events: alertEvents.slice(0, MAX_ALERT_EVENTS),
    settings: {
      watch: state.alerts.settings.watch === true,
      watchMinutes:
        typeof rawWatchMinutes === 'number' && Number.isFinite(rawWatchMinutes)
          ? Math.min(60, Math.max(1, Math.round(rawWatchMinutes)))
          : DEFAULT_ALERTS_SETTINGS.watchMinutes,
      systemNotifications: state.alerts.settings.systemNotifications === true,
    },
  };
  // Réglages du moteur : unions de chaînes et booléens, jamais assainis jusqu'ici alors que tous
  // leurs voisins l'étaient. `includeSubscriptionsInPnl` est lu en truthy par `aggregate.ts` — une
  // sauvegarde éditée à la main portant la CHAÎNE "false" aurait retranché les abonnements du P&L
  // pendant que l'interrupteur affichait « non ». Une valeur inconnue retombe sur le défaut.
  const engineSettings: EngineSettings = {
    migrationMode:
      state.engineSettings.migrationMode === 'realize'
        ? 'realize'
        : DEFAULT_ENGINE_SETTINGS.migrationMode,
    rewardValuation:
      state.engineSettings.rewardValuation === 'fair-value'
        ? 'fair-value'
        : DEFAULT_ENGINE_SETTINGS.rewardValuation,
    includeSubscriptionsInPnl: state.engineSettings.includeSubscriptionsInPnl === true,
  };

  const fxRates: FxCache['rates'] = {};
  for (const [currency, raw] of Object.entries(state.fx.rates)) {
    if (!isRecord(raw)) continue;
    const series: Record<string, string> = {};
    for (const [day, rate] of Object.entries(raw))
      if (isDecimal(rate) && /^\d{4}-\d{2}-\d{2}$/.test(day)) series[day] = rate;
    fxRates[currency as Currency] = series;
  }
  const fx: FxCache = {
    ...state.fx,
    rates: fxRates,
    updatedAt: isRecord(state.fx.updatedAt) ? state.fx.updatedAt : {},
  };
  if (!['EUR', 'USD'].includes(state.ui.displayCurrency))
    state = { ...state, ui: { ...state.ui, displayCurrency: 'EUR' } };
  if (!METRICS.includes(state.ui.chartMetric))
    state = { ...state, ui: { ...state.ui, chartMetric: 'value' } };
  if (!METRICS.includes(state.ui.assetChartMetric))
    state = { ...state, ui: { ...state.ui, assetChartMetric: 'pru' } };
  if (typeof state.ui.liveMids !== 'boolean')
    state = { ...state, ui: { ...state.ui, liveMids: false } };
  if (typeof state.ui.marketContext !== 'boolean')
    state = { ...state, ui: { ...state.ui, marketContext: false } };
  if (typeof state.ui.liveFills !== 'boolean')
    state = { ...state, ui: { ...state.ui, liveFills: false } };
  if (typeof state.ui.demoMode !== 'boolean')
    state = { ...state, ui: { ...state.ui, demoMode: false } };
  if (state.ui.lastSeenVersion !== null && typeof state.ui.lastSeenVersion !== 'string')
    state = { ...state, ui: { ...state.ui, lastSeenVersion: null } };
  state = {
    ...state,
    ui: {
      ...state.ui,
      coingeckoDemoKey: sanitizeApiKey(state.ui.coingeckoDemoKey),
      explorerKey: sanitizeApiKey(state.ui.explorerKey),
      explorerFlavor: KEYED_FLAVORS.includes(state.ui.explorerFlavor)
        ? state.ui.explorerFlavor
        : 'etherscan',
    },
  };
  return {
    state: {
      ...state,
      imports,
      rawRows,
      pivotRows,
      manualEvents,
      qualifications,
      transferOverrides,
      taxAnnotations,
      priceCache,
      assetSettings,
      accounts,
      hyperliquid: hl.state,
      journal,
      manualTrades,
      engineSettings,
      fx,
      alerts,
    },
    dropped,
  };
}
