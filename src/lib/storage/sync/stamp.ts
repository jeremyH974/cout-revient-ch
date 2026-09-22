/**
 * Datation automatique : compare deux instantanés de l'état et produit les métadonnées de
 * synchronisation qui en découlent. C'est le SEUL endroit qui date quoi que ce soit — jamais un
 * mutateur individuel (`src/state/app.svelte.ts` en compte des dizaines, et ce fichier n'a presque
 * aucun test ; un mutateur oublié ne daterait jamais). La datation est donc un pur DIFF entre deux
 * instantanés, appelé une fois par enregistrement (`AppState.flush`/`flushSync`, debounce 300 ms).
 */
import { canon } from './canon';
import { hlcTick } from './hlc';
import { TRACKED_COLLECTIONS, readTracked } from './tracked';
import type { EntryVersion, SyncMeta } from './types';
import { SYNC_META_VERSION } from './types';

/**
 * `prev` = dernier instantané enregistré (`baseline`), `next` = instantané courant. Pour chaque
 * collection suivie et chaque clé de `prev` ∪ `next` ∪ des versions déjà connues :
 * - ajoutée ou modifiée (JSON canonique différent) → nouvelle version `{ t: tick() }` ;
 * - présente dans `prev` mais plus dans `next` → pierre tombale `{ t: tick(), del: true }` ;
 * - inchangée → la version déjà connue est conservée telle quelle (jamais retamponnée) ; si elle
 *   n'en avait aucune, elle reste sans version (« héritée »).
 *
 * Itération à clés TRIÉES : déterministe, donc reproductible d'un run à l'autre (tests, mutation).
 *
 * `prev`/`next` sont typés `object` plutôt que `Record<string, unknown>` : `StoredStateV1` porte
 * un champ optionnel (`sync?`), et `exactOptionalPropertyTypes` refuse de le faire passer pour un
 * `Record` à l'appel — `object` accepte toute valeur non primitive, sans ce frottement.
 */
export function stampChanges(
  prev: object,
  next: object,
  meta: SyncMeta,
  deviceId: string,
  wallNowMs: number,
): SyncMeta {
  let clock = meta.clock;
  const versions: SyncMeta['versions'] = {};

  for (const name of TRACKED_COLLECTIONS) {
    const prevColl = readTracked(prev, name);
    const nextColl = readTracked(next, name);
    const prevVersions = meta.versions[name] ?? {};
    const keys = new Set<string>([
      ...Object.keys(prevColl),
      ...Object.keys(nextColl),
      ...Object.keys(prevVersions),
    ]);
    const outColl: Record<string, EntryVersion> = {};

    for (const key of [...keys].sort()) {
      const inPrev = key in prevColl;
      const inNext = key in nextColl;
      const changed =
        inPrev !== inNext || (inPrev && inNext && canon(prevColl[key]) !== canon(nextColl[key]));
      if (changed) {
        clock = hlcTick(clock, wallNowMs, deviceId);
        outColl[key] = inNext ? { t: clock } : { t: clock, del: true };
      } else {
        const kept = prevVersions[key];
        if (kept) outColl[key] = kept;
      }
    }
    if (Object.keys(outColl).length > 0) versions[name] = outColl;
  }

  return { v: SYNC_META_VERSION, clock, versions };
}
