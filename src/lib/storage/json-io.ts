/** Sauvegarde / restauration JSON (la seule protection contre « vider les données de navigation »). */
import { migrateState } from './migrations';
import { APP_ID, SCHEMA_VERSION, type StoredStateV1 } from './schema';
import { mergeSynced } from './sync/merge';
import { emptySyncMeta } from './sync/types';

export interface BackupFile {
  app: typeof APP_ID;
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  state: StoredStateV1;
}

export function serializeBackup(state: StoredStateV1, exportedAt: string): string {
  const file: BackupFile = { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt, state };
  return JSON.stringify(file, null, 1);
}

export type ParseBackupResult =
  { ok: true; state: StoredStateV1; exportedAt: string | null } | { ok: false; error: string };

export function parseBackup(text: string): ParseBackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Ce fichier n'est pas un JSON valide." };
  }
  const envelope = parsed as Partial<BackupFile> | null;
  const wrapped = envelope !== null && typeof envelope === 'object' && 'state' in envelope;
  // `docs/backup-format.md` annonçait ce refus depuis toujours ; le code ne le faisait pas
  // (décision n° 89). Sans lui, un fichier d'une autre application échouait bien, mais sur sa
  // FORME — message trompeur, et rien ne garantissait qu'une forme voisine soit refusée.
  // Un objet nu, sans enveloppe, reste accepté : c'est la compatibilité d'avant l'enveloppe.
  if (wrapped && envelope.app !== undefined && envelope.app !== APP_ID)
    return {
      ok: false,
      error: `Ce fichier vient d’une autre application (${String(envelope.app)}).`,
    };
  const candidate = wrapped ? envelope.state : parsed;
  const migrated = migrateState(candidate);
  if (!migrated.ok) return { ok: false, error: `Sauvegarde non reconnue : ${migrated.error}` };
  const exportedAt =
    envelope && typeof envelope === 'object' && typeof envelope.exportedAt === 'string'
      ? envelope.exportedAt
      : null;
  return { ok: true, state: migrated.state, exportedAt };
}

/**
 * Fusion « brute » : compatibilité pour les appelants qui ne veulent que l'état résultant, sans le
 * rapport ni les métadonnées de synchronisation (essentiellement des tests écrits avant ce
 * chantier). L'application, elle, appelle `mergeSynced` (`./sync/merge`) directement — c'est la
 * seule façon d'obtenir le rapport affiché à l'écran après une fusion.
 *
 * Sans horodatage connu d'un côté ou de l'autre (`sync` absent — le cas de tout appelant qui
 * construit ses états à la main), chaque clé commune est « héritée » des deux côtés : la règle de
 * conflit hérité s'applique, et `current` (« local ») l'emporte — exactement le comportement
 * historique de cette fonction, avant que la datation n'existe.
 */
export function mergeStates(current: StoredStateV1, incoming: StoredStateV1): StoredStateV1 {
  const { sync: currentSync, ...currentRest } = current;
  const { sync: incomingSync, ...incomingRest } = incoming;
  const result = mergeSynced(
    { state: currentRest as StoredStateV1, sync: currentSync ?? emptySyncMeta() },
    { state: incomingRest as StoredStateV1, sync: incomingSync ?? emptySyncMeta() },
    'legacy-merge-states',
    Date.now(),
  );
  return result.state;
}
