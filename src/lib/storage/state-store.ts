/**
 * Persistance de l'état principal : IndexedDB en source principale (sans plafond de 5 Mo), miroir
 * localStorage (format v1 inchangé) écrit à chaque enregistrement et en **synchrone** à la fermeture
 * de la page — seule écriture garantie quand iOS gèle l'onglet. Au chargement, l'instantané le plus
 * récent gagne (`savedAt`) ; à égalité le miroir, ce qui couvre la migration v1 → IndexedDB et les
 * états déposés directement dans localStorage (tests, restauration manuelle).
 *
 * ## Quand le coffre est ouvert
 *
 * Rien de la mécanique ci-dessus ne change : mêmes clés, même arbitrage, mêmes deux emplacements.
 * Seul le **contenu** change — les deux reçoivent du chiffré au lieu du clair. C'est délibéré : un
 * second chemin de persistance réservé au mode chiffré aurait doublé la surface de l'endroit où
 * cette application peut perdre des données.
 *
 * Une conséquence, elle, est irréductible et doit être dite : **sceller est asynchrone**
 * (`crypto.subtle` l'est), alors que le miroir de fermeture est **synchrone** par nécessité. Le
 * miroir ne peut donc pas écrire l'état qu'on lui tend à la fermeture ; il réécrit le **dernier
 * état scellé**, celui de l'enregistrement précédent. Il peut donc retarder d'une fenêtre de
 * debounce (300 ms).
 *
 * Ce retard est acceptable, et seulement parce que : IndexedDB reste la source principale et reçoit
 * bien l'état le plus récent ; le miroir n'est un recours que dans le cas « l'écriture asynchrone
 * n'a jamais abouti » (onglet gelé par iOS), qui ne concerne pas la variante locale sur ordinateur.
 *
 * Le piège à ne pas reproduire : le miroir réécrit aussi le `savedAt` **du scellement**, pas celui
 * qu'on lui passe. Écrire l'horodatage du moment ferait gagner au miroir l'arbitrage du prochain
 * chargement — avec un état plus ancien. Il se déclarerait le plus récent en étant le plus vieux.
 */
import {
  idbClearSnapshot,
  idbLoadSnapshot,
  idbSaveSnapshot,
  isIndexedDbAvailable,
} from './idb-state-store';
import {
  STORAGE_KEY,
  clearState as clearLocal,
  loadState as loadLocal,
  saveSealed,
  saveState as saveLocal,
  type LoadResult,
  type SaveResult,
} from './local-storage';
import { migrateState } from './migrations';
import { emptyState, type StoredStateV1 } from './schema';
import { decodeSealed, encodeSealed, seal, unseal, type SealedBlob } from './vault';
import { isVaultInstalled, vaultKey } from './vault-session';

export const SAVED_AT_KEY = `${STORAGE_KEY}.savedAt`;

export type PersistedSource = 'indexeddb' | 'localstorage';

/**
 * Chargement possible d'un état, plus l'état « fermé » : des données existent, elles sont
 * chiffrées, et aucune clé n'est armée. Ce n'est ni une erreur ni un état vide — les confondre
 * ferait démarrer l'application sur du vide, et la première sauvegarde écraserait les données.
 */
export type LoadedState = (LoadResult | { status: 'locked'; state: StoredStateV1 }) & {
  source: PersistedSource;
};

/** Horodatage du miroir ; vide avant la première écriture par cette version (migration v1). */
const localSavedAt = (storage: Storage): string => storage.getItem(SAVED_AT_KEY) ?? '';

/**
 * Dernier état scellé, gardé pour l'écriture synchrone de fermeture. Le texte ET son horodatage :
 * voir l'en-tête de ce fichier pour la raison, qui est un piège d'arbitrage, pas un détail.
 */
let lastSealed: { text: string; savedAt: string } | null = null;

/** Tests : oublie le dernier scellement (le module survit d'un test à l'autre). */
export function resetSealedMirrorForTests(): void {
  lastSealed = null;
}

/** Refus commun : coffre installé, mais fermé. Écrire en clair serait pire que ne rien écrire. */
const LOCKED_MESSAGE = "Coffre fermé : rien n'est enregistré tant qu'il n'est pas ouvert.";
const REFUSE_CLEAR: SaveResult = { ok: false, error: LOCKED_MESSAGE };

const withSavedAt = (storage: Storage, savedAt: string): void => {
  try {
    storage.setItem(SAVED_AT_KEY, savedAt);
  } catch {
    /* quota : le miroir reste sans horodatage, IndexedDB fait foi */
  }
};

/** Miroir localStorage synchrone ; un échec (quota) n'est pas une erreur tant qu'IndexedDB a réussi. */
export function mirrorStateSync(
  state: StoredStateV1,
  savedAt: string,
  storage: Storage = localStorage,
): SaveResult {
  if (vaultKey() === null && isVaultInstalled()) return REFUSE_CLEAR;
  if (vaultKey() !== null) {
    if (lastSealed === null) {
      return { ok: false, error: "Coffre ouvert : aucun état n'a encore été scellé." };
    }
    const result = saveSealed(lastSealed.text, storage);
    if (result.ok) withSavedAt(storage, lastSealed.savedAt);
    return result;
  }
  const result = saveLocal(state, storage);
  if (result.ok) withSavedAt(storage, savedAt);
  return result;
}

/** Ouvre un bloc scellé et le fait passer par les migrations, comme n'importe quel état relu. */
async function openSealedState(
  blob: SealedBlob,
  source: PersistedSource,
): Promise<LoadedState | null> {
  const key = vaultKey();
  if (key === null) return { status: 'locked', state: emptyState(), source };
  try {
    const json = await unseal(key, blob);
    const migrated = migrateState(JSON.parse(json));
    return migrated.ok
      ? { status: 'ok', state: migrated.state, source }
      : { status: 'corrupt', state: emptyState(), error: migrated.error, raw: '', source };
  } catch (error) {
    /*
     * `raw` reste vide : conserver le chiffré illisible ne rendrait service à personne — il ne peut
     * ni se relire ni se réparer à la main — et en recopierait un exemplaire de plus.
     */
    return { status: 'corrupt', state: emptyState(), error: String(error), raw: '', source };
  }
}

/** Le miroir, éventuellement scellé. `null` quand il n'a rien à dire (bloc illisible). */
async function fromLocal(local: LoadResult, storage: Storage): Promise<LoadedState> {
  if (local.status !== 'sealed') return { ...local, source: 'localstorage' };
  const blob = decodeSealed(local.raw);
  if (blob === null) {
    return {
      status: 'corrupt',
      state: emptyState(),
      error: 'Miroir chiffré illisible.',
      raw: '',
      source: 'localstorage',
    };
  }
  void storage;
  return (await openSealedState(blob, 'localstorage')) ?? { ...local, source: 'localstorage' };
}

export async function loadPersistedState(storage: Storage = localStorage): Promise<LoadedState> {
  const local = loadLocal(storage);
  if (!isIndexedDbAvailable()) return fromLocal(local, storage);
  const snapshot = await idbLoadSnapshot().catch(() => null);
  if (!snapshot) return fromLocal(local, storage);
  // Règle d'arbitrage inchangée ; « scellé » y compte comme un miroir lisible, à égalité avec « ok ».
  const mirrorUsable = local.status === 'ok' || local.status === 'sealed';
  if (mirrorUsable && localSavedAt(storage) >= snapshot.savedAt) return fromLocal(local, storage);
  if (snapshot.kind === 'sealed') {
    return (await openSealedState(snapshot.sealed, 'indexeddb')) ?? fromLocal(local, storage);
  }
  return { status: 'ok', state: snapshot.state, source: 'indexeddb' };
}

export interface PersistResult {
  ok: boolean;
  error: string | null;
  via: PersistedSource | null;
  /**
   * Échec du miroir alors que l'enregistrement, lui, a réussi — donc **non bloquant**.
   *
   * À ne pas confondre avec `error`, qui dit « rien n'a été enregistré ». Celui-ci dit
   * « l'enregistrement a réussi, mais le **repli** est hors service » : `loadPersistedState` se
   * rabat sur le miroir dès qu'`idbLoadSnapshot()` rend `null` — base évincée, navigation privée,
   * quota IndexedDB — et il ramènerait alors un état d'avant le premier échec. Le jour où il sert,
   * il ne vaudrait rien. D'où le voyant d'auto-vérification (décision n° 79) : rien n'est perdu, et
   * c'est précisément pour cela qu'il faut le dire avant que quelque chose le soit.
   */
  mirrorError: string | null;
}

/** IndexedDB puis miroir ; `ok` dès qu'un des deux a réussi. */
export async function savePersistedState(
  state: StoredStateV1,
  savedAt: string,
  storage: Storage = localStorage,
): Promise<PersistResult> {
  const key = vaultKey();
  /*
   * Coffre installé mais refermé : on n'écrit RIEN. Le seul autre chemin possible serait d'écrire
   * en clair — c'est-à-dire de déposer le patrimoine en clair à l'instant exact où l'utilisateur
   * vient de verrouiller. Une sauvegarde en attente au moment du verrouillage suffirait.
   */
  if (key === null && isVaultInstalled()) {
    return { ok: false, error: LOCKED_MESSAGE, via: null, mirrorError: null };
  }
  let sealed: SealedBlob | null = null;
  if (key !== null) {
    try {
      sealed = await seal(key, JSON.stringify(state));
      lastSealed = { text: encodeSealed(sealed), savedAt };
    } catch (error) {
      /*
       * Sceller a échoué : on n'écrit RIEN. Retomber sur l'écriture en clair écrirait le patrimoine
       * en clair à l'endroit exact que le coffre est censé protéger, et personne ne le verrait.
       */
      return {
        ok: false,
        error: `Chiffrement impossible : ${String(error)}`,
        via: null,
        mirrorError: null,
      };
    }
  }

  let idbError: string | null = null;
  let viaIdb = false;
  if (isIndexedDbAvailable()) {
    try {
      await idbSaveSnapshot(sealed ? { kind: 'sealed', sealed, savedAt } : { state, savedAt });
      viaIdb = true;
    } catch (error) {
      idbError = `IndexedDB : ${String(error)}`;
    }
  }

  const mirror = sealed ? saveSealed(lastSealed!.text, storage) : saveLocal(state, storage);
  if (mirror.ok) withSavedAt(storage, savedAt);
  const mirrorError = mirror.ok ? null : mirror.error;
  if (viaIdb) return { ok: true, error: null, via: 'indexeddb', mirrorError };
  if (mirror.ok) return { ok: true, error: null, via: 'localstorage', mirrorError: null };
  return {
    ok: false,
    error: idbError ? `${idbError} ; ${mirror.error}` : mirror.error,
    via: null,
    mirrorError,
  };
}

export async function clearPersistedState(storage: Storage = localStorage): Promise<void> {
  clearLocal(storage);
  lastSealed = null;
  try {
    storage.removeItem(SAVED_AT_KEY);
  } catch {
    /* rien à faire */
  }
  if (isIndexedDbAvailable()) {
    try {
      await idbClearSnapshot();
    } catch {
      /* la base sera écrasée au prochain enregistrement */
    }
  }
}
