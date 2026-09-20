/**
 * L'état d'une année fiscale — et ce que l'année EN COURS a de particulier (décision n° 169).
 *
 * Une année close se lit : son résultat ne bougera plus, il ne reste qu'à le déclarer. L'année en
 * cours, elle, est un provisoire que l'écran doit annoncer comme tel, parce que deux choses y sont
 * encore ouvertes et qu'aucune ne survivra au 31 décembre :
 *
 * 1. **Le seuil de 305 €.** Tant que le total des prix de cession reste dessous, l'année entière
 *    est exonérée (CGI art. 150 VH bis, II-B). Une vente de plus peut donc faire basculer d'un coup
 *    des plus-values qui n'étaient pas imposables — ce n'est pas un abattement, c'est une falaise.
 * 2. **La poche d'imputation.** Une moins-value nette ne se reporte PAS sur les années suivantes
 *    (CGI art. 150 VH bis, IV) : elle s'impute sur les plus-values de même nature de la MÊME année,
 *    et sur elles seules. Au 1er janvier, ce qui n'a pas servi est éteint.
 *
 * Ce module décrit ; il ne conseille rien et ne suggère aucune opération. Module pur, horloge
 * injectée — jamais `new Date()`.
 */
import { EXEMPTION_THRESHOLD, type TaxLedger, type TaxYear } from '../domain/tax-fr';
import { D, ZERO, toDecimalString, type DecimalString } from '../domain/money';

/** Où en est une année par rapport à aujourd'hui. */
export type TaxYearState =
  /** Terminée : son résultat est figé, il reste à le déclarer. */
  | 'closed'
  /** L'année civile en cours : tout y est encore provisoire. */
  | 'in-progress'
  /** À venir : rien ne s'y est encore passé. */
  | 'future';

export interface YearOutlook {
  year: number;
  state: TaxYearState;
  /** Le printemps où cette année se déclare : l'année suivante. */
  declaredIn: number;
  /** Le millésime tel que le moteur l'a établi ; `null` quand l'année ne porte aucune cession. */
  taxYear: TaxYear | null;
  /** Le seuil lui-même, pour que l'écran n'ait pas à le recopier. */
  thresholdEur: DecimalString;
  /** Ce qui reste de cessions avant de franchir le seuil ; `'0'` une fois franchi. */
  toThresholdEur: DecimalString;
  /**
   * Moins-value nette encore imputable **cette année-là** : ce qu'une plus-value réalisée avant
   * l'échéance effacerait. `'0'` dès que l'année est en gain.
   */
  offsetPocketEur: DecimalString;
  /** Dernier jour où la poche existe. Au lendemain, elle est éteinte. */
  pocketExpiresOn: string;
}

/** Où en est une année, et quand elle se déclare. */
export interface YearStatus {
  state: TaxYearState;
  /** Le printemps où cette année se déclare : l'année suivante. */
  declaredIn: number;
}

/**
 * L'état d'une année **sans rien savoir de ses opérations** : il ne se lit que sur le calendrier.
 *
 * Séparé de `yearOutlook` parce qu'un écran doit pouvoir annoncer « année en cours, provisoire »
 * alors même que le grand livre n'est pas chargé — hors ligne, par exemple. Taire l'état parce
 * qu'un cours manque serait taire la seule chose qui, elle, est certaine.
 */
export function yearStatus(year: number, today: string): YearStatus {
  const currentYear = Number(today.slice(0, 4));
  return {
    state: year < currentYear ? 'closed' : year > currentYear ? 'future' : 'in-progress',
    declaredIn: year + 1,
  };
}

/** L'état d'une année et ce qui y reste ouvert, `today` au format `AAAA-MM-JJ`. */
export function yearOutlook(ledger: TaxLedger, year: number, today: string): YearOutlook {
  const { state, declaredIn } = yearStatus(year, today);
  const taxYear = ledger.years.find((y) => y.year === year) ?? null;
  const proceeds = taxYear === null ? ZERO : D(taxYear.proceedsEur);
  const remaining = D(EXEMPTION_THRESHOLD).minus(proceeds);
  const net = taxYear === null ? ZERO : D(taxYear.netEur);
  return {
    year,
    state,
    declaredIn,
    taxYear,
    thresholdEur: EXEMPTION_THRESHOLD,
    toThresholdEur: toDecimalString(remaining.gt(ZERO) ? remaining : ZERO),
    offsetPocketEur: toDecimalString(net.lt(ZERO) ? net.times(D('-1')) : ZERO),
    pocketExpiresOn: `${year}-12-31`,
  };
}
