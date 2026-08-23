/**
 * Horodatage des sources « instant » (Hyperliquid : millisecondes UTC) → `NaiveDateTime`
 * (`YYYY-MM-DDTHH:mm:ss`) en heure de Paris, comme l'export Coinhouse, pour que le tri mixte d'une
 * même journée reste juste (DECISIONS n° 22). `Intl.DateTimeFormat` avec fuseau explicite :
 * déterministe quel que soit le fuseau de la machine ; jamais `new Date()` sur une chaîne.
 */
import type { NaiveDateTime } from '../../domain/types';

const PARIS = 'Europe/Paris';

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: PARIS,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function msToParisNaive(ms: number): NaiveDateTime {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(ms))) parts[part.type] = part.value;
  // `hourCycle: 'h23'` évite « 24 » à minuit sur certains moteurs ; garde-fou conservé.
  const hour = parts['hour'] === '24' ? '00' : parts['hour'];
  return `${parts['year']}-${parts['month']}-${parts['day']}T${hour}:${parts['minute']}:${parts['second']}`;
}

/** Jour civil (Paris) d'un instant, `YYYY-MM-DD` : clé des taux BCE. */
export const msToParisDay = (ms: number): string => msToParisNaive(ms).slice(0, 10);
