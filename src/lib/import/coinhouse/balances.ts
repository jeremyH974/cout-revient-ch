/** Extrait les enregistrements de solde (colonne `Solde`) pour le contrôle d'intégrité. */
import { isFiat } from '../../domain/assets';
import type { BalanceRecord } from '../../domain/engine/integrity';
import type { RawCoinhouseRow } from '../../domain/types';

export function balanceRecords(rows: Iterable<RawCoinhouseRow>): BalanceRecord[] {
  const records: BalanceRecord[] = [];
  for (const row of rows) {
    if (row.balance === null || isFiat(row.asset)) continue;
    records.push({
      rowKey: row.key,
      asset: row.asset,
      signedQty: row.qty,
      balance: row.balance,
      at: row.at,
    });
  }
  return records;
}
