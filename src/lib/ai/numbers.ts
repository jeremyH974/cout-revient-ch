/**
 * Lecture des nombres d'un texte français — la moitié « extraction » du harnais d'évaluation des
 * fonctions d'IA (P70). Aucun modèle n'est appelé ici, aucune phrase n'est jugée : ce module
 * transforme un texte en jetons numériques CLASSÉS, que `./anchor.ts` confronte ensuite aux
 * chiffres de la source. Module pur — ni DOM, ni réseau, ni horloge.
 *
 * ## Le constat empirique qui commande tout le reste
 *
 * Vérifié sur ce dépôt (Node 24, ICU 78.2), `Intl` en `fr-FR` :
 *
 * - groupe les milliers avec **U+202F** (espace fine insécable) : `1 234 567,89` s'écrit
 *   `31 202f 32 33 34 202f 35 36 37 2c 38 39` ;
 * - n'emploie **U+00A0** (espace insécable) que **devant `€` et `%`** ;
 * - groupe dès quatre chiffres : `2026` mis en forme donne `2 026`, jamais `2026`.
 *
 * Et `src/lib/format/fr.ts` préfixe les négatifs du signe moins typographique **U+2212**, pas du
 * trait d'union. Un extracteur écrit contre U+00A0 seul laisserait donc passer **tous les
 * milliers** — c'est-à-dire précisément les montants qui comptent. Les quatre séparateurs
 * (U+202F, U+00A0, U+2009, espace ordinaire) sont retirés, et **uniquement entre deux chiffres**.
 *
 * ## Un seul balayage, et la classification AVANT la normalisation
 *
 * Un candidat est d'abord situé dans sa phrase (ce qui le précède, ce qui le suit), puis classé,
 * puis seulement normalisé. L'ordre inverse — normaliser puis deviner — transformerait
 * `24/06/2026` en `24`, `06` et `2026`, et un vérificateur d'ancrage passerait sa vie à réclamer
 * des dates dans le JSON source.
 *
 * Sont classés `date`, `time` ou `ordinal`, et **exclus du contrôle d'ancrage** : `jj/MM/aaaa`,
 * `jj/MM`, `HH:mm(:ss)`, une année isolée de quatre chiffres entre 1900 et 2100 (donc sans
 * séparateur, sans décimale et sans unité — voir plus haut : `Intl` groupe dès quatre chiffres,
 * un compteur ne peut pas se déguiser en année) et un rang annoncé par son mot (« ligne 42 »).
 * Leur `value` est `null` : un nombre exclu n'a pas de valeur à comparer, et le mettre à `null`
 * évite qu'un appelant distrait le réintroduise dans le contrôle.
 */
import { D, type Big } from '../domain/money';

export type NumberKind =
  'money' | 'percent' | 'points' | 'quantity' | 'plain' | 'date' | 'time' | 'ordinal';

/** Échelle annoncée par un suffixe (`k`, `M`, `Md`). `value` est TOUJOURS ramenée à l'unité. */
export type NumberScale = 'unit' | 'k' | 'M' | 'Md';

export interface NumberToken {
  /** Le lexème tel qu'il apparaît : signe, chiffres, suffixe d'échelle et unité compris. */
  readonly raw: string;
  /** Position de `raw` dans le texte (index du signe, ou du premier chiffre). */
  readonly start: number;
  readonly kind: NumberKind;
  /** Valeur normalisée à l'unité (`%` divisé par 100, `k`/`M`/`Md` multipliés) ; `null` si exclue. */
  readonly value: Big | null;
  readonly scale: NumberScale;
}

/** Espace fine insécable (U+202F) — le séparateur de milliers réellement produit par `Intl` fr-FR. */
export const NARROW_NBSP = ' ';
/** Espace insécable (U+00A0) — devant `€` et `%` seulement. */
export const NBSP = ' ';
/** Espace fine (U+2009), qu'un modèle peut produire à la place des deux précédentes. */
export const THIN_SPACE = ' ';
/** Signe moins typographique (U+2212), celui de `format/fr.ts`. */
export const TYPOGRAPHIC_MINUS = '−';

const SEPARATORS = `${NARROW_NBSP}${NBSP}${THIN_SPACE} `;
const IS_SEPARATOR = new RegExp(`^[${SEPARATORS}]$`, 'u');
const IS_LETTER = /^\p{L}$/u;
const IS_DIGIT = /^\d$/u;

/**
 * Les trois formes reconnues en un seul balayage, dans cet ordre : date, heure, nombre. L'ordre
 * compte — sans lui, `24/06/2026` serait lu comme trois entiers.
 */
const CANDIDATE = new RegExp(
  [
    String.raw`\d{1,2}/\d{1,2}(?:/\d{4})?`,
    String.raw`\d{1,2}:\d{2}(?::\d{2})?`,
    String.raw`\d(?:[\d${SEPARATORS}]*\d)?(?:[.,]\d+)?`,
  ].join('|'),
  'gu',
);

const IS_DATE = /^\d{1,2}\/\d{1,2}(?:\/\d{4})?$/u;
const IS_YEAR = /^\d{4}$/u;
const IS_TIME = /^\d{1,2}:\d{2}(?::\d{2})?$/u;

/**
 * Mots qui font d'un nombre un RANG et non une grandeur. Liste fermée et volontairement courte :
 * chaque entrée retire un nombre du contrôle, donc chacune est une renonciation assumée.
 */
const ORDINAL_MARKERS = new RegExp(
  `(?:ligne|lignes|page|pages|numéro|numéros|n°|nº|étape|étapes|point|article|art\\.|§|rang|` +
    `chapitre|section|version|colonne|colonnes)[${SEPARATORS}]*$`,
  'u',
);

/** Symboles monétaires affichés par l'app (`CURRENCY_INFO`), plus ceux qu'un modèle peut écrire. */
const CURRENCY_SYMBOLS = ['€', '$', '£', '¥'];
const CURRENCY_CODES = ['EUR', 'USD', 'CHF', 'GBP', 'JPY'];

/** Un code d'actif (« BTC », « USDC ») : deux majuscules ou plus, chiffres admis après la première. */
const ASSET_CODE = /^[A-Z][A-Z0-9]{1,9}(?![\p{L}])/u;

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const SCALE_FACTOR: Record<NumberScale, string> = {
  unit: '1',
  k: '1000',
  M: '1000000',
  Md: '1000000000',
};

/** Un jeton exclu du contrôle d'ancrage : sa valeur ne veut rien dire comme grandeur. */
const EXCLUDED: ReadonlySet<NumberKind> = new Set<NumberKind>(['date', 'time', 'ordinal']);

/** Vrai si le jeton doit être confronté aux ancres (voir `EXCLUDED`). */
export function isChecked(token: NumberToken): boolean {
  return !EXCLUDED.has(token.kind);
}

function charAt(text: string, index: number): string | undefined {
  return index >= 0 && index < text.length ? text[index] : undefined;
}

function isLetter(char: string | undefined): boolean {
  return char !== undefined && IS_LETTER.test(char);
}

function isSeparator(char: string | undefined): boolean {
  return char !== undefined && IS_SEPARATOR.test(char);
}

/** Position du premier caractère non séparateur à partir de `index`. */
function skipSeparators(text: string, index: number): number {
  let i = index;
  while (isSeparator(charAt(text, i))) i += 1;
  return i;
}

interface Suffix {
  readonly scale: NumberScale;
  /** Index juste après le suffixe (égal à l'entrée si aucun suffixe n'a été lu). */
  readonly end: number;
}

/**
 * Lit un suffixe d'échelle après les chiffres : au plus un séparateur, puis `Md`, `M` ou `k`, et
 * la lettre suivante doit être absente — sans quoi `12 Mars` deviendrait douze millions.
 */
function readSuffix(text: string, end: number): Suffix {
  const start = isSeparator(charAt(text, end)) ? end + 1 : end;
  for (const scale of ['Md', 'M', 'k'] as const) {
    if (!text.startsWith(scale, start)) continue;
    const after = charAt(text, start + scale.length);
    if (isLetter(after)) continue;
    return { scale, end: start + scale.length };
  }
  return { scale: 'unit', end };
}

interface Unit {
  /** Genre déduit de ce qui suit le nombre, ou `null` si rien ne le qualifie. */
  readonly kind: 'money' | 'percent' | 'points' | 'quantity' | null;
  /** Index juste après l'unité (égal à l'entrée si aucune unité n'a été lue). */
  readonly end: number;
}

/**
 * Lit l'unité qui suit les chiffres (et l'éventuel suffixe d'échelle). L'ordre est un choix :
 * une devise l'emporte sur un code d'actif, sans quoi `12 500,00 EUR` deviendrait une quantité.
 */
function readUnit(text: string, from: number): Unit {
  const at = skipSeparators(text, from);
  const rest = text.slice(at);
  if (rest.startsWith('%')) return { kind: 'percent', end: at + 1 };
  for (const word of ['pts', 'pt'] as const) {
    if (rest.startsWith(word) && !isLetter(charAt(text, at + word.length)))
      return { kind: 'points', end: at + word.length };
  }
  for (const symbol of CURRENCY_SYMBOLS) {
    if (rest.startsWith(symbol)) return { kind: 'money', end: at + symbol.length };
  }
  for (const code of CURRENCY_CODES) {
    if (rest.startsWith(code) && !isLetter(charAt(text, at + code.length)))
      return { kind: 'money', end: at + code.length };
  }
  const asset = ASSET_CODE.exec(rest);
  if (asset !== null) return { kind: 'quantity', end: at + asset[0].length };
  return { kind: null, end: from };
}

/**
 * Vrai si le lexème peut être une année isolée : quatre chiffres NUS, rien autour. Le test porte
 * sur le lexème brut, séparateurs compris : `Intl` groupe dès quatre chiffres, donc `2 026` est un
 * nombre mis en forme et `2026` un millésime — c'est le séparateur qui les distingue.
 */
function looksLikeYear(raw: string, negative: boolean, scale: NumberScale): boolean {
  if (negative || scale !== 'unit' || !IS_YEAR.test(raw)) return false;
  const year = Number(raw);
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * Un nombre est-il collé à un identifiant ? `1INCH` et `SHIB2` portent des chiffres qui ne sont
 * pas des grandeurs ; les lire en produirait des ancrages introuvables à chaque ticker exotique.
 */
function isGlued(text: string, start: number, end: number): boolean {
  const before = charAt(text, start - 1);
  if (before !== undefined && (IS_LETTER.test(before) || IS_DIGIT.test(before))) return true;
  if (before === '/' || before === ':') return true;
  const after = charAt(text, end);
  return after === '/' || after === ':';
}

/** Le signe qui précède immédiatement le nombre, s'il en est un (et non un tiret de composition). */
function readSign(text: string, start: number): { negative: boolean; from: number } {
  const before = charAt(text, start - 1);
  if (before !== '-' && before !== TYPOGRAPHIC_MINUS) return { negative: false, from: start };
  const previous = charAt(text, start - 2);
  // « 2026-2027 » est un intervalle, « top-3 » un identifiant : un signe s'appuie sur du vide.
  if (previous !== undefined && (IS_LETTER.test(previous) || IS_DIGIT.test(previous)))
    return { negative: false, from: start };
  return { negative: true, from: start - 1 };
}

/**
 * Convention comptable `(1 234,56)` = négatif — appliquée **seulement** quand la parenthèse
 * n'enferme rien d'autre que les chiffres.
 *
 * Ce n'est pas de la timidité : `format/insights.ts` met couramment un montant entre parenthèses
 * en apposition (« BTC représente 72,1 % de la valeur de vos positions (18 452,90 €) »). Lire
 * cette parenthèse-là comme un signe inverserait tous nos propres montants positifs, et le
 * vérificateur crierait au chiffre inventé sur du texte parfaitement juste.
 */
function isAccountingNegative(text: string, from: number, end: number): boolean {
  return charAt(text, from - 1) === '(' && charAt(text, end) === ')';
}

/** Retire les séparateurs de milliers et ramène la virgule décimale au point. */
function toDecimalCore(raw: string): string {
  let core = '';
  for (const char of raw) {
    if (IS_SEPARATOR.test(char)) continue;
    core += char === ',' ? '.' : char;
  }
  return core;
}

/**
 * Tous les nombres d'un texte, dans l'ordre d'apparition. Un seul balayage : chaque candidat est
 * situé, classé, puis normalisé — jamais l'inverse.
 */
export function extractNumbers(text: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  CANDIDATE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CANDIDATE.exec(text)) !== null) {
    const raw = match[0];
    const start = match.index;
    const end = start + raw.length;

    if (IS_DATE.test(raw)) {
      tokens.push({ raw, start, kind: 'date', value: null, scale: 'unit' });
      continue;
    }
    if (IS_TIME.test(raw)) {
      tokens.push({ raw, start, kind: 'time', value: null, scale: 'unit' });
      continue;
    }

    const suffix = readSuffix(text, end);
    // Un chiffre collé à des lettres appartient à un identifiant, pas à une grandeur.
    if (suffix.scale === 'unit' && isLetter(charAt(text, end))) continue;
    if (isGlued(text, start, end)) continue;

    const unit = readUnit(text, suffix.end);
    const sign = readSign(text, start);
    const core = toDecimalCore(raw);
    const negative =
      sign.negative || (unit.kind === null && isAccountingNegative(text, sign.from, end));

    let kind: NumberKind;
    if (unit.kind !== null) kind = unit.kind;
    else if (ORDINAL_MARKERS.test(text.slice(Math.max(0, start - 24), start).toLowerCase()))
      kind = 'ordinal';
    else if (looksLikeYear(raw, negative, suffix.scale)) kind = 'date';
    else if (core.includes('.') && (core.split('.')[1]?.length ?? 0) >= 5) kind = 'quantity';
    else kind = 'plain';

    const lexeme = text.slice(sign.from, unit.end);
    if (EXCLUDED.has(kind)) {
      tokens.push({ raw: lexeme, start: sign.from, kind, value: null, scale: 'unit' });
      continue;
    }

    // Normalisation, toujours en `Big` : jamais un flottant sur un montant (règle du projet).
    let value = D(`${negative ? '-' : ''}${core}`);
    if (kind === 'percent') value = value.div('100');
    if (suffix.scale !== 'unit') value = value.times(SCALE_FACTOR[suffix.scale]);

    tokens.push({ raw: lexeme, start: sign.from, kind, value, scale: suffix.scale });
  }
  return tokens;
}
