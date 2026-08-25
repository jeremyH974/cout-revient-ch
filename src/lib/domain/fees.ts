/**
 * Barème de frais d'une opération spot : un pourcentage du montant + un fixe par transaction.
 * Les préréglages reprennent la grille tarifaire Coinhouse Particuliers « Classique » publiée le
 * 18/08/2026 (PDF officiel, aussi cité par la feuille de route [S7]) ; ils restent des valeurs
 * PAR DÉFAUT, éditables dans l'interface — une grille change, l'outil ne doit pas mentir.
 */
import { D, ZERO, type Big, type DecimalString } from './money';

export interface FeeRate {
  /** Pourcentage du montant brut (ex. '1.29' = 1,29 %). */
  pctFee: DecimalString;
  /** Frais de traitement fixes par transaction, en euros. */
  fixedEur: DecimalString;
}

export const ZERO_FEE: FeeRate = { pctFee: '0', fixedEur: '0' };

export type CoinhouseFeeKind =
  'buy-sepa' | 'buy-card' | 'sell-eur' | 'crypto-crypto' | 'stable-stable';

/** Grille Coinhouse Particuliers « Classique » du 18/08/2026 (frais fixes 0,12 € partout). */
export const COINHOUSE_FEES: Record<CoinhouseFeeKind, FeeRate> = {
  /** Achat via le Compte Euro ou par virement SEPA (achats récurrents inclus). */
  'buy-sepa': { pctFee: '0.99', fixedEur: '0.12' },
  /** Achat par carte bancaire (CB, Visa, Mastercard). */
  'buy-card': { pctFee: '1.99', fixedEur: '0.12' },
  /** Vente de crypto-actifs contre euros. */
  'sell-eur': { pctFee: '1.29', fixedEur: '0.12' },
  /** Conversion entre crypto-actifs — dont crypto → stablecoin (USDC, EURCV). */
  'crypto-crypto': { pctFee: '0.79', fixedEur: '0.12' },
  /** Conversion de stablecoin à stablecoin (USDC ↔ EURCV). */
  'stable-stable': { pctFee: '0.19', fixedEur: '0.12' },
};

const HUNDRED = D('100');

/** Frais prélevés sur un montant brut : jamais négatifs, jamais plus que le brut. */
export function feeOnGross(grossEur: Big, fee: FeeRate): Big {
  if (grossEur.lte(ZERO)) return ZERO;
  const amount = grossEur.times(D(fee.pctFee)).div(HUNDRED).plus(D(fee.fixedEur));
  return amount.gt(grossEur) ? grossEur : amount;
}

/** Montant net après frais (≥ 0). */
export function netAfterFees(grossEur: Big, fee: FeeRate): Big {
  return grossEur.minus(feeOnGross(grossEur, fee));
}

/**
 * Prix de vente d'équilibre FRAIS INCLUS d'une position au coût moyen : le prix `P` tel que
 * `qté × P × (1 − f) − fixe − qté × PRU = objectif × (qté × PRU)` — au-dessus, la vente dégage
 * l'objectif net de frais (0 % = simple équilibre). Résout
 * `P = (PRU × (1 + objectif) + fixe ÷ qté) ÷ (1 − f)`. `null` si la position est vide ou si les
 * frais mangeraient tout (f ≥ 100 %).
 */
export function breakEvenSellPrice(
  pruEur: Big,
  qty: Big,
  fee: FeeRate,
  targetNetPct: Big = ZERO,
): Big | null {
  if (qty.lte(ZERO) || pruEur.lt(ZERO)) return null;
  const f = D(fee.pctFee).div(HUNDRED);
  if (f.gte('1') || f.lt(ZERO)) return null;
  const target = pruEur
    .times(D('1').plus(targetNetPct.div(HUNDRED)))
    .plus(D(fee.fixedEur).div(qty));
  return target.div(D('1').minus(f));
}
