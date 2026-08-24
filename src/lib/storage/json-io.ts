/** Sauvegarde / restauration JSON (la seule protection contre « vider les données de navigation »). */
import type { HlState } from '../import/hyperliquid/data';
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

/** Fusion des bruts Hyperliquid : union par clé (`tid`, clés funding / grand livre), compte par compte. */
function mergeHyperliquid(current: HlState, incoming: HlState): HlState {
  const accounts: HlState['accounts'] = { ...incoming.accounts };
  for (const [id, mine] of Object.entries(current.accounts)) {
    const theirs = incoming.accounts[id];
    accounts[id] = theirs
      ? {
          ...mine,
          fills: { ...theirs.fills, ...mine.fills },
          funding: { ...theirs.funding, ...mine.funding },
          ledger: { ...theirs.ledger, ...mine.ledger },
          cursors: {
            fills: maxOrNull(mine.cursors.fills, theirs.cursors.fills),
            funding: maxOrNull(mine.cursors.funding, theirs.cursors.funding),
            ledger: maxOrNull(mine.cursors.ledger, theirs.cursors.ledger),
          },
          snapshot: newest(mine.snapshot, theirs.snapshot),
          lastSyncAt:
            mine.lastSyncAt && theirs.lastSyncAt
              ? mine.lastSyncAt > theirs.lastSyncAt
                ? mine.lastSyncAt
                : theirs.lastSyncAt
              : (mine.lastSyncAt ?? theirs.lastSyncAt),
        }
      : mine;
  }
  return { accounts, spotPairs: { ...incoming.spotPairs, ...current.spotPairs } };
}

const maxOrNull = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b);
const newest = <T extends { at: string }>(a: T | null, b: T | null): T | null =>
  a === null ? b : b === null ? a : a.at >= b.at ? a : b;

/** Fusion : union des lignes, saisies et qualifications ; réglages de l'état courant conservés. */
export function mergeStates(current: StoredStateV1, incoming: StoredStateV1): StoredStateV1 {
  const imports = [...current.imports];
  for (const batch of incoming.imports)
    if (!imports.some((b) => b.id === batch.id)) imports.push(batch);
  return {
    ...current,
    imports,
    rawRows: { ...incoming.rawRows, ...current.rawRows },
    pivotRows: { ...incoming.pivotRows, ...current.pivotRows },
    manualEvents: { ...incoming.manualEvents, ...current.manualEvents },
    qualifications: { ...incoming.qualifications, ...current.qualifications },
    transferOverrides: { ...incoming.transferOverrides, ...current.transferOverrides },
    taxAnnotations: { ...incoming.taxAnnotations, ...current.taxAnnotations },
    assetSettings: { ...incoming.assetSettings, ...current.assetSettings },
    accounts: { ...incoming.accounts, ...current.accounts },
    hyperliquid: mergeHyperliquid(current.hyperliquid, incoming.hyperliquid),
    journal: { ...incoming.journal, ...current.journal },
    manualTrades: { ...incoming.manualTrades, ...current.manualTrades },
  };
}
