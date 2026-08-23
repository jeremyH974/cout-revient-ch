/**
 * Détection du format pivot : CSV « Custom / Universal » de Koinly (colonnes Sent/Received) ou
 * export interne Koinly « Bulk edit → Export » (colonnes From/To + Tag), celui que Waltio ingère.
 * Les deux convergent vers le même `RawPivotRow`. Voir docs/pivot-import.md.
 */

export type PivotFormat = 'koinly-universal' | 'koinly-export';

export type PivotField =
  | 'date'
  | 'sentAmount'
  | 'sentCurrency'
  | 'receivedAmount'
  | 'receivedCurrency'
  | 'feeAmount'
  | 'feeCurrency'
  | 'netWorthAmount'
  | 'netWorthCurrency'
  | 'label'
  | 'description'
  | 'txHash';

/** En-têtes acceptés par champ (comparaison insensible à la casse et aux espaces multiples). */
const HEADERS: Record<PivotField, readonly string[]> = {
  date: ['date', 'date (utc)'],
  sentAmount: ['sent amount', 'from amount'],
  sentCurrency: ['sent currency', 'from currency'],
  receivedAmount: ['received amount', 'to amount'],
  receivedCurrency: ['received currency', 'to currency'],
  feeAmount: ['fee amount'],
  feeCurrency: ['fee currency'],
  netWorthAmount: ['net worth amount'],
  netWorthCurrency: ['net worth currency'],
  label: ['label', 'tag'],
  description: ['description'],
  txHash: ['txhash', 'tx hash'],
};

/** Colonnes propres à l'export interne, ignorées mais reconnues (pas « inconnues »). */
const KNOWN_EXTRAS = new Set([
  'id',
  'type',
  'from wallet id',
  'to wallet id',
  'fee worth amount',
  'fee worth currency',
  'net worth',
  'deleted',
  'txsrc',
  'txdest',
]);

export type PivotDetection =
  | {
      ok: true;
      format: PivotFormat;
      columns: Partial<Record<PivotField, number>>;
      unknownColumns: string[];
    }
  | { ok: false; reason: 'empty' | 'missing-columns'; missing: string[]; found: string[] };

const canon = (h: string): string => h.trim().toLowerCase().replace(/\s+/g, ' ');

export function detectPivotFormat(header: readonly string[]): PivotDetection {
  if (header.length === 0) return { ok: false, reason: 'empty', missing: [], found: [] };
  const canonical = header.map(canon);
  const columns: Partial<Record<PivotField, number>> = {};
  const matched = new Set<number>();
  for (const [field, names] of Object.entries(HEADERS) as [PivotField, readonly string[]][]) {
    for (const name of names) {
      const index = canonical.indexOf(name);
      if (index >= 0) {
        columns[field] = index;
        matched.add(index);
        break;
      }
    }
  }
  const missing = (['date'] as PivotField[])
    .filter((f) => columns[f] === undefined)
    .map((f) => HEADERS[f][0]!);
  const hasSent = columns.sentAmount !== undefined && columns.sentCurrency !== undefined;
  const hasReceived =
    columns.receivedAmount !== undefined && columns.receivedCurrency !== undefined;
  if (!hasSent && !hasReceived) missing.push('sent/received (ou from/to) amount + currency');
  if (missing.length > 0) {
    return { ok: false, reason: 'missing-columns', missing, found: header.map((h) => h.trim()) };
  }
  const format: PivotFormat =
    columns.sentAmount !== undefined && canonical[columns.sentAmount] === 'from amount'
      ? 'koinly-export'
      : columns.receivedAmount !== undefined && canonical[columns.receivedAmount] === 'to amount'
        ? 'koinly-export'
        : 'koinly-universal';
  const unknownColumns = header
    .map((h) => h.trim())
    .filter((_, i) => !matched.has(i) && !KNOWN_EXTRAS.has(canonical[i]!) && canonical[i] !== '');
  return { ok: true, format, columns, unknownColumns };
}
