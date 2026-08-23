/** Façade d'import : texte CSV → lignes brutes dédoublonnées + rapport. */
import type { RawCoinhouseRow, RowKey } from '../../domain/types';
import { parseCsvText } from '../csv';
import { detectCoinhouseFormat, detectExcelMangling } from './detect';
import { normalizeCoinhouseRows } from './normalize';
import { parseCoinhouseRows, type RowIssue } from './rows';

export interface ImportReport {
  format: string;
  /** En-têtes tels que lus dans le fichier (diagnostic : jamais de données). */
  header: string[];
  unknownColumns: string[];
  totalRows: number;
  parsedRows: number;
  newRows: number;
  duplicateRows: number;
  conflictingRows: number;
  issues: RowIssue[];
  warnings: string[];
  counts: {
    trades: number;
    migrations: number;
    fees: number;
    unqualified: number;
    orphanLegs: number;
  };
  assets: string[];
  period: { from: string; to: string } | null;
}

export type ImportResult =
  | { ok: true; rows: Record<RowKey, RawCoinhouseRow>; report: ImportReport }
  | { ok: false; error: string; details: string[]; header: string[] };

/** Deux lignes sont « identiques » si tout leur contenu métier coïncide (hors métadonnées d'import). */
export function rowsEqual(a: RawCoinhouseRow, b: RawCoinhouseRow): boolean {
  return (
    a.id === b.id &&
    a.at === b.at &&
    a.type === b.type &&
    a.qty === b.qty &&
    a.asset === b.asset &&
    a.marketPrice === b.marketPrice &&
    a.valueEur === b.valueEur &&
    a.feeAsset === b.feeAsset &&
    a.feeEur === b.feeEur &&
    a.feeRebate === b.feeRebate &&
    a.balance === b.balance &&
    a.account === b.account
  );
}

export function importCoinhouseCsv(
  text: string,
  existing: Record<RowKey, RawCoinhouseRow>,
  importId: string,
): ImportResult {
  const table = parseCsvText(text);
  const detection = detectCoinhouseFormat(table.header);
  if (!detection.ok) {
    // Date, type, quantité et devise présentes mais pas la contre-valeur : très probablement
    // l'« Export basique » de Coinhouse, inexploitable pour un coût de revient (structure exacte
    // de cet export non vérifiée : message prudent, même orientation que l'aide).
    const basic =
      detection.reason === 'missing-columns' &&
      detection.missing.includes('valueEur') &&
      (['date', 'type', 'qty', 'asset'] as const).every((c) => !detection.missing.includes(c));
    const details =
      detection.reason === 'empty'
        ? ['Le fichier est vide.']
        : [
            `Colonnes manquantes : ${detection.missing.join(', ')}.`,
            `Colonnes trouvées : ${detection.found.join(', ') || '(aucune)'}.`,
            ...(basic
              ? [
                  'Dans l’application Coinhouse : Vos transactions → Exporter → choisissez « Export avancé » (l’export basique n’a pas la colonne « Contre-valeur (EUR) »).',
                ]
              : []),
          ];
    return {
      ok: false,
      error: basic
        ? 'Ce fichier ressemble à l’« Export basique » de Coinhouse : il manque la contre-valeur en euros.'
        : 'Ce fichier ne ressemble pas à un export Coinhouse.',
      details,
      header: table.header,
    };
  }
  const warnings = detectExcelMangling(table, detection.columns);
  if (detection.unknownColumns.length > 0) {
    warnings.push(`Colonnes inconnues conservées : ${detection.unknownColumns.join(', ')}.`);
  }
  const parsed = parseCoinhouseRows(table, detection.columns, importId);
  if (parsed.rows.length === 0) {
    return {
      ok: false,
      error: 'Aucune ligne exploitable dans ce fichier.',
      details: parsed.issues.map((i) => `Ligne ${i.lineNo} : ${i.message}`),
      header: table.header,
    };
  }

  const merged: Record<RowKey, RawCoinhouseRow> = { ...existing };
  let newRows = 0;
  let duplicateRows = 0;
  let conflictingRows = 0;
  for (const row of parsed.rows) {
    const current = merged[row.key];
    if (!current) {
      merged[row.key] = row;
      newRows++;
    } else if (rowsEqual(current, row)) duplicateRows++;
    else {
      conflictingRows++;
      warnings.push(
        `Ligne ${row.lineNo} : même identifiant (${row.id ?? row.key}) mais contenu différent ; la version déjà importée est conservée.`,
      );
    }
  }

  const normalized = normalizeCoinhouseRows(Object.values(merged));
  const counts = { trades: 0, migrations: 0, fees: 0, unqualified: 0, orphanLegs: 0 };
  for (const event of normalized.events) {
    if (event.kind === 'trade') counts.trades++;
    else if (event.kind === 'migration') counts.migrations++;
    else if (event.kind === 'fee') counts.fees++;
    else if (event.kind === 'unqualified') {
      counts.unqualified++;
      if (event.reason.startsWith('Jambe orpheline')) counts.orphanLegs++;
    }
  }
  const dates = parsed.rows.map((r) => r.at).sort();
  const assets = [...new Set(parsed.rows.map((r) => r.asset))].sort();
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
