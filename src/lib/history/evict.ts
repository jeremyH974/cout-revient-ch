/**
 * Éviction du cache d'historique (décision n° 88).
 *
 * Le cache ne connaissait que l'ajout : un actif entré n'en sortait jamais, même vendu depuis des
 * années, et le magasin `daily` garde **une entrée par actif** — donc la liste de tout ce qui a
 * été détenu. Purger ce qui n'est plus suivi rend de la place, et surtout rend l'oubli possible.
 *
 * La profondeur, elle, n'est **pas** tronquée : la décision n° 42 est allée chercher DefiLlama
 * précisément pour remonter à 2013 sur le bitcoin. Raccourcir l'historique d'un actif détenu
 * casserait cette profondeur pour gagner quelques kilo-octets — mauvais échange.
 */
import type { AssetCode } from '../domain/types';
import type { HistoryStore } from './types';

/**
 * Les actifs en cache qui ne sont plus suivis.
 *
 * **Le garde-fou compte plus que la règle** : une liste suivie vide ne veut pas dire « plus rien
 * n'est détenu », elle veut presque toujours dire « le rapport n'est pas encore calculé ». Purger
 * là-dessus effacerait tout l'historique au premier démarrage, avant même que les données ne
 * soient lues. On ne conclut donc rien d'une liste vide.
 */
export function assetsToEvict(
  cached: readonly AssetCode[],
  kept: readonly AssetCode[],
): AssetCode[] {
  if (kept.length === 0) return [];
  const keep = new Set(kept);
  return cached.filter((asset) => !keep.has(asset));
}

/**
 * Applique l'éviction et rend les actifs oubliés. Silencieuse par conception : un cache est un
 * cache, son contenu se reconstruit — l'échec d'une purge ne doit jamais empêcher l'affichage.
 */
export async function pruneHistory(
  store: HistoryStore,
  kept: readonly AssetCode[],
): Promise<AssetCode[]> {
  try {
    const evicted = assetsToEvict(await store.cachedAssets(), kept);
    for (const asset of evicted) await store.deleteDaily(asset);
    return evicted;
  } catch {
    return [];
  }
}
