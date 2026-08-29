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

/** Montant + devise d'une colonne du CSV pivot (ticker normalisé en minuscules). */
export interface PivotAmount {
  amount: DecimalString;
  currency: AssetCode;
}

/**
 * Ligne du CSV pivot (Koinly « Universal » Sent/Received ou export interne From/To), conservée
 * telle quelle après validation. Clé `pv:<hash de contenu>[#n]` : l'appartenance au compte est
 * portée par `accountId` (un même fichier ne va que dans un compte).
 */
export interface RawPivotRow {
  key: RowKey;
  importId: string;
  lineNo: number;
  accountId: AccountId;
  /** Date du fichier (UTC, verbatim). */
  date: string;
  /** Instant converti en heure de Paris (décision n° 21). */
  at: NaiveDateTime;
  sent: PivotAmount | null;
  received: PivotAmount | null;
  fee: PivotAmount | null;
  netWorth: PivotAmount | null;
  /** `Label` (Universal) ou `Tag` (export interne), en minuscules. */
  label: string | null;
  description: string | null;
  txHash: string | null;
}

/** Une jambe d'opération : quantité strictement positive, le sens est donné par `out`/`in`. */
export interface Leg {
  asset: AssetCode;
  qty: DecimalString;
}

export type EventSource = 'coinhouse-csv' | 'manual' | 'hyperliquid-api' | 'pivot-csv';

/** `coinhouse` : participe au contrôle de solde ; `external` : hors plateforme, exclu. */
export type EventScope = 'coinhouse' | 'external';

/** Identifiant d'un compte (plateforme ou saisie) : `ch:main`, `man:default`, `man:<uuid>`, `hl:<adresse>`… */
export type AccountId = string;
export type AccountKind = 'coinhouse' | 'manual' | 'hyperliquid' | 'csv' | 'onchain';

/** Chaîne suivie par un compte on-chain (adresse publique). */
export type OnchainChain = 'btc' | 'eth' | 'arbitrum' | 'base';
/** Espace d'appartenance d'un compte (proposition v2, § 6.0). */
export type AccountSpace = 'invest' | 'trading';

/** ISO 3166-1 alpha-2 (`'FR'`, `'NL'`…) : juridiction où l'ORGANISME est établi. */
export type CountryCode = string;

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
  /**
   * Juridiction de l'ORGANISME qui tient ce compte (ni celle de l'utilisateur, ni celle d'une
   * chaîne suivie) — décision fiscale 3916-bis (P66) : `'FR'` exclut du périmètre, un autre code
   * l'y inclut, `null`/absent reste `unknown` tant que l'utilisateur ne l'a pas renseigné. Jamais
   * deviné à partir du réseau on-chain ou de l'adresse.
   */
  country?: CountryCode | null;
  /** Trading seulement : router les achats spot « à garder » vers l'espace Investissement. */
  spotAsInvestment?: boolean;
  /** Adresse publique (Hyperliquid, on-chain) ; jamais une clé. */
  address?: string;
  /** Comptes on-chain : chaîne de l'adresse. */
  chain?: OnchainChain;
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
  /**
   * Ligne brute dont la `Contre-valeur (EUR)` a fourni `valueEur` — la « jambe contrepartie » de la
   * règle d'or (docs/DECISIONS.md n° 4). Enregistrée pour que la règle soit **auditable** :
   * la traçabilité (`engine/trace.ts`) montre la ligne retenue au lieu de la faire croire sur
   * parole. Absente pour les événements construits sans lignes brutes (saisies, API).
   */
  counterRowKey?: RowKey | null;
  /** Ligne brute de la jambe actif (prix d'exécution affiché), pendant de `counterRowKey`. */
  assetRowKey?: RowKey | null;
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
  /**
   * Retrait apparié (virement interne) : le coût de la cession au coût du retrait devient le
   * coût d'acquisition de ce dépôt. Jamais persisté : posé par `pairTransfers` à chaque calcul.
   */
  transferFrom?: EventId;
}

/** Retrait on-chain : sortie sans produit (ou réalisée à une valeur donnée). */
export interface WithdrawalEvent extends EventBase {
  kind: 'withdrawal';
  out: Leg;
  proceedsEur: DecimalString | null;
  /** Dépôt apparié (virement interne) : cession au coût, le coût voyage. Jamais persisté. */
  transferTo?: EventId;
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
