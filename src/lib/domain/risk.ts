/**
 * Mesures de risque (décision n° 41) — repli maximal, volatilité, Sortino, régularité.
 *
 * **Elles se calculent sur l'INDICE de performance, jamais sur la valeur du portefeuille.** Un
 * retrait de 10 000 € fait chuter la valeur brute sans qu'aucune perte n'ait eu lieu : mesurer le
 * repli dessus inventerait des krachs les jours de virement. L'indice `TwrIndexPoint` neutralise
 * déjà les apports et les retraits (Dietz modifié chaîné, `twr.ts`), c'est donc la seule série sur
 * laquelle « quelle baisse ai-je encaissée ? » a un sens — c'est aussi ce que mesurent les outils
 * de référence (IBKR PortfolioAnalyst, Portfolio Performance).
 *
 * Module pur : `Big` de bout en bout, aucun arrondi d'affichage. Les seules frontières flottantes
 * sont les racines (écart-type, annualisation) — un ratio n'est pas un montant (décision n° 27),
 * il ne repart jamais dans un calcul monétaire.
 */
import { Big, D, ONE, ZERO } from './money';
import type { TwrIndexPoint } from './twr';

/** Jours de cotation par an : la crypto se négocie en continu, 365 (et non 252 comme en bourse). */
export const YEAR_DAYS = 365;
/** En dessous, un écart-type n'a pas de sens statistique : on ne montre pas de volatilité. */
export const RISK_MIN_DAYS = 30;

/** Un repli : de son plus haut à son point bas, et la date où le plus haut a été retrouvé. */
export interface Drawdown {
  /** Profondeur en ratio POSITIF (0,42 = −42 % depuis le plus haut). */
  depth: Big;
  peakDay: string;
  troughDay: string;
  /** Jour où le plus haut précédent a été retrouvé ; `null` si le repli court toujours. */
  recoveredDay: string | null;
}

export interface RiskMetrics {
  /** Nombre de rendements quotidiens exploités (points de la série − 1). */
  days: number;
  /** Repli le plus profond de la période ; `null` si l'indice n'a jamais reculé. */
  maxDrawdown: Drawdown | null;
  /** Écart au plus haut historique au dernier jour (0 = au plus haut). */
  currentDrawdown: Big;
  /** Écart-type des rendements quotidiens, puis annualisé (× √365) ; `null` sous 30 jours. */
  volatilityDaily: Big | null;
  volatilityAnnual: Big | null;
  /** Écart-type des seuls rendements NÉGATIFS, annualisé — le risque qui fait mal. */
  downsideAnnual: Big | null;
  /**
   * Sortino = rendement annualisé ÷ volatilité baissière annualisée. Cible de rendement à 0 % :
   * l'hypothèse est explicitée à l'affichage. `null` si l'un des deux manque, ou si l'indice n'a
   * jamais reculé (pas de dénominateur).
   */
  sortino: Big | null;
  positiveDays: number;
  negativeDays: number;
  /** Meilleur et pire rendement quotidien de la période. */
  bestDay: { day: string; ret: Big } | null;
  worstDay: { day: string; ret: Big } | null;
}

/** Racine carrée d'un `Big` positif (big.js ne l'expose que sur les valeurs ≥ 0). */
function sqrt(value: Big): Big {
  return value.lte(ZERO) ? ZERO : value.sqrt();
}

/**
 * Mesures de risque d'un indice de performance.
 *
 * @param index série base 1, un point par jour, telle que produite par `twrEur`
 * @param annualizedReturn rendement annualisé de la même période (TWR), pour le Sortino
 * @returns `null` si la série est trop courte pour dire quoi que ce soit (moins de deux points)
 */
export function riskMetrics(
  index: readonly TwrIndexPoint[],
  annualizedReturn: Big | null = null,
): RiskMetrics | null {
  if (index.length < 2) return null;

  // Rendements quotidiens r_t = I_t / I_{t−1} − 1 (un indice nul ou négatif est impossible ici :
  // `twrEur` neutralise les facteurs ≤ 0 ; on se protège quand même plutôt que de diviser par 0).
  const returns: { day: string; ret: Big }[] = [];
  for (let i = 1; i < index.length; i++) {
    const previous = index[i - 1]!;
    const today = index[i]!;
    if (previous.index.lte(ZERO)) continue;
    returns.push({ day: today.day, ret: today.index.div(previous.index).minus(ONE) });
  }
  if (returns.length === 0) return null;

  // Repli : on suit le plus haut atteint, et on garde le creux le plus profond sous ce plus haut.
  let peak = index[0]!;
  let peakOfMax = peak;
  let troughOfMax: TwrIndexPoint | null = null;
  let maxDepth = ZERO;
  let recoveredDay: string | null = null;
  let currentPeak = index[0]!.index;
  for (const point of index) {
    if (point.index.gte(currentPeak)) {
      // Nouveau plus haut : le repli en cours (s'il y en avait un) est comblé.
      if (troughOfMax !== null && recoveredDay === null && point.index.gte(peakOfMax.index))
        recoveredDay = point.day;
      currentPeak = point.index;
      peak = point;
      continue;
    }
    const depth = currentPeak.minus(point.index).div(currentPeak);
    if (depth.gt(maxDepth)) {
      maxDepth = depth;
      peakOfMax = peak;
      troughOfMax = point;
      recoveredDay = null;
    }
  }
  const last = index[index.length - 1]!;
  const currentDrawdown = currentPeak.gt(ZERO)
    ? currentPeak.minus(last.index).div(currentPeak).round(18, Big.roundHalfUp)
    : ZERO;

  const positives = returns.filter((r) => r.ret.gt(ZERO));
  const negatives = returns.filter((r) => r.ret.lt(ZERO));
  const enough = returns.length >= RISK_MIN_DAYS;
  const annualFactor = sqrt(D(String(YEAR_DAYS)));

  // Écart-type d'échantillon (dénominateur n − 1) sur tous les rendements ; puis sur les seuls
  // rendements négatifs, en gardant le MÊME dénominateur (convention de la volatilité baissière :
  // les jours de hausse comptent comme des écarts nuls, pas comme des observations absentes).
  const mean = returns.reduce((acc, r) => acc.plus(r.ret), ZERO).div(D(String(returns.length)));
  const variance = returns
    .reduce((acc, r) => acc.plus(r.ret.minus(mean).pow(2)), ZERO)
    .div(D(String(Math.max(1, returns.length - 1))));
  const downsideVariance = negatives
    .reduce((acc, r) => acc.plus(r.ret.pow(2)), ZERO)
    .div(D(String(Math.max(1, returns.length - 1))));

  const volatilityDaily = enough ? sqrt(variance).round(18, Big.roundHalfUp) : null;
  const volatilityAnnual =
    volatilityDaily === null
      ? null
      : volatilityDaily.times(annualFactor).round(18, Big.roundHalfUp);
  const downsideDaily = enough ? sqrt(downsideVariance) : null;
  const downsideAnnual =
    downsideDaily === null || downsideDaily.lte(ZERO)
      ? null
      : downsideDaily.times(annualFactor).round(18, Big.roundHalfUp);

  const sortino =
    annualizedReturn === null || downsideAnnual === null
      ? null
      : annualizedReturn.div(downsideAnnual).round(6, Big.roundHalfUp);

  const extreme = (list: typeof returns, pick: (a: Big, b: Big) => boolean) =>
    list.reduce<{ day: string; ret: Big } | null>(
      (best, r) => (best === null || pick(r.ret, best.ret) ? r : best),
      null,
    );

  return {
    days: returns.length,
    maxDrawdown:
      troughOfMax === null
        ? null
        : {
            depth: maxDepth.round(18, Big.roundHalfUp),
            peakDay: peakOfMax.day,
            troughDay: troughOfMax.day,
            recoveredDay,
          },
    currentDrawdown,
    volatilityDaily,
    volatilityAnnual,
    downsideAnnual,
    sortino,
    positiveDays: positives.length,
    negativeDays: negatives.length,
    bestDay: extreme(returns, (a, b) => a.gt(b)),
    worstDay: extreme(returns, (a, b) => a.lt(b)),
  };
}
