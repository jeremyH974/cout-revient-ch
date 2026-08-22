/** Persistance locale : une seule clé, préfixée (origine *.github.io partagée). */
import { migrateState } from './migrations';
import { emptyState, type StoredStateV1 } from './schema';

export const STORAGE_KEY = 'crch:v1:state';

export type LoadResult =
  | { status: 'empty'; state: StoredStateV1 }
  | { status: 'ok'; state: StoredStateV1 }
  | { status: 'corrupt'; state: StoredStateV1; error: string; raw: string };

export function loadState(storage: Storage = localStorage): LoadResult {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { status: 'empty', state: emptyState() };
  try {
    const migrated = migrateState(JSON.parse(raw));
    if (migrated.ok) return { status: 'ok', state: migrated.state };
    return { status: 'corrupt', state: emptyState(), error: migrated.error, raw };
  } catch (error) {
    return { status: 'corrupt', state: emptyState(), error: String(error), raw };
  }
}

export type SaveResult = { ok: true; bytes: number } | { ok: false; error: string };

export function saveState(state: StoredStateV1, storage: Storage = localStorage): SaveResult {
  const json = JSON.stringify(state);
  try {
    storage.setItem(STORAGE_KEY, json);
    return { ok: true, bytes: json.length };
  } catch (error) {
    return {
      ok: false,
      error: `Impossible d'enregistrer (espace insuffisant ?) : ${String(error)}`,
    };
  }
}

export function clearState(storage: Storage = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}

/** Demande au navigateur de ne pas évincer les données (après un geste utilisateur). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
