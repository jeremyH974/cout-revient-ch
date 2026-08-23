/**
 * Arithmétique de jours calendaires `YYYY-MM-DD`, toujours en UTC. Aucune `Date` locale :
 * les seules conversions passent par `Date.UTC` et `toISOString()`.
 */
import type { NaiveDateTime } from '../domain/types';
import type { DayString } from './types';

export const DAY_MS = 86_400_000;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDayString(value: string): boolean {
  const match = DAY_RE.exec(value);
  if (!match) return false;
  return msToDay(dayToMs(value)) === value;
}

/** Minuit UTC du jour, en millisecondes epoch. */
export function dayToMs(day: DayString): number {
  const match = DAY_RE.exec(day);
  if (!match) throw new Error(`Jour invalide : ${day}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Jour UTC contenant l'instant donné. */
export function msToDay(ms: number): DayString {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Jour de « clôture » d'un point horodaté : un point tombant exactement à minuit UTC est le
 * dernier prix de la veille (convention des bougies quotidiennes des exchanges).
 */
export function closeDayOf(ms: number): DayString {
  return ms % DAY_MS === 0 ? msToDay(ms - DAY_MS) : msToDay(ms);
}

export function addDays(day: DayString, count: number): DayString {
  return msToDay(dayToMs(day) + count * DAY_MS);
}

/** Nombre de jours de `from` à `to` (négatif si `to` précède `from`). */
export function daysBetween(from: DayString, to: DayString): number {
  return Math.round((dayToMs(to) - dayToMs(from)) / DAY_MS);
}

/** Ajoute des mois calendaires en bornant le quantième (31 mars − 1 mois = 28/29 février). */
export function addMonths(day: DayString, count: number): DayString {
  const match = DAY_RE.exec(day);
  if (!match) throw new Error(`Jour invalide : ${day}`);
  const total = Number(match[1]) * 12 + (Number(match[2]) - 1) + count;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return msToDay(Date.UTC(year, month, Math.min(Number(match[3]), lastOfMonth)));
}

/** Jour d'un horodatage naïf Coinhouse (`YYYY-MM-DDTHH:mm:ss`), sans conversion de fuseau. */
export function dayOfNaive(at: NaiveDateTime): DayString {
  return at.slice(0, 10);
}

/**
 * Instant (ms epoch) d'un point de série : minuit UTC pour un jour `YYYY-MM-DD`, l'instant exact
 * pour un horodatage ISO 8601 (points intraday). Sert aux abscisses et aux pondérations.
 */
export function pointMs(day: string): number {
  return day.length > 10 ? Date.parse(day) : dayToMs(day);
}

/** Tous les jours de `from` à `to` inclus (vide si `to` précède `from`). */
export function eachDay(from: DayString, to: DayString): DayString[] {
  const days: DayString[] = [];
  const end = dayToMs(to);
  for (let ms = dayToMs(from); ms <= end; ms += DAY_MS) days.push(msToDay(ms));
  return days;
}

export function minDay(a: DayString, b: DayString): DayString {
  return a <= b ? a : b;
}

export function maxDay(a: DayString, b: DayString): DayString {
  return a >= b ? a : b;
}

/** Jour UTC courant pour une horloge injectée. */
export function todayOf(nowMs: number): DayString {
  return msToDay(nowMs);
}
