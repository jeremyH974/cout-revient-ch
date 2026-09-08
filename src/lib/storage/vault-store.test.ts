/**
 * Le coffre branché sur la persistance réelle — IndexedDB simulée et miroir localStorage.
 *
 * `vault.test.ts` éprouve la cryptographie ; celui-ci éprouve le **câblage**, qui est l'endroit où
 * un coffre correct peut encore laisser fuir du clair ou détruire des données.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawCoinhouseRow } from '../domain/types';
import { idbLoadSnapshot, resetIdbStateStoreForTests } from './idb-state-store';
import { STORAGE_KEY } from './local-storage';
import { emptyState, type StoredStateV1 } from './schema';
import {
  SAVED_AT_KEY,
  loadPersistedState,
  mirrorStateSync,
  resetSealedMirrorForTests,
  savePersistedState,
} from './state-store';
import { createVault, decodeSealed, unlockVault, unseal, type VaultKdfParams } from './vault';
import { armVault, disarmVault, resetVaultSessionForTests } from './vault-session';

const FAST: VaultKdfParams = { m: 256, t: 1, p: 1 };

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

/** Une ligne reconnaissable : c'est elle qu'on cherchera, en clair, là où elle ne doit pas être. */
function stateWithSecret(): StoredStateV1 {
  const state = emptyState();
  const raw: RawCoinhouseRow = {
    key: 'MARQUEUR-SECRET',
    importId: 'imp',
    lineNo: 2,
    id: 'MARQUEUR-SECRET',
    at: '2026-01-01T10:00:00',
    type: 'Echange',
    qty: '13.37',
    asset: 'btc',
    marketPrice: null,
    valueEur: '424242.42',
    feeAsset: null,
    feeEur: null,
    feeRebate: null,
    balance: '13.37',
    account: '',
    extra: {},
  };
  state.rawRows['MARQUEUR-SECRET'] = raw;
  return state;
}

/** Ouvre un coffre neuf et l'arme, comme le ferait l'installation depuis les réglages. */
async function openFreshVault(passphrase = 'mot de passe'): Promise<void> {
  const { meta, key } = await createVault(passphrase, { params: FAST });
  armVault(meta, key);
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  resetIdbStateStoreForTests();
  resetVaultSessionForTests();
  resetSealedMirrorForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetVaultSessionForTests();
  resetSealedMirrorForTests();
});

describe('persistance scellée — rien ne reste en clair', () => {
  it("n'écrit le marqueur en clair ni dans IndexedDB ni dans le miroir", async () => {
    const storage = memoryStorage();
    await openFreshVault();

    const result = await savePersistedState(stateWithSecret(), '2026-09-08T10:00:00.000Z', storage);
    expect(result.ok).toBe(true);

    const mirror = storage.getItem(STORAGE_KEY) ?? '';
    expect(mirror).not.toContain('MARQUEUR-SECRET');
    expect(mirror).not.toContain('424242.42');
    expect(mirror.startsWith('crch-sealed.1.')).toBe(true);

    const snapshot = await idbLoadSnapshot();
    expect(snapshot?.kind).toBe('sealed');
    expect(JSON.stringify(snapshot)).not.toContain('MARQUEUR-SECRET');
  });

  it('rend exactement le même état que le chemin en clair, aux migrations près', async () => {
    /*
     * On compare les deux chemins ENTRE EUX, pas au point de départ. Le chemin JSON passe par
     * `migrateState`, qui normalise et complète — c'est déjà vrai du miroir en clair aujourd'hui.
     * Comparer à l'objet de départ ferait donc échouer le test pour une raison sans rapport avec
     * le chiffrement. Ce qui doit être prouvé ici est que sceller n'introduit **aucune**
     * différence de plus que celles que la persistance en clair introduit déjà.
     */
    const clair = memoryStorage();
    await savePersistedState(stateWithSecret(), '2026-09-08T10:00:00.000Z', clair);
    const attendu = await loadPersistedState(clair);

    const scelle = memoryStorage();
    await openFreshVault();
    await savePersistedState(stateWithSecret(), '2026-09-08T10:00:00.000Z', scelle);
    const obtenu = await loadPersistedState(scelle);

    expect(obtenu.status).toBe('ok');
    expect(obtenu.state).toEqual(attendu.state);
    expect(obtenu.state.rawRows['MARQUEUR-SECRET']?.valueEur).toBe('424242.42');
  });

  it('remplace les données déjà écrites en clair au lieu de les laisser derrière', async () => {
    const storage = memoryStorage();
    // Avant le coffre : l'état s'écrit en clair, comme aujourd'hui.
    await savePersistedState(stateWithSecret(), '2026-09-08T09:00:00.000Z', storage);
    expect(storage.getItem(STORAGE_KEY)).toContain('MARQUEUR-SECRET');

    // Installation du coffre, puis premier enregistrement scellé.
    await openFreshVault();
    await savePersistedState(stateWithSecret(), '2026-09-08T10:00:00.000Z', storage);

    expect(storage.getItem(STORAGE_KEY)).not.toContain('MARQUEUR-SECRET');
    const snapshot = await idbLoadSnapshot();
    expect(snapshot?.kind).toBe('sealed');
  });
});

describe('persistance scellée — coffre fermé', () => {
  it('annonce « locked », et surtout ni « empty » ni « corrupt »', async () => {
    const storage = memoryStorage();
    await openFreshVault();
    await savePersistedState(stateWithSecret(), '2026-09-08T10:00:00.000Z', storage);

    // Rechargement de la page : la clé est perdue, l'en-tête et les données restent.
    disarmVault();
    const loaded = await loadPersistedState(storage);

    /*
     * « empty » serait la pire réponse possible : l'application démarrerait sur du vide et la
     * première sauvegarde automatique écraserait les données chiffrées par un état neuf.
     */
    expect(loaded.status).toBe('locked');
  });

  it('reste fermé même quand seul le miroir subsiste (IndexedDB évincée)', async () => {
    const storage = memoryStorage();
    await openFreshVault();
    await savePersistedState(stateWithSecret(), '2026-09-08T10:00:00.000Z', storage);

    // Base perdue : il ne reste que le miroir, scellé.
    vi.stubGlobal('indexedDB', new IDBFactory());
    resetIdbStateStoreForTests();
    disarmVault();

    expect((await loadPersistedState(storage)).status).toBe('locked');
  });

  it("s'ouvre après déverrouillage, sans avoir rien réécrit entre-temps", async () => {
    const storage = memoryStorage();
    const { meta, key } = await createVault('le bon', { params: FAST });
    armVault(meta, key);
    await savePersistedState(stateWithSecret(), '2026-09-08T10:00:00.000Z', storage);
    const sealedBefore = storage.getItem(STORAGE_KEY);

    disarmVault();
    expect((await loadPersistedState(storage)).status).toBe('locked');

    armVault(meta, await unlockVault(meta, 'le bon'));
    const loaded = await loadPersistedState(storage);
    expect(loaded.status).toBe('ok');
    expect(loaded.state.rawRows['MARQUEUR-SECRET']).toBeDefined();
    expect(storage.getItem(STORAGE_KEY), 'la lecture ne réécrit rien').toBe(sealedBefore);
  });

  it("signale « corrupt » quand la clé armée n'est pas celle des données", async () => {
    const storage = memoryStorage();
    await openFreshVault('le bon');
    await savePersistedState(stateWithSecret(), '2026-09-08T10:00:00.000Z', storage);

    // Un autre coffre : clé valide, mais pas la bonne.
    const autre = await createVault('un autre', { params: FAST });
    armVault(autre.meta, autre.key);

    const loaded = await loadPersistedState(storage);
    expect(loaded.status).toBe('corrupt');
    expect(loaded.state.rawRows).toEqual({});
  });
});

describe('persistance scellée — miroir synchrone de fermeture', () => {
  it('écrit le dernier état scellé plutôt que rien, quand on ne peut pas chiffrer à temps', async () => {
    const storage = memoryStorage();
    const { meta, key } = await createVault('le bon', { params: FAST });
    armVault(meta, key);
    await savePersistedState(stateWithSecret(), '2026-09-08T10:00:00.000Z', storage);
    const scelle = storage.getItem(STORAGE_KEY);

    // Fermeture : un état plus récent est présenté, mais sceller demanderait un `await`.
    const plusRecent = stateWithSecret();
    plusRecent.rawRows['MARQUEUR-SECRET']!.qty = '999.999';
    const result = mirrorStateSync(plusRecent, '2026-09-08T11:00:00.000Z', storage);

    expect(result.ok).toBe(true);
    expect(storage.getItem(STORAGE_KEY)).toBe(scelle);

    /*
     * On ouvre réellement le miroir plutôt que d'y chercher une chaîne : du base64 aléatoire
     * contient tôt ou tard n'importe quel court motif, et un tel test échoue une fois sur trois
     * sans rien dire de vrai. Ce qui se vérifie ici, c'est la QUANTITÉ effectivement scellée.
     */
    const blob = decodeSealed(storage.getItem(STORAGE_KEY) ?? '');
    const relu = JSON.parse(await unseal(key, blob!)) as StoredStateV1;
    expect(relu.rawRows['MARQUEUR-SECRET']?.qty).toBe('13.37');
  });

  it("garde l'horodatage DU SCELLEMENT, pour ne pas gagner l'arbitrage avec un état plus vieux", async () => {
    const storage = memoryStorage();
    await openFreshVault();
    await savePersistedState(stateWithSecret(), '2026-09-08T10:00:00.000Z', storage);

    mirrorStateSync(stateWithSecret(), '2026-09-08T23:59:59.000Z', storage);

    /*
     * Si le miroir s'était horodaté à 23:59, il aurait battu l'instantané IndexedDB de 10:00 au
     * prochain chargement — en portant, lui, l'état de 10:00. Le plus vieux se serait déclaré le
     * plus récent, et l'état le plus frais aurait été jeté à chaque démarrage.
     */
    expect(storage.getItem(SAVED_AT_KEY)).toBe('2026-09-08T10:00:00.000Z');
  });

  it("refuse plutôt que de mentir quand rien n'a encore été scellé", async () => {
    const storage = memoryStorage();
    await openFreshVault();
    const result = mirrorStateSync(stateWithSecret(), '2026-09-08T10:00:00.000Z', storage);

    expect(result.ok).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("n'écrit jamais en clair tant que le coffre est armé", async () => {
    const storage = memoryStorage();
    await openFreshVault();
    await savePersistedState(stateWithSecret(), '2026-09-08T10:00:00.000Z', storage);
    mirrorStateSync(stateWithSecret(), '2026-09-08T11:00:00.000Z', storage);

    expect(storage.getItem(STORAGE_KEY)).not.toContain('MARQUEUR-SECRET');
  });
});

describe('persistance scellée — échec du chiffrement', () => {
  it("n'écrit RIEN plutôt que de retomber sur du clair", async () => {
    const storage = memoryStorage();
    await openFreshVault();

    const encrypt = vi
      .spyOn(crypto.subtle, 'encrypt')
      .mockRejectedValue(new Error('panne de crypto (test)'));
    try {
      const result = await savePersistedState(
        stateWithSecret(),
        '2026-09-08T10:00:00.000Z',
        storage,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/chiffrement/i);
    } finally {
      encrypt.mockRestore();
    }

    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(await idbLoadSnapshot()).toBeNull();
  });
});

describe('persistance en clair — inchangée sans coffre', () => {
  it("écrit toujours du JSON lisible quand aucun coffre n'est armé", async () => {
    const storage = memoryStorage();
    await savePersistedState(stateWithSecret(), '2026-09-08T10:00:00.000Z', storage);

    expect(storage.getItem(STORAGE_KEY)).toContain('MARQUEUR-SECRET');
    expect((await loadPersistedState(storage)).status).toBe('ok');
    const snapshot = await idbLoadSnapshot();
    expect(snapshot?.kind).toBeUndefined();
  });
});
