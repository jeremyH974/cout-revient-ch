/**
 * Ce que l'écran demande aux indicateurs macro : fraîcheur, tracé, ordre de lecture.
 *
 * Aucune requête ici non plus : l'instantané est compilé dans le bundle. Ce module ne fait que
 * lire, et il ne porte aucune interprétation — pas de seuil « élevé », pas de couleur d'alerte,
 * pas de composite. Un percentile, une date, une courbe.
 */

import { MACRO } from './snapshot.generated';
import type { CompactSeries, MacroIndicator } from './types';

export { MACRO };
export type { CompactSeries, MacroIndicator, MacroSnapshot, Rank } from './types';

/**
 * Ordre d'affichage, du plus au moins explicatif pour un portefeuille crypto.
 *
 * La liquidité d'abord — c'est le lien le plus souvent invoqué, et le seul dont l'ordre de
 * grandeur se compare aux flux du marché. Les taux réels ensuite, qui fixent le coût d'opportunité
 * d'un actif sans rendement. Le reste est du contexte de second rang. Cet ordre est un choix de
 * rédaction, comme le rang « majeure » du calendrier, et non le résultat d'une mesure.
 */
const ORDER = ['bank-reserves', 'real-10y', 'nominal-10y', 'spread-2s10s', 'wti'];

/** Indicateurs dans l'ordre de lecture ; ceux qu'on n'a pas classés viennent après. */
export function orderedIndicators(snapshot = MACRO): readonly MacroIndicator[] {
  const rank = (id: string): number => {
    const index = ORDER.indexOf(id);
    return index < 0 ? ORDER.length : index;
  };
  return [...snapshot.indicators].sort((a, b) => rank(a.id) - rank(b.id));
}

/**
 * Nombre de jours écoulés depuis la dernière observation. Sert à dire « au 28 août » plutôt qu'à
 * laisser croire que le chiffre est de ce matin.
 */
export function ageInDays(indicator: MacroIndicator, today: string): number {
  const age = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${indicator.asOf}T00:00:00Z`)) / 86_400_000,
  );
  return Number.isFinite(age) ? Math.max(0, age) : 0;
}

/**
 * La donnée a-t-elle dépassé sa propre tolérance ?
 *
 * Chaque indicateur porte la sienne : une série hebdomadaire n'a pas à être signalée périmée au
 * bout de trois jours. Le seuil est déclaré à la source, pas deviné ici.
 */
export const isStale = (indicator: MacroIndicator, today: string): boolean =>
  ageInDays(indicator, today) > indicator.staleAfterDays;

/**
 * Écart habituel entre deux observations, en jours : la **médiane** des écarts constatés.
 *
 * La médiane plutôt que la moyenne, parce qu'un seul trou d'un mois suffirait à tirer la moyenne
 * et à faire passer pour normal ce qui ne l'est pas. Rend 1 sur une série trop courte pour en
 * juger.
 */
export function normalGap(indices: readonly number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < indices.length; i += 1) gaps.push(indices[i]! - indices[i - 1]!);
  if (gaps.length === 0) return 1;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1] ?? 1;
}

export interface SparkGeometry {
  /** Chemin SVG, en plusieurs tronçons quand la série a des trous. */
  path: string;
  /** Position du dernier point, pour y poser un repère. */
  last: { x: number; y: number } | null;
  /** Ordonnée du zéro, quand la série change de signe — sinon `null`. */
  zeroY: number | null;
}

/**
 * Tracé d'une sparkline à partir de la série compacte.
 *
 * Deux choix expliquent le résultat. **L'abscisse suit l'index du tableau**, qui est un décalage
 * en jours calendaires : la courbe est donc proportionnelle au temps sans calcul supplémentaire,
 * et un week-end occupe la place qu'il occupe vraiment.
 *
 * **Un trou coupe le trait, mais seulement s'il est anormal.** La cadence propre à la série sert
 * de référence : une série hebdomadaire a six jours vides entre chaque point, et couper à chaque
 * fois ne dessinerait rien du tout — c'est ce qui rendait la courbe des réserves bancaires
 * invisible. Le trait n'est donc rompu qu'au-delà de trois fois l'écart habituel, ce qui distingue
 * la respiration normale d'une publication réellement manquée.
 *
 * L'échelle verticale est celle de la série elle-même, pas une échelle absolue : une sparkline
 * montre une forme, jamais un niveau — c'est le rôle du percentile affiché à côté.
 */
export function sparkGeometry(series: CompactSeries, width: number, height: number): SparkGeometry {
  const values = series.values;
  const finite = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (finite.length < 2 || values.length < 2) return { path: '', last: null, zeroY: null };

  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const x = (index: number): number => (index / (values.length - 1)) * width;
  const y = (value: number): number => height - ((value - min) / (max - min)) * height;

  const observed = [...values.entries()].filter(
    (entry): entry is [number, number] => entry[1] !== null && Number.isFinite(entry[1]),
  );
  // Trois fois la cadence habituelle, et jamais moins de huit jours : sur une série quotidienne,
  // un jour férié américain crée un trou de quatre jours, et rompre le trait à chaque fois
  // hacherait la courbe sans rien apprendre. Huit jours, c'est une publication vraiment manquée.
  const maxGap = Math.max(normalGap(observed.map(([index]) => index)) * 3, 8);

  const parts: string[] = [];
  let previousIndex: number | null = null;
  let last: { x: number; y: number } | null = null;
  for (const [index, value] of observed) {
    const point = { x: x(index), y: y(value) };
    const broken = previousIndex === null || index - previousIndex > maxGap;
    parts.push(`${broken ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`);
    previousIndex = index;
    last = point;
  }
  const zeroY = min < 0 && max > 0 ? y(0) : null;
  return { path: parts.join(' '), last, zeroY };
}
