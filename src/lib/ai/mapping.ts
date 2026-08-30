/**
 * L'appariement de colonnes confié à un modèle (P64) — le **miroir** de `narrative.ts`.
 *
 * Même harnais, même contrat, même repli : c'est délibéré. Une seconde mécanique de consentement,
 * de refus et d'étiquetage aurait divergé de la première au premier correctif, et l'écart se
 * serait vu non pas dans un test, mais dans ce qui part vers un modèle.
 *
 * ## L'ancrage porte sur les JETONS, pas sur les nombres
 *
 * Le récit s'ancre sur des chiffres : chaque nombre du texte doit venir du JSON. Ici il n'y a
 * pratiquement pas de nombres — il y a des **index**, des **noms de champ** et des **libellés**.
 * L'ancrage est donc le même principe appliqué à un autre matériau : tout `i` est un index qu'on
 * a fourni, tout `champ` et tout `cible` appartiennent aux listes fournies, tout `libelle` est
 * recopié caractère pour caractère depuis l'envoi. Un jeton inventé fait tomber la réponse
 * **entière**, exactement comme un chiffre inventé.
 *
 * Et c'est le **même motif de refus** : `unanchored`. On n'en crée pas un huitième (décision
 * n° 69) — un motif de plus, c'est une branche de plus dans chaque écran pour une nuance que
 * l'utilisateur ne peut pas exploiter.
 *
 * ## Le pipeline est fixe, et il s'arrête au premier échec
 *
 * appel → réponse vide ? `empty` → **contrôle 0** (conformité du JSON, cet ancrage-là) →
 * `unanchored` → **contrôles 1 à 4** (le vérificateur, qui rejoue l'import entier) → `unanchored`
 * → étiquette. À défaut : refus, proposition du modèle jetée **entière**, repli sur la proposition
 * déterministe.
 *
 * ## Pourquoi aucun lexique ici
 *
 * `narrative.ts` passe les quatre lexiques avant l'ancrage, parce qu'une phrase de conseil
 * parfaitement ancrée reste une phrase de conseil. Une réponse d'appariement n'est pas une phrase :
 * le contrôle 0 exige que le texte entier soit **un objet JSON**, sans rien avant ni après. Une
 * prose de conseil ne franchirait donc jamais l'analyse, et l'y chercher serait un contrôle qui ne
 * peut pas mordre — c'est-à-dire un contrôle qui rassure sans vérifier.
 *
 * Module pur : ni DOM, ni réseau, ni horloge (l'appelant fournit l'instant, comme partout).
 */
import type { NaiveDateTime } from '../domain/types';
import type { ColumnMappingInput } from '../import/mapping/payload';
import type { ModelColumn, ModelMapping, ModelType } from '../import/mapping/merge';
import type { AnchorReport } from './anchor';
import {
  AI_REFUSALS,
  accept,
  buildRequest,
  label,
  refuse,
  type AiOutcome,
  type AiRefusal,
  type ModelAdapter,
} from './contract';

/**
 * L'audit numérique d'un appariement est **vide par construction** : la réponse ne porte aucun
 * montant, aucune date, aucune quantité — seulement des index et des noms. Le construire ici,
 * plutôt que d'appeler `auditText` sur du JSON, dit la vérité : il n'y a rien à ancrer
 * numériquement, et l'ancrage réel est celui des jetons, fait par `parseMappingReply`.
 *
 * L'invariant du contrat (`ok ⟹ audit.unanchored vide`) reste donc vrai, et il reste vérifié par
 * `accept()`.
 */
export const NO_NUMERIC_ANCHORS: AnchorReport = {
  anchors: [],
  checked: [],
  excluded: [],
  matched: [],
  unanchored: [],
};

/** Le motif porté par une erreur d'adaptateur, ou `model-error`. Lu **en canard**, comme P65. */
export function refusalOfModelError(error: unknown): AiRefusal {
  const carried = (error as { aiRefusal?: unknown } | null)?.aiRefusal;
  return AI_REFUSALS.includes(carried as AiRefusal) ? (carried as AiRefusal) : 'model-error';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * **Contrôle 0** : la réponse est-elle un JSON conforme, dont chaque jeton vient de l'envoi ?
 *
 * Cinq exigences, et l'échec de n'importe laquelle jette la réponse entière :
 *
 * 1. le texte entier est un objet JSON — rien avant, rien après, pas de bloc de code ;
 * 2. seules les clés déclarées apparaissent, à chaque niveau ;
 * 3. tout `i` est un index de colonne réellement fourni ;
 * 4. aucun champ ni aucune colonne n'est affecté deux fois ;
 * 5. tout `libelle` cité figure **mot pour mot** dans `typesDistincts`, et toute `cible` dans la
 *    liste des étiquettes admises.
 *
 * Rend `null` en cas d'échec : l'appelant en fait un refus `unanchored`.
 */
export function parseMappingReply(
  text: string,
  input: ColumnMappingInput,
  typeTargets: readonly string[],
): ModelMapping | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  for (const key of Object.keys(parsed)) if (key !== 'colonnes' && key !== 'types') return null;

  const rawColumns = parsed['colonnes'];
  const rawTypes = parsed['types'] ?? [];
  if (!Array.isArray(rawColumns) || !Array.isArray(rawTypes)) return null;

  const validIndexes = new Set(input.colonnes.map((c) => c.i));
  const validFields = new Set(input.cible.map((c) => c.champ));
  const seenFields = new Set<string>();
  const seenColumns = new Set<number>();
  const colonnes: ModelColumn[] = [];
  for (const entry of rawColumns) {
    if (!isRecord(entry)) return null;
    for (const key of Object.keys(entry))
      if (key !== 'i' && key !== 'champ' && key !== 'confiance') return null;
    const { i, champ, confiance } = entry;
    if (typeof i !== 'number' || !Number.isInteger(i) || !validIndexes.has(i)) return null;
    if (typeof champ !== 'string' || !validFields.has(champ as never)) return null;
    if (typeof confiance !== 'number' || !Number.isFinite(confiance)) return null;
    if (confiance < 0 || confiance > 1) return null;
    if (seenFields.has(champ) || seenColumns.has(i)) return null;
    seenFields.add(champ);
    seenColumns.add(i);
    colonnes.push({ i, champ: champ as ModelColumn['champ'], confiance });
  }

  const sent = new Set(input.typesDistincts);
  const targets = new Set(typeTargets);
  const seenLabels = new Set<string>();
  const types: ModelType[] = [];
  for (const entry of rawTypes) {
    if (!isRecord(entry)) return null;
    for (const key of Object.keys(entry)) if (key !== 'libelle' && key !== 'cible') return null;
    const { libelle, cible } = entry;
    if (typeof libelle !== 'string' || !sent.has(libelle)) return null;
    if (typeof cible !== 'string' || !targets.has(cible)) return null;
    if (seenLabels.has(libelle)) return null;
    seenLabels.add(libelle);
    types.push({ libelle, cible });
  }

  return { colonnes, types };
}

/**
 * Ce que le vérificateur rend à ce module : `null` s'il accepte l'appariement fusionné, ou le code
 * du premier contrôle en échec. Injecté plutôt qu'importé : le harnais ne connaît ni le moteur, ni
 * le pipeline d'import — c'est ce qui lui permet de rester une couche mince, rejouable seule.
 */
export type MappingVerifier = (proposal: ModelMapping) => string | null;

/**
 * Juge une réponse déjà obtenue. Séparé de l'appel pour être rejouable hors ligne : c'est cette
 * fonction que le banc d'essai applique aux cassettes.
 */
export function judgeMapping(
  text: string,
  input: ColumnMappingInput,
  typeTargets: readonly string[],
  modelId: string,
  at: NaiveDateTime,
  verify: MappingVerifier,
): AiOutcome<ModelMapping> {
  if (text.trim() === '') return refuse<ModelMapping>('column-mapping', 'empty');
  const parsed = parseMappingReply(text, input, typeTargets);
  // Contrôle 0 : un jeton inventé, une clé de trop, un doublon — la réponse tombe entière.
  if (parsed === null) return refuse<ModelMapping>('column-mapping', 'unanchored');
  // Contrôles 1 à 4 : le vérificateur rejoue l'import. C'est lui qui mord sur les jambes inversées.
  if (verify(parsed) !== null) return refuse<ModelMapping>('column-mapping', 'unanchored');
  return accept('column-mapping', parsed, label(modelId, at), NO_NUMERIC_ANCHORS);
}

/**
 * L'appariement, du premier appel à l'étiquette. `adapter === null` — pas de clé, ou consentement
 * refusé — est un refus `no-model` comme un autre : l'appelant affiche la proposition déterministe
 * dans les deux cas, et c'est très exactement ce qu'il aurait affiché sans modèle.
 */
export async function runMapping(
  adapter: ModelAdapter | null,
  input: ColumnMappingInput,
  typeTargets: readonly string[],
  at: NaiveDateTime,
  verify: MappingVerifier,
): Promise<AiOutcome<ModelMapping>> {
  if (adapter === null) return refuse<ModelMapping>('column-mapping', 'no-model');
  try {
    const reply = await adapter.complete(buildRequest('column-mapping', input));
    return judgeMapping(reply.text, input, typeTargets, reply.modelId, at, verify);
  } catch (error) {
    return refuse<ModelMapping>('column-mapping', refusalOfModelError(error));
  }
}
