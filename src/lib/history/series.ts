/**
 * Fonctions pures pour les graphiques « Évolution » : positions en escalier, série de valeur
 * (Σ quantité × prix du jour), points de métrique d'un actif, fenêtres de période et performance
 * hors apports (Dietz modifié). Montants en `Big`, jours `YYYY-MM-DD` en UTC.
 */
import { Big, D, ZERO } from '../domain/money';
import type { AssetCode, DecimalString, EventId, NaiveDateTime } from '../domain/types';
import { numberToDecimal } from '../pricing/types';
import { addDays, addMonths, dayOfNaive, pointMs } from './days';
import type { MetricPoint } from './metrics';
import type { DailyPoint, DayString } from './types';

/** Ligne d'historique d'un actif après une opération (compatible `HistoryEntry` du moteur). */
export interface HoldingOp {
  at: NaiveDateTime;
  qtyAfter: Big;
  pruAfter: Big | null;
}

export interface HoldingState {
  qty: Big;
  /** Coût des unités détenues = PRU × quantité (0 si le PRU est inconnu). */
  cost: Big;
}

/** Fonction en escalier : état de la position à la fin du jour demandé. */
export type HoldingStep = (day: DayString) => HoldingState;

const EMPTY_STATE: HoldingState = { qty: ZERO, cost: ZERO };

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Escalier d'un actif : état après la dernière opération dont le jour ≤ jour demandé. */
export function holdingStep(ops: readonly HoldingOp[]): HoldingStep {
  const sorted = [...ops].sort((a, b) => compareStrings(a.at, b.at));
  const days = sorted.map((op) => dayOfNaive(op.at));
  const states: HoldingState[] = sorted.map((op) => ({
    qty: op.qtyAfter,
    cost: op.pruAfter ? op.pruAfter.times(op.qtyAfter) : ZERO,
  }));
  return (day) => {
    let low = 0;
    let high = days.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (days[mid]! <= day) {
        found = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    return found === -1 ? EMPTY_STATE : states[found]!;
  };
}

/**
 * Historique d'une position → opérations pour l'escalier, **jambe sortante des virements internes
 * appariés retirée**. Sans ce filtre, un virement à cheval sur deux jours (retrait 23 h 30 lundi,
 * dépôt 1 h 00 mercredi) sort l'actif du portefeuille consolidé pendant deux jours : la courbe de
 * valeur tombe à zéro puis revient, alors que les coins n'ont jamais quitté le patrimoine. On
 * garde la jambe ENTRANTE (elle porte la quantité réellement reçue, frais de réseau déduits) et on
 * jette la sortante : la position reste détenue pendant le transit, et le solde final est juste.
 * Ne s'applique qu'aux vues consolidées ; dans la vue par compte, un virement est un vrai
 * mouvement des deux côtés.
 */
export function holdingOpsOf(
  history: readonly (HoldingOp & { eventId: EventId })[],
  internalTransferLegs: Readonly<Record<EventId, 'out' | 'in'>>,
): HoldingOp[] {
  return history
    .filter((entry) => internalTransferLegs[entry.eventId] !== 'out')
    .map(({ at, qtyAfter, pruAfter }) => ({ at, qtyAfter, pruAfter }));
}

export function holdingsByDay(
  ops: Record<AssetCode, readonly HoldingOp[]>,
): Record<AssetCode, HoldingStep> {
  const steps: Record<AssetCode, HoldingStep> = {};
  for (const [asset, list] of Object.entries(ops)) steps[asset] = holdingStep(list);
  return steps;
}

/** Dernier point dont le jour ≤ `day` (points triés par jour croissant), sinon `null`. */
export function lastPointAtOrBefore(
  points: readonly DailyPoint[],
  day: DayString,
): DailyPoint | null {
  let low = 0;
  let high = points.length - 1;
  let found: DailyPoint | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const point = points[mid]!;
    if (point.day <= day) {
      found = point;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/**
 * Remplace (ou ajoute) le point du jour `day` par une cotation plus fraîche que la clôture
 * provisoire du fournisseur (prix « live » de l'application). Les points restent triés.
 */
export function mergeLivePoint(
  points: readonly DailyPoint[],
  day: DayString,
  priceEur: DecimalString,
): DailyPoint[] {
  return [
    ...points.filter((p) => p.day < day),
    { day, priceEur },
    ...points.filter((p) => p.day > day),
  ];
}

export interface PriceSource {
  points: readonly DailyPoint[];
}

export interface ValuePoint {
  day: DayString;
  value: Big;
  cost: Big;
  /**
   * Actifs détenus ce jour sans aucun prix connu (≤ jour). Ils sont valorisés à leur coût
   * (latent nul) plutôt qu'exclus : la valeur reste ainsi comparable aux apports (performance
   * hors apports juste dès que le prix apparaît) et la courbe ne tombe jamais à zéro face à un
   * investi plein. Le graphique signale ces points comme estimés.
   */
  missing: AssetCode[];
}

export interface ValueSeriesInput {
  holdings: Record<AssetCode, HoldingStep>;
  prices: Record<AssetCode, PriceSource>;
  days: readonly DayString[];
}

/**
 * Valeur et coût du portefeuille pour chaque jour demandé. Un actif sans prix ce jour-là prend
 * son dernier prix connu ; sans aucun prix antérieur il est compté à son coût et listé dans
 * `missing`.
 */
export function valueSeries({ holdings, prices, days }: ValueSeriesInput): ValuePoint[] {
  const entries = Object.entries(holdings);
  return days.map((day) => {
    let value = ZERO;
    let cost = ZERO;
    const missing: AssetCode[] = [];
    for (const [asset, step] of entries) {
      const state = step(day);
      if (state.qty.eq(ZERO)) continue;
      const point = lastPointAtOrBefore(prices[asset]?.points ?? [], day);
      if (point === null) {
        missing.push(asset);
        value = value.plus(state.cost);
      } else value = value.plus(state.qty.times(D(point.priceEur)));
      cost = cost.plus(state.cost);
    }
    return { day, value, cost, missing };
  });
}

export interface AssetSeriesInput {
  step: HoldingStep;
  points: readonly DailyPoint[];
  days: readonly DayString[];
}

/**
 * Points de métrique d'un actif : quantité, coût, prix du jour (dernier connu) et valeur. Sans
 * aucun prix connu, une position ouverte est valorisée à son coût et marquée `estimated` (même
 * règle que `valueSeries`) ; la métrique « PRU vs prix » ignore ces points (`price` null).
 */
export function assetMetricPoints({ step, points, days }: AssetSeriesInput): MetricPoint[] {
  return days.map((day) => {
    const state = step(day);
    const point = lastPointAtOrBefore(points, day);
    const price = point === null ? null : D(point.priceEur);
    return {
      day,
      value: price === null ? state.cost : state.qty.times(price),
      cost: state.cost,
      qty: state.qty,
      price,
      estimated: price === null && state.qty.gt(ZERO),
    };
  });
}

export type Period = '1d' | '1w' | '1m' | '3m' | '1y' | 'all';

export interface DayWindow {
  /** `null` = depuis le début (période « Tout »). */
  from: DayString | null;
  to: DayString;
}

/** Bornes d'une période se terminant à `toDay` (mois et années calendaires, UTC). */
export function periodWindow(period: Period, toDay: DayString): DayWindow {
  switch (period) {
    case '1d':
      return { from: addDays(toDay, -1), to: toDay };
    case '1w':
      return { from: addDays(toDay, -7), to: toDay };
    case '1m':
      return { from: addMonths(toDay, -1), to: toDay };
    case '3m':
      return { from: addMonths(toDay, -3), to: toDay };
    case '1y':
      return { from: addMonths(toDay, -12), to: toDay };
    case 'all':
      return { from: null, to: toDay };
  }
}

/** Restreint une série (triée) à une fenêtre. */
export function sliceSeries<T extends { day: DayString }>(
  series: readonly T[],
  window: DayWindow,
): T[] {
  return series.filter(
    (point) => (window.from === null || point.day >= window.from) && point.day <= window.to,
  );
}

/** Flux de trésorerie : positif = apport (achat en euros), négatif = retrait (vente en euros). */
export interface FlowPoint {
  day: DayString;
  amountEur: Big;
}

export interface PeriodPerformance {
  from: DayString;
  to: DayString;
  startValue: Big;
  endValue: Big;
  /** Apports nets strictement après `from` et jusqu'à `to` inclus. */
  netFlows: Big;
  /** Apports pondérés par la fraction de période restant après chacun (Dietz modifié). */
  weightedFlows: Big;
  /** Valeur fin − valeur début − apports nets. */
  gain: Big;
  /** `gain ÷ (valeur début + apports pondérés)`, ratio (0.1 = +10 %) ; `null` si la base ≤ 0. */
  pct: Big | null;
}

/** Entier (index, millisecondes) → Big, sans passer un `number` à big.js (mode strict). */
function bigInt(value: number): Big {
  return D(numberToDecimal(value) ?? '0');
}

/**
 * Performance d'une période hors apports, méthode de Dietz modifiée : chaque flux pèse dans le
 * capital moyen au prorata du temps qu'il lui reste jusqu'à la fin de la période (un apport le
 * dernier jour ne pèse rien, un apport le lendemain du départ pèse presque entièrement). Le
 * premier point de la série est l'état de départ : ses propres flux sont déjà dans `startValue`.
 * Pour « Tout », démarrer la série la veille de la première opération (valeur 0).
 */
export function periodPerformance(
  series: readonly ValuePoint[],
  flows: readonly FlowPoint[],
): PeriodPerformance | null {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return null;
  const endMs = pointMs(last.day);
  const spanMs = endMs - pointMs(first.day);
  let netFlows = ZERO;
  let weightedFlows = ZERO;
  for (const flow of flows) {
    if (flow.day <= first.day || flow.day > last.day) continue;
    netFlows = netFlows.plus(flow.amountEur);
    if (spanMs > 0) {
      const remainingMs = endMs - pointMs(flow.day);
      weightedFlows = weightedFlows.plus(
        flow.amountEur.times(bigInt(remainingMs)).div(bigInt(spanMs)),
      );
    }
  }
  const gain = last.value.minus(first.value).minus(netFlows);
  const base = first.value.plus(weightedFlows);
  return {
    from: first.day,
    to: last.day,
    startValue: first.value,
    endValue: last.value,
    netFlows,
    weightedFlows,
    gain,
    pct: base.gt(ZERO) ? gain.div(base) : null,
  };
}
