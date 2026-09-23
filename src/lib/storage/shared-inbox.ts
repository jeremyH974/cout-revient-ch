/**
 * Côté PAGE de la réception Android (Web Share Target) : lit puis efface le fichier que
 * `public/sw-share-target.js` a déposé dans sa base IndexedDB DÉDIÉE, pendant que l'app n'existait
 * peut-être pas encore (partage « à froid » : l'OS lance l'app sur l'action du manifeste, le service
 * worker répond avant qu'aucune page ne soit ouverte pour recevoir un `postMessage`). IndexedDB est
 * donc le seul point de rendez-vous fiable entre les deux — voir `docs/backup-format.md`.
 *
 * Base séparée de `crch-state` (`idb-state-store.ts`) : c'est une boîte aux lettres technique, pas
 * de l'état applicatif, et les deux ne doivent pas pouvoir se corrompre l'une l'autre.
 *
 * **Les constantes ci-dessous doivent rester alignées avec `public/sw-share-target.js`** (même
 * patron que `sw-alert-sync.js` / `idb-state-store.ts`) : si l'un des deux change de nom de base, de
 * magasin ou de clé sans l'autre, le service worker écrit dans un tiroir que la page ne regarde plus.
 */
const DB_NAME = 'crch-shared-inbox';
const DB_VERSION = 1;
const STORE = 'inbox';
const KEY = 'pending';

/** Le fichier reçu par partage, tel que déposé par le service worker. */
export interface SharedInboxFile {
  /** Contenu texte du fichier partagé (une enveloppe v3 JSON, en principe — jamais supposé ici). */
  text: string;
  /** ISO 8601 : instant où le service worker a reçu le partage. */
  receivedAt: string;
  /** Nom du fichier tel qu'annoncé par l'expéditeur. Jamais utilisé pour décider — voir mailbox.ts. */
  name: string | null;
  /** Type MIME annoncé par l'expéditeur, purement diagnostique. */
  type: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Garde runtime : une base partagée avec un service worker n'est jamais supposée bien formée. */
function isSharedInboxFile(value: unknown): value is SharedInboxFile {
  if (!isRecord(value)) return false;
  return (
    typeof value['text'] === 'string' &&
    typeof value['receivedAt'] === 'string' &&
    (typeof value['name'] === 'string' || value['name'] === null) &&
    (typeof value['type'] === 'string' || value['type'] === null)
  );
}

export function isSharedInboxSupported(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    // Si le service worker a ouvert la base avant la page (partage à froid), elle existe déjà avec
    // ce magasin ; si la page l'ouvre la première, c'est elle qui le crée. Les deux côtés doivent
    // donc créer EXACTEMENT le même magasin, au même nom.
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB : ouverture impossible'));
    request.onblocked = () => reject(new Error('IndexedDB : base bloquée par un autre onglet'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

/**
 * Lit le fichier en attente puis l'efface, dans la MÊME transaction : deux onglets ouverts en même
 * temps ne peuvent pas se voler mutuellement un fichier à moitié consommé.
 */
export async function takeSharedFile(): Promise<SharedInboxFile | null> {
  if (!isSharedInboxSupported()) return null;
  const db = await open();
  return new Promise<SharedInboxFile | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.get(KEY);
    let value: unknown;
    request.onsuccess = () => {
      value = request.result;
      if (value !== undefined) store.delete(KEY);
    };
    tx.oncomplete = () => resolve(isSharedInboxFile(value) ? value : null);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB : transaction en échec'));
  });
}

/** Un fichier attend-il, sans le consommer ? Pour un indicateur d'écran, jamais pour décider. */
export async function hasSharedFile(): Promise<boolean> {
  if (!isSharedInboxSupported()) return false;
  const db = await open();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(KEY);
    let value: unknown;
    request.onsuccess = () => (value = request.result);
    tx.oncomplete = () => resolve(isSharedInboxFile(value));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB : transaction en échec'));
  });
}

/** Tests : oublie la connexion en cache (après suppression de la base simulée). */
export function resetSharedInboxForTests(): void {
  dbPromise = null;
}

/**
 * Tests seulement : sème l'emplacement unique comme le ferait `public/sw-share-target.js` — y
 * compris une valeur volontairement malformée, pour éprouver la garde `isSharedInboxFile`.
 */
export async function putSharedInboxEntryForTests(value: unknown): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB : transaction en échec'));
  });
}
