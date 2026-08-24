import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawCoinhouseRow } from '../domain/types';
import { idbLoadSnapshot, idbSaveSnapshot, resetIdbStateStoreForTests } from './idb-state-store';
import { STORAGE_KEY, saveState } from './local-storage';
import { emptyState } from './schema';
import {
  SAVED_AT_KEY,
  clearPersistedState,
  loadPersistedState,
  savePersistedState,
} from './state-store';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

/** Simule un quota dépassé (Safari en navigation privée, ou un profil déjà plein). */
function quotaExceededStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: () => {
      throw new Error("QuotaExceededError : quota d'espace de stockage dépassé (test)");
    },
  };
}

function row(key: string): RawCoinhouseRow {
  return {
    key,
    importId: 'imp',
    lineNo: 2,
    id: key,
    at: '2026-01-01T10:00:00',
    type: 'Echange',
    qty: '1',
    asset: 'btc',
    marketPrice: null,
    valueEur: '1',
    feeAsset: null,
    feeEur: null,
    feeRebate: null,
    balance: '1',
    account: 'Portefeuille',
    extra: {},
  };
}

// Même stratégie d'isolation que idb-state-store.test.ts : un `IDBFactory` frais par test, la
// connexion mise en cache par le module oubliée avant chaque test.
describe('state-store', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    resetIdbStateStoreForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('loadPersistedState', () => {
    it('sans IndexedDB : repli sur localStorage au chargement et à l’enregistrement', async () => {
      vi.stubGlobal('indexedDB', undefined);
      const storage = memoryStorage();

      const empty = await loadPersistedState(storage);
      expect(empty.status).toBe('empty');
      expect(empty.source).toBe('localstorage');

      const state = emptyState();
      state.rawRows['a'] = row('a');
      const saved = await savePersistedState(state, '2026-08-23T10:00:00.000Z', storage);
      expect(saved).toEqual({ ok: true, error: null, via: 'localstorage' });

      const loaded = await loadPersistedState(storage);
      expect(loaded.status).toBe('ok');
      expect(loaded.source).toBe('localstorage');
      expect(loaded.state).toEqual(state);
    });

    it('migration : état seul en localStorage (sans clé savedAt), IndexedDB vide => source localstorage', async () => {
      const storage = memoryStorage();
      const state = emptyState();
      state.rawRows['legacy'] = row('legacy');
      saveState(state, storage);
      expect(storage.getItem(SAVED_AT_KEY)).toBeNull();
      expect(await idbLoadSnapshot()).toBeNull();

      const loaded = await loadPersistedState(storage);
      expect(loaded.status).toBe('ok');
      expect(loaded.source).toBe('localstorage');
      expect(loaded.state).toEqual(state);
    });

    it("IndexedDB plus récent que le miroir : IndexedDB l'emporte", async () => {
      const storage = memoryStorage();
      const older = emptyState();
      older.rawRows['old'] = row('old');
      saveState(older, storage);
      storage.setItem(SAVED_AT_KEY, '2026-08-23T10:00:00.000Z');

      const newer = emptyState();
      newer.rawRows['new'] = row('new');
      await idbSaveSnapshot({ state: newer, savedAt: '2026-08-23T11:00:00.000Z' });

      const loaded = await loadPersistedState(storage);
      expect(loaded.source).toBe('indexeddb');
      expect(loaded.status).toBe('ok');
      expect(loaded.state).toEqual(newer);
    });

    it("égalité de savedAt : le miroir localStorage l'emporte", async () => {
      const storage = memoryStorage();
      const local = emptyState();
      local.rawRows['local'] = row('local');
      saveState(local, storage);
      const tie = '2026-08-23T10:00:00.000Z';
      storage.setItem(SAVED_AT_KEY, tie);

      const idb = emptyState();
      idb.rawRows['idb'] = row('idb');
      await idbSaveSnapshot({ state: idb, savedAt: tie });

      const loaded = await loadPersistedState(storage);
      expect(loaded.source).toBe('localstorage');
      expect(loaded.status).toBe('ok');
      expect(loaded.state).toEqual(local);
    });
  });

  describe('savePersistedState', () => {
    it('miroir en échec (quota), IndexedDB ok => ok:true via indexeddb', async () => {
      const storage = quotaExceededStorage();
      const state = emptyState();
      state.rawRows['a'] = row('a');

      const result = await savePersistedState(state, '2026-08-23T10:00:00.000Z', storage);
      expect(result).toEqual({ ok: true, error: null, via: 'indexeddb' });

      const snapshot = await idbLoadSnapshot();
      expect(snapshot?.state).toEqual(state);
    });

    it("IndexedDB et miroir tous deux en échec => ok:false avec un message d'erreur", async () => {
      const factory = new IDBFactory();
      vi.stubGlobal('indexedDB', factory);
      resetIdbStateStoreForTests();
      // Comportement réel de Firefox en navigation privée : `open()` lève de façon synchrone.
      factory.open = () => {
        throw new Error('SecurityError : navigation privée (test)');
      };

      const storage = quotaExceededStorage();
      const result = await savePersistedState(emptyState(), '2026-08-23T10:00:00.000Z', storage);

      expect(result.ok).toBe(false);
      expect(result.via).toBeNull();
      expect(typeof result.error).toBe('string');
      expect(result.error).toMatch(/IndexedDB/);
    });
  });

  describe('clearPersistedState', () => {
    it('vide IndexedDB et le miroir, retire savedAt', async () => {
      const storage = memoryStorage();
      const state = emptyState();
      state.rawRows['a'] = row('a');
      await savePersistedState(state, '2026-08-23T10:00:00.000Z', storage);

      expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
      expect(storage.getItem(SAVED_AT_KEY)).not.toBeNull();
      expect(await idbLoadSnapshot()).not.toBeNull();

      await clearPersistedState(storage);

      expect(storage.getItem(STORAGE_KEY)).toBeNull();
      expect(storage.getItem(SAVED_AT_KEY)).toBeNull();
      expect(await idbLoadSnapshot()).toBeNull();
    });
  });
});
