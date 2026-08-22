/** Chaîne de migrations : toute version antérieure → version courante. */
import { isStoredStateV1, sanitizeState, withDefaults, type StoredStateV1 } from './schema';

export type MigrationResult =
  { ok: true; state: StoredStateV1; dropped: number } | { ok: false; error: string };

export function migrateState(raw: unknown): MigrationResult {
  if (isStoredStateV1(raw)) {
    const { state, dropped } = sanitizeState(withDefaults(raw));
    return { ok: true, state, dropped };
  }
  if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw) {
    return {
      ok: false,
      error: `Version de données inconnue : ${String((raw as { schemaVersion: unknown }).schemaVersion)}.`,
    };
  }
  return { ok: false, error: 'Données illisibles.' };
}
