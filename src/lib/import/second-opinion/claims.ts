/**
 * Normalisation d'un fichier de second avis (P62) en `SecondOpinionClaim[]` — ce que le fichier
 * ANNONCE, ligne par ligne, avec son verbatim.
 *
 * Trois règles tiennent tout le module :
 *
 * 1. **Aucune conversion de devise inventée.** Une valeur libellée dans une devise que l'app ne
 *    convertit pas ne devient PAS un chiffre : elle devient une réclamation non comparable
 *    (`issue: 'currency-not-eur'`). Un taux improvisé transformerait une comparaison en source
 *    d'écart (même principe que la décision n° 24).
 * 2. **Une case absente devient une réclamation absente, jamais un zéro.** Un zéro inventé serait
 *    comparé, et l'écart serait imputé à quelqu'un.
 * 3. **Le verbatim est la preuve.** Ce qu'on montre à l'utilisateur pour étayer un écart, c'est la
 *    ligne telle qu'il l'a exportée, pas notre relecture de cette ligne.
 *
 * Le fichier n'entre JAMAIS dans le grand livre : il est comparé, pas importé (décision n° 3 —
 * rien n'est persisté non plus).
 */
import type {
  ClaimIssue,
  ComparableMetric,
  CostBasisMethod,
  SecondOpinionClaim,
} from '../../domain/second-opinion';
import type { NaiveDateTime } from '../../domain/types';
import { isDecimalString } from '../../domain/money';
import type { CsvTable } from '../csv';
import { canonHeader, parseCostBasisMethod, type SecondOpinionDetection } from './detect';

/** Devises acceptées telles quelles : l'annexe 2086 est libellée en euros par la loi. */
const EUR_TOKENS = new Set(['', 'eur', 'euro', 'euros', 'e']);

const CURRENCY_SYMBOLS = /[€$£¥]/g;
const HARD_SPACES = new RegExp('[\u00a0\u202f]', 'g');

/**
 * Lit un montant écrit à la française OU à l'anglaise, sans jamais deviner au-delà de ce qui est
 * décidable : quand les deux séparateurs sont présents, **le dernier est le décimal** ; quand un
 * seul l'est, il est décimal s'il apparaît une fois, séparateur de milliers s'il en apparaît
 * plusieurs. Une chaîne qui ne se réduit pas à un décimal canonique reste illisible — jamais
 * approchée.
 */
export function parseAmount(raw: string): string | null {
  let value = raw
    .replace(HARD_SPACES, ' ')
    .replace(CURRENCY_SYMBOLS, '')
    .replace(/\s/g, '')
    .replace(/\bEUR\b/gi, '')
    .trim();
  if (value === '') return null;
  // Parenthèses comptables : (1 234,56) vaut −1 234,56.
  let negative = false;
  const wrapped = /^\((.*)\)$/.exec(value);
  if (wrapped) {
    negative = true;
    value = wrapped[1]!;
  }
  if (value.startsWith('+')) value = value.slice(1);
  if (value.startsWith('-')) {
    negative = !negative;
    value = value.slice(1);
  }
  const commas = (value.match(/,/g) ?? []).length;
  const dots = (value.match(/\./g) ?? []).length;
  if (commas > 0 && dots > 0) {
    const decimal = value.lastIndexOf(',') > value.lastIndexOf('.') ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    value = value.split(thousands).join('').replace(decimal, '.');
  } else if (commas > 1) {
    value = value.split(',').join('');
  } else if (dots > 1) {
    value = value.split('.').join('');
  } else if (commas === 1) {
    value = value.replace(',', '.');
  }
  if (!isDecimalString(value)) return null;
  // `-0` n'est pas canonique : le moteur n'a qu'un seul zéro.
  const signed = negative && !/^0(\.0*)?$/.test(value) ? `-${value}` : value;
  return signed;
}

/**
 * Date d'une ligne → `NaiveDateTime` à minuit. `dd/MM/yyyy` (usage français) et `yyyy-MM-dd`
 * (ISO) sont acceptés ; une heure éventuelle est conservée. Jamais `new Date()` sur ces valeurs
 * (règle de projet) : la lecture est purement lexicale.
 */
export function parseClaimDate(raw: string): NaiveDateTime | null {
  const value = raw.replace(HARD_SPACES, ' ').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  const parts = iso
    ? { y: iso[1]!, mo: iso[2]!, d: iso[3]!, h: iso[4], mi: iso[5], s: iso[6] }
    : fr
      ? { y: fr[3]!, mo: fr[2]!, d: fr[1]!, h: fr[4], mi: fr[5], s: fr[6] }
      : null;
  if (parts === null) return null;
  const month = Number(parts.mo);
  const day = Number(parts.d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const time = `${parts.h ?? '00'}:${parts.mi ?? '00'}:${parts.s ?? '00'}`;
  return `${parts.y}-${parts.mo}-${parts.d}T${time}`;
}

export interface SecondOpinionClaims {
  claims: SecondOpinionClaim[];
  /** Période couverte par le fichier, déduite des dates lues ; `null` si aucune n'est lisible. */
  period: { from: NaiveDateTime; to: NaiveDateTime } | null;
  /** Méthode déclarée PAR LE FICHIER (`fr-global` pour une annexe 2086 : la loi l'impose). */
  declaredMethod: CostBasisMethod;
  /** Lignes du fichier dont la date n'a pas pu être lue : signalées, jamais devinées. */
  unreadableDates: number[];
}

/** Le verbatim d'une ligne : ses cellules non vides, séparées, tronquées à une longueur d'affichage. */
const VERBATIM_MAX = 160;
function verbatimOf(row: readonly string[]): string {
  const joined = row
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '')
    .join(' · ');
  return joined.length > VERBATIM_MAX ? `${joined.slice(0, VERBATIM_MAX - 1)}…` : joined;
}

/**
 * Grandeurs qu'une ligne d'annexe 2086 porte, et la case dont chacune se lit. `tax-proceeds`
 * préfère la case 215 (prix de cession NET des frais) à la 213 : c'est elle que le calcul de la
 * plus-value retient, et c'est elle que `TaxCession.proceedsEur` produit de notre côté.
 */
const TAX_2086_FIELDS: readonly {
  metric: ComparableMetric;
  fields: readonly ('globalValue' | 'proceeds' | 'netProceeds' | 'acquisition' | 'gain')[];
}[] = [
  { metric: 'tax-global-value', fields: ['globalValue'] },
  { metric: 'tax-proceeds', fields: ['netProceeds', 'proceeds'] },
  { metric: 'tax-acquisition', fields: ['acquisition'] },
  { metric: 'tax-gain', fields: ['gain'] },
];

/**
 * Lit les réclamations d'un fichier reconnu. Une détection en échec ne produit rien : il n'y a
 * pas de « lecture au mieux » — un analyseur qui devine est pire qu'un analyseur qui renonce.
 */
export function readSecondOpinionClaims(
  table: CsvTable,
  detection: SecondOpinionDetection,
): SecondOpinionClaims {
  if (!detection.ok) {
    return { claims: [], period: null, declaredMethod: 'unknown', unreadableDates: [] };
  }
  const columns = detection.columns;
  const cell = (row: readonly string[], field: keyof typeof columns): string => {
    const index = columns[field];
    return index === undefined ? '' : (row[index] ?? '');
  };

  // Une colonne « devise » explicite prime sur la présomption d'euro : elle est la seule preuve
  // que le fichier donne sur l'unité de ses montants.
  const currencyIndex = table.header.findIndex((h) =>
    ['devise', 'currency', 'monnaie'].includes(canonHeader(h)),
  );

  const claims: SecondOpinionClaim[] = [];
  const unreadableDates: number[] = [];
  const days: NaiveDateTime[] = [];
  let declaredMethod: CostBasisMethod = detection.declaredMethod;

  table.rows.forEach((row, i) => {
    const line = table.lineNumbers[i] ?? i + 2;
    const verbatim = verbatimOf(row);
    if (verbatim === '') return;

    const methodCell = cell(row, 'method');
    if (methodCell !== '' && declaredMethod === 'unknown') {
      declaredMethod = parseCostBasisMethod(methodCell);
    }

    const at = parseClaimDate(cell(row, 'cessionDate'));
    if (at === null) {
      // Une ligne de total ou d'en-tête répété n'a pas de date : elle est comptée comme telle et
      // ne produit aucune réclamation, plutôt que d'être rattachée à une cession au hasard.
      unreadableDates.push(line);
      return;
    }
    days.push(at);

    const currencyRaw = currencyIndex >= 0 ? (row[currencyIndex] ?? '') : '';
    const currency = currencyRaw.trim() === '' ? null : currencyRaw.trim();
    const currencyIssue: ClaimIssue | null = EUR_TOKENS.has(canonHeader(currencyRaw))
      ? null
      : 'currency-not-eur';

    for (const { metric, fields } of TAX_2086_FIELDS) {
      const source = fields.find((f) => columns[f] !== undefined && cell(row, f).trim() !== '');
      if (source === undefined) continue; // case absente : réclamation absente, jamais un zéro.
      const raw = cell(row, source);
      if (currencyIssue !== null) {
        claims.push({
          metric,
          asset: null,
          at,
          value: null,
          currency,
          issue: currencyIssue,
          line,
          verbatim,
        });
        continue;
      }
      const value = parseAmount(raw);
      claims.push({
        metric,
        asset: null,
        at,
        value,
        currency,
        issue: value === null ? 'value-unreadable' : null,
        line,
        verbatim,
      });
    }
  });

  const sorted = [...days].sort();
  const period = sorted.length === 0 ? null : { from: sorted[0]!, to: sorted[sorted.length - 1]! };
  return { claims, period, declaredMethod, unreadableDates };
}
