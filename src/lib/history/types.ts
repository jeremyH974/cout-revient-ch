/**
 * Types de la couche « historique des prix » : séries quotidiennes en EUR par actif, fournisseurs
 * et contrat du cache. Aucune dépendance Svelte/DOM ; les prix restent des chaînes décimales.
 */
import type { AssetCode, DecimalString } from '../domain/types';

/** Jour calendaire UTC `YYYY-MM-DD`. */
export type DayString = string;

/** Horodatage ISO 8601 UTC (`Date#toISOString()`). */
export type IsoDateTime = string;

/** Prix de clôture (ou dernier point connu) d'un jour, en EUR. */
export interface DailyPoint {
  day: DayString;
  priceEur: DecimalString;
  /** Vrai si le point est un report de la dernière valeur connue (jour sans cotation). */
  filled?: boolean;
}

/** Point infra-journalier (période 1J). */
export interface IntradayPoint {
  at: IsoDateTime;
  priceEur: DecimalString;
}

/** Historique quotidien d'un actif, un point par jour entre `from` et `to` (trous comblés). */
export interface PriceHistory {
  asset: AssetCode;
  points: DailyPoint[];
  /** Fournisseur(s) ayant contribué, ex. `Coinbase` ou `Kraken+CoinGecko`. */
  source: string;
  fetchedAt: IsoDateTime;
  from: DayString;
  to: DayString;
  /**
   * Jour le plus ancien déjà demandé aux fournisseurs sans erreur : en deçà de `from`, on sait
   * qu'aucune donnée n'existe (évite de re-sonder la tête à chaque chargement).
   */
  probedFrom?: DayString;
}

/** Fournisseur d'historique sans clé, utilisable depuis le navigateur (CORS). */
export interface HistoryProvider {
  name: string;
  /** Profondeur maximale en jours avant aujourd'hui (`null` = illimitée). */
  maxDays: number | null;
  /** Vrai si l'actif est coté chez ce fournisseur (évite des requêtes inutiles). */
  supports?(asset: AssetCode, signal: AbortSignal): Promise<boolean>;
  /**
   * Points quotidiens dans `[fromDay, toDay]`, triés, au plus un par jour. Peut être partiel
   * (actif coté plus tard, profondeur limitée) ou vide (actif inconnu). Lève en cas d'erreur
   * réseau / HTTP.
   */
  fetchDaily(
    asset: AssetCode,
    fromDay: DayString,
    toDay: DayString,
    signal: AbortSignal,
  ): Promise<DailyPoint[]>;
  /** Points des `hours` dernières heures, triés par `at` croissant. */
  fetchIntraday?(asset: AssetCode, hours: number, signal: AbortSignal): Promise<IntradayPoint[]>;
}

/** Cache persistant des historiques quotidiens (IndexedDB en production, mémoire en test). */
export interface HistoryStore {
  getDaily(asset: AssetCode): Promise<PriceHistory | null>;
  putDaily(history: PriceHistory): Promise<void>;
  getMeta(key: string): Promise<unknown>;
  putMeta(key: string, value: unknown): Promise<void>;
  /** Vide intégralement le cache (historiques et métadonnées). */
  clear(): Promise<void>;
}

/** Signature minimale de `fetch`, injectable pour les tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
