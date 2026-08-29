/**
 * Les statistiques du contexte macro : rang percentile, transformations, séries datées.
 *
 * Module **pur**, sans réseau ni DOM, partagé entre le générateur (qui calcule les rangs en CI, où
 * il a vingt ans d'historique) et l'application (qui n'embarque que deux ans). C'est le seul
 * endroit où une décision statistique est prise, et chacune y est justifiée.
 *
 * Le `number` est ici légitime, contrairement au moteur de PRU : un taux à dix ans n'est ni un
 * montant ni une quantité détenue, il n'entre dans aucune addition de portefeuille, et sa
 * cinquième décimale n'a pas de sens économique. La règle « aucun `number` ne porte un montant »
 * protège l'arithmétique des positions ; elle n'a rien à faire ici.
 */

/** Une observation datée. Les séries sont creuses : week-ends et jours fériés manquent. */
export interface DayValue {
  /** `AAAA-MM-JJ`. */
  day: string;
  value: number;
}

const DAY_MS = 86_400_000;

/** `AAAA-MM-JJ` → millisecondes UTC. `NaN` si la date est illisible. */
export const dayToMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** Millisecondes UTC → `AAAA-MM-JJ`. */
export const msToDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Nombre de jours calendaires entre deux jours (positif si `to` est après `from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayToMs(to) - dayToMs(from)) / DAY_MS);
}

/** `AAAA-MM-JJ` décalé de `days` jours calendaires. */
export const shiftDay = (day: string, days: number): string =>
  msToDay(dayToMs(day) + days * DAY_MS);

/**
 * Rang percentile de `x` dans `values`, de 0 à 100.
 *
 * Définition retenue : **rang moyen** — la moitié des ex æquo compte de chaque côté. C'est le seul
 * choix qui rende `percentileRank(v, min) > 0` et `percentileRank(v, max) < 100` sur une série
 * comportant des répétitions, et qui évite qu'une valeur très fréquente saute de 0 à 100 selon
 * l'inégalité choisie.
 *
 * Aucune hypothèse n'est faite sur la distribution : c'est précisément ce qu'on cherche face à des
 * séries à queues épaisses, où un z-score rendrait des écarts absurdes.
 */
export function percentileRank(values: readonly number[], x: number): number {
  if (values.length === 0 || !Number.isFinite(x)) return Number.NaN;
  let below = 0;
  let equal = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < x) below += 1;
    else if (value === x) equal += 1;
  }
  const total = values.filter(Number.isFinite).length;
  if (total === 0) return Number.NaN;
  return ((below + equal / 2) / total) * 100;
}

/**
 * Dernière valeur connue au jour `day`, ou avant.
 *
 * `maxStaleDays` plafonne le report : au-delà, la fonction rend `null` plutôt qu'une valeur qui
 * ferait croire que l'indicateur n'a pas bougé alors qu'il n'a pas été republié. C'est le piège
 * classique du comblement silencieux.
 *
 * La série doit être triée par jour croissant ; la recherche est dichotomique.
 */
export function asOf(
  series: readonly DayValue[],
  day: string,
  maxStaleDays: number,
): DayValue | null {
  let low = 0;
  let high = series.length - 1;
  let found: DayValue | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = series[middle];
    if (!candidate) break;
    if (candidate.day <= day) {
      found = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (!found) return null;
  return daysBetween(found.day, day) <= maxStaleDays ? found : null;
}

/**
 * Variation absolue sur `days` jours calendaires, en unité d'origine.
 *
 * La valeur de référence est cherchée **à la date décalée ou avant**, avec une tolérance : une
 * série hebdomadaire n'a pas de point exactement 90 jours plus tôt. Rend `null` si le passé
 * manque — mieux vaut ne rien afficher qu'une variation calculée sur une base fantôme.
 */
export function changeOver(
  series: readonly DayValue[],
  days: number,
  tolerance = 10,
): number | null {
  const last = series[series.length - 1];
  if (!last) return null;
  const past = asOf(series, shiftDay(last.day, -days), tolerance);
  return past ? last.value - past.value : null;
}

/** Variation **relative** sur `days` jours, en pourcentage. `null` si la base est nulle ou absente. */
export function relativeChangeOver(
  series: readonly DayValue[],
  days: number,
  tolerance = 10,
): number | null {
  const last = series[series.length - 1];
  if (!last) return null;
  const past = asOf(series, shiftDay(last.day, -days), tolerance);
  if (!past || past.value === 0) return null;
  return ((last.value - past.value) / Math.abs(past.value)) * 100;
}

/**
 * Applique une transformation à toute la série, point par point, pour pouvoir en classer
 * l'historique.
 *
 * Chaque point porte la variation calculée **à cette date-là**, avec les seules données
 * disponibles à cette date : le rang est donc comparable au rang d'aujourd'hui, sans regarder vers
 * l'avenir. Les points dont le passé manque sont simplement absents.
 */
export function transformSeries(
  series: readonly DayValue[],
  kind: 'level' | 'yoy' | 'change3m',
): DayValue[] {
  if (kind === 'level') return [...series];
  const days = kind === 'yoy' ? 365 : 91;
  const tolerance = kind === 'yoy' ? 20 : 10;
  const out: DayValue[] = [];
  for (const [index, point] of series.entries()) {
    const window = series.slice(0, index + 1);
    const past = asOf(window, shiftDay(point.day, -days), tolerance);
    if (!past) continue;
    if (kind === 'yoy') {
      if (past.value === 0) continue;
      out.push({
        day: point.day,
        value: ((point.value - past.value) / Math.abs(past.value)) * 100,
      });
    } else {
      out.push({ day: point.day, value: point.value - past.value });
    }
  }
  return out;
}

/** Rendements logarithmiques d'une série de prix. Ignore les points non strictement positifs. */
export function logReturns(series: readonly DayValue[]): DayValue[] {
  const out: DayValue[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const previous = series[i - 1];
    const current = series[i];
    if (!previous || !current || previous.value <= 0 || current.value <= 0) continue;
    out.push({ day: current.day, value: Math.log(current.value / previous.value) });
  }
  return out;
}

/**
 * Écart-type annualisé des rendements, en pourcentage.
 *
 * Calculé par l'algorithme de Welford — écarts à la moyenne courante plutôt que somme des carrés,
 * qui perd toute précision quand la moyenne est loin de zéro. Sur des rendements déjà centrés le
 * risque est faible, mais la formule naïve n'apporte rien en échange.
 *
 * `periodsPerYear` vaut 365 pour un actif qui cote sept jours sur sept, 252 pour un marché fermé
 * le week-end.
 */
export function annualisedVolatility(
  returns: readonly DayValue[],
  periodsPerYear = 365,
): number | null {
  let count = 0;
  let mean = 0;
  let m2 = 0;
  for (const point of returns) {
    if (!Number.isFinite(point.value)) continue;
    count += 1;
    const delta = point.value - mean;
    mean += delta / count;
    m2 += delta * (point.value - mean);
  }
  if (count < 2) return null;
  return Math.sqrt(m2 / (count - 1)) * Math.sqrt(periodsPerYear) * 100;
}

/**
 * Volatilité réalisée glissante : pour chaque jour, l'écart-type annualisé des `window` derniers
 * rendements. Sert à classer la volatilité d'aujourd'hui parmi celles du passé.
 */
export function rollingVolatility(
  returns: readonly DayValue[],
  window: number,
  periodsPerYear = 365,
): DayValue[] {
  const out: DayValue[] = [];
  for (let end = window; end <= returns.length; end += 1) {
    const slice = returns.slice(end - window, end);
    const value = annualisedVolatility(slice, periodsPerYear);
    const last = slice[slice.length - 1];
    if (value !== null && last) out.push({ day: last.day, value });
  }
  return out;
}

/** Points d'une série dont le jour est supérieur ou égal à `from`. */
export const since = (series: readonly DayValue[], from: string): DayValue[] =>
  series.filter((point) => point.day >= from);

/**
 * Série creuse → tableau indexé par jours calendaires, avec `null` pour les jours sans
 * observation. C'est la forme committée : dense, compressible, et qui ne prétend pas connaître les
 * jours manquants.
 */
export function toCompact(series: readonly DayValue[]): {
  from: string;
  values: (number | null)[];
} {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return { from: '1970-01-01', values: [] };
  const span = daysBetween(first.day, last.day);
  const values: (number | null)[] = Array.from({ length: span + 1 }, () => null);
  for (const point of series) values[daysBetween(first.day, point.day)] = point.value;
  return { from: first.day, values };
}

/** L'inverse : reconstruit la série creuse, sans inventer les jours absents. */
export function fromCompact(compact: {
  from: string;
  values: readonly (number | null)[];
}): DayValue[] {
  const out: DayValue[] = [];
  for (const [offset, value] of compact.values.entries()) {
    if (value === null || !Number.isFinite(value)) continue;
    out.push({ day: shiftDay(compact.from, offset), value });
  }
  return out;
}
