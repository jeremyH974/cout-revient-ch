/**
 * Logique PURE de la boîte aux lettres : nommer les fichiers que CET appareil écrit, et choisir,
 * parmi tout ce qui vit dans le dossier synchronisé, ce qui vaut la peine d'être lu ou effacé.
 *
 * Rien ici ne touche au disque, au réseau ni à IndexedDB — uniquement des fonctions sur des
 * structures déjà lues par l'appelant (File System Access, sélecteur Android, boîte de réception
 * partagée…). C'est ce qui permet de la tester par PROPRIÉTÉS (fast-check) plutôt que par exemples.
 *
 * ## Pourquoi l'en-tête fait foi, jamais le nom
 *
 * Un dossier Drive/OneDrive/Dropbox synchronisé duplique un fichier en conflit en lui donnant un
 * nouveau nom (« fichier (1).txt », « fichier (conflit d'edition de jerem-pc).txt »…) — jamais en
 * touchant à son CONTENU. Trier sur le nom reviendrait à perdre le fichier dès la première
 * synchronisation à deux appareils. L'en-tête (`device`, `seq`), lui, ne bouge pas.
 */
import type { MailboxHeaderError, ReadMailboxHeaderResult } from './mailbox-envelope';

export const MAILBOX_FILE_PREFIX = 'cout-revient-ch-sync-';
export const MAILBOX_FILE_EXTENSION = '.txt';

/** Longueur du fragment d'appareil dans le nom de fichier — un indice pour l'œil, jamais une clé. */
const DEVICE_NAME_CHARS = 8;
const SEQ_DIGITS = 6;

/**
 * Nom du fichier que CET appareil écrirait pour ce `seq`. Purement indicatif : deux appareils dont
 * les 8 premiers caractères d'UUID coïncideraient produiraient le même nom sans que rien ne casse,
 * puisque `selectPeerFiles` ne lit jamais ce nom pour décider — seul l'en-tête compte.
 */
export function mailboxFileName(device: string, seq: number): string {
  const shortDevice = device.slice(0, DEVICE_NAME_CHARS);
  const seqPadded = String(Math.max(0, Math.trunc(seq))).padStart(SEQ_DIGITS, '0');
  return `${MAILBOX_FILE_PREFIX}${shortDevice}-${seqPadded}${MAILBOX_FILE_EXTENSION}`;
}

/** Un fichier du dossier synchronisé, tel que l'appelant l'a déjà lu (nom, taille, en-tête ou erreur). */
export interface MailboxFileEntry {
  name: string;
  size: number;
  header: ReadMailboxHeaderResult;
}

/**
 * Départage deux entrées du MÊME appareil : la plus récente d'abord (plus grand `seq`), puis un
 * critère qui ne dépend JAMAIS de l'ordre de découverte — le nom, lexicographique — pour que deux
 * copies en conflit d'un même `seq` (même contenu, nom différent) donnent un résultat déterministe.
 */
function isNewer(
  a: { seq: number; name: string },
  b: { seq: number; name: string } | undefined,
): boolean {
  if (!b) return true;
  if (a.seq !== b.seq) return a.seq > b.seq;
  return a.name < b.name;
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * Le fichier le plus récent de chaque appareil PAIR (jamais le mien), triés par identifiant
 * d'appareil pour que le résultat ne dépende ni de l'ordre d'entrée ni de l'ordre du système de
 * fichiers. Un fichier vide, illisible ou tronqué (`header.ok === false`) est silencieusement
 * ignoré — « rien de nouveau », jamais une erreur qui bloquerait la lecture des autres.
 */
export function selectPeerFiles(
  entries: readonly MailboxFileEntry[],
  myDevice: string,
): MailboxFileEntry[] {
  const bestByDevice = new Map<string, { seq: number; name: string; entry: MailboxFileEntry }>();
  for (const entry of entries) {
    if (!entry.header.ok) continue;
    const { device, seq } = entry.header.envelope;
    if (device === myDevice) continue;
    const candidate = { seq, name: entry.name, entry };
    if (isNewer(candidate, bestByDevice.get(device))) bestByDevice.set(device, candidate);
  }
  return [...bestByDevice.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, best]) => best.entry);
}

/**
 * Parmi les fichiers de MON appareil, ceux qui dépassent les `keep` plus récents (par `seq`) — donc
 * ceux qu'il est sûr d'effacer. Un fichier dont l'en-tête n'a pas pu être lu n'est JAMAIS considéré
 * comme mien : on ne peut pas prouver qu'il m'appartient, donc on ne le touche pas.
 */
export function ownFilesToPrune(
  entries: readonly MailboxFileEntry[],
  myDevice: string,
  keep = 2,
): MailboxFileEntry[] {
  const mine = entries.filter((e) => e.header.ok && e.header.envelope.device === myDevice);
  const sorted = [...mine].sort((a, b) => {
    const seqA = a.header.ok ? a.header.envelope.seq : -1;
    const seqB = b.header.ok ? b.header.envelope.seq : -1;
    if (seqA !== seqB) return seqB - seqA; // plus grand seq d'abord
    return byName(a, b); // tie-break déterministe entre copies en conflit du même seq
  });
  return sorted.slice(Math.max(0, keep));
}

/** Ré-exporté pour les appelants qui veulent distinguer les codes d'erreur sans importer l'enveloppe. */
export type { MailboxHeaderError };
