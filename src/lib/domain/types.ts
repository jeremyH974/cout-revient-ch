/**
 * Types du domaine : lignes brutes importées, événements normalisés du grand livre,
 * saisies manuelles, qualifications et réglages du moteur.
 *
 * Source de vérité persistée = lignes brutes + événements manuels + qualifications + réglages.
 * Tout le reste (événements normalisés, lots, rapports) est recalculé à chaque chargement.
 */
import type { DecimalString } from './money';

export type { DecimalString };

/** Ticker en minuscules tel qu'exporté par Coinhouse : 'btc', 'usdc', 'eur'… */
export type AssetCode = string;

/** Horodatage naïf `YYYY-MM-DDTHH:mm:ss` (heure locale de l'export, jamais convertie). */
export type NaiveDateTime = string;

/** Clé stable d'une ligne importée : `ch:<id>:<devise>` ou `ch:h:<hash>` sans ID. */
export type RowKey = string;

/** Identifiant stable d'un événement : `ch:<id>`, `ch:mig:<id1>+<id2>`, `man:<uuid>`… */
export type EventId = string;

/** Ligne de l'export Coinhouse, conservée telle quelle (chaînes), jamais réinterprétée. */
export interface RawCoinhouseRow {
  key: RowKey;
  importId: string;
  lineNo: number;
  /** `ID Coinhouse` (null pour les lignes sans ID, ex. Abonnement). */
  id: string | null;
  at: NaiveDateTime;
  /** Libellé brut : 'Echange', 'Abonnement', 'Migration', 'Echange Delisting'… */
  type: string;
  /** Quantité signée (négatif = sortie). */
  qty: DecimalString;
  asset: AssetCode;
  /** `Prix du marché`, exprimé dans la devise de contrepartie de l'opération. */
  marketPrice: DecimalString | null;
  /** `Contre-valeur (EUR)` signée : fiable uniquement sur la jambe contrepartie (eur/usdc). */
  valueEur: DecimalString | null;
  feeAsset: DecimalString | null;
  feeEur: DecimalString | null;
  feeRebate: DecimalString | null;
  /** `Solde` de l'actif après l'opération (null pour eur). */
  balance: DecimalString | null;
  account: string;
  /** Colonnes inconnues conservées pour ne rien perdre si l'export évolue. */
  extra: Record<string, string>;
}

/** Une jambe d'opération : quantité strictement positive, le sens est donné par `out`/`in`. */
export interface Leg {
  asset: AssetCode;
  qty: DecimalString;
}

export type EventSource = 'coinhouse-csv' | 'manual' | 'hyperliquid-api';

/** `coinhouse` : participe au contrôle de solde ; `external` : hors plateforme, exclu. */
export type EventScope = 'coinhouse' | 'external';

/** Identifiant d'un compte (plateforme ou saisie) : `ch:main`, `man:default`, `man:<uuid>`, `hl:<adresse>`… */
export type AccountId = string;
export type AccountKind = 'coinhouse' | 'manual' | 'hyperliquid' | 'csv';
/** Espace d'appartenance d'un compte (proposition v2, § 6.0). */
export type AccountSpace = 'invest' | 'trading';

/**
 * Compte de première classe : tout événement en porte un. Le PRU existe par compte (vue « par
 * plateforme ») et consolidé (grand livre entier) ; le contrôle de solde Coinhouse reste piloté par
 * `EventScope`.
 */
export interface Account {
  id: AccountId;
  kind: AccountKind;
  label: string;
  space: AccountSpace;
  /** Trading seulement : router les achats spot « à garder » vers l'espace Investissement. */
  spotAsInvestment?: boolean;
  /** Adresse publique (Hyperliquid, on-chain) ; jamais une clé. */
  address?: string;
  /** ISO 8601. */
  createdAt: string;
}

/** Compte implicite des lignes de l'export Coinhouse. */
export const COINHOUSE_ACCOUNT_ID: AccountId = 'ch:main';
/** Compte implicite des saisies manuelles « hors Coinhouse » antérieures aux comptes. */
export const MANUAL_ACCOUNT_ID: AccountId = 'man:default';
/** Compte implicite des trades saisis à la main (espace Trading, plateformes sans API). */
export const MANUAL_TRADING_ACCOUNT_ID: AccountId = 'man:trading';

export interface EventBase {
  id: EventId;
  at: NaiveDateTime;
  source: EventSource;
  scope: EventScope;
  accountId: AccountId;
  rowKeys: RowKey[];
  warnings: string[];
}

export interface TradeFee {
  asset: AssetCode;
  gross: DecimalString;
  rebate: DecimalString;
  grossEur: DecimalString;
  rebateEur: DecimalString;
}

/** Prix d'exécution unitaire de la jambe actif, dans sa devise de cotation (affichage). */
export interface QuotePrice {
  asset: AssetCode;
  price: DecimalString;
}

export type ValueEurSource = 'counter-leg' | 'manual' | 'carry-cost';

export interface TradeEvent extends EventBase {
  kind: 'trade';
  out: Leg;
  in: Leg;
  /** Valeur EUR all-in de l'opération (coût si achat, produit net si vente). */
  valueEur: DecimalString;
  valueEurSource: ValueEurSource;
  fee: TradeFee | null;
  quotePrice: QuotePrice | null;
}

export interface MigrationEvent extends EventBase {
  kind: 'migration';
  out: Leg;
  in: Leg;
  fairValueOutEur: DecimalString | null;
  fairValueInEur: DecimalString | null;
}

/** Frais hors opération (abonnement Coinhouse…). */
export interface FeeEvent extends EventBase {
  kind: 'fee';
  amountEur: DecimalString;
  label: string;
}

/** Récompense (staking, airdrop) : entrée sans contrepartie. */
export interface RewardEvent extends EventBase {
  kind: 'reward';
  in: Leg;
  fairValueEur: DecimalString | null;
}

/** Dépôt on-chain : entrée dont le coût d'acquisition est à renseigner. */
export interface DepositEvent extends EventBase {
  kind: 'deposit';
  in: Leg;
  costEur: DecimalString | null;
}

/** Retrait on-chain : sortie sans produit (ou réalisée à une valeur donnée). */
export interface WithdrawalEvent extends EventBase {
  kind: 'withdrawal';
  out: Leg;
  proceedsEur: DecimalString | null;
}

/** Solde d'ouverture : historique manquant avant le début de l'export. */
export interface OpeningBalanceEvent extends EventBase {
  kind: 'opening-balance';
  in: Leg;
  costEur: DecimalString;
}

export interface UnqualifiedLeg {
  asset: AssetCode;
  signedQty: DecimalString;
  valueEur: DecimalString | null;
}

/** Ligne(s) non interprétables automatiquement : à qualifier par l'utilisateur. */
export interface UnqualifiedEvent extends EventBase {
  kind: 'unqualified';
  rawType: string;
  legs: UnqualifiedLeg[];
  reason: string;
}

export type LedgerEvent =
  | TradeEvent
  | MigrationEvent
  | FeeEvent
  | RewardEvent
  | DepositEvent
  | WithdrawalEvent
  | OpeningBalanceEvent
  | UnqualifiedEvent;

export type LedgerEventKind = LedgerEvent['kind'];

/** Saisie manuelle d'une opération (un seul format pour toutes les variantes). */
export interface ManualEvent {
  id: string;
  at: NaiveDateTime;
  kind: 'buy' | 'sell' | 'reward' | 'deposit' | 'withdrawal' | 'opening-balance';
  asset: AssetCode;
  /** Quantité strictement positive. */
  qty: DecimalString;
  /**
   * buy/sell : total EUR réellement débité/crédité, frais inclus ;
   * reward : juste valeur à la réception (optionnelle) ; deposit / opening-balance : coût ;
   * withdrawal : produit de réalisation (optionnel).
   */
  amountEur: DecimalString | null;
  scope: EventScope;
  /** Compte de rattachement ; absent (saisies v1) = déduit de `scope`. */
  accountId?: AccountId;
  note: string;
}

/** Réinterprétation d'un événement `unqualified`, sans toucher aux lignes brutes. */
export type Qualification =
  | { kind: 'ignore' }
  | { kind: 'reward'; fairValueEur: DecimalString | null }
  | { kind: 'deposit'; costEur: DecimalString | null }
  | { kind: 'withdrawal'; proceedsEur: DecimalString | null }
  | { kind: 'purchase'; costEur: DecimalString }
  | { kind: 'sale'; proceedsEur: DecimalString }
  | { kind: 'trade'; valueEur: DecimalString };

export interface EngineSettings {
  /** Delisting + migration : report du coût (défaut) ou réalisation à la juste valeur. */
  migrationMode: 'carry-cost' | 'realize';
  /** Coût d'acquisition des récompenses : 0 € (défaut) ou valeur de marché à la réception. */
  rewardValuation: 'zero' | 'fair-value';
  /** Inclure les abonnements Coinhouse dans le P&L global (défaut : non, listés à part). */
  includeSubscriptionsInPnl: boolean;
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  migrationMode: 'carry-cost',
  rewardValuation: 'zero',
  includeSubscriptionsInPnl: false,
};
