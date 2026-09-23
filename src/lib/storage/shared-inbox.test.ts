/**
 * Côté page de la réception Android : une base IndexedDB fraîche par test (même patron que
 * `idb-state-store.test.ts`), puisque `public/sw-share-target.js` (non exécutable ici, c'est un
 * script de service worker brut) est simulé en semant directement l'emplacement qu'il écrirait.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasSharedFile,
  isSharedInboxSupported,
  putSharedInboxEntryForTests,
  resetSharedInboxForTests,
  takeSharedFile,
} from './shared-inbox';

describe('shared-inbox', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    resetSharedInboxForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rien en attente : takeSharedFile() rend null, hasSharedFile() rend false', async () => {
    expect(await hasSharedFile()).toBe(false);
    expect(await takeSharedFile()).toBeNull();
  });

  it('récupère puis efface : un second appel ne revoit plus le même fichier', async () => {
    await putSharedInboxEntryForTests({
      text: '{"kind":"mailbox"}',
      receivedAt: '2026-09-22T10:00:00.000Z',
      name: 'cout-revient-ch-sync-abcd1234-000001.txt',
      type: 'text/plain',
    });
    expect(await hasSharedFile()).toBe(true);

    const first = await takeSharedFile();
    expect(first).toEqual({
      text: '{"kind":"mailbox"}',
      receivedAt: '2026-09-22T10:00:00.000Z',
      name: 'cout-revient-ch-sync-abcd1234-000001.txt',
      type: 'text/plain',
    });

    expect(await hasSharedFile()).toBe(false);
    expect(await takeSharedFile()).toBeNull();
  });

  it('name/type absents (partage sans nom annoncé) : null accepté, jamais rejeté', async () => {
    await putSharedInboxEntryForTests({
      text: '{}',
      receivedAt: '2026-09-22T10:00:00.000Z',
      name: null,
      type: null,
    });
    expect(await takeSharedFile()).toEqual({
      text: '{}',
      receivedAt: '2026-09-22T10:00:00.000Z',
      name: null,
      type: null,
    });
  });

  it('valeur malformée (base partagée avec un service worker, jamais supposée bien formée) : rend null, et consomme quand même l’emplacement', async () => {
    await putSharedInboxEntryForTests({ surprise: true });
    expect(await takeSharedFile()).toBeNull();
    // L'emplacement a été vidé même si son contenu était illisible : pas de blocage permanent.
    expect(await hasSharedFile()).toBe(false);
  });

  it('isSharedInboxSupported() constate la présence de indexedDB', () => {
    expect(isSharedInboxSupported()).toBe(true);
    vi.stubGlobal('indexedDB', undefined);
    expect(isSharedInboxSupported()).toBe(false);
  });
});
