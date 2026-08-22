/** Utilitaires communs aux fournisseurs d'historique. */
import { parseDecimal, toDecimalString } from '../../domain/money';
import type { DecimalString } from '../../domain/types';
import { numberToDecimal } from '../../pricing/types';
import type { DailyPoint, DayString, FetchLike } from '../types';

/** `fetch` global, appelé sans `this` explicite (compatible navigateur et Node). */
export const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

/**
 * Prix JSON (nombre ou chaîne) → chaîne décimale canonique ; `null` si absent, invalide ou
 * négatif. Les nombres passent par `numberToDecimal` (jamais par `new Big(number)`).
 */
export function priceFromJson(value: unknown): DecimalString | null {
  const text = numberToDecimal(value);
  if (text === null) return null;
  const big = parseDecimal(text);
  if (big === null || big.lt(0)) return null;
  return toDecimalString(big);
}

/** Transforme une table jour → prix en points triés, restreints à `[fromDay, toDay]`. */
export function pointsFromMap(
  byDay: Map<DayString, DecimalString>,
  fromDay: DayString,
  toDay: DayString,
): DailyPoint[] {
  const points: DailyPoint[] = [];
  for (const [day, priceEur] of byDay) {
    if (day >= fromDay && day <= toDay) points.push({ day, priceEur });
  }
  points.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return points;
}

/** Lit une réponse JSON en signalant le statut HTTP en cas d'échec. */
export async function readJson(provider: string, response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`${provider} HTTP ${response.status}`);
  return (await response.json()) as unknown;
}

/** Mémoïse une promesse (liste de paires / produits) ; un échec autorise un nouvel essai. */
export function memoizeAsync<T>(
  factory: (signal: AbortSignal) => Promise<T>,
): (signal: AbortSignal) => Promise<T> {
  let pending: Promise<T> | null = null;
  return (signal) => {
    if (pending === null) {
      pending = factory(signal).catch((error: unknown) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}
