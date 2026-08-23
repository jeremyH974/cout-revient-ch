import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawCoinhouseRow } from '../domain/types';
import {
  idbClearSnapshot,
  idbLoadSnapshot,
  idbMetaDelete,
  idbMetaGet,
  idbMetaSet,
  idbSaveSnapshot,
  isIndexedDbAvailable,
  resetIdbStateStoreForTests,
  type StateSnapshot,
} from './idb-state-store';
import { emptyState } from './schema';

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

// Un `IDBFactory` frais par test (plutôt que `fake-indexeddb/auto`, qui poserait un global partagé)
// donne une base vide à chaque fois ; `resetIdbStateStoreForTests` oublie la connexion mise en cache
// par le module, sans quoi il rouvrirait la base du test précédent. L'isolation par fichier de test
// de Vitest (`isolate: true`) garantit que ce stub n'affecte pas les autres fichiers : voir
// `src/lib/history/cache.test.ts`, qui vérifie qu'aucun `indexedDB` global n'existe sous Node.
describe('idb-state-store', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    resetIdbStateStoreForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('isIndexedDbAvailable : true avec le stub, false sans', () => {
    expect(isIndexedDbAvailable()).toBe(true);
    vi.stubGlobal('indexedDB', undefined);
    expect(isIndexedDbAvailable()).toBe(false);
  });

  it('idbSaveSnapshot puis idbLoadSnapshot : aller-retour, absent avant la première écriture', async () => {
    expect(await idbLoadSnapshot()).toBeNull();
    const state = emptyState();
    state.rawRows['a'] = row('a');
    const snapshot: StateSnapshot = { state, savedAt: '2026-08-23T10:00:00.000Z' };
    await idbSaveSnapshot(snapshot);
    expect(await idbLoadSnapshot()).toEqual(snapshot);
  });

  it('idbSaveSnapshot : un second enregistrement écrase le précédent (clé unique v1)', async () => {
    await idbSaveSnapshot({ state: emptyState(), savedAt: '2026-08-23T10:00:00.000Z' });
    const state = emptyState();
    state.rawRows['b'] = row('b');
    const second: StateSnapshot = { state, savedAt: '2026-08-23T11:00:00.000Z' };
    await idbSaveSnapshot(second);
    expect(await idbLoadSnapshot()).toEqual(second);
  });

  it('idbClearSnapshot : renvoie null ensuite', async () => {
    await idbSaveSnapshot({ state: emptyState(), savedAt: '2026-08-23T10:00:00.000Z' });
    await idbClearSnapshot();
    expect(await idbLoadSnapshot()).toBeNull();
  });

  it('idbMetaGet/Set/Delete : absent, présent après écriture, absent après suppression', async () => {
    expect(await idbMetaGet('handle')).toBeUndefined();
    await idbMetaSet('handle', { name: 'dossier' });
    expect(await idbMetaGet('handle')).toEqual({ name: 'dossier' });
    await idbMetaDelete('handle');
    expect(await idbMetaGet('handle')).toBeUndefined();
  });
});
