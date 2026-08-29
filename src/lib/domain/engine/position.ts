/**
 * État d'une position (un actif) : coût moyen pondéré (CUMP) invariant à la vente,
 * lots par acquisition consommés au prorata, compteurs réalisé / investi / produits.
 */
import { D, ZERO, isPositive, isZero, type Big } from '../money';
import type { AccountId, AssetCode, EventId, NaiveDateTime, QuotePrice, RowKey } from '../types';
import type { BlockedInfo, HistoryEntry, HistoryKind, LotConsumption, LotOrigin } from './report';

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
  /** Lignes brutes de l'événement : recopiées telles quelles dans l'historique. */
  rowKeys: readonly RowKey[];
  accountId: AccountId;
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
  /**
   * Capital maximal engagé : le plus haut niveau atteint par `investedTotal − proceedsTotal`.
   * Dénominateur du ROI : « pour 1 € au plus mobilisé sur cet actif… », insensible aux
   * allers-retours (vendre puis racheter n'augmente pas la base).
   */
  engagedMax: Big = ZERO;
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

  /** À appeler après toute variation comptée d'achats/produits (y compris un transfert). */
  noteEngaged(): void {
    const engaged = this.investedTotal.minus(this.proceedsTotal);
    if (engaged.gt(this.engagedMax)) this.engagedMax = engaged;
  }

  /**
   * Acquisition de `qty` unités pour un coût `cost` (EUR all-in).
   * `counted` : le coût entre dans Σ acquisitions (faux pour une récompense).
   */
  acquire(qty: Big, cost: Big, origin: LotOrigin, counted: boolean, m: Movement): boolean {
    if (this.blocked) return false;
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
    if (counted) {
      this.investedTotal = this.investedTotal.plus(cost);
      this.noteEngaged();
    }
    if (isZero(cost)) this.zeroCostQty = this.zeroCostQty.plus(qty);
    this.feesEur = this.feesEur.plus(m.feeEur);
    this.rebatesEur = this.rebatesEur.plus(m.rebateEur);
    this.history.push({
      eventId: m.eventId,
      rowKeys: m.rowKeys,
      accountId: m.accountId,
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
      lotsConsumed: [],
      pruAfter: this.pru,
      qtyAfter: this.qty,
      warnings: m.warnings,
    });
    return true;
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
      // Tolérance de résidu seulement sur une position réellement détenue : vendre un actif
      // jamais acheté, même une poussière, est un historique manquant, pas un arrondi.
      if (
        isPositive(this.qty) &&
        excess.lte(this.qty.times(OVERSELL_TOLERANCE).plus('0.000000001'))
      ) {
        warnings.push(
          `Quantité ajustée de ${qty.toString()} à ${this.qty.toString()} (résidu d'arrondi).`,
        );
        qty = this.qty;
      } else {
        this.blocked = { eventId: m.eventId, at: m.at, deficit: excess };
        this.history.push({
          eventId: m.eventId,
          rowKeys: m.rowKeys,
          accountId: m.accountId,
          at: m.at,
          kind: m.kind,
          qty: requested.neg(),
          valueEur: proceeds,
          unitPrice: isPositive(requested) ? proceeds.div(requested) : null,
          counterAsset: m.counterAsset,
          quotePrice: m.quotePrice,
          feeEur: m.feeEur,
          rebateEur: m.rebateEur,
          realized: null,
          lotsConsumed: [],
          pruAfter: this.pru,
          qtyAfter: this.qty,
          warnings: [...warnings, 'Opération bloquée : historique d’achat manquant.'],
        });
        this.warnings.push(
          `Historique d'achat manquant : cession de ${qty.toString()} ${this.asset} le ${m.at} alors que ${this.qty.toString()} seulement sont détenus.`,
        );
        return null;
      }
    }
    const fullClose = qty.eq(this.qty);
    const costOfSale = fullClose ? this.costBasis : this.costBasis.times(qty).div(this.qty);
    const fraction = fullClose ? null : qty.div(this.qty);
    // La part prise à chaque lot est déjà calculée ici : la consigner ne coûte rien et c'est la
    // seule façon de répondre plus tard à « quels achats ont payé cette vente ? ».
    const lotsConsumed: LotConsumption[] = [];
    for (const lot of this.lots) {
      if (!isPositive(lot.qtyRemaining)) continue;
      const takenQty = fraction === null ? lot.qtyRemaining : lot.qtyRemaining.times(fraction);
      const takenCost = fraction === null ? lot.costRemaining : lot.costRemaining.times(fraction);
      lotsConsumed.push({
        lotId: lot.id,
        eventId: lot.eventId,
        openedAt: lot.openedAt,
        origin: lot.origin,
        qty: takenQty,
        cost: takenCost,
      });
      if (fraction === null) {
        lot.qtyRemaining = ZERO;
        lot.costRemaining = ZERO;
      } else {
        lot.qtyRemaining = lot.qtyRemaining.minus(takenQty);
        lot.costRemaining = lot.costRemaining.minus(takenCost);
      }
    }
    const realized = proceeds.minus(costOfSale);
    this.realized = this.realized.plus(realized);
    this.costBasis = fullClose ? ZERO : this.costBasis.minus(costOfSale);
    this.qty = fullClose ? ZERO : this.qty.minus(qty);
    if (counted) {
      this.proceedsTotal = this.proceedsTotal.plus(proceeds);
      this.noteEngaged();
    }
    this.feesEur = this.feesEur.plus(m.feeEur);
    this.rebatesEur = this.rebatesEur.plus(m.rebateEur);
    this.history.push({
      eventId: m.eventId,
      rowKeys: m.rowKeys,
      accountId: m.accountId,
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
      lotsConsumed,
      pruAfter: this.pru,
      qtyAfter: this.qty,
      warnings,
    });
    return { costOfSale, realized };
  }
}
