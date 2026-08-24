/**
 * Calendrier de P&L (P22) : grille mensuelle du P&L réalisé net par jour de clôture (style
 * TradeZella). Le jour d'un trade clos est `closedAt.slice(0, 10)` ; son P&L suit la MÊME règle
 * de conversion et d'exclusion que `computeStats` (`./stats`) — un trade dont la devise de
 * cotation n'est pas convertible est compté à part (`excluded`), jamais sommé dans la mauvaise
 * devise. Grille lundi-en-premier calculée par arithmétique entière pure : aucun `Date`/`Date.UTC`
 * n'est utilisé, le jour de la semaine vient du nombre de jours écoulés depuis 1970-01-01 (qui
 * était un jeudi), via l'algorithme « days_from_civil » de Howard Hinnant (domaine public,
 * http://howardhinnant.github.io/date_algorithms.html) — helpers partagés dans `../date`.
 * Pur, `big.js` seulement.
 */
import { daysInMonth, daysSinceEpoch, weekdayMondayFirst } from '../date';
import { ZERO, type Big } from '../money';
import type { JournaledTrip } from './journal';
import type { ToDisplay } from './stats';

export interface CalendarDay {
  /** `YYYY-MM-DD`. */
  day: string;
  /** P&L net (devise d'affichage), somme des trades convertibles clos ce jour. */
  pnl: Big;
  /** Trades clos ce jour, convertibles ou non (même compte que `closed` dans `computeStats`). */
  count: number;
  /** Identifiants des trades clos ce jour, dans l'ordre de clôture croissant. */
  tripIds: string[];
  /** Sous-ensemble de `count` : trades dont la devise de cotation n'est pas convertible. */
  excluded: number;
}

export interface CalendarWeek {
  /** Exactement 7 entrées, lundi en premier ; `null` = jour hors du mois affiché. */
  days: (CalendarDay | null)[];
  total: Big;
  count: number;
}

export interface CalendarMonth {
  /** `YYYY-MM`. */
  month: string;
  weeks: CalendarWeek[];
  total: Big;
  count: number;
  excluded: number;
}

/** Mois (`YYYY-MM`) distincts ayant au moins un trade clos, triés croissant. */
export function closedMonths(trips: readonly JournaledTrip[]): string[] {
  const months = new Set<string>();
  for (const t of trips) {
    if (t.trip.closedAt !== null) months.add(t.trip.closedAt.slice(0, 7));
  }
  return [...months].sort();
}

interface DayAccumulator {
  pnl: Big;
  count: number;
  tripIds: string[];
  excluded: number;
}

/** Additionne les jours d'une semaine (les cases `null`, hors mois, ne comptent pas). */
function summarizeWeek(days: (CalendarDay | null)[]): CalendarWeek {
  let total = ZERO;
  let count = 0;
  for (const day of days) {
    if (day) {
      total = total.plus(day.pnl);
      count += day.count;
    }
  }
  return { days, total, count };
}

/**
 * Grille mensuelle du P&L net par jour de clôture, lundi en premier. `toDisplay` convertit le
 * P&L net d'un trade dans la devise d'affichage (`null` si sa devise de cotation n'est pas
 * convertible) — même contrat que dans `computeStats`.
 */
export function calendarMonth(
  trips: readonly JournaledTrip[],
  month: string,
  toDisplay: ToDisplay,
): CalendarMonth {
  const [yearPart, monthPart] = month.split('-') as [string, string];
  const year = Number(yearPart);
  const monthNum = Number(monthPart);

  // Trades clos de ce mois, dans l'ordre de clôture croissant (même tri que `computeStats`).
  const closedInMonth = trips
    .filter((t) => t.trip.closedAt !== null && t.trip.closedAt.slice(0, 7) === month)
    .sort((a, b) => (a.trip.closedTime ?? 0) - (b.trip.closedTime ?? 0));

  const byDay = new Map<string, DayAccumulator>();
  for (const t of closedInMonth) {
    const day = (t.trip.closedAt as string).slice(0, 10);
    let acc = byDay.get(day);
    if (!acc) {
      acc = { pnl: ZERO, count: 0, tripIds: [], excluded: 0 };
      byDay.set(day, acc);
    }
    acc.count++;
    acc.tripIds.push(t.trip.id);
    // Même règle que `computeStats` : un trade non convertible est exclu de la somme, pas du compte.
    const net = toDisplay(t, t.trip.netPnl);
    if (net === null) acc.excluded++;
    else acc.pnl = acc.pnl.plus(net);
  }

  const numDays = daysInMonth(year, monthNum);
  const days: CalendarDay[] = [];
  for (let d = 1; d <= numDays; d++) {
    const dayStr = `${yearPart}-${monthPart}-${String(d).padStart(2, '0')}`;
    const acc = byDay.get(dayStr);
    days.push(
      acc
        ? {
            day: dayStr,
            pnl: acc.pnl,
            count: acc.count,
            tripIds: acc.tripIds,
            excluded: acc.excluded,
          }
        : { day: dayStr, pnl: ZERO, count: 0, tripIds: [], excluded: 0 },
    );
  }

  const leading = weekdayMondayFirst(daysSinceEpoch(year, monthNum, 1));
  const weeks: CalendarWeek[] = [];
  let slot: (CalendarDay | null)[] = new Array(leading).fill(null);
  for (const day of days) {
    slot.push(day);
    if (slot.length === 7) {
      weeks.push(summarizeWeek(slot));
      slot = [];
    }
  }
  if (slot.length > 0) {
    while (slot.length < 7) slot.push(null);
    weeks.push(summarizeWeek(slot));
  }

  let total = ZERO;
  let count = 0;
  let excluded = 0;
  for (const day of days) {
    total = total.plus(day.pnl);
    count += day.count;
    excluded += day.excluded;
  }

  return { month, weeks, total, count, excluded };
}
