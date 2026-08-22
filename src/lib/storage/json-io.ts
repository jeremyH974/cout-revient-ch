/** Sauvegarde / restauration JSON (la seule protection contre « vider les données de navigation »). */
import { migrateState } from './migrations';
import { APP_ID, SCHEMA_VERSION, type StoredStateV1 } from './schema';

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
  const candidate =
    envelope && typeof envelope === 'object' && 'state' in envelope ? envelope.state : parsed;
  const migrated = migrateState(candidate);
  if (!migrated.ok) return { ok: false, error: `Sauvegarde non reconnue : ${migrated.error}` };
  const exportedAt =
    envelope && typeof envelope === 'object' && typeof envelope.exportedAt === 'string'
      ? envelope.exportedAt
      : null;
  return { ok: true, state: migrated.state, exportedAt };
}

/** Fusion : union des lignes, saisies et qualifications ; réglages de l'état courant conservés. */
export function mergeStates(current: StoredStateV1, incoming: StoredStateV1): StoredStateV1 {
  const imports = [...current.imports];
  for (const batch of incoming.imports)
    if (!imports.some((b) => b.id === batch.id)) imports.push(batch);
  return {
    ...current,
    imports,
    rawRows: { ...incoming.rawRows, ...current.rawRows },
    manualEvents: { ...incoming.manualEvents, ...current.manualEvents },
    qualifications: { ...incoming.qualifications, ...current.qualifications },
    taxAnnotations: { ...incoming.taxAnnotations, ...current.taxAnnotations },
    assetSettings: { ...incoming.assetSettings, ...current.assetSettings },
  };
}
