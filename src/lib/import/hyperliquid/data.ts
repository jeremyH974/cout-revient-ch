/**
 * Données Hyperliquid persistées (conteneur `hyperliquid` de l'état, DECISIONS n° 22) : bruts par
 * compte (fills, funding, grand livre), instantané du compte, curseurs de synchronisation, et la
 * table des paires spot (pour lire `@107` hors ligne). L'API ne conserve que les fills récents :
 * l'application est la mémoire longue, d'où la persistance des bruts plutôt que d'un dérivé.
 */
import { fnv1a32 } from '../../domain/hash';
import type { AccountId } from '../../domain/types';
import type {
  HlClearinghouse,
  HlFill,
  HlFunding,
  HlLedgerUpdate,
  HlPortfolio,
  HlSpotBalance,
} from './api-types';

export interface HlCursors {
  /** `time` (ms) du dernier élément reçu par flux ; `null` = jamais synchronisé. */
  fills: number | null;
  funding: number | null;
  ledger: number | null;
}

export interface HlSnapshot {
  /** ISO 8601 de la lecture. */
  at: string;
  perps: HlClearinghouse;
  spot: HlSpotBalance[];
}

export interface HlAccountData {
  /** Adresse publique normalisée en minuscules. */
  address: string;
  /** Clé = `tid`. */
  fills: Record<string, HlFill>;
  /** Clé = `fundingKey`. */
  funding: Record<string, HlFunding>;
  /** Clé = `ledgerKey`. */
  ledger: Record<string, HlLedgerUpdate>;
  cursors: HlCursors;
  snapshot: HlSnapshot | null;
  /** Courbes `portfolio` de la plateforme (équité et P&L par période), lues à la synchronisation. */
  portfolio: HlPortfolio | null;
  /** ISO 8601 de la dernière synchronisation complète réussie. */
  lastSyncAt: string | null;
}

export interface HlSpotPairRef {
  base: string;
  quote: string;
}

export interface HlState {
  accounts: Record<AccountId, HlAccountData>;
  /** Nom de paire (`PURR/USDC`, `@107`) → jetons ; rempli à chaque synchronisation. */
  spotPairs: Record<string, HlSpotPairRef>;
}

export const hlAccountId = (address: string): AccountId => `hl:${address}`;

export function emptyHlAccountData(address: string): HlAccountData {
  return {
    address,
    fills: {},
    funding: {},
    ledger: {},
    cursors: { fills: null, funding: null, ledger: null },
    snapshot: null,
    portfolio: null,
    lastSyncAt: null,
  };
}

export const emptyHlState = (): HlState => ({ accounts: {}, spotPairs: {} });

export const fundingKey = (f: HlFunding): string => `${f.time}:${f.coin}:${f.hash}`;

/** Le même hash peut porter plusieurs mouvements (ex. transfert + frais) : empreinte du contenu. */
export const ledgerKey = (l: HlLedgerUpdate): string =>
  `${l.time}:${l.type}:${fnv1a32(`${l.hash}|${JSON.stringify(l.fields)}`)}`;

/** Identifiants numériques en chaîne : ordre numérique (longueur puis lexical), jamais `localeCompare`. */
export const compareIds = (a: string, b: string): number =>
  a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/** Fills triés par instant puis identifiant (ordre stable, même à la milliseconde). */
export function sortedFills(fills: Record<string, HlFill>): HlFill[] {
  return Object.values(fills).sort((a, b) => a.time - b.time || compareIds(a.tid, b.tid));
}

/** Compte Hyperliquid du mode démonstration (adresse fictive de `tests/fixtures/hyperliquid/demo.json`). */
export const DEMO_HL_ADDRESS = '0x000000000000000000000000000000000000d3a0';
export const DEMO_HL_ACCOUNT_ID: AccountId = hlAccountId(DEMO_HL_ADDRESS);
