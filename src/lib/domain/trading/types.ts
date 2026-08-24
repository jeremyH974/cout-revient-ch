/**
 * Types du moteur Trading (proposition v2 § 6.2) : exécutions (fills spot ou perp), funding, flux
 * de trésorerie du compte, instantané des positions ouvertes. Vocabulaire distinct de
 * l'Investissement : jamais de PRU ici, un P&L réalisé brut − frais ± funding. Montants en chaînes
 * décimales dans la devise de cotation du compte (USDC sur Hyperliquid) ; conversion à l'affichage.
 */
import type { AccountId, DecimalString, NaiveDateTime } from '../types';

export type TradingSource = 'hyperliquid-api' | 'manual';
export type Market = 'spot' | 'perp';

/** Une exécution (fill) normalisée, entrée du moteur. */
export interface Execution {
  /** `hl:<tid>` ou `man:<id>`. */
  id: string;
  accountId: AccountId;
  at: NaiveDateTime;
  /** Millisecondes UTC (tri exact, fenêtres de période). */
  time: number;
  market: Market;
  /** `BTC` (perp), `PURR` (jeton spot). */
  symbol: string;
  /** Devise de cotation (`USDC`). */
  quote: string;
  side: 'buy' | 'sell';
  /** Quantité strictement positive. */
  qty: DecimalString;
  price: DecimalString;
  /** `qty × price`, dans la devise de cotation. */
  notional: DecimalString;
  /** Frais dans la devise de cotation (négatif = rebate) ; 0 si payés dans un autre jeton. */
  fee: DecimalString;
  /** Frais payés dans un autre jeton (ex. HYPE), non valorisés par le moteur. */
  feeNative: { asset: string; qty: DecimalString } | null;
  /** Réalisé par ce fill, BRUT de frais (perps) ; `0` pour le spot. */
  closedPnl: DecimalString;
  /** Position signée avant le fill (perps) ; `0` pour le spot. */
  startPosition: DecimalString;
  /** Libellé brut de la plateforme (`Open Long`, `Close Short`, `Buy`…), pour l'affichage. */
  direction: string;
  liquidation: boolean;
  /** true = taker. */
  crossed: boolean;
  source: TradingSource;
}

/** Paiement de funding (perps) : `amount` signé dans la devise de cotation (négatif = payé). */
export interface FundingPayment {
  id: string;
  accountId: AccountId;
  at: NaiveDateTime;
  time: number;
  symbol: string;
  amount: DecimalString;
  rate: DecimalString;
  positionSize: DecimalString;
}

export type CashFlowKind =
  | 'deposit'
  | 'withdrawal'
  | 'transfer-in'
  | 'transfer-out'
  | 'spot-to-perp'
  | 'perp-to-spot'
  | 'vault-deposit'
  | 'vault-withdraw'
  | 'other';

/**
 * Mouvement de trésorerie vu du compte de trading (perps) : `amount` signé (positif = entrée).
 * Les mouvements purement spot (transferts de jetons) ont `amount = 0` et sont listés pour mémoire.
 */
export interface CashFlow {
  id: string;
  accountId: AccountId;
  at: NaiveDateTime;
  time: number;
  kind: CashFlowKind;
  amount: DecimalString;
  asset: string;
  /** Frais prélevés par la plateforme sur ce mouvement (information). */
  fee: DecimalString;
  label: string;
}

export interface OpenPosition {
  symbol: string;
  side: 'long' | 'short';
  /** Taille absolue. */
  size: DecimalString;
  entryPrice: DecimalString | null;
  /** Valeur notionnelle au prix de marque. */
  value: DecimalString;
  unrealizedPnl: DecimalString;
  leverage: number;
  leverageType: 'cross' | 'isolated';
  liquidationPrice: DecimalString | null;
  marginUsed: DecimalString;
  fundingSinceOpen: DecimalString | null;
}

export interface SpotHolding {
  /** Ticker en minuscules (`purr`, `hype`, `usdc`), comme les actifs de l'Investissement. */
  asset: string;
  qty: DecimalString;
  /** Quantité bloquée par des ordres ouverts. */
  hold: DecimalString;
  /** Coût d'entrée notionnel indiqué par la plateforme (information, pas un PRU). */
  entryNotional: DecimalString;
}

/** Instantané du compte lu à la dernière synchronisation. */
export interface TradingSnapshot {
  at: string;
  /** Équité du compte perps : collatéral + P&L latent (« Account value »). */
  accountValue: DecimalString;
  withdrawable: DecimalString;
  marginUsed: DecimalString;
  positions: OpenPosition[];
  spot: SpotHolding[];
}

export interface TradingAccountInput {
  accountId: AccountId;
  executions: Execution[];
  funding: FundingPayment[];
  cashFlows: CashFlow[];
  snapshot: TradingSnapshot | null;
}
