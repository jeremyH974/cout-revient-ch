/**
 * Ancrage des nombres (P70) : tout nombre d'un texte doit venir du JSON qui l'a produit, par une
 * transformation **déclarée à l'avance**. Module pur — ni DOM, ni réseau, ni horloge — donc
 * exposable au serveur MCP au même titre que le moteur.
 *
 * ## Le contrat, en une phrase
 *
 * On parcourt la structure typée d'entrée, on en collecte les feuilles décimales comme *ancres*,
 * on engendre pour chacune la liste FERMÉE des rendus admissibles, et l'on confronte les jetons
 * du texte à cet ensemble. La comparaison se fait par `Big.eq`, jamais sur des flottants et
 * **jamais avec un epsilon relatif** : l'arrondi d'affichage est déjà modélisé par la dérivation
 * `display`, l'absorber une seconde fois dans une tolérance reviendrait à ne plus rien vérifier.
 *
 * ## La liste des dérivations est fermée, et elle le reste
 *
 * On ne l'élargit pas pour absorber un faux positif. Si un modèle refait un total juste — la
 * somme de deux constats, par exemple — le texte est **refusé** : blanchir son arithmétique, ce
 * serait le laisser entrer dans le calcul, exactement ce que le harnais existe pour empêcher. Un
 * total qui doit être cité appartient au JSON d'entrée, où il devient une ancre comme une autre.
 *
 * Un faux positif se traite donc par l'autre bout : soit la valeur manquante entre dans la source,
 * soit elle est **déclarée comme constante du gabarit** (`AnchorOptions.literals`), sous son nom et
 * par le code appelant — jamais par le modèle. C'est le pendant de l'exception nommée mot pour mot
 * du lexique (`format/lexicon.ts`).
 *
 * ## Ce que ce vérificateur NE PEUT PAS attraper
 *
 * - **Un nombre juste, attribué au mauvais actif.** « ETH représente 72,1 % de la valeur » quand
 *   la part est celle de BTC : la valeur est ancrée, la phrase est fausse.
 * - **Un sens inversé.** `abs` étant une dérivation déclarée, « vos ventes ont dégagé 2 310,50 €
 *   de plus-values » passe alors que le réalisé vaut −2 310,50 €.
 * - **Une omission.** Trois constats flatteurs choisis sur quatorze : chaque nombre cité est
 *   ancré, et le portrait d'ensemble est mensonger.
 * - **Une collision fortuite** avec une autre ancre : deux montants proches, un arrondi commun, et
 *   le nombre du mauvais constat tombe pile sur une dérivation du bon.
 * - **Une phrase fausse sans chiffre.** « Votre portefeuille est bien diversifié » ne contient
 *   aucun nombre : rien à ancrer, rien à contredire.
 * - **Une date fausse**, écartée par classification (`numbers.ts`) et donc jamais confrontée.
 *
 * **Un ancrage vert dit exactement une chose : aucun chiffre n'a été fabriqué. Il ne dit rien de
 * la vérité de la phrase.** Toute lecture plus généreuse de ce module serait une garantie fausse.
 */
import { D, ZERO, isDecimalString, type Big, type DecimalString } from '../domain/money';
// L'arrondi n'existe que dans `src/lib/format/` (règle du projet) : les rendus admissibles sont
// donc engendrés avec l'arrondi de l'app, pas avec un arrondi réécrit ici.
import { roundHalfUp } from '../format/fr';
import { extractNumbers, isChecked, type NumberKind, type NumberToken } from './numbers';

/** D'où vient une ancre : une chaîne décimale, un entier de la source, ou une constante déclarée. */
export type AnchorKind = 'decimal' | 'integer' | 'literal';

export interface Anchor {
  /** Chemin dans la structure d'entrée (`constats[0].values.amount`), ou `literal:<raison>`. */
  readonly path: string;
  readonly value: Big;
  readonly kind: AnchorKind;
  /**
   * Genre de jeton auquel cette ancre s'applique, ou `null` pour toutes. Seules les constantes
   * déclarées le renseignent : `100 %` du repère vaut `1`, et il serait absurde qu'une constante
   * déclarée pour un pourcentage blanchisse au passage un montant de « 1,00 € » inventé.
   */
  readonly appliesTo: NumberKind | null;
}

/** Une constante du gabarit français, déclarée par l'appelant — jamais par le modèle. */
export interface DeclaredLiteral {
  readonly value: DecimalString;
  /** Pourquoi ce nombre est écrit en dur dans la phrase (« seuil légal de 305 € »). */
  readonly why: string;
  /** Où il apparaît : nommer le genre, c'est refuser que l'exception déborde ailleurs. */
  readonly kind: NumberKind;
}

export interface AnchorOptions {
  readonly literals?: readonly DeclaredLiteral[];
}

export type DerivationId = 'exact' | 'display' | 'percent' | 'abbrev' | 'abs';

export type UnanchoredReason = 'not-in-source' | 'derivation-not-declared';

export interface Unanchored {
  readonly token: NumberToken;
  /**
   * Diagnostic, **jamais un verdict** : les deux motifs sont des échecs. `derivation-not-declared`
   * signale qu'on sait NOMMER la lecture refusée (précision tronquée, total recomposé, échelle
   * décalée), ce qui rend l'incident lisible ; `not-in-source` dit qu'on ne sait même pas d'où le
   * nombre pourrait venir.
   */
  readonly reason: UnanchoredReason;
}

export interface AnchorMatch {
  readonly token: NumberToken;
  readonly anchor: Anchor;
  readonly derivation: DerivationId;
}

export interface AnchorReport {
  readonly anchors: readonly Anchor[];
  /** Jetons confrontés aux ancres (les `date`/`time`/`ordinal` en sont exclus par classification). */
  readonly checked: readonly NumberToken[];
  readonly excluded: readonly NumberToken[];
  readonly matched: readonly AnchorMatch[];
  readonly unanchored: readonly Unanchored[];
}

/**
 * Précisions d'affichage admises. Celles de l'app : montants à 2, pourcentages à 3, ratios à 2,
 * quantités à 9. **5 et 7 en sont volontairement absents** — donc la précision adaptative de
 * `fmtPrice` n'est pas un rendu déclaré, et un modèle qui citerait un prix à cinq décimales serait
 * refusé. C'est un choix de rigueur, pas un oubli : le narrateur rend des constats, pas des prix.
 */
const DISPLAY_DECIMALS: readonly number[] = [0, 1, 2, 3, 4, 6, 8, 9, 10];

interface Derivation {
  readonly id: DerivationId;
  readonly apply: (value: Big) => Big[];
}

/**
 * La liste FERMÉE des rendus admissibles d'une ancre.
 *
 * `abbrev` ramène l'abrégé à l'unité (`×1000`, `×1e6`) parce que `numbers.ts` normalise déjà
 * `12,3 k€` en `12300`. Sans ce retour à l'unité, `12 345 k€` et `12 345 €` deviendraient
 * indiscernables : le vérificateur accepterait une erreur d'un facteur mille.
 */
const DERIVATIONS: readonly Derivation[] = [
  { id: 'exact', apply: (b) => [b] },
  { id: 'display', apply: (b) => DISPLAY_DECIMALS.map((dp) => roundHalfUp(b, dp)) },
  { id: 'percent', apply: (b) => [roundHalfUp(b.times('100'), 1), roundHalfUp(b.times('100'), 0)] },
  {
    id: 'abbrev',
    apply: (b) => [
      roundHalfUp(b.div('1000'), 1).times('1000'),
      roundHalfUp(b.div('1000000'), 1).times('1000000'),
    ],
  },
  { id: 'abs', apply: (b) => [b.abs()] },
];

/** Les identifiants de dérivation, dans l'ordre déclaré — pour la documentation et les tests. */
export const DERIVATION_IDS: readonly DerivationId[] = DERIVATIONS.map((d) => d.id);

/** Au-delà, la recherche du motif « total recomposé » coûterait plus qu'elle ne rapporte. */
const MAX_COMBINED_ANCHORS = 60;

const SCALE_PROBES: readonly string[] = ['1000', '1000000', '1000000000'];

function isPlainObject(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

/**
 * Ajoute une feuille comme ancre — et, si elle est négative, **sa valeur absolue sous le même
 * chemin**.
 *
 * Ce n'est pas une dérivation de plus : notre propre rendu applique `abs()` à la donnée AVANT de
 * la formater (`absMoney`, dans `format/insights.ts`, pour les phrases qui portent déjà le sens :
 * « de moins », « de moins-values réalisées »). La valeur absolue est donc une grandeur de la
 * SOURCE, à laquelle les rendus déclarés s'appliquent ensuite normalement. La propriété centrale
 * l'a démontré du premier coup : un réalisé de −0,005 € s'affiche « 0,01 € », que ni `display`
 * (qui donne −0,01) ni `abs` seul (qui donne 0,005) ne produisent — seule leur composition, que la
 * liste fermée n'autorise pas et n'autorisera pas.
 */
function push(node: Big, path: string, kind: AnchorKind, out: Anchor[]): void {
  out.push({ path, value: node, kind, appliesTo: null });
  if (node.lt(ZERO)) out.push({ path, value: node.abs(), kind, appliesTo: null });
}

function walk(node: unknown, path: string, out: Anchor[]): void {
  if (typeof node === 'string') {
    if (isDecimalString(node)) push(D(node), path, 'decimal', out);
    return;
  }
  if (typeof node === 'number') {
    // Aucun `number` ne porte un montant dans ce projet (règle du projet) : ceux qu'on rencontre
    // sont des compteurs et des millésimes, que `String` restitue exactement.
    const text = String(node);
    if (isDecimalString(text)) push(D(text), path, 'integer', out);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${path}[${index}]`, out));
    return;
  }
  if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      walk(value, path === '' ? key : `${path}.${key}`, out);
    }
  }
}

/** Les ancres d'une structure d'entrée : ses seules feuilles décimales, plus les constantes déclarées. */
export function collectAnchors(source: unknown, opts: AnchorOptions = {}): Anchor[] {
  const out: Anchor[] = [];
  walk(source, '', out);
  for (const literal of opts.literals ?? []) {
    out.push({
      path: `literal:${literal.why}`,
      value: D(literal.value),
      kind: 'literal',
      appliesTo: literal.kind,
    });
  }
  return out;
}

function findMatch(token: NumberToken, anchors: readonly Anchor[]): AnchorMatch | null {
  const value = token.value;
  if (value === null) return null;
  for (const anchor of anchors) {
    if (anchor.appliesTo !== null && anchor.appliesTo !== token.kind) continue;
    for (const derivation of DERIVATIONS) {
      for (const candidate of derivation.apply(anchor.value)) {
        if (value.eq(candidate)) return { token, anchor, derivation: derivation.id };
      }
    }
  }
  return null;
}

/** Nombre de décimales portées par la valeur, lue sur sa forme canonique (aucun arrondi). */
function decimalsOf(value: Big): number {
  return value.toString().split('.')[1]?.length ?? 0;
}

/** `10^-dp` en décimal exact : l'unité du dernier rang affiché par le jeton. */
function lastPlace(dp: number): Big {
  return D(dp === 0 ? '1' : `0.${'0'.repeat(dp - 1)}1`);
}

/**
 * Sait-on NOMMER la lecture refusée ? Trois sondes, toutes exactes, aucune n'arrondit :
 *
 * 1. **précision non déclarée** — le jeton tombe à moins d'une unité de son dernier rang d'une
 *    ancre : troncature ou arrondi d'un autre genre (cas d'une quantité coupée à 4 décimales) ;
 * 2. **échelle décalée** — le jeton vaut une ancre multipliée ou divisée par mille, un million,
 *    un milliard ;
 * 3. **total recomposé** — le jeton vaut la somme ou la différence exacte de deux ancres. C'est
 *    l'arithmétique du modèle, et elle est refusée par principe (voir l'en-tête).
 */
function isNameableReading(value: Big, anchors: readonly Anchor[]): boolean {
  const tolerance = lastPlace(decimalsOf(value));
  for (const anchor of anchors) {
    if (value.minus(anchor.value).abs().lt(tolerance)) return true;
    for (const factor of SCALE_PROBES) {
      if (value.eq(anchor.value.times(factor)) || value.eq(anchor.value.div(factor))) return true;
    }
  }
  const pool = anchors.slice(0, MAX_COMBINED_ANCHORS);
  for (let i = 0; i < pool.length; i += 1) {
    const a = pool[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < pool.length; j += 1) {
      const b = pool[j];
      if (b === undefined) continue;
      if (value.eq(a.value.plus(b.value))) return true;
      if (value.eq(a.value.minus(b.value)) || value.eq(b.value.minus(a.value))) return true;
    }
  }
  return false;
}

/**
 * Confronte les nombres d'un texte aux chiffres de sa source. Un rapport vert (`unanchored` vide)
 * signifie « aucun chiffre fabriqué » — et rien d'autre, voir l'en-tête.
 */
export function auditText(text: string, source: unknown, opts: AnchorOptions = {}): AnchorReport {
  const anchors = collectAnchors(source, opts);
  const tokens = extractNumbers(text);
  const checked: NumberToken[] = [];
  const excluded: NumberToken[] = [];
  const matched: AnchorMatch[] = [];
  const unanchored: Unanchored[] = [];

  for (const token of tokens) {
    if (!isChecked(token) || token.value === null) {
      excluded.push(token);
      continue;
    }
    checked.push(token);
    const hit = findMatch(token, anchors);
    if (hit !== null) {
      matched.push(hit);
      continue;
    }
    unanchored.push({
      token,
      reason: isNameableReading(token.value, anchors) ? 'derivation-not-declared' : 'not-in-source',
    });
  }

  return { anchors, checked, excluded, matched, unanchored };
}

/** Vrai si aucun chiffre du texte n'a été fabriqué. Voir l'en-tête pour ce que cela NE dit PAS. */
export function isAnchored(report: AnchorReport): boolean {
  return report.unanchored.length === 0;
}

/**
 * Part des ancres réellement citées : un indicateur de COUVERTURE, jamais un critère bloquant —
 * un texte peut être court et juste, ou long et creux.
 */
export function anchorCoverage(report: AnchorReport): number {
  const paths = new Set(report.anchors.map((a) => a.path));
  if (paths.size === 0) return 1;
  const cited = new Set(report.matched.map((m) => m.anchor.path));
  return cited.size / paths.size;
}
