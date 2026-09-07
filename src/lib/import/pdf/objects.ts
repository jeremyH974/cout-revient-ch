/**
 * Lecture des objets d'un PDF, sans dépendance et sans DOM — même parti que `../xlsx/unzip.ts`.
 *
 * **Balayage linéaire, pas de table de références croisées.** Un PDF se lit normalement par sa
 * table `xref`, qui donne l'offset de chaque objet. On ne la lit pas : les documents visés en ont
 * une table classique et **aucun objet compressé** (`/ObjStm`), si bien qu'un balayage des motifs
 * `N M obj … endobj` retrouve tout, sans avoir à interpréter les offsets ni les versions
 * incrémentales. C'est moins général, c'est beaucoup plus court, et ça résiste à une table
 * corrompue. Les deux cas que cette simplification ne couvre pas sont **détectés et nommés** plutôt
 * que rendus en silence comme un document vide.
 *
 * **La décompression est native.** `DecompressionStream` existe dans le navigateur comme dans
 * Node ; `FlateDecode` est du zlib, avec repli sur du dégonflage brut pour les producteurs qui
 * omettent l'en-tête.
 */
export class PdfError extends Error {}

export interface PdfObject {
  /** Dictionnaire de l'objet, octets bruts — jamais interprété ici. */
  head: Uint8Array;
  /** Contenu du flux, décompressé ; `null` quand l'objet n'en porte pas. */
  stream: Uint8Array | null;
}

const ASCII = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Première occurrence de `needle` dans `hay` à partir de `from` ; `-1` si absente. */
export function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  const last = hay.length - needle.length;
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Dernière occurrence de `needle` dans `hay[0..before)`. */
function lastIndexOfBytes(hay: Uint8Array, needle: Uint8Array, before: number): number {
  for (let i = Math.min(before, hay.length - needle.length); i >= 0; i--) {
    let ok = true;
    for (let j = 0; j < needle.length; j++)
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    if (ok) return i;
  }
  return -1;
}

const OBJ = ASCII(' obj');
const ENDOBJ = ASCII('endobj');
const STREAM = ASCII('stream');
const ENDSTREAM = ASCII('endstream');
const FLATE = ASCII('/FlateDecode');
const ENCRYPT = ASCII('/Encrypt');
const OBJSTM = ASCII('/ObjStm');

const isDigit = (b: number | undefined): boolean => b !== undefined && b >= 0x30 && b <= 0x39;
const isSpace = (b: number | undefined): boolean =>
  b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

async function inflate(bytes: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream();
  const out = source.pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/**
 * `… N M obj` : on repère « obj » puis on remonte les deux entiers. Remonter plutôt que descendre
 * évite d'avoir à décider où commence un objet dans un flux binaire qui peut contenir n'importe
 * quelle séquence d'octets.
 */
function numberBefore(bytes: Uint8Array, at: number): { value: number; start: number } | null {
  let i = at;
  while (i > 0 && isSpace(bytes[i - 1])) i--;
  const end = i;
  while (i > 0 && isDigit(bytes[i - 1])) i--;
  if (i === end) return null;
  let value = 0;
  for (let k = i; k < end; k++) value = value * 10 + (bytes[k]! - 0x30);
  return { value, start: i };
}

/**
 * Tous les objets du document, indexés par numéro. Un objet réécrit par une mise à jour
 * incrémentale écrase le précédent : c'est l'ordre du fichier qui tranche, donc la version la plus
 * récente gagne — le même résultat que la table `xref` aurait donné dans les cas visés.
 */
export async function pdfObjects(buffer: ArrayBuffer): Promise<Map<number, PdfObject>> {
  const bytes = new Uint8Array(buffer);
  if (indexOfBytes(bytes, ENCRYPT) >= 0)
    throw new PdfError('Ce PDF est chiffré : son contenu ne peut pas être lu sans mot de passe.');
  if (indexOfBytes(bytes, OBJSTM) >= 0)
    throw new PdfError(
      'Ce PDF range ses objets dans des flux compressés (/ObjStm), une forme que ce lecteur volontairement minimal ne couvre pas.',
    );

  const objects = new Map<number, PdfObject>();
  let at = indexOfBytes(bytes, OBJ);
  while (at >= 0) {
    const generation = numberBefore(bytes, at);
    const number = generation ? numberBefore(bytes, generation.start) : null;
    if (number) {
      const bodyStart = at + OBJ.length;
      const bodyEnd = indexOfBytes(bytes, ENDOBJ, bodyStart);
      if (bodyEnd > 0) {
        objects.set(number.value, await readObject(bytes, bodyStart, bodyEnd));
      }
    }
    at = indexOfBytes(bytes, OBJ, at + OBJ.length);
  }
  if (objects.size === 0) throw new PdfError('Aucun objet PDF lisible dans ce fichier.');
  return objects;
}

async function readObject(bytes: Uint8Array, start: number, end: number): Promise<PdfObject> {
  const streamAt = indexOfBytes(bytes.subarray(start, end), STREAM);
  if (streamAt < 0) return { head: bytes.slice(start, end), stream: null };
  const head = bytes.slice(start, start + streamAt);
  // Le mot-clé `stream` est suivi d'un saut de ligne — CRLF ou LF, jamais CR seul (norme PDF).
  let from = start + streamAt + STREAM.length;
  if (bytes[from] === 0x0d && bytes[from + 1] === 0x0a) from += 2;
  else if (bytes[from] === 0x0a) from += 1;
  // Le flux est suivi d'une fin de ligne avant `endstream`. `DecompressionStream` REFUSE tout
  // octet excedentaire apres les donnees compressees : cette fin de ligne, laissee en place, fait
  // echouer la decompression de presque tous les flux du document — sans erreur visible, juste un
  // texte vide. On la retire.
  let stop = lastIndexOfBytes(bytes, ENDSTREAM, end);
  if (stop < from) stop = end;
  while (stop > from && (bytes[stop - 1] === 0x0a || bytes[stop - 1] === 0x0d)) stop--;
  const raw = bytes.slice(from, stop);
  if (indexOfBytes(head, FLATE) < 0) return { head, stream: raw };
  for (const format of ['deflate', 'deflate-raw'] as const) {
    try {
      return { head, stream: await inflate(raw, format) };
    } catch {
      // Un flux tronqué ou d'un autre filtre : on essaie l'autre forme, puis on renonce.
    }
  }
  return { head, stream: null };
}

/** Texte latin-1 d'un fragment d'octets : les dictionnaires PDF ne sont pas de l'UTF-8. */
export function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}
