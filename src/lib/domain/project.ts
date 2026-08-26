/**
 * Projections « et si ? » (décision n° 46) — des SCÉNARIOS, jamais des prévisions.
 *
 * Rien ici ne devine l'avenir : l'utilisateur choisit lui-même la variation de prix à supposer, et
 * le module se contente d'en tirer les conséquences arithmétiques sur son PRU, son investi et sa
 * position. C'est la différence entre « voici ce qui va se passer » (qu'aucune app honnête ne peut
 * dire) et « voici ce qu'impliquerait cette hypothèse » (qui aide vraiment à décider).
 *
 * Deux hypothèses de calcul, à afficher partout où le résultat apparaît :
 * - les versements sont mensuels, réguliers, et passés au même barème de frais ;
 * - la variation de prix choisie s'étale **linéairement** sur la période (un chemin parmi une
 *   infinité : le marché ne monte jamais en ligne droite, et le PRU obtenu dépend du chemin).
 *
 * Module pur : `Big` de bout en bout. La seule frontière flottante est l'exposant du taux annuel
 * requis — un taux n'est pas un montant (décision n° 27), il ne repart pas dans un calcul monétaire.
 */
import { feeOnGross, type FeeRate } from './fees';
import { Big, D, ONE, ZERO } from './money';

/** Nombre maximal de mois projetés : au-delà, l'hypothèse de régularité n'a plus de sens. */
export const MAX_PLAN_MONTHS = 120;

export interface DcaPlanInput {
  /** Position de départ (quantité et coût total), telle que la voit le moteur. */
  position: { qty: Big; costBasis: Big };
  /** Versement mensuel, dans la devise des montants fournis. */
  monthlyEur: Big;
  /** Nombre de versements (1 à `MAX_PLAN_MONTHS`). */
  months: number;
  /** Prix de départ de l'actif. */
  priceEur: Big;
  fee: FeeRate;
  /**
   * Variation TOTALE du prix supposée sur la période (0,5 = +50 %, −0,3 = −30 %), répartie
   * linéairement d'un mois sur l'autre. Choisie par l'utilisateur, jamais déduite d'un modèle.
   */
  priceChange: Big;
}

export interface DcaPlanResult {
  /** Somme des versements (frais compris : c'est ce qui sort du compte). */
  investedEur: Big;
  /** Part des versements absorbée par les frais. */
  feesEur: Big;
  qtyAcquired: Big;
  qtyAfter: Big;
  costAfter: Big;
  pruAfter: Big | null;
  /** Prix au dernier versement, selon le scénario choisi. */
  finalPriceEur: Big;
  valueAfter: Big;
  unrealizedAfter: Big;
}

/**
 * Déroule un plan de versements mensuels. `null` si les entrées n'ont pas de sens (versement ou
 * prix nuls, horizon hors bornes) — mieux vaut ne rien afficher qu'un scénario absurde.
 */
export function projectDca(input: DcaPlanInput): DcaPlanResult | null {
  const { monthlyEur, months, priceEur, priceChange } = input;
  if (!monthlyEur.gt(ZERO) || !priceEur.gt(ZERO)) return null;
  if (!Number.isInteger(months) || months < 1 || months > MAX_PLAN_MONTHS) return null;
  // Un prix final négatif n'existe pas : la variation est bornée à −100 %.
  const change = priceChange.lt(D('-1')) ? D('-1') : priceChange;

  let qtyAcquired = ZERO;
  let feesEur = ZERO;
  let lastPrice = priceEur;
  const steps = D(String(months));
  for (let i = 1; i <= months; i++) {
    // Interpolation linéaire : au i-ème versement, le prix a parcouru i/months de la variation.
    const progress = D(String(i)).div(steps);
    const price = priceEur.times(ONE.plus(change.times(progress)));
    lastPrice = price;
    if (!price.gt(ZERO)) continue;
    const fees = feeOnGross(monthlyEur, input.fee);
    const net = monthlyEur.minus(fees);
    if (!net.gt(ZERO)) continue;
    feesEur = feesEur.plus(fees);
    // Arrondi à chaque pas : sans lui, la quantité chaînée gagne des décimales à chaque mois.
    qtyAcquired = qtyAcquired.plus(net.div(price)).round(18, Big.roundHalfUp);
  }

  const investedEur = monthlyEur.times(steps);
  const qtyAfter = input.position.qty.plus(qtyAcquired);
  const costAfter = input.position.costBasis.plus(investedEur);
  const valueAfter = qtyAfter.times(lastPrice);
  return {
    investedEur,
    feesEur,
    qtyAcquired,
    qtyAfter,
    costAfter,
    pruAfter: qtyAfter.gt(ZERO) ? costAfter.div(qtyAfter).round(18, Big.roundHalfUp) : null,
    finalPriceEur: lastPrice,
    valueAfter,
    unrealizedAfter: valueAfter.minus(costAfter),
  };
}

/**
 * Taux annuel qu'il faudrait tenir pour qu'une valeur actuelle atteigne une cible en `years`
 * années : `(cible ÷ actuel)^(1/années) − 1`. C'est une CONTRAINTE arithmétique, pas une
 * prévision : elle répond à « qu'est-ce que cet objectif suppose ? », pas à « vais-je l'atteindre ».
 * `null` si l'une des entrées rend la question vide de sens.
 */
export function requiredAnnualRate(current: Big, target: Big, years: number): Big | null {
  if (!current.gt(ZERO) || !target.gt(ZERO)) return null;
  if (!Number.isFinite(years) || years <= 0) return null;
  const ratio = Number(target.div(current).toString());
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const rate = Math.pow(ratio, 1 / years) - 1;
  if (!Number.isFinite(rate)) return null;
  return D(rate.toFixed(12));
}

/**
 * Versement mensuel nécessaire pour atteindre une cible, à rendement supposé NUL — le seul cas où
 * la réponse ne dépend d'aucune hypothèse de marché. Toute autre hypothèse relèverait de la
 * prévision, que ce module refuse.
 */
export function monthlyToReach(current: Big, target: Big, months: number): Big | null {
  if (!Number.isInteger(months) || months < 1 || months > MAX_PLAN_MONTHS) return null;
  const missing = target.minus(current);
  if (!missing.gt(ZERO)) return null;
  return missing.div(D(String(months))).round(2, Big.roundHalfUp);
}
