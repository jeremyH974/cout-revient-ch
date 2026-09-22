import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOrCreateDeviceId } from './device-id';
import { resetIdbStateStoreForTests } from './idb-state-store';

// Même patron que `idb-state-store.test.ts` : un `IDBFactory` frais par test, jamais le global
// partagé de `fake-indexeddb/auto`.
describe('device-id', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    resetIdbStateStoreForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('première lecture : crée un identifiant, le persiste', async () => {
    const id = await loadOrCreateDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('lectures suivantes : renvoie TOUJOURS le même identifiant (persistant sur cet appareil)', async () => {
    const first = await loadOrCreateDeviceId();
    const second = await loadOrCreateDeviceId();
    const third = await loadOrCreateDeviceId();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('deux bases différentes (deux origines) obtiennent chacune le LEUR', async () => {
    const a = await loadOrCreateDeviceId();
    vi.stubGlobal('indexedDB', new IDBFactory());
    resetIdbStateStoreForTests();
    const b = await loadOrCreateDeviceId();
    expect(b).not.toBe(a);
  });

  it("IndexedDB indisponible : renvoie tout de même un identifiant, jamais d'exception", async () => {
    vi.stubGlobal('indexedDB', undefined);
    const id = await loadOrCreateDeviceId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});
