/** Déclenche le téléchargement d'un texte côté navigateur. */
export function downloadText(
  filename: string,
  text: string,
  type = 'text/plain;charset=utf-8',
): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Web Share avec fichiers disponible (iOS/Android, Chrome/Edge desktop ; pas Firefox). */
export function canShareFiles(filename = 'sauvegarde.json', type = 'application/json'): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    const probe = new File(['{}'], filename, { type });
    return navigator.canShare?.({ files: [probe] }) === true;
  } catch {
    return false;
  }
}

/**
 * Partage un texte comme fichier (sur iPhone : « Enregistrer dans Fichiers », AirDrop…).
 * `false` si le partage n'a pas eu lieu (annulé ou non disponible) : l'appelant propose alors le
 * téléchargement classique.
 */
export async function shareTextFile(
  filename: string,
  text: string,
  type = 'application/json',
): Promise<boolean> {
  return shareBlobFile(filename, new Blob([text], { type }), type);
}

/**
 * Même chose pour un contenu **binaire** (une image PNG, un PDF) : un `Blob` plutôt qu'une chaîne.
 * `shareTextFile` en est désormais un cas particulier, pour qu'il n'existe qu'un seul chemin de
 * partage à maintenir. `false` couvre aussi bien l'indisponibilité que l'annulation par
 * l'utilisateur : dans les deux cas l'appelant propose le téléchargement.
 */
export async function shareBlobFile(
  filename: string,
  blob: Blob,
  type = blob.type || 'application/octet-stream',
): Promise<boolean> {
  if (!canShareFiles(filename, type)) return false;
  try {
    await navigator.share({ files: [new File([blob], filename, { type })], title: filename });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    return false;
  }
}

/** Déclenche le téléchargement d'un blob (image, PDF…). */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Copie une image dans le presse-papiers. Sur ordinateur, coller dans Discord bat télécharger puis
 * glisser. `false` là où `ClipboardItem` n'existe pas (Firefox notamment) : l'appelant garde le
 * téléchargement et le résumé texte.
 */
export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  if (typeof ClipboardItem !== 'function' || !navigator.clipboard?.write) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}
