/**
 * Rendu français du rapport de fusion multi-appareils (`src/lib/storage/sync/merge.ts`) : un
 * décompte, une phrase — le seul endroit qui sait l'écrire. Aucun calcul ici.
 */
import type { MergeSummary } from '../storage/sync/merge';

const plural = (n: number, one: string, many: string): string => (n > 1 ? many : one);

/** « Fusion : N ajouté(s), N mis à jour, N supprimé(s). » + une phrase sur les conflits hérités. */
export function fmtMergeSummary(summary: MergeSummary): string {
  const { added, updated, removed, inheritedConflicts } = summary;
  const parts = [
    `${added} ${plural(added, 'ajouté', 'ajoutés')}`,
    `${updated} mis à jour`,
    `${removed} ${plural(removed, 'supprimé', 'supprimés')}`,
  ];
  let text = `Fusion : ${parts.join(', ')}.`;
  if (inheritedConflicts > 0) {
    text += ` ${inheritedConflicts} conflit${inheritedConflicts > 1 ? 's' : ''} hérité${inheritedConflicts > 1 ? 's' : ''} tranché${inheritedConflicts > 1 ? 's' : ''} en faveur de cet appareil.`;
  }
  return text;
}
