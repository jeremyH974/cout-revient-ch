/**
 * L'addition : ce qu'il restera à payer, une fois retranché ce qui a déjà été prélevé
 * (décision n° 173).
 *
 * Les décisions n° 150 et 170 avaient donné à l'application un arbitrage et un écran pour le
 * montrer, option par option. Mais `2OP` et `3CN` se cochent **indépendamment**, si bien que
 * l'écran posait deux additions séparées et n'en faisait jamais la somme. Et personne ne disait ce
 * qui, de cette somme, avait **déjà** été payé.
 *
 * **Ce que l'arbitrage écarte à bon droit, la facture doit le reprendre.** `pfu-vs-bareme.ts`
 * laisse de côté les crédits d'impôt parce qu'ils se déduisent **à l'identique** des deux branches
 * : les inclure ne déplacerait aucun arbitrage. Ici, c'est l'inverse — ils sont exactement ce qui
 * sépare l'impôt dû de ce qu'on sort de sa poche.
 *
 * **Et une erreur que ce module existe pour empêcher.** L'arbitrage calcule les prélèvements
 * sociaux sur **toutes** les assiettes de `2OP`, intérêts de prêts participatifs compris. C'est
 * juste pour comparer deux voies — le même montant des deux côtés ne déplace rien. Ce serait faux
 * pour une facture : la plateforme les a déjà retenus au versement. Additionner les deux cartes
 * telles qu'elles s'affichent **surestimerait** ce qui reste dû.
 *
 * **L'ordre d'imputation est celui du droit, et il n'est pas symétrique.**
 *
 * - Le crédit d'impôt conventionnel (case 8VL) s'impute sur l'impôt sur le revenu et **n'est pas
 *   restituable** : il se plafonne à l'impôt dû.
 * - L'acompte de 12,8 % déjà retenu (case 2CK), lui, « s'impute sur l'impôt sur le revenu dû au
 *   titre de l'année au cours de laquelle il a été opéré. **S'il excède l'impôt dû, l'excédent est
 *   restitué** » (CGI art. 117 quater, I). Un solde négatif n'est donc pas une anomalie.
 * - Les prélèvements sociaux retenus sur des produits de placement sont **définitifs**, pas des
 *   acomptes : ils s'effacent contre ceux de la même nature et rien de plus. Ce qui excède n'est
 *   pas imputé, et le module le dit plutôt que d'inventer un remboursement.
 *
 * **Le total s'affiche comme la somme de ses lignes arrondies**, jamais comme l'arrondi de la
 * somme (décision n° 150) : c'est `displayDueEur`, et c'est lui — et non le montant exact — qui
 * décide de l'étalement du solde. Sur un écran dont toute la valeur est que les chiffres se
 * recoupent, un centime suffit à tout perdre.
 *
 * Module pur. Montants en **euros**, jamais convertis dans la devise d'affichage.
 */
import { Big, D, ZERO, min, toDecimalString, type DecimalString } from '../domain/money';
import type { TaxChoice, TaxSide } from './tax-choice';
import type { TaxOption } from './pfu-vs-bareme';
import type { TaxReturnInput } from './tax-return';
import { settlement, type Settlement } from './tax-calendar';

/** Nom de l'assiette d'une option, tel qu'il s'écrit sur la facture. */
const OPTION_LABELS: Readonly<Record<TaxOption, string>> = {
  '3CN': 'Plus-values de crypto-actifs',
  '2OP': 'Revenus de capitaux mobiliers',
};

/** Une option et son tableau comparatif, tels que l'écran les a déjà calculés. */
export interface BillOption {
  option: TaxOption;
  choice: TaxChoice;
}

/**
 * Ce qui a **déjà** été prélevé sur ces revenus. Trois natures, trois sorts différents : les
 * confondre ferait un total faux dans les trois cas.
 */
export interface Withheld {
  /** Case 2CK : acompte de 12,8 % retenu au versement. Imputable **et restituable**. */
  advanceEur: DecimalString;
  /** Prélèvements sociaux retenus au versement. Définitifs, imputables sur les seuls PS dus. */
  socialEur: DecimalString;
  /** Case 8VL : crédit d'impôt conventionnel. Imputable, **jamais restituable**. */
  foreignCreditEur: DecimalString;
  /** Un prélèvement a bien eu lieu, mais sa ventilation est inconnue : rien n'en est imputé. */
  unsplit: boolean;
  /** Dividendes de l'année sur lesquels l'application ne connaît aucun acompte français. */
  dividendsWithoutAdvanceEur: DecimalString;
}

const NOTHING_WITHHELD: Withheld = {
  advanceEur: '0',
  socialEur: '0',
  foreignCreditEur: '0',
  unsplit: false,
  dividendsWithoutAdvanceEur: '0',
};

/** Une ligne de la facture. **Signée** : leur somme vaut le solde, et c'est ce qui la rend lisible. */
export interface BillLine {
  key: string;
  label: string;
  /** Positif : dû. Négatif : déjà réglé, ou crédité. */
  amountEur: DecimalString;
  kind: 'due' | 'settled';
}

export interface TaxBill {
  year: number;
  /** La voie retenue de chaque côté, et si elle suit la moins chère ou un choix explicite. */
  sides: { option: TaxOption; key: TaxSide['key']; followsCheapest: boolean }[];
  lines: BillLine[];
  /** Impôt sur le revenu et prélèvements sociaux dus, **avant** imputation. Exacts. */
  incomeTaxEur: DecimalString;
  socialTaxEur: DecimalString;
  grossEur: DecimalString;
  /** Ce qui vient en déduction : crédit plafonné, acompte, prélèvements sociaux retenus. Exact. */
  settledEur: DecimalString;
  /** `grossEur − settledEur`, exact. Négatif quand l'acompte excède l'impôt. */
  dueEur: DecimalString;
  /** La somme des lignes **arrondies** : ce que l'écran affiche, et ce qui décide de l'étalement. */
  displayDueEur: DecimalString;
  settlement: Settlement;
  caveats: string[];
}

/** Au centime, arrondi commercial — celui de l'affichage des montants en euros. */
function cents(value: Big): Big {
  return value.round(2, Big.roundHalfUp);
}

/**
 * Ce qui a déjà été prélevé, lu dans les millésimes des moteurs — **jamais présumé**.
 *
 * Seuls les prêts participatifs portent aujourd'hui un prélèvement à la source : la plateforme
 * retient l'acompte et les prélèvements sociaux au versement. Les dividendes, eux, arrivent d'un
 * intermédiaire établi hors de France, qui n'en retient aucun (voir le garde-fou plus bas).
 */
export function withheldFor(input: TaxReturnInput): Withheld {
  const { year } = input;
  const lending = input.lending.years.find((y) => y.year === year);
  const dividends = input.dividends.years.find((y) => y.year === year);

  const advance = lending?.incomeTaxCredit ?? '0';
  const social = lending?.socialPaid ?? '0';
  // Ne pas savoir VENTILER un prélèvement n'empêche pas de savoir qu'il a eu lieu : on ne l'impute
  // pas, et on le dit — annoncer un solde amputé d'un crédit inconnu serait pire que de le taire.
  const unsplit =
    lending !== undefined &&
    D(lending.withheld).gt(ZERO) &&
    (lending.incomeTaxCredit === null || lending.socialPaid === null);

  return {
    advanceEur: advance,
    socialEur: social,
    foreignCreditEur: dividends?.creditEur ?? '0',
    unsplit,
    dividendsWithoutAdvanceEur: dividends?.declaredEur ?? '0',
  };
}

export interface TaxBillInput {
  year: number;
  /** Les options telles que l'écran les montre — pour que la facture et les cartes concordent. */
  options: readonly BillOption[];
  /** La voie retenue par option. Absente ou `null` : suivre la moins chère. */
  sides?: Partial<Record<TaxOption, TaxSide['key'] | null>>;
  withheld?: Withheld;
  /**
   * `true` quand l'historique des cours manque : l'article 150 VH bis n'a alors pas de valeur
   * globale de portefeuille, et la part crypto manque à l'addition. Le taire ferait passer un
   * total amputé pour un total.
   */
  cryptoMissing?: boolean;
}

/**
 * La facture d'une année.
 *
 * `null` quand il n'y a rien à additionner : aucune assiette **et** aucun prélèvement déjà opéré.
 * Un prélèvement sans assiette, lui, donne bien une facture — négative, et c'est un remboursement.
 */
export function taxBill(args: TaxBillInput): TaxBill | null {
  const { year, options, cryptoMissing = false } = args;
  const withheld = args.withheld ?? NOTHING_WITHHELD;
  const chosen = args.sides ?? {};

  const advance = D(withheld.advanceEur);
  const socialPaid = D(withheld.socialEur);
  const foreignCredit = D(withheld.foreignCreditEur);
  const anyWithheld = advance.gt(ZERO) || socialPaid.gt(ZERO) || foreignCredit.gt(ZERO);
  if (options.length === 0 && !anyWithheld) return null;

  const lines: BillLine[] = [];
  const sides: TaxBill['sides'] = [];
  let incomeTax = ZERO;
  let socialTax = ZERO;

  for (const { option, choice } of options) {
    const asked = chosen[option] ?? null;
    // `cheaper` vaut aussi `'equal'` : à égalité affichée, le forfait sert de repère, puisque
    // c'est lui qui s'applique **sans rien cocher**.
    const key: TaxSide['key'] = asked ?? (choice.cheaper === 'scale' ? 'scale' : 'flat');
    const side = key === 'scale' ? choice.scale : choice.flat;
    sides.push({ option, key, followsCheapest: asked === null });

    incomeTax = incomeTax.plus(D(side.incomeTaxEur));
    socialTax = socialTax.plus(D(side.socialTaxEur));
    lines.push({
      key: `${option}-ir`,
      label: `${OPTION_LABELS[option]} — impôt sur le revenu`,
      amountEur: side.incomeTaxEur,
      kind: 'due',
    });
    lines.push({
      key: `${option}-ps`,
      label: `${OPTION_LABELS[option]} — prélèvements sociaux`,
      amountEur: side.socialTaxEur,
      kind: 'due',
    });
  }

  const caveats: string[] = [];

  // Le crédit conventionnel ne peut pas créer de remboursement : il s'arrête à l'impôt dû.
  const credit = min(foreignCredit, incomeTax);
  if (credit.gt(ZERO))
    lines.push({
      key: 'credit-8VL',
      label: 'Crédit d’impôt sur dividendes étrangers (8VL), déjà retenu à l’étranger',
      amountEur: toDecimalString(credit.times(D('-1'))),
      kind: 'settled',
    });
  if (foreignCredit.gt(incomeTax))
    caveats.push(
      'Le crédit d’impôt conventionnel excède l’impôt sur le revenu dû sur ces seuls revenus : il n’est pas restituable, et l’excédent n’est donc pas déduit ici. Il peut encore s’imputer sur le reste de votre impôt, que l’application ne connaît pas.',
    );

  if (advance.gt(ZERO))
    lines.push({
      key: 'advance-2CK',
      label: 'Acompte de 12,8 % déjà retenu au versement (2CK)',
      amountEur: toDecimalString(advance.times(D('-1'))),
      kind: 'settled',
    });

  // Les prélèvements sociaux retenus au versement sont définitifs : ils effacent ceux de même
  // nature, et pas un euro de plus. Ce qui dépasse n'est pas un trop-perçu qu'on se rembourse ici.
  const socialOffset = min(socialPaid, socialTax);
  if (socialOffset.gt(ZERO))
    lines.push({
      key: 'social-withheld',
      label: 'Prélèvements sociaux déjà retenus au versement',
      amountEur: toDecimalString(socialOffset.times(D('-1'))),
      kind: 'settled',
    });
  if (socialPaid.gt(socialTax))
    caveats.push(
      'Les prélèvements sociaux déjà retenus dépassent ceux que l’application calcule sur ces revenus. L’excédent n’est pas imputé : un prélèvement social retenu au versement est définitif, ce n’est pas un acompte.',
    );

  const gross = incomeTax.plus(socialTax);
  const settled = credit.plus(advance).plus(socialOffset);
  const due = gross.minus(settled);
  const displayDue = lines.reduce((acc, l) => acc.plus(cents(D(l.amountEur))), ZERO);

  if (cryptoMissing)
    caveats.push(
      'L’historique des cours n’est pas chargé : sans valeur globale de portefeuille, l’article 150 VH bis ne se calcule pas et vos plus-values de crypto-actifs manquent à ce total.',
    );
  if (withheld.unsplit)
    caveats.push(
      'Un prélèvement a bien été retenu sur vos intérêts de prêts participatifs, mais son taux ne correspond à aucun régime connu : faute de savoir le ventiler entre acompte et prélèvements sociaux, rien n’en est déduit ici. Le solde réel sera donc plus bas.',
    );
  if (D(withheld.dividendsWithoutAdvanceEur).gt(ZERO))
    caveats.push(
      'Aucun acompte de 12,8 % ne figure sur vos dividendes. Un intermédiaire établi hors de France n’en retient pas : c’est au contribuable de le déclarer et de le verser lui-même, dans les quinze premiers jours du mois qui suit l’encaissement (formulaire 2778-DIV-SD), sauf dispense en dessous de 50 000 € de revenu fiscal de référence pour une personne seule et 75 000 € pour une imposition commune.',
    );
  caveats.push(
    'Ce total ne porte que sur les revenus que l’application connaît. Il n’y ajoute ni l’impôt du reste de votre foyer, ni la contribution exceptionnelle sur les hauts revenus, ni la contribution différentielle qui la double au-delà de 250 000 € de revenu fiscal de référence.',
  );

  return {
    year,
    sides,
    lines,
    incomeTaxEur: toDecimalString(incomeTax),
    socialTaxEur: toDecimalString(socialTax),
    grossEur: toDecimalString(gross),
    settledEur: toDecimalString(settled),
    dueEur: toDecimalString(due),
    displayDueEur: toDecimalString(displayDue),
    settlement: settlement(year, toDecimalString(displayDue)),
    caveats,
  };
}
