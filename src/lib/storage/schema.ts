/** État persisté (localStorage + sauvegarde JSON), versionné. */
import type { PriceQuoteInput } from '../domain/engine/report';
import { EMPTY_FX_CACHE, type Currency, type FxCache } from '../fx/types';
import { METRICS, type Metric } from '../history/metrics';
import {
  DEFAULT_ENGINE_SETTINGS,
  type AssetCode,
  type DecimalString,
  type EngineSettings,
  type EventId,
  type ManualEvent,
  type Qualification,
  type RawCoinhouseRow,
  type RowKey,
} from '../domain/types';

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
}

export interface StoredStateV1 {
  schemaVersion: typeof SCHEMA_VERSION;
  imports: ImportBatchMeta[];
  rawRows: Record<RowKey, RawCoinhouseRow>;
  manualEvents: Record<string, ManualEvent>;
  qualifications: Record<EventId, Qualification>;
  /** Réservé au futur mode fiscal (valeur globale du portefeuille au jour de chaque cession). */
  taxAnnotations: Record<EventId, { portfolioValueEur: DecimalString | null }>;
  assetSettings: Record<AssetCode, AssetSettings>;
  engineSettings: EngineSettings;
  priceCache: Record<AssetCode, PriceQuoteInput>;
  /** Taux de change BCE mis en cache (EUR → devises d'affichage). */
  fx: FxCache;
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
};

export function emptyState(): StoredStateV1 {
  return {
    schemaVersion: SCHEMA_VERSION,
    imports: [],
    rawRows: {},
    manualEvents: {},
    qualifications: {},
    taxAnnotations: {},
    assetSettings: {},
    engineSettings: { ...DEFAULT_ENGINE_SETTINGS },
    priceCache: {},
    fx: { ...EMPTY_FX_CACHE, rates: {}, updatedAt: {} },
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
    taxAnnotations: isRecord(state.taxAnnotations) ? state.taxAnnotations : {},
    assetSettings: isRecord(state.assetSettings) ? state.assetSettings : {},
    priceCache: isRecord(state.priceCache) ? state.priceCache : {},
    fx: isRecord(state.fx) ? { ...empty.fx, ...state.fx } : empty.fx,
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
    note: typeof m['note'] === 'string' ? m['note'] : '',
  };
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
  return {
    state: {
      ...state,
      imports,
      rawRows,
      manualEvents,
      qualifications,
      priceCache,
      assetSettings,
      fx,
    },
    dropped,
  };
}
