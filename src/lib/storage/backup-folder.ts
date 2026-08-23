/**
 * Sauvegarde automatique dans un dossier choisi par l'utilisateur (File System Access API :
 * Chrome et Edge sur ordinateur ; Safari et Firefox n'exposent pas de dossier utilisateur).
 * Le handle du dossier n'est pas sérialisable en JSON : il vit dans le store `meta` d'IndexedDB.
 * Chrome conserve la permission entre les visites (prompt « autoriser à chaque visite ») et cesse
 * de la redemander après trois refus : l'état « permission requise » doit rester visible.
 * Vérifié le 23/08/2026 (developer.chrome.com, persistent permissions, Chrome 122+).
 */
import { idbMetaDelete, idbMetaGet, idbMetaSet } from './idb-state-store';

export const BACKUP_FILE_NAME = 'cout-revient-ch-sauvegarde.json';
const META_KEY = 'backupFolder';

export type FolderPermission = 'granted' | 'prompt' | 'denied';

/** Surface minimale des API Chrome absentes de `lib.dom` (typées localement, jamais supposées). */
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

export function isFolderBackupSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as PickerWindow).showDirectoryPicker === 'function'
  );
}

/** À appeler depuis un geste utilisateur (clic) ; `null` si l'utilisateur annule. */
export async function chooseBackupFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) return null;
  try {
    const handle = await picker({ id: 'cout-revient-ch-backup', mode: 'readwrite' });
    await idbMetaSet(META_KEY, handle);
    return handle;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

export async function loadBackupFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await idbMetaGet<FileSystemDirectoryHandle>(META_KEY);
    return handle && typeof handle === 'object' && 'name' in handle ? handle : null;
  } catch {
    return null;
  }
}

export async function forgetBackupFolder(): Promise<void> {
  try {
    await idbMetaDelete(META_KEY);
  } catch {
    /* base indisponible : rien à oublier */
  }
}

const toPermission = (state: PermissionState | undefined): FolderPermission =>
  state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt';

/** Permission en l'état, sans prompt (utilisable au chargement). */
export async function queryFolderPermission(
  handle: FileSystemDirectoryHandle,
): Promise<FolderPermission> {
  const h = handle as DirectoryHandle;
  try {
    return toPermission(await h.queryPermission?.({ mode: 'readwrite' }));
  } catch {
    return 'prompt';
  }
}

/** Demande la permission (prompt Chrome) : à appeler depuis un geste utilisateur. */
export async function requestFolderPermission(
  handle: FileSystemDirectoryHandle,
): Promise<FolderPermission> {
  const h = handle as DirectoryHandle;
  try {
    return toPermission(await h.requestPermission?.({ mode: 'readwrite' }));
  } catch {
    return 'denied';
  }
}

/** Écrit (écrase) le fichier de sauvegarde dans le dossier ; lève si la permission manque. */
export async function writeBackupFile(
  handle: FileSystemDirectoryHandle,
  text: string,
  fileName = BACKUP_FILE_NAME,
): Promise<void> {
  const file = await handle.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}
