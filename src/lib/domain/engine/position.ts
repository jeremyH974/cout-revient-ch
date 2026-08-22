/**
 * État d'une position (un actif) : coût moyen pondéré (CUMP) invariant à la vente,
 * lots par acquisition consommés au prorata, compteurs réalisé / investi / produits.
 */
import { D, ZERO, isPositive, isZero, type Big } from '../money';
import type { AssetCode, EventId, NaiveDateTime, QuotePrice } from '../types';
import type { BlockedInfo, HistoryEntry, HistoryKind, LotOrigin } from './report';

export interface Lot {
  id: string;
  eventId: EventId;
  openedAt: NaiveDateTime;
  origin: LotOrigin;
  counterAsset: AssetCode | null;
  qtyInitial: Big;
  costInitial: Big;
  qtyRemaining: Big;
  costRemaining: Big;
}

export interface Movement {
  eventId: EventId;
  at: NaiveDateTime;
  kind: HistoryKind;
  counterAsset: AssetCode | null;
  quotePrice: QuotePrice | null;
  feeEur: Big;
  rebateEur: Big;
  warnings: string[];
}

/** Tolérance relative pour une vente « totale » légèrement supérieure au solde (résidus). */
const OVERSELL_TOLERANCE = D('0.000001');

export class PositionState {
  readonly asset: AssetCode;
  qty: Big = ZERO;
  costBasis: Big = ZERO;
  lots: Lot[] = [];
  history: HistoryEntry[] = [];
  realized: Big = ZERO;
  otherIncome: Big = ZERO;
  investedTotal: Big = ZERO;
  proceedsTotal: Big = ZERO;
  zeroCostQty: Big = ZERO;
  feesEur: Big = ZERO;
  rebatesEur: Big = ZERO;
  blocked: BlockedInfo | null = null;
  unqualifiedCount = 0;
  warnings: string[] = [];

  constructor(asset: AssetCode) {
    this.asset = asset;
  }

  get pru(): Big | null {
    return isPositive(this.qty) ? this.costBasis.div(this.qty) : null;
  }

  /**
   * Acquisition de `qty` unités pour un coût `cost` (EUR all-in).
   * `counted` : le coût entre dans Σ acquisitions (faux pour une récompense).
   */
  acquire(qty: Big, cost: Big, origin: LotOrigin, counted: boolean, m: Movement): void {
    if (this.blocked) return;
    this.qty = this.qty.plus(qty);
    this.costBasis = this.costBasis.plus(cost);
    this.lots.push({
      id: `${m.eventId}:${this.asset}`,
      eventId: m.eventId,
      openedAt: m.at,
      origin,
      counterAsset: m.counterAsset,
      qtyInitial: qty,
      costInitial: cost,
      qtyRemaining: qty,
      costRemaining: cost,
    });
    if (counted) this.investedTotal = this.investedTotal.plus(cost);
    if (isZero(cost)) this.zeroCostQty = this.zeroCostQty.plus(qty);
    this.feesEur = this.feesEur.plus(m.feeEur);
    this.rebatesEur = this.rebatesEur.plus(m.rebateEur);
    this.history.push({
      eventId: m.eventId,
      at: m.at,
      kind: m.kind,
      qty,
      valueEur: cost,
      unitPrice: isPositive(qty) ? cost.div(qty) : null,
      counterAsset: m.counterAsset,
      quotePrice: m.quotePrice,
      feeEur: m.feeEur,
      rebateEur: m.rebateEur,
      realized: null,
      pruAfter: this.pru,
      qtyAfter: this.qty,
      warnings: m.warnings,
    });
  }

  /**
   * Cession de `qty` unités pour un produit `proceeds` (EUR net). Le PRU ne change pas ;
   * les lots sont consommés au prorata. Renvoie le coût de la cession et le réalisé,
   * ou `null` si l'inventaire est insuffisant (position bloquée).
   */
  dispose(
    requested: Big,
    proceeds: Big,
    counted: boolean,
    m: Movement,
  ): { costOfSale: Big; realized: Big } | null {
    if (this.blocked) return null;
    let qty = requested;
    const warnings = [...m.warnings];
    if (qty.gt(this.qty)) {
      const excess = qty.minus(this.qty);
      if (excess.lte(this.qty.times(OVERSELL_TOLERANCE).plus('0.000000001'))) {
        warnings.push(
          `Quantité ajustée de ${qty.toString()} à ${this.qty.toString()} (résidu d'arrondi).`,
        );
        qty = this.qty;
      } else {
        this.blocked = { eventId: m.eventId, at: m.at, deficit: excess };
        this.warnings.push(
          `Historique d'achat manquant : cession de ${qty.toString()} ${this.asset} le ${m.at} alors que ${this.qty.toString()} seulement sont détenus.`,
        );
        return null;
      }
    }
    const fullClose = qty.eq(this.qty);
    const costOfSale = fullClose ? this.costBasis : this.costBasis.times(qty).div(this.qty);
    const fraction = fullClose ? null : qty.div(this.qty);
    for (const lot of this.lots) {
      if (!isPositive(lot.qtyRemaining)) continue;
      if (fraction === null) {
        lot.qtyRemaining = ZERO;
        lot.costRemaining = ZERO;
      } else {
        lot.qtyRemaining = lot.qtyRemaining.minus(lot.qtyRemaining.times(fraction));
        lot.costRemaining = lot.costRemaining.minus(lot.costRemaining.times(fraction));
      }
    }
    const realized = proceeds.minus(costOfSale);
    this.realized = this.realized.plus(realized);
    this.costBasis = fullClose ? ZERO : this.costBasis.minus(costOfSale);
    this.qty = fullClose ? ZERO : this.qty.minus(qty);
    if (counted) this.proceedsTotal = this.proceedsTotal.plus(proceeds);
    this.feesEur = this.feesEur.plus(m.feeEur);
    this.rebatesEur = this.rebatesEur.plus(m.rebateEur);
    this.history.push({
      eventId: m.eventId,
      at: m.at,
      kind: m.kind,
      qty: qty.neg(),
      valueEur: proceeds,
      unitPrice: isPositive(qty) ? proceeds.div(qty) : null,
      counterAsset: m.counterAsset,
      quotePrice: m.quotePrice,
      feeEur: m.feeEur,
      rebateEur: m.rebateEur,
      realized,
      pruAfter: this.pru,
      qtyAfter: this.qty,
      warnings,
    });
    return { costOfSale, realized };
  }
}
