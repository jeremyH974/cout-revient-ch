/**
 * Inférence de FORME d'une colonne (P64) : ce que ses cellules ont l'air d'être, avant qu'on sache
 * ce qu'elles sont.
 *
 * Un en-tête inconnu ne dit rien ; ses valeurs, si. « Coin » peut être une devise ou un identifiant
 * de wallet — mais une colonne dont 100 % des cellules valent `BTC`, `ETH`, `USDC` et qui n'en
 * compte que sept distinctes ne peut pas être un identifiant. La forme est donc l'autre moitié du
 * score (`score.ts`), et la seule qui reste vraie quand le fichier est traduit dans une langue
 * qu'on n'a pas prévue.
 *
 * ## Les classes sont EXCLUSIVES, et l'ordre les départage
 *
 * Une colonne reçoit **une** classe. L'ordre d'essai va du plus contraint au plus permissif :
 * dates, puis empreintes, puis décimaux (signés d'abord — voir plus bas), puis codes d'actifs,
 * puis énumérations courtes, puis texte libre. Sans cet ordre, `2026-03-02` serait « texte libre »
 * autant que « date ISO », et la forme cesserait d'informer.
 *
 * ## Le seuil de 90 %, et pourquoi il n'est pas 100 %
 *
 * Une classe n'est retenue qu'au-delà de **90 % des cellules non vides**. Les exports réels
 * portent des lignes de pied de page, des `N/A`, des cellules « pending » : exiger l'unanimité
 * ferait retomber en « texte libre » des colonnes parfaitement lisibles, et le score perdrait son
 * meilleur signal au moment précis où le fichier est le plus inhabituel.
 *
 * ## `signed-decimal` : une forme reconnue, une forme NON PRISE EN CHARGE
 *
 * Une colonne de montants dont au moins une cellule porte un signe explicite est classée
 * `signed-decimal`. C'est la signature du format « une seule jambe signée » (un montant négatif
 * pour une sortie, positif pour une entrée), que la v1 de l'appariement assisté ne traite pas :
 * elle n'écrit que des paires envoyé/reçu. Cette classe existe donc **pour pouvoir le dire** —
 * « ce fichier a une colonne de montant signée, cette forme n'est pas encore prise en charge » —
 * plutôt que d'échouer génériquement. Voir `docs/pivot-import.md`.
 *
 * Module pur : aucun `Big` (rien n'est calculé ici, seulement classé), aucun DOM, aucun réseau.
 */
import { isFiat, normalizeAssetCode } from '../../domain/assets';
import { tickerInfo } from '../../pricing/tickers';

export type ValueShape =
  | 'iso-datetime'
  | 'dmy-datetime'
  | 'epoch-s'
  | 'epoch-ms'
  | 'decimal-dot'
  | 'decimal-comma'
  | 'signed-decimal'
  | 'asset-code'
  | 'hash-hex'
  | 'enum-small'
  | 'free-text'
  | 'empty';

/** Les formes, dans l'ordre déclaré — pour la documentation et les tests d'exhaustivité. */
export const VALUE_SHAPES: readonly ValueShape[] = [
  'iso-datetime',
  'dmy-datetime',
  'epoch-s',
  'epoch-ms',
  'decimal-dot',
  'decimal-comma',
  'signed-decimal',
  'asset-code',
  'hash-hex',
  'enum-small',
  'free-text',
  'empty',
];

export interface ShapeInfo {
  readonly shape: ValueShape;
  /** Valeurs distinctes (cellules non vides), après passage en minuscules. */
  readonly distinct: number;
  readonly nonEmpty: number;
  /** Cellules examinées (les 100 premières lignes non vides, au plus). */
  readonly sampled: number;
}

/** Cent lignes suffisent : au-delà, la classe ne change plus et la lecture coûte. */
export const SHAPE_SAMPLE = 100;

/** Part minimale de cellules non vides qu'une classe doit couvrir pour être retenue. */
export const SHAPE_THRESHOLD = 0.9;

/** Au-delà, une colonne n'énumère plus : elle décrit. */
export const ENUM_MAX_DISTINCT = 40;

/** Et une colonne qui ne se répète pas n'énumère pas non plus, si peu de valeurs soit-elle. */
export const ENUM_MAX_RATIO = 0.2;

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/;
const DMY_DATETIME = /^\d{1,2}[/.]\d{1,2}[/.]\d{4}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?$/;
/** ~2001 à ~2286 : au-dessous, un entier de neuf chiffres est bien plus souvent une quantité. */
const EPOCH_S = /^\d{10}$/;
const EPOCH_MS = /^\d{13}$/;
const HASH_HEX = /^(?:0x)?[0-9a-fA-F]{32,80}$/;
/** Un ticker : deux à douze caractères alphanumériques, dont au moins une lettre (`1INCH`). */
const TICKER_LIKE = /^(?=.*[A-Za-z])[A-Za-z0-9]{2,12}$/;

/**
 * Part des valeurs DISTINCTES qui doivent être des actifs connus de l'app pour qu'une colonne soit
 * dite `asset-code`.
 *
 * Sans cette seconde condition, `buy` / `sell` / `exchange` passeraient pour des tickers — ils ont
 * exactement la forme d'un code d'actif — et la colonne de TYPE d'un fichier serait classée comme
 * une colonne de devise. La forme seule ne sait pas les distinguer ; la table des tickers, si. Une
 * colonne de tickers exotiques absents de la table retombe en `enum-small`, qui reste une forme
 * admise pour un champ « devise » : on perd un signal, jamais une possibilité.
 */
const KNOWN_ASSET_RATIO = 0.6;

/** Signe explicite en tête, ou parenthèses comptables : `-12,5`, `+3.1`, `(12.5)`. */
const SIGNED = /^[+-]|^\(.*\)$/;

interface DecimalRead {
  readonly ok: boolean;
  /** Séparateur décimal effectivement lu, ou `null` pour un entier (compatible avec les deux). */
  readonly separator: '.' | ',' | null;
  readonly signed: boolean;
}

const NOT_DECIMAL: DecimalRead = { ok: false, separator: null, signed: false };

/**
 * Lit une cellule comme un décimal et rend le séparateur employé. Les quatre écritures courantes
 * sont couvertes : `1234.56`, `1234,56`, `1 234,56` (groupes en espace, y compris insécable) et
 * `1,234.56` (groupes en virgule). L'ambiguïté ne se tranche pas ici, elle se **rapporte** : un
 * entier nu ne porte aucun séparateur et sert donc les deux classes.
 */
export function readDecimalShape(raw: string): DecimalRead {
  const text = raw.trim();
  if (text === '') return NOT_DECIMAL;
  const signed = SIGNED.test(text);
  const body = text
    .replace(/^\((.*)\)$/, '$1')
    .replace(/^[+-]/, '')
    .replace(/\s/g, '');
  if (body === '') return NOT_DECIMAL;
  if (/^\d+$/.test(body)) return { ok: true, separator: null, signed };
  // `1,234.56` : virgules de groupement, point décimal.
  if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(body)) return { ok: true, separator: '.', signed };
  // `1.234,56` : points de groupement, virgule décimale.
  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(body)) return { ok: true, separator: ',', signed };
  if (/^\d+\.\d+$/.test(body)) return { ok: true, separator: '.', signed };
  if (/^\d+,\d+$/.test(body)) return { ok: true, separator: ',', signed };
  // `1 234` déjà dégroupé plus haut ; `1,234` seul reste ambigu → virgule décimale par défaut,
  // c'est l'écriture française, et le fichier est lu par un utilisateur français.
  if (/^\d{1,3},\d{3}$/.test(body)) return { ok: true, separator: ',', signed };
  return NOT_DECIMAL;
}

const ratio = (count: number, total: number): number => (total === 0 ? 0 : count / total);

/**
 * La forme d'une colonne à partir de ses cellules. `values` est déjà l'échantillon (les cellules
 * de la colonne, dans l'ordre du fichier) ; la fonction en garde les `SHAPE_SAMPLE` premières
 * lignes non vides — les lignes vides ne renseignent sur rien, et les compter diluerait le seuil.
 */
export function inferShape(values: readonly string[]): ShapeInfo {
  const cells: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (text === '') continue;
    cells.push(text);
    if (cells.length >= SHAPE_SAMPLE) break;
  }
  const nonEmpty = cells.length;
  const distinct = new Set(cells.map((c) => c.toLowerCase())).size;
  const base: Omit<ShapeInfo, 'shape'> = { distinct, nonEmpty, sampled: nonEmpty };
  if (nonEmpty === 0) return { ...base, shape: 'empty' };

  const count = (predicate: (cell: string) => boolean): number =>
    cells.reduce((acc, cell) => (predicate(cell) ? acc + 1 : acc), 0);
  const holds = (predicate: (cell: string) => boolean): boolean =>
    ratio(count(predicate), nonEmpty) >= SHAPE_THRESHOLD;

  if (holds((c) => ISO_DATETIME.test(c))) return { ...base, shape: 'iso-datetime' };
  if (holds((c) => DMY_DATETIME.test(c))) return { ...base, shape: 'dmy-datetime' };
  if (holds((c) => EPOCH_MS.test(c))) return { ...base, shape: 'epoch-ms' };
  if (holds((c) => EPOCH_S.test(c))) return { ...base, shape: 'epoch-s' };
  if (holds((c) => HASH_HEX.test(c))) return { ...base, shape: 'hash-hex' };

  const decimals = cells.map(readDecimalShape);
  const decimalCount = decimals.filter((d) => d.ok).length;
  if (ratio(decimalCount, nonEmpty) >= SHAPE_THRESHOLD) {
    // Le signe l'emporte : c'est lui qui dit « une seule jambe », la forme non prise en charge.
    if (decimals.some((d) => d.ok && d.signed)) return { ...base, shape: 'signed-decimal' };
    if (decimals.some((d) => d.ok && d.separator === ','))
      return { ...base, shape: 'decimal-comma' };
    return { ...base, shape: 'decimal-dot' };
  }

  if (holds((c) => TICKER_LIKE.test(c))) {
    const codes = [...new Set(cells.map((c) => normalizeAssetCode(c)))];
    const known = codes.filter((c) => isFiat(c) || tickerInfo(c) !== null).length;
    if (ratio(known, codes.length) >= KNOWN_ASSET_RATIO) return { ...base, shape: 'asset-code' };
  }
  if (distinct <= ENUM_MAX_DISTINCT && ratio(distinct, nonEmpty) <= ENUM_MAX_RATIO)
    return { ...base, shape: 'enum-small' };
  return { ...base, shape: 'free-text' };
}

/** Les formes qui portent un instant : la seule famille dont `date` puisse se contenter. */
export const TIME_SHAPES: readonly ValueShape[] = [
  'iso-datetime',
  'dmy-datetime',
  'epoch-s',
  'epoch-ms',
];

/** Les formes qui portent un nombre. `signed-decimal` en fait partie : elle est lue, pas écrite. */
export const NUMERIC_SHAPES: readonly ValueShape[] = [
  'decimal-dot',
  'decimal-comma',
  'signed-decimal',
];
