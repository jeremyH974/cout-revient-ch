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
  /**
   * Part de `value` portée au coût faute de cotation : la somme des coûts des actifs de `missing`.
   * `missing` dit **lesquels**, celui-ci dit **combien** — et c'est ce qui sépare un point approché
   * à la marge d'un point entièrement deviné. Sans lui, un seul actif marginal sans cours faisait
   * passer la journée entière pour une estimation.
   */
  estimatedValue: Big;
}

export interface ValueSeriesInput {
  holdings: Record<AssetCode, HoldingStep>;
  prices: Record<AssetCode, PriceSource>;
  days: readonly DayString[];
}

/**
 * Valeur et coût du portefeuille pour chaque jour demandé. Un actif sans prix ce jour-là prend
 * son dernier prix connu ; sans aucun prix antérieur il est compté à son coût, listé dans
 * `missing`, et son coût s'ajoute à `estimatedValue` — la part du total qui n'est pas cotée.
 */
export function valueSeries({ holdings, prices, days }: ValueSeriesInput): ValuePoint[] {
  const entries = Object.entries(holdings);
  return days.map((day) => {
    let value = ZERO;
    let cost = ZERO;
    let estimatedValue = ZERO;
    const missing: AssetCode[] = [];
    for (const [asset, step] of entries) {
      const state = step(day);
      if (state.qty.eq(ZERO)) continue;
      const point = lastPointAtOrBefore(prices[asset]?.points ?? [], day);
      if (point === null) {
        missing.push(asset);
        value = value.plus(state.cost);
        estimatedValue = estimatedValue.plus(state.cost);
      } else value = value.plus(state.qty.times(D(point.priceEur)));
      cost = cost.plus(state.cost);
    }
    return { day, value, cost, missing, estimatedValue };
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
    const estimated = price === null && state.qty.gt(ZERO);
    return {
      day,
      value: price === null ? state.cost : state.qty.times(price),
      // Un actif seul n'a rien à ventiler : sans cours, c'est la TOTALITÉ de sa valeur qui est
      // portée au coût.
      estimatedValue: estimated ? state.cost : ZERO,
      cost: state.cost,
      qty: state.qty,
      price,
      estimated,
    };
  });
}

export type Period = '1d' | '1w' | '1m' | '3m' | '1y' | 'all' | 'custom';

/**
 * Les plages, dans l'ordre où un écran les propose — **une seule liste pour toute l'application**
 * (décision n° 156).
 *
 * Il en existait trois, chacune locale à son composant : `1S/1M/3M/1A/Tout` sur la vue d'ensemble,
 * `1J/1S/1M/Tout` sur la courbe d'équité, `7 jours/30 jours/Tout` sur le résultat de trading. Deux
 * écrans ne parlaient donc pas de la même période sans que rien ne le dise. Aucun standard externe
 * ne départage ces vocabulaires — Yahoo, Robinhood et TradingView divergent tous ; l'anomalie
 * n'était pas le vocabulaire choisi, c'était d'en avoir trois.
 *
 * Sert aussi de garde à la relecture du réglage persisté : une valeur inconnue retombe au défaut.
 */
export const PRESET_PERIODS: readonly Period[] = ['1d', '1w', '1m', '3m', '1y', 'all'];

/**
 * Tout ce qu'un réglage peut porter : les presets, **plus la plage libre**. La distinction n'est
 * pas cosmétique — `custom` n'est pas une pastille comme les autres, elle ouvre deux champs de date
 * et ne veut rien dire sans eux.
 */
export const PERIODS: readonly Period[] = [...PRESET_PERIODS, 'custom'];

/** La plage retenue quand rien n'a été choisi, ou quand ce qui l'a été n'existe plus. */
export const DEFAULT_PERIOD: Period = '1m';

/**
 * Une plage d'analyse : les jours `from` à `to`, **bornes incluses** — une seule lecture pour
 * toute l'application (décision n° 179).
 *
 * `from` est le **premier jour compris**, jamais le jour de base. L'état de départ d'une fenêtre
 * est donc la clôture de la VEILLE de `from` (`openingDay`), et son état d'arrivée la clôture de
 * `to`. C'est la convention des périodes libellées : la Q&R GIPS n° 5014 écrit « du 1er mars au
 * 31 décembre » une période dont la base est la clôture du 28 février, et IAS 1 § 10 lit la
 * position « à la fin de la période », le résultat « pour la période ».
 *
 * Elle n'était pas tenue. Une présélection rangeait son jour de BASE dans `from` (« 1 semaine » =
 * huit jours de clôtures), une plage libre son PREMIER jour : les statistiques de trading
 * comptaient un jour de trop sur la première, la Vue d'ensemble oubliait la variation du premier
 * jour de la seconde.
 */
export interface DayWindow {
  /** Premier jour compris ; `null` = depuis le début (période « Tout »). */
  from: DayString | null;
  /** Dernier jour compris. */
  to: DayString;
}

/** Une plage libre, telle que l'utilisateur l'a saisie. Bornes incluses. */
export interface CustomRange {
  from: DayString;
  to: DayString;
}

/**
 * **Le seul endroit qui traduit un choix en fenêtre** (décision n° 157).
 *
 * Un `custom` sans bornes ne se rattrape pas ici : ce serait substituer une période en silence,
 * exactement ce qu'on refuse d'afficher ailleurs. L'état est rendu inatteignable en amont — la
 * relecture du réglage le normalise (`withDefaults`), et l'écran n'écrit `custom` qu'avec ses deux
 * dates. Le repli sur `all` est donc une ceinture pour un cas qui ne doit pas arriver, pas un
 * comportement sur lequel on s'appuie.
 */
export function resolveWindow(
  period: Period,
  custom: CustomRange | null,
  toDay: DayString,
): DayWindow {
  if (period !== 'custom') return periodWindow(period, toDay);
  if (custom === null) return { from: null, to: toDay };
  // Saisie inversée : on la lit dans l'ordre plutôt que de rendre une fenêtre vide, qui donnerait
  // « aucune donnée » là où l'utilisateur a simplement rempli les deux champs à l'envers.
  return custom.from <= custom.to
    ? { from: custom.from, to: custom.to }
    : { from: custom.to, to: custom.from };
}

/**
 * Bornes d'une période se terminant à `toDay` (mois et années calendaires, UTC).
 *
 * Le PREMIER JOUR COMPRIS est le lendemain du jour de base : « 1 mois » au 31 mars couvre du
 * 1er au 31 mars, sa base étant la clôture du 28 février. La courbe et le bandeau n'en bougent
 * pas — ils lisent la série depuis `openingDay`, donc depuis la même clôture qu'avant.
 */
export function periodWindow(period: Period, toDay: DayString): DayWindow {
  const after = (base: DayString): DayWindow => ({ from: addDays(base, 1), to: toDay });
  switch (period) {
    case 'custom':
      // Une plage libre n'a pas de bornes déductibles : `resolveWindow` est la porte d'entrée.
      return { from: null, to: toDay };
    case '1d':
      return after(addDays(toDay, -1));
    case '1w':
      return after(addDays(toDay, -7));
    case '1m':
      return after(addMonths(toDay, -1));
    case '3m':
      return after(addMonths(toDay, -3));
    case '1y':
      return after(addMonths(toDay, -12));
    case 'all':
      return { from: null, to: toDay };
  }
}

/** Le jour dont la clôture ouvre la fenêtre : la veille de `from` ; `null` depuis l'origine. */
export function openingDay(window: DayWindow): DayString | null {
  return window.from === null ? null : addDays(window.from, -1);
}

/**
 * La série d'une fenêtre, **point d'ouverture compris** : la clôture de la veille de `from`, sans
 * laquelle la variation du premier jour n'aurait pas de base. C'est ce que lisent la courbe et le
 * bandeau de la Vue d'ensemble, la carte Évolution et le rendement pondéré par le temps du
 * Rapport — un seul découpage, donc une seule période affichée.
 */
export function windowSeries<T extends { day: DayString }>(
  series: readonly T[],
  window: DayWindow,
): T[] {
  return sliceSeries(series, { from: openingDay(window), to: window.to });
}

/** Restreint une série (triée) aux jours `from` à `to`, bornes incluses. */
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
