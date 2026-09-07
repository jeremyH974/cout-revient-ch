/**
 * Lecteur d'archive ZIP réduit à ce qu'un `.xlsx` contient : des parties XML, stockées telles
 * quelles (méthode 0) ou dégonflées (méthode 8). La décompression est confiée à
 * `DecompressionStream('deflate-raw')`, natif du navigateur comme de Node — aucune dépendance.
 *
 * Ce que ce lecteur ne fait pas, volontairement : ZIP64 (refusé explicitement plutôt que lu de
 * travers), chiffrement, archives multi-volumes, et **la vérification du CRC** — un fichier que
 * l'utilisateur vient de choisir dans son navigateur n'a pas transité par un réseau, et un CRC
 * faux se manifesterait de toute façon en XML illisible.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** Taille du bloc de fin d'archive, hors commentaire (dont la longueur tient sur 16 bits). */
const EOCD_MIN_SIZE = 22;
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;

export class ZipError extends Error {}

/** Position du bloc de fin d'archive, cherchée depuis la fin (le commentaire est rare mais permis). */
function findEndOfCentralDirectory(view: DataView): number {
  const from = Math.max(0, view.byteLength - EOCD_MIN_SIZE - ZIP64_MARKER_16);
  for (let at = view.byteLength - EOCD_MIN_SIZE; at >= from; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  throw new ZipError("Ce fichier n'est pas une archive lisible : fin d'archive introuvable.");
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Rend le contenu **binaire** de chaque partie de l'archive, indexé par son chemin interne. C'est
 * l'étage sur lequel tout le reste s'appuie : un classeur veut du texte, une archive de contrats
 * veut des octets, et décoder trop tôt perdrait les seconds.
 */
export async function unzipEntries(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  const directoryAt = view.getUint32(eocd + 16, true);
  if (count === ZIP64_MARKER_16 || directoryAt === ZIP64_MARKER_32) {
    throw new ZipError('Archive ZIP64 : ce format n’est pas lu. Réexportez un relevé plus court.');
  }

  // Les NOMS d'entrée restent du texte même quand le contenu est binaire.
  const decoder = new TextDecoder();
  const parts = new Map<string, Uint8Array>();
  let at = directoryAt;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('Archive incohérente : entrée de catalogue attendue et absente.');
    }
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (view.getUint32(localAt, true) !== LOCAL_SIGNATURE) {
      throw new ZipError(`Archive incohérente : en-tête local absent pour « ${name} ».`);
    }
    // Les longueurs de l'en-tête LOCAL font foi : elles diffèrent souvent de celles du catalogue.
    const dataAt =
      localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + compressedSize);
    if (method === 0) parts.set(name, raw.slice());
    else if (method === 8) parts.set(name, await inflateRaw(raw));
    else throw new ZipError(`Compression ${method} non gérée pour « ${name} ».`);
  }
  return parts;
}

/**
 * Rend le contenu **texte** de chaque partie, indexé par son chemin interne (`xl/workbook.xml`).
 * Un `.xlsx` ne contient que de l'XML : décoder en UTF-8 est sans perte.
 */
export async function unzipText(buffer: ArrayBuffer): Promise<Map<string, string>> {
  const decoder = new TextDecoder();
  const out = new Map<string, string>();
  for (const [name, bytes] of await unzipEntries(buffer)) out.set(name, decoder.decode(bytes));
  return out;
}
