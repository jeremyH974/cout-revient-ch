import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER } from '../domain/trading/filter';
import type { RawCoinhouseRow } from '../domain/types';
import { idbLoadSnapshot, idbSaveSnapshot, resetIdbStateStoreForTests } from './idb-state-store';
import { STORAGE_KEY, saveState } from './local-storage';
import { DEFAULT_UI_SETTINGS, emptyState, type StoredStateV1 } from './schema';
import type { SyncMeta } from './sync/types';
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
      expect(saved).toEqual({ ok: true, error: null, via: 'localstorage', mirrorError: null });

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

    /**
     * **Le plantage du 23/09/2026 en production**, sur la liste des trades : `ui.tradeFilter`
     * manquait à l'état chargé, et l'écran lisait `.query` dessus. L'instantané IndexedDB — la voie
     * PRINCIPALE — était rendu tel quel, sans les valeurs par défaut ni l'assainissement que le
     * miroir `localStorage` et l'état scellé recevaient, eux, par `migrateState`.
     */
    it('instantané d’une version antérieure : les clés ajoutées depuis sont complétées', async () => {
      const storage = memoryStorage();
      const older = emptyState();
      // Un état écrit avant que ces réglages n'existent : la forme exacte d'une sauvegarde d'hier.
      const ui = older.ui as unknown as Record<string, unknown>;
      delete ui['tradeFilter'];
      delete ui['breakevenSizes'];
      await idbSaveSnapshot({ state: older, savedAt: '2026-09-23T10:00:00.000Z' });

      const loaded = await loadPersistedState(storage);
      expect(loaded.source).toBe('indexeddb');
      expect(loaded.status).toBe('ok');
      expect(loaded.state.ui.tradeFilter).toEqual(EMPTY_FILTER);
      expect(loaded.state.ui.breakevenSizes).toEqual({});
    });

    /**
     * Le même oubli, généralisé : demain une autre clé sera ajoutée aux réglages. Ce test n'en
     * nomme aucune — il les DÉRIVE des valeurs par défaut — pour que l'oubli du 23/09 ne puisse
     * pas revenir sous un autre nom.
     */
    it('un ui vidé de toutes ses clés les retrouve toutes', async () => {
      const storage = memoryStorage();
      const older = emptyState();
      (older as unknown as Record<string, unknown>)['ui'] = {};
      await idbSaveSnapshot({ state: older, savedAt: '2026-09-23T10:00:00.000Z' });

      const loaded = await loadPersistedState(storage);
      expect(loaded.status).toBe('ok');
      const missing = Object.keys(DEFAULT_UI_SETTINGS).filter((key) => !(key in loaded.state.ui));
      expect(missing, 'clés de réglages perdues au chargement').toEqual([]);
    });

    /**
     * La porte qu'on ajoute **écarte ce qu'elle ne connaît pas** : il fallait donc vérifier ce que
     * la fusion multi-appareils dépose dans l'état (décision n° 182). Sans cette assertion, un
     * remaniement de l'assainissement remettrait toutes les entrées à « héritée » en silence, et
     * les fusions entre appareils se dégraderaient sans que rien ne rougisse.
     */
    it('les métadonnées de synchronisation traversent la nouvelle porte', async () => {
      const storage = memoryStorage();
      const state = emptyState();
      const clock = '1758636000000.0001.appareil-a';
      const meta: SyncMeta = { v: 1, clock, versions: { manualEvents: { evt: { t: clock } } } };
      state.sync = meta;
      await idbSaveSnapshot({ state, savedAt: '2026-09-23T10:00:00.000Z' });

      const loaded = await loadPersistedState(storage);
      expect(loaded.status).toBe('ok');
      expect(loaded.state.sync).toEqual(meta);
    });

    /**
     * L'autre moitié du même oubli : sans `migrateState`, un instantané venu d'une version plus
     * récente était chargé **tel quel**, avec des formes que le programme ne connaît pas. Les deux
     * autres portes le refusent depuis toujours, avec le message que les écrans savent afficher.
     */
    it('instantané d’une version plus récente : refusé ici comme partout ailleurs', async () => {
      const storage = memoryStorage();
      const future = { ...emptyState(), schemaVersion: 99 } as unknown as StoredStateV1;
      await idbSaveSnapshot({ state: future, savedAt: '2026-09-23T10:00:00.000Z' });

      const loaded = await loadPersistedState(storage);
      expect(loaded.status).toBe('corrupt');
      expect((loaded as { error?: string }).error).toContain('99');
    });
  });

  describe('savePersistedState', () => {
    /**
     * Ce cas gravait le silence : son `toEqual` exact exigeait que l'échec du miroir ne laisse
     * aucune trace. Il exige désormais l'inverse (décision n° 79) — l'enregistrement réussit, et
     * l'échec du **repli** est rapporté.
     */
    it('miroir en échec (quota), IndexedDB ok => ok:true, mais l’échec du miroir est rapporté', async () => {
      const storage = quotaExceededStorage();
      const state = emptyState();
      state.rawRows['a'] = row('a');

      const result = await savePersistedState(state, '2026-08-23T10:00:00.000Z', storage);
      expect(result.ok, 'IndexedDB a réussi : rien n’est perdu').toBe(true);
      expect(result.via).toBe('indexeddb');
      expect(result.error, 'l’enregistrement lui-même n’a pas échoué').toBeNull();
      expect(result.mirrorError, 'l’échec du miroir doit être visible').toMatch(/enregistrer/i);

      const snapshot = await idbLoadSnapshot();
      expect(snapshot?.kind).toBeUndefined();
      expect(snapshot && 'state' in snapshot ? snapshot.state : null).toEqual(state);
    });

    it('les deux réussissent => aucune erreur de miroir', async () => {
      const storage = memoryStorage();
      const state = emptyState();
      state.rawRows['a'] = row('a');

      const result = await savePersistedState(state, '2026-08-23T10:00:00.000Z', storage);
      expect(result.ok).toBe(true);
      // Sans ce cas, un `mirrorError` toujours plein passerait le test précédent sans rien prouver.
      expect(result.mirrorError).toBeNull();
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
