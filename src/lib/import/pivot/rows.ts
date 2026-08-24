/**
 * Lignes du CSV pivot : validation (date UTC, montants décimaux à point, devise obligatoire avec
 * tout montant) et clé stable par hachage de contenu — le TxHash seul ne suffit pas (optionnel, et
 * une même transaction on-chain peut produire plusieurs lignes). Deux lignes strictement
 * identiques dans un même fichier sont des opérations distinctes : suffixe `#n` déterministe.
 */
import { normalizeAssetCode } from '../../domain/assets';
import { D } from '../../domain/money';
import type { AccountId, PivotAmount, RawPivotRow } from '../../domain/types';
import type { CsvTable } from '../csv';
import { msToParisNaive, utcStringToMs } from '../time';
import type { PivotField } from './detect';

export interface PivotIssue {
  lineNo: number;
  message: string;
}

/** Montant décimal à point, signe toléré (certains exports signent la colonne « envoyé »). */
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

interface ParsedAmount {
  value: PivotAmount | null;
  error: string | null;
}

function parseAmount(
  rawAmount: string | undefined,
  rawCurrency: string | undefined,
  what: string,
): ParsedAmount {
  const amount = (rawAmount ?? '').trim();
  const currency = (rawCurrency ?? '').trim();
  if (amount === '' && currency === '') return { value: null, error: null };
  if (amount === '' || currency === '')
    return { value: null, error: `${what} : montant et devise vont ensemble.` };
  if (!DECIMAL.test(amount))
    return {
      value: null,
      error: `${what} : montant illisible « ${amount} » (point décimal attendu).`,
    };
  const abs = D(amount).abs();
  if (abs.eq(D('0'))) return { value: null, error: null };
  return {
    value: { amount: abs.toString(), currency: normalizeAssetCode(currency) },
    error: null,
  };
}

export interface ParsedPivotRows {
  rows: RawPivotRow[];
  issues: PivotIssue[];
}

export function parsePivotRows(
  table: CsvTable,
  columns: Partial<Record<PivotField, number>>,
  importId: string,
  accountId: AccountId,
): ParsedPivotRows {
  const rows: RawPivotRow[] = [];
  const issues: PivotIssue[] = [];
  const cell = (row: string[], field: PivotField): string | undefined => {
    const index = columns[field];
    return index === undefined ? undefined : row[index];
  };
  const seen = new Map<string, number>();
  table.rows.forEach((raw, i) => {
    const lineNo = table.lineNumbers[i]!;
    const date = (cell(raw, 'date') ?? '').trim();
    const ms = utcStringToMs(date);
    if (ms === null) {
      issues.push({
        lineNo,
        message: `Date illisible « ${date} » (attendu YYYY-MM-DD HH:mm:ss, en UTC).`,
      });
      return;
    }
    const sent = parseAmount(cell(raw, 'sentAmount'), cell(raw, 'sentCurrency'), 'Envoyé');
    const received = parseAmount(
      cell(raw, 'receivedAmount'),
      cell(raw, 'receivedCurrency'),
      'Reçu',
    );
    const fee = parseAmount(cell(raw, 'feeAmount'), cell(raw, 'feeCurrency'), 'Frais');
    const netWorth = parseAmount(
      cell(raw, 'netWorthAmount'),
      cell(raw, 'netWorthCurrency'),
      'Net Worth',
    );
    const error = sent.error ?? received.error ?? fee.error ?? netWorth.error;
    if (error) {
      issues.push({ lineNo, message: error });
      return;
    }
    if (sent.value === null && received.value === null) {
      issues.push({ lineNo, message: 'Ligne sans montant envoyé ni reçu : ignorée.' });
      return;
    }
    const labelRaw = (cell(raw, 'label') ?? '').trim().toLowerCase();
    const descriptionRaw = (cell(raw, 'description') ?? '').trim();
    const txHashRaw = (cell(raw, 'txHash') ?? '').trim();
    const amountKey = (a: PivotAmount | null): string =>
      a === null ? '' : `${a.amount}@${a.currency}`;
    const content = [
      date,
      amountKey(sent.value),
      amountKey(received.value),
      amountKey(fee.value),
      amountKey(netWorth.value),
      labelRaw,
      descriptionRaw,
      txHashRaw,
    ].join('|');
    const hash = fnv1a(content);
    const occurrence = (seen.get(hash) ?? 0) + 1;
    seen.set(hash, occurrence);
    const key = `pv:${accountId}:${hash}${occurrence > 1 ? `#${occurrence}` : ''}`;
    rows.push({
      key,
      importId,
      lineNo,
      accountId,
      date,
      at: msToParisNaive(ms),
      sent: sent.value,
      received: received.value,
      fee: fee.value,
      netWorth: netWorth.value,
      label: labelRaw === '' ? null : labelRaw,
      description: descriptionRaw === '' ? null : descriptionRaw,
      txHash: txHashRaw === '' ? null : txHashRaw,
    });
  });
  return { rows, issues };
}

/** Deux lignes sont « identiques » si tout leur contenu métier coïncide (hors métadonnées). */
export function pivotRowsEqual(a: RawPivotRow, b: RawPivotRow): boolean {
  const amount = (x: PivotAmount | null): string => (x ? `${x.amount}@${x.currency}` : '');
  return (
    a.accountId === b.accountId &&
    a.date === b.date &&
    amount(a.sent) === amount(b.sent) &&
    amount(a.received) === amount(b.received) &&
    amount(a.fee) === amount(b.fee) &&
    amount(a.netWorth) === amount(b.netWorth) &&
    a.label === b.label &&
    a.description === b.description &&
    a.txHash === b.txHash
  );
}
