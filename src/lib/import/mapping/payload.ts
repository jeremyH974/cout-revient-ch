/**
 * La charge utile envoyée au modèle (P64) — et la preuve qu'elle ne fuit rien.
 *
 * ## Ce qui part, et rien d'autre
 *
 * Des **en-têtes**, des **formes de colonne**, des **compteurs**, et la liste des cibles possibles.
 * Ni cellule, ni montant, ni date, ni quantité, ni compte, ni nom de fichier. Le modèle apparie
 * des noms de colonnes : il n'a jamais besoin de voir ce qu'il y a dedans, et le lui montrer
 * n'améliorerait pas l'appariement — cela ne ferait qu'agrandir ce qu'on regrette d'avoir envoyé.
 *
 * ## `typesDistincts` : l'exception, et elle est assumée
 *
 * Une seule donnée de cellule voyage : les **libellés distincts de la colonne de type**. Sans eux,
 * le modèle ne peut pas traduire « Récompense de staking » en `staking`, et la moitié de la
 * fonctionnalité disparaît. L'exception est donc nécessaire, et elle est bornée sur trois axes :
 *
 * 1. **Nombre** — quarante libellés au plus. Une colonne qui en compte davantage n'est pas une
 *    colonne de type (c'est déjà ce que dit `enum-small`), et l'envoyer serait envoyer du texte
 *    libre.
 * 2. **Longueur** — quarante caractères au plus par libellé.
 * 3. **Contenu** — tout libellé qui porte au moins quatre chiffres consécutifs, une arobase, un
 *    préfixe `0x` ou un séparateur décimal est **écarté, jamais tronqué**.
 *
 * Le troisième point mérite d'être lu deux fois. Tronquer serait pire que d'écarter : la moitié
 * d'une adresse reste une adresse, la moitié d'un montant reste un chiffre, et une troncature
 * donne l'illusion d'avoir protégé quelque chose. **Une valeur suspecte ne part pas du tout.**
 *
 * Le nombre de libellés écartés est **affiché à l'utilisateur** avant l'envoi : c'est plus
 * informatif qu'une case à cocher de plus, et cela lui dit exactement ce que le filtre a fait.
 *
 * ## La liste blanche des clés est déclarée, et un test l'impose à toute profondeur
 *
 * `PAYLOAD_KEYS` énumère les clés admises par niveau. Une propriété vérifie que les clés
 * réellement produites sont **exactement** celles-là — sans quoi un futur champ « exemples »
 * entrerait dans la charge utile sans qu'aucun test ne tombe. C'est le pendant, pour P64, de la
 * propriété de non-fuite de la décision n° 70.
 */
import type { CsvTable } from '../csv';
import type { MappingProposal } from './propose';
import { distinctValues } from './propose';
import { TARGET_SCHEMA, type MappingTarget, type TargetRole } from './schema';
import type { ValueShape } from './shape';

export interface MappingColumnInput {
  readonly i: number;
  readonly entete: string;
  readonly forme: ValueShape;
  /** Valeurs distinctes de la colonne, quand elles sont assez peu nombreuses pour informer. */
  readonly distincts?: number;
}

export interface MappingTargetInput {
  readonly champ: MappingTarget;
  readonly role: TargetRole;
}

export interface ColumnMappingInput {
  readonly colonnes: readonly MappingColumnInput[];
  /** Seule donnée de cellule de toute la charge utile : filtrée et bornée (voir l'en-tête). */
  readonly typesDistincts: readonly string[];
  readonly cible: readonly MappingTargetInput[];
}

/** Les clés admises, par niveau. Toute autre clé, à n'importe quelle profondeur, est un défaut. */
export const PAYLOAD_KEYS: Readonly<Record<string, readonly string[]>> = {
  '': ['cible', 'colonnes', 'typesDistincts'],
  colonnes: ['distincts', 'entete', 'forme', 'i'],
  cible: ['champ', 'role'],
};

export const MAX_TYPE_LABELS = 40;
export const MAX_TYPE_LABEL_LENGTH = 40;

/**
 * Les motifs qui font écarter un libellé. Chacun désigne une donnée qui n'a rien à faire dans une
 * colonne de type et tout à voir avec l'utilisateur : un identifiant, une adresse, un courriel,
 * un montant.
 */
const FORBIDDEN_IN_LABEL: readonly RegExp[] = [
  /\d{4,}/, // identifiant, année collée, montant sans séparateur
  /@/, // courriel
  /0x/i, // adresse ou hachage
  /\d[.,]\d/, // séparateur décimal : c'est un montant, pas un type
];

export interface FilteredTypeLabels {
  /** Ce qui part, dans l'ordre de première apparition. */
  readonly kept: readonly string[];
  /** Combien ont été ÉCARTÉS — jamais tronqués. Ce compte est affiché avant l'envoi. */
  readonly dropped: number;
}

/** Applique les trois bornes. Un libellé écarté l'est **entièrement**. */
export function filterTypeLabels(values: readonly string[]): FilteredTypeLabels {
  const kept: string[] = [];
  let dropped = 0;
  for (const raw of values) {
    const value = raw.trim();
    if (value === '') continue;
    if (value.length > MAX_TYPE_LABEL_LENGTH || FORBIDDEN_IN_LABEL.some((r) => r.test(value))) {
      dropped += 1;
      continue;
    }
    if (kept.length >= MAX_TYPE_LABELS) {
      dropped += 1;
      continue;
    }
    kept.push(value);
  }
  return { kept, dropped };
}

/** Au-delà, `distincts` ne renseigne plus le modèle : il décrit une colonne de texte libre. */
const DISTINCT_HINT_MAX = 60;

export interface BuiltMappingInput {
  readonly input: ColumnMappingInput;
  /** Libellés écartés par le filtre : montré dans la feuille de consentement. */
  readonly droppedTypeLabels: number;
}

/**
 * La charge utile, et rien d'autre. La feuille de consentement affiche exactement le résultat de
 * cette fonction, réindenté — comme pour le récit (P65).
 */
export function buildColumnMappingInput(
  table: CsvTable,
  proposal: MappingProposal,
): BuiltMappingInput {
  const colonnes: MappingColumnInput[] = proposal.headers.map((header, i) => {
    const shape = proposal.shapes[i];
    const base: MappingColumnInput = {
      i,
      entete: header.raw,
      forme: shape?.shape ?? 'empty',
    };
    const distinct = shape?.distinct ?? 0;
    return distinct > 0 && distinct <= DISTINCT_HINT_MAX ? { ...base, distincts: distinct } : base;
  });

  const labelColumn = proposal.columns.find((c) => c.field === 'label')?.column ?? null;
  const filtered = filterTypeLabels(labelColumn === null ? [] : distinctValues(table, labelColumn));

  return {
    input: {
      colonnes,
      typesDistincts: filtered.kept,
      cible: TARGET_SCHEMA.map((spec) => ({ champ: spec.field, role: spec.role })),
    },
    droppedTypeLabels: filtered.dropped,
  };
}

/** Toutes les clés d'une valeur JSON, par niveau (`''`, `colonnes`, `cible`…) — pour la propriété. */
export function payloadKeysByLevel(value: unknown, level = ''): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, path);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const keys = found.get(path) ?? new Set<string>();
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      keys.add(key);
      visit(child, path === '' ? key : `${path}.${key}`);
    }
    found.set(path, keys);
  };
  visit(value, level);
  return found;
}
