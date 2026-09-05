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
  /** Ventes spot : leur plus-value réalisée échappe à la réconciliation (voir `Reconciliation`). */
  spotSales: number;
  /** Frais payés dans d'autres jetons (ex. HYPE), par jeton. */
  feesNative: Record<string, Big>;
}

export interface Reconciliation {
  /**
   * Valeur attendue du compte :
   * `apports externes + réalisé perps − frais + funding + latent perps + latent spot`.
   */
  expected: Big;
  /** Valeur lue : `accountValue` des perps + avoirs spot valorisés. */
  actual: Big;
  gap: Big;
  /**
   * Ventes spot du compte. Leur **plus-value réalisée** n'entre pas dans `expected` : la calculer
   * demanderait un coût de revient par jeton, ce que ce moteur ne tient pas (l'espace
   * Investissement le fait, via l'option « traiter le spot comme de l'investissement »). Quand ce
   * compteur n'est pas nul, l'écart CONTIENT ce résultat et n'est donc pas une anomalie de
   * données — l'écran doit le dire plutôt que de crier au loup (décision n° 100).
   */
  spotSales: number;
}

export interface TradingAccountReport extends TradingAccountInput {
  totals: TradingTotals;
  /** Σ P&L latent des positions ouvertes (instantané). */
  unrealized: Big;
  /** Avoirs spot valorisés : la devise de cotation au pair, les autres jetons via `spotPrice`. */
  spotValue: Big;
  /** Jetons spot dont le prix est inconnu : exclus de `spotValue`, jamais devinés. */
  spotUnpriced: string[];
  /** Latent des avoirs spot hors devise de cotation (`valeur − notionnel d'entrée`). */
  spotUnrealized: Big;
  /**
   * **Valeur du compte : équité perps + avoirs spot** (décision n° 100), `null` sans instantané.
   *
   * La version précédente ne comptait que `accountValue`, l'équité du compte perps. Or un compte
   * sans position ouverte a une équité perps NULLE et tout son argent du côté spot : l'app
   * affichait donc zéro — et une perte de 100 % des apports — pour l'état le plus banal qui soit,
   * celui d'un compte entre deux trades.
   */
  equity: Big | null;
  reconciliation: Reconciliation | null;
}

export interface TradingReport {
  accounts: TradingAccountReport[];
  /**
   * Équité totale des comptes, `null` dès qu'un seul n'a pas d'instantané : **un solde qu'on n'a
   * pas mesuré n'est pas un solde nul** (décision n° 97). La version précédente sommait les
   * comptes muets à zéro, ce qui présentait un compte non synchronisé comme un compte vidé — et
   * transformait ses apports en perte sèche sur la Vue d'ensemble.
   */
  equity: Big | null;
  /** Comptes sans instantané, ceux qui rendent `equity` nulle. */
  unvalued: string[];
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
  spotSales: 0,
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
    } else if (x.side === 'sell') t.spotSales++;
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

/**
 * Devise de cotation de la plateforme : un solde d'USDC vaut sa quantité, sans cotation. Les
 * autres jetons ne sont valorisés que si l'appelant sait les coter — jamais devinés.
 */
export const QUOTE_ASSET = 'usdc';

/** Prix d'un jeton spot dans la devise de cotation ; `null` = inconnu. */
export type SpotPrice = (asset: string) => Big | null;

export interface SpotValuation {
  /** Σ des avoirs valorisés. */
  value: Big;
  /** Jetons écartés faute de prix : la valeur est alors INCOMPLÈTE, et doit le dire. */
  unpriced: string[];
  /** `valeur − notionnel d'entrée` des jetons hors devise de cotation : le latent du spot. */
  unrealized: Big;
}

export function spotValueOf(snapshot: TradingSnapshot | null, price: SpotPrice): SpotValuation {
  if (!snapshot) return { value: ZERO, unpriced: [], unrealized: ZERO };
  let value = ZERO;
  let unrealized = ZERO;
  const unpriced: string[] = [];
  for (const holding of snapshot.spot) {
    const qty = D(holding.qty);
    if (holding.asset === QUOTE_ASSET) {
      // De la trésorerie : elle vaut sa quantité, et n'a par construction aucun latent.
      value = value.plus(qty);
      continue;
    }
    const quote = price(holding.asset);
    if (quote === null) {
      if (qty.gt(ZERO)) unpriced.push(holding.asset);
      continue;
    }
    const amount = qty.times(quote);
    value = value.plus(amount);
    unrealized = unrealized.plus(amount.minus(holding.entryNotional ?? ZERO));
  }
  return { value, unpriced, unrealized };
}

export function computeTradingAccount(
  input: TradingAccountInput,
  spotPrice: SpotPrice = () => null,
): TradingAccountReport {
  const executions = [...input.executions].sort(byTime);
  const funding = [...input.funding].sort(byTime);
  const cashFlows = [...input.cashFlows].sort(byTime);
  const totals = computeTotals(executions, funding, cashFlows);
  const unrealized = unrealizedOf(input.snapshot);
  const spot = spotValueOf(input.snapshot, spotPrice);
  const equity = input.snapshot ? D(input.snapshot.accountValue).plus(spot.value) : null;
  const reconciliation: Reconciliation | null =
    equity === null
      ? null
      : (() => {
          /*
           * Périmètre du compte entier : les frais SPOT comptent aussi (ils sortent du solde), et
           * le latent du spot entre au même titre que celui des perps. Les virements internes,
           * eux, ne sont plus des flux (décision n° 100) : ils déplacent sans rien produire.
           */
          const expected = totals.netFlows
            .plus(totals.realized)
            .minus(totals.fees)
            .plus(totals.funding)
            .plus(unrealized)
            .plus(spot.unrealized);
          return {
            expected,
            actual: equity,
            gap: equity.minus(expected),
            spotSales: totals.spotSales,
          };
        })();
  return {
    ...input,
    executions,
    funding,
    cashFlows,
    totals,
    unrealized,
    spotValue: spot.value,
    spotUnpriced: spot.unpriced,
    spotUnrealized: spot.unrealized,
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
    t.spotSales += x.spotSales;
    for (const [asset, qty] of Object.entries(x.feesNative))
      t.feesNative[asset] = (t.feesNative[asset] ?? ZERO).plus(qty);
  }
  return t;
}

/**
 * Consolidation : les équités s'additionnent (soldes), les P&L restent ceux du trading seul.
 *
 * Un compte sans instantané ne compte pas pour zéro — il rend le total **inconnu**, et se nomme
 * dans `unvalued` pour que l'écran dise lequel plutôt que d'afficher un chiffre incomplet comme
 * s'il était entier (décision n° 97).
 */
export function computeTrading(
  inputs: readonly TradingAccountInput[],
  spotPrice: SpotPrice = () => null,
): TradingReport {
  const accounts = inputs.map((input) => computeTradingAccount(input, spotPrice));
  const unvalued = accounts.filter((a) => a.equity === null).map((a) => a.accountId);
  return {
    accounts,
    unvalued,
    equity:
      unvalued.length > 0 ? null : accounts.reduce((acc, a) => acc.plus(a.equity ?? ZERO), ZERO),
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
