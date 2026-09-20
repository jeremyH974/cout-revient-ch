/**
 * Ce que l'écran « Impôts » montre : les deux voies d'imposition, côte à côte (décision n° 170).
 *
 * `pfu-vs-bareme.ts` chiffre un **écart** ; ce module en fait un **tableau comparable** : deux
 * totaux de même nature, la part qui s'arbitre et celle qui ne s'arbitre pas, et l'échelle des
 * tranches où l'on retrouve la sienne. L'écran n'arbitre rien — il affiche ce qui est ici.
 *
 * **Il ne recommande rien.** `cheaper` dit laquelle des deux coûte le moins *sur les seuls revenus
 * que cette application connaît* : un constat, pas un conseil. L'option se juge aussi sur le
 * revenu fiscal de référence, sur les autres revenus du foyer, et — pour la case 3CN, qui est
 * irrévocable — sur des années que personne ne connaît encore.
 *
 * **La comparaison se fait sur les montants TELS QU'ILS S'AFFICHENT**, au centime. Un écart exact
 * de 0,004 € annoncé sous deux cartes qui portent le même montant en euros ruinerait le seul
 * intérêt de cet écran : que les chiffres se recoupent sous les yeux du lecteur. Même règle que
 * `displayGap` (décision n° 150), appliquée ici parce que c'est le **verdict** qui en dépend, et
 * non seulement son affichage.
 *
 * Module pur. Montants en euros, jamais convertis.
 */
import { Big, D, ZERO, toDecimalString, type DecimalString } from '../domain/money';
import { scaleForYearOrLatest, type Household } from './household-tax';
import { arbitrateForHousehold, type Arbitrage, type TaxOption } from './pfu-vs-bareme';

/** Comment l'utilisateur a décrit son foyer — les deux modes de l'écran. */
export type TaxBasis =
  /**
   * Une tranche choisie à la main. Rapide, et suffisant tant que les revenus arbitrés ne font pas
   * franchir de borne — cas où il se trompe, et où `crossesBracket` ne peut pas l'avertir.
   */
  | { kind: 'bracket'; rate: DecimalString }
  /** Revenu imposable et parts : le barème s'applique pour de bon, franchissement compris. */
  | { kind: 'household'; household: Household };

/** Une des deux voies, telle qu'elle s'affiche : ce qui s'arbitre, ce qui ne s'arbitre pas, le tout. */
export interface TaxSide {
  key: 'flat' | 'scale';
  label: string;
  /** Impôt sur le revenu : la seule part que l'option déplace. */
  incomeTaxEur: DecimalString;
  /** Prélèvements sociaux : **le même montant des deux côtés**, par construction. */
  socialTaxEur: DecimalString;
  totalEur: DecimalString;
}

/** Une tranche du barème, ce qu'elle coûterait, et ce qui la distingue à l'écran. */
export interface LadderStep {
  rate: DecimalString;
  baremeEur: DecimalString;
  /** `barème − forfait` : **négatif** quand le barème coûte moins. */
  deltaEur: DecimalString;
  /** Dernière tranche où le barème reste au moins aussi avantageux que le forfait. */
  isBreakEven: boolean;
  /** La tranche du foyer **avant** ces revenus : celle où l'utilisateur doit se reconnaître. */
  isYours: boolean;
}

export interface TaxChoice {
  option: TaxOption;
  year: number;
  /** Le mode de saisie employé : l'écran le nomme, pour qu'on sache ce que vaut le chiffre. */
  basis: TaxBasis['kind'];
  flat: TaxSide;
  scale: TaxSide;
  /** Laquelle coûte le moins, au centime affiché. `'equal'` quand elles s'affichent à égalité. */
  cheaper: 'flat' | 'scale' | 'equal';
  /** L'écart, **toujours positif** : « X € de moins » se lit mieux qu'un nombre signé. */
  gapEur: DecimalString;
  /** Somme des assiettes — ce sur quoi portent les deux colonnes. */
  totalTaxableEur: DecimalString;
  /**
   * Ce que chaque voie prélève **pour 100 € d'assiette**. C'est la comparaison la plus lisible
   * qui soit, et la seule qui réponde à « suis-je vraiment imposé à 30 % ? » : le barème frappe
   * une assiette abattue et diminuée de la CSG déductible, si bien que sa ponction réelle n'est
   * presque jamais le taux de la tranche.
   */
  flatRateOnBase: DecimalString;
  scaleRateOnBase: DecimalString;
  /** Tranche du foyer avant ces revenus. */
  marginalRateBefore: DecimalString;
  /** Tranche après : différente quand ces revenus font franchir une borne. */
  marginalRateAfter: DecimalString;
  /** `true` quand les deux diffèrent — le cas exact où une tranche choisie à la main se trompe. */
  crossesBracket: boolean;
  /** Année du barème dont l'écran peut montrer les bornes ; `null` si aucun ne couvre l'année. */
  scaleYear: number | null;
  /** `true` quand l'année demandée n'a pas encore de barème publié, et qu'on a pris le dernier. */
  scaleIsFallback: boolean;
  ladder: LadderStep[];
}

/** Au centime, arrondi commercial — celui de l'affichage des montants en euros. */
function cents(value: Big): Big {
  return value.round(2, Big.roundHalfUp);
}

function side(key: TaxSide['key'], label: string, incomeTax: Big, socialTax: Big): TaxSide {
  return {
    key,
    label,
    incomeTaxEur: toDecimalString(incomeTax),
    socialTaxEur: toDecimalString(socialTax),
    totalEur: toDecimalString(incomeTax.plus(socialTax)),
  };
}

/**
 * Le tableau comparatif d'une option pour un foyer donné.
 *
 * `null` quand il n'y a rien à comparer : aucune assiette cette année-là (option sans objet, ou
 * seuil de 305 € non franchi), tranche inconnue du barème, ou année antérieure au plus ancien
 * barème que cette application connaisse.
 */
export function taxChoice(arbitrage: Arbitrage, basis: TaxBasis): TaxChoice | null {
  if (arbitrage.bases.length === 0) return null;

  const flatTax = D(arbitrage.flatEur);
  const social = D(arbitrage.socialEur);

  let baremeTax: Big;
  let before: DecimalString;
  let after: DecimalString;
  let crossesBracket: boolean;

  if (basis.kind === 'bracket') {
    const scenario = arbitrage.scenarios.find((s) => s.rate === basis.rate);
    if (scenario === undefined) return null;
    baremeTax = D(scenario.baremeEur);
    before = basis.rate;
    after = basis.rate;
    // Une tranche saisie à la main ne PEUT pas voir le franchissement : c'est sa limite, et
    // l'annoncer comme « pas de franchissement » serait un mensonge. L'écran dit le mode.
    crossesBracket = false;
  } else {
    const forHousehold = arbitrateForHousehold(arbitrage, basis.household);
    if (forHousehold === null) return null;
    baremeTax = D(forHousehold.baremeEur);
    before = forHousehold.marginalRateBefore;
    after = forHousehold.marginalRateAfter;
    crossesBracket = forHousehold.crossesBracket;
  }

  const gap = cents(baremeTax).minus(cents(flatTax));
  const choice = scaleForYearOrLatest(arbitrage.year);
  // Aucune garde de division : une assiette n'entre dans `bases` que si elle est STRICTEMENT
  // positive (`basesFor2OP`, `basesFor3CN`), et l'absence d'assiette est déjà sortie plus haut.
  // `tax-choice.test.ts` tient cet invariant, qu'une garde inatteignable masquerait.
  const base = D(arbitrage.totalTaxableEur);

  return {
    option: arbitrage.option,
    year: arbitrage.year,
    basis: basis.kind,
    flat: side('flat', 'Prélèvement forfaitaire', flatTax, social),
    scale: side('scale', 'Barème progressif', baremeTax, social),
    cheaper: gap.eq(ZERO) ? 'equal' : gap.lt(ZERO) ? 'scale' : 'flat',
    gapEur: toDecimalString(gap.abs()),
    totalTaxableEur: arbitrage.totalTaxableEur,
    flatRateOnBase: toDecimalString(flatTax.div(base)),
    scaleRateOnBase: toDecimalString(baremeTax.div(base)),
    marginalRateBefore: before,
    marginalRateAfter: after,
    crossesBracket,
    scaleYear: choice === null ? null : choice.scale.year,
    scaleIsFallback: choice !== null && choice.isFallback,
    // L'échelle se lit SUR les scénarios du moteur, jamais recalculée à côté : deux tables des
    // mêmes tranches divergeraient au premier barème modifié.
    ladder: arbitrage.scenarios.map((scenario) => ({
      rate: scenario.rate,
      baremeEur: scenario.baremeEur,
      deltaEur: scenario.deltaEur,
      isBreakEven: arbitrage.breakEvenRate === scenario.rate,
      isYours: before === scenario.rate,
    })),
  };
}
