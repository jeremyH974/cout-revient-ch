/**
 * Le coffre : chiffrement de l'état **au repos**, ouvert par un mot de passe.
 *
 * ## Ce qu'il protège, et ce qu'il ne protège pas
 *
 * Jusqu'ici, seule la sauvegarde *exportée* pouvait être chiffrée (`encryption.ts`). L'état vivant,
 * lui, restait en clair dans IndexedDB et dans le miroir `localStorage` : un profil de navigateur
 * copié, un disque non chiffré, une extension lisant le stockage du site, et tout le patrimoine se
 * lisait sans effort. Le coffre ferme ce trou-là — et **seulement** celui-là.
 *
 * Il ne protège pas d'un attaquant présent *pendant* que l'application est déverrouillée : à cet
 * instant l'état est en mémoire, en clair, par nécessité. Le dire est important, parce qu'un coffre
 * dont on surestime la portée est plus dangereux qu'une absence de coffre.
 *
 * ## Pourquoi une clé de données distincte du mot de passe (enveloppe)
 *
 * Le mot de passe ne chiffre **jamais** les données. Il dérive une clé (la KEK) dont le seul rôle
 * est de sceller une seconde clé tirée au hasard (la DEK), et c'est la DEK qui chiffre l'état.
 *
 * Ce détour a une conséquence pratique décisive : **changer de mot de passe ne re-chiffre rien**.
 * On re-scelle 32 octets, et l'état — qui peut peser plusieurs mégaoctets — n'est pas touché. Sans
 * enveloppe, un changement de mot de passe devrait déchiffrer puis re-chiffrer tout l'état, et une
 * interruption au mauvais moment (onglet fermé, batterie) laisserait un état à moitié converti,
 * c'est-à-dire perdu. Ici, l'opération porte sur un seul champ et reste atomique de fait.
 *
 * ## Pourquoi Argon2id, alors que la sauvegarde exportée utilise PBKDF2
 *
 * `encryption.ts` justifiait PBKDF2 par le fait qu'Argon2id « n'existe qu'en WebAssembly ou en JS
 * pur ici — une dépendance de plus dans le chemin critique ». **Ce n'est plus vrai** :
 * `@noble/hashes` est déjà une dépendance de production (dérivation des clés publiques étendues,
 * empreintes des cassettes du banc d'essai) et expose `argon2id` depuis sa version 2. Le coût
 * d'entrée est donc nul, et l'argument tombe.
 *
 * Or la différence est réelle et va dans un seul sens. PBKDF2 n'est coûteux qu'en **temps** : une
 * carte graphique en calcule des milliards en parallèle pour presque rien. Argon2id est coûteux en
 * **mémoire** — 46 Mio par tentative ici — ce qui est précisément ce qu'un attaquant ne peut pas
 * paralléliser à bon marché. Face à la menace visée (un disque ou un profil volé, attaqué hors
 * ligne, sans limite de tentatives), c'est la seule propriété qui compte.
 *
 * Les paramètres sont **écrits dans l'en-tête**, jamais supposés à la lecture : les relever un jour
 * n'invalidera aucun coffre existant, qui continuera de s'ouvrir avec les siens. C'est la seule
 * façon d'être prêt pour le futur sans savoir de quoi il sera fait.
 *
 * ## Aucune récupération
 *
 * Comme pour la sauvegarde chiffrée : l'application ne connaît pas le mot de passe, ne le transmet
 * nulle part, et il n'existe ni compte ni service capable de le réinitialiser. Le perdre revient à
 * perdre les données. C'est le prix du tout-local, sans compte — et c'est pour cela que
 * l'installation du coffre exige une sauvegarde préalable.
 */
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { base64 } from '@scure/base';

/** Coût de la dérivation. Mémoire en kibioctets, itérations, parallélisme. */
export interface VaultKdfParams {
  /** Mémoire en KiB. */
  m: number;
  /** Itérations. */
  t: number;
  /** Voies parallèles. */
  p: number;
}

/**
 * Paramètres par défaut : la première configuration de la fiche OWASP « Password Storage » pour
 * Argon2id — 46 Mio, une itération, une voie.
 *
 * `p: 1` n'est pas une économie : l'implémentation est en JavaScript pur, sur un seul fil. Annoncer
 * `p: 4` coûterait le même temps qu'`p: 1` **chez nous** tout en divisant par quatre le travail
 * qu'un attaquant multi-cœurs doit fournir. Réclamer un parallélisme qu'on n'exécute pas revient à
 * s'affaiblir en croyant se renforcer.
 *
 * Mesuré ici : ~330 ms sur Node 22, quelques centaines de millisecondes de plus dans un navigateur.
 * Payé une fois par ouverture, jamais ensuite.
 */
export const VAULT_KDF: VaultKdfParams = { m: 47_104, t: 1, p: 1 };

/**
 * En-tête du coffre. **Ne contient aucun secret** : le sel et la clé scellée sont inertes sans le
 * mot de passe. Il est donc stocké en clair, à côté des données chiffrées, et c'est normal.
 */
export interface VaultMeta {
  app: 'cout-revient-ch';
  vault: true;
  version: 1;
  kdf: 'argon2id';
  params: VaultKdfParams;
  /** Base64, 16 octets. */
  salt: string;
  /** Base64 : la clé de données, scellée par la clé dérivée du mot de passe. */
  wrappedKey: string;
  /** Base64, 12 octets. */
  wrapIv: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601 du dernier changement de mot de passe ; égal à `createdAt` s'il n'y en a pas eu. */
  rewrappedAt: string;
}

/** Un bloc scellé. Structuré-clonable tel quel : IndexedDB le stocke sans passer par du texte. */
export interface SealedBlob {
  v: 1;
  iv: Uint8Array;
  ct: Uint8Array;
}

const SALT_BYTES = 16;
const IV_BYTES = 12;
const DEK_BYTES = 32;
const AES = 'AES-GCM';

/**
 * Message unique pour « mauvais mot de passe » et « données altérées ». AES-GCM échoue de la même
 * façon dans les deux cas, et distinguer les deux renseignerait un attaquant sans jamais aider
 * l'utilisateur, qui n'a de toute façon qu'une action possible : réessayer.
 */
export const VAULT_LOCKED_ERROR = 'Mot de passe incorrect, ou données altérées.';

/**
 * `crypto.subtle` refuse les vues sur `SharedArrayBuffer`, que `Uint8Array` nu recouvre depuis
 * TS 5.7. Cette copie rend le type exact — et détache au passage les octets rendus par noble, qui
 * peuvent être une vue sur un tampon plus large.
 */
function bytes(source: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(source.length);
  copy.set(source);
  return copy;
}

const random = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(n));

/** Décode du base64 ; rend `null` plutôt que de lever, un en-tête pouvant être corrompu. */
function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return bytes(base64.decode(text));
  } catch {
    return null;
  }
}

/** Dérive la clé de scellement (KEK) depuis le mot de passe. Jamais elle ne chiffre les données. */
async function deriveKek(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  params: VaultKdfParams,
  onProgress?: (fraction: number) => void,
): Promise<CryptoKey> {
  const raw = await argon2idAsync(new TextEncoder().encode(passphrase), salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: DEK_BYTES,
    /*
     * Rend la main à l'ordonnanceur toutes les 100 ms : l'interface reste vivante (un rendu par
     * dixième de seconde suffit à une barre de progression) sans payer une reprise de tâche toutes
     * les 10 ms. Mesuré : la dérivation coûte ~250 ms sous Node et quelques secondes dans un
     * navigateur, où l'allocation des 46 Mio pèse bien plus lourd qu'en heap fraîche. Un `tick`
     * court multipliait ce coût quand l'onglet passait en arrière-plan, où les minuteurs sont
     * bridés à la seconde.
     */
    asyncTick: 100,
    ...(onProgress ? { onProgress } : {}),
  });
  return crypto.subtle.importKey('raw', bytes(raw), AES, false, ['encrypt', 'decrypt']);
}

/** Importe la clé de données. **Non exportable** : rien ne peut la relire hors de `crypto.subtle`. */
function importDek(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, AES, false, ['encrypt', 'decrypt']);
}

export interface VaultOptions {
  params?: VaultKdfParams;
  now?: () => number;
  onProgress?: (fraction: number) => void;
}

export interface OpenedVault {
  meta: VaultMeta;
  /** La clé de données. Vit en mémoire tant que le coffre est ouvert, et nulle part ailleurs. */
  key: CryptoKey;
}

/**
 * Crée un coffre : tire une clé de données au hasard et la scelle sous le mot de passe.
 *
 * Un mot de passe vide est refusé ici, et non traité comme « pas de coffre » : le refus doit être
 * bruyant au moment où l'on croit poser une protection.
 */
export async function createVault(
  passphrase: string,
  options: VaultOptions = {},
): Promise<OpenedVault> {
  if (passphrase === '') throw new Error('Le mot de passe ne peut pas être vide.');
  const params = options.params ?? VAULT_KDF;
  const at = new Date(options.now?.() ?? Date.now()).toISOString();
  const salt = random(SALT_BYTES);
  const wrapIv = random(IV_BYTES);
  const dek = random(DEK_BYTES);
  const kek = await deriveKek(passphrase, salt, params, options.onProgress);
  const wrapped = await crypto.subtle.encrypt({ name: AES, iv: wrapIv }, kek, dek);
  return {
    meta: {
      app: 'cout-revient-ch',
      vault: true,
      version: 1,
      kdf: 'argon2id',
      params,
      salt: base64.encode(salt),
      wrappedKey: base64.encode(new Uint8Array(wrapped)),
      wrapIv: base64.encode(wrapIv),
      createdAt: at,
      rewrappedAt: at,
    },
    key: await importDek(dek),
  };
}

/** Ouvre un coffre. Lève `VAULT_LOCKED_ERROR` si le mot de passe est faux ou l'en-tête altéré. */
export async function unlockVault(
  meta: VaultMeta,
  passphrase: string,
  options: Pick<VaultOptions, 'onProgress'> = {},
): Promise<CryptoKey> {
  const raw = await unwrapDek(meta, passphrase, options.onProgress);
  return importDek(raw);
}

/** La clé de données en clair, le temps d'un scellement. Isolée pour n'exister qu'ici. */
async function unwrapDek(
  meta: VaultMeta,
  passphrase: string,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  if (passphrase === '') throw new Error(VAULT_LOCKED_ERROR);
  const salt = fromBase64(meta.salt);
  const wrapIv = fromBase64(meta.wrapIv);
  const wrapped = fromBase64(meta.wrappedKey);
  if (!salt || !wrapIv || !wrapped) throw new Error(VAULT_LOCKED_ERROR);
  try {
    const kek = await deriveKek(passphrase, salt, meta.params, onProgress);
    const dek = await crypto.subtle.decrypt({ name: AES, iv: wrapIv }, kek, wrapped);
    return new Uint8Array(dek);
  } catch {
    throw new Error(VAULT_LOCKED_ERROR);
  }
}

/**
 * Change le mot de passe : re-scelle la **même** clé de données sous une nouvelle clé dérivée.
 *
 * Les données chiffrées ne sont ni lues ni réécrites — elles restent lisibles avec la clé qu'elles
 * ont toujours eue. Le nouveau sel et le nouveau vecteur sont retirés au hasard : réutiliser
 * l'ancien vecteur avec une clé dérivée différente serait sans danger ici, mais la règle « un
 * vecteur, un usage » ne souffre pas d'exception qu'on doive justifier à la relecture.
 */
export async function rewrapVault(
  meta: VaultMeta,
  currentPassphrase: string,
  nextPassphrase: string,
  options: VaultOptions = {},
): Promise<VaultMeta> {
  if (nextPassphrase === '') throw new Error('Le mot de passe ne peut pas être vide.');
  const dek = await unwrapDek(meta, currentPassphrase, options.onProgress);
  const params = options.params ?? meta.params;
  const salt = random(SALT_BYTES);
  const wrapIv = random(IV_BYTES);
  const kek = await deriveKek(nextPassphrase, salt, params, options.onProgress);
  const wrapped = await crypto.subtle.encrypt({ name: AES, iv: wrapIv }, kek, dek);
  return {
    ...meta,
    params,
    salt: base64.encode(salt),
    wrappedKey: base64.encode(new Uint8Array(wrapped)),
    wrapIv: base64.encode(wrapIv),
    rewrappedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
  };
}

/** Scelle du texte. Un vecteur neuf à chaque appel : deux états identiques ne se ressemblent pas. */
export async function seal(key: CryptoKey, text: string): Promise<SealedBlob> {
  const iv = random(IV_BYTES);
  const ct = await crypto.subtle.encrypt({ name: AES, iv }, key, new TextEncoder().encode(text));
  return { v: 1, iv, ct: new Uint8Array(ct) };
}

/** Ouvre un bloc scellé. Lève `VAULT_LOCKED_ERROR` si la clé ne correspond pas ou si le bloc a bougé. */
export async function unseal(key: CryptoKey, blob: SealedBlob): Promise<string> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: AES, iv: bytes(blob.iv) },
      key,
      bytes(blob.ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error(VAULT_LOCKED_ERROR);
  }
}

/** Garde runtime sur l'en-tête relu depuis le stockage, qui n'est jamais supposé bien formé. */
export function isVaultMeta(value: unknown): value is VaultMeta {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const params = v['params'];
  if (typeof params !== 'object' || params === null) return false;
  const p = params as Record<string, unknown>;
  return (
    v['app'] === 'cout-revient-ch' &&
    v['vault'] === true &&
    v['version'] === 1 &&
    v['kdf'] === 'argon2id' &&
    typeof p['m'] === 'number' &&
    typeof p['t'] === 'number' &&
    typeof p['p'] === 'number' &&
    typeof v['salt'] === 'string' &&
    typeof v['wrappedKey'] === 'string' &&
    typeof v['wrapIv'] === 'string' &&
    typeof v['createdAt'] === 'string' &&
    typeof v['rewrappedAt'] === 'string'
  );
}

/** Garde runtime sur un bloc scellé relu depuis le stockage. */
export function isSealedBlob(value: unknown): value is SealedBlob {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v['v'] === 1 && v['iv'] instanceof Uint8Array && v['ct'] instanceof Uint8Array;
}

/**
 * Forme texte d'un bloc scellé, pour le miroir `localStorage` — qui ne stocke que des chaînes,
 * là où IndexedDB accepte les octets tels quels.
 */
export function encodeSealed(blob: SealedBlob): string {
  return `crch-sealed.1.${base64.encode(blob.iv)}.${base64.encode(blob.ct)}`;
}

const SEALED_PREFIX = 'crch-sealed.1.';

/** Reconnaît un miroir scellé sans tenter de le lire : sert à distinguer chiffré de clair. */
export function looksSealed(text: string): boolean {
  return text.startsWith(SEALED_PREFIX);
}

export function decodeSealed(text: string): SealedBlob | null {
  if (!looksSealed(text)) return null;
  const [ivText, ctText, ...rest] = text.slice(SEALED_PREFIX.length).split('.');
  if (rest.length > 0 || ivText === undefined || ctText === undefined) return null;
  const iv = fromBase64(ivText);
  const ct = fromBase64(ctText);
  return iv && ct ? { v: 1, iv, ct } : null;
}
