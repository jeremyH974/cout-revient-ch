/**
 * Ce que le barème coûte à **un foyer**, et non à une tranche abstraite (décision n° 169).
 *
 * L'arbitrage forfait / barème (`pfu-vs-bareme.ts`) chiffre l'écart à un taux marginal **donné**.
 * C'est exact tant que les revenus arbitrés ne font pas franchir de tranche — et c'est justement ce
 * que l'écran avertissait ne pas savoir. Ce module lève cette limite : à partir du revenu imposable
 * du foyer et de son nombre de parts, il applique le barème **avant et après** les revenus
 * arbitrés, et rend la différence. Un gain qui pousse le foyer dans la tranche suivante est alors
 * facturé au bon taux, ligne à ligne du barème.
 *
 * **Trois choses qu'il ne fait pas, et qu'il faut dire plutôt que de les approcher.**
 *
 * 1. **La décote** (CGI art. 197, I-4) n'est pas modélisée. Elle efface ou réduit l'impôt des
 *    foyers les plus modestes, et elle ne s'annule PAS dans une différence : pour un foyer qui en
 *    bénéficie, l'écart rendu ici est trop élevé. L'écran le dit à ceux que ça concerne.
 * 2. **Le plafonnement du quotient familial** (CGI art. 197, I-2) n'est pas modélisé non plus. Lui,
 *    en revanche, est un montant qui ne dépend pas du revenu : il se retranche des deux termes de
 *    la différence, et disparaît donc du résultat dans le cas courant.
 * 3. **Les réductions et crédits d'impôt** sont hors sujet : ils se déduisent de l'impôt dans les
 *    deux branches de l'arbitrage, comme les prélèvements sociaux.
 *
 * Module pur. Montants en euros, chaînes décimales et `Big` — jamais un `number`.
 */
import { INCOME_TAX_SCALES, scaleFor, type IncomeTaxScale } from '../domain/income-tax-fr';
import { D, ZERO, toDecimalString, type Big, type DecimalString } from '../domain/money';

/** Ce que l'utilisateur saisit quand il veut un chiffre exact plutôt qu'une tranche devinée. */
export interface Household {
  /**
   * Revenu net imposable du foyer, **hors** les revenus qu'on arbitre : c'est à eux que ce module
   * va les ajouter. Le chiffre figure sur l'avis d'imposition.
   */
  taxableIncomeEur: DecimalString;
  /** Nombre de parts du quotient familial : `'1'`, `'1.5'`, `'2'`… */
  parts: DecimalString;
}

/**
 * Le barème employé pour une année, et s'il a fallu se rabattre sur un autre.
 *
 * `income-tax-fr.ts` refuse tout repli, et il a raison : les bornes sont indexées chaque année, et
 * montrer celles de 2025 à quelqu'un qui déclare 2024 lui ferait reconnaître la mauvaise tranche.
 * Le repli n'existe donc qu'ici, il ne va que **vers l'avant** — une année en cours dont aucune loi
 * de finances n'a encore fixé le barème —, et il se signale (`isFallback`).
 */
export interface ScaleChoice {
  scale: IncomeTaxScale;
  /** Année demandée, qui peut différer de `scale.year`. */
  requestedYear: number;
  isFallback: boolean;
}

/** Le barème de cette année, ou le plus récent publié si elle n'en a pas encore. */
export function scaleForYearOrLatest(year: number): ScaleChoice | null {
  const exact = scaleFor(year);
  if (exact !== null) return { scale: exact, requestedYear: year, isFallback: false };
  // Sans branche : une comparaison qui ne se joue que dans un sens selon l'ordre de la table
  // serait un embranchement qu'aucun test ne peut faire rougir.
  const latestYear = Math.max(...INCOME_TAX_SCALES.map((scale) => scale.year));
  const latest = INCOME_TAX_SCALES.find((scale) => scale.year === latestYear)!;
  // Une année ANTÉRIEURE au plus ancien barème connu ne se projette pas en arrière : on renonce.
  if (year < latest.year) return null;
  return { scale: latest, requestedYear: year, isFallback: true };
}

/**
 * L'impôt du barème sur un revenu, quotient familial compris : le revenu est divisé par les parts,
 * le barème s'applique à ce quotient, et le résultat est remultiplié par les parts.
 */
export function taxOnIncome(scale: IncomeTaxScale, incomeEur: Big, parts: Big): Big {
  if (!parts.gt(ZERO) || !incomeEur.gt(ZERO)) return ZERO;
  const quotient = incomeEur.div(parts);
  let tax = ZERO;
  let floor = ZERO;
  for (const bracket of scale.brackets) {
    const ceiling = bracket.upToEur === null ? null : D(bracket.upToEur);
    const top = ceiling === null || quotient.lt(ceiling) ? quotient : ceiling;
    // La tranche est toujours non vide ici : un quotient pile sur une borne a déjà fait sortir la
    // boucle au tour précédent, et un quotient nul n'y entre jamais (garde ci-dessus).
    tax = tax.plus(top.minus(floor).times(D(bracket.rate)));
    if (ceiling === null || quotient.lte(ceiling)) break;
    floor = ceiling;
  }
  return tax.times(parts);
}

/**
 * La tranche qui contient le revenu — celle qu'on lit sur un barème, et celle que l'utilisateur
 * choisirait lui-même en mode rapide. Un revenu pile sur une borne appartient à la tranche BASSE,
 * comme l'écrit le barème (« jusqu'à 11 600 € : 0 % ») ; l'euro suivant est dans la tranche d'après.
 */
export function marginalRateFor(scale: IncomeTaxScale, incomeEur: Big, parts: Big): DecimalString {
  const quotient = parts.gt(ZERO) && incomeEur.gt(ZERO) ? incomeEur.div(parts) : ZERO;
  let rate = scale.brackets[0]!.rate;
  for (const bracket of scale.brackets) {
    rate = bracket.rate;
    if (bracket.upToEur === null || quotient.lte(D(bracket.upToEur))) break;
  }
  return rate;
}

/** Ce que des revenus supplémentaires coûtent à ce foyer, et la tranche avant/après. */
export interface ExtraIncomeTax {
  /** Impôt sur le revenu supplémentaire, barème et quotient familial appliqués. */
  taxEur: DecimalString;
  /** Tranche du foyer AVANT ces revenus. */
  marginalRateBefore: DecimalString;
  /** Tranche du foyer APRÈS : différente quand les revenus font franchir une borne. */
  marginalRateAfter: DecimalString;
  /** `true` quand les deux diffèrent — le cas où une tranche choisie à la main se tromperait. */
  crossesBracket: boolean;
}

/**
 * L'impôt que `extraEur` ajoute au foyer : barème appliqué au revenu augmenté, moins le barème
 * appliqué au revenu seul. C'est la seule façon d'être juste quand le montant franchit une borne.
 *
 * `extraEur` est l'assiette **telle qu'elle entre au barème** : abattements déduits, CSG déductible
 * déjà retranchée. Un montant négatif ou nul ne coûte rien.
 */
export function taxOnExtraIncome(
  scale: IncomeTaxScale,
  household: Household,
  extraEur: Big,
): ExtraIncomeTax {
  const income = D(household.taxableIncomeEur);
  const parts = D(household.parts);
  // Un montant négatif ne rend rien : une moins-value ne se compense pas ici, elle s'impute en
  // amont, sur les plus-values de même nature de la même année (`tax-fr.ts`).
  const extra = extraEur.gt(ZERO) ? extraEur : ZERO;
  const raised = income.plus(extra);
  const before = taxOnIncome(scale, income, parts);
  const after = taxOnIncome(scale, raised, parts);
  const rateBefore = marginalRateFor(scale, income, parts);
  const rateAfter = marginalRateFor(scale, raised, parts);
  return {
    taxEur: toDecimalString(after.minus(before)),
    marginalRateBefore: rateBefore,
    marginalRateAfter: rateAfter,
    crossesBracket: rateBefore !== rateAfter,
  };
}
