/**
 * Intérêts de trésorerie — produits de placement à revenu fixe, case 2TR.
 *
 * Module **frère** de `equity-income-fr.ts`, pas une extension : un dividende et un intérêt ne
 * partagent ni leur case ni leur cadre, et le commentaire d'entrée de ce module-là écarte déjà les
 * intérêts.
 *
 * ## Le chemin, tel que le formulaire 2047 l'imprime
 *
 * Le cadre 30 double le cadre 20 : lignes 231 à 238, avec le même `crédit = min(235, 236)`. Puis :
 *
 * - **250** intérêts n'ouvrant pas droit à crédit d'impôt → **251** total → **252** → case **2TR** ;
 * - 253 → **2TT**, la case des prêts participatifs, que la brochure exclut expressément de 2TR —
 *   c'est pourquoi `lending/tax-fr.ts` est un module séparé et le reste.
 *
 * ## Ce que ce module NE calcule pas, et pourquoi
 *
 * **Aucun crédit d'impôt.** Les intérêts d'un compte de courtage ne portent, en pratique, aucune
 * retenue à la source — le relevé n'a pas même de colonne pour en porter une. Si une retenue
 * apparaissait, la créditer demanderait la colonne « int. » de la notice 2047, **que l'application
 * n'a pas relevée** : elle diffère de la colonne « dividendes » pays par pays. L'application
 * signalerait alors la retenue sans la créditer, plutôt que d'employer un taux qu'elle n'a pas lu.
 *
 * **Aucun impôt estimé.** Le taux dépend de la qualification exacte de ces intérêts — « produits de
 * placement » ou « revenus du patrimoine » —, qui décide de l'année où la CSG passe à 10,6 %.
 * L'administration ne l'énonce pas pour un payeur étranger sans prélèvement forfaitaire, et un
 * chiffre posé là serait une prise de position déguisée en calcul.
 */
import { D, ZERO, toDecimalString, type Big } from './money';
import type { DecimalString, LedgerEvent } from './types';

/** Entrée de veille portant le cadre 30 et la case 2TR. */
export const FORM_2047_INTEREST_SOURCE_ID = 'formulaire-2047-cadre-30';

/** Cases de la déclaration, avec leur formulaire et leur fondement. */
export const INTEREST_TAX_BOXES = {
  interest: {
    box: '2TR',
    form: '2042',
    label: 'Intérêts et autres produits de placement à revenu fixe',
    ref: 'CGI art. 125 A',
    sourceId: FORM_2047_INTEREST_SOURCE_ID,
  },
  foreign: {
    box: '2047',
    form: '2047',
    label: 'Revenus encaissés à l’étranger, cadre 30 — obligatoire si le payeur est hors de France',
    ref: 'CGI art. 170',
    sourceId: FORM_2047_INTEREST_SOURCE_ID,
  },
  option: {
    box: '2OP',
    form: '2042',
    label: 'Option pour le barème progressif',
    ref: 'CGI art. 200 A',
    sourceId: 'bareme-progressif',
  },
} as const;

/** À reproduire à l'écran mot pour mot : une convention n'est pas une règle de droit. */
export const INTEREST_TAX_ASSUMPTIONS: readonly string[] = [
  'Ces intérêts se déclarent case 2TR, et NON case 2TT : cette dernière est réservée aux prêts participatifs et aux minibons, que la brochure exclut expressément de 2TR.',
  'Aucun impôt n’est estimé ici : le taux dépend de la qualification de ces intérêts, qui décide de l’année où la CSG passe à 10,6 %, et l’administration ne l’énonce pas pour un payeur étranger sans prélèvement forfaitaire.',
  'Aucun crédit d’impôt n’est calculé : ces intérêts ne portent aucune retenue à la source. Si votre relevé en portait une, l’application la montrerait sans la créditer — la colonne « intérêts » de la notice 2047 n’y figure pas.',
  'Les frais de conversion de devise ne sont pas déductibles ici : ce sont des frais de change sur des liquidités, pas des frais de garde de titres. Ils réduisent votre résultat, pas votre revenu imposable.',
];

export interface InterestTaxYear {
  year: number;
  /** Ce qui se déclare case 2TR : le montant brut encaissé. */
  grossEur: DecimalString;
  /** Retenue à la source subie, s’il en existe une. Aucun crédit n’en est tiré ici. */
  withheldEur: DecimalString;
  /** Nombre de versements de l’année : un total sans son compte se vérifie mal. */
  count: number;
}

export interface InterestTaxLedger {
  years: readonly InterestTaxYear[];
  assumptions: readonly string[];
  /** Vrai si une retenue existe quelque part : l’écran ne parle du sujet que dans ce cas. */
  hasWithholding: boolean;
}

export interface InterestTaxInput {
  events: readonly LedgerEvent[];
  throughYear: number;
}

const yearOf = (at: string): number => Number(at.slice(0, 4));

export function interestTaxFr(input: InterestTaxInput): InterestTaxLedger {
  const byYear = new Map<number, { gross: Big; withheld: Big; count: number }>();

  for (const event of input.events) {
    // Un intérêt, et lui seul : un dividende relève du cadre 20 et de la case 2DC, un frais de
    // conversion n'est pas un revenu — il partage le type, jamais le régime.
    if (event.kind !== 'income' || event.nature !== 'interest') continue;
    const year = yearOf(event.at);
    if (Number.isNaN(year) || year > input.throughYear) continue;
    const bucket = byYear.get(year) ?? { gross: ZERO, withheld: ZERO, count: 0 };
    bucket.gross = bucket.gross.plus(D(event.grossEur));
    bucket.withheld = bucket.withheld.plus(D(event.withheldEur));
    bucket.count += 1;
    byYear.set(year, bucket);
  }

  const years = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, b]) => ({
      year,
      grossEur: toDecimalString(b.gross),
      withheldEur: toDecimalString(b.withheld),
      count: b.count,
    }));

  return {
    years,
    assumptions: INTEREST_TAX_ASSUMPTIONS,
    hasWithholding: years.some((y) => D(y.withheldEur).gt(ZERO)),
  };
}
