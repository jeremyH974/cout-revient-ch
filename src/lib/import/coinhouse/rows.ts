/** Conversion des cellules CSV en lignes brutes typées (chaînes décimales canoniques). */
import { normalizeAssetCode } from '../../domain/assets';
import { fnv1a32 } from '../../domain/hash';
import { D, isDecimalString, toDecimalString } from '../../domain/money';
import type { DecimalString, NaiveDateTime, RawCoinhouseRow, RowKey } from '../../domain/types';
import type { CsvTable } from '../csv';
import type { ColumnMap, LogicalColumn } from './detect';

export interface RowIssue {
  lineNo: number;
  column: LogicalColumn | null;
  message: string;
}

const DATE_FR = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?$/;

function plausible(y: string, mo: string, d: string, h: string, mi: string, s: string): boolean {
  const [Y, M, Dd, H, Mi, S] = [y, mo, d, h, mi, s].map(Number);
  return (
    Y! >= 2000 && M! >= 1 && M! <= 12 && Dd! >= 1 && Dd! <= 31 && H! < 24 && Mi! < 60 && S! < 60
  );
}

/** `dd/MM/yyyy HH:mm[:ss]` (Coinhouse) ou ISO → `YYYY-MM-DDTHH:mm:ss`, sans fuseau. */
export function parseNaiveDateTime(raw: string): NaiveDateTime | null {
  const value = raw.trim();
  const fr = DATE_FR.exec(value);
  if (fr) {
    const [, d, mo, y, h, mi, s = '00'] = fr;
    return plausible(y!, mo!, d!, h!, mi!, s) ? `${y}-${mo}-${d}T${h}:${mi}:${s}` : null;
  }
  const iso = DATE_ISO.exec(value);
  if (iso) {
    const [, y, mo, d, h, mi, s = '00'] = iso;
    return plausible(y!, mo!, d!, h!, mi!, s) ? `${y}-${mo}-${d}T${h}:${mi}:${s}` : null;
  }
  return null;
}

const NUMBER_FR = /^-?\d{1,3}(?:[ \u00a0\u202f]\d{3})*(?:,\d+)?$|^-?\d+,\d+$/;

export type NumberCell =
  { kind: 'empty' } | { kind: 'invalid' } | { kind: 'ok'; value: DecimalString };

/** Nombre canonique ('1234.5') ou variante tableur ('1 234,5') ; jamais de flottant. */
export function parseNumberCell(raw: string): NumberCell {
  const value = raw.trim();
  if (value === '') return { kind: 'empty' };
  if (isDecimalString(value)) return { kind: 'ok', value: toDecimalString(D(value)) };
  if (NUMBER_FR.test(value)) {
    const canonical = value.replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
    return { kind: 'ok', value: toDecimalString(D(canonical)) };
  }
  return { kind: 'invalid' };
}

export function rowKeyFor(
  id: string | null,
  asset: string,
  at: NaiveDateTime,
  type: string,
  qty: DecimalString,
  valueEur: DecimalString | null,
): RowKey {
  if (id) return `ch:${id}:${asset}`;
  return `ch:h:${fnv1a32([at, type, qty, asset, valueEur ?? ''].join('|'))}`;
}

export interface ParsedRows {
  rows: RawCoinhouseRow[];
  issues: RowIssue[];
}

export function parseCoinhouseRows(
  table: CsvTable,
  columns: ColumnMap,
  importId: string,
): ParsedRows {
  const rows: RawCoinhouseRow[] = [];
  const issues: RowIssue[] = [];
  const cell = (row: string[], c: LogicalColumn): string =>
    columns[c] === null ? '' : (row[columns[c]] ?? '');
  const knownIndexes = new Set(Object.values(columns).filter((i): i is number => i !== null));

  table.rows.forEach((raw, i) => {
    const lineNo = table.lineNumbers[i] ?? i + 2;
    const fail = (column: LogicalColumn | null, message: string): void => {
      issues.push({ lineNo, column, message });
    };
    const at = parseNaiveDateTime(cell(raw, 'date'));
    if (!at) return fail('date', `Date illisible : « ${cell(raw, 'date')} »`);
    const type = cell(raw, 'type').trim();
    if (!type) return fail('type', 'Type de transaction vide');
    const asset = normalizeAssetCode(cell(raw, 'asset'));
    if (!asset) return fail('asset', 'Devise vide');
    const qty = parseNumberCell(cell(raw, 'qty'));
    if (qty.kind !== 'ok') return fail('qty', `Quantité illisible : « ${cell(raw, 'qty')} »`);

    const optional = (c: LogicalColumn): DecimalString | null => {
      const parsed = parseNumberCell(cell(raw, c));
      if (parsed.kind === 'ok') return parsed.value;
      if (parsed.kind === 'invalid') fail(c, `Nombre illisible : « ${cell(raw, c)} »`);
      return null;
    };
    const valueEur = optional('valueEur');
    const idRaw = cell(raw, 'id').trim();
    const extra: Record<string, string> = {};
    raw.forEach((value, index) => {
      if (!knownIndexes.has(index) && value.trim() !== '') {
        extra[table.header[index] ?? `col${index}`] = value;
      }
    });
    rows.push({
      key: rowKeyFor(idRaw || null, asset, at, type, qty.value, valueEur),
      importId,
      lineNo,
      id: idRaw || null,
      at,
      type,
      qty: qty.value,
      asset,
      marketPrice: optional('marketPrice'),
      valueEur,
      feeAsset: optional('feeAsset'),
      feeEur: optional('feeEur'),
      feeRebate: optional('feeRebate'),
      balance: optional('balance'),
      account: cell(raw, 'account').trim(),
      extra,
    });
  });
  return { rows, issues };
}
