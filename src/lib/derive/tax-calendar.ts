/**
 * Quand l'impôt de l'année se règle, et en combien de fois (décision n° 173).
 *
 * L'application savait dire **ce que** des gains coûtent ; elle ne disait nulle part **quand** on
 * le paie. Or la réponse n'a rien d'évident : ces gains échappent au prélèvement à la source, si
 * bien qu'ils n'arrivent qu'un an plus tard, d'un coup, sur l'avis.
 *
 * **Deux faits fondent ce module, et rien d'autre.**
 *
 * 1. Les prélèvements sociaux qui frappent les plus-values sont ceux des **revenus du
 *    patrimoine** : la contribution est « assise, contrôlée et recouvrée selon les mêmes règles et
 *    sous les mêmes sûretés, privilèges et sanctions que l'impôt sur le revenu » (CSS art. L.
 *    136-6, III). Ils suivent donc l'impôt, à la même date — et non le versement, comme le font
 *    les prélèvements sur les produits de placement (CSS art. L. 136-7).
 * 2. Le solde est prélevé **à partir du 25 septembre** de l'année qui suit, et « si votre solde
 *    d'impôt est supérieur à 300 €, son paiement est automatiquement étalé par l'administration
 *    fiscale en quatre prélèvements d'égal montant de septembre à décembre » (impots.gouv.fr).
 *
 * **Aucune date secondaire n'est écrite ici.** Les trois échéances qui suivent la première
 * changent chaque année (26/10 et 28/12 en 2026, d'autres jours en 2027) : les inscrire serait
 * programmer une erreur. Le module porte la **règle**, l'écran en rend les mois.
 *
 * **Le seuil se juge sur le montant AFFICHÉ.** Un solde de 299,996 € s'affiche « 300,00 € » : le
 * lire comme un étalement démentirait l'écran d'un centime, et cet écran ne vaut que parce que
 * ses chiffres se recoupent (décision n° 150). L'appelant passe donc le montant déjà arrondi.
 *
 * Module pur. Montants en euros, jamais convertis.
 */
import { D, ZERO, toDecimalString, type DecimalString } from '../domain/money';

/**
 * Au-delà de ce solde, l'administration étale d'office. **Au-delà**, pas « à partir de » : un
 * solde d'exactement 300 € se prélève en une fois.
 */
export const SPREAD_THRESHOLD_EUR: DecimalString = '300';

/** Nombre de prélèvements quand le solde est étalé. */
export const SPREAD_INSTALMENTS = 4;

/** Le sens du règlement. `none` quand il n'y a rien à régler dans un sens ni dans l'autre. */
export type SettlementDirection = 'pay' | 'refund' | 'none';

export interface Settlement {
  /** Année où cela se règle : celle qui suit l'année des gains. */
  year: number;
  direction: SettlementDirection;
  /** Ce qu'il reste à payer, ou à recevoir — **toujours positif**, le sens est dans `direction`. */
  amountEur: DecimalString;
  /** 1, ou {@link SPREAD_INSTALMENTS} au-delà du seuil. `0` quand il n'y a rien à prélever. */
  instalments: number;
  thresholdEur: DecimalString;
}

/**
 * Le règlement d'une année, à partir du solde **tel qu'il s'affiche**.
 *
 * Un solde négatif n'est pas une anomalie : un acompte de 12,8 % déjà retenu peut excéder l'impôt
 * dû, et « s'il excède l'impôt dû, l'excédent est restitué » (CGI art. 117 quater, I). L'étalement
 * ne concerne alors rien — on ne fractionne pas un remboursement.
 */
export function settlement(taxYear: number, displayDueEur: DecimalString): Settlement {
  const due = D(displayDueEur);
  const year = taxYear + 1;
  if (due.eq(ZERO))
    return {
      year,
      direction: 'none',
      amountEur: '0',
      instalments: 0,
      thresholdEur: SPREAD_THRESHOLD_EUR,
    };
  if (due.lt(ZERO))
    return {
      year,
      direction: 'refund',
      amountEur: toDecimalString(due.abs()),
      instalments: 0,
      thresholdEur: SPREAD_THRESHOLD_EUR,
    };
  return {
    year,
    direction: 'pay',
    amountEur: toDecimalString(due),
    instalments: due.gt(D(SPREAD_THRESHOLD_EUR)) ? SPREAD_INSTALMENTS : 1,
    thresholdEur: SPREAD_THRESHOLD_EUR,
  };
}
