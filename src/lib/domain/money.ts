/**
 * Arithmétique décimale exacte pour tout le moteur.
 *
 * Règle du projet : aucun `number` ne porte un montant ou une quantité. Les valeurs circulent
 * sous forme de chaînes décimales canoniques (`DecimalString`) et sont calculées avec big.js.
 * L'arrondi n'existe que dans la couche d'affichage (`src/lib/format`).
 */
import Big from 'big.js';

// Configuration globale de big.js (un seul endroit).
Big.DP = 30; // décimales conservées lors d'une division
Big.RM = Big.roundHalfEven; // arrondi des divisions (banquier)
Big.NE = -30; // jamais de notation exponentielle dans toString() pour nos ordres de grandeur
Big.PE = 40;
Big.strict = true; // interdit les `number` en entrée : une quantité ne transite jamais par un flottant

export { Big };

/** Chaîne décimale canonique : `-?\d+(\.\d+)?`, sans exposant ni séparateur de milliers. */
export type DecimalString = string;

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Vrai si la chaîne est un décimal canonique accepté par le moteur. */
export function isDecimalString(value: string): boolean {
  return DECIMAL_RE.test(value);
}

/** Construit un Big à partir d'une chaîne décimale (ou renvoie le Big tel quel). */
export function D(value: DecimalString | Big): Big {
  return value instanceof Big ? value : new Big(value);
}

export const ZERO: Big = D('0');
export const ONE: Big = D('1');

/** Parse une chaîne décimale canonique ; `null` si le format est invalide. */
export function parseDecimal(raw: string): Big | null {
  const trimmed = raw.trim();
  return DECIMAL_RE.test(trimmed) ? new Big(trimmed) : null;
}

/** Sérialise sans exposant (garanti par Big.NE / Big.PE). */
export function toDecimalString(value: Big): DecimalString {
  return value.toString();
}

export function sum(values: Iterable<Big>): Big {
  let total = ZERO;
  for (const value of values) total = total.plus(value);
  return total;
}

export function isZero(value: Big): boolean {
  return value.eq(ZERO);
}

export function isPositive(value: Big): boolean {
  return value.gt(ZERO);
}

export function isNegative(value: Big): boolean {
  return value.lt(ZERO);
}

/** Division sûre : `null` si le diviseur est nul. */
export function divOrNull(numerator: Big, denominator: Big): Big | null {
  return isZero(denominator) ? null : numerator.div(denominator);
}

export function max(a: Big, b: Big): Big {
  return a.gte(b) ? a : b;
}

export function min(a: Big, b: Big): Big {
  return a.lte(b) ? a : b;
}

/** Compare deux Big pour un tri (`-1`, `0`, `1`). */
export function compare(a: Big, b: Big): -1 | 0 | 1 {
  return a.cmp(b) as -1 | 0 | 1;
}
