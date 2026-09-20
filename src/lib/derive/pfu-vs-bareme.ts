/**
 * Prélèvement forfaitaire ou barème progressif : ce que l'un coûte de plus que l'autre
 * (décision n° 150, P108).
 *
 * **Ce module ne dit jamais quoi cocher.** Il ne le peut pas : l'option se juge sur le revenu
 * global du foyer, son quotient familial, ses autres revenus de capitaux mobiliers — dont cette
 * application ne connaît rien. Ce qu'il rend est un **écart à hypothèse donnée** et un **seuil de
 * bascule** : « jusqu'à telle tranche, le barème coûte moins ». L'hypothèse est nommée, et c'est
 * l'utilisateur qui la fournit.
 *
 * **Deux options indépendantes, et les confondre est l'erreur la plus coûteuse.**
 *
 * - `2OP` est **globale** : elle bascule d'un coup les dividendes, les intérêts, les intérêts de
 *   prêts participatifs et les plus-values de valeurs mobilières, pour tout le foyer et pour
 *   l'année entière. Optimiser sur les seuls dividendes — dont l'abattement de 40 % rend le barème
 *   attrayant — en oubliant les intérêts, qui n'ont aucun abattement, est exactement le piège que
 *   ce module existe pour éviter.
 * - `3CN` ne concerne que les **actifs numériques**. Elle se coche, ou non, sans rapport avec 2OP.
 *
 * **Ce qui entre dans la comparaison, et ce qui en sort.** Seule la part **impôt sur le revenu**
 * s'arbitre : les prélèvements sociaux sont dus à l'identique dans les deux branches, et les
 * inclure ne ferait qu'ajouter le même nombre des deux côtés. Les crédits d'impôt (2CK, 8VL) se
 * déduisent de l'impôt dans les deux cas : ils sortent aussi.
 *
 * Module pur. Montants en euros, jamais convertis.
 */
import { CSG_DEDUCTIBLE_RATE, DIVIDEND_ABATEMENT, MARGINAL_RATES } from '../domain/income-tax-fr';
import { rcmRateFor } from '../domain/lending/tax-fr';
import { D, ZERO, toDecimalString, type Big, type DecimalString } from '../domain/money';
import { rateFor } from '../domain/tax-fr';
import { scaleForYearOrLatest, taxOnExtraIncome, type Household } from './household-tax';
import type { TaxReturnFamily, TaxReturnInput } from './tax-return';

/** Les deux options, désignées par leur case. Elles ne se décident pas ensemble. */
export type TaxOption = '2OP' | '3CN';

/** Une assiette qui bascule avec l'option, et ce qui la distingue sous le barème. */
export interface ArbitrageBase {
  family: TaxReturnFamily;
  label: string;
  /** Assiette de l'impôt sur le revenu, telle que le forfait la taxe. */
  taxableEur: DecimalString;
  /** Part de l'assiette qui échappe au barème — 40 % pour les revenus distribués, 0 ailleurs. */
  abatement: DecimalString;
  /**
   * Assiette sur laquelle se calcule la CSG déductible. Elle diffère de `taxableEur` pour les
   * prêts participatifs : « la totalité des intérêts perçus reste soumise aux prélèvements
   * sociaux » alors que l'impôt ne frappe que le net de la perte imputée.
   */
  csgBaseEur: DecimalString;
  /** Part impôt sur le revenu du prélèvement forfaitaire applicable à cette assiette. */
  flatRate: DecimalString;
}

/** Ce que coûterait le barème à un taux marginal donné, et l'écart avec le forfait. */
export interface ArbitrageScenario {
  rate: DecimalString;
  baremeEur: DecimalString;
  /** `barème − forfait` : **négatif** quand le barème coûte moins. */
  deltaEur: DecimalString;
}

export interface Arbitrage {
  option: TaxOption;
  year: number;
  bases: ArbitrageBase[];
  /** Somme des assiettes ; `'0'` quand l'option ne concerne rien cette année-là. */
  totalTaxableEur: DecimalString;
  /** Impôt sur le revenu au forfait, hors prélèvements sociaux. */
  flatEur: DecimalString;
  /** CSG que le barème rendrait déductible — le gain qu'elle procure dépend de la tranche. */
  csgDeductibleEur: DecimalString;
  /**
   * Assiette effectivement soumise au barème, abattements déduits. Elle ne dépend pas du taux :
   * c'est elle qu'on ajoute au revenu d'un foyer pour savoir ce que le barème lui coûte vraiment.
   */
  taxedEur: DecimalString;
  scenarios: ArbitrageScenario[];
  /**
   * Le taux marginal le plus élevé auquel le barème reste au moins aussi avantageux que le
   * forfait. `null` **uniquement** quand l'option ne concerne rien cette année-là : dès qu'il y a
   * une assiette, la tranche à 0 % est favorable au barème, qui n'y taxe rien.
   */
  breakEvenRate: DecimalString | null;
  /**
   * L'option se révoque-t-elle après coup ? C'est là que les deux cessent d'être jumelles, et
   * c'est la seule de leurs différences qui soit irréparable.
   */
  revocable: boolean;
  /** Entrée de veille qui porte le texte de CETTE option (`src/lib/watch/entries.ts`). */
  optionSourceId: string;
}

/**
 * Ce que chaque option engage. La loi de finances pour 2026 a supprimé le caractère irrévocable de
 * l'option du **2 de l'article 200 A** (case 2OP). Elle n'a pas touché à l'**article 200 C**, qui
 * régit la case 3CN : celle-là reste « sur option expresse **et irrévocable** », dans sa version en
 * vigueur depuis le 01/01/2023. L'écran affirmait le contraire des deux, parce que la phrase était
 * écrite une fois pour toutes dans le gabarit (décision n° 168).
 */
const OPTION_TERMS: Record<TaxOption, { revocable: boolean; sourceId: string }> = {
  '2OP': { revocable: true, sourceId: 'bareme-progressif' },
  '3CN': { revocable: false, sourceId: 'bareme-actifs-numeriques' },
};

/** Assiettes de l'option 2OP : revenus de capitaux mobiliers et plus-values de valeurs mobilières. */
function basesFor2OP(input: TaxReturnInput): ArbitrageBase[] {
  const { year } = input;
  const rcm = rcmRateFor(year).incomeTax;
  const cession = rateFor(year).incomeTax;
  const bases: ArbitrageBase[] = [];

  const dividend = input.dividends.years.find((y) => y.year === year);
  if (dividend !== undefined && !D(dividend.declaredEur).lte(ZERO))
    bases.push({
      family: 'dividend',
      label: 'Dividendes (2DC)',
      taxableEur: dividend.declaredEur,
      abatement: DIVIDEND_ABATEMENT,
      csgBaseEur: dividend.declaredEur,
      flatRate: rcm,
    });

  const interest = input.interest.years.find((y) => y.year === year);
  if (interest !== undefined && !D(interest.grossEur).lte(ZERO))
    bases.push({
      family: 'interest',
      label: 'Intérêts de trésorerie (2TR)',
      taxableEur: interest.grossEur,
      abatement: '0',
      csgBaseEur: interest.grossEur,
      flatRate: rcm,
    });

  const lending = input.lending.years.find((y) => y.year === year);
  if (lending !== undefined && !D(lending.taxableInterest).lte(ZERO))
    bases.push({
      family: 'lending',
      label: 'Intérêts de prêts participatifs (2TT)',
      taxableEur: lending.taxableInterest,
      abatement: '0',
      // La CSG a frappé les intérêts BRUTS, que la perte imputée ne réduit pas.
      csgBaseEur: lending.socialisedInterest,
      flatRate: rcm,
    });

  const equity = input.equity.years.find((y) => y.year === year);
  if (equity !== undefined && !D(equity.taxableEur).lte(ZERO))
    bases.push({
      family: 'equity',
      label: 'Plus-values de valeurs mobilières (3VG)',
      taxableEur: equity.taxableEur,
      // Aucun abattement pour durée de détention : il est réservé aux titres acquis avant 2018,
      // et le moteur n'en applique aucun (`EQUITY_TAX_ASSUMPTIONS`).
      abatement: '0',
      csgBaseEur: equity.taxableEur,
      flatRate: cession,
    });

  return bases;
}

/** Assiette de l'option 3CN : les plus-values d'actifs numériques, et elles seules. */
function basesFor3CN(input: TaxReturnInput): ArbitrageBase[] {
  const { year } = input;
  const crypto = input.crypto?.years.find((y) => y.year === year);
  // Un total de cessions sous le seuil de 305 € exonère : il n'y a rien à arbitrer.
  if (crypto === undefined || crypto.exempt) return [];
  const net = D(crypto.netEur);
  if (net.lte(ZERO)) return [];
  return [
    {
      family: 'crypto',
      label: 'Plus-values de crypto-actifs (3AN)',
      taxableEur: crypto.netEur,
      abatement: '0',
      csgBaseEur: crypto.netEur,
      flatRate: rateFor(year).incomeTax,
    },
  ];
}

function sum(values: readonly Big[]): Big {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

/**
 * L'arbitrage d'une option pour une année.
 *
 * La formule tient en une ligne, et chaque terme a sa source : à un taux marginal `t`, le barème
 * coûte `Σ assiette × (1 − abattement) × t`, dont il faut retrancher le gain de la CSG déductible,
 * `Σ assiette sociale × 6,8 % × t`. Le forfait, lui, coûte `Σ assiette × 12,8 %`.
 */
export function arbitrate(input: TaxReturnInput, option: TaxOption): Arbitrage {
  const bases = option === '2OP' ? basesFor2OP(input) : basesFor3CN(input);
  const totalTaxable = sum(bases.map((b) => D(b.taxableEur)));
  const flat = sum(bases.map((b) => D(b.taxableEur).times(D(b.flatRate))));
  const csgDeductible = sum(bases.map((b) => D(b.csgBaseEur).times(D(CSG_DEDUCTIBLE_RATE))));

  // L'assiette effectivement soumise au barème, abattements déduits. Elle ne dépend pas du taux.
  const taxed = sum(bases.map((b) => D(b.taxableEur).times(D('1').minus(D(b.abatement)))));
  const scenarios: ArbitrageScenario[] =
    bases.length === 0
      ? []
      : MARGINAL_RATES.map((rate) => {
          const t = D(rate);
          const bareme = taxed.minus(csgDeductible).times(t);
          return {
            rate,
            baremeEur: toDecimalString(bareme),
            deltaEur: toDecimalString(bareme.minus(flat)),
          };
        });

  // Le seuil se LIT sur les scénarios plutôt qu'il ne se résout : la formule fermée
  // `0,128 / (1 − abattement − 6,8 %)` ne vaut que pour une assiette unique, alors que 2OP en
  // mélange jusqu'à quatre, chacune avec son abattement. La tranche à 0 % est toujours favorable
  // au barème — elle ne taxe rien —, donc le seuil existe dès qu'il y a une assiette.
  const favourable = scenarios.filter((s) => D(s.deltaEur).lte(ZERO));

  return {
    option,
    year: input.year,
    bases,
    totalTaxableEur: toDecimalString(totalTaxable),
    flatEur: toDecimalString(flat),
    csgDeductibleEur: toDecimalString(csgDeductible),
    taxedEur: toDecimalString(taxed),
    scenarios,
    breakEvenRate: favourable[favourable.length - 1]?.rate ?? null,
    revocable: OPTION_TERMS[option].revocable,
    optionSourceId: OPTION_TERMS[option].sourceId,
  };
}

/** Ce que le barème coûte à un foyer donné, et la tranche avant/après. */
export interface ArbitrageForHousehold {
  /** Impôt sur le revenu supplémentaire sous le barème, quotient familial compris. */
  baremeEur: DecimalString;
  /** `barème − forfait` : **négatif** quand le barème coûte moins. */
  deltaEur: DecimalString;
  /** Tranche du foyer avant ces revenus. */
  marginalRateBefore: DecimalString;
  /** Tranche après : différente quand les revenus font franchir une borne. */
  marginalRateAfter: DecimalString;
  /** `true` quand les deux diffèrent — le cas exact où une tranche choisie à la main se trompe. */
  crossesBracket: boolean;
  /** Année du barème employé. */
  scaleYear: number;
  /** `true` quand l'année demandée n'a pas encore de barème publié, et qu'on a pris le dernier. */
  scaleIsFallback: boolean;
}
/**
 * Ce que le barème coûte à **ce foyer-là**, bornes du barème comprises.
 *
 * `arbitrate` chiffre l'écart à un taux marginal donné : exact tant que les revenus arbitrés ne
 * font franchir aucune borne, et c'est précisément ce que l'écran avertissait ne pas savoir. Ici,
 * le barème est appliqué au revenu du foyer **avant et après** ces revenus : un gain qui pousse
 * dans la tranche suivante est facturé au bon taux, tranche par tranche.
 *
 * Rend `null` quand aucun barème ne peut servir pour l'année — auquel cas l'écran reste au mode
 * « je choisis ma tranche », qui ne dépend que des taux, stables d'une année sur l'autre.
 */
export function arbitrateForHousehold(
  arbitrage: Arbitrage,
  household: Household,
): ArbitrageForHousehold | null {
  const choice = scaleForYearOrLatest(arbitrage.year);
  if (choice === null) return null;
  // La CSG déductible se retranche de l'assiette, comme dans `arbitrate` : le décalage d'un an de
  // son imputation est une mise en garde de l'écran, pas une correction du chiffre.
  const extra = D(arbitrage.taxedEur).minus(D(arbitrage.csgDeductibleEur));
  const bareme = taxOnExtraIncome(choice.scale, household, extra);
  return {
    baremeEur: bareme.taxEur,
    deltaEur: toDecimalString(D(bareme.taxEur).minus(D(arbitrage.flatEur))),
    marginalRateBefore: bareme.marginalRateBefore,
    marginalRateAfter: bareme.marginalRateAfter,
    crossesBracket: bareme.crossesBracket,
    scaleYear: choice.scale.year,
    scaleIsFallback: choice.isFallback,
  };
}

/** Les deux arbitrages d'une année, dans l'ordre du formulaire : 3CN puis 2OP. */
export function arbitrages(input: TaxReturnInput): Arbitrage[] {
  return [arbitrate(input, '3CN'), arbitrate(input, '2OP')].filter((a) => a.bases.length > 0);
}
