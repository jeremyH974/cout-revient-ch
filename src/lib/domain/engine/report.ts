/** Types de sortie du moteur (valeurs en Big, jamais persistées). */
import type { AssetClass } from '../assets';
import type { Big, DecimalString } from '../money';
import type {
  AccountId,
  AssetCode,
  EventId,
  NaiveDateTime,
  QuotePrice,
  RowKey,
  UnqualifiedEvent,
} from '../types';

export interface PriceQuoteInput {
  asset: AssetCode;
  priceEur: DecimalString;
  /** ISO 8601 de la cotation. */
  at: string;
  source: string;
  stale: boolean;
}

/**
 * Flux de trésorerie externe du portefeuille, miroir daté des opérations « comptées » du moteur :
 * achats, apports au coût et frais < 0 ; produits et sorties au coût > 0. Par construction,
 * `Σ flux− = −(Σ investedTotal + subscriptions)` et `Σ flux+ = Σ proceedsTotal` (positions
 * bloquées comprises). Base du XIRR.
 */
export interface CashFlow {
  at: NaiveDateTime;
  amountEur: Big;
  /** Événement d'origine : permet d'écarter les jambes de virement interne (TWR). */
  eventId: EventId;
}

export type LotOrigin = 'purchase' | 'reward' | 'deposit' | 'migration' | 'opening-balance';

export interface LotReport {
  id: string;
  eventId: EventId;
  openedAt: NaiveDateTime;
  origin: LotOrigin;
  counterAsset: AssetCode | null;
  qtyInitial: Big;
  costInitial: Big;
  qtyRemaining: Big;
  costRemaining: Big;
  /** Prix all-in d'une unité du lot (coût initial ÷ quantité initiale). */
  unitCost: Big | null;
  value: Big | null;
  unrealized: Big | null;
  unrealizedPct: Big | null;
}

export type HistoryKind =
  | 'buy'
  | 'sell'
  | 'reward'
  | 'deposit'
  | 'withdrawal'
  | 'migration-in'
  | 'migration-out'
  | 'opening-balance';

/**
 * Part d'un lot consommée par une cession. Le CUMP proratise tous les lots ouverts ; sans cette
 * trace, l'information est calculée puis jetée et « pourquoi ce réalisé ? » reste sans réponse.
 * `Σ cost` d'une cession **est** son coût de cession.
 */
export interface LotConsumption {
  lotId: string;
  /** Événement qui a ouvert le lot (l'achat d'origine). */
  eventId: EventId;
  openedAt: NaiveDateTime;
  origin: LotOrigin;
  qty: Big;
  cost: Big;
}

/** Une ligne de l'historique d'un actif, avec le PRU après l'opération. */
export interface HistoryEntry {
  eventId: EventId;
  /** Lignes brutes de l'événement : le pont vers le fichier importé (`RowKey`). */
  rowKeys: readonly RowKey[];
  /** Compte d'origine du mouvement (provenance dans les exports). */
  accountId: AccountId;
  at: NaiveDateTime;
  kind: HistoryKind;
  /** Quantité signée (négatif = sortie). */
  qty: Big;
  valueEur: Big | null;
  /** Prix all-in par unité (valeur EUR ÷ quantité). */
  unitPrice: Big | null;
  counterAsset: AssetCode | null;
  quotePrice: QuotePrice | null;
  feeEur: Big;
  rebateEur: Big;
  /** Plus-value réalisée sur cette cession (null pour une acquisition). */
  realized: Big | null;
  /** Lots consommés au prorata par cette cession (vide pour une acquisition). */
  lotsConsumed: readonly LotConsumption[];
  pruAfter: Big | null;
  qtyAfter: Big;
  warnings: string[];
}

export interface BlockedInfo {
  eventId: EventId;
  at: NaiveDateTime;
  /** Quantité manquante pour honorer la cession. */
  deficit: Big;
}

export type IntegrityStatus =
  'ok' | 'opening-balance-missing' | 'balance-mismatch' | 'final-mismatch' | 'no-data';

export interface IntegrityResult {
  asset: AssetCode;
  status: IntegrityStatus;
  message: string;
  impliedOpening: Big | null;
  expected: Big | null;
  found: Big | null;
  at: NaiveDateTime | null;
  /** Jours où l'ordre de règlement diffère de l'ordre des horodatages (information). */
  reorderedDays: string[];
}

export type PositionStatus = 'ok' | 'blocked' | 'no-price' | 'needs-qualification';

export interface PositionReport {
  asset: AssetCode;
  assetClass: AssetClass;
  status: PositionStatus;
  qty: Big;
  costBasis: Big;
  /** Coût moyen pondéré all-in d'une unité détenue (null si quantité nulle). */
  pru: Big | null;
  /** Σ des acquisitions valorisées (achats, coût reporté des migrations, dépôts au coût). */
  investedTotal: Big;
  /** Σ des cessions valorisées. */
  proceedsTotal: Big;
  netInvested: Big;
  capitalRecovered: boolean;
  price: PriceQuoteInput | null;
  value: Big | null;
  unrealized: Big | null;
  /** Latent ÷ investi (= qté × PRU), null sans prix ou sans base. */
  unrealizedPct: Big | null;
  realized: Big;
  otherIncome: Big;
  total: Big | null;
  /** Dénominateur du ROI : capital maximal engagé sur l'actif (plus haut de achats − produits). */
  roiBase: Big;
  /** Total ÷ capital maximal engagé, null si rien n'a été acquis à titre onéreux. */
  roi: Big | null;
  lots: LotReport[];
  history: HistoryEntry[];
  feesEur: Big;
  rebatesEur: Big;
  zeroCostQty: Big;
  closed: boolean;
  dust: boolean;
  blocked: BlockedInfo | null;
  unqualifiedCount: number;
  warnings: string[];
  integrity: IntegrityResult | null;
}

export interface PortfolioTotals {
  value: Big;
  /** Coût des positions détenues ET cotées (Σ qté × PRU) : base du latent, même périmètre que `value`. */
  costBasis: Big;
  /** Coût des positions détenues sans prix : exclu de `costBasis`, `value`, `unrealized` et `total`. */
  unpricedCostBasis: Big;
  investedTotal: Big;
  proceedsTotal: Big;
  netInvested: Big;
  realized: Big;
  unrealized: Big;
  otherIncome: Big;
  total: Big;
  /** Dénominateur du ROI : capital maximal engagé en euros (sinon Σ achats). */
  roiBase: Big;
  roi: Big | null;
  /** Euros réellement entrés (achats payés en euros) et sortis (ventes en euros). */
  cashIn: Big;
  cashOut: Big;
  netCash: Big;
  feesEur: Big;
  rebatesEur: Big;
  subscriptionsEur: Big;
  /** Actifs détenus sans prix : exclus de `value`, `unrealized` et `total`. */
  unpricedAssets: AssetCode[];
}

export interface AllocationEntry {
  asset: AssetCode;
  value: Big;
  share: Big;
}

export interface PortfolioReport {
  /** Positions crypto ouvertes. */
  positions: PositionReport[];
  /** Flux externes datés (voir `CashFlow`), dans l'ordre chronologique du moteur. */
  cashFlows: readonly CashFlow[];
  stablecoins: PositionReport[];
  closed: PositionReport[];
  blocked: PositionReport[];
  totals: PortfolioTotals;
  allocation: AllocationEntry[];
  unqualified: UnqualifiedEvent[];
  /** Plus ancienne cotation utilisée (ISO), null sans prix. */
  pricedAt: string | null;
  warnings: string[];
}
