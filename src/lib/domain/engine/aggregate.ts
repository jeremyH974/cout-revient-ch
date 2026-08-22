/** Assemblage du rapport : positions, totaux, répartition, intégrité. */
import { assetClass, isFiat } from '../assets';
import { D, ZERO, divOrNull, isPositive, type Big } from '../money';
import type { AssetCode, EngineSettings, LedgerEvent } from '../types';
import { runLedger } from './compute';
import { checkBalances, type BalanceRecord } from './integrity';
import type { PositionState } from './position';
import type {
  AllocationEntry,
  IntegrityResult,
  LotReport,
  PortfolioReport,
  PortfolioTotals,
  PositionReport,
  PriceQuoteInput,
} from './report';

export interface ComputeInput {
  events: readonly LedgerEvent[];
  prices: Record<AssetCode, PriceQuoteInput>;
  settings: EngineSettings;
  balances?: readonly BalanceRecord[];
}

/** Sous ce montant, une position résiduelle est traitée comme clôturée (« poussière »). */
const DUST_EUR = D('0.01');

function buildPosition(
  state: PositionState,
  price: PriceQuoteInput | null,
  integrity: IntegrityResult | null,
): PositionReport {
  const unit = price ? D(price.priceEur) : null;
  const hasQty = isPositive(state.qty);
  const value = unit ? state.qty.times(unit) : hasQty ? null : ZERO;
  const unrealized = value ? value.minus(state.costBasis) : null;
  const total = unrealized ? state.realized.plus(unrealized).plus(state.otherIncome) : null;
  const netInvested = state.investedTotal.minus(state.proceedsTotal);
  const lots: LotReport[] = state.lots
    .filter((lot) => isPositive(lot.qtyRemaining))
    .map((lot) => {
      const lotValue = unit ? lot.qtyRemaining.times(unit) : null;
      const lotUnrealized = lotValue ? lotValue.minus(lot.costRemaining) : null;
      return {
        ...lot,
        unitCost: divOrNull(lot.costInitial, lot.qtyInitial),
        value: lotValue,
        unrealized: lotUnrealized,
        unrealizedPct:
          lotUnrealized && isPositive(lot.costRemaining)
            ? lotUnrealized.div(lot.costRemaining)
            : null,
      };
    });
  const dust = hasQty && value !== null && value.lt(DUST_EUR);
  const status = state.blocked
    ? 'blocked'
    : state.unqualifiedCount > 0
      ? 'needs-qualification'
      : hasQty && !unit
        ? 'no-price'
        : 'ok';
  return {
    asset: state.asset,
    assetClass: assetClass(state.asset),
    status,
    qty: state.qty,
    costBasis: state.costBasis,
    pru: state.pru,
    investedTotal: state.investedTotal,
    proceedsTotal: state.proceedsTotal,
    netInvested,
    capitalRecovered: !isPositive(netInvested) && isPositive(state.proceedsTotal),
    price,
    value,
    unrealized,
    unrealizedPct:
      unrealized && isPositive(state.costBasis) ? unrealized.div(state.costBasis) : null,
    realized: state.realized,
    otherIncome: state.otherIncome,
    total,
    roi: total && isPositive(state.investedTotal) ? total.div(state.investedTotal) : null,
    lots,
    history: [...state.history].reverse(),
    feesEur: state.feesEur,
    rebatesEur: state.rebatesEur,
    zeroCostQty: state.zeroCostQty,
    closed: !hasQty || dust,
    dust,
    blocked: state.blocked,
    unqualifiedCount: state.unqualifiedCount,
    warnings: state.warnings,
    integrity,
  };
}

const byValueDesc = (a: PositionReport, b: PositionReport): number =>
  (b.value ?? ZERO).cmp(a.value ?? ZERO) || a.asset.localeCompare(b.asset);

export function computePortfolio(input: ComputeInput): PortfolioReport {
  const run = runLedger(input.events, input.settings);
  const finalQty: Record<AssetCode, string> = {};
  for (const [asset, state] of run.positions) finalQty[asset] = state.qty.toString();
  const integrity = input.balances ? checkBalances(input.balances, finalQty) : {};

  const all: PositionReport[] = [];
  for (const [asset, state] of run.positions) {
    if (isFiat(asset) || (state.history.length === 0 && state.unqualifiedCount === 0)) continue;
    all.push(buildPosition(state, input.prices[asset] ?? null, integrity[asset] ?? null));
  }
  all.sort(byValueDesc);

  const blocked = all.filter((p) => p.status === 'blocked');
  const live = all.filter((p) => p.status !== 'blocked');
  const open = live.filter((p) => !p.closed);
  const closed = live.filter((p) => p.closed);
  const positions = open.filter((p) => p.assetClass === 'crypto');
  const stablecoins = open.filter((p) => p.assetClass === 'stablecoin');

  const sumBy = (items: PositionReport[], pick: (p: PositionReport) => Big | null): Big =>
    items.reduce((acc, p) => acc.plus(pick(p) ?? ZERO), ZERO);
  const priced = open.filter((p) => p.value !== null);
  const realized = sumBy(live, (p) => p.realized);
  const unrealized = sumBy(priced, (p) => p.unrealized);
  const otherIncome = sumBy(live, (p) => p.otherIncome);
  const investedTotal = sumBy(live, (p) => p.investedTotal);
  const proceedsTotal = sumBy(live, (p) => p.proceedsTotal);
  const value = sumBy(priced, (p) => p.value);
  let total = realized.plus(unrealized).plus(otherIncome);
  if (input.settings.includeSubscriptionsInPnl) total = total.minus(run.subscriptionsEur);
  const totals: PortfolioTotals = {
    value,
    investedTotal,
    proceedsTotal,
    netInvested: investedTotal.minus(proceedsTotal),
    realized,
    unrealized,
    otherIncome,
    total,
    roi: isPositive(investedTotal) ? total.div(investedTotal) : null,
    cashIn: run.cashIn,
    cashOut: run.cashOut,
    netCash: run.cashIn.minus(run.cashOut),
    feesEur: sumBy(live, (p) => p.feesEur),
    rebatesEur: sumBy(live, (p) => p.rebatesEur),
    subscriptionsEur: run.subscriptionsEur,
    unpricedAssets: open.filter((p) => p.value === null).map((p) => p.asset),
  };
  const allocation: AllocationEntry[] = isPositive(value)
    ? priced.map((p) => ({
        asset: p.asset,
        value: p.value ?? ZERO,
        share: (p.value ?? ZERO).div(value),
      }))
    : [];
  const quoteDates = open
    .map((p) => p.price?.at)
    .filter((at): at is string => !!at)
    .sort();
  return {
    positions,
    stablecoins,
    closed,
    blocked,
    totals,
    allocation,
    unqualified: run.unqualified,
    pricedAt: quoteDates[0] ?? null,
    warnings: run.warnings,
  };
}
