/**
 * L'enveloppe v3 « boîte aux lettres » : le format d'un fichier déposé par UN appareil dans un
 * dossier synchronisé (Drive, OneDrive…) et lu par les autres. Voisine de l'enveloppe v2 de
 * `encryption.ts` (Argon2id + AES-GCM-256), mais trois différences structurelles :
 *
 * 1. **L'en-tête entier est lié par AAD** (`additionalData` d'AES-GCM) : la v2 n'authentifie que le
 *    texte chiffré, donc un `salt`/`iv`/`params` truqué change simplement la clé dérivée et échoue
 *    déjà — mais silencieusement, comme un hasard. Ici, `device`, `seq`, `writtenAt` et le reste
 *    voyagent aussi en clair et sont donc, eux aussi, la cible d'une falsification qu'AES-GCM seul
 *    ne verrait pas (changer `seq` ne change pas la clé). Lier tout l'en-tête en AAD fait échouer le
 *    déchiffrement pour la même raison qu'un octet de `ciphertext` changé : c'est le point que la
 *    contre-épreuve du fichier `.test.ts` vérifie en retirant l'AAD et en constatant le test rougir.
 * 2. **Compression avant chiffrement** (`CompressionStream('gzip')`) : plusieurs appareils déposent
 *    l'état complet à chaque synchronisation, et le JSON compresse bien (texte répétitif). Le flux
 *    est natif du navigateur depuis longtemps (Chrome 80, Firefox 113, Safari 16.4 — vérifié le
 *    22/09/2026 sur web.dev/blog/compressionstreams), donc aucune dépendance.
 * 3. **Un cache de clés par sel**, en mémoire de session seulement : la boîte aux lettres lit
 *    potentiellement des dizaines de fichiers (plusieurs appareils, plusieurs dépôts), et chaque
 *    appareil écrit avec un sel STABLE (fourni par l'appelant, pas régénéré ici) — dériver une
 *    seconde fois la même clé Argon2id serait 250 ms perdus pour rien.
 *
 * ## Pourquoi l'AAD, précisément
 *
 * MDN (`AesGcmParams`, vérifié le 22/09/2026) : « This contains additional data that will not be
 * encrypted but will be authenticated along with the encrypted data. […] If additionalData is given
 * here then the same data must be given in the corresponding call to decrypt(): if the data given
 * to the decrypt() call does not match the original data, the decryption will throw an exception. »
 * C'est exactement la propriété voulue : l'en-tête n'a pas besoin d'être SECRET (il ne l'est déjà
 * pas, en clair dans le fichier), il a besoin d'être INFALSIFIABLE sans casser le déchiffrement.
 *
 * ## Pourquoi un sel stable par appareil, et la limite que ça suppose
 *
 * NIST SP 800-38D limite les IV aléatoires de 96 bits à 2^32 chiffrements sous UNE MÊME clé. Le sel
 * étant stable par appareil, la clé dérivée l'est aussi (via le cache ci-dessous) : chaque appareil
 * resterait des millions d'années sous cette limite au rythme d'une synchronisation manuelle. Ce
 * n'est donc pas un risque au sens propre, mais une limite qu'il vaut mieux avoir nommée qu'oubliée.
 *
 * ## Ce qui NE change PAS
 *
 * `encryption.ts` (v1 PBKDF2, v2 Argon2id) reste intact : ce fichier ne le touche pas, ne l'importe
 * pas, et n'en dépend pas. Le message d'erreur « mauvaise phrase secrète » ci-dessous reproduit
 * volontairement celui de la v2, à l'identique, plutôt que de l'importer — pour que ce fichier reste
 * lisible seul et que la v2 ait un `git diff` strictement vide.
 */
import { base64 } from '@scure/base';
import { deriveAesKey, isAcceptableKdfParams, KDF_PARAMS, type KdfParams } from './kdf';

/** En-tête en clair d'une enveloppe v3, avant chiffrement (tout, sauf `ciphertext`). */
export interface MailboxHeaderV3 {
  app: 'cout-revient-ch';
  kind: 'mailbox';
  version: 3;
  /** UUID de l'appareil écrivain. Fourni par l'appelant : ce module ne connaît pas d'identité. */
  device: string;
  /** Entier croissant par appareil (pas globalement) : c'est l'appareil qui numérote les siens. */
  seq: number;
  /** ISO 8601, instant d'écriture. */
  writtenAt: string;
  kdf: 'argon2id';
  params: KdfParams;
  /** Base64. Sel STABLE par appareil (fourni par l'appelant, jamais régénéré ici). */
  salt: string;
  /** Base64, 96 bits. Aléatoire à CHAQUE écriture — jamais réutilisé, même avec le même sel. */
  iv: string;
  compression: 'gzip';
}

/** L'enveloppe complète : l'en-tête ci-dessus, plus le texte chiffré. */
export interface MailboxEnvelopeV3 extends MailboxHeaderV3 {
  /** Base64. AES-GCM-256 de (gzip du) JSON, authentifié avec l'en-tête entier en AAD. */
  ciphertext: string;
}

const IV_BYTES = 12;

/**
 * Identique, au caractère près, au message de `encryption.ts` — voir la note en tête de fichier sur
 * pourquoi il est DUPLIQUÉ plutôt qu'importé.
 */
const WRONG_PASSPHRASE_ERROR = 'Phrase secrète incorrecte ou fichier altéré.';

/** Encode par blocs (comme `encryption.ts`) : évite une pile d'appel trop profonde sur un gros JSON. */
function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const decoded = base64.decode(text);
    const copy = new Uint8Array(decoded.length);
    copy.set(decoded);
    return copy;
  } catch {
    return null;
  }
}

/**
 * Sérialisation JSON déterministe : clés triées, récursivement, à chaque niveau d'objet. C'est la
 * forme que l'AAD authentifie — elle n'a besoin d'être ni jolie ni stable dans le temps, seulement
 * de dépendre de TOUTE la valeur et de rien d'autre (l'ordre d'écriture des champs ne doit pas
 * pouvoir changer silencieusement ce qui est authentifié).
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function headerAad(header: MailboxHeaderV3): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(canonicalJson(header));
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

/** Flux du corps d'une réponse construite sur ces octets. `Response` ne rend jamais `null` ici. */
function bodyStream(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array> {
  const body = new Response(bytes).body;
  if (!body) throw new Error('Flux de compression indisponible.');
  return body;
}

/**
 * `lib.dom` type `CompressionStream`/`DecompressionStream.writable` en `WritableStream<BufferSource>`
 * (accepte aussi un `ArrayBuffer` nu), plus large que le `WritableStream<Uint8Array<ArrayBufferLike>>`
 * qu'attend `pipeThrough` — une désadaptation des TYPES seulement : les deux API acceptent un
 * `Uint8Array` à l'exécution, sans ambiguïté. Un seul recul de type, à cette frontière précise.
 */
type BytesTransform = ReadableWritablePair<Uint8Array, Uint8Array>;

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const transform = new CompressionStream('gzip') as unknown as BytesTransform;
  const stream = bodyStream(bytes).pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const transform = new DecompressionStream('gzip') as unknown as BytesTransform;
  const stream = bodyStream(bytes).pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Cache de clés par sel, EN MÉMOIRE DE SESSION SEULEMENT (jamais persisté — rechargez l'onglet, le
 * cache est vide). Pour un usage normal — une seule phrase secrète déverrouille toute la boîte aux
 * lettres, comme le coffre (`vault-session.ts`) — un même sel n'implique donc qu'une seule
 * dérivation Argon2id, quel que soit le nombre de fichiers qui le portent (un appareil pair écrit
 * avec un sel stable) : c'est ce que le test « espion » vérifie.
 *
 * **Piège évité, trouvé par le test « mauvaise phrase secrète »** : indexer SEULEMENT par sel (sans
 * la phrase) donnait un résultat faux et dangereux — décrypter avec une MAUVAISE phrase après avoir
 * déjà dérivé la bonne pour ce même sel rendait silencieusement la clé de la bonne, empruntée au
 * cache, sans jamais vérifier la phrase fournie. La table est donc indexée par (sel, phrase) : le
 * cas normal (une seule phrase par session) garde exactement la même propriété qu'annoncé
 * ci-dessus, et une phrase différente sur un sel déjà vu redérive — et échoue, comme il se doit.
 *
 * La table n'indexe pas la phrase elle-même mais son **empreinte SHA-256** : une `Map` vit toute la
 * session, et garder la phrase en clair comme clé la laisserait lisible en mémoire bien après son
 * usage. L'empreinte suffit à distinguer deux phrases ; la clé AES, elle, reste non exportable.
 * Les paramètres entrent aussi dans l'index : la même phrase et le même sel sous d'autres
 * paramètres donnent une autre clé.
 */
const keyCache = new Map<string, CryptoKey>();

async function cacheIndex(passphrase: string, saltKey: string, params: KdfParams): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passphrase));
  return `${saltKey}|${params.m}.${params.t}.${params.p}|${toBase64(new Uint8Array(digest))}`;
}

async function keyForSalt(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  params: KdfParams,
): Promise<CryptoKey> {
  const index = await cacheIndex(passphrase, base64.encode(salt), params);
  const cached = keyCache.get(index);
  if (cached) return cached;
  const key = await deriveAesKey(passphrase, salt, params);
  keyCache.set(index, key);
  return key;
}

/** Tests seulement : un sel réutilisé entre deux tests ne doit pas faire hériter une clé d'avant. */
export function resetMailboxKeyCacheForTests(): void {
  keyCache.clear();
}

export interface EncryptMailboxOptions {
  params?: KdfParams;
  now?: () => number;
}

/**
 * Chiffre un JSON en enveloppe v3 : gzip, puis AES-GCM-256 avec l'en-tête entier en AAD.
 *
 * `salt` est fourni par l'appelant (sel stable de CET appareil), jamais généré ici — c'est lui qui
 * permet au cache ci-dessus de ne dériver qu'une fois par appareil. `iv`, lui, est toujours neuf.
 */
export async function encryptMailboxEnvelope(
  json: string,
  passphrase: string,
  device: string,
  seq: number,
  salt: Uint8Array<ArrayBuffer>,
  options: EncryptMailboxOptions = {},
): Promise<MailboxEnvelopeV3> {
  if (passphrase === '') throw new Error('La phrase secrète ne peut pas être vide.');
  const params = options.params ?? KDF_PARAMS;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await keyForSalt(passphrase, salt, params);
  const compressed = await gzip(new TextEncoder().encode(json));
  const header: MailboxHeaderV3 = {
    app: 'cout-revient-ch',
    kind: 'mailbox',
    version: 3,
    device,
    seq,
    writtenAt: new Date(options.now?.() ?? Date.now()).toISOString(),
    kdf: 'argon2id',
    params: { ...params },
    salt: base64.encode(salt),
    iv: toBase64(iv),
    compression: 'gzip',
  };
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: headerAad(header) },
    key,
    compressed,
  );
  return { ...header, ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

/**
 * Déchiffre une enveloppe v3. Message unique pour « mauvaise phrase » et « en-tête ou texte chiffré
 * altéré » — comme la v2 (`encryption.ts`) : AES-GCM échoue de la même façon dans tous ces cas, et
 * les distinguer renseignerait un attaquant sans jamais aider l'utilisateur.
 *
 * L'AAD est reconstruite à partir de l'enveloppe REÇUE (tout sauf `ciphertext`) : un seul champ
 * d'en-tête modifié depuis l'écriture — `seq`, `device`, `writtenAt`, `params`… — change donc l'AAD
 * et fait échouer le déchiffrement, même si `ciphertext` lui-même n'a pas bougé d'un octet.
 */
export async function decryptMailboxEnvelope(
  envelope: MailboxEnvelopeV3,
  passphrase: string,
): Promise<string> {
  if (passphrase === '') throw new Error(WRONG_PASSPHRASE_ERROR);
  try {
    const salt = fromBase64(envelope.salt);
    const iv = fromBase64(envelope.iv);
    const ciphertext = fromBase64(envelope.ciphertext);
    if (!salt || !iv || !ciphertext) throw new Error(WRONG_PASSPHRASE_ERROR);
    const key = await keyForSalt(passphrase, salt, envelope.params);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- le reste EST l'en-tête pour l'AAD
    const { ciphertext: _ciphertext, ...header } = envelope;
    const compressed = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: headerAad(header) },
      key,
      ciphertext,
    );
    const plain = await gunzip(new Uint8Array(compressed));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error(WRONG_PASSPHRASE_ERROR);
  }
}

/** Pourquoi la lecture de l'en-tête peut refuser un fichier, sans jamais tenter de le déchiffrer. */
export type MailboxHeaderError =
  | { code: 'invalid-json' }
  | { code: 'wrong-app'; app: unknown }
  | { code: 'unsupported-version'; version: unknown }
  | { code: 'malformed' };

export type ReadMailboxHeaderResult =
  { ok: true; envelope: MailboxEnvelopeV3 } | { ok: false; error: MailboxHeaderError };

/**
 * Lit et valide la FORME d'une enveloppe v3, SANS déchiffrer : sert à trier les fichiers d'un
 * dossier (le plus récent par appareil) sans payer une dérivation Argon2id par fichier. L'en-tête
 * fait foi, jamais le nom du fichier — voir `mailbox.ts`, `selectPeerFiles`.
 *
 * Erreurs explicites et typées (contrairement au déchiffrement, dont le message reste unique) :
 * cette lecture ne touche à aucun secret, distinguer ses échecs ne renseigne personne.
 */
export function readMailboxHeader(text: string): ReadMailboxHeaderResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: 'invalid-json' } };
  }
  if (typeof parsed !== 'object' || parsed === null)
    return { ok: false, error: { code: 'malformed' } };
  const v = parsed as Record<string, unknown>;
  if (v['app'] !== 'cout-revient-ch')
    return { ok: false, error: { code: 'wrong-app', app: v['app'] } };
  if (v['kind'] !== 'mailbox') return { ok: false, error: { code: 'malformed' } };
  if (v['version'] !== 3)
    return { ok: false, error: { code: 'unsupported-version', version: v['version'] } };
  // Bornés, pas seulement typés : le PC relit ces fichiers à chaque ouverture, et des paramètres
  // démesurés figeraient l'onglet avant même la demande de phrase secrète (`KDF_PARAMS_LIMITS`).
  const paramsOk = isAcceptableKdfParams(v['params']);
  const wellFormed =
    typeof v['device'] === 'string' &&
    v['device'] !== '' &&
    typeof v['seq'] === 'number' &&
    Number.isInteger(v['seq']) &&
    typeof v['writtenAt'] === 'string' &&
    v['kdf'] === 'argon2id' &&
    paramsOk &&
    typeof v['salt'] === 'string' &&
    typeof v['iv'] === 'string' &&
    v['compression'] === 'gzip' &&
    typeof v['ciphertext'] === 'string';
  if (!wellFormed) return { ok: false, error: { code: 'malformed' } };
  return { ok: true, envelope: v as unknown as MailboxEnvelopeV3 };
}
