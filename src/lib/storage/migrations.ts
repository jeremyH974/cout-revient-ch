/** Chaîne de migrations : toute version antérieure → version courante. */
import { isStoredStateV1, withDefaults, type StoredStateV1 } from './schema';

export type MigrationResult = { ok: true; state: StoredStateV1 } | { ok: false; error: string };

export function migrateState(raw: unknown): MigrationResult {
  if (isStoredStateV1(raw)) return { ok: true, state: withDefaults(raw) };
  if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw) {
    return {
      ok: false,
      error: `Version de données inconnue : ${String((raw as { schemaVersion: unknown }).schemaVersion)}.`,
    };
  }
  return { ok: false, error: 'Données illisibles.' };
}
