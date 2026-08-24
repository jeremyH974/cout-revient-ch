/**
 * Bruts Hyperliquid → entrées du moteur Trading (exécutions, funding, flux de trésorerie,
 * instantané) et, si le compte route son spot vers l'Investissement, événements du grand livre
 * (`TradeEvent`) : la contrepartie USDC y est modélisée comme du cash converti en euros au taux
 * BCE du jour (décision n° 18), jamais comme une position stablecoin (décision n° 22 : marge et
 * trésorerie de trading ≠ investissement). Module pur.
 */
import { D, toDecimalString, ZERO, type Big } from '../../domain/money';
import type {
  CashFlow,
  CashFlowKind,
  Execution,
  FundingPayment,
  OpenPosition,
  SpotHolding,
  TradingAccountInput,
  TradingSnapshot,
} from '../../domain/trading/types';
import type { AccountId, DecimalString, LedgerEvent, TradeEvent } from '../../domain/types';
import { isSpotCoin, resolveSpotPair, type HlFill, type HlLedgerUpdate } from './api-types';
import { fundingKey, ledgerKey, sortedFills, type HlAccountData, type HlSpotPairRef } from './data';
import { msToParisDay, msToParisNaive } from '../time';

export interface NormalizeOptions {
  accountId: AccountId;
  spotPairs: Record<string, HlSpotPairRef>;
  /** Les fills spot alimentent l'espace Investissement (PRU) au lieu des « Avoirs spot ». */
  spotAsInvestment: boolean;
  /** Taux BCE EUR→USD du jour (`YYYY-MM-DD`), `null` si aucun taux n'est connu. */
  eurUsdRate: (day: string) => DecimalString | null;
}

export interface NormalizedHlAccount {
  trading: TradingAccountInput;
  /** Événements de l'espace Investissement (vide sans `spotAsInvestment`). */
  investEvents: LedgerEvent[];
  /** Des fills spot n'ont pas pu être convertis en euros (aucun taux) : événements omis. */
  fxMissing: number;
  /** Types de mouvements du grand livre non interprétés (information, jamais bloquant). */
  unknownLedgerTypes: string[];
}

const lower = (s: string): string => s.toLowerCase();
const field = (l: HlLedgerUpdate, key: string): string | null => {
  const v = l.fields[key];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
};
const decField = (l: HlLedgerUpdate, key: string): Big => {
  const v = field(l, key);
  return v !== null && /^-?\d+(\.\d+)?$/.test(v) ? D(v) : ZERO;
};

export function fillToExecution(
  fill: HlFill,
  accountId: AccountId,
  spotPairs: Record<string, HlSpotPairRef>,
): Execution {
  const spot = isSpotCoin(fill.coin);
  const pair = spot ? resolveSpotPair(fill.coin, pairsOf(spotPairs)) : null;
  const quote = pair?.quote ?? 'USDC';
  const feeInQuote = fill.feeToken === quote;
  return {
    id: `hl:${fill.tid}`,
    accountId,
    at: msToParisNaive(fill.time),
    time: fill.time,
    market: spot ? 'spot' : 'perp',
    symbol: spot ? (pair?.base ?? fill.coin) : fill.coin,
    quote,
    side: fill.side === 'B' ? 'buy' : 'sell',
    qty: fill.sz,
    price: fill.px,
    notional: toDecimalString(D(fill.px).times(fill.sz)),
    fee: feeInQuote ? fill.fee : '0',
    feeNative: feeInQuote ? null : { asset: fill.feeToken, qty: fill.fee },
    closedPnl: spot ? '0' : fill.closedPnl,
    startPosition: spot ? '0' : fill.startPosition,
    direction: fill.dir,
    liquidation: fill.liquidation !== null,
    crossed: fill.crossed,
    source: 'hyperliquid-api',
  };
}

const pairsOf = (
  spotPairs: Record<string, HlSpotPairRef>,
): { name: string; base: string; quote: string }[] =>
  Object.entries(spotPairs).map(([name, p]) => ({ name, base: p.base, quote: p.quote }));

/** Mouvement du grand livre → flux de trésorerie signé vu du compte perps. */
export function ledgerToCashFlow(
  entry: HlLedgerUpdate,
  accountId: AccountId,
  address: string,
): { flow: CashFlow; known: boolean } {
  const base = {
    id: `hl:l:${ledgerKey(entry)}`,
    accountId,
    at: msToParisNaive(entry.time),
    time: entry.time,
    asset: 'USDC',
    fee: toDecimalString(decField(entry, 'fee')),
  };
  const usdc = decField(entry, 'usdc');
  const outgoing = lower(field(entry, 'user') ?? '') === address;
  const make = (kind: CashFlowKind, amount: Big, label: string, asset = 'USDC'): CashFlow => ({
    ...base,
    kind,
    amount: toDecimalString(amount),
    asset,
    label,
  });
  switch (entry.type) {
    case 'deposit':
      return { flow: make('deposit', usdc, 'Dépôt'), known: true };
    case 'withdraw':
      return { flow: make('withdrawal', usdc.neg(), 'Retrait'), known: true };
    case 'accountClassTransfer': {
      const toPerp = entry.fields['toPerp'] === true;
      return {
        flow: toPerp
          ? make('spot-to-perp', usdc, 'Transfert spot → perps')
          : make('perp-to-spot', usdc.neg(), 'Transfert perps → spot'),
        known: true,
      };
    }
    case 'internalTransfer':
      return {
        flow: outgoing
          ? make('transfer-out', usdc.neg(), 'Envoi USDC')
          : make('transfer-in', usdc, 'Réception USDC'),
        known: true,
      };
    case 'subAccountTransfer':
      return {
        flow: outgoing
          ? make('transfer-out', usdc.neg(), 'Vers un sous-compte')
          : make('transfer-in', usdc, 'Depuis un sous-compte'),
        known: true,
      };
    case 'vaultDeposit':
    case 'vaultCreate':
      return { flow: make('vault-deposit', usdc.neg(), 'Dépôt dans un vault'), known: true };
    case 'vaultWithdraw':
    case 'vaultDistribution':
      return { flow: make('vault-withdraw', usdc, 'Retrait d’un vault'), known: true };
    case 'spotTransfer': {
      const token = field(entry, 'token') ?? '?';
      return {
        flow: make(
          outgoing ? 'transfer-out' : 'transfer-in',
          ZERO,
          `${outgoing ? 'Envoi' : 'Réception'} de ${field(entry, 'amount') ?? ''} ${token} (spot)`,
          token,
        ),
        known: true,
      };
    }
    case 'liquidation':
      return { flow: make('other', ZERO, 'Liquidation'), known: true };
    // Transfert entre DEX (perps multiples) : sens et classe de compte non documentés — listé pour
    // mémoire ; un écart de réconciliation le signalerait.
    case 'send':
      return {
        flow: make(
          'other',
          ZERO,
          `Transfert inter-DEX de ${field(entry, 'amount') ?? ''} ${field(entry, 'token') ?? ''}`,
          field(entry, 'token') ?? 'USDC',
        ),
        known: true,
      };
    case 'spotGenesis':
    case 'rewardsClaim':
      return {
        flow: make('other', ZERO, entry.type, field(entry, 'token') ?? 'USDC'),
        known: true,
      };
    default:
      return { flow: make('other', ZERO, entry.type), known: false };
  }
}

export function snapshotOf(data: HlAccountData): TradingSnapshot | null {
  const s = data.snapshot;
  if (!s) return null;
  const positions: OpenPosition[] = s.perps.positions
    .filter((p) => !D(p.szi).eq(ZERO))
    .map((p) => {
      const szi = D(p.szi);
      return {
        symbol: p.coin,
        side: szi.lt(ZERO) ? 'short' : 'long',
        size: toDecimalString(szi.abs()),
        entryPrice: p.entryPx,
        value: p.positionValue,
        unrealizedPnl: p.unrealizedPnl,
        leverage: p.leverage.value,
        leverageType: p.leverage.type,
        liquidationPrice: p.liquidationPx,
        marginUsed: p.marginUsed,
        fundingSinceOpen: p.cumFunding ? p.cumFunding.sinceOpen : null,
      };
    });
  const spot: SpotHolding[] = s.spot
    .filter((b) => D(b.total).gt(ZERO))
    .map((b) => ({
      asset: lower(b.coin),
      qty: b.total,
      hold: b.hold,
      entryNotional: b.entryNtl,
    }));
  return {
    at: s.at,
    accountValue: s.perps.accountValue,
    withdrawable: s.perps.withdrawable,
    marginUsed: s.perps.totalMarginUsed,
    positions,
    spot,
  };
}

/** Fill spot → `TradeEvent` de l'Investissement ; `null` si aucun taux EUR→USD n'est connu. */
export function spotFillToTradeEvent(
  x: Execution,
  eurUsdRate: (day: string) => DecimalString | null,
): TradeEvent | null {
  const day = msToParisDay(x.time);
  const rate = eurUsdRate(day);
  if (rate === null || !D(rate).gt(ZERO)) return null;
  const toEur = (v: Big): Big => v.div(rate);
  const fee = D(x.fee);
  const gross = fee.gt(ZERO) ? fee : ZERO;
  const rebate = fee.lt(ZERO) ? fee.abs() : ZERO;
  // All-in comme la contre-valeur Coinhouse : un achat coûte notionnel + frais, une vente rapporte
  // notionnel − frais (les rebates jouent en sens inverse).
  const allIn =
    x.side === 'buy'
      ? D(x.notional).plus(gross).minus(rebate)
      : D(x.notional).minus(gross).plus(rebate);
  const valueEur = toDecimalString(toEur(allIn));
  const asset = lower(x.symbol);
  const warnings: string[] = [];
  // Achat spot : les frais sont prélevés sur le jeton reçu (quantité nette = sz − frais), ce qui
  // renchérit mécaniquement le PRU ; un frais dans un jeton tiers (HYPE) n'est pas valorisé.
  let qtyIn = x.qty;
  if (x.feeNative) {
    if (x.side === 'buy' && lower(x.feeNative.asset) === asset)
      qtyIn = toDecimalString(D(x.qty).minus(x.feeNative.qty));
    else warnings.push(`Frais payés en ${x.feeNative.asset} (${x.feeNative.qty}) non comptés.`);
  }
  return {
    id: x.id,
    at: x.at,
    source: 'hyperliquid-api',
    scope: 'external',
    accountId: x.accountId,
    rowKeys: [],
    warnings,
    kind: 'trade',
    out: x.side === 'buy' ? { asset: 'eur', qty: valueEur } : { asset, qty: x.qty },
    in: x.side === 'buy' ? { asset, qty: qtyIn } : { asset: 'eur', qty: valueEur },
    valueEur,
    valueEurSource: 'counter-leg',
    fee: fee.eq(ZERO)
      ? null
      : {
          asset: lower(x.quote),
          gross: toDecimalString(gross),
          rebate: toDecimalString(rebate),
          grossEur: toDecimalString(toEur(gross)),
          rebateEur: toDecimalString(toEur(rebate)),
        },
    quotePrice: { asset: lower(x.quote), price: x.price },
  };
}

export function normalizeHlAccount(
  data: HlAccountData,
  options: NormalizeOptions,
): NormalizedHlAccount {
  const { accountId } = options;
  const executions = sortedFills(data.fills).map((f) =>
    fillToExecution(f, accountId, options.spotPairs),
  );
  const funding: FundingPayment[] = Object.values(data.funding)
    .sort((a, b) => a.time - b.time)
    .map((f) => ({
      id: `hl:f:${fundingKey(f)}`,
      accountId,
      at: msToParisNaive(f.time),
      time: f.time,
      symbol: f.coin,
      amount: f.usdc,
      rate: f.fundingRate,
      positionSize: f.szi,
    }));
  const cashFlows: CashFlow[] = [];
  const unknown = new Set<string>();
  for (const entry of Object.values(data.ledger).sort((a, b) => a.time - b.time)) {
    const { flow, known } = ledgerToCashFlow(entry, accountId, data.address);
    cashFlows.push(flow);
    if (!known) unknown.add(entry.type);
  }
  const investEvents: LedgerEvent[] = [];
  let fxMissing = 0;
  const trading: Execution[] = [];
  for (const x of executions) {
    if (options.spotAsInvestment && x.market === 'spot') {
      const event = spotFillToTradeEvent(x, options.eurUsdRate);
      if (event) investEvents.push(event);
      else fxMissing++;
    } else trading.push(x);
  }
  return {
    trading: { accountId, executions: trading, funding, cashFlows, snapshot: snapshotOf(data) },
    investEvents,
    fxMissing,
    unknownLedgerTypes: [...unknown].sort(),
  };
}
