/**
 * Statistiques de performance (P22) sur les aller-retours journalisés : espérance (devise et R),
 * taux de réussite, profit factor, gains/pertes moyens, drawdown maximal du P&L cumulé, séries,
 * ventilations. Standards de praticiens (Van Tharp, Edgewonk, TradesViz) — jamais présentés comme
 * prédictifs : `smallSample` impose l'avertissement sous 30 trades clos. Les montants passent par
 * `toDisplay` (conversion de devise par l'appelant) ; un trade non convertible est compté à part
 * (`excluded`) plutôt que sommé dans la mauvaise devise. Pur, `big.js` seulement.
 */
import { epochDayOf, weekdayMondayFirst } from '../date';
import { D, ZERO, divOrNull, type Big } from '../money';
import type { JournaledTrip } from './journal';

/** En dessous de ce nombre de trades clos, l'échantillon ne permet aucune conclusion. */
export const MIN_SAMPLE = 30;

export type ToDisplay = (trip: JournaledTrip, value: Big) => Big | null;
const identity: ToDisplay = (_trip, value) => value;

/**
 * Fenêtre de jours (`YYYY-MM-DD`), bornes incluses ; `from: null` = depuis le début. Même forme
 * que le `DayWindow` de `$lib/history`, redéclarée ici parce que le moteur ne dépend d'aucune
 * autre couche : c'est l'écran qui produit la fenêtre depuis le sélecteur de période.
 */
export interface DayWindow {
  from: string | null;
  to: string;
}

/**
 * Restreint les aller-retours à une fenêtre : seuls sont retenus ceux **clos dans la fenêtre**,
 * datés de leur jour de clôture (heure de Paris). Une fenêtre ouverte à gauche (`from: null`,
 * période « Tout ») ne filtre rien — les positions encore ouvertes, qui n'ont pas de jour de
 * clôture, ne sont donc retenues que par elle.
 *
 * Dater un aller-retour de sa clôture ne contredit pas la décision n° 35 (un montant réalisé est
 * daté du jour où il l'a été) : l'unité mesurée ici est l'aller-retour, indivisible, et les écrans
 * le disent — « trades clos ». Le calendrier garde sa maille d'événements ; les deux totaux
 * peuvent donc légitimement différer sur une fenêtre courte (décision n° 95).
 */
export function tripsClosedIn(
  trips: readonly JournaledTrip[],
  window: DayWindow,
): readonly JournaledTrip[] {
  const { from, to } = window;
  if (from === null) return trips;
  return trips.filter((t) => {
    const day = t.trip.closedAt?.slice(0, 10) ?? null;
    return day !== null && day >= from && day <= to;
  });
}

export interface TradingStats {
  total: number;
  closed: number;
  open: number;
  incomplete: number;
  /** Trades clos non convertibles dans la devise d'affichage (exclus des sommes en devise). */
  excluded: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** wins ÷ (wins + losses). */
  winRate: Big | null;
  /** Σ gains ÷ |Σ pertes|. */
  profitFactor: Big | null;
  /** P&L net moyen par trade clos (devise d'affichage). */
  expectancy: Big | null;
  /** R moyen sur les trades qui ont un risque connu. */
  expectancyR: Big | null;
  nR: number;
  avgWin: Big | null;
  avgLoss: Big | null;
  /** avgWin ÷ |avgLoss| (« payoff ratio »). */
  payoff: Big | null;
  best: Big | null;
  worst: Big | null;
  netTotal: Big;
  grossTotal: Big;
  feesTotal: Big;
  fundingTotal: Big;
  /** Pire creux du P&L net cumulé, trades clos dans l'ordre chronologique. */
  maxDrawdown: Big | null;
  longestWinStreak: number;
  longestLossStreak: number;
  avgHoldSeconds: number | null;
  smallSample: boolean;
}

export function computeStats(
  trips: readonly JournaledTrip[],
  toDisplay: ToDisplay = identity,
): TradingStats {
  const closedTrips = trips
    .filter((t) => t.trip.status === 'closed')
    .sort((a, b) => (a.trip.closedTime ?? 0) - (b.trip.closedTime ?? 0));
  let excluded = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let gains = ZERO;
  let losing = ZERO;
  let netTotal = ZERO;
  let grossTotal = ZERO;
  let feesTotal = ZERO;
  let fundingTotal = ZERO;
  let best: Big | null = null;
  let worst: Big | null = null;
  let cumulative = ZERO;
  let peak = ZERO;
  let maxDrawdown = ZERO;
  let rSum = ZERO;
  let nR = 0;
  let winStreak = 0;
  let lossStreak = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let holdSum = 0;
  let holdCount = 0;
  let converted = 0;

  for (const t of closedTrips) {
    // Signes et séries : sur le P&L natif (invariants de devise) ; sommes : converties.
    const native = t.trip.netPnl;
    if (native.gt(ZERO)) {
      wins++;
      winStreak++;
      lossStreak = 0;
      longestWinStreak = Math.max(longestWinStreak, winStreak);
    } else if (native.lt(ZERO)) {
      losses++;
      lossStreak++;
      winStreak = 0;
      longestLossStreak = Math.max(longestLossStreak, lossStreak);
    } else {
      breakeven++;
      winStreak = 0;
      lossStreak = 0;
    }
    if (t.r !== null) {
      rSum = rSum.plus(t.r);
      nR++;
    }
    if (t.trip.holdSeconds !== null) {
      holdSum += t.trip.holdSeconds;
      holdCount++;
    }
    const net = toDisplay(t, t.trip.netPnl);
    if (net === null) {
      excluded++;
      continue;
    }
    converted++;
    netTotal = netTotal.plus(net);
    grossTotal = grossTotal.plus(toDisplay(t, t.trip.grossPnl) ?? ZERO);
    feesTotal = feesTotal.plus(toDisplay(t, t.trip.fees) ?? ZERO);
    fundingTotal = fundingTotal.plus(toDisplay(t, t.trip.funding) ?? ZERO);
    if (net.gt(ZERO)) gains = gains.plus(net);
    else losing = losing.plus(net);
    if (best === null || net.gt(best)) best = net;
    if (worst === null || net.lt(worst)) worst = net;
    cumulative = cumulative.plus(net);
    if (cumulative.gt(peak)) peak = cumulative;
    const drawdown = peak.minus(cumulative);
    if (drawdown.gt(maxDrawdown)) maxDrawdown = drawdown;
  }

  const decided = wins + losses;
  const avgWin = wins > 0 ? divOrNull(gains, D(String(wins))) : null;
  const avgLoss = losses > 0 ? divOrNull(losing, D(String(losses))) : null;
  return {
    total: trips.length,
    closed: closedTrips.length,
    open: trips.length - closedTrips.length,
    incomplete: trips.filter((t) => t.trip.incomplete).length,
    excluded,
    wins,
    losses,
    breakeven,
    winRate: decided > 0 ? D(String(wins)).div(String(decided)) : null,
    profitFactor: losing.lt(ZERO) ? gains.div(losing.abs()) : null,
    expectancy: converted > 0 ? netTotal.div(String(converted)) : null,
    expectancyR: nR > 0 ? rSum.div(String(nR)) : null,
    nR,
    avgWin,
    avgLoss,
    payoff:
      avgWin !== null && avgLoss !== null && avgLoss.lt(ZERO) ? avgWin.div(avgLoss.abs()) : null,
    best,
    worst,
    netTotal,
    grossTotal,
    feesTotal,
    fundingTotal,
    maxDrawdown: converted > 0 ? maxDrawdown : null,
    longestWinStreak,
    longestLossStreak,
    avgHoldSeconds: holdCount > 0 ? Math.round(holdSum / holdCount) : null,
    smallSample: closedTrips.length < MIN_SAMPLE,
  };
}

export type StatsDimension =
  'setup' | 'symbol' | 'direction' | 'weekday' | 'hour' | 'duration' | 'account';

export interface StatsBucket {
  key: string;
  label: string;
  stats: TradingStats;
}

/** Lundi en premier : l'ordre que renvoie `weekdayMondayFirst`. */
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/**
 * Jour de la semaine d'une date naïve, par arithmétique civile entière — mêmes helpers que la
 * grille du calendrier (`../date`), plutôt qu'un `Date.UTC` de plus : une seule implémentation du
 * calendrier grégorien dans le moteur.
 */
export function weekdayOf(naive: string): string {
  const epochDay = epochDayOf(naive);
  if (epochDay === null) return '?';
  return WEEKDAYS[weekdayMondayFirst(epochDay)] ?? '?';
}

function durationBucket(holdSeconds: number | null): string {
  if (holdSeconds === null) return 'en cours';
  if (holdSeconds < 3_600) return "moins d'une heure";
  if (holdSeconds < 86_400) return '1 h à 1 jour';
  if (holdSeconds < 7 * 86_400) return '1 à 7 jours';
  return 'plus de 7 jours';
}

function keyOf(t: JournaledTrip, dimension: StatsDimension): string {
  switch (dimension) {
    case 'setup':
      return t.journal?.setup ?? 'Sans setup';
    case 'symbol':
      return t.trip.symbol;
    case 'direction':
      return t.trip.direction === 'long' ? 'Long' : 'Short';
    case 'weekday':
      return weekdayOf(t.trip.openedAt);
    case 'hour':
      return `${t.trip.openedAt.slice(11, 13)} h`;
    case 'duration':
      return durationBucket(t.trip.holdSeconds);
    case 'account':
      return t.trip.accountId;
  }
}

/** Ventilation par dimension, triée par P&L net décroissant. */
export function statsBuckets(
  trips: readonly JournaledTrip[],
  dimension: StatsDimension,
  toDisplay: ToDisplay = identity,
  labelOf: (key: string) => string = (key) => key,
): StatsBucket[] {
  const groups = new Map<string, JournaledTrip[]>();
  for (const t of trips) {
    const key = keyOf(t, dimension);
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, label: labelOf(key), stats: computeStats(list, toDisplay) }))
    .sort((a, b) => b.stats.netTotal.cmp(a.stats.netTotal));
}
