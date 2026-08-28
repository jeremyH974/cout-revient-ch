/**
 * Ce que l'écran demande au calendrier : à venir, récemment passé, groupé par jour **local**.
 *
 * Le fuseau est toujours un paramètre, jamais une lecture d'environnement cachée. Deux raisons :
 * les tests peuvent alors vérifier le regroupement sous n'importe quel fuseau sans bricoler
 * l'horloge de la machine, et le comportement à la frontière — une publication à 14 h à New York
 * tombe le même jour à Paris, une à 20 h non — devient une propriété vérifiable plutôt qu'un effet
 * de bord constaté sur le poste du développeur.
 *
 * Rien ici ne trie par importance ni ne recommande : l'ordre est chronologique, point.
 */

import { CALENDAR } from './events.generated';
import type { Calendar, MarketEvent } from './types';

export { CALENDAR };
export type { Calendar, MarketEvent } from './types';

/** Le jour *local* d'un instant, `AAAA-MM-JJ`, dans le fuseau demandé. */
export function localDay(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
  // `en-CA` rend déjà « 2026-09-11 » ; on ne reformate donc rien.
  return parts;
}

export interface DayGroup {
  /** Jour local, `AAAA-MM-JJ`. */
  day: string;
  events: readonly MarketEvent[];
}

/** Regroupe par jour local, en conservant l'ordre chronologique à l'intérieur de chaque jour. */
export function groupByDay(events: readonly MarketEvent[], timeZone: string): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: { day: string; events: MarketEvent[] } | null = null;
  for (const event of events) {
    const day = localDay(event.at, timeZone);
    if (!current || current.day !== day) {
      current = { day, events: [] };
      groups.push(current);
    }
    current.events.push(event);
  }
  return groups;
}

export interface Split {
  /** À venir, du plus proche au plus lointain. */
  upcoming: readonly MarketEvent[];
  /** Déjà publié, du plus récent au plus ancien. */
  past: readonly MarketEvent[];
}

/**
 * Sépare le calendrier de part et d'autre de l'instant courant.
 *
 * La coupure se fait sur l'**instant**, pas sur le jour : une publication de 14 h 30 n'est pas
 * « passée » parce qu'on est le même jour à 9 h. C'est ce qui permet à l'écran d'annoncer la
 * prochaine échéance sans se tromper d'une demi-journée.
 */
export function splitAround(now: string, calendar: Calendar = CALENDAR): Split {
  const upcoming: MarketEvent[] = [];
  const past: MarketEvent[] = [];
  for (const event of calendar.events) {
    if (event.at >= now) upcoming.push(event);
    else past.push(event);
  }
  past.reverse();
  return { upcoming, past };
}

/**
 * Le calendrier est-il en train de s'épuiser ?
 *
 * Rend le nombre de jours restants avant la fin de la couverture **complète** — au-delà, l'app
 * connaît encore des réunions de la Fed mais plus les publications du BLS, et un écran qui
 * afficherait « rien de prévu » mentirait. L'écran s'en sert pour le dire franchement.
 */
export function daysUntilIncomplete(now: string, calendar: Calendar = CALENDAR): number {
  const end = Date.parse(`${calendar.completeTo}T23:59:59Z`);
  const from = Date.parse(now);
  if (Number.isNaN(end) || Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((end - from) / 86_400_000));
}
