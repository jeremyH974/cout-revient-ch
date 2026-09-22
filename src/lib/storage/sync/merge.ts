/**
 * Fusion CRDT à base d'état : une LWW-map par collection suivie (`sync/tracked.ts`), horloge
 * logique hybride (`sync/hlc.ts`), pierres tombales. Voir `docs/DECISIONS.md` (décision de ce
 * chantier) pour les choix de conception et leurs sources.
 */
import type {
  Account,
  AccountId,
  AssetCode,
  EventId,
  ManualEvent,
  Qualification,
} from '../../domain/types';
import type { AlertEvent, AlertRule, AlertRuleState } from '../../domain/alerts';
import type { DuplicateReview } from '../../domain/reconciliation';
import type { TransferOverride } from '../../domain/transfers';
import type { JournalEntry, ManualTrade } from '../../domain/trading/journal';
import type { HlState } from '../../import/hyperliquid/data';
import {
  MAX_ALERT_EVENTS,
  type AssetSettings,
  type ImportBatchMeta,
  type StoredStateV1,
} from '../schema';
import { canon } from './canon';
import { hlcCompare, hlcMax, hlcTick } from './hlc';
import { pruneRowsForImports } from './import-prune';
import {
  TRACKED_COLLECTIONS,
  readTracked,
  recordToImports,
  type TrackedCollection,
} from './tracked';
import {
  SYNC_META_VERSION,
  type CollectionVersions,
  type EntryVersion,
  type SyncMeta,
} from './types';

export interface MergeInput {
  state: StoredStateV1;
  sync: SyncMeta;
}

export interface CollectionMergeReport {
  added: number;
  updated: number;
  removed: number;
  /** Clés où les deux côtés portaient une valeur héritée (jamais datée) mais différente : la
   *  valeur LOCALE l'a emporté, et vient d'être datée — décision explicite qui se propagera. */
  inheritedConflicts: string[];
}

export type MergeReport = Record<TrackedCollection, CollectionMergeReport>;

export interface MergeResult {
  state: StoredStateV1;
  sync: SyncMeta;
  report: MergeReport;
}

/** Fusion des bruts Hyperliquid : union par clé (`tid`, clés funding / grand livre), compte par compte. */
export function mergeHyperliquid(current: HlState, incoming: HlState): HlState {
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

/** Union bornée des déclenchements d'alertes, la plus récente en tête — inchangé depuis avant ce chantier. */
function mergedAlertEvents(local: AlertEvent[], remote: AlertEvent[]): AlertEvent[] {
  const events = [...local];
  for (const event of remote) if (!events.some((e) => e.id === event.id)) events.push(event);
  events.sort((a, b) => b.at.localeCompare(a.at));
  return events.slice(0, MAX_ALERT_EVENTS);
}

interface CollectionMergeOutcome {
  data: Record<string, unknown>;
  versions: CollectionVersions;
  report: CollectionMergeReport;
  clock: string;
}

/**
 * Fusionne UNE collection suivie. Pour chaque clé présente d'un côté ou de l'autre (valeur OU
 * version) :
 * - version absente mais valeur présente = « héritée » (`t` traité comme `''`) ;
 * - ni valeur ni version = absente, perd contre tout ;
 * - la plus grande `t` gagne (valeur ou suppression) ;
 * - deux héritées identiques → gardée sans version ; différentes → LOCALE gardée, datée (conflit) ;
 * - égalité de `t` non vide (même événement) → présente bat supprimée, puis canon le plus grand.
 */
function mergeCollection(
  name: TrackedCollection,
  local: MergeInput,
  remote: MergeInput,
  clockIn: string,
  deviceId: string,
  wallNowMs: number,
): CollectionMergeOutcome {
  let clock = clockIn;
  const localColl = readTracked(local.state, name);
  const remoteColl = readTracked(remote.state, name);
  const localVersions = local.sync.versions[name] ?? {};
  const remoteVersions = remote.sync.versions[name] ?? {};
  const keys = new Set<string>([
    ...Object.keys(localColl),
    ...Object.keys(remoteColl),
    ...Object.keys(localVersions),
    ...Object.keys(remoteVersions),
  ]);

  const data: Record<string, unknown> = {};
  const versions: CollectionVersions = {};
  let added = 0;
  let updated = 0;
  let removed = 0;
  const inheritedConflicts: string[] = [];

  for (const key of [...keys].sort()) {
    const lHas = key in localColl;
    const rHas = key in remoteColl;
    const lVer = localVersions[key];
    const rVer = remoteVersions[key];
    const lT = lVer ? lVer.t : lHas ? '' : undefined;
    const rT = rVer ? rVer.t : rHas ? '' : undefined;
    if (lT === undefined && rT === undefined) continue;

    let winner: 'local' | 'remote';
    let inheritedConflict = false;

    if (lT === undefined) {
      winner = 'remote';
    } else if (rT === undefined) {
      winner = 'local';
    } else if (lT === '' && rT === '') {
      // Construction ci-dessus : lT/rT === '' exige lHas ET rHas (une version vide n'existe que
      // pour une clé présente sans version enregistrée). Les deux côtés portent donc une valeur.
      winner = 'local';
      if (canon(localColl[key]) !== canon(remoteColl[key])) inheritedConflict = true;
    } else {
      const cmp = hlcCompare(lT, rT);
      if (cmp > 0) winner = 'local';
      else if (cmp < 0) winner = 'remote';
      else {
        const lDel = lVer?.del === true;
        const rDel = rVer?.del === true;
        if (lDel !== rDel) winner = lDel ? 'remote' : 'local';
        else {
          const lc = lHas ? canon(localColl[key]) : '';
          const rc = rHas ? canon(remoteColl[key]) : '';
          winner = lc >= rc ? 'local' : 'remote';
        }
      }
    }

    let winHas: boolean;
    let winVal: unknown;
    let outVersion: EntryVersion | undefined;

    if (inheritedConflict) {
      clock = hlcTick(clock, wallNowMs, deviceId);
      outVersion = { t: clock };
      winHas = true;
      winVal = localColl[key];
      inheritedConflicts.push(key);
    } else if (winner === 'local') {
      winHas = lHas;
      winVal = localColl[key];
      outVersion = lVer;
    } else {
      winHas = rHas;
      winVal = remoteColl[key];
      outVersion = rVer;
    }

    if (winHas) data[key] = winVal;
    if (outVersion) versions[key] = outVersion;

    if (!lHas && winHas) added++;
    else if (lHas && winHas && canon(winVal) !== canon(localColl[key])) updated++;
    else if (lHas && !winHas) removed++;
  }

  return { data, versions, report: { added, updated, removed, inheritedConflicts }, clock };
}

/**
 * Fusion complète : LWW par enregistrement sur les collections suivies, union par clé sur les
 * collections de faits immuables (`rawRows`, `pivotRows`, `hyperliquid`, `lending`,
 * `alerts.events`), état de l'appareil LOCAL conservé pour les réglages (`engineSettings`,
 * `priceCache`, `fx`, `ui`, `alerts.settings`) — puis élagage déterministe des données qui
 * dépendent d'une collection suivie devenue pierre tombale.
 */
export function mergeSynced(
  local: MergeInput,
  remote: MergeInput,
  deviceId: string,
  wallNowMs: number,
): MergeResult {
  let clock = hlcMax(local.sync.clock, remote.sync.clock);
  const versions: SyncMeta['versions'] = {};
  const report = {} as MergeReport;
  const tracked: Partial<Record<TrackedCollection, Record<string, unknown>>> = {};

  for (const name of TRACKED_COLLECTIONS) {
    const outcome = mergeCollection(name, local, remote, clock, deviceId, wallNowMs);
    clock = outcome.clock;
    tracked[name] = outcome.data;
    if (Object.keys(outcome.versions).length > 0) versions[name] = outcome.versions;
    report[name] = outcome.report;
  }

  // --- Élagage déterministe -----------------------------------------------------------------
  // 1) Lignes brutes/pivot des lots d'import devenus pierres tombales : règle EXACTE d'`undoImport`.
  const tombstonedImports = new Set(
    Object.entries(versions.imports ?? {})
      .filter(([, v]) => v.del === true)
      .map(([id]) => id),
  );
  const rawUnion = { ...remote.state.rawRows, ...local.state.rawRows };
  const pivotUnion = { ...remote.state.pivotRows, ...local.state.pivotRows };
  const pruned = pruneRowsForImports(
    rawUnion,
    pivotUnion,
    tracked.qualifications! as Record<EventId, Qualification>,
    tombstonedImports,
  );

  // 2) `hyperliquid.accounts[id]` (et rien d'autre : `hyperliquid` reste une union de faits) des
  //    comptes devenus pierres tombales. Sur une pierre tombale EXPLICITE seulement (`del: true`),
  //    jamais sur une simple absence : `accounts` peut légitimement ignorer un identifiant que
  //    `hyperliquid.accounts` connaît déjà (fixture de test isolée, sauvegarde ancienne) sans que
  //    ce soit une suppression — élaguer sur une absence perdrait alors des bruts synchronisés
  //    pour de bon. Le pire d'un tombstone manqué est une entrée orpheline inoffensive ; le pire
  //    d'une absence mal interprétée serait une perte de données.
  const accountVersions = versions.accounts ?? {};
  const finalAccounts = tracked.accounts! as Record<AccountId, Account>;
  const hyperliquid = mergeHyperliquid(local.state.hyperliquid, remote.state.hyperliquid);
  for (const id of Object.keys(hyperliquid.accounts)) {
    if (accountVersions[id]?.del === true) delete hyperliquid.accounts[id];
  }

  // 3) `alerts.states` des règles devenues pierres tombales — même principe : une pierre tombale
  //    EXPLICITE, jamais une simple absence (`sanitizeState` reste le filet pour l'orphelin qui
  //    n'aurait jamais été une suppression, ex. un état sans règle dès la sauvegarde d'origine).
  const ruleVersions = versions['alerts.rules'] ?? {};
  const finalRules = tracked['alerts.rules']! as Record<string, AlertRule>;
  const alertStates = { ...(tracked['alerts.states']! as Record<string, AlertRuleState>) };
  for (const id of Object.keys(alertStates))
    if (ruleVersions[id]?.del === true) delete alertStates[id];

  const state: StoredStateV1 = {
    ...local.state,
    imports: recordToImports(tracked.imports!) as ImportBatchMeta[],
    manualEvents: tracked.manualEvents! as Record<string, ManualEvent>,
    qualifications: pruned.qualifications,
    transferOverrides: tracked.transferOverrides! as Record<EventId, TransferOverride>,
    duplicateOverrides: tracked.duplicateOverrides! as Record<string, DuplicateReview>,
    taxAnnotations: tracked.taxAnnotations! as StoredStateV1['taxAnnotations'],
    assetSettings: tracked.assetSettings! as Record<AssetCode, AssetSettings>,
    accounts: finalAccounts,
    journal: tracked.journal! as Record<string, JournalEntry>,
    manualTrades: tracked.manualTrades! as Record<string, ManualTrade>,
    rawRows: pruned.rawRows,
    pivotRows: pruned.pivotRows,
    hyperliquid,
    lending: {
      loans: { ...remote.state.lending.loans, ...local.state.lending.loans },
      events: { ...remote.state.lending.events, ...local.state.lending.events },
      wallet: { ...remote.state.lending.wallet, ...local.state.lending.wallet },
    },
    alerts: {
      rules: finalRules,
      states: alertStates,
      events: mergedAlertEvents(local.state.alerts.events, remote.state.alerts.events),
      settings: local.state.alerts.settings,
    },
    // schemaVersion, engineSettings, priceCache, fx, ui : réglages locaux, déjà repris ci-dessus
    // par `...local.state` (§ `docs/backup-format.md` Fusion).
  };

  return { state, sync: { v: SYNC_META_VERSION, clock, versions }, report };
}

export interface MergeSummary {
  added: number;
  updated: number;
  removed: number;
  inheritedConflicts: number;
}

/** Agrège le rapport par collection en quatre nombres — le texte affiché après une fusion. */
export function summarizeMergeReport(report: MergeReport): MergeSummary {
  const summary: MergeSummary = { added: 0, updated: 0, removed: 0, inheritedConflicts: 0 };
  for (const collection of Object.values(report)) {
    summary.added += collection.added;
    summary.updated += collection.updated;
    summary.removed += collection.removed;
    summary.inheritedConflicts += collection.inheritedConflicts.length;
  }
  return summary;
}
