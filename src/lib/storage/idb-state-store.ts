/**
 * État principal dans IndexedDB (base `crch-state`) : sans le plafond ~5 Mo de localStorage, qui
 * devient un miroir de secours (écrit en synchrone à la fermeture, voir `state-store.ts`).
 * L'objet `StoredStateV1` est stocké tel quel (structuré-clonable : chaînes, booléens, objets) ;
 * la sérialisation JSON n'existe que pour la sauvegarde téléchargeable. Même patron que
 * `history/cache.ts` : ouverture unique, transactions résolues sur `oncomplete`.
 */
import type { StoredStateV1 } from './schema';

export const STATE_DB = 'crch-state';
const STATE_STORE = 'state';
const META_STORE = 'meta';
const STATE_KEY = 'v1';

export interface StateSnapshot {
  state: StoredStateV1;
  /** ISO 8601 de l'enregistrement : départage IndexedDB et miroir localStorage au chargement. */
  savedAt: string;
}

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(STATE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB : ouverture impossible'));
    request.onblocked = () => reject(new Error('IndexedDB : base bloquée par un autre onglet'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (objectStore: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = work(tx.objectStore(store));
        let value: T | undefined;
        if (request) request.onsuccess = () => (value = request.result);
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB : transaction en échec'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB : transaction annulée'));
      }),
  );
}

const isSnapshot = (v: unknown): v is StateSnapshot =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as StateSnapshot).savedAt === 'string' &&
  typeof (v as StateSnapshot).state === 'object';

export async function idbLoadSnapshot(): Promise<StateSnapshot | null> {
  const value = await run<unknown>(STATE_STORE, 'readonly', (s) => s.get(STATE_KEY));
  return isSnapshot(value) ? value : null;
}

export async function idbSaveSnapshot(snapshot: StateSnapshot): Promise<void> {
  await run(STATE_STORE, 'readwrite', (s) => void s.put(snapshot, STATE_KEY));
}

export async function idbClearSnapshot(): Promise<void> {
  await run(STATE_STORE, 'readwrite', (s) => void s.delete(STATE_KEY));
}

/** Métadonnées non sérialisables en JSON (ex. handle de dossier de la sauvegarde automatique). */
export async function idbMetaGet<T>(key: string): Promise<T | undefined> {
  return run<T>(META_STORE, 'readonly', (s) => s.get(key));
}

export async function idbMetaSet(key: string, value: unknown): Promise<void> {
  await run(META_STORE, 'readwrite', (s) => void s.put(value, key));
}

export async function idbMetaDelete(key: string): Promise<void> {
  await run(META_STORE, 'readwrite', (s) => void s.delete(key));
}

/** Tests : oublie la connexion en cache (après suppression de la base simulée). */
export function resetIdbStateStoreForTests(): void {
  dbPromise = null;
}
