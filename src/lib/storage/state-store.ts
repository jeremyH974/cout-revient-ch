/**
 * Persistance de l'état principal : IndexedDB en source principale (sans plafond de 5 Mo), miroir
 * localStorage (format v1 inchangé) écrit à chaque enregistrement et en **synchrone** à la fermeture
 * de la page — seule écriture garantie quand iOS gèle l'onglet. Au chargement, l'instantané le plus
 * récent gagne (`savedAt`) ; à égalité le miroir, ce qui couvre la migration v1 → IndexedDB et les
 * états déposés directement dans localStorage (tests, restauration manuelle).
 */
import {
  idbClearSnapshot,
  idbLoadSnapshot,
  idbSaveSnapshot,
  isIndexedDbAvailable,
} from './idb-state-store';
import {
  STORAGE_KEY,
  clearState as clearLocal,
  loadState as loadLocal,
  saveState as saveLocal,
  type LoadResult,
  type SaveResult,
} from './local-storage';
import type { StoredStateV1 } from './schema';

export const SAVED_AT_KEY = `${STORAGE_KEY}.savedAt`;

export type PersistedSource = 'indexeddb' | 'localstorage';

export type LoadedState = LoadResult & { source: PersistedSource };

/** Horodatage du miroir ; vide avant la première écriture par cette version (migration v1). */
const localSavedAt = (storage: Storage): string => storage.getItem(SAVED_AT_KEY) ?? '';

/** Miroir localStorage synchrone ; un échec (quota) n'est pas une erreur tant qu'IndexedDB a réussi. */
export function mirrorStateSync(
  state: StoredStateV1,
  savedAt: string,
  storage: Storage = localStorage,
): SaveResult {
  const result = saveLocal(state, storage);
  if (result.ok) {
    try {
      storage.setItem(SAVED_AT_KEY, savedAt);
    } catch {
      /* quota : le miroir reste sans horodatage, IndexedDB fait foi */
    }
  }
  return result;
}

export async function loadPersistedState(storage: Storage = localStorage): Promise<LoadedState> {
  const local = loadLocal(storage);
  if (!isIndexedDbAvailable()) return { ...local, source: 'localstorage' };
  const snapshot = await idbLoadSnapshot().catch(() => null);
  if (!snapshot) return { ...local, source: 'localstorage' };
  if (local.status === 'ok' && localSavedAt(storage) >= snapshot.savedAt) {
    return { ...local, source: 'localstorage' };
  }
  return { status: 'ok', state: snapshot.state, source: 'indexeddb' };
}

export interface PersistResult {
  ok: boolean;
  error: string | null;
  via: PersistedSource | null;
  /**
   * Échec du miroir alors que l'enregistrement, lui, a réussi — donc **non bloquant**.
   *
   * À ne pas confondre avec `error`, qui dit « rien n'a été enregistré ». Celui-ci dit
   * « l'enregistrement a réussi, mais le **repli** est hors service » : `loadPersistedState` se
   * rabat sur le miroir dès qu'`idbLoadSnapshot()` rend `null` — base évincée, navigation privée,
   * quota IndexedDB — et il ramènerait alors un état d'avant le premier échec. Le jour où il sert,
   * il ne vaudrait rien. D'où le voyant d'auto-vérification (décision n° 79) : rien n'est perdu, et
   * c'est précisément pour cela qu'il faut le dire avant que quelque chose le soit.
   */
  mirrorError: string | null;
}

/** IndexedDB puis miroir ; `ok` dès qu'un des deux a réussi. */
export async function savePersistedState(
  state: StoredStateV1,
  savedAt: string,
  storage: Storage = localStorage,
): Promise<PersistResult> {
  let idbError: string | null = null;
  let viaIdb = false;
  if (isIndexedDbAvailable()) {
    try {
      await idbSaveSnapshot({ state, savedAt });
      viaIdb = true;
    } catch (error) {
      idbError = `IndexedDB : ${String(error)}`;
    }
  }
  const mirror = mirrorStateSync(state, savedAt, storage);
  const mirrorError = mirror.ok ? null : mirror.error;
  if (viaIdb) return { ok: true, error: null, via: 'indexeddb', mirrorError };
  if (mirror.ok) return { ok: true, error: null, via: 'localstorage', mirrorError: null };
  return {
    ok: false,
    error: idbError ? `${idbError} ; ${mirror.error}` : mirror.error,
    via: null,
    mirrorError,
  };
}

export async function clearPersistedState(storage: Storage = localStorage): Promise<void> {
  clearLocal(storage);
  try {
    storage.removeItem(SAVED_AT_KEY);
  } catch {
    /* rien à faire */
  }
  if (isIndexedDbAvailable()) {
    try {
      await idbClearSnapshot();
    } catch {
      /* la base sera écrasée au prochain enregistrement */
    }
  }
}
