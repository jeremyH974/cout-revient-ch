/** Façade d'import pivot : texte CSV → lignes brutes dédoublonnées par compte + rapport. */
import type { AccountId, EventId, Qualification, RawPivotRow, RowKey } from '../../domain/types';
import { parseCsvText } from '../csv';
import { detectPivotFormat, type PivotFormat } from './detect';
import { pivotLedgerEvents, type UsdRate } from './events';
import { parsePivotRows, pivotRowsEqual, type PivotIssue } from './rows';

export interface PivotImportReport {
  format: PivotFormat;
  header: string[];
  unknownColumns: string[];
  totalRows: number;
  parsedRows: number;
  newRows: number;
  duplicateRows: number;
  conflictingRows: number;
  issues: PivotIssue[];
  warnings: string[];
  counts: {
    trades: number;
    rewards: number;
    deposits: number;
    withdrawals: number;
    fees: number;
    unqualified: number;
    skippedCash: number;
  };
  assets: string[];
  period: { from: string; to: string } | null;
}

export type PivotImportResult =
  | { ok: true; rows: Record<RowKey, RawPivotRow>; report: PivotImportReport }
  | { ok: false; error: string; details: string[]; header: string[] };

export function importPivotCsv(
  text: string,
  existing: Record<RowKey, RawPivotRow>,
  accountId: AccountId,
  importId: string,
  usdRate: UsdRate,
  qualifications: Record<EventId, Qualification> = {},
): PivotImportResult {
  const table = parseCsvText(text);
  const detection = detectPivotFormat(table.header);
  if (!detection.ok) {
    return {
      ok: false,
      error: 'Ce fichier ne ressemble ni à un CSV Koinly « Universal », ni à un export Koinly.',
      details:
        detection.reason === 'empty'
          ? ['Le fichier est vide.']
          : [
              `Colonnes manquantes : ${detection.missing.join(', ')}.`,
              `Colonnes trouvées : ${detection.found.join(', ') || '(aucune)'}.`,
            ],
      header: table.header,
    };
  }
  const warnings: string[] = [];
  if (detection.unknownColumns.length > 0)
    warnings.push(`Colonnes inconnues ignorées : ${detection.unknownColumns.join(', ')}.`);
  const parsed = parsePivotRows(table, detection.columns, importId, accountId);
  if (parsed.rows.length === 0) {
    return {
      ok: false,
      error: 'Aucune ligne exploitable dans ce fichier.',
      details: parsed.issues.map((i) => `Ligne ${i.lineNo} : ${i.message}`),
      header: table.header,
    };
  }

  const merged: Record<RowKey, RawPivotRow> = { ...existing };
  let newRows = 0;
  let duplicateRows = 0;
  let conflictingRows = 0;
  for (const row of parsed.rows) {
    const current = merged[row.key];
    if (!current) {
      merged[row.key] = row;
      newRows++;
    } else if (pivotRowsEqual(current, row)) duplicateRows++;
    else {
      conflictingRows++;
      warnings.push(
        `Ligne ${row.lineNo} : même clé (${row.key}) mais contenu différent ; la version déjà importée est conservée.`,
      );
    }
  }

  const accountRows = Object.values(merged).filter((r) => r.accountId === accountId);
  const { events, skippedCash } = pivotLedgerEvents(accountRows, qualifications, usdRate);
  const counts = {
    trades: 0,
    rewards: 0,
    deposits: 0,
    withdrawals: 0,
    fees: 0,
    unqualified: 0,
    skippedCash,
  };
  for (const event of events) {
    if (event.kind === 'trade') counts.trades++;
    else if (event.kind === 'reward') counts.rewards++;
    else if (event.kind === 'deposit') counts.deposits++;
    else if (event.kind === 'withdrawal') counts.withdrawals++;
    else if (event.kind === 'fee') counts.fees++;
    else if (event.kind === 'unqualified') counts.unqualified++;
  }
  const dates = parsed.rows.map((r) => r.at).sort();
  const assets = [
    ...new Set(
      parsed.rows.flatMap((r) =>
        [r.sent?.currency, r.received?.currency].filter((c): c is string => c !== undefined),
      ),
    ),
  ].sort();
  return {
    ok: true,
    rows: merged,
    report: {
      format: detection.format,
      header: table.header,
      unknownColumns: detection.unknownColumns,
      totalRows: table.rows.length,
      parsedRows: parsed.rows.length,
      newRows,
      duplicateRows,
      conflictingRows,
      issues: parsed.issues,
      warnings,
      counts,
      assets,
      period: dates.length > 0 ? { from: dates[0]!, to: dates[dates.length - 1]! } : null,
    },
  };
}
