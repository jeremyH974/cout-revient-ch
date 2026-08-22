/** Lignes isolées (récompense, dépôt, retrait, inconnu) et qualifications utilisateur. */
import { D, isNegative, isPositive, toDecimalString } from '../../domain/money';
import type {
  LedgerEvent,
  Qualification,
  RawCoinhouseRow,
  UnqualifiedEvent,
} from '../../domain/types';
import { unqualifiedFromRows } from './trade';

/** Minuscules, sans accents, espaces compactés. */
export function normalizeType(type: string): string {
  return type.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export const absDecimal = (value: string): string => toDecimalString(D(value).abs());

const REWARD_TYPES = new Set([
  'recompense',
  'recompenses',
  'staking',
  'reward',
  'rewards',
  'rendement',
  'interets',
]);
const DEPOSIT_TYPES = new Set(['depot', 'deposit', 'reception']);
const WITHDRAWAL_TYPES = new Set(['retrait', 'withdrawal', 'envoi']);

/** Ligne isolée : type « simple » reconnu par heuristique, sinon `unqualified`. */
export function buildSingleEvent(row: RawCoinhouseRow): LedgerEvent {
  const id = row.id ? `ch:${row.id}` : `ch:${row.key}`;
  const type = normalizeType(row.type);
  const qty = D(row.qty);
  const base = {
    id,
    at: row.at,
    source: 'coinhouse-csv' as const,
    scope: 'coinhouse' as const,
    rowKeys: [row.key],
    warnings: [`Type « ${row.type} » interprété par heuristique : à vérifier.`],
  };
  if (REWARD_TYPES.has(type) && isPositive(qty)) {
    const fairValueEur = row.valueEur ? absDecimal(row.valueEur) : null;
    return { ...base, kind: 'reward', in: { asset: row.asset, qty: row.qty }, fairValueEur };
  }
  if (DEPOSIT_TYPES.has(type) && isPositive(qty)) {
    return { ...base, kind: 'deposit', in: { asset: row.asset, qty: row.qty }, costEur: null };
  }
  if (WITHDRAWAL_TYPES.has(type) && isNegative(qty)) {
    const out = { asset: row.asset, qty: absDecimal(row.qty) };
    return { ...base, kind: 'withdrawal', out, proceedsEur: null };
  }
  return unqualifiedFromRows(id, [row], `Type de transaction inconnu : « ${row.type} ».`);
}

/** Réinterprète un événement non qualifié selon le choix de l'utilisateur (`null` = ignorer). */
export function applyQualification(event: UnqualifiedEvent, q: Qualification): LedgerEvent | null {
  const leg = event.legs[0];
  if (q.kind === 'ignore' || !leg) return null;
  const base = {
    id: event.id,
    at: event.at,
    source: event.source,
    scope: event.scope,
    rowKeys: event.rowKeys,
    warnings: [] as string[],
  };
  const trade = {
    ...base,
    kind: 'trade' as const,
    valueEurSource: 'manual' as const,
    fee: null,
    quotePrice: null,
  };
  const single = { asset: leg.asset, qty: absDecimal(leg.signedQty) };
  switch (q.kind) {
    case 'reward':
      return { ...base, kind: 'reward', in: single, fairValueEur: q.fairValueEur };
    case 'deposit':
      return { ...base, kind: 'deposit', in: single, costEur: q.costEur };
    case 'withdrawal':
      return { ...base, kind: 'withdrawal', out: single, proceedsEur: q.proceedsEur };
    case 'purchase':
      return { ...trade, out: { asset: 'eur', qty: q.costEur }, in: single, valueEur: q.costEur };
    case 'sale':
      return {
        ...trade,
        out: single,
        in: { asset: 'eur', qty: q.proceedsEur },
        valueEur: q.proceedsEur,
      };
    case 'trade': {
      const negative = event.legs.find((l) => isNegative(D(l.signedQty)));
      const positive = event.legs.find((l) => isPositive(D(l.signedQty)));
      if (!negative || !positive) return null;
      return {
        ...trade,
        out: { asset: negative.asset, qty: absDecimal(negative.signedQty) },
        in: { asset: positive.asset, qty: absDecimal(positive.signedQty) },
        valueEur: q.valueEur,
      };
    }
  }
}
