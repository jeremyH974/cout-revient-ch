/**
 * Règle EXACTE d'`undoImport` (`src/state/app.svelte.ts`) : les lignes brutes et pivot d'un lot
 * d'import donné, et les qualifications qui leur étaient attachées. Extraite ici en fonction pure
 * pour être rejouée à deux endroits sans dupliquer la logique : l'annulation manuelle d'un import
 * (un seul lot) et l'élagage après fusion (`sync/merge.ts`, un lot devenu pierre tombale peut
 * venir de N'IMPORTE quel appareil, donc potentiellement plusieurs lots à la fois).
 */

export interface ImportPruneResult<Raw, Pivot, Qual> {
  rawRows: Record<string, Raw>;
  pivotRows: Record<string, Pivot>;
  qualifications: Record<string, Qual>;
  removed: number;
}

/**
 * Retire, de `rawRows` et `pivotRows`, toute ligne dont `importId` figure dans `importIds` — ainsi
 * que la qualification attachée à sa clé, le cas échéant. Une ligne sans import connu (`importId`
 * vide, export Coinhouse antérieur au suivi) n'est jamais concernée : `importIds` ne contient que
 * des identifiants de lots réels.
 */
/**
 * `importIds` prend n'importe quel itérable (tableau compris) plutôt qu'un `Set` : les appelants
 * dans `src/state/*.svelte.ts` ne doivent pas construire de `Set` mutable au point d'appel
 * (`svelte/prefer-svelte-reactivity` le refuse, à raison — un `Set` y serait normalement de
 * l'état). Le `Set` de travail est interne, jamais exposé.
 */
export function pruneRowsForImports<
  Raw extends { importId: string },
  Pivot extends { importId: string },
  Qual,
>(
  rawRows: Record<string, Raw>,
  pivotRows: Record<string, Pivot>,
  qualifications: Record<string, Qual>,
  importIds: Iterable<string>,
): ImportPruneResult<Raw, Pivot, Qual> {
  const ids = importIds instanceof Set ? importIds : new Set(importIds);
  if (ids.size === 0) return { rawRows, pivotRows, qualifications, removed: 0 };

  let removed = 0;
  const nextQualifications = { ...qualifications };
  const nextPivotRows: Record<string, Pivot> = {};
  for (const [key, row] of Object.entries(pivotRows)) {
    if (ids.has(row.importId)) {
      removed += 1;
      delete nextQualifications[key];
      continue;
    }
    nextPivotRows[key] = row;
  }
  const nextRawRows: Record<string, Raw> = {};
  for (const [key, row] of Object.entries(rawRows)) {
    if (ids.has(row.importId)) {
      removed += 1;
      delete nextQualifications[key];
      continue;
    }
    nextRawRows[key] = row;
  }
  return {
    rawRows: nextRawRows,
    pivotRows: nextPivotRows,
    qualifications: nextQualifications,
    removed,
  };
}
