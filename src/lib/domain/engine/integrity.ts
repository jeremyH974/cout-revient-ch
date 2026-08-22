/**
 * Contrôle d'intégrité par la colonne `Solde` de l'export : détecte un export tronqué
 * (solde d'ouverture implicite), une chaîne de soldes incohérente, et un écart entre le
 * solde final exporté et la quantité calculée par le moteur (opérations non qualifiées…).
 * L'ordre de règlement peut différer de l'ordre des horodatages au sein d'une journée :
 * le rapprochement est glouton par jour.
 */
import { D, ZERO, isZero, type Big } from '../money';
import type { AssetCode, DecimalString, NaiveDateTime, RowKey } from '../types';
import type { IntegrityResult } from './report';

export interface BalanceRecord {
  rowKey: RowKey;
  asset: AssetCode;
  signedQty: DecimalString;
  balance: DecimalString;
  at: NaiveDateTime;
}

const TOLERANCE = D('0.00000001');

interface Row {
  record: BalanceRecord;
  before: Big;
  after: Big;
}

const near = (a: Big, b: Big): boolean => a.minus(b).abs().lte(TOLERANCE);

/** Budget de recherche : les journées ont au plus quelques dizaines de lignes. */
const MAX_STEPS = 20_000;

/** Enchaîne les lignes d'une journée depuis `start` (recherche avec retour arrière) ; null si impossible. */
function chainDay(rows: Row[], start: Big): { end: Big; reordered: boolean } | null {
  const n = rows.length;
  const used: boolean[] = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  let steps = 0;
  const walk = (current: Big, depth: number): Big | null => {
    if (depth === n) return current;
    for (let i = 0; i < n; i++) {
      if (used[i] || !near(rows[i]!.before, current)) continue;
      if (++steps > MAX_STEPS) return null;
      used[i] = true;
      order.push(i);
      const end = walk(rows[i]!.after, depth + 1);
      if (end !== null) return end;
      order.pop();
      used[i] = false;
    }
    return null;
  };
  const end = walk(start, 0);
  if (end === null) return null;
  const reordered = order.some((index, k) => index !== k);
  return { end, reordered };
}

function checkAsset(asset: AssetCode, rows: Row[], finalQty: Big | null): IntegrityResult {
  const base: IntegrityResult = {
    asset,
    status: 'ok',
    message: 'Soldes cohérents avec les opérations importées.',
    impliedOpening: null,
    expected: null,
    found: null,
    at: null,
    reorderedDays: [],
  };
  const days = new Map<string, Row[]>();
  for (const row of rows) {
    const day = row.record.at.slice(0, 10);
    const list = days.get(day) ?? [];
    list.push(row);
    days.set(day, list);
  }
  let current = ZERO;
  let first = true;
  for (const [day, group] of days) {
    let result = chainDay(group, current);
    if (!result && first) {
      for (const candidate of group) {
        result = chainDay(group, candidate.before);
        if (result) {
          base.impliedOpening = candidate.before;
          break;
        }
      }
    }
    if (!result) {
      const head = group[0]!;
      return {
        ...base,
        status: 'balance-mismatch',
        expected: current,
        found: head.before,
        at: head.record.at,
        message: `Le ${day}, le solde de ${asset} attendu avant l'opération était ${current.toString()} mais l'export indique ${head.before.toString()} : une opération manque ou est en double.`,
      };
    }
    if (result.reordered) base.reorderedDays.push(day);
    current = result.end;
    first = false;
  }
  if (base.impliedOpening && !isZero(base.impliedOpening)) {
    if (finalQty !== null && near(current, finalQty)) {
      return {
        ...base,
        message: `L'export commence avec ${base.impliedOpening.toString()} ${asset} déjà détenu ; un solde d'ouverture le couvre.`,
      };
    }
    return {
      ...base,
      status: 'opening-balance-missing',
      expected: base.impliedOpening,
      at: rows[0]!.record.at,
      message: `L'export commence avec un solde de ${base.impliedOpening.toString()} ${asset} déjà détenu : l'historique antérieur manque (export filtré ou tronqué).`,
    };
  }
  if (finalQty !== null && !near(current, finalQty)) {
    return {
      ...base,
      status: 'final-mismatch',
      expected: current,
      found: finalQty,
      at: rows[rows.length - 1]!.record.at,
      message: `Solde final exporté ${current.toString()} ${asset} ≠ quantité calculée ${finalQty.toString()} : vérifiez les opérations à qualifier ou saisies manuellement.`,
    };
  }
  return base;
}

export function checkBalances(
  records: readonly BalanceRecord[],
  finalQtyByAsset: Record<AssetCode, DecimalString>,
): Record<AssetCode, IntegrityResult> {
  const byAsset = new Map<AssetCode, Row[]>();
  for (const record of records) {
    const after = D(record.balance);
    const row: Row = { record, before: after.minus(record.signedQty), after };
    const list = byAsset.get(record.asset) ?? [];
    list.push(row);
    byAsset.set(record.asset, list);
  }
  const results: Record<AssetCode, IntegrityResult> = {};
  for (const [asset, rows] of byAsset) {
    rows.sort(
      (a, b) =>
        a.record.at.localeCompare(b.record.at) || a.record.rowKey.localeCompare(b.record.rowKey),
    );
    const final = finalQtyByAsset[asset];
    results[asset] = checkAsset(asset, rows, final === undefined ? null : D(final));
  }
  return results;
}
