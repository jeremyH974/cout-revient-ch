/**
 * Horodatage des sources « instant » (Hyperliquid : millisecondes UTC) → `NaiveDateTime`
 * (`YYYY-MM-DDTHH:mm:ss`) en heure de Paris, comme l'export Coinhouse, pour que le tri mixte d'une
 * même journée reste juste (DECISIONS n° 22). `Intl.DateTimeFormat` avec fuseau explicite :
 * déterministe quel que soit le fuseau de la machine ; jamais `new Date()` sur une chaîne.
 */
import type { NaiveDateTime } from '../domain/types';

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

/**
 * Chaîne UTC « YYYY-MM-DD HH:mm:ss » (ou variantes ISO « T », secondes absentes, suffixe « Z »,
 * millisecondes) → millisecondes époque ; null si la forme est inconnue. Format des dates du
 * CSV pivot (Koinly Universal : « must be in UTC time »).
 */
export function utcStringToMs(raw: string): number | null {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|\+00:?00)?$/.exec(
      raw.trim(),
    );
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const time = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? '0'),
    Number((ms ?? '0').slice(0, 3).padEnd(3, '0')),
  );
  // Rejette les dates invalides (mois 13, 31 février…) : Date.UTC les fait déborder en silence.
  return new Date(time).toISOString().slice(0, 10) === `${y}-${mo}-${d}` ? time : null;
}

/**
 * Heure de Paris naïve → millisecondes époque (inverse de `msToParisNaive`). L'offset (+1 h ou
 * +2 h) est retrouvé par vérification aller-retour ; pour l'heure inexistante du passage à l'heure
 * d'été (02:00-03:00), l'offset d'hiver est retenu par convention.
 */
export function parisNaiveToMs(naive: NaiveDateTime): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(naive);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  for (const offsetH of [1, 2]) {
    const ms = asUtc - offsetH * 3_600_000;
    if (msToParisNaive(ms) === naive) return ms;
  }
  return asUtc - 3_600_000;
}

/** Instant → chaîne UTC « YYYY-MM-DD HH:mm:ss » (format des dates du CSV pivot). */
export function msToUtcString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(zone: string): Intl.DateTimeFormat | null {
  const cached = zonedFormatters.get(zone);
  if (cached) return cached;
  try {
    const created = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    zonedFormatters.set(zone, created);
    return created;
  } catch {
    return null; // fuseau IANA inconnu
  }
}

/** Instant → date-heure naïve dans un fuseau IANA arbitraire ; null si fuseau inconnu. */
export function msToZonedNaive(zone: string, ms: number): NaiveDateTime | null {
  const f = zoneFormatter(zone);
  if (!f) return null;
  const parts: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(ms))) parts[part.type] = part.value;
  const hour = parts['hour'] === '24' ? '00' : parts['hour'];
  return `${parts['year']}-${parts['month']}-${parts['day']}T${hour}:${parts['minute']}:${parts['second']}`;
}

const naiveAsUtc = (naive: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(naive.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? '0'));
};

/**
 * Date-heure naïve d'un fuseau IANA (colonne Timezone de Bitvavo…) → millisecondes époque.
 * Convergence par correction du décalage observé (2-3 itérations) ; pour l'heure inexistante du
 * passage à l'heure d'été, le meilleur candidat (± 1 h) est retenu. `null` si fuseau ou forme
 * inconnus.
 */
export function zonedNaiveToMs(zone: string, naive: string): number | null {
  const target = naiveAsUtc(naive);
  if (target === null) return null;
  const normalized = msToZonedNaive('UTC', target);
  if (normalized === null) return null;
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const seen = msToZonedNaive(zone, guess);
    if (seen === null) return null;
    if (seen === normalized) return guess;
    const seenUtc = naiveAsUtc(seen);
    if (seenUtc === null) return null;
    guess += target - seenUtc;
  }
  const finalSeen = msToZonedNaive(zone, guess);
  const finalUtc = finalSeen === null ? null : naiveAsUtc(finalSeen);
  return finalUtc !== null && Math.abs(finalUtc - target) <= 3_600_000 ? guess : null;
}
