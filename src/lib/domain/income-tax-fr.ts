/**
 * Le barème progressif de l'impôt sur le revenu, et les deux mécanismes qui n'existent que sous lui
 * (décision n° 150).
 *
 * **Ce module ne calcule pas votre impôt.** Il n'en a pas les moyens : l'impôt d'un foyer dépend de
 * son revenu global, de son quotient familial, de sa décote et de ses réductions, dont cette
 * application ne connaît rien. Ce qu'il porte est plus modeste et plus honnête — la **table des
 * taux marginaux**, avec les bornes qui permettent à quelqu'un de reconnaître sa tranche, et les
 * deux règles qui font que le barème n'est pas simplement « votre taux à la place de 12,8 % » :
 *
 * 1. **L'abattement de 40 %** sur les revenus distribués (CGI art. 158, 3-2°), qui n'existe pas
 *    sous le prélèvement forfaitaire.
 * 2. **La CSG déductible**, « à hauteur de 6,8 points » (CGI art. 154 quinquies, II), réservée aux
 *    revenus « imposés dans les conditions prévues à l'article 197 » — donc au barème. La brochure
 *    pratique 2026 le dit dans l'autre sens, et c'est la phrase qui commande tout l'arbitrage :
 *    « Aucune CSG calculée sur les revenus du patrimoine n'est déductible lorsque ces revenus ont
 *    été imposés à l'impôt sur le revenu à un taux forfaitaire ».
 *
 * Module pur : aucun `Big`, aucune horloge. C'est une table.
 */
import type { DecimalString } from './types';

/** Une tranche du barème : son taux, et la limite HAUTE du revenu par part qu'elle couvre. */
export interface IncomeTaxBracket {
  /** Limite haute, par part de quotient familial. `null` pour la dernière tranche. */
  upToEur: DecimalString | null;
  rate: DecimalString;
}

/**
 * Le barème d'une **année de revenus précise**. Pas de repli sur l'année d'avant : les bornes sont
 * indexées chaque année, et afficher celles de 2025 à quelqu'un qui déclare 2024 lui ferait
 * reconnaître la mauvaise tranche.
 */
export interface IncomeTaxScale {
  /** Année des REVENUS, pas de la déclaration. */
  year: number;
  brackets: readonly IncomeTaxBracket[];
  /** Identifiant de veille qui porte le texte (`src/lib/watch/entries.ts`), comme `TaxRate`. */
  sourceId?: string;
}

export const INCOME_TAX_SCALES: readonly IncomeTaxScale[] = [
  {
    year: 2024,
    brackets: [
      { upToEur: '11497', rate: '0' },
      { upToEur: '29315', rate: '0.11' },
      { upToEur: '83823', rate: '0.30' },
      { upToEur: '180294', rate: '0.41' },
      { upToEur: null, rate: '0.45' },
    ],
  },
  {
    year: 2025,
    brackets: [
      { upToEur: '11600', rate: '0' },
      { upToEur: '29579', rate: '0.11' },
      { upToEur: '84577', rate: '0.30' },
      { upToEur: '181917', rate: '0.41' },
      { upToEur: null, rate: '0.45' },
    ],
    sourceId: 'bareme-ir-2025',
  },
];

/** Le barème de cette année de revenus, ou `null` : on ne devine pas des bornes indexées. */
export function scaleFor(year: number): IncomeTaxScale | null {
  return INCOME_TAX_SCALES.find((scale) => scale.year === year) ?? null;
}

/**
 * Les taux marginaux, du plus bas au plus haut.
 *
 * Ils sont **stables** là où les bornes bougent chaque année : c'est pourquoi un arbitrage reste
 * calculable pour une année dont le barème n'est pas dans la table — il ne dépend que du taux.
 */
export const MARGINAL_RATES: readonly DecimalString[] = ['0', '0.11', '0.30', '0.41', '0.45'];

/**
 * Fraction de la CSG déductible du revenu global, en **points** — donc un pourcentage de
 * l'assiette, pas une fraction de la CSG payée.
 *
 * « La contribution afférente aux revenus […] imposés dans les conditions prévues à l'article 197
 * […] est admise en déduction du revenu imposable de l'année de son paiement, **à hauteur de 6,8
 * points** » (CGI art. 154 quinquies, II). Le taux ne suit donc pas la CSG : celle-ci est passée de
 * 9,2 % à 10,6 % sans que la part déductible bouge — c'est la part NON déductible qui a grossi.
 */
export const CSG_DEDUCTIBLE_RATE: DecimalString = '0.068';

/** Entrée de veille qui porte le texte ci-dessus. */
export const CSG_DEDUCTIBLE_SOURCE_ID = 'csg-deductible';

/**
 * Abattement sur les revenus distribués, sous le barème uniquement (CGI art. 158, 3-2°).
 *
 * Il suppose une société soumise à un impôt équivalent à l'IS et établie en France, dans l'Union
 * ou dans un État lié par une convention comportant une clause d'assistance administrative.
 * L'application ne vérifie ni l'un ni l'autre : elle l'applique, et le dit.
 */
export const DIVIDEND_ABATEMENT: DecimalString = '0.4';

/**
 * Le moment où le gain de la CSG déductible arrive, pour les revenus recouvrés par avis
 * d'imposition : « La déduction s'opère sur les revenus de l'année du paiement de la CSG ».
 * La CSG d'une année N étant mise en recouvrement en N+1, le gain porte sur la déclaration
 * suivante — il est réel, mais différé, et le taire surestimerait le coût du barème.
 */
export const CSG_DEDUCTIBLE_DEFERRED_BY_YEARS = 1;
