/**
 * Le côté DISQUE de la boîte aux lettres (P125) : un dossier choisi une fois (File System Access,
 * Chrome/Edge de bureau), et ce que cet appareil doit retenir d'une session à l'autre pour y
 * écrire/lire correctement — sel stable, numérotation de ses propres dépôts, dernier `seq` connu
 * de chaque pair. `mailbox-sync.ts` ne connaît rien de tout ceci : il reçoit un `MailboxFolder`
 * déjà construit et des nombres déjà lus, ce qui le garde testable sans navigateur.
 *
 * Patron identique à `backup-folder.ts` (même API Chrome, permissions persistantes — vérifié le
 * 22/09/2026, developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api :
 * Chrome 122, prompt à trois choix dont « Autoriser à chaque visite », plus de re-demande après
 * trois refus) et à `device-id.ts` (sel/compteurs : mêmes essais-repose-sur-IndexedDB, jamais
 * d'exception si la base est indisponible). Volontairement **dupliqué plutôt qu'importé** de
 * `backup-folder.ts` — même raison que `mailbox-envelope.ts` duplique le message d'erreur de
 * `encryption.ts` : ce sont deux dossiers CONCEPTUELLEMENT distincts (sauvegarde solo vs boîte aux
 * lettres partagée), avec des clés IndexedDB propres ; les confondre ferait choisir accidentellement
 * le même dossier pour les deux usages un jour où quelqu'un factorise trop tôt.
 *
 * `RealMailboxFolder` implémente `MailboxFolder` (`mailbox-sync.ts`) au-dessus de N'IMPORTE QUEL
 * `FileSystemDirectoryHandle` — y compris la racine (ou un sous-dossier) d'OPFS
 * (`navigator.storage.getDirectory()`), qui expose EXACTEMENT la même interface. C'est ce qui
 * permet aux tests de bout en bout d'injecter un dossier réel sans sélecteur natif, que Playwright
 * ne peut pas piloter — voir `chooseMailboxFolder(handleOverride)` plus bas. Ceci ne fait PAS de
 * cette application un usage d'OPFS pour ses propres données : `docs/variante-personnelle.md` («
 * Pas d'OPFS ») parle du stockage applicatif (IndexedDB), pas d'un dossier de test qui se contente
 * d'implémenter la même interface que File System Access.
 */
import { idbMetaDelete, idbMetaGet, idbMetaSet } from './idb-state-store';
import { KDF_SALT_BYTES } from './kdf';
import type { MailboxFolder } from './mailbox-sync';

const META_FOLDER = 'mailboxFolder';
const META_SALT = 'mailboxSalt';
const META_SEQ = 'mailboxSeq';
const META_PEER_SEQ = 'mailboxPeerSeq';

/** Surface Chrome absente de `lib.dom` (comme `backup-folder.ts`), jamais supposée présente. */
interface PermissionHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}
type DirectoryHandle = FileSystemDirectoryHandle & PermissionHandle;
interface PickerWindow {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: string;
  }) => Promise<FileSystemDirectoryHandle>;
}

export type MailboxFolderPermission = 'granted' | 'prompt' | 'denied';

export function isMailboxFolderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as PickerWindow).showDirectoryPicker === 'function'
  );
}

/**
 * Choisit le dossier de synchronisation. Depuis un clic : sans argument, ouvre le sélecteur natif.
 *
 * `handleOverride` est le point d'injection RÉSERVÉ AUX TESTS de bout en bout : un handle déjà
 * obtenu par la PAGE elle-même (`navigator.storage.getDirectory()` sous Playwright, qui ne peut
 * piloter aucun sélecteur natif) est accepté exactement comme le retour de `showDirectoryPicker` —
 * même persistance, même écriture immédiate d'un premier dépôt côté appelant. Rien de plus
 * dangereux qu'un appel normal : obtenir un `FileSystemDirectoryHandle` exige déjà d'être un script
 * de cette origine, capable d'appeler `showDirectoryPicker`/`getDirectory` lui-même.
 */
export async function chooseMailboxFolder(
  handleOverride?: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle | null> {
  let handle: FileSystemDirectoryHandle | null;
  if (handleOverride) {
    handle = handleOverride;
  } else {
    const picker = (window as PickerWindow).showDirectoryPicker;
    if (!picker) return null;
    try {
      handle = await picker({ id: 'cout-revient-ch-mailbox', mode: 'readwrite' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
  }
  await idbMetaSet(META_FOLDER, handle);
  return handle;
}

export async function loadMailboxFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await idbMetaGet<FileSystemDirectoryHandle>(META_FOLDER);
    return handle && typeof handle === 'object' && 'name' in handle ? handle : null;
  } catch {
    return null;
  }
}

export async function forgetMailboxFolder(): Promise<void> {
  try {
    await idbMetaDelete(META_FOLDER);
  } catch {
    /* base indisponible : rien à oublier */
  }
}

const toPermission = (state: PermissionState | undefined): MailboxFolderPermission =>
  state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt';

/** Permission en l'état, sans prompt (utilisable au chargement). */
export async function queryMailboxFolderPermission(
  handle: FileSystemDirectoryHandle,
): Promise<MailboxFolderPermission> {
  const h = handle as DirectoryHandle;
  try {
    return toPermission(await h.queryPermission?.({ mode: 'readwrite' }));
  } catch {
    return 'prompt';
  }
}

/** Demande la permission (prompt Chrome) : à appeler depuis un geste utilisateur. */
export async function requestMailboxFolderPermission(
  handle: FileSystemDirectoryHandle,
): Promise<MailboxFolderPermission> {
  const h = handle as DirectoryHandle;
  try {
    return toPermission(await h.requestPermission?.({ mode: 'readwrite' }));
  } catch {
    return 'denied';
  }
}

// --- Ce que CET appareil doit retenir entre deux sessions --------------------------------------

/**
 * Sel stable de cet appareil pour l'enveloppe v3 (`mailbox-envelope.ts` explique pourquoi un sel
 * stable est nécessaire au cache de clés). Même patron que `device-id.ts` : un identifiant qui ne
 * peut pas se relire depuis IndexedDB retombe sur une valeur fraîche, valable pour la session
 * seule plutôt que de faire échouer la synchronisation.
 */
export async function loadOrCreateMailboxSalt(): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const existing = await idbMetaGet<Uint8Array<ArrayBuffer>>(META_SALT);
    if (existing instanceof Uint8Array && existing.length === KDF_SALT_BYTES) {
      const copy = new Uint8Array(existing.length);
      copy.set(existing);
      return copy;
    }
  } catch {
    /* IndexedDB indisponible : sel de repli ci-dessous, valable pour cette session seule */
  }
  const fresh = crypto.getRandomValues(new Uint8Array(KDF_SALT_BYTES));
  try {
    await idbMetaSet(META_SALT, fresh);
  } catch {
    /* échec d'écriture : le sel vaudra pour cette session seulement, sans persister */
  }
  return fresh;
}

/**
 * `seq` du PROCHAIN fichier à écrire pour cet appareil, et le persiste IMMÉDIATEMENT (avant même
 * la tentative d'écriture) : un `seq` déjà réservé n'est jamais réutilisé, même si le dépôt qui le
 * portait a échoué — la seule alternative serait de risquer d'écrire deux fichiers différents sous
 * le MÊME nom (`mailboxFileName` ne dépend que de l'appareil et du `seq`), ce que la règle « jamais
 * de réécriture d'un fichier existant » interdit. Un `seq` sauté est inoffensif : ni
 * `selectPeerFiles` ni `ownFilesToPrune` ne supposent une suite sans trou.
 */
export async function nextMailboxSeq(): Promise<number> {
  let last = 0;
  try {
    const stored = await idbMetaGet<number>(META_SEQ);
    if (typeof stored === 'number' && Number.isInteger(stored) && stored >= 0) last = stored;
  } catch {
    /* IndexedDB indisponible : repart de 1 pour cette session (voir le commentaire ci-dessus) */
  }
  const next = last + 1;
  try {
    await idbMetaSet(META_SEQ, next);
  } catch {
    /* échec d'écriture : la numérotation ne survivra pas à cette session */
  }
  return next;
}

/** Dernier `seq` fusionné, par appareil PAIR (jamais le sien) — ce que `syncMailbox` doit ignorer. */
export async function loadMailboxPeerSeqs(): Promise<Record<string, number>> {
  try {
    const stored = await idbMetaGet<Record<string, number>>(META_PEER_SEQ);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) return { ...stored };
  } catch {
    /* IndexedDB indisponible : repart de zéro, quitte à refusionner des fichiers déjà connus
       (idempotent — `sync/merge.ts` — donc sans risque, seulement un cycle plus coûteux) */
  }
  return {};
}

export async function saveMailboxPeerSeqs(seqs: Readonly<Record<string, number>>): Promise<void> {
  try {
    await idbMetaSet(META_PEER_SEQ, { ...seqs });
  } catch {
    /* best effort : un échec ici ne perd que l'OPTIMISATION du prochain cycle, jamais de donnée */
  }
}

// --- L'implémentation réelle de `MailboxFolder` -------------------------------------------------

/**
 * `MailboxFolder` au-dessus d'un `FileSystemDirectoryHandle` réel (ou d'un handle OPFS de test —
 * voir la note de tête de fichier). `values()`/`removeEntry()` : Baseline largement disponible
 * depuis mars 2023 (MDN, `FileSystemDirectoryHandle`, vérifié le 22/09/2026) — présents dans les
 * types de TypeScript 6 (`lib: ["DOM", "DOM.Iterable"]`, `tsconfig.json`) sans recul de type.
 */
export class RealMailboxFolder implements MailboxFolder {
  private readonly handle: FileSystemDirectoryHandle;

  // Pas de paramètre de constructeur raccourci (`erasableSyntaxOnly`, `tsconfig.json`) : cette
  // syntaxe demande une émission JavaScript pour l'affectation, que ce drapeau interdit.
  constructor(handle: FileSystemDirectoryHandle) {
    this.handle = handle;
  }

  async list(): Promise<string[]> {
    const names: string[] = [];
    // Un sous-DOSSIER qu'un utilisateur aurait créé dans le même dossier synchronisé (peu probable,
    // mais gratuit à exclure) n'est jamais un dépôt : seuls les FICHIERS sont retenus.
    for await (const entry of this.handle.values()) {
      if (entry.kind === 'file') names.push(entry.name);
    }
    return names;
  }

  async read(name: string): Promise<string | null> {
    try {
      const fileHandle = await this.handle.getFileHandle(name);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch {
      // Absent, verrouillé par le client cloud, permission perdue entre deux appels : jamais
      // bloquant pour le reste du cycle — voir le contrat de `MailboxFolder.read`.
      return null;
    }
  }

  async write(name: string, text: string): Promise<void> {
    const fileHandle = await this.handle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(text);
    } finally {
      await writable.close();
    }
  }

  async remove(name: string): Promise<void> {
    await this.handle.removeEntry(name);
  }
}
