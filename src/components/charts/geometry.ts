/**
 * Géométrie pure du graphique « Évolution » : abscisses proportionnelles au temps, trous (jours
 * ou pas intraday omis), plages colorables, graduations et point le plus proche du pointeur.
 * Aucune dépendance Svelte : testable en Vitest.
 */
import { pointMs } from '$lib/history/days';

export interface Layout {
  /** Abscisse (px) de chaque point. */
  xs: number[];
  /** Vrai si un trou sépare le point de son prédécesseur : le tracé est rompu. */
  holeBefore: boolean[];
}

/** Un écart supérieur à ce multiple du pas minimal de la série est un trou. */
const HOLE_FACTOR = 1.5;

/**
 * Abscisses proportionnelles aux instants (`YYYY-MM-DD` = minuit UTC, ISO 8601 = instant exact)
 * entre `left` et `right` ; repli sur l'index quand tous les instants coïncident.
 */
export function layoutX(days: readonly string[], left: number, right: number): Layout {
  const n = days.length;
  const xs: number[] = [];
  const holeBefore: boolean[] = [];
  if (n === 0) return { xs, holeBefore };
  const ts = days.map(pointMs);
  const t0 = ts[0]!;
  const span = ts[n - 1]! - t0;
  let step = Number.POSITIVE_INFINITY;
  for (let i = 1; i < n; i++) {
    const delta = ts[i]! - ts[i - 1]!;
    if (delta > 0 && delta < step) step = delta;
  }
  for (let i = 0; i < n; i++) {
    const ratio = span > 0 ? (ts[i]! - t0) / span : n > 1 ? i / (n - 1) : 0;
    xs.push(left + ratio * (right - left));
    holeBefore.push(i > 0 && Number.isFinite(step) && ts[i]! - ts[i - 1]! > step * HOLE_FACTOR);
  }
  return { xs, holeBefore };
}

export interface Segment {
  from: number;
  to: number;
}

/** Plages d'indices contigus (≥ 2 points) disposant d'une référence, sans trou à l'intérieur. */
export function segmentsOf(
  count: number,
  holeBefore: readonly boolean[],
  hasRef: (i: number) => boolean,
): Segment[] {
  const out: Segment[] = [];
  let start: number | null = null;
  const close = (end: number): void => {
    if (start !== null && end > start) out.push({ from: start, to: end });
    start = null;
  };
  for (let i = 0; i < count; i++) {
    if (holeBefore[i]) close(i - 1);
    if (hasRef(i)) start ??= i;
    else close(i - 1);
  }
  close(count - 1);
  return out;
}

/** Index du point dont l'abscisse est la plus proche de `px` (`xs` croissants), −1 si vide. */
export function nearestIndex(xs: readonly number[], px: number): number {
  const n = xs.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < px) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && px - xs[lo - 1]! <= xs[lo]! - px ? lo - 1 : lo;
}

/** Indices des graduations : `count` positions équiréparties en x, ramenées au point le plus proche. */
export function tickIndices(xs: readonly number[], count: number): number[] {
  const n = xs.length;
  if (n === 0) return [];
  if (n < 2 || count < 2) return [0];
  const left = xs[0]!;
  const right = xs[n - 1]!;
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const i = nearestIndex(xs, left + ((right - left) * k) / (count - 1));
    if (out[out.length - 1] !== i) out.push(i);
  }
  return out;
}

/** Index du point du jour exact, −1 si ce jour n'est pas tracé (hors fenêtre ou omis). */
export function markerIndex(days: readonly string[], day: string): number {
  return days.indexOf(day);
}

/** Graduations « rondes » (1, 2, 5 × 10ⁿ) dans [min, max], environ `target` valeurs. */
export function niceTicks(min: number, max: number, target = 3): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const raw = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  const out: number[] = [];
  for (let k = Math.ceil(min / step - 1e-9); k * step <= max + step * 1e-9; k++) {
    const v = k * step;
    out.push(v === 0 ? 0 : v); // jamais -0
  }
  return out;
}
