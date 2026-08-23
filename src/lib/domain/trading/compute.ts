/**
 * Moteur Trading (pur, `big.js` seule dépendance) : totaux d'un compte (réalisé brut, frais,
 * funding, net, dépôts nets, latent, équité) sur tout l'historique ou depuis un instant, et
 * réconciliation de l'équité : `accountValue ≈ Σ flux + Σ closedPnl − Σ frais + Σ funding + latent`
 * (auto-vérification permanente ; c'est aussi ce qui tranche « closedPnl brut de frais »).
 */
import { D, ZERO, type Big } from '../money';
import type { AccountId } from '../types';
import type {
  CashFlow,
  Execution,
  FundingPayment,
  TradingAccountInput,
  TradingSnapshot,
} from './types';

export interface TradingTotals {
  /** Σ `closedPnl` des fills perps (brut de frais). */
  realized: Big;
  /** Σ frais en devise de cotation (perps et spot), rebates déduits. */
  fees: Big;
  /** Σ frais des seuls fills perps (devise de cotation) : la part qui touche l'équité perps. */
  perpFees: Big;
  funding: Big;
  /** `realized − perpFees + funding`. */
  net: Big;
  deposits: Big;
  withdrawals: Big;
  /** Σ flux signés (dépôts, retraits, transferts spot ↔ perps, vaults…). */
  netFlows: Big;
  fills: number;
  /** Fills perps qui clôturent (closedPnl ≠ 0). */
  closingFills: number;
  /** Frais payés dans d'autres jetons (ex. HYPE), par jeton. */
  feesNative: Record<string, Big>;
}

export interface Reconciliation {
  /** Équité attendue : `netFlows + realized − perpFees + funding + unrealized`. */
  expected: Big;
  /** Équité lue (`accountValue`). */
  actual: Big;
  gap: Big;
}

export interface TradingAccountReport extends TradingAccountInput {
  totals: TradingTotals;
  /** Σ P&L latent des positions ouvertes (instantané). */
  unrealized: Big;
  /** Équité du compte perps (`accountValue`), `null` sans instantané. */
  equity: Big | null;
  reconciliation: Reconciliation | null;
}

export interface TradingReport {
  accounts: TradingAccountReport[];
  /** Équité totale des comptes synchronisés (les comptes sans instantané comptent 0). */
  equity: Big;
  unrealized: Big;
  totals: TradingTotals;
}

const emptyTotals = (): TradingTotals => ({
  realized: ZERO,
  fees: ZERO,
  perpFees: ZERO,
  funding: ZERO,
  net: ZERO,
  deposits: ZERO,
  withdrawals: ZERO,
  netFlows: ZERO,
  fills: 0,
  closingFills: 0,
  feesNative: {},
});

const byTime = <T extends { time: number; id: string }>(a: T, b: T): number =>
  a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Totaux sur les éléments dont `time ≥ since` (toute la période si `since` = 0). */
export function computeTotals(
  executions: readonly Execution[],
  funding: readonly FundingPayment[],
  cashFlows: readonly CashFlow[],
  since = 0,
): TradingTotals {
  const t = emptyTotals();
  for (const x of executions) {
    if (x.time < since) continue;
    t.fills++;
    const fee = D(x.fee);
    t.fees = t.fees.plus(fee);
    if (x.market === 'perp') {
      t.perpFees = t.perpFees.plus(fee);
      const pnl = D(x.closedPnl);
      t.realized = t.realized.plus(pnl);
      if (!pnl.eq(ZERO)) t.closingFills++;
    }
    if (x.feeNative) {
      const prev = t.feesNative[x.feeNative.asset] ?? ZERO;
      t.feesNative[x.feeNative.asset] = prev.plus(x.feeNative.qty);
    }
  }
  for (const f of funding) if (f.time >= since) t.funding = t.funding.plus(f.amount);
  for (const c of cashFlows) {
    if (c.time < since) continue;
    const amount = D(c.amount);
    t.netFlows = t.netFlows.plus(amount);
    if (c.kind === 'deposit') t.deposits = t.deposits.plus(amount);
    else if (c.kind === 'withdrawal') t.withdrawals = t.withdrawals.plus(amount.abs());
  }
  t.net = t.realized.minus(t.perpFees).plus(t.funding);
  return t;
}

export function unrealizedOf(snapshot: TradingSnapshot | null): Big {
  if (!snapshot) return ZERO;
  return snapshot.positions.reduce((acc, p) => acc.plus(p.unrealizedPnl), ZERO);
}

export function computeTradingAccount(input: TradingAccountInput): TradingAccountReport {
  const executions = [...input.executions].sort(byTime);
  const funding = [...input.funding].sort(byTime);
  const cashFlows = [...input.cashFlows].sort(byTime);
  const totals = computeTotals(executions, funding, cashFlows);
  const unrealized = unrealizedOf(input.snapshot);
  const equity = input.snapshot ? D(input.snapshot.accountValue) : null;
  const reconciliation: Reconciliation | null =
    equity === null
      ? null
      : (() => {
          const expected = totals.netFlows
            .plus(totals.realized)
            .minus(totals.perpFees)
            .plus(totals.funding)
            .plus(unrealized);
          return { expected, actual: equity, gap: equity.minus(expected) };
        })();
  return {
    ...input,
    executions,
    funding,
    cashFlows,
    totals,
    unrealized,
    equity,
    reconciliation,
  };
}

function mergeTotals(list: readonly TradingTotals[]): TradingTotals {
  const t = emptyTotals();
  for (const x of list) {
    t.realized = t.realized.plus(x.realized);
    t.fees = t.fees.plus(x.fees);
    t.perpFees = t.perpFees.plus(x.perpFees);
    t.funding = t.funding.plus(x.funding);
    t.net = t.net.plus(x.net);
    t.deposits = t.deposits.plus(x.deposits);
    t.withdrawals = t.withdrawals.plus(x.withdrawals);
    t.netFlows = t.netFlows.plus(x.netFlows);
    t.fills += x.fills;
    t.closingFills += x.closingFills;
    for (const [asset, qty] of Object.entries(x.feesNative))
      t.feesNative[asset] = (t.feesNative[asset] ?? ZERO).plus(qty);
  }
  return t;
}

/** Consolidation : les équités s'additionnent (soldes), les P&L restent ceux du trading seul. */
export function computeTrading(inputs: readonly TradingAccountInput[]): TradingReport {
  const accounts = inputs.map(computeTradingAccount);
  return {
    accounts,
    equity: accounts.reduce((acc, a) => acc.plus(a.equity ?? ZERO), ZERO),
    unrealized: accounts.reduce((acc, a) => acc.plus(a.unrealized), ZERO),
    totals: mergeTotals(accounts.map((a) => a.totals)),
  };
}

/** Totaux consolidés depuis un instant (période d'affichage). */
export function totalsSince(report: TradingReport, since: number): TradingTotals {
  return mergeTotals(
    report.accounts.map((a) => computeTotals(a.executions, a.funding, a.cashFlows, since)),
  );
}

export const accountReport = (
  report: TradingReport,
  accountId: AccountId,
): TradingAccountReport | undefined => report.accounts.find((a) => a.accountId === accountId);
