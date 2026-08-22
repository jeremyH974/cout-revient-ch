/** État persisté (localStorage + sauvegarde JSON), versionné. */
import type { PriceQuoteInput } from '../domain/engine/report';
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
  ui: UiSettings;
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  theme: 'auto',
  discreet: false,
  hideClosed: false,
  priceSource: 'auto',
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
  };
}
