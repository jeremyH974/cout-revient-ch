/**
 * Construction d'une opération `trade` à partir des deux jambes d'un « Echange » Coinhouse.
 *
 * Règle d'or : la valeur EUR de l'opération est la `Contre-valeur (EUR)` de la jambe
 * contrepartie (eur, sinon stablecoin). La jambe actif exprime son prix et sa contre-valeur
 * dans la devise de contrepartie (USDC quand on paie en USDC) : elle ne sert qu'à l'affichage.
 */
import { COINHOUSE_ACCOUNT_ID } from '../../domain/types';
import { isFiat, isStablecoin } from '../../domain/assets';
import { D, ONE, ZERO, isNegative, isPositive, toDecimalString } from '../../domain/money';
import type {
  LedgerEvent,
  MigrationEvent,
  RawCoinhouseRow,
  TradeEvent,
  TradeFee,
  UnqualifiedEvent,
} from '../../domain/types';

export function unqualifiedFromRows(
  id: string,
  rows: RawCoinhouseRow[],
  reason: string,
): UnqualifiedEvent {
  const at = rows.map((r) => r.at).sort()[0]!;
  return {
    kind: 'unqualified',
    id,
    at,
    source: 'coinhouse-csv',
    scope: 'coinhouse',
    accountId: COINHOUSE_ACCOUNT_ID,
    rowKeys: rows.map((r) => r.key),
    warnings: [],
    rawType: rows[0]?.type ?? '',
    legs: rows.map((r) => ({ asset: r.asset, signedQty: r.qty, valueEur: r.valueEur })),
    reason,
  };
}

function pickCounterLeg(a: RawCoinhouseRow, b: RawCoinhouseRow): RawCoinhouseRow | null {
  if (isFiat(a.asset)) return a;
  if (isFiat(b.asset)) return b;
  if (isStablecoin(a.asset)) return a;
  if (isStablecoin(b.asset)) return b;
  return null;
}

function buildFee(counter: RawCoinhouseRow): TradeFee | null {
  if (counter.feeAsset === null) return null;
  const gross = D(counter.feeAsset);
  const rebate = D(counter.feeRebate ?? '0');
  const rate = isFiat(counter.asset) ? ONE : counter.marketPrice ? D(counter.marketPrice) : null;
  const grossEur = counter.feeEur ? D(counter.feeEur) : rate ? gross.times(rate) : ZERO;
  // La remise est convertie au taux implicite des frais Coinhouse (frais EUR ÷ frais devise) :
  // une remise de 100 % donne ainsi un frais net exactement nul, au lieu d'un résidu de change.
  const rebateEur = isPositive(gross)
    ? rebate.times(grossEur).div(gross)
    : rate
      ? rebate.times(rate)
      : ZERO;
  return {
    asset: counter.asset,
    gross: toDecimalString(gross),
    rebate: toDecimalString(rebate),
    grossEur: toDecimalString(grossEur),
    rebateEur: toDecimalString(rebateEur),
  };
}

/** Contrôle informatif : la jambe actif doit valoir la contrepartie nette des frais (±0,5 %). */
function feeReconciliationWarning(
  counter: RawCoinhouseRow,
  assetLeg: RawCoinhouseRow,
  fee: TradeFee | null,
): string | null {
  if (assetLeg.valueEur === null) return null;
  const effectiveFee = fee ? D(fee.gross).minus(fee.rebate) : ZERO;
  const counterQty = D(counter.qty).abs();
  const counterIsOut = isNegative(D(counter.qty));
  const expected = counterIsOut ? counterQty.minus(effectiveFee) : counterQty.plus(effectiveFee);
  const actual = D(assetLeg.valueEur).abs();
  const diff = expected.minus(actual).abs();
  if (diff.lte('0.05')) return null;
  if (expected.gt(ZERO) && diff.div(expected).lte('0.005')) return null;
  return `Écart de réconciliation des frais : attendu ${toDecimalString(expected)} ${counter.asset}, trouvé ${toDecimalString(actual)}.`;
}

/** Deux jambes de même ID → `trade` (ou `migration` pour un swap crypto↔crypto, ou `unqualified`). */
export function buildTradeEvent(id: string, rows: RawCoinhouseRow[]): LedgerEvent {
  const eventId = `ch:${id}`;
  if (rows.length !== 2) {
    return unqualifiedFromRows(
      eventId,
      rows,
      rows.length === 1
        ? "Jambe orpheline : l'autre moitié de l'opération est absente de l'export."
        : `Opération à ${rows.length} jambes : structure inattendue.`,
    );
  }
  const [a, b] = rows as [RawCoinhouseRow, RawCoinhouseRow];
  const negative = [a, b].find((r) => isNegative(D(r.qty)));
  const positive = [a, b].find((r) => isPositive(D(r.qty)));
  if (!negative || !positive) {
    return unqualifiedFromRows(eventId, rows, 'Les deux jambes ont le même signe.');
  }
  const at = a.at < b.at ? a.at : b.at;
  const base = {
    id: eventId,
    at,
    source: 'coinhouse-csv' as const,
    scope: 'coinhouse' as const,
    accountId: COINHOUSE_ACCOUNT_ID,
    rowKeys: [a.key, b.key],
  };
  const counter = pickCounterLeg(negative, positive);
  if (!counter) {
    const migration: MigrationEvent = {
      ...base,
      kind: 'migration',
      warnings: ['Échange crypto↔crypto sans contrepartie en euros : coût reporté.'],
      out: { asset: negative.asset, qty: toDecimalString(D(negative.qty).abs()) },
      in: { asset: positive.asset, qty: positive.qty },
      fairValueOutEur: negative.valueEur ? toDecimalString(D(negative.valueEur).abs()) : null,
      fairValueInEur: positive.valueEur ? toDecimalString(D(positive.valueEur).abs()) : null,
    };
    return migration;
  }
  if (counter.valueEur === null) {
    return unqualifiedFromRows(eventId, rows, 'Contre-valeur EUR manquante sur la contrepartie.');
  }
  const assetLeg = counter === negative ? positive : negative;
  const fee = buildFee(counter);
  const warnings: string[] = [];
  const reconciliation = feeReconciliationWarning(counter, assetLeg, fee);
  if (reconciliation) warnings.push(reconciliation);
  const trade: TradeEvent = {
    ...base,
    kind: 'trade',
    warnings,
    out: { asset: negative.asset, qty: toDecimalString(D(negative.qty).abs()) },
    in: { asset: positive.asset, qty: positive.qty },
    valueEur: toDecimalString(D(counter.valueEur).abs()),
    valueEurSource: 'counter-leg',
    fee,
    quotePrice: assetLeg.marketPrice ? { asset: counter.asset, price: assetLeg.marketPrice } : null,
    // La jambe RETENUE, pas seulement la règle : sans cette clé, « d'où vient ce montant ? » n'a
    // pas de réponse vérifiable et le piège de la jambe crypto libellée « EUR » reste invisible.
    counterRowKey: counter.key,
    assetRowKey: assetLeg.key,
  };
  return trade;
}
