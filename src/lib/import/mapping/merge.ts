/**
 * Contrôle 5 (P64) : **le modèle ne peut que combler un trou.**
 *
 * C'est la garantie de non-régression, et elle est structurelle plutôt que morale : la fusion
 * refuse d'écrire par-dessus un appariement déterministe dont la confiance atteint le seuil de
 * pré-cochage. Un modèle qui « corrigerait » une colonne correctement identifiée ne pourrait donc
 * pas dégrader le résultat, même en toute bonne foi — et surtout, la voie sans clé et sans réseau
 * reste **exactement** ce qu'elle serait sans lui.
 *
 * ## La confiance déclarée par le modèle n'est pas une preuve
 *
 * Elle est **plafonnée sous le seuil de pré-cochage**. Une proposition de modèle arrive donc
 * toujours « à confirmer », jamais pré-cochée : c'est un avis, pas un constat. Un modèle sûr de
 * lui et un modèle hésitant produisent le même statut à l'écran, parce que rien, dans sa réponse,
 * ne distingue les deux autrement que par sa propre parole.
 *
 * La provenance reste affichée par **pastille ET texte** (`source: 'model'`) : jamais par la seule
 * couleur (WCAG 2.2 AA, critère 1.4.1).
 */
import { CONFIRM_THRESHOLD, RULE_CAP } from './score';
import type { ColumnAssignment, MappingProposal, TypeAssignment } from './propose';
import { isMappingTarget, type MappingTarget } from './schema';

export interface ModelColumn {
  readonly i: number;
  readonly champ: MappingTarget;
  readonly confiance: number;
}

export interface ModelType {
  readonly libelle: string;
  readonly cible: string;
}

export interface ModelMapping {
  readonly colonnes: readonly ModelColumn[];
  readonly types: readonly ModelType[];
}

/** Plafond d'une proposition de modèle : sous le seuil de pré-cochage, toujours. */
export const MODEL_CONFIDENCE_CAP = RULE_CAP.fuzzy;

export interface MergeReport {
  readonly proposal: MappingProposal;
  /** Appariements réellement ajoutés par le modèle. */
  readonly filled: number;
  /** Propositions écartées par le contrôle 5 (champ ou colonne déjà tenu avec confiance). */
  readonly ignored: number;
}

const capped = (confidence: number): number =>
  Math.min(MODEL_CONFIDENCE_CAP, Math.max(0, confidence));

export function mergeModelMapping(base: MappingProposal, model: ModelMapping): MergeReport {
  const columns: ColumnAssignment[] = [...base.columns];
  let filled = 0;
  let ignored = 0;

  const heldField = (field: MappingTarget): ColumnAssignment | undefined =>
    columns.find((c) => c.field === field);
  const heldColumn = (index: number): ColumnAssignment | undefined =>
    columns.find((c) => c.column === index);

  for (const entry of model.colonnes) {
    if (!isMappingTarget(entry.champ) || !Number.isInteger(entry.i) || entry.i < 0) {
      ignored += 1;
      continue;
    }
    if (entry.i >= base.headers.length) {
      ignored += 1;
      continue;
    }
    const onField = heldField(entry.champ);
    const onColumn = heldColumn(entry.i);
    // Contrôle 5 : un score déterministe qui atteint le seuil de pré-cochage est intouchable,
    // qu'il tienne le champ visé ou la colonne visée.
    if (
      (onField && onField.confidence >= CONFIRM_THRESHOLD) ||
      (onColumn && onColumn.confidence >= CONFIRM_THRESHOLD)
    ) {
      ignored += 1;
      continue;
    }
    // La place est libre, ou tenue faiblement : le modèle la prend, à sa confiance plafonnée.
    for (const stale of [onField, onColumn]) {
      if (stale === undefined) continue;
      const at = columns.indexOf(stale);
      if (at >= 0) columns.splice(at, 1);
    }
    columns.push({
      column: entry.i,
      field: entry.champ,
      confidence: capped(entry.confiance),
      rule: 'model',
      source: 'model',
    });
    filled += 1;
  }

  const typeLabels: TypeAssignment[] = base.typeLabels.map((label) => {
    if (label.target !== null && label.confidence >= CONFIRM_THRESHOLD) return label;
    const proposed = model.types.find((t) => t.libelle.toLowerCase() === label.value);
    if (proposed === undefined) return label;
    filled += 1;
    return {
      ...label,
      target: proposed.cible,
      confidence: MODEL_CONFIDENCE_CAP,
      rule: 'model',
      source: 'model',
    };
  });
  // Les libellés proposés pour une valeur déjà tranchée avec confiance : écartés, et comptés.
  ignored += model.types.filter((t) =>
    base.typeLabels.some(
      (label) =>
        label.value === t.libelle.toLowerCase() &&
        label.target !== null &&
        label.confidence >= CONFIRM_THRESHOLD,
    ),
  ).length;

  return { proposal: { ...base, columns, typeLabels }, filled, ignored };
}
