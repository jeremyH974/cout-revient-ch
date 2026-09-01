/**
 * Cache des historiques quotidiens : IndexedDB natif (base `crch-history`, stores `daily` clé
 * = actif et `meta`) en production, `MemoryHistoryStore` pour les tests et les navigateurs sans
 * IndexedDB (navigation privée Firefox, par exemple).
 */
import type { AssetCode } from '../domain/types';
import type { HistoryStore, PriceHistory } from './types';

export const HISTORY_DB_NAME = 'crch-history';
const DB_VERSION = 1;
const DAILY_STORE = 'daily';
const META_STORE = 'meta';

/** Garde-fou contre une entrée corrompue ou d'un ancien format. */
export function isPriceHistory(value: unknown): value is PriceHistory {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['asset'] === 'string' &&
    Array.isArray(record['points']) &&
    typeof record['source'] === 'string' &&
    typeof record['fetchedAt'] === 'string' &&
    typeof record['from'] === 'string' &&
    typeof record['to'] === 'string'
  );
}

export class MemoryHistoryStore implements HistoryStore {
  private readonly daily = new Map<AssetCode, PriceHistory>();
  private readonly meta = new Map<string, unknown>();

  async getDaily(asset: AssetCode): Promise<PriceHistory | null> {
    const found = this.daily.get(asset);
    return found ? structuredClone(found) : null;
  }

  async putDaily(history: PriceHistory): Promise<void> {
    this.daily.set(history.asset, structuredClone(history));
  }

  async getMeta(key: string): Promise<unknown> {
    return this.meta.has(key) ? structuredClone(this.meta.get(key)) : undefined;
  }

  async putMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, structuredClone(value));
  }

  async cachedAssets(): Promise<AssetCode[]> {
    return [...this.daily.keys()];
  }

  async deleteDaily(asset: AssetCode): Promise<void> {
    this.daily.delete(asset);
  }

  async clear(): Promise<void> {
    this.daily.clear();
    this.meta.clear();
  }

  /** Actifs présents (tests / diagnostics). */
  assets(): AssetCode[] {
    return [...this.daily.keys()];
  }
}

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

export class IndexedDbHistoryStore implements HistoryStore {
  private readonly dbName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName: string = HISTORY_DB_NAME) {
    this.dbName = dbName;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise === null) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(this.dbName, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(DAILY_STORE)) {
            db.createObjectStore(DAILY_STORE, { keyPath: 'asset' });
          }
          if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
        };
        request.onsuccess = () => {
          const db = request.result;
          // Une autre version (onglet plus récent) réclame la base : on la rouvrira à la demande.
          db.onversionchange = () => {
            db.close();
            this.dbPromise = null;
          };
          resolve(db);
        };
        request.onerror = () =>
          reject(request.error ?? new Error('IndexedDB : ouverture impossible'));
        request.onblocked = () => reject(new Error('IndexedDB : ouverture bloquée'));
      });
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  /** Exécute une opération dans une transaction et résout à sa complétion. */
  private async run<T>(
    stores: string[],
    mode: IDBTransactionMode,
    operation: (tx: IDBTransaction) => IDBRequest<T> | null,
  ): Promise<T | undefined> {
    const db = await this.open();
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result: T | undefined;
      const request = operation(tx);
      if (request) request.onsuccess = () => (result = request.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB : transaction échouée'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB : transaction annulée'));
    });
  }

  async getDaily(asset: AssetCode): Promise<PriceHistory | null> {
    const value = await this.run<unknown>([DAILY_STORE], 'readonly', (tx) =>
      tx.objectStore(DAILY_STORE).get(asset),
    );
    return isPriceHistory(value) ? value : null;
  }

  async putDaily(history: PriceHistory): Promise<void> {
    await this.run([DAILY_STORE], 'readwrite', (tx) => tx.objectStore(DAILY_STORE).put(history));
  }

  async getMeta(key: string): Promise<unknown> {
    return this.run<unknown>([META_STORE], 'readonly', (tx) => tx.objectStore(META_STORE).get(key));
  }

  async putMeta(key: string, value: unknown): Promise<void> {
    await this.run([META_STORE], 'readwrite', (tx) => tx.objectStore(META_STORE).put(value, key));
  }

  async cachedAssets(): Promise<AssetCode[]> {
    const keys = await this.run<IDBValidKey[]>([DAILY_STORE], 'readonly', (tx) =>
      tx.objectStore(DAILY_STORE).getAllKeys(),
    );
    return (keys ?? []).filter((key): key is AssetCode => typeof key === 'string');
  }

  async deleteDaily(asset: AssetCode): Promise<void> {
    await this.run([DAILY_STORE], 'readwrite', (tx) => tx.objectStore(DAILY_STORE).delete(asset));
  }

  async clear(): Promise<void> {
    await this.run([DAILY_STORE, META_STORE], 'readwrite', (tx) => {
      tx.objectStore(DAILY_STORE).clear();
      tx.objectStore(META_STORE).clear();
      return null;
    });
  }
}

/** IndexedDB si disponible, sinon mémoire (les données ne survivent alors pas au rechargement). */
export function createHistoryStore(): HistoryStore {
  return isIndexedDbAvailable() ? new IndexedDbHistoryStore() : new MemoryHistoryStore();
}
