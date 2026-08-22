/**
 * Fonctions pures pour les graphiques « Évolution » : positions en escalier, série de valeur
 * (Σ quantité × prix du jour), fenêtres de période, performance hors apports, extrêmes et
 * sous-échantillonnage LTTB. Montants en `Big`, jours `YYYY-MM-DD` en UTC.
 */
import { Big, D, ZERO } from '../domain/money';
import type { AssetCode, NaiveDateTime } from '../domain/types';
import { numberToDecimal } from '../pricing/types';
import { addDays, addMonths, dayOfNaive } from './days';
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

export interface PriceSource {
  points: readonly DailyPoint[];
}

export interface ValuePoint {
  day: DayString;
  value: Big;
  cost: Big;
  /** Actifs détenus ce jour mais sans aucun prix connu (exclus de `value` et de `cost`). */
  missing: AssetCode[];
}

export interface ValueSeriesInput {
  holdings: Record<AssetCode, HoldingStep>;
  prices: Record<AssetCode, PriceSource>;
  days: readonly DayString[];
}

/**
 * Valeur et coût du portefeuille pour chaque jour demandé. Un actif sans prix ce jour-là prend
 * son dernier prix connu ; sans aucun prix antérieur il est exclu et listé dans `missing`.
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
        continue;
      }
      value = value.plus(state.qty.times(D(point.priceEur)));
      cost = cost.plus(state.cost);
    }
    return { day, value, cost, missing };
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
  /** Valeur fin − valeur début − apports nets. */
  gain: Big;
  /** `gain ÷ (valeur début + apports nets)`, ratio (0.1 = +10 %) ; `null` si la base ≤ 0. */
  pct: Big | null;
}

/**
 * Performance d'une période hors apports (Dietz simple, non pondéré dans le temps). Le premier
 * point de la série est l'état de départ : ses propres flux sont déjà dans `startValue`. Pour
 * « Tout », démarrer la série la veille de la première opération (valeur 0).
 */
export function periodPerformance(
  series: readonly ValuePoint[],
  flows: readonly FlowPoint[],
): PeriodPerformance | null {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return null;
  let netFlows = ZERO;
  for (const flow of flows) {
    if (flow.day > first.day && flow.day <= last.day) netFlows = netFlows.plus(flow.amountEur);
  }
  const gain = last.value.minus(first.value).minus(netFlows);
  const base = first.value.plus(netFlows);
  return {
    from: first.day,
    to: last.day,
    startValue: first.value,
    endValue: last.value,
    netFlows,
    gain,
    pct: base.gt(ZERO) ? gain.div(base) : null,
  };
}

export function minMax<T extends { value: Big }>(series: readonly T[]): { min: T; max: T } | null {
  let min: T | null = null;
  let max: T | null = null;
  for (const point of series) {
    if (min === null || point.value.lt(min.value)) min = point;
    if (max === null || point.value.gt(max.value)) max = point;
  }
  return min && max ? { min, max } : null;
}

/** Entier (index) → Big, sans passer un `number` à big.js (mode strict). */
function bigIndex(value: number): Big {
  return D(numberToDecimal(value) ?? '0');
}

/**
 * Sous-échantillonnage LTTB (Largest-Triangle-Three-Buckets) : conserve le premier et le
 * dernier point et, dans chaque seau, le point formant le plus grand triangle avec le point
 * retenu précédent et la moyenne du seau suivant. Les aires sont calculées en `Big` (mises à
 * l'échelle par la taille du seau suivant pour rester entières sur l'axe des index).
 */
export function downsample<T extends { value: Big }>(series: readonly T[], maxPoints: number): T[] {
  if (series.length <= maxPoints || series.length <= 2) return [...series];
  if (maxPoints < 3) return [series[0]!, series[series.length - 1]!];
  const bucketSize = (series.length - 2) / (maxPoints - 2);
  const sampled: T[] = [series[0]!];
  let selected = 0;
  for (let bucket = 0; bucket < maxPoints - 2; bucket++) {
    const nextStart = Math.floor((bucket + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((bucket + 2) * bucketSize) + 1, series.length);
    const count = nextEnd - nextStart;
    let sumX = 0;
    let sumY = ZERO;
    for (let j = nextStart; j < nextEnd; j++) {
      sumX += j;
      sumY = sumY.plus(series[j]!.value);
    }
    const anchorY = series[selected]!.value;
    const dx = bigIndex(selected * count - sumX);
    const dy = sumY.minus(anchorY.times(bigIndex(count)));
    const start = Math.floor(bucket * bucketSize) + 1;
    const end = Math.min(Math.floor((bucket + 1) * bucketSize) + 1, series.length);
    let best = start;
    let bestArea: Big | null = null;
    for (let j = start; j < end; j++) {
      const area = dx
        .times(series[j]!.value.minus(anchorY))
        .minus(bigIndex(selected - j).times(dy))
        .abs();
      if (bestArea === null || area.gt(bestArea)) {
        bestArea = area;
        best = j;
      }
    }
    sampled.push(series[best]!);
    selected = best;
  }
  sampled.push(series[series.length - 1]!);
  return sampled;
}
