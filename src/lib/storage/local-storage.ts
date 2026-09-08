/** Persistance locale : une seule clé, préfixée (origine *.github.io partagée). */
import { migrateState } from './migrations';
import { emptyState, type StoredStateV1 } from './schema';
import { looksSealed } from './vault';

export const STORAGE_KEY = 'crch:v1:state';

export const CORRUPT_BACKUP_KEY = `${STORAGE_KEY}.corrupt`;

/** Copie les données illisibles avant qu'une sauvegarde automatique ne les écrase. */
function preserveCorrupt(storage: Storage, raw: string): void {
  try {
    storage.setItem(CORRUPT_BACKUP_KEY, raw);
  } catch {
    /* quota : tant pis, l'erreur est déjà signalée */
  }
}

export type LoadResult =
  | { status: 'empty'; state: StoredStateV1 }
  | { status: 'ok'; state: StoredStateV1 }
  | { status: 'corrupt'; state: StoredStateV1; error: string; raw: string }
  /**
   * Miroir chiffré par le coffre. Ce module est **synchrone** et `crypto.subtle` ne l'est pas : il
   * ne peut que constater. C'est `state-store.ts`, asynchrone, qui ouvrira le bloc.
   */
  | { status: 'sealed'; state: StoredStateV1; raw: string };

export function loadState(storage: Storage = localStorage): LoadResult {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { status: 'empty', state: emptyState() };
  /*
   * Avant toute tentative de lecture JSON : un miroir scellé n'est pas du JSON, et le prendre pour
   * un état corrompu déclencherait `preserveCorrupt`, qui recopierait le chiffré dans une seconde
   * clé — du bruit, et une copie de plus de ce qu'on cherche justement à ne pas répandre.
   */
  if (looksSealed(raw)) return { status: 'sealed', state: emptyState(), raw };
  try {
    const migrated = migrateState(JSON.parse(raw));
    if (migrated.ok) return { status: 'ok', state: migrated.state };
    preserveCorrupt(storage, raw);
    return { status: 'corrupt', state: emptyState(), error: migrated.error, raw };
  } catch (error) {
    preserveCorrupt(storage, raw);
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

/**
 * Écrit un miroir déjà scellé. Passe par le même chemin que `saveState` (même clé, même gestion du
 * quota) mais sans sérialiser : le texte reçu est du chiffré, et ce module ne détient aucune clé.
 */
export function saveSealed(text: string, storage: Storage = localStorage): SaveResult {
  try {
    storage.setItem(STORAGE_KEY, text);
    return { ok: true, bytes: text.length };
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
