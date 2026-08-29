/**
 * Superposition de deux séries sur **un seul axe**.
 *
 * Trois refus fondent ce module, et chacun vise une erreur documentée.
 *
 * **Jamais de double axe.** Deux ordonnées indépendantes permettent d'étirer l'une ou l'autre
 * jusqu'à faire coïncider n'importe quelles courbes : la corrélation apparente devient un choix de
 * graphiste. Les deux séries sont donc ramenées à une base commune de 100 et partagent la même
 * échelle — ce qu'on lit est alors une vraie comparaison de trajectoires.
 *
 * **Jamais la valeur brute d'un portefeuille.** Un patrimoine monte parce qu'on y verse de
 * l'argent, pas seulement parce que le marché monte ; le comparer à une série sans apports fait
 * apparaître une surperformance qui n'existe pas. C'est un défaut réel et documenté chez d'autres
 * outils. La superposition prend donc l'**indice de rendement pondéré temps** (`twr.ts`), où les
 * apports sont neutralisés par construction.
 *
 * **Jamais une date de départ choisie après coup.** Le rebasage se fait au premier jour commun aux
 * deux séries, jamais à une date qui flatterait la lecture, et l'écran affiche laquelle.
 */

import { type DayValue } from './stats';

/**
 * Ramène une série à `base` à son premier point au jour `from` ou après.
 *
 * Rend une liste vide si la base est nulle ou négative : diviser par elle produirait des valeurs
 * sans signification plutôt qu'une erreur visible.
 */
export function rebase(series: readonly DayValue[], from: string, base = 100): DayValue[] {
  const start = series.find((point) => point.day >= from);
  if (!start || start.value <= 0) return [];
  return series
    .filter((point) => point.day >= start.day)
    .map((point) => ({ day: point.day, value: (point.value / start.value) * base }));
}

export interface OverlayGeometry {
  /** Chemins SVG des deux séries, dans la même échelle. */
  paths: readonly [string, string];
  /** Bornes de l'axe commun, pour l'étiqueter. */
  min: number;
  max: number;
  /** Premier et dernier jour tracés. */
  from: string;
  to: string;
  /** Ordonnée de la base 100, seule ligne de repère utile. */
  baseY: number;
}

/**
 * Trace deux séries déjà rebasées sur une échelle commune.
 *
 * L'abscisse est proportionnelle au temps — position du jour dans l'intervalle total, et non index
 * dans le tableau — pour que deux séries de cadences différentes restent superposables sans se
 * décaler.
 */
export function overlayGeometry(
  first: readonly DayValue[],
  second: readonly DayValue[],
  width: number,
  height: number,
  base = 100,
): OverlayGeometry | null {
  const all = [...first, ...second];
  if (first.length < 2 || second.length < 2) return null;

  const days = all.map((point) => point.day).sort();
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const span = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  if (!Number.isFinite(span) || span <= 0) return null;

  const values = all.map((point) => point.value).filter(Number.isFinite);
  let min = Math.min(...values, base);
  let max = Math.max(...values, base);
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const x = (day: string): number =>
    ((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / span) * width;
  const y = (value: number): number => height - ((value - min) / (max - min)) * height;
  const pathOf = (series: readonly DayValue[]): string =>
    series
      .filter((point) => Number.isFinite(point.value))
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'}${x(point.day).toFixed(1)} ${y(point.value).toFixed(1)}`,
      )
      .join(' ');

  return {
    paths: [pathOf(first), pathOf(second)],
    min,
    max,
    from,
    to,
    baseY: y(base),
  };
}

/** Premier jour présent dans les deux séries : la seule date de rebasage non arbitraire. */
export function firstCommonDay(
  first: readonly DayValue[],
  second: readonly DayValue[],
): string | null {
  const secondDays = new Set(second.map((point) => point.day));
  for (const point of first) if (secondDays.has(point.day)) return point.day;
  return null;
}
