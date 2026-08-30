/**
 * Le score d'appariement (P64) : quelle confiance accorder à « cette colonne est ce champ ».
 *
 * ## Quatre règles, quatre plafonds — et le plafond n'est jamais dépassé
 *
 * | Règle           | Plafond | Ce qu'elle constate                                        |
 * | --------------- | ------- | ---------------------------------------------------------- |
 * | `exact-header`  | 1,00    | l'en-tête est DÉJÀ un en-tête pivot connu                   |
 * | `synonym`       | 0,90    | l'en-tête normalisé figure dans la table des synonymes      |
 * | `fuzzy`         | 0,75    | distance de Damerau-Levenshtein normalisée ≥ 0,85           |
 * | `shape-only`    | 0,60    | la forme convient, et cette colonne est la SEULE à convenir |
 *
 * Un plafond n'est pas une note : c'est le maximum que la règle peut valoir, dont on retranche
 * ensuite ce que le fichier contredit. Une règle forte sur une colonne dont la forme dit le
 * contraire ne doit pas l'emporter sur une règle faible dont la forme concorde.
 *
 * ## Deux pénalités, et elles ne s'appliquent pas au même endroit
 *
 * - **×0,4 si la forme contredit le champ.** Multiplicative : elle laisse un ordre entre les
 *   candidats contredits (un synonyme contredit reste au-dessus d'une simple forme contredite),
 *   là où une soustraction les écraserait tous sur le même plancher.
 * - **−0,15 par colonne concurrente.** Deux colonnes qui prétendent au même champ sont un doute,
 *   et le doute doit descendre sous le seuil de pré-cochage : c'est exactement le cas où l'on veut
 *   que l'utilisateur regarde. La pénalité est soustractive parce qu'elle mesure un nombre de
 *   rivales, pas une contradiction de nature.
 *
 * ## L'affectation est GLOUTONNE, et c'est un choix documenté
 *
 * Tri décroissant des couples (colonne, champ), puis attribution tant que ni la colonne ni le
 * champ ne sont pris. Ce n'est pas l'optimum global : l'algorithme hongrois le donnerait, en
 * O(n³) et une centaine de lignes. Pour **au plus une trentaine de colonnes et douze champs**, le
 * gain se mesure sur des cas construits, pas sur des fichiers réels — et le glouton a une vertu
 * que l'optimum n'a pas : il est **lisible**. Un utilisateur peut suivre pourquoi telle colonne a
 * pris telle place ; un couplage optimal ne s'explique pas ligne à ligne. Comme rien n'est importé
 * sans confirmation ligne à ligne, la lisibilité vaut mieux ici que l'optimalité.
 *
 * Les égalités sont départagées de façon **stable** : score, puis ordre de déclaration du champ
 * (`TARGET_SCHEMA`), puis index de colonne. Le même fichier donne donc toujours le même résultat.
 */
import { HEADERS as PIVOT_HEADERS } from '../pivot/detect';
import { normalizeHeader, type NormalizedHeader } from './normalize';
import { TARGET_SCHEMA, targetSpec, type MappingTarget } from './schema';
import { NORMALIZED_SYNONYMS, SYNONYM_INDEX } from './synonyms';
import type { ShapeInfo, ValueShape } from './shape';

export type MatchRule = 'exact-header' | 'synonym' | 'fuzzy' | 'shape-only';

/** Les règles, de la plus forte à la plus faible : l'ordre d'essai, et l'ordre des plafonds. */
export const MATCH_RULES: readonly MatchRule[] = ['exact-header', 'synonym', 'fuzzy', 'shape-only'];

export const RULE_CAP: Readonly<Record<MatchRule, number>> = {
  'exact-header': 1,
  synonym: 0.9,
  fuzzy: 0.75,
  'shape-only': 0.6,
};

/** Similarité minimale pour que la distance d'édition compte comme un appariement. */
export const FUZZY_THRESHOLD = 0.85;

/** Facteur appliqué quand la forme des valeurs contredit le champ visé. */
export const SHAPE_CONTRADICTION = 0.4;

/** Retranché par colonne concurrente : deux prétendants doivent tomber sous le pré-cochage. */
export const COMPETITOR_PENALTY = 0.15;

/** Au-dessus : pré-coché. Entre les deux : à confirmer. En dessous : non apparié. */
export const CONFIRM_THRESHOLD = 0.8;
export const CANDIDATE_THRESHOLD = 0.5;

/**
 * Distance de Damerau-Levenshtein (transpositions comprises), écrite à la main.
 *
 * Aucune bibliothèque n'est ajoutée (décision n° 13) : quarante lignes valent mieux qu'un paquet
 * de plus dans la chaîne d'approvisionnement. La transposition compte parce que les fautes
 * d'en-tête sont des fautes de frappe humaines — `recieved`, `curreny`, `montnat` — et que sans
 * elle `recieved`/`received` coûterait deux opérations au lieu d'une, c'est-à-dire tomberait sous
 * le seuil sur un mot court.
 *
 * Variante « distance d'édition restreinte » (Optimal String Alignment) : une sous-chaîne n'est
 * jamais éditée deux fois. C'est celle qui correspond à une faute de frappe, et elle n'a pas
 * besoin de la table des dernières occurrences.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  // Trois lignes suffisent (i−2, i−1, i) : la transposition ne regarde jamais plus loin.
  let twoAgo: number[] = [];
  let previous: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  let current: number[] = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    current[0] = i;
    for (let j = 1; j <= m; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (current[j - 1] ?? 0) + 1, // insertion
        (previous[j] ?? 0) + 1, // suppression
        (previous[j - 1] ?? 0) + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, (twoAgo[j - 2] ?? 0) + 1); // transposition
      current[j] = best;
    }
    twoAgo = previous;
    previous = current;
    current = new Array<number>(m + 1).fill(0);
  }
  return previous[m] ?? 0;
}

/** Similarité dans `[0, 1]` : `1 − distance / longueur du plus long`. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - damerauLevenshtein(a, b) / longest;
}

/** En-têtes déjà connus du pipeline pivot, normalisés une fois : la règle à 1,00. */
const EXACT_INDEX: ReadonlyMap<string, MappingTarget> = (() => {
  const index = new Map<string, MappingTarget>();
  for (const [field, names] of Object.entries(PIVOT_HEADERS) as [
    MappingTarget,
    readonly string[],
  ][]) {
    for (const name of names) index.set(normalizeHeader(name).text, field);
  }
  return index;
})();

export interface RuleHit {
  readonly rule: MatchRule;
  /** Similarité effective (1 pour les règles exactes) : elle module le plafond de `fuzzy`. */
  readonly closeness: number;
}

/**
 * La règle la plus forte qui s'applique, ou `null`. La forme n'intervient PAS ici : elle module le
 * score, elle ne crée un appariement que par `shape-only`, décidé plus haut faute d'autre candidat.
 */
export function bestRule(header: NormalizedHeader, field: MappingTarget): RuleHit | null {
  if (EXACT_INDEX.get(header.text) === field) return { rule: 'exact-header', closeness: 1 };
  const designated = SYNONYM_INDEX.get(header.text);
  if (designated !== undefined && designated.includes(field))
    return { rule: 'synonym', closeness: 1 };
  let closest = 0;
  for (const synonym of NORMALIZED_SYNONYMS[field]) {
    const score = similarity(header.text, synonym);
    if (score > closest) closest = score;
  }
  return closest >= FUZZY_THRESHOLD ? { rule: 'fuzzy', closeness: closest } : null;
}

/** La forme contredit-elle le champ ? `free-text` et `empty` ne contredisent rien : elles taisent. */
export function shapeContradicts(shape: ValueShape, field: MappingTarget): boolean {
  if (shape === 'free-text' || shape === 'empty') return false;
  return !targetSpec(field).shapes.includes(shape);
}

export interface ScoredPair {
  readonly column: number;
  readonly field: MappingTarget;
  readonly rule: MatchRule;
  readonly confidence: number;
}

const FIELD_ORDER: ReadonlyMap<MappingTarget, number> = new Map(
  TARGET_SCHEMA.map((spec, index) => [spec.field, index]),
);

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Les scores bruts, avant pénalité de concurrence : une entrée par couple (colonne, champ) pour
 * lequel une règle s'applique, plus les `shape-only` des champs qui n'ont qu'un seul prétendant
 * de forme compatible.
 */
function rawPairs(
  headers: readonly NormalizedHeader[],
  shapes: readonly ShapeInfo[],
): ScoredPair[] {
  const pairs: ScoredPair[] = [];
  const named = new Set<string>();
  headers.forEach((header, column) => {
    const shape = shapes[column]?.shape ?? 'empty';
    for (const spec of TARGET_SCHEMA) {
      const hit = bestRule(header, spec.field);
      if (hit === null) continue;
      const cap = RULE_CAP[hit.rule];
      const base = hit.rule === 'fuzzy' ? cap * hit.closeness : cap;
      const penalised = shapeContradicts(shape, spec.field) ? base * SHAPE_CONTRADICTION : base;
      pairs.push({ column, field: spec.field, rule: hit.rule, confidence: clamp(penalised) });
      named.add(`${column}:${spec.field}`);
    }
  });
  /*
   * `shape-only` : la forme convient, et cette colonne est la SEULE à convenir pour ce champ.
   *
   * `free-text` et `empty` sont exclues de ce décompte, alors qu'elles figurent bien parmi les
   * formes admises de plusieurs champs. Ce n'est pas une incohérence : une forme qui ne dit rien
   * ne peut pas fonder un appariement, et la compter parmi les prétendants ferait perdre les
   * appariements qu'elle ne mérite pas. Sans cette exclusion, une colonne d'empreintes
   * parfaitement reconnaissable resterait non appariée du seul fait qu'une colonne de texte libre
   * « convenait » elle aussi, en théorie, au même champ.
   */
  for (const spec of TARGET_SCHEMA) {
    const fitting = headers
      .map((_, column) => column)
      .filter((column) => {
        const shape = shapes[column]?.shape ?? 'empty';
        if (shape === 'free-text' || shape === 'empty') return false;
        return spec.shapes.includes(shape) && !named.has(`${column}:${spec.field}`);
      });
    const only = fitting[0];
    if (fitting.length !== 1 || only === undefined) continue;
    // Une colonne déjà nommée par une règle forte pour un AUTRE champ n'est pas « seule » : elle
    // est prise. Sans cette condition, la colonne de date deviendrait aussi la seule contre-valeur
    // possible d'un fichier sans montants.
    if (TARGET_SCHEMA.some((other) => named.has(`${only}:${other.field}`))) continue;
    pairs.push({
      column: only,
      field: spec.field,
      rule: 'shape-only',
      confidence: RULE_CAP['shape-only'],
    });
  }
  return pairs;
}

/** Score final : le brut, moins `COMPETITOR_PENALTY` par autre colonne candidate au même champ. */
export function scorePairs(
  headers: readonly NormalizedHeader[],
  shapes: readonly ShapeInfo[],
): ScoredPair[] {
  const raw = rawPairs(headers, shapes);
  const competitors = new Map<MappingTarget, number>();
  for (const pair of raw) {
    if (pair.confidence < CANDIDATE_THRESHOLD) continue;
    competitors.set(pair.field, (competitors.get(pair.field) ?? 0) + 1);
  }
  return raw.map((pair) => {
    const rivals = Math.max(0, (competitors.get(pair.field) ?? 0) - 1);
    return { ...pair, confidence: clamp(pair.confidence - rivals * COMPETITOR_PENALTY) };
  });
}

/**
 * Affectation gloutonne stable : un champ ↔ une colonne. Voir l'en-tête pour le renoncement
 * assumé au couplage optimal.
 */
export function assign(pairs: readonly ScoredPair[]): ScoredPair[] {
  const sorted = [...pairs]
    .filter((p) => p.confidence >= CANDIDATE_THRESHOLD)
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        (FIELD_ORDER.get(a.field) ?? 0) - (FIELD_ORDER.get(b.field) ?? 0) ||
        a.column - b.column,
    );
  const takenFields = new Set<MappingTarget>();
  const takenColumns = new Set<number>();
  const kept: ScoredPair[] = [];
  for (const pair of sorted) {
    if (takenFields.has(pair.field) || takenColumns.has(pair.column)) continue;
    takenFields.add(pair.field);
    takenColumns.add(pair.column);
    kept.push(pair);
  }
  return kept;
}
