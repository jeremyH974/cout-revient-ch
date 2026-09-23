/**
 * Chiffrement optionnel de la sauvegarde JSON par phrase secrète, avant export du fichier.
 *
 * **Argon2id** dérive la clé depuis la phrase secrète (voir `kdf.ts`, qui explique le choix et le
 * refus du WebAssembly), puis **AES-GCM-256** chiffre le texte — chiffrement *authentifié* : toute
 * altération du fichier fait échouer le déchiffrement plutôt que de renvoyer silencieusement des
 * données corrompues.
 *
 * ## Pourquoi ce n'est plus PBKDF2 (décision n° 151)
 *
 * Ce fichier a longtemps justifié PBKDF2 ainsi : « Argon2id n'existe qu'en WebAssembly ou en JS pur
 * ici — une dépendance de plus dans le chemin critique "restaurer mes données" ». L'argument est
 * tombé le jour où le coffre du navigateur a pris Argon2id : la dépendance était **déjà là**, et
 * c'est la sauvegarde — le seul fichier qui **voyage** — qui gardait le KDF le plus faible. Un
 * fichier qu'on copie sur une clé USB, qu'on envoie dans un nuage ou qu'on oublie dans un dossier
 * de téléchargements mérite au moins la protection de ce qui ne quitte jamais la machine.
 *
 * ## Les anciens fichiers restent lisibles, pour toujours
 *
 * Une sauvegarde chiffrée est une assurance : elle ne vaut que si elle s'ouvre le jour où tout le
 * reste a disparu. Les fichiers de **version 1** (PBKDF2) se déchiffrent donc toujours, avec leurs
 * propres itérations lues dans leur en-tête ; seules les nouvelles sauvegardes sont écrites en
 * **version 2**. Aucune migration, aucune échéance, aucun fichier rendu inutilisable par une mise
 * à jour.
 *
 * La clé dérivée n'est jamais exportable et ne vit qu'en mémoire le temps du chiffrement ou du
 * déchiffrement — jamais persistée. **Aucune récupération n'est possible en cas de phrase secrète
 * perdue** : l'application ne la connaît pas, ne la transmet nulle part, et il n'existe ni compte
 * ni service capable de la réinitialiser. La perdre revient à perdre la sauvegarde ; c'est le prix
 * du tout-local, sans compte.
 */
import {
  KDF_PARAMS,
  KDF_SALT_BYTES,
  deriveAesKey,
  isAcceptableKdfParams,
  type KdfParams,
} from './kdf';

/**
 * Version 1 : PBKDF2-HMAC-SHA-256. **Toujours lue, jamais plus écrite.** Ses itérations voyagent
 * avec elle, donc un fichier ancien s'ouvre avec les siennes, quoi qu'il advienne de la constante.
 */
export interface EncryptedBackupV1 {
  app: 'cout-revient-ch';
  encrypted: true;
  version: 1;
  kdf: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  /** Base64. */
  salt: string;
  /** Base64. */
  iv: string;
  /** Base64. */
  ciphertext: string;
  /** ISO 8601. */
  exportedAt: string;
}

/** Version 2 : Argon2id, avec ses paramètres en clair dans l'en-tête. */
export interface EncryptedBackupV2 {
  app: 'cout-revient-ch';
  encrypted: true;
  version: 2;
  kdf: 'argon2id';
  /** Mémoire, itérations, parallélisme — relus à l'ouverture, jamais supposés. */
  params: KdfParams;
  /** Base64. */
  salt: string;
  /** Base64. */
  iv: string;
  /** Base64. */
  ciphertext: string;
  /** ISO 8601. */
  exportedAt: string;
}

export type EncryptedBackup = EncryptedBackupV1 | EncryptedBackupV2;

/**
 * Itérations avec lesquelles les sauvegardes de **version 1** ont été écrites — la recommandation
 * OWASP pour PBKDF2-HMAC-SHA256. Conservée pour la lecture et pour la mémoire ; plus aucune
 * sauvegarde n'est écrite avec.
 */
export const BACKUP_KDF_ITERATIONS = 600_000;

const SALT_BYTES = KDF_SALT_BYTES;
const IV_BYTES = 12;
const AES_KEY_BITS = 256;

const WRONG_PASSPHRASE_ERROR = 'Phrase secrète incorrecte ou fichier altéré.';

/** Encode par blocs pour éviter une pile d'appel trop profonde sur de gros fichiers. */
function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Type de retour explicite `Uint8Array<ArrayBuffer>` (et non `Uint8Array` nu, qui désigne
// `Uint8Array<ArrayBufferLike>` depuis TS 5.7) : `crypto.subtle` exige `BufferSource`, qui exclut
// les vues sur `SharedArrayBuffer`.
function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Dérivation des sauvegardes de version 1. Lue seulement — jamais appelée à l'écriture. */
async function deriveKeyV1(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Garde runtime : distingue une sauvegarde chiffrée d'une sauvegarde JSON en clair. */
export function isEncryptedBackup(value: unknown): value is EncryptedBackup {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const envelope =
    v['app'] === 'cout-revient-ch' &&
    v['encrypted'] === true &&
    typeof v['salt'] === 'string' &&
    typeof v['iv'] === 'string' &&
    typeof v['ciphertext'] === 'string' &&
    typeof v['exportedAt'] === 'string';
  if (!envelope) return false;
  if (v['version'] === 1)
    return v['kdf'] === 'PBKDF2' && v['hash'] === 'SHA-256' && typeof v['iterations'] === 'number';
  if (v['version'] === 2)
    // Bornés, pas seulement typés : ils pilotent la dérivation (voir `KDF_PARAMS_LIMITS`).
    return v['kdf'] === 'argon2id' && isAcceptableKdfParams(v['params']);
  return false;
}

export async function encryptBackup(
  json: string,
  passphrase: string,
  options?: { params?: KdfParams; now?: () => number },
): Promise<EncryptedBackupV2> {
  if (passphrase === '') throw new Error('La phrase secrète ne peut pas être vide.');
  const params = options?.params ?? KDF_PARAMS;
  const now = options?.now ?? Date.now;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(passphrase, salt, params);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(json),
  );
  return {
    app: 'cout-revient-ch',
    encrypted: true,
    version: 2,
    kdf: 'argon2id',
    params: { ...params },
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    exportedAt: new Date(now()).toISOString(),
  };
}

/**
 * Message d'erreur volontairement générique (ne distingue pas « mauvaise phrase » de « fichier
 * altéré ») : AES-GCM échoue de la même façon dans les deux cas, et une phrase secrète vide est
 * traitée comme une tentative incorrecte plutôt que comme un cas à part.
 */
export async function decryptBackup(file: EncryptedBackup, passphrase: string): Promise<string> {
  if (passphrase === '') throw new Error(WRONG_PASSPHRASE_ERROR);
  try {
    const salt = fromBase64(file.salt);
    const iv = fromBase64(file.iv);
    const ciphertext = fromBase64(file.ciphertext);
    // Chaque fichier porte le KDF avec lequel il a été écrit : c'est lui qui décide, jamais la
    // version de l'application qui le relit.
    const key =
      file.version === 1
        ? await deriveKeyV1(passphrase, salt, file.iterations)
        : await deriveAesKey(passphrase, salt, file.params);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error(WRONG_PASSPHRASE_ERROR);
  }
}
