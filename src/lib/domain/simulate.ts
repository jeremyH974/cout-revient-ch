/**
 * Simulateur « et si ? » d'une position au coût moyen pondéré : rachat (le PRU bouge), vente
 * (le PRU ne bouge jamais — seule la quantité et le coût restants baissent), montant à investir
 * pour amener le PRU à une cible, et quantité à vendre pour récupérer sa mise. Module pur :
 * aucune écriture, mêmes règles que le moteur (décision n° 36) — une simulation qui divergerait
 * du moteur mentirait. Les frais suivent le modèle all-in du moteur : à l'achat ils réduisent la
 * quantité reçue (jamais le coût de revient) ; à la vente ils réduisent le produit net.
 */
import { ZERO_FEE, feeOnGross, type FeeRate } from './fees';
import { D, ZERO, divOrNull, type Big } from './money';

/** Position minimale à simuler : quantité détenue et coût total (base du PRU). */
export interface SimulatedPosition {
  qty: Big;
  costBasis: Big;
}

export interface SimulatedBuy {
  qtyBought: Big;
  qtyAfter: Big;
  costAfter: Big;
  /** Frais prélevés sur le montant dépensé (pourcentage + fixe). */
  feesEur: Big;
  pruBefore: Big | null;
  pruAfter: Big | null;
  /** Variation relative du PRU (ratio signé, −0,08 = PRU abaissé de 8 %) ; `null` sans PRU initial. */
  pruChange: Big | null;
}

/**
 * Rachat de `spendEur` (tout compris : c'est ce qui sort de la poche) au prix de marché
 * `priceEur`. Les frais réduisent la quantité reçue — le coût de revient reste `spendEur`,
 * all-in comme le moteur. `null` si les entrées n'ont pas de sens (prix nul, montant négatif ou
 * trop faible pour couvrir les frais fixes).
 */
export function simulateBuy(
  position: SimulatedPosition,
  spendEur: Big,
  priceEur: Big,
  fee: FeeRate = ZERO_FEE,
): SimulatedBuy | null {
  if (priceEur.lte(ZERO) || spendEur.lt(ZERO)) return null;
  if (D(fee.pctFee).lt(ZERO) || D(fee.pctFee).gte('100') || D(fee.fixedEur).lt(ZERO)) return null;
  const feesEur = feeOnGross(spendEur, fee);
  const invested = spendEur.minus(feesEur);
  if (spendEur.gt(ZERO) && invested.lte(ZERO)) return null;
  const qtyBought = invested.div(priceEur);
  const qtyAfter = position.qty.plus(qtyBought);
  const costAfter = position.costBasis.plus(spendEur);
  return {
    qtyBought,
    qtyAfter,
    costAfter,
    feesEur,
    pruBefore: divOrNull(position.costBasis, position.qty),
    pruAfter: divOrNull(costAfter, qtyAfter),
    pruChange: pruChange(position, costAfter, qtyAfter),
  };
}

function pruChange(position: SimulatedPosition, costAfter: Big, qtyAfter: Big): Big | null {
  const before = divOrNull(position.costBasis, position.qty);
  const after = divOrNull(costAfter, qtyAfter);
  if (before === null || after === null || before.lte(ZERO)) return null;
  return after.minus(before).div(before);
}

export interface SimulatedSell {
  qtySold: Big;
  /** Produit brut (quantité × prix), avant frais. */
  grossEur: Big;
  feesEur: Big;
  /** Produit net encaissé (brut − frais) : le « produit » au sens du moteur. */
  netProceedsEur: Big;
  /** Plus/moins-value réalisée FRAIS INCLUS : produit net − quantité vendue × PRU. */
  realizedEur: Big;
  qtyAfter: Big;
  costAfter: Big;
  /** Inchangé par construction (vendre ne modifie jamais le PRU) ; `null` si tout est vendu. */
  pruAfter: Big | null;
}

/** Vente de `qtySold` au prix `priceEur` ; `null` si la quantité n'est pas dans ]0 ; détenu]. */
export function simulateSell(
  position: SimulatedPosition,
  qtySold: Big,
  priceEur: Big,
  fee: FeeRate = ZERO_FEE,
): SimulatedSell | null {
  if (priceEur.lt(ZERO) || qtySold.lte(ZERO) || qtySold.gt(position.qty)) return null;
  const pru = divOrNull(position.costBasis, position.qty);
  if (pru === null) return null;
  const grossEur = qtySold.times(priceEur);
  const feesEur = feeOnGross(grossEur, fee);
  const netProceedsEur = grossEur.minus(feesEur);
  const realizedEur = netProceedsEur.minus(qtySold.times(pru));
  const qtyAfter = position.qty.minus(qtySold);
  const costAfter = pru.times(qtyAfter);
  return {
    qtySold,
    grossEur,
    feesEur,
    netProceedsEur,
    realizedEur,
    qtyAfter,
    costAfter,
    pruAfter: qtyAfter.gt(ZERO) ? pru : null,
  };
}

/**
 * Montant à investir au prix `priceEur` pour amener le PRU à `targetPru` (hors frais : le
 * montant rendu est le coût all-in à dépenser). Résout
 * `(coût + s) ÷ (qté + s ÷ p) = cible` → `s = p × (cible × qté − coût) ÷ (p − cible)`.
 * Défini seulement si la cible est STRICTEMENT entre le prix et le PRU actuel (en moyennant,
 * le PRU ne peut que se déplacer vers le prix payé, sans jamais l'atteindre) ; `null` sinon.
 */
export function spendToReachPru(
  position: SimulatedPosition,
  priceEur: Big,
  targetPru: Big,
): Big | null {
  if (priceEur.lte(ZERO) || position.qty.lte(ZERO)) return null;
  const pru = divOrNull(position.costBasis, position.qty);
  if (pru === null) return null;
  const between =
    (priceEur.lt(targetPru) && targetPru.lt(pru)) || (pru.lt(targetPru) && targetPru.lt(priceEur));
  if (!between) return null;
  return priceEur
    .times(targetPru.times(position.qty).minus(position.costBasis))
    .div(priceEur.minus(targetPru));
}

/**
 * Quantité à vendre au prix `priceEur` pour récupérer sa mise (le « net investi » : achats −
 * ventes), frais de vente compris : le produit NET doit rembourser la mise. Le reste de la
 * position ne joue alors plus que du gain. Approximation assumée : les frais fixes (0,12 €) sont
 * comptés sur cette seule transaction. `null` si la mise est déjà récupérée (netInvested ≤ 0),
 * si le prix est nul ou si les frais mangeraient tout.
 */
export function qtyToRecoverStake(
  netInvestedEur: Big,
  priceEur: Big,
  fee: FeeRate = ZERO_FEE,
): Big | null {
  if (priceEur.lte(ZERO) || netInvestedEur.lte(ZERO)) return null;
  const f = D(fee.pctFee).div('100');
  if (f.gte('1') || f.lt(ZERO)) return null;
  // qté × p × (1 − f) − fixe = mise → qté = (mise + fixe) ÷ (p × (1 − f)).
  return netInvestedEur.plus(D(fee.fixedEur)).div(priceEur.times(D('1').minus(f)));
}
