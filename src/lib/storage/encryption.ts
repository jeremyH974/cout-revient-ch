/**
 * Chiffrement optionnel de la sauvegarde JSON par phrase secrète, avant export du fichier.
 *
 * PBKDF2-HMAC-SHA-256 dérive une clé depuis la phrase secrète, puis AES-GCM-256 chiffre le texte
 * (chiffrement *authentifié* : toute altération du fichier fait échouer le déchiffrement plutôt que
 * de renvoyer silencieusement des données corrompues). Les deux primitives sont natives à
 * `crypto.subtle` (tout navigateur moderne, Node ≥ 20) : zéro dépendance. Argon2id serait un KDF
 * plus résistant au matériel dédié (GPU/ASIC) et c'est le choix recommandé par l'OWASP en 2024+,
 * mais il n'existe qu'en WebAssembly ou en JS pur ici — une dépendance de plus dans le chemin
 * critique « restaurer mes données », pour un gain marginal face à la menace réelle (vol du fichier
 * de sauvegarde par un tiers, pas une ferme de calcul dédiée à casser un seul fichier). 600 000
 * itérations suit la recommandation OWASP 2023+ pour PBKDF2-HMAC-SHA256 (`BACKUP_KDF_ITERATIONS`).
 *
 * La clé dérivée n'est jamais exportable (`extractable: false`) et ne vit qu'en mémoire le temps du
 * chiffrement ou du déchiffrement — jamais persistée. **Aucune récupération n'est possible en cas de
 * phrase secrète perdue** : l'application ne la connaît pas, ne la transmet nulle part, et il
 * n'existe ni compte ni service capable de la réinitialiser. La perdre revient à perdre la
 * sauvegarde ; c'est le prix du tout-local, sans compte.
 */

export interface EncryptedBackup {
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

/** OWASP 2023+ : au moins 600 000 itérations pour PBKDF2-HMAC-SHA256. */
export const BACKUP_KDF_ITERATIONS = 600_000;

const SALT_BYTES = 16;
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

async function deriveKey(
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
  return (
    v['app'] === 'cout-revient-ch' &&
    v['encrypted'] === true &&
    v['version'] === 1 &&
    v['kdf'] === 'PBKDF2' &&
    v['hash'] === 'SHA-256' &&
    typeof v['iterations'] === 'number' &&
    typeof v['salt'] === 'string' &&
    typeof v['iv'] === 'string' &&
    typeof v['ciphertext'] === 'string' &&
    typeof v['exportedAt'] === 'string'
  );
}

export async function encryptBackup(
  json: string,
  passphrase: string,
  options?: { iterations?: number; now?: () => number },
): Promise<EncryptedBackup> {
  if (passphrase === '') throw new Error('La phrase secrète ne peut pas être vide.');
  const iterations = options?.iterations ?? BACKUP_KDF_ITERATIONS;
  const now = options?.now ?? Date.now;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(json),
  );
  return {
    app: 'cout-revient-ch',
    encrypted: true,
    version: 1,
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iterations,
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
    const key = await deriveKey(passphrase, salt, file.iterations);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error(WRONG_PASSPHRASE_ERROR);
  }
}
