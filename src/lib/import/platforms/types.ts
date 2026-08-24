/**
 * Convertisseurs natifs : un module pur par plateforme qui traduit son export vers des brouillons
 * de lignes pivot. Tout l'aval (valorisation, à-qualifier, virements appariés, moteur) est celui
 * du pipeline pivot. La clé d'une ligne est le hachage du CONTENU NATIF (décision n° 26) : une
 * correction de convertisseur ne crée jamais de doublon au ré-import.
 */
import type { PivotAmount } from '../../domain/types';
import type { CsvTable } from '../csv';
import type { PivotIssue } from '../pivot/rows';

export type PlatformFormatId =
  | 'kraken-ledgers'
  | 'revolut-crypto'
  | 'coinbase'
  | 'bitvavo'
  | 'ledger-live'
  | 'binance'
  | 'bitpanda'
  | 'swissborg';

export interface PlatformDraft {
  /** Ligne du fichier d'origine (la première, pour une opération multi-lignes). */
  lineNo: number;
  /** Contenu natif stable de la ou des lignes source : base du hachage de la clé. */
  nativeContent: string;
  /** Instant UTC en millisecondes (fuseau de la source déjà appliqué par le convertisseur). */
  timeMs: number;
  /** Montants POSITIFS ; les codes d'actifs déjà traduits (XXBT → btc…). */
  sent: PivotAmount | null;
  received: PivotAmount | null;
  fee: PivotAmount | null;
  netWorth: PivotAmount | null;
  /** Étiquette pivot (`staking`, `reward`, `airdrop`, `cost`, `gift`…), en minuscules. */
  label: string | null;
  description: string | null;
  txHash: string | null;
}

export interface PlatformConversion {
  drafts: PlatformDraft[];
  /** Lignes illisibles ou non gérées : montrées à l'utilisateur, jamais tues. */
  issues: PivotIssue[];
  /** Mouvements internes à la plateforme (staking↔spot…), volontairement hors modèle. */
  skippedInternal: number;
}

export interface PlatformConverter {
  id: PlatformFormatId;
  /** Libellé affiché (« Kraken — ledgers.csv »…). */
  label: string;
  detect(header: readonly string[]): boolean;
  convert(table: CsvTable): PlatformConversion;
}

/** Normalisation d'en-tête partagée par les détections. */
export const canonHeader = (h: string): string => h.trim().toLowerCase().replace(/\s+/g, ' ');
