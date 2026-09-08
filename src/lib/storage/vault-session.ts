/**
 * La session du coffre : où vit l'en-tête, et où vit la clé pendant que l'application est ouverte.
 *
 * ## Deux durées de vie, délibérément différentes
 *
 * L'**en-tête** (`VaultMeta`) est persistant : il vit dans le magasin `meta` d'IndexedDB, à côté du
 * dossier de sauvegarde automatique. Il ne contient aucun secret — un sel et une clé scellée sont
 * inertes sans le mot de passe —, donc le stocker en clair ne coûte rien et permet à l'application
 * de savoir, au démarrage, qu'elle doit demander à s'ouvrir.
 *
 * La **clé**, elle, ne vit qu'en mémoire vive, dans ce module, et n'est jamais écrite nulle part.
 * Rechargez l'onglet : le coffre est refermé. C'est le même choix que pour la clé d'API Anthropic
 * (`src/state/ai-key.svelte.ts`), et pour la même raison : ce qu'on n'écrit pas ne peut pas être
 * relu par une sauvegarde, une extension, ou le prochain qui ouvrira ce profil de navigateur.
 *
 * Corollaire à ne pas perdre de vue : un coffre déverrouillé l'est pour **tous les onglets** de
 * cette origine, mais chacun garde sa propre copie de la clé en mémoire — un onglet ouvert avant le
 * déverrouillage reste fermé jusqu'à son propre rechargement.
 */
import { idbMetaDelete, idbMetaGet, idbMetaSet } from './idb-state-store';
import { isVaultMeta, type VaultMeta } from './vault';

const META_KEY = 'vault';

/** La clé ouverte. `null` = coffre fermé (ou inexistant). Jamais sérialisée, jamais exportée. */
let armed: CryptoKey | null = null;
/** L'en-tête chargé, gardé sous la main pour le changement de mot de passe. */
let meta: VaultMeta | null = null;

/** Lit l'en-tête depuis IndexedDB. `null` si aucun coffre n'a été installé sur cet appareil. */
export async function readVaultMeta(): Promise<VaultMeta | null> {
  try {
    const stored = await idbMetaGet<unknown>(META_KEY);
    return isVaultMeta(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function writeVaultMeta(next: VaultMeta): Promise<void> {
  await idbMetaSet(META_KEY, next);
  meta = next;
}

export async function deleteVaultMeta(): Promise<void> {
  await idbMetaDelete(META_KEY);
  meta = null;
}

/** Ouvre la session : la clé devient disponible pour sceller et ouvrir l'état. */
export function armVault(next: VaultMeta, key: CryptoKey): void {
  meta = next;
  armed = key;
}

/** Referme la session sans toucher aux données : elles restent chiffrées, l'en-tête reste en place. */
export function disarmVault(): void {
  armed = null;
}

/** La clé de la session, ou `null`. Le seul point d'accès — rien d'autre ne détient la clé. */
export function vaultKey(): CryptoKey | null {
  return armed;
}

/** L'en-tête en mémoire, sans relire IndexedDB. */
export function armedVaultMeta(): VaultMeta | null {
  return meta;
}

/** L'application doit-elle demander un mot de passe ? Vrai si un coffre existe et reste fermé. */
export async function isVaultLocked(): Promise<boolean> {
  if (armed !== null) return false;
  return (await readVaultMeta()) !== null;
}

/** Tests : remet le module dans l'état d'un premier chargement. */
export function resetVaultSessionForTests(): void {
  armed = null;
  meta = null;
}
