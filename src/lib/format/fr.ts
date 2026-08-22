/**
 * Formatage fr-FR : le SEUL endroit du projet qui arrondit.
 * Signe moins typographique (U+2212), espaces insécables gérées par Intl.
 */
import { Big, D, type DecimalString } from '../domain/money';
import type { NaiveDateTime } from '../domain/types';

const HALF_UP = Big.roundHalfUp;
const MINUS = '−';

function intl(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return new Intl.NumberFormat('fr-FR', options);
}

const EUR_2 = intl({
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const EUR_0 = intl({
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const PCT_1 = intl({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const PLAIN = intl({ maximumFractionDigits: 20 });

function signed(text: string, negative: boolean, showPlus: boolean): string {
  const clean = text.replace(/^-/, '');
  if (negative) return `${MINUS}${clean}`;
  return showPlus ? `+${clean}` : clean;
}

function toNumber(value: Big, dp: number): number {
  return Number(value.round(dp, HALF_UP).toFixed(dp));
}

/** Montant en euros : 2 décimales (0 si ≥ 100 000 € en mode compact). */
export function fmtEur(
  value: Big | DecimalString | null,
  opts: { sign?: boolean; compact?: boolean } = {},
): string {
  if (value === null) return '—';
  const big = D(value);
  const negative = big.lt('0');
  const abs = big.abs();
  const formatter = opts.compact && abs.gte('100000') ? EUR_0 : EUR_2;
  return signed(formatter.format(toNumber(abs, 2)), negative, opts.sign ?? false);
}

/** Ratio (0,1234) → pourcentage (« +12,3 % »). */
export function fmtPct(ratio: Big | DecimalString | null, opts: { sign?: boolean } = {}): string {
  if (ratio === null) return '—';
  const big = D(ratio);
  return signed(PCT_1.format(toNumber(big.abs(), 4)), big.lt('0'), opts.sign ?? true);
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

/** Prix unitaire en euros avec décimales adaptées (0,000003 € lisible). */
export function fmtPrice(value: Big | DecimalString | null): string {
  if (value === null) return '—';
  const big = D(value);
  const abs = big.abs();
  const dp = adaptiveDecimals(abs, 10);
  const formatter = intl({
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: Math.min(dp, 2),
    maximumFractionDigits: dp,
  });
  return signed(formatter.format(toNumber(abs, dp)), big.lt('0'), false);
}

/** Quantité d'actif : jusqu'à 8 décimales, abrégée (« 110 M ») si demandé. */
export function fmtQty(
  value: Big | DecimalString | null,
  opts: { abbreviate?: boolean; sign?: boolean } = {},
): string {
  if (value === null) return '—';
  const big = D(value);
  const abs = big.abs();
  if (opts.abbreviate && abs.gte('1000000')) {
    const millions = abs.div('1000000');
    const text = `${PLAIN.format(toNumber(millions, millions.gte('100') ? 0 : 1))} M`;
    return signed(text, big.lt('0'), opts.sign ?? false);
  }
  const dp = abs.gte('1') ? 8 : adaptiveDecimals(abs, 10);
  const text = intl({ maximumFractionDigits: dp }).format(toNumber(abs, dp));
  return signed(text, big.lt('0'), opts.sign ?? false);
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
