/**
 * Calendrier de P&L (P22) : grille mensuelle du P&L réalisé net, **rattaché au jour où la
 * plateforme l'a réalisé** — le `closedPnl` et les frais d'un fill au jour du fill, un paiement
 * de funding au jour du paiement. C'est la règle de l'exchange, et celle du tableau de bord
 * (`computeTotals`) : les deux écrans doivent donner le même chiffre pour un même mois.
 *
 * Rattacher au jour de CLÔTURE de l'aller-retour, comme le faisait la première version, décalait
 * tout : une position montée puis allégée sur plusieurs jours affichait zéro les jours de prise
 * de bénéfice et tout d'un bloc le dernier jour, les frais et le funding d'un trade encore ouvert
 * n'apparaissaient nulle part, et le total du mois ne correspondait ni à la plateforme ni au
 * reste de l'application (décision n° 35).
 *
 * Grille lundi-en-premier calculée par arithmétique entière pure : aucun `Date`/`Date.UTC` n'est
 * utilisé, le jour de la semaine vient du nombre de jours écoulés depuis 1970-01-01 (qui était un
 * jeudi), via l'algorithme « days_from_civil » de Howard Hinnant (domaine public,
 * http://howardhinnant.github.io/date_algorithms.html) — helpers partagés dans `../date`.
 * Pur, `big.js` seulement.
 */
import { daysInMonth, daysSinceEpoch, weekdayMondayFirst } from '../date';
import { D, ZERO, type Big } from '../money';
import type { JournaledTrip } from './journal';
import { tripOfFunding, type RoundTrip } from './round-trips';
import type { Execution, FundingPayment } from './types';

/** Conversion vers la devise d'affichage ; `null` si la devise de cotation n'est pas convertible. */
export type QuoteToDisplay = (quote: string, value: Big) => Big | null;

/** Un montant réalisé, daté de l'instant où il l'a été. */
export interface RealizedEvent {
  /** `YYYY-MM-DD`, heure de Paris comme tous les horodatages affichés. */
  day: string;
  /** Millisecondes UTC : ordre exact à l'intérieur d'une journée. */
  time: number;
  /** Devise de cotation du montant (`USDC` sur Hyperliquid). */
  quote: string;
  /** `closedPnl − frais` d'un fill perp, un paiement de funding, ou le net d'un trade manuel. */
  amount: Big;
  /** Aller-retour concerné (détail du jour) ; `null` si aucun ne le couvre. */
  tripId: string | null;
  /** Cet événement clôt son aller-retour : c'est lui qui compte un « trade clos » ce jour-là. */
  closes: boolean;
}

/**
 * Montants réalisés d'un historique : un par fill perp (frais compris, même quand le fill ne
 * clôture rien), un par paiement de funding, un par trade manuel clos.
 *
 * Le rattachement à un aller-retour ne sert qu'à lister les trades d'une journée : sur un
 * retournement, l'exécution ferme un aller-retour et en ouvre un autre — l'événement est rattaché
 * à celui qui se ferme. Le montant du jour, lui, ne dépend d'aucun rattachement.
 */
export function realizedEvents(
  trips: readonly JournaledTrip[],
  executions: readonly Execution[],
  funding: readonly FundingPayment[],
): RealizedEvent[] {
  const byOpening: RoundTrip[] = trips
    .map((t) => t.trip)
    .sort((a, b) => a.openedTime - b.openedTime);
  const tripOfExecution = new Map<string, RoundTrip>();
  for (const trip of byOpening)
    for (const id of trip.executionIds) if (!tripOfExecution.has(id)) tripOfExecution.set(id, trip);

  const events: RealizedEvent[] = [];
  for (const x of executions) {
    if (x.market !== 'perp') continue;
    const amount = D(x.closedPnl).minus(x.fee);
    const trip = tripOfExecution.get(x.id);
    const closes =
      trip !== undefined && trip.closedTime === x.time && trip.executionIds.at(-1) === x.id;
    if (amount.eq(ZERO) && !closes) continue;
    events.push({
      day: x.at.slice(0, 10),
      time: x.time,
      quote: x.quote,
      amount,
      tripId: trip?.id ?? null,
      closes,
    });
  }
  for (const f of funding) {
    const amount = D(f.amount);
    if (amount.eq(ZERO)) continue;
    const trip = tripOfFunding(byOpening, f);
    events.push({
      day: f.at.slice(0, 10),
      time: f.time,
      quote: trip?.quote ?? 'USDC',
      amount,
      tripId: trip?.id ?? null,
      closes: false,
    });
  }
  // Trades manuels : aucune exécution à dater, le net est rattaché au jour de clôture saisi.
  for (const { trip } of trips) {
    if (trip.executionIds.length > 0 || trip.closedAt === null) continue;
    events.push({
      day: trip.closedAt.slice(0, 10),
      time: trip.closedTime ?? 0,
      quote: trip.quote,
      amount: trip.netPnl,
      tripId: trip.id,
      closes: true,
    });
  }
  return events.sort((a, b) => a.time - b.time);
}

/** Mois (`YYYY-MM`) distincts ayant au moins un montant réalisé, triés croissant. */
export function activeMonths(events: readonly RealizedEvent[]): string[] {
  const months = new Set<string>();
  for (const e of events) months.add(e.day.slice(0, 7));
  return [...months].sort();
}

export interface CalendarDay {
  /** `YYYY-MM-DD`. */
  day: string;
  /** P&L réalisé net ce jour-là (devise d'affichage), montants convertibles seulement. */
  pnl: Big;
  /** Aller-retours ayant réalisé quelque chose ce jour-là (gain, perte, frais ou funding). */
  count: number;
  /** Sous-ensemble de `count` : aller-retours clos ce jour-là. */
  closed: number;
  /** Identifiants de ces aller-retours, dans l'ordre de leur première réalisation du jour. */
  tripIds: string[];
  /** Aller-retours dont la devise de cotation n'est pas convertible (exclus de `pnl`). */
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
  /** Aller-retours clos dans le mois (compte sans doublon, contrairement à `CalendarDay.count`). */
  closed: number;
  /** Aller-retours du mois dont la devise de cotation n'est pas convertible. */
  excluded: number;
}

interface Accumulator {
  pnl: Big;
  tripIds: string[];
  seen: Set<string>;
  closed: number;
  excluded: Set<string>;
}

interface Grouping {
  /** Tranche → cumul, dans l'ordre de première apparition. */
  byKey: Map<string, Accumulator>;
  /** Aller-retours clos, sans doublon, toutes tranches confondues. */
  closed: Set<string>;
  /** Aller-retours non convertibles, sans doublon. */
  excluded: Set<string>;
}

/**
 * Cumule les montants réalisés par tranche de temps — la seule addition du module, partagée par
 * les trois mailles (jour, mois, année) pour qu'elles ne puissent pas diverger. `keyOf` rend la
 * tranche d'un événement, ou `null` pour l'écarter (hors du mois ou de l'année affichés).
 */
function groupEvents(
  events: readonly RealizedEvent[],
  keyOf: (event: RealizedEvent) => string | null,
  toDisplay: QuoteToDisplay,
): Grouping {
  const byKey = new Map<string, Accumulator>();
  const closed = new Set<string>();
  const excluded = new Set<string>();
  for (const e of events) {
    const slot = keyOf(e);
    if (slot === null) continue;
    let acc = byKey.get(slot);
    if (!acc) {
      acc = { pnl: ZERO, tripIds: [], seen: new Set(), closed: 0, excluded: new Set() };
      byKey.set(slot, acc);
    }
    // Un même aller-retour peut réaliser plusieurs fois dans la tranche : il n'est listé qu'une fois.
    const trip = e.tripId ?? `?${e.quote}`;
    if (!acc.seen.has(trip)) {
      acc.seen.add(trip);
      acc.tripIds.push(trip);
    }
    if (e.closes) {
      acc.closed++;
      closed.add(trip);
    }
    const converted = toDisplay(e.quote, e.amount);
    if (converted === null) {
      acc.excluded.add(trip);
      excluded.add(trip);
    } else acc.pnl = acc.pnl.plus(converted);
  }
  return { byKey, closed, excluded };
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
 * Grille mensuelle du P&L réalisé net par jour, lundi en premier. `toDisplay` convertit un montant
 * depuis sa devise de cotation (`null` si elle n'est pas convertible) : un montant non convertible
 * est signalé, jamais sommé dans la mauvaise devise.
 */
export function calendarMonth(
  events: readonly RealizedEvent[],
  month: string,
  toDisplay: QuoteToDisplay,
): CalendarMonth {
  const [yearPart, monthPart] = month.split('-') as [string, string];
  const year = Number(yearPart);
  const monthNum = Number(monthPart);

  const grouped = groupEvents(
    events,
    (e) => (e.day.slice(0, 7) === month ? e.day : null),
    toDisplay,
  );

  const numDays = daysInMonth(year, monthNum);
  const days: CalendarDay[] = [];
  for (let d = 1; d <= numDays; d++) {
    const dayStr = `${yearPart}-${monthPart}-${String(d).padStart(2, '0')}`;
    const acc = grouped.byKey.get(dayStr);
    days.push({
      day: dayStr,
      pnl: acc?.pnl ?? ZERO,
      count: acc?.tripIds.length ?? 0,
      closed: acc?.closed ?? 0,
      tripIds: acc?.tripIds ?? [],
      excluded: acc?.excluded.size ?? 0,
    });
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
  for (const day of days) total = total.plus(day.pnl);

  return { month, weeks, total, closed: grouped.closed.size, excluded: grouped.excluded.size };
}

/** Maille du calendrier : une case par jour, par mois, ou par année. */
export type CalendarGrain = 'day' | 'month' | 'year';

/** Une case du calendrier aux mailles mois et année. */
export interface CalendarBucket {
  /** `YYYY-MM` (mois) ou `YYYY` (année). */
  key: string;
  /** P&L réalisé net de la tranche (devise d'affichage), montants convertibles seulement. */
  pnl: Big;
  /** Aller-retours ayant réalisé quelque chose dans la tranche (gain, perte, frais ou funding). */
  count: number;
  /** Sous-ensemble de `count` : aller-retours clos dans la tranche. */
  closed: number;
  /** Aller-retours de la tranche dont la devise de cotation n'est pas convertible. */
  excluded: number;
}

/** Une grille de tranches : les 12 mois d'une année, ou toutes les années atteignables. */
export interface CalendarGrid {
  buckets: CalendarBucket[];
  total: Big;
  /** Aller-retours clos dans la grille (sans doublon, contrairement à la somme des `closed`). */
  closed: number;
  /** Aller-retours de la grille dont la devise de cotation n'est pas convertible. */
  excluded: number;
}

/** Assemble une grille à partir des tranches attendues, celles sans montant comprises. */
function buildGrid(keys: readonly string[], grouped: Grouping): CalendarGrid {
  let total = ZERO;
  const buckets = keys.map((key): CalendarBucket => {
    const acc = grouped.byKey.get(key);
    const pnl = acc?.pnl ?? ZERO;
    total = total.plus(pnl);
    return {
      key,
      pnl,
      count: acc?.tripIds.length ?? 0,
      closed: acc?.closed ?? 0,
      excluded: acc?.excluded.size ?? 0,
    };
  });
  return { buckets, total, closed: grouped.closed.size, excluded: grouped.excluded.size };
}

/**
 * Les 12 mois de `year` (`YYYY`), y compris ceux sans le moindre montant : la grille annuelle est
 * une année complète, comme la grille mensuelle est un mois complet. La somme des 12 mois égale la
 * somme des jours de chacun d'eux — même addition, même écartement des devises non convertibles.
 */
export function calendarMonths(
  events: readonly RealizedEvent[],
  year: string,
  toDisplay: QuoteToDisplay,
): CalendarGrid {
  const grouped = groupEvents(
    events,
    (e) => (e.day.slice(0, 4) === year ? e.day.slice(0, 7) : null),
    toDisplay,
  );
  const keys: string[] = [];
  for (let m = 1; m <= 12; m++) keys.push(`${year}-${String(m).padStart(2, '0')}`);
  return buildGrid(keys, grouped);
}

/** Années (`YYYY`) distinctes ayant au moins un montant réalisé, triées croissant. */
export function activeYears(events: readonly RealizedEvent[]): string[] {
  const years = new Set<string>();
  for (const e of events) years.add(e.day.slice(0, 4));
  return [...years].sort();
}

/**
 * Une case par année, de la première à la dernière année active — les années creuses comprises,
 * pour que la frise reste continue. Grille vide si aucun montant n'a jamais été réalisé.
 */
export function calendarYears(
  events: readonly RealizedEvent[],
  toDisplay: QuoteToDisplay,
): CalendarGrid {
  const grouped = groupEvents(events, (e) => e.day.slice(0, 4), toDisplay);
  const years = activeYears(events);
  const first = years[0];
  const last = years.at(-1);
  const keys: string[] = [];
  if (first !== undefined && last !== undefined)
    for (let y = Number(first); y <= Number(last); y++) keys.push(String(y));
  return buildGrid(keys, grouped);
}
