/** Assemblage du rapport : positions, totaux, répartition, intégrité. */
import { assetClass, isFiat } from '../assets';
import { D, ZERO, divOrNull, isPositive, type Big } from '../money';
import {
  COINHOUSE_ACCOUNT_ID,
  type AccountId,
  type AssetCode,
  type EngineSettings,
  type LedgerEvent,
} from '../types';
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
    roiBase: state.engagedMax,
    roi: total && isPositive(state.engagedMax) ? total.div(state.engagedMax) : null,
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
  // Contrôle de solde : quantités des seuls événements Coinhouse (les saisies « hors Coinhouse » sont exclues).
  const finalQty: Record<AssetCode, string> = {};
  for (const [asset, qty] of run.coinhouseQty) finalQty[asset] = qty.toString();
  // Un actif présent dans l'export mais dont aucune ligne n'a été interprétée détient 0 pour le
  // moteur : le contrôle de solde doit le dire, pas se taire.
  for (const record of input.balances ?? []) finalQty[record.asset] ??= '0';
  const integrity = input.balances ? checkBalances(input.balances, finalQty) : {};

  const all: PositionReport[] = [];
  for (const [asset, state] of run.positions) {
    if (
      isFiat(asset) ||
      (state.history.length === 0 && state.unqualifiedCount === 0 && !state.blocked)
    )
      continue;
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
  // Les positions « poussière » restent valorisées : leur latent (≈ −coût) fait partie du total.
  const priced = live.filter((p) => p.value !== null);
  const realized = sumBy(live, (p) => p.realized);
  const unrealized = sumBy(priced, (p) => p.unrealized);
  const otherIncome = sumBy(live, (p) => p.otherIncome);
  const investedTotal = sumBy(live, (p) => p.investedTotal);
  const proceedsTotal = sumBy(live, (p) => p.proceedsTotal);
  const value = sumBy(priced, (p) => p.value);
  let total = realized.plus(unrealized).plus(otherIncome);
  if (input.settings.includeSubscriptionsInPnl) total = total.minus(run.subscriptionsEur);
  const roiBase = isPositive(run.cashEngagedMax) ? run.cashEngagedMax : investedTotal;
  // « Investi » partage le périmètre de « Valeur » (positions cotées) pour que Latent = Valeur − Investi
  // à l'écran ; le coût des actifs sans prix est exposé à part pour être annoncé.
  const unpriced = open.filter((p) => p.value === null);
  const totals: PortfolioTotals = {
    value,
    costBasis: sumBy(priced, (p) => p.costBasis),
    unpricedCostBasis: sumBy(unpriced, (p) => p.costBasis),
    investedTotal,
    proceedsTotal,
    netInvested: investedTotal.minus(proceedsTotal),
    realized,
    unrealized,
    otherIncome,
    total,
    // ROI rapporté au capital maximal engagé en euros (apports − retraits, à leur plus haut) ;
    // à défaut d'apports en euros (saisies manuelles sans espèces), à Σ achats.
    roiBase,
    roi: isPositive(roiBase) ? total.div(roiBase) : null,
    cashIn: run.cashIn,
    cashOut: run.cashOut,
    netCash: run.cashIn.minus(run.cashOut),
    feesEur: sumBy(live, (p) => p.feesEur),
    rebatesEur: sumBy(live, (p) => p.rebatesEur),
    subscriptionsEur: run.subscriptionsEur,
    unpricedAssets: unpriced.map((p) => p.asset),
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

/**
 * Un rapport par compte (vue « par plateforme ») : le grand livre de chaque compte est rejoué
 * seul, donc le PRU et le réalisé d'un compte sont ceux de la plateforme. La vue consolidée reste
 * `computePortfolio` sur le grand livre entier (PRU global) — les deux ne se somment pas exactement
 * après des ventes, et c'est voulu (docs/DECISIONS.md n° 20). Le contrôle de solde Coinhouse ne
 * s'applique qu'au compte Coinhouse.
 */
export function computePortfolioByAccount(input: ComputeInput): Map<AccountId, PortfolioReport> {
  // Virements internes : dans la vue par compte, le retrait apparié vit dans un AUTRE grand
  // livre ; le coût qui voyage est donc pris au run consolidé puis estampillé sur le dépôt, et le
  // lien est retiré pour que chaque compte se rejoue de façon autonome.
  const consolidated = runLedger(input.events, input.settings);
  const stamped = input.events.map((event): LedgerEvent => {
    if (event.kind !== 'deposit' || event.transferFrom === undefined) return event;
    const carried = consolidated.transferCosts.get(event.transferFrom);
    const { transferFrom: _link, ...rest } = event;
    void _link;
    return {
      ...rest,
      costEur: carried !== undefined ? carried.toString() : event.costEur,
      warnings: [
        ...event.warnings,
        'Virement interne : coût d’acquisition repris du compte d’origine.',
      ],
    };
  });
  const groups = new Map<AccountId, LedgerEvent[]>();
  for (const event of stamped) {
    const list = groups.get(event.accountId);
    if (list) list.push(event);
    else groups.set(event.accountId, [event]);
  }
  const reports = new Map<AccountId, PortfolioReport>();
  for (const [accountId, events] of groups) {
    reports.set(
      accountId,
      computePortfolio({
        events,
        prices: input.prices,
        settings: input.settings,
        ...(accountId === COINHOUSE_ACCOUNT_ID && input.balances
          ? { balances: input.balances }
          : {}),
      }),
    );
  }
  return reports;
}
