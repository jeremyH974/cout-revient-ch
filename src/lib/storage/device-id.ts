/**
 * Identité STABLE de cet appareil (ce navigateur, cette origine) : sert à dater les modifications
 * (horloge logique hybride, `sync/hlc.ts`). Vit dans le magasin `meta` d'IndexedDB — même patron
 * que le handle de dossier de `backup-folder.ts` et l'en-tête du coffre de `vault-session.ts` —
 * JAMAIS dans `StoredStateV1` ni dans une sauvegarde : deux appareils ne doivent jamais se
 * retrouver à partager un identifiant. La variante privée (`crch.localhost`), le site public et le
 * téléphone sont trois ORIGINES distinctes ; IndexedDB n'étant pas partagé entre elles, chacune
 * obtient naturellement le sien au premier chargement.
 */
import { idbMetaGet, idbMetaSet } from './idb-state-store';

const META_KEY = 'deviceId';

export async function loadOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await idbMetaGet<string>(META_KEY);
    if (typeof existing === 'string' && existing !== '') return existing;
  } catch {
    /* IndexedDB indisponible : identifiant de repli ci-dessous, valable pour cette session seule */
  }
  const fresh = crypto.randomUUID();
  try {
    await idbMetaSet(META_KEY, fresh);
  } catch {
    /* échec d'écriture : l'identifiant vaudra pour cette session seulement, sans persister */
  }
  return fresh;
}
