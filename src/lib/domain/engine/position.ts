/**
 * État d'une position (un actif) : coût moyen pondéré (CUMP) invariant à la vente,
 * lots par acquisition consommés au prorata, compteurs réalisé / investi / produits.
 */
import { D, ZERO, isPositive, isZero, type Big } from '../money';
import type { AccountId, AssetCode, EventId, NaiveDateTime, QuotePrice, RowKey } from '../types';
import type { BlockedInfo, HistoryEntry, HistoryKind, LotConsumption, LotOrigin } from './report';

/**
 * Décimales conservées sur la part prise à un lot (décision n° 87).
 *
 * Dix-huit, parce que c'est la précision du wei — l'unité la plus fine de tout l'écosystème, quand
 * le satoshi n'en demande que huit. Au-delà, ce ne sont plus des chiffres significatifs : c'est un
 * artefact de division. `fraction` porte les 30 décimales de `Big.DP`, et `times` est **exact**,
 * donc sans borne les chiffres s'additionnent à CHAQUE cession — la précision croît en O(n), et
 * c'est elle qui rendait le moteur cubique (décision n° 85, 12,3 s pour 400 opérations).
 *
 * Borner ici est sans effet sur le moindre chiffre financier : `this.qty` et `this.costBasis` sont
 * tenus indépendamment des lots, et le PRU comme le coût de cession en dérivent. Les lots ne
 * portent que la trace « quels achats ont payé cette vente ? » et l'affichage par lot.
 */
const LOT_DP = 18;

/** L'arrondi suit `Big.RM`, réglé une fois pour toutes en banquier dans `money.ts`. */
const roundLot = (value: Big): Big => value.round(LOT_DP);

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
  /**
   * Nombre d'acquisitions que ce lot représente — **1** pour un lot ordinaire (décision n° 152).
   *
   * Au-delà de `MAX_TRACKED_LOTS`, les plus anciens sont regroupés. Ce compteur existe pour que le
   * regroupement soit **dit**, jamais subi en silence : un écran qui montrerait un lot de 1 234
   * achats comme s'il en était un seul mentirait sur ce qu'il affiche.
   */
  mergedCount: number;
}

/**
 * Combien de lots une position suit **individuellement** (décision n° 152).
 *
 * ## Pourquoi une borne
 *
 * La méthode proportionnelle prend une part de **chaque** lot ouvert à chaque cession, et n'en
 * épuise aucun : le coût d'un grand livre est donc `achats × cessions`. Mesuré : 3,0 s pour
 * 1 600 opérations, **11,3 s** pour 3 200. C'est ce quadratique, et non le fil d'exécution, qui
 * bornait l'outil (décision n° 151).
 *
 * ## Pourquoi c'est sans effet sur le moindre chiffre
 *
 * Les montants ne dépendent pas des lots : `qty` et `costBasis` sont tenus à part, et le coût de
 * cession en dérive (`costBasis × qty / this.qty`). Les lots ne portent que la **trace** — quels
 * achats ont payé cette vente — et l'affichage par lot. Et comme la méthode prend la même
 * fraction de chacun, regrouper deux lots puis prendre la fraction du regroupement donne la même
 * somme que prendre la fraction de chacun : **les invariants sont préservés par construction**,
 * pas par tolérance.
 *
 * ## Pourquoi 200
 *
 * Un versement programmé hebdomadaire pendant trois ans fait 156 lots : la borne ne doit pas mordre
 * sur un usage ordinaire. Au-delà, la décomposition d'une seule vente dépasse deux cents lignes et
 * cesse d'être lisible — le regroupement ne retire donc rien qu'un lecteur pouvait exploiter.
 */
export const MAX_TRACKED_LOTS = 200;

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

  /**
   * Regroupe les lots les plus anciens tant que la position en suit plus que `MAX_TRACKED_LOTS`.
   *
   * **Deux lots ne se regroupent que s'ils partagent leur origine**, et qu'ils se suivent. L'origine
   * n'est pas décorative : la trace s'en sert pour signaler un coût repris d'une migration ou une
   * récompense valorisée à zéro (`migrationMode`, `rewardValuation`). Fondre un achat et une
   * récompense dans un même lot ferait disparaître cet avertissement — le regroupement doit coûter
   * du **détail**, jamais un **signal**.
   *
   * Les sommes sont exactes par construction : additionner deux quantités puis en prendre une
   * fraction, ou prendre la fraction de chacune puis additionner, donne le même total. L'égalité
   * `Σ lots = quantité` que contrôle l'auto-vérification reste donc vraie à l'exactitude, pas à la
   * tolérance.
   *
   * Si aucune paire voisine ne partage son origine — un portefeuille qui alternerait achat et
   * récompense à chaque opération —, rien n'est regroupé et la borne est dépassée. C'est assumé :
   * mieux vaut un calcul lent qu'une trace qui ment.
   */
  private compactLots(): void {
    while (this.lots.length > MAX_TRACKED_LOTS) {
      const at = this.lots.findIndex((lot, i) => i > 0 && lot.origin === this.lots[i - 1]!.origin);
      if (at === -1) return;
      const older = this.lots[at - 1]!;
      const newer = this.lots[at]!;
      older.qtyInitial = older.qtyInitial.plus(newer.qtyInitial);
      older.costInitial = older.costInitial.plus(newer.costInitial);
      older.qtyRemaining = older.qtyRemaining.plus(newer.qtyRemaining);
      older.costRemaining = older.costRemaining.plus(newer.costRemaining);
      // Deux contreparties différentes n'en font aucune : mieux vaut ne rien dire que d'affirmer
      // que tout le regroupement a été payé dans la devise du premier.
      if (older.counterAsset !== newer.counterAsset) older.counterAsset = null;
      older.mergedCount += newer.mergedCount;
      this.lots.splice(at, 1);
    }
  }

  /** À appeler après toute variation comptée d'achats/produits (y compris un transfert). */
  noteEngaged(): void {
    const engaged = this.investedTotal.minus(this.proceedsTotal);
    if (engaged.gt(this.engagedMax)) this.engagedMax = engaged;
  }

  /**
   * Fractionnement d'action : la quantité est multipliée, **le coût ne bouge pas**. C'est la
   * seule opération du moteur qui réécrit des lots existants sans rien acquérir ni céder — le
   * prix de revient unitaire est divisé d'autant, et aucune plus-value n'est réalisée.
   *
   * Les lots sont modifiés en place plutôt que remplacés : une action détenue depuis deux ans
   * le reste après un fractionnement, et sa date d'acquisition avec elle.
   */
  split(ratio: Big, m: Movement): void {
    if (this.blocked) return;
    const before = this.qty;
    this.qty = roundLot(this.qty.times(ratio));
    for (const lot of this.lots) {
      lot.qtyInitial = roundLot(lot.qtyInitial.times(ratio));
      lot.qtyRemaining = roundLot(lot.qtyRemaining.times(ratio));
    }
    this.history.push({
      eventId: m.eventId,
      rowKeys: m.rowKeys,
      accountId: m.accountId,
      at: m.at,
      kind: 'split',
      qty: this.qty.minus(before),
      valueEur: null,
      unitPrice: null,
      counterAsset: null,
      quotePrice: null,
      feeEur: ZERO,
      rebateEur: ZERO,
      lotsConsumed: [],
      warnings: m.warnings,
      realized: ZERO,
      pruAfter: this.pru,
      qtyAfter: this.qty,
    });
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
      mergedCount: 1,
    });
    this.compactLots();
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
    const eligible = this.lots.filter((lot) => isPositive(lot.qtyRemaining));
    const taken = eligible.map((lot) =>
      fraction === null
        ? { qty: lot.qtyRemaining, cost: lot.costRemaining }
        : {
            qty: roundLot(lot.qtyRemaining.times(fraction)),
            cost: roundLot(lot.costRemaining.times(fraction)),
          },
    );
    // Le résidu d'arrondi va au PLUS GROS lot consommé, pour que les sommes soient exactes par
    // construction plutôt que par tolérance. Au plus gros et non au dernier : sa part dépasse la
    // somme des arrondis de plusieurs ordres de grandeur, donc il ne peut pas passer sous zéro.
    if (fraction !== null && taken.length > 0) {
      let biggest = 0;
      for (let i = 1; i < taken.length; i++) if (taken[i]!.qty.gt(taken[biggest]!.qty)) biggest = i;
      const sumQty = taken.reduce((acc, t) => acc.plus(t.qty), ZERO);
      const sumCost = taken.reduce((acc, t) => acc.plus(t.cost), ZERO);
      taken[biggest] = {
        qty: taken[biggest]!.qty.plus(qty.minus(sumQty)),
        cost: taken[biggest]!.cost.plus(costOfSale.minus(sumCost)),
      };
    }
    for (let i = 0; i < eligible.length; i++) {
      const lot = eligible[i]!;
      const { qty: takenQty, cost: takenCost } = taken[i]!;
      lotsConsumed.push({
        lotId: lot.id,
        eventId: lot.eventId,
        openedAt: lot.openedAt,
        origin: lot.origin,
        qty: takenQty,
        cost: takenCost,
        mergedCount: lot.mergedCount,
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
