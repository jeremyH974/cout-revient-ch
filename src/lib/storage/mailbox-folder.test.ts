/**
 * `mailbox-folder.ts` : la persistance (méta IndexedDB, même patron que `device-id.test.ts`) et
 * `RealMailboxFolder` contre un FAUX `FileSystemDirectoryHandle` — cette API n'existe pas sous
 * Node, donc aucun test ici ne peut passer par un VRAI dossier (voir `tests/e2e` pour ça, via
 * l'injection OPFS). Le faux handle n'implémente que ce que `RealMailboxFolder` appelle réellement
 * ; le cast `as unknown as FileSystemDirectoryHandle` est local à ce fichier et volontaire.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdbStateStoreForTests } from './idb-state-store';
import {
  RealMailboxFolder,
  chooseMailboxFolder,
  forgetMailboxFolder,
  isMailboxFolderSupported,
  loadMailboxFolder,
  loadMailboxPeerSeqs,
  loadOrCreateMailboxSalt,
  nextMailboxSeq,
  queryMailboxFolderPermission,
  requestMailboxFolderPermission,
  saveMailboxPeerSeqs,
} from './mailbox-folder';
import { KDF_SALT_BYTES } from './kdf';

describe('méta persistées (IndexedDB)', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    resetIdbStateStoreForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('loadOrCreateMailboxSalt', () => {
    it('première lecture : crée un sel de 16 octets, le persiste', async () => {
      const salt = await loadOrCreateMailboxSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(KDF_SALT_BYTES);
    });

    it('lectures suivantes : renvoie TOUJOURS le même sel', async () => {
      const first = await loadOrCreateMailboxSalt();
      const second = await loadOrCreateMailboxSalt();
      expect(second).toEqual(first);
    });

    it("IndexedDB indisponible : renvoie tout de même un sel, jamais d'exception", async () => {
      vi.stubGlobal('indexedDB', undefined);
      const salt = await loadOrCreateMailboxSalt();
      expect(salt.length).toBe(KDF_SALT_BYTES);
    });
  });

  describe('nextMailboxSeq', () => {
    it('compte à partir de 1, persiste immédiatement, jamais deux fois le même numéro', async () => {
      expect(await nextMailboxSeq()).toBe(1);
      expect(await nextMailboxSeq()).toBe(2);
      expect(await nextMailboxSeq()).toBe(3);
    });

    it('survit à un rechargement (nouvelle lecture depuis la même base)', async () => {
      await nextMailboxSeq();
      await nextMailboxSeq();
      resetIdbStateStoreForTests(); // simule une nouvelle session sur la MÊME base IndexedDB
      expect(await nextMailboxSeq()).toBe(3);
    });
  });

  describe('peer seqs', () => {
    it('vide par défaut, puis round-trip', async () => {
      expect(await loadMailboxPeerSeqs()).toEqual({});
      await saveMailboxPeerSeqs({ 'device-a': 3, 'device-b': 1 });
      expect(await loadMailboxPeerSeqs()).toEqual({ 'device-a': 3, 'device-b': 1 });
    });
  });

  describe('dossier', () => {
    /** Un `FileSystemDirectoryHandle` suffisamment vrai pour IndexedDB (structuré-clonable). */
    const fakeHandle = {
      kind: 'directory',
      name: 'MonDossier',
    } as unknown as FileSystemDirectoryHandle;

    it('aucun dossier choisi : renvoie null', async () => {
      expect(await loadMailboxFolder()).toBeNull();
    });

    it("choisir via l'injection de test (handleOverride) : persiste, relit", async () => {
      const chosen = await chooseMailboxFolder(fakeHandle);
      expect(chosen).toBe(fakeHandle);
      const reloaded = await loadMailboxFolder();
      expect(reloaded).toEqual(fakeHandle);
    });

    it('sans sélecteur natif ET sans handleOverride : renvoie null', async () => {
      // `window` existe toujours dans un vrai navigateur ; seul `showDirectoryPicker` peut manquer
      // (Safari, Firefox). `vi.stubGlobal` reproduit cette forme plutôt qu'un `window` absent, que
      // seul l'environnement `node` de Vitest connaît. Le `beforeEach` du bloc englobant a déjà posé
      // `indexedDB` : ce stub s'ajoute, il ne le remplace pas.
      vi.stubGlobal('window', {});
      expect(await chooseMailboxFolder()).toBeNull();
    });

    it('oublier le dossier : la lecture suivante renvoie de nouveau null', async () => {
      await chooseMailboxFolder(fakeHandle);
      await forgetMailboxFolder();
      expect(await loadMailboxFolder()).toBeNull();
    });
  });
});

describe('isMailboxFolderSupported', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('faux quand `showDirectoryPicker` est absent (Node, Safari, Firefox)', () => {
    expect(isMailboxFolderSupported()).toBe(false);
  });

  it('vrai quand le sélecteur existe (Chrome/Edge de bureau)', () => {
    vi.stubGlobal('window', { showDirectoryPicker: async () => null });
    expect(isMailboxFolderSupported()).toBe(true);
  });
});

describe('chooseMailboxFolder : sélecteur natif', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("l'utilisateur annule (AbortError) : renvoie null, ne lève pas", async () => {
    vi.stubGlobal('window', {
      showDirectoryPicker: async () => {
        throw new DOMException('annulé', 'AbortError');
      },
    });
    expect(await chooseMailboxFolder()).toBeNull();
  });

  it('une autre erreur du sélecteur est propagée', async () => {
    vi.stubGlobal('window', {
      showDirectoryPicker: async () => {
        throw new Error('boom');
      },
    });
    await expect(chooseMailboxFolder()).rejects.toThrow('boom');
  });
});

describe('permission', () => {
  it('queryPermission/requestPermission absents (hors Chrome) : « prompt », jamais une exception', async () => {
    // `h.requestPermission?.(...)` ne LÈVE pas quand la méthode manque (chaînage optionnel) : il
    // résout `undefined`, que `toPermission` range dans « prompt » — le même repli que la lecture.
    // Seule une méthode qui EXISTE mais REJETTE (voir `queryMailboxFolderPermission` ci-dessous
    // pour son propre `catch`) retomberait différemment.
    const handle = {} as unknown as FileSystemDirectoryHandle;
    expect(await queryMailboxFolderPermission(handle)).toBe('prompt');
    expect(await requestMailboxFolderPermission(handle)).toBe('prompt');
  });

  it('la méthode existe mais REJETTE : repli « denied » pour la demande, « prompt » pour la lecture', async () => {
    const handle = {
      queryPermission: async () => {
        throw new Error('refusé par le navigateur');
      },
      requestPermission: async () => {
        throw new Error('refusé par le navigateur');
      },
    } as unknown as FileSystemDirectoryHandle;
    expect(await queryMailboxFolderPermission(handle)).toBe('prompt');
    expect(await requestMailboxFolderPermission(handle)).toBe('denied');
  });

  it('relaie fidèlement granted/denied/prompt', async () => {
    const handle = {
      queryPermission: async () => 'granted' as PermissionState,
      requestPermission: async () => 'denied' as PermissionState,
    } as unknown as FileSystemDirectoryHandle;
    expect(await queryMailboxFolderPermission(handle)).toBe('granted');
    expect(await requestMailboxFolderPermission(handle)).toBe('denied');
  });
});

// --- RealMailboxFolder contre un faux FileSystemDirectoryHandle --------------------------------

/** Assez de surface pour `RealMailboxFolder`, rien de plus — voir l'en-tête du fichier. */
function fakeDirectoryHandle(initial: Record<string, string> = {}): {
  handle: FileSystemDirectoryHandle;
  files: Map<string, string>;
} {
  const files = new Map(Object.entries(initial));
  const dir = {
    kind: 'directory',
    name: 'fake',
    values: () =>
      (async function* () {
        for (const name of files.keys()) yield { kind: 'file', name };
      })(),
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (opts?.create) files.set(name, '');
        else throw new DOMException('introuvable', 'NotFoundError');
      }
      return {
        getFile: async () => ({ text: async () => files.get(name)! }) as unknown as File,
        createWritable: async () => ({
          write: async (text: string) => {
            files.set(name, text);
          },
          close: async () => {},
        }),
      };
    },
    removeEntry: async (name: string) => {
      if (!files.has(name)) throw new DOMException('introuvable', 'NotFoundError');
      files.delete(name);
    },
  };
  return { handle: dir as unknown as FileSystemDirectoryHandle, files };
}

describe('RealMailboxFolder', () => {
  it('list : ne renvoie que les fichiers', async () => {
    const { handle } = fakeDirectoryHandle({ 'a.txt': '1', 'b.txt': '2' });
    const folder = new RealMailboxFolder(handle);
    expect((await folder.list()).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('read : renvoie le contenu ; null si absent, jamais une exception', async () => {
    const { handle } = fakeDirectoryHandle({ 'a.txt': 'contenu' });
    const folder = new RealMailboxFolder(handle);
    expect(await folder.read('a.txt')).toBe('contenu');
    expect(await folder.read('absent.txt')).toBeNull();
  });

  it('write : crée un NOUVEAU fichier, relisible ensuite', async () => {
    const { handle, files } = fakeDirectoryHandle();
    const folder = new RealMailboxFolder(handle);
    await folder.write('nouveau.txt', 'salut');
    expect(files.get('nouveau.txt')).toBe('salut');
    expect(await folder.read('nouveau.txt')).toBe('salut');
  });

  it('remove : supprime ; propage une erreur sur un nom absent (l’appelant décide d’ignorer)', async () => {
    const { handle, files } = fakeDirectoryHandle({ 'a.txt': '1' });
    const folder = new RealMailboxFolder(handle);
    await folder.remove('a.txt');
    expect(files.has('a.txt')).toBe(false);
    await expect(folder.remove('a.txt')).rejects.toThrow();
  });
});
