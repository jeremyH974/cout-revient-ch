/**
 * Formatage fr-FR : le SEUL endroit du projet qui arrondit, et toujours une seule fois, à la
 * précision affichée (half-up). Le signe est décidé après arrondi : une valeur qui s'affiche
 * « 0,00 € » ne porte ni « + » ni « − ». Signe moins typographique (U+2212), espaces
 * insécables gérées par Intl.
 */
import { Big, D, type DecimalString } from '../domain/money';
import type { NaiveDateTime } from '../domain/types';
import { CURRENCY_INFO, type Currency } from '../fx/types';

const HALF_UP = Big.roundHalfUp;
const MINUS = '−';
/** Espace insécable (U+00A0), comme Intl avant le symbole monétaire. */
const NBSP = String.fromCharCode(0xa0);
/** Décimales des quantités : l'export Coinhouse va jusqu'à 9, on les montre toutes. */
const QTY_DP = 9;

/** Masque du mode discret (montants et quantités ; prix, PRU et pourcentages restent visibles). */
export const MASK = '••••';

function intl(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return new Intl.NumberFormat('fr-FR', options);
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();
function money(currency: Currency, minDp: number, maxDp: number): Intl.NumberFormat {
  const key = `${currency}:${minDp}:${maxDp}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    formatter = intl({
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: minDp,
      maximumFractionDigits: maxDp,
    });
    moneyFormatters.set(key, formatter);
  }
  return formatter;
}
const PCT_1 = intl({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const PLAIN = intl({ maximumFractionDigits: 20 });

/** Arrondi half-up à `dp` décimales : l'unique opération d'arrondi du projet. */
export function roundHalfUp(value: Big, dp: number): Big {
  return value.round(dp, HALF_UP);
}

/** Vrai si la valeur s'affiche comme zéro à `dp` décimales : ni signe, ni couleur. */
export function roundsToZero(value: Big | null, dp = 2): boolean {
  return value === null || roundHalfUp(value, dp).eq('0');
}

/**
 * Écart entre deux montants, **tel qu'il doit s'afficher** : chaque terme est arrondi à la
 * précision affichée avant la soustraction.
 *
 * Sans cela, une carte de réconciliation ne s'additionne pas à l'écran. `21 362,675 − 24 621,894`
 * vaut `−3 259,219`, qui s'affiche `−3 259,22` alors que les deux montants affichés,
 * `21 362,68` et `24 621,89`, donnent `−3 259,21`. L'écart est d'un centime et il est invisible
 * dans le calcul — mais parfaitement visible dans une colonne, où il détruit la seule chose que
 * cette carte doit produire : la confiance dans le fait que les nombres se recoupent.
 *
 * L'exactitude reste ailleurs : le moteur garde l'écart exact, et c'est lui que contrôlent les
 * auto-vérifications. Ce qui est arrondi ici ne sert qu'à être lu.
 */
export function displayGap(a: Big | null, b: Big | null, dp = 2): Big | null {
  if (a === null || b === null) return null;
  return roundHalfUp(a, dp).minus(roundHalfUp(b, dp));
}

/** Préfixe le texte (valeur absolue, déjà arrondie) du signe de `rounded` ; « + » sur demande. */
function signed(text: string, rounded: Big, showPlus: boolean): string {
  if (rounded.lt('0')) return `${MINUS}${text}`;
  return showPlus && rounded.gt('0') ? `+${text}` : text;
}

/** Valeur déjà arrondie → `number` pour Intl (exact tant qu'il y a ≤ 15 chiffres significatifs). */
function toNumber(rounded: Big, dp: number): number {
  return Number(rounded.toFixed(dp));
}

/** Montant dans la devise d'affichage : 2 décimales (0 si ≥ 100 000 en mode compact). */
export function fmtMoney(
  value: Big | DecimalString | null,
  currency: Currency = 'EUR',
  opts: { sign?: boolean; compact?: boolean } = {},
): string {
  if (value === null) return '—';
  const big = D(value);
  const dp = opts.compact && big.abs().gte('100000') ? 0 : 2;
  const rounded = roundHalfUp(big, dp);
  const text = money(currency, dp, dp).format(toNumber(rounded.abs(), dp));
  return signed(text, rounded, opts.sign ?? false);
}

/** Raccourci euro (compatibilité). */
export function fmtEur(
  value: Big | DecimalString | null,
  opts: { sign?: boolean; compact?: boolean } = {},
): string {
  return fmtMoney(value, 'EUR', opts);
}

/** Ratio (0,1234) → pourcentage à une décimale (« +12,3 % »), arrondi une seule fois. */
export function fmtPct(ratio: Big | DecimalString | null, opts: { sign?: boolean } = {}): string {
  if (ratio === null) return '—';
  const rounded = roundHalfUp(D(ratio), 3);
  return signed(PCT_1.format(toNumber(rounded.abs(), 3)), rounded, opts.sign ?? true);
}

/** Nombre sans unité (ratio de Sortino, multiple…), `dp` décimales, arrondi une seule fois. */
export function fmtRatio(value: Big | DecimalString | null, dp = 2): string {
  if (value === null) return '—';
  const rounded = roundHalfUp(D(value), dp);
  const text = intl({ minimumFractionDigits: dp, maximumFractionDigits: dp }).format(
    toNumber(rounded.abs(), dp),
  );
  return signed(text, rounded, false);
}

/** Nombre de décimales significatives pour un prix ou une quantité. */
function adaptiveDecimals(abs: Big, max: number): number {
  if (abs.eq('0')) return 2;
  if (abs.gte('1000')) return 2;
  if (abs.gte('1')) return Math.min(max, 4);
  // < 1 : 4 chiffres significatifs
  const text = abs.toFixed(20);
  const leadingZeros = /^0\.(0*)/.exec(text)?.[1]?.length ?? 0;
  return Math.min(max, leadingZeros + 4);
}

/** Prix unitaire dans la devise d'affichage, décimales adaptées (0,000003886 € lisible). */
export function fmtPrice(value: Big | DecimalString | null, currency: Currency = 'EUR'): string {
  if (value === null) return '—';
  const big = D(value);
  const dp = adaptiveDecimals(big.abs(), 10);
  const rounded = roundHalfUp(big, dp);
  const text = money(currency, Math.min(dp, 2), dp).format(toNumber(rounded.abs(), dp));
  return signed(text, rounded, false);
}

/**
 * Chaîne décimale exacte → « 123 456 789,123456789 » : la partie entière passe par Intl (BigInt,
 * donc sans perte), la partie décimale est recopiée telle quelle. Un `number` perdrait le 17e
 * chiffre significatif des grosses quantités.
 */
function groupedDecimal(abs: Big): string {
  const [int = '0', frac = ''] = abs.toFixed(QTY_DP).split('.');
  const digits = frac.replace(/0+$/, '');
  const grouped = PLAIN.format(BigInt(int));
  return digits ? `${grouped},${digits}` : grouped;
}

/** Quantité d'actif : jusqu'à 9 décimales exactes, abrégée (« 110 M ») si demandé. */
export function fmtQty(
  value: Big | DecimalString | null,
  opts: { abbreviate?: boolean; sign?: boolean } = {},
): string {
  if (value === null) return '—';
  const big = D(value);
  const abs = big.abs();
  if (opts.abbreviate && abs.gte('1000000')) {
    const millions = abs.div('1000000');
    const dp = millions.gte('100') ? 0 : 1;
    const rounded = roundHalfUp(millions, dp);
    return signed(`${PLAIN.format(toNumber(rounded, dp))} M`, big, opts.sign ?? false);
  }
  const rounded = roundHalfUp(big, QTY_DP);
  return signed(groupedDecimal(rounded.abs()), rounded, opts.sign ?? false);
}

/** `2026-06-24T18:55:00` → « 24/06/2026 · 18:55 ». */
export function fmtDateTime(naive: NaiveDateTime): string {
  const [date = '', time = ''] = naive.split('T');
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y} · ${time.slice(0, 5)}`;
}

export function fmtDate(naive: NaiveDateTime): string {
  const [y, m, d] = naive.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** « il y a 2 min », « il y a 3 h », « il y a 5 j » à partir d'une date ISO. */
export function fmtRelative(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

/** Jour local « AAAA-MM-JJ » d'un instant (noms de fichiers) : pas le jour UTC, qui diffère le soir. */
export function localDay(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Texte du mode discret : « •••• € » pour un montant, « •••• » pour une quantité. */
export function fmtMasked(currency?: Currency): string {
  return currency ? `${MASK}${NBSP}${CURRENCY_INFO[currency].symbol}` : MASK;
}

const PCT_POINTS = intl({ minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Écart entre deux pourcentages, en points (ratio 0,123 → « +12,3 pts »), arrondi une seule fois. */
export function fmtPoints(
  ratio: Big | DecimalString | null,
  opts: { sign?: boolean } = {},
): string {
  if (ratio === null) return '—';
  const rounded = roundHalfUp(D(ratio).times('100'), 1);
  const text = `${PCT_POINTS.format(toNumber(rounded.abs(), 1))} pts`;
  return signed(text, rounded, opts.sign ?? true);
}
