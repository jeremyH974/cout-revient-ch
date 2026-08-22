/** Détection du format d'export Coinhouse par les noms de colonnes (jamais par position). */
import type { CsvTable } from '../csv';

export const LOGICAL_COLUMNS = [
  'id',
  'date',
  'type',
  'qty',
  'asset',
  'marketPrice',
  'valueEur',
  'feeAsset',
  'feeEur',
  'feeRebate',
  'balance',
  'account',
] as const;

export type LogicalColumn = (typeof LOGICAL_COLUMNS)[number];
export type ColumnMap = Record<LogicalColumn, number | null>;

/** En-tête exact observé sur l'export avancé (interface FR, été 2026). */
export const COINHOUSE_HEADER_2026_08: readonly string[] = [
  'ID Coinhouse',
  'Date',
  'Type',
  'Quantité',
  'Devise',
  'Prix du marché',
  'Contre-valeur (EUR)',
  'Frais (devise)',
  'Frais Contre-valeur (EUR)',
  'Remise frais',
  'Solde',
  'Compte',
];

const ALIASES: Record<LogicalColumn, readonly string[]> = {
  id: ['id coinhouse', 'coinhouse id', 'id', 'identifiant'],
  date: ['date', 'date de la transaction', 'horodatage', 'timestamp'],
  type: ['type', 'type de transaction', 'operation'],
  qty: ['quantite', 'quantity', 'amount', 'montant'],
  asset: ['devise', 'currency', 'asset', 'actif', 'crypto'],
  marketPrice: ['prix du marche', 'market price', 'prix', 'price'],
  valueEur: [
    'contre-valeur (eur)',
    'contre valeur (eur)',
    'contrevaleur (eur)',
    'counter value (eur)',
    'countervalue (eur)',
    'value (eur)',
    'contre-valeur',
  ],
  feeAsset: ['frais (devise)', 'fees (currency)', 'fee (currency)', 'frais', 'fees'],
  feeEur: [
    'frais contre-valeur (eur)',
    'frais contre valeur (eur)',
    'fees counter value (eur)',
    'fee countervalue (eur)',
    'fees (eur)',
  ],
  feeRebate: ['remise frais', 'remise', 'fee discount', 'fee rebate', 'discount'],
  balance: ['solde', 'balance'],
  account: ['compte', 'account', 'wallet'],
};

const REQUIRED: readonly LogicalColumn[] = ['date', 'type', 'qty', 'asset', 'valueEur'];

/** Minuscules, sans accents, espaces compactés : robuste aux variations de libellés. */
export function normalizeHeader(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export type FormatDetection =
  | {
      ok: true;
      format: 'coinhouse-2026-08' | 'coinhouse-compatible';
      columns: ColumnMap;
      unknownColumns: string[];
    }
  | { ok: false; reason: 'empty' | 'missing-columns'; missing: LogicalColumn[]; found: string[] };

export function detectCoinhouseFormat(header: string[]): FormatDetection {
  if (header.length === 0) return { ok: false, reason: 'empty', missing: [...REQUIRED], found: [] };
  const normalized = header.map(normalizeHeader);
  const columns = Object.fromEntries(LOGICAL_COLUMNS.map((c) => [c, null])) as ColumnMap;
  const used = new Set<number>();
  for (const logical of LOGICAL_COLUMNS) {
    for (const alias of ALIASES[logical]) {
      const index = normalized.findIndex((h, i) => h === alias && !used.has(i));
      if (index !== -1) {
        columns[logical] = index;
        used.add(index);
        break;
      }
    }
  }
  const missing = REQUIRED.filter((c) => columns[c] === null);
  if (missing.length > 0) return { ok: false, reason: 'missing-columns', missing, found: header };
  const unknownColumns = header.filter((_, i) => !used.has(i));
  const exact =
    header.length === COINHOUSE_HEADER_2026_08.length &&
    header.every((h, i) => normalizeHeader(h) === normalizeHeader(COINHOUSE_HEADER_2026_08[i]!));
  return {
    ok: true,
    format: exact ? 'coinhouse-2026-08' : 'coinhouse-compatible',
    columns,
    unknownColumns,
  };
}

/** `1 234,5` ou `-0,5` : nombre reformaté par un tableur. */
const DECIMAL_COMMA = /^-?\d{1,3}(?:[ \u00a0\u202f]\d{3})*,\d+$|^-?\d+,\d+$/;

/** Indices qu'un fichier a été ouvert puis ré-enregistré par un tableur (précision perdue). */
export function detectExcelMangling(table: CsvTable, columns: ColumnMap): string[] {
  const warnings: string[] = [];
  if (table.delimiter === ';') {
    warnings.push(
      'Séparateur « ; » détecté : le fichier semble avoir été ré-enregistré par un tableur.',
    );
  }
  const numericColumns = [columns.qty, columns.valueEur].filter((c): c is number => c !== null);
  let decimalComma = false;
  let scientific = false;
  let dateWithoutSeconds = false;
  for (const row of table.rows) {
    for (const c of numericColumns) {
      const cell = row[c]?.trim() ?? '';
      if (DECIMAL_COMMA.test(cell)) decimalComma = true;
      if (/\d[eE][+-]?\d/.test(cell)) scientific = true;
    }
    if (columns.date !== null) {
      const date = row[columns.date]?.trim() ?? '';
      if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(date)) dateWithoutSeconds = true;
    }
  }
  if (decimalComma) warnings.push('Nombres avec virgule décimale : format tableur détecté.');
  if (scientific) {
    warnings.push(
      'Nombres en notation scientifique (ex. 1,1E+08) : des quantités ont perdu leur précision.',
    );
  }
  if (dateWithoutSeconds) warnings.push('Dates sans secondes : le fichier a été reformaté.');
  return warnings;
}
