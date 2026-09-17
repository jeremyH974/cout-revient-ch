/**
 * Zoom et déplacement dans le temps d'une courbe, façon TradingView (décision n° 163) : une
 * **fenêtre visible** `[from, to]` (millisecondes) qu'on resserre autour d'un instant d'ancrage —
 * le curseur, le milieu d'un pincement — ou qu'on fait glisser, toujours bornée à la série entière.
 *
 * Le graphique ne trace ensuite que les points de la fenêtre : son échelle verticale, ses
 * graduations et ses extrêmes se recalent d'eux-mêmes sur ce qu'on regarde, ce qui est tout
 * l'intérêt de zoomer. Aucune dépendance Svelte : testable en Vitest, comme `geometry.ts`.
 */

export interface TimeWindow {
  from: number;
  to: number;
}

/** Nombre de points qu'une fenêtre resserrée au maximum doit encore contenir. */
export const MIN_VISIBLE_POINTS = 4;

/** Fenêtre de la série entière, `null` sans au moins deux instants distincts. */
export function fullWindow(times: readonly number[]): TimeWindow | null {
  if (times.length < 2) return null;
  const from = Math.min(...times);
  const to = Math.max(...times);
  return to > from ? { from, to } : null;
}

/**
 * Durée la plus courte qu'on laisse atteindre : celle des `MIN_VISIBLE_POINTS` points consécutifs
 * les plus serrés de la série. Zoomer au-delà ne montrerait rien de plus — la finesse d'une courbe
 * est celle de ses points, pas celle de l'écran.
 */
export function minimumSpan(times: readonly number[], full: TimeWindow): number {
  const sorted = [...times].sort((a, b) => a - b);
  const reach = MIN_VISIBLE_POINTS - 1;
  let best = full.to - full.from;
  for (let i = 0; i + reach < sorted.length; i++) {
    const span = sorted[i + reach]! - sorted[i]!;
    if (span > 0 && span < best) best = span;
  }
  return best;
}

/** Ramène une fenêtre dans la série entière en gardant sa durée (plafonnée à la série). */
export function clampWindow(view: TimeWindow, full: TimeWindow): TimeWindow {
  const span = Math.min(view.to - view.from, full.to - full.from);
  const from = Math.min(Math.max(view.from, full.from), full.to - span);
  return { from, to: from + span };
}

/**
 * Zoom d'un facteur `factor` (> 1 rapproche, < 1 éloigne) autour de l'instant `anchor`, qui garde
 * sa place à l'écran : ce qui était sous le curseur y reste.
 */
export function zoomWindow(
  view: TimeWindow,
  full: TimeWindow,
  anchor: number,
  factor: number,
  minSpan: number,
): TimeWindow {
  const span = view.to - view.from;
  if (!(span > 0) || !(factor > 0)) return clampWindow(view, full);
  const fullSpan = full.to - full.from;
  const next = Math.min(Math.max(span / factor, Math.min(minSpan, fullSpan)), fullSpan);
  const ratio = Math.min(Math.max((anchor - view.from) / span, 0), 1);
  const from = anchor - ratio * next;
  return clampWindow({ from, to: from + next }, full);
}

/** Déplacement de `delta` millisecondes (négatif = plus tôt), borné à la série entière. */
export function panWindow(view: TimeWindow, full: TimeWindow, delta: number): TimeWindow {
  return clampWindow({ from: view.from + delta, to: view.to + delta }, full);
}

/** Vrai si la fenêtre couvre toute la série (à la milliseconde près). */
export function isFullView(view: TimeWindow | null, full: TimeWindow | null): boolean {
  return view === null || full === null || (view.from <= full.from && view.to >= full.to);
}

/**
 * Indices `[début, fin]` des points à tracer pour une fenêtre (`times` croissants). S'il en reste
 * moins de deux — une fenêtre posée entre deux points d'une série clairsemée —, les voisins
 * immédiats sont repris : une courbe a besoin de deux points, et mieux vaut montrer les plus
 * proches qu'un graphique vide.
 */
export function visibleRange(
  times: readonly number[],
  view: TimeWindow | null,
): { start: number; end: number } {
  const n = times.length;
  if (view === null || n < 2) return { start: 0, end: n - 1 };
  let start = times.findIndex((t) => t >= view.from);
  if (start === -1) start = n;
  let end = n - 1;
  while (end >= 0 && times[end]! > view.to) end--;
  if (end - start + 1 >= 2) return { start, end };
  // Premier point après le trou (ou le point isolé de la fenêtre), jamais le tout premier.
  const pivot = Math.min(Math.max(Math.min(start, end + 1), 1), n - 1);
  return { start: pivot - 1, end: pivot };
}
