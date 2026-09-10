/**
 * Dividendes de titres — revenus de capitaux mobiliers et crédit d'impôt conventionnel.
 *
 * Régime **distinct** des plus-values (`equity-tax-fr.ts`) : un dividende n'est ni une acquisition
 * ni une cession, et `taxKindOf` le renvoie explicitement ici (décision n° 132).
 *
 * ## La mécanique vient du formulaire 2047 lui-même, cadre 20
 *
 * | ligne | contenu |
 * |---|---|
 * | 203 | montant **net** encaissé, déduction faite de l'impôt étranger |
 * | 204 | taux applicable, celui de la notice |
 * | 205 | = 203 × 204 |
 * | 206 | impôt supporté à l'étranger |
 * | 207 | crédit retenu = **min(205, 206)** |
 * | 208 | revenus crédit d'impôt inclus = **203 + 207** → case 2DC |
 *
 * Deux conséquences que le formulaire tranche, et qu'il fallait trancher :
 *
 * 1. **La case 2DC reçoit `net + crédit`, jamais le brut.** Les deux ne coïncident que si la
 *    retenue est exactement au taux conventionnel ; sur une ligne sur-retenue, 2DC reçoit moins que
 *    le brut. La Brochure écrit « montant brut, majoré du crédit d'impôt » — raccourci vrai dans le
 *    cas normal seulement, et le coder tel quel sur-déclarerait les revenus.
 * 2. **Les taux de la notice s'appliquent au NET**, jamais au brut : 17,6 % du net = 15 % du brut.
 *    Les appliquer au brut sur-créditerait de 17 %.
 *
 * ## Le pays de la source ne se devine pas
 *
 * Il ne se déduit **pas** de l'ISIN : un ADR japonais porte un ISIN américain. Mesuré sur un relevé
 * réel, 42,21 € de dividendes sur 89,66 € sont dans ce cas — le Japon plafonne à 11,1 %, les
 * États-Unis à 17,6 %, et se tromper créditerait 59 % de trop sur ce bloc. L'utilisateur désigne
 * donc le pays, titre par titre ; sans désignation, **aucun crédit n'est calculé**, et le montant
 * reste visible dans un seau à part.
 */
import { D, ZERO, min, toDecimalString, type Big } from './money';
import type { AssetCode, CountryCode, DecimalString, LedgerEvent } from './types';

/**
 * Taux de la notice 2047 pour les DIVIDENDES, **appliqués au montant net encaissé**.
 *
 * `null` traduit le « /c » de la notice : imposition exclusive en France, donc **aucun crédit**.
 * Un pays **absent** de la table n'est pas supposé : il tombe dans « pays sans taux connu », et
 * l'application le dit. Même politique que la table des tickers, où un symbole ambigu ne reçoit
 * aucun identifiant — un chiffre faux coûte plus cher qu'un chiffre absent.
 *
 * Chaque valeur est relevée mot pour mot dans la notice 2047-NOT du millésime 2026.
 */
export const TREATY_DIVIDEND_RATES: Readonly<Record<CountryCode, DecimalString | null>> = {
  AT: '0.176',
  AU: '0.176',
  BE: '0.176',
  CA: '0.176',
  CH: '0.176',
  CN: '0.111',
  DE: '0.176',
  DK: '0.176',
  ES: '0.176',
  FI: null,
  GB: '0.176',
  IE: null,
  IL: '0.176',
  IN: '0.111',
  IT: '0.176',
  JP: '0.111',
  LU: '0.176',
  NL: '0.176',
  NO: '0.176',
  PL: '0.176',
  PT: '0.176',
  RO: '0.111',
  SE: '0.176',
  SG: '0.176',
  SK: '0.111',
  US: '0.176',
  ZA: '0.176',
};

/**
 * Valeurs discrètes que la notice emploie. Un taux hors de cette liste est forcément une coquille :
 * le garde-fou l'attrape, là où un « 0.716 » au lieu de « 0.176 » passerait inaperçu à la lecture.
 */
export const NOTICE_RATES: readonly DecimalString[] = [
  '0.053',
  '0.087',
  '0.111',
  '0.136',
  '0.176',
  '0.22',
  '0.25',
  '0.333',
];

/** Entrées de veille portant la mécanique et les taux. */
export const FORM_2047_SOURCE_ID = 'formulaire-2047-cadre-20';
export const TREATY_RATES_SOURCE_ID = 'taux-notice-2047';

/** Cases de la déclaration, avec leur formulaire et leur fondement. */
export const DIVIDEND_TAX_BOXES = {
  income: {
    box: '2DC',
    form: '2042',
    label: 'Revenus des actions et parts — net encaissé, crédit d’impôt inclus (ligne 208)',
    ref: 'CGI art. 108, 158-3',
    sourceId: FORM_2047_SOURCE_ID,
  },
  other: {
    box: '2TS',
    form: '2042',
    label: 'Autres revenus distribués, quand l’abattement de 40 % ne s’applique pas',
    ref: 'CGI art. 158-3',
    sourceId: FORM_2047_SOURCE_ID,
  },
  credit: {
    box: '8VL',
    form: '2042 C',
    label: 'Impôt payé à l’étranger ouvrant droit à un crédit d’impôt — NON restituable',
    ref: 'CGI art. 199 ter',
    sourceId: 'case-8vl',
  },
  netForeign: {
    box: '8PL',
    form: '2042 C',
    label: 'Revenus nets de source étrangère ouvrant droit à ce crédit',
    ref: 'CGI art. 199 ter',
    sourceId: 'case-8vl',
  },
  foreign: {
    box: '2047',
    form: '2047',
    label: 'Revenus encaissés à l’étranger, cadre 20 — obligatoire si le payeur est hors de France',
    ref: 'CGI art. 170',
    sourceId: FORM_2047_SOURCE_ID,
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
export const DIVIDEND_TAX_ASSUMPTIONS: readonly string[] = [
  'Le pays de la source est celui que vous désignez, titre par titre. Il ne se déduit pas de l’ISIN : un certificat de dépôt (ADR) japonais porte un ISIN américain.',
  'Le crédit est calculé par pays et par année, comme le formulaire 2047 le présente en colonnes — et non ligne à ligne.',
  'Le second plafond légal, l’impôt français afférent à ces revenus, n’est pas appliqué : il dépend de l’ensemble de votre foyer, que l’application ne connaît pas. Le crédit affiché peut donc être surestimé si ces revenus sont peu ou pas imposés chez vous.',
  'La retenue qui dépasse le taux conventionnel n’est pas imputable en France. L’application la chiffre ; elle n’indique aucune démarche de restitution auprès de l’État de la source.',
  'Un dividende de source française n’entre pas dans ce mécanisme : il est montré à part, sans arbitrage sur le sort de la retenue subie.',
];

/** Ce qu'un pays devient dans le calcul, une fois désigné — ou non. */
export type CountryOutcome = 'credited' | 'no-treaty-credit' | 'rate-unknown' | 'domestic';

export interface DividendCountry {
  country: CountryCode | null;
  outcome: CountryOutcome;
  /** Taux de la notice retenu, `null` quand aucun crédit n'est calculable. */
  rate: DecimalString | null;
  grossEur: DecimalString;
  /** Ligne 203 : net encaissé. */
  netEur: DecimalString;
  /** Ligne 206 : impôt supporté à l'étranger. */
  withheldEur: DecimalString;
  /** Ligne 205, avant plafonnement — montré pour que le plafond se lise. */
  cappedAtEur: DecimalString;
  /** Ligne 207 : crédit retenu. */
  creditEur: DecimalString;
  /** Ligne 208 : ce qui se déclare, net + crédit. */
  declaredEur: DecimalString;
  /** Retenue au-delà du plafond conventionnel : perdue côté français. */
  excessEur: DecimalString;
  assets: readonly AssetCode[];
}

export interface DividendTaxYear {
  year: number;
  countries: readonly DividendCountry[];
  grossEur: DecimalString;
  withheldEur: DecimalString;
  /** Somme des lignes 208 des pays crédités et non crédités : la case 2DC. */
  declaredEur: DecimalString;
  /** Somme des lignes 207 : la case 8VL. */
  creditEur: DecimalString;
  /** Somme des nets ouvrant droit au crédit : la case 8PL. */
  netForeignEur: DecimalString;
  excessEur: DecimalString;
  /** Titres ayant versé un dividende sans pays désigné : rien n'est calculé pour eux. */
  undesignated: readonly AssetCode[];
}

export interface DividendTaxLedger {
  years: readonly DividendTaxYear[];
  assumptions: readonly string[];
  /** Vrai dès qu'un titre attend une désignation : l'écran ne réclame rien sans raison. */
  hasUndesignated: boolean;
}

export interface DividendTaxInput {
  events: readonly LedgerEvent[];
  /**
   * Pays de la source d'un titre, tel que l'utilisateur l'a désigné. `null` = pas désigné.
   *
   * Une fonction plutôt qu'un dictionnaire : le domaine reste pur, et le test n'a rien à monter.
   */
  countryOf: (asset: AssetCode) => CountryCode | null;
  throughYear: number;
}

const yearOf = (at: string): number => Number(at.slice(0, 4));

interface Bucket {
  gross: Big;
  withheld: Big;
  assets: Set<AssetCode>;
}

const emptyBucket = (): Bucket => ({ gross: ZERO, withheld: ZERO, assets: new Set() });

export function dividendTaxFr(input: DividendTaxInput): DividendTaxLedger {
  /** année → (pays désigné, ou `''` quand il ne l'est pas) → cumul. */
  const byYear = new Map<number, Map<string, Bucket>>();
  let first = Number.POSITIVE_INFINITY;

  for (const event of input.events) {
    // Un dividende, et lui seul : les intérêts de trésorerie et les frais de conversion partagent
    // le type `income` mais pas le régime — ils relèvent d'autres cases.
    if (event.kind !== 'income' || event.nature !== 'dividend' || event.asset === null) continue;
    const year = yearOf(event.at);
    if (Number.isNaN(year)) continue;
    first = Math.min(first, year);
    const key = input.countryOf(event.asset) ?? '';
    const perCountry = byYear.get(year) ?? new Map<string, Bucket>();
    const bucket = perCountry.get(key) ?? emptyBucket();
    bucket.gross = bucket.gross.plus(D(event.grossEur));
    bucket.withheld = bucket.withheld.plus(D(event.withheldEur));
    bucket.assets.add(event.asset);
    perCountry.set(key, bucket);
    byYear.set(year, perCountry);
  }

  if (!Number.isFinite(first))
    return { years: [], assumptions: DIVIDEND_TAX_ASSUMPTIONS, hasUndesignated: false };

  const years: DividendTaxYear[] = [];
  let hasUndesignated = false;

  for (let year = first; year <= input.throughYear; year++) {
    const perCountry = byYear.get(year);
    if (!perCountry || perCountry.size === 0) continue;

    const countries: DividendCountry[] = [];
    const undesignated: AssetCode[] = [];

    for (const [key, bucket] of [...perCountry].sort((a, b) => a[0].localeCompare(b[0]))) {
      const country = key === '' ? null : key;
      const net = bucket.gross.minus(bucket.withheld);

      // Aucun pays désigné : on montre, on ne calcule pas. C'est l'arbitrage de l'utilisateur.
      if (country === null) {
        hasUndesignated = true;
        undesignated.push(...bucket.assets);
        countries.push(line(null, 'rate-unknown', null, bucket, net, ZERO, ZERO));
        continue;
      }
      // Source française : hors du mécanisme du 2047, qui ne traite que l'impôt ÉTRANGER.
      if (country === 'FR') {
        countries.push(line(country, 'domestic', null, bucket, net, ZERO, ZERO));
        continue;
      }
      const rate = country in TREATY_DIVIDEND_RATES ? TREATY_DIVIDEND_RATES[country]! : undefined;
      if (rate === undefined) {
        countries.push(line(country, 'rate-unknown', null, bucket, net, ZERO, ZERO));
        continue;
      }
      if (rate === null) {
        // « /c » : imposition exclusive en France. Le net se déclare, sans aucun crédit.
        countries.push(line(country, 'no-treaty-credit', null, bucket, net, ZERO, ZERO));
        continue;
      }
      // Lignes 205 puis 207 : le crédit est le plus petit des deux, jamais la retenue seule.
      const capped = net.times(D(rate));
      countries.push(
        line(country, 'credited', rate, bucket, net, capped, min(capped, bucket.withheld)),
      );
    }

    // Les totaux se somment SUR LES LIGNES, jamais en parallèle d'elles. Une seconde formule aurait
    // pu diverger sans qu'aucun test ne le voie : c'est exactement ce qu'une contre-épreuve a
    // montré, en restant verte alors que le total était faussé.
    const sum = (pick: (c: DividendCountry) => DecimalString): Big =>
      countries.reduce((total, c) => total.plus(D(pick(c))), ZERO);

    years.push({
      year,
      countries,
      grossEur: toDecimalString(sum((c) => c.grossEur)),
      withheldEur: toDecimalString(sum((c) => c.withheldEur)),
      declaredEur: toDecimalString(sum((c) => c.declaredEur)),
      creditEur: toDecimalString(sum((c) => c.creditEur)),
      netForeignEur: toDecimalString(
        countries
          .filter((c) => c.outcome === 'credited')
          .reduce((total, c) => total.plus(D(c.netEur)), ZERO),
      ),
      excessEur: toDecimalString(sum((c) => c.excessEur)),
      undesignated: [...new Set(undesignated)].sort(),
    });
  }

  return { years, assumptions: DIVIDEND_TAX_ASSUMPTIONS, hasUndesignated };
}

function line(
  country: CountryCode | null,
  outcome: CountryOutcome,
  rate: DecimalString | null,
  bucket: Bucket,
  net: Big,
  capped: Big,
  credit: Big,
): DividendCountry {
  const declared =
    outcome === 'credited' ? net.plus(credit) : outcome === 'no-treaty-credit' ? net : ZERO;
  return {
    country,
    outcome,
    rate,
    grossEur: toDecimalString(bucket.gross),
    netEur: toDecimalString(net),
    withheldEur: toDecimalString(bucket.withheld),
    cappedAtEur: toDecimalString(capped),
    creditEur: toDecimalString(credit),
    declaredEur: toDecimalString(declared),
    excessEur: toDecimalString(outcome === 'credited' ? bucket.withheld.minus(credit) : ZERO),
    assets: [...bucket.assets].sort(),
  };
}
