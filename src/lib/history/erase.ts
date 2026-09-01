/**
 * L'oubli du cache d'historique, en une fonction testable (décision n° 88).
 *
 * Écrite ici et non dans `src/state` pour une raison simple : c'est une **règle**, pas du câblage.
 * Elle dit que l'effacement demandé par l'utilisateur doit atteindre la base `crch-history`, et
 * qu'un cache qui refuse de se vider ne doit pas empêcher le reste de disparaître. Une règle qui
 * vit dans un fichier `.svelte.ts` n'a aucun test — et celle-ci porte une promesse d'effacement.
 */
import { createHistoryStore } from './cache';
import type { HistoryStore } from './types';

/**
 * Vide le cache d'historique. Rend `true` s'il est bien vidé, `false` si le magasin a refusé.
 *
 * **Ne relance jamais** : l'effacement des données principales a déjà eu lieu quand on arrive ici,
 * et échouer bruyamment sur un cache laisserait l'utilisateur croire que rien n'a été effacé.
 * L'appelant décide quoi faire du `false` — aujourd'hui, rien : c'est un cache.
 */
export async function eraseHistoryCache(
  store: HistoryStore = createHistoryStore(),
): Promise<boolean> {
  try {
    await store.clear();
    return true;
  } catch {
    return false;
  }
}
