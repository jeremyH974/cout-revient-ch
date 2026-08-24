/**
 * Export des opérations au format pivot « Custom CSV Universal » de Koinly (lu aussi par Waltio) :
 * virgule, point décimal, dates UTC, sans BOM — les exigences de Koinly, pas celles d'Excel FR
 * (l'export tableur maison reste `csv-export.ts`). Les valeurs EUR de l'app remplissent
 * `Net Worth` ; l'id d'événement part dans `TxHash` (dédoublonnage stable au ré-import).
 */
import { isFiat } from '../domain/assets';
import type { LedgerEvent, Leg } from '../domain/types';
import { msToUtcString, parisNaiveToMs } from '../import/time';

export const KOINLY_HEADER = [
  'Date',
  'Sent Amount',
  'Sent Currency',
  'Received Amount',
  'Received Currency',
  'Fee Amount',
  'Fee Currency',
  'Net Worth Amount',
  'Net Worth Currency',
  'Label',
  'Description',
  'TxHash',
] as const;

const EOL = '\r\n';

const quote = (cell: string): string =>
  /[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;

interface KoinlyRow {
  date: string;
  sent: Leg | null;
  received: Leg | null;
  fee: { qty: string; asset: string } | null;
  netWorthEur: string | null;
  label: string;
  description: string;
  txHash: string;
}

const upper = (asset: string): string => asset.toUpperCase();

function rowOf(event: LedgerEvent): KoinlyRow | null {
  const ms = parisNaiveToMs(event.at);
  const base = {
    date: ms === null ? event.at.replace('T', ' ') : msToUtcString(ms),
    sent: null as Leg | null,
    received: null as Leg | null,
    fee: null as KoinlyRow['fee'],
    netWorthEur: null as string | null,
    label: '',
    description: '',
    txHash: event.id,
  };
  switch (event.kind) {
    case 'trade': {
      const cryptoOnly = !isFiat(event.out.asset) && !isFiat(event.in.asset);
      return {
        ...base,
        sent: event.out,
        received: event.in,
        fee: event.fee ? { qty: event.fee.gross, asset: event.fee.asset } : null,
        netWorthEur: event.valueEur,
        label: cryptoOnly ? 'swap' : '',
      };
    }
    case 'migration':
      return {
        ...base,
        sent: event.out,
        received: event.in,
        netWorthEur: event.fairValueOutEur ?? event.fairValueInEur,
        label: 'swap',
        description: 'Migration / delisting (coût reporté)',
      };
    case 'reward':
      return { ...base, received: event.in, netWorthEur: event.fairValueEur, label: 'reward' };
    case 'deposit':
      return {
        ...base,
        received: event.in,
        netWorthEur: event.costEur,
        description: event.transferFrom !== undefined ? 'Virement interne (apparié)' : '',
      };
    case 'withdrawal':
      return {
        ...base,
        sent: event.out,
        netWorthEur: event.proceedsEur,
        description: event.transferTo !== undefined ? 'Virement interne (apparié)' : '',
      };
    case 'opening-balance':
      return {
        ...base,
        received: event.in,
        netWorthEur: event.costEur,
        description: "Solde d'ouverture",
      };
    case 'fee':
      return {
        ...base,
        sent: { asset: 'eur', qty: event.amountEur },
        label: 'cost',
        description: event.label,
      };
    case 'unqualified':
      return null;
  }
}

/** Événements (valeurs EUR) → CSV Universal ; les lignes « à qualifier » sont laissées de côté. */
export function eventsToKoinlyCsv(events: readonly LedgerEvent[]): {
  csv: string;
  rows: number;
  skipped: number;
} {
  const rows: string[] = [];
  let skipped = 0;
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  for (const event of sorted) {
    const row = rowOf(event);
    if (row === null) {
      skipped++;
      continue;
    }
    rows.push(
      [
        row.date,
        row.sent?.qty ?? '',
        row.sent ? upper(row.sent.asset) : '',
        row.received?.qty ?? '',
        row.received ? upper(row.received.asset) : '',
        row.fee?.qty ?? '',
        row.fee ? upper(row.fee.asset) : '',
        row.netWorthEur ?? '',
        row.netWorthEur !== null ? 'EUR' : '',
        row.label,
        row.description,
        row.txHash,
      ]
        .map(quote)
        .join(','),
    );
  }
  return { csv: [KOINLY_HEADER.join(','), ...rows].join(EOL) + EOL, rows: rows.length, skipped };
}
