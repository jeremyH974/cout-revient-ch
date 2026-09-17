/**
 * Arithmétique de dates civile en entiers purs — jamais de `Date` sur des valeurs métier.
 * Algorithme « days_from_civil » de Howard Hinnant (domaine public,
 * http://howardhinnant.github.io/date_algorithms.html), divisions entières via `Math.floor`.
 */

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Nombre de jours du mois (`month` : 1 = janvier … 12 = décembre). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_LENGTHS[month - 1] ?? 30;
}

/** Jours écoulés depuis 1970-01-01 (0), peut être négatif. */
export function daysSinceEpoch(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // [0, 399]
  const mp = month > 2 ? month - 3 : month + 9; // mars = 0 … février = 11
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** Jour de la semaine, lundi = 0 … dimanche = 6 (1970-01-01 était un jeudi, donc index 3). */
export function weekdayMondayFirst(epochDay: number): number {
  return (((epochDay + 3) % 7) + 7) % 7;
}

/** `YYYY-MM-DD` (ou tout préfixe de date-heure ISO) → jours depuis l'époque ; null si illisible. */
export function epochDayOf(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dom = Number(m[3]);
  if (month < 1 || month > 12 || dom < 1 || dom > daysInMonth(year, month)) return null;
  return daysSinceEpoch(year, month, dom);
}

/**
 * Inverse de `daysSinceEpoch` : jours depuis 1970-01-01 → date civile. Même source, l'algorithme
 * « civil_from_days » de Howard Hinnant, en entiers purs.
 */
export function civilFromDays(epochDay: number): { year: number; month: number; day: number } {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  ); // [0, 399]
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // mars = 0 … février = 11
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** Jours depuis l'époque → `YYYY-MM-DD`. */
export function dayOfEpoch(epochDay: number): string {
  const { year, month, day } = civilFromDays(epochDay);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
