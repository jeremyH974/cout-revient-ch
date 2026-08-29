/**
 * Corrélations glissantes entre un actif et un indicateur macro.
 *
 * Ce module existe surtout pour ce qu'il **refuse** de faire. Quatre décisions, chacune contre une
 * erreur documentée :
 *
 * **1. Jamais sur les niveaux.** Corréler deux séries qui ont chacune une tendance donne un
 * coefficient proche de 1 sans qu'aucun lien n'existe — c'est la régression fallacieuse de Granger
 * et Newbold (1974). On corrèle donc des **variations** : rendements logarithmiques pour l'actif,
 * différences premières pour l'indicateur.
 *
 * **2. Sur les jours communs, et on dit combien on en jette.** La crypto cote sept jours sur sept,
 * les marchés de taux cinq. Reporter la dernière valeur du taux le week-end fabriquerait des
 * variations nulles qui diluent mécaniquement la covariance ; ne garder que les jours communs est
 * le moindre mal, à condition d'annoncer les jours écartés.
 *
 * **3. Spearman par défaut, pas Pearson.** Pearson est sensible aux valeurs extrêmes même sur
 * plusieurs centaines de points, et les rendements crypto en sont pleins. Spearman ne dépend que
 * des rangs : un krach compte comme le plus grand mouvement, pas comme cinquante fois le deuxième.
 *
 * **4. Jamais une seule fenêtre.** La corrélation glissante entre le bitcoin et à peu près
 * n'importe quoi change de signe selon la fenêtre choisie. En afficher quatre rend cette
 * instabilité visible, au lieu de laisser croire qu'un nombre unique existe. Choisir la fenêtre
 * après avoir vu les résultats serait exactement le p-hacking que cette précaution évite.
 *
 * Une corrélation n'est pas une causalité, et ce module n'en tire aucune conclusion.
 */

import { daysBetween, shiftDay, type DayValue } from './stats';

/** Séries superposées sur leurs seuls jours communs. */
export interface Aligned {
  days: readonly string[];
  asset: readonly number[];
  macro: readonly number[];
  /** Jours où l'actif cotait mais pas l'indicateur — écartés, et annoncés. */
  assetDaysDropped: number;
}

/**
 * Superpose deux séries sur les jours où **les deux** ont une observation.
 *
 * L'alignement se fait sur les niveaux, avant tout calcul de variation : ainsi une variation qui
 * enjambe un week-end l'enjambe des deux côtés, au lieu de comparer un rendement de trois jours à
 * un rendement d'un jour.
 */
export function alignOnCommonDays(asset: readonly DayValue[], macro: readonly DayValue[]): Aligned {
  const macroByDay = new Map(macro.map((point) => [point.day, point.value]));
  const days: string[] = [];
  const assetValues: number[] = [];
  const macroValues: number[] = [];
  let dropped = 0;
  for (const point of asset) {
    const other = macroByDay.get(point.day);
    if (other === undefined) {
      dropped += 1;
      continue;
    }
    days.push(point.day);
    assetValues.push(point.value);
    macroValues.push(other);
  }
  return { days, asset: assetValues, macro: macroValues, assetDaysDropped: dropped };
}

/** Variations d'un pas à l'autre : logarithmiques pour un prix, arithmétiques pour un indicateur. */
export interface Changes {
  days: readonly string[];
  asset: readonly number[];
  macro: readonly number[];
}

export function changesOf(aligned: Aligned): Changes {
  const days: string[] = [];
  const asset: number[] = [];
  const macro: number[] = [];
  for (let i = 1; i < aligned.days.length; i += 1) {
    const previousPrice = aligned.asset[i - 1];
    const price = aligned.asset[i];
    const previousMacro = aligned.macro[i - 1];
    const macroValue = aligned.macro[i];
    const day = aligned.days[i];
    if (
      day === undefined ||
      previousPrice === undefined ||
      price === undefined ||
      previousMacro === undefined ||
      macroValue === undefined ||
      previousPrice <= 0 ||
      price <= 0
    ) {
      continue;
    }
    days.push(day);
    asset.push(Math.log(price / previousPrice));
    macro.push(macroValue - previousMacro);
  }
  return { days, asset, macro };
}

/**
 * Rangs moyens : les ex æquo reçoivent la moyenne des rangs qu'ils occuperaient.
 *
 * C'est ce qui rend Spearman correct sur une série comportant des répétitions — et les variations
 * d'un taux affiché à deux décimales en comportent beaucoup.
 */
export function ranksOf(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index }));
  order.sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j += 1;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k]!.index] = averageRank;
    i = j + 1;
  }
  return ranks;
}

/**
 * Coefficient de Pearson, calculé sur les écarts à la moyenne plutôt que par la formule des sommes
 * de carrés : celle-ci perd toute précision quand la moyenne est loin de zéro.
 *
 * Rend `null` si l'une des deux séries est constante — une corrélation n'a alors pas de sens, et
 * la formule diviserait par zéro.
 */
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i += 1) {
    meanX += x[i]!;
    meanY += y[i]!;
  }
  meanX /= n;
  meanY /= n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i]! - meanX;
    const dy = y[i]! - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX <= 0 || varianceY <= 0) return null;
  const value = covariance / Math.sqrt(varianceX * varianceY);
  // Les arrondis flottants peuvent sortir de [-1, 1] d'un cheveu sur des séries quasi identiques.
  return Math.max(-1, Math.min(1, value));
}

/** Spearman : Pearson appliqué aux rangs. */
export const spearman = (x: readonly number[], y: readonly number[]): number | null =>
  pearson(ranksOf([...x]), ranksOf([...y]));

export interface Correlation {
  /** Longueur de la fenêtre, en jours calendaires. */
  windowDays: number;
  /** Spearman, de −1 à 1. */
  coefficient: number;
  /** Nombre de couples de variations réellement utilisés. */
  observations: number;
}

/** En dessous, un coefficient ne veut rien dire et n'est pas rendu. */
const MIN_OBSERVATIONS = 12;

/**
 * Corrélations sur plusieurs fenêtres glissantes se terminant à la dernière observation commune.
 *
 * Une fenêtre trop pauvre en observations est **omise**, pas rendue avec une réserve : un
 * coefficient sur huit points est du bruit présenté comme une mesure.
 */
export function correlationsOver(
  changes: Changes,
  windowsInDays: readonly number[],
): Correlation[] {
  const last = changes.days[changes.days.length - 1];
  if (last === undefined) return [];
  const out: Correlation[] = [];
  for (const windowDays of windowsInDays) {
    const from = shiftDay(last, -windowDays);
    const asset: number[] = [];
    const macro: number[] = [];
    for (const [index, day] of changes.days.entries()) {
      if (day < from) continue;
      asset.push(changes.asset[index]!);
      macro.push(changes.macro[index]!);
    }
    if (asset.length < MIN_OBSERVATIONS) continue;
    const coefficient = spearman(asset, macro);
    if (coefficient === null) continue;
    out.push({
      windowDays,
      coefficient: Math.round(coefficient * 1000) / 1000,
      observations: asset.length,
    });
  }
  return out;
}

export interface PairCorrelation {
  correlations: readonly Correlation[];
  /** Jours de cotation de l'actif écartés faute de contrepartie ce jour-là. */
  assetDaysDropped: number;
  /** Amplitude entre la plus faible et la plus forte des fenêtres : la mesure de l'instabilité. */
  spread: number | null;
}

/** Fenêtres affichées. Fixées ici, une fois pour toutes, et jamais choisies après coup. */
export const WINDOWS = [30, 90, 180, 365] as const;

/**
 * Tout le calcul, d'un actif et d'un indicateur bruts jusqu'aux coefficients.
 *
 * `spread` — l'écart entre la corrélation la plus faible et la plus forte des quatre fenêtres — est
 * rendu explicitement : c'est **l'instabilité elle-même** qui informe. Un écart de 0,8 signifie
 * qu'aucune de ces valeurs ne décrit une relation stable, et l'écran doit le dire plutôt que de
 * laisser choisir celle qui arrange.
 */
export function correlate(
  asset: readonly DayValue[],
  macro: readonly DayValue[],
  windowsInDays: readonly number[] = WINDOWS,
): PairCorrelation {
  const aligned = alignOnCommonDays(asset, macro);
  const correlations = correlationsOver(changesOf(aligned), windowsInDays);
  const values = correlations.map((c) => c.coefficient);
  const spread =
    values.length < 2
      ? null
      : Math.round((Math.max(...values) - Math.min(...values)) * 1000) / 1000;
  return { correlations, assetDaysDropped: aligned.assetDaysDropped, spread };
}

/** Nombre de jours couverts par une série, pour dire si l'historique suffit à une fenêtre donnée. */
export const spanInDays = (series: readonly DayValue[]): number => {
  const first = series[0];
  const last = series[series.length - 1];
  return first && last ? daysBetween(first.day, last.day) : 0;
};
