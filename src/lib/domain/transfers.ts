/**
 * Virements internes appariés (décision n° 25) : un retrait sans produit (`proceedsEur: null`)
 * et un dépôt sans coût (`costEur: null`) du même actif entre deux comptes différents, reçus dans
 * la fenêtre [retrait − 2 h ; retrait + 72 h] avec une quantité compatible (écart ≤ frais réseau
 * plausibles), sont appariés : la sortie se fait au coût et le coût voyage vers le dépôt — jamais
 * une cession ni un gain fantôme. L'appariement est recalculé à chaque chargement (rien n'est
 * persisté ici) ; l'utilisateur peut le corriger via `overrides` (délier ou forcer une paire).
 */
import { D, ZERO, type Big } from './money';
import { naiveToMs } from './trading/journal';
import type { AccountId, DepositEvent, EventId, LedgerEvent, WithdrawalEvent } from './types';

/** Décalage d'horloge toléré : le dépôt peut être horodaté un peu AVANT le retrait. */
export const TRANSFER_WINDOW_BEFORE_MS = 2 * 3_600_000;
/** Confirmation on-chain + traitement plateforme : jusqu'à 72 h après le retrait. */
export const TRANSFER_WINDOW_AFTER_MS = 72 * 3_600_000;
/** Écart de quantité toléré (frais réseau) : 2 % du montant retiré, plancher une poussière. */
const QTY_TOLERANCE_RATIO = D('0.02');
const QTY_TOLERANCE_FLOOR = D('0.000001');
/** Léger dépassement côté dépôt toléré (arrondis de plateforme, cf. cas relevés chez Koinly). */
const QTY_OVERSHOOT = D('0.000000001');

/** `'none'` : ne jamais apparier ce retrait ; sinon l'id du dépôt imposé. */
export type TransferOverride = EventId | 'none';

export interface TransferPair {
  withdrawalId: EventId;
  depositId: EventId;
  asset: string;
  qtyOut: string;
  qtyIn: string;
  at: string;
  receivedAt: string;
  fromAccountId: AccountId;
  toAccountId: AccountId;
  /** Paire imposée par l'utilisateur (override), hors critères automatiques. */
  forced: boolean;
}

export interface TransferPairing {
  /** Les mêmes événements, dans le même ordre, décorés de `transferTo`/`transferFrom`. */
  events: LedgerEvent[];
  pairs: TransferPair[];
  /** Candidats restés sans contrepartie (retraits/dépôts sans valeur renseignée). */
  unpairedWithdrawals: WithdrawalEvent[];
  unpairedDeposits: DepositEvent[];
}

const isCandidateWithdrawal = (e: LedgerEvent): e is WithdrawalEvent =>
  e.kind === 'withdrawal' && e.proceedsEur === null;
const isCandidateDeposit = (e: LedgerEvent): e is DepositEvent =>
  e.kind === 'deposit' && e.costEur === null;

/** Quantités compatibles : dépôt ≤ retrait (± poussière), manque ≤ max(2 %, poussière). */
function qtyCompatible(qtyOut: Big, qtyIn: Big): boolean {
  if (qtyIn.gt(qtyOut.plus(QTY_OVERSHOOT))) return false;
  const missing = qtyOut.minus(qtyIn);
  const tolerance = qtyOut.times(QTY_TOLERANCE_RATIO);
  return missing.lte(tolerance.gt(QTY_TOLERANCE_FLOOR) ? tolerance : QTY_TOLERANCE_FLOOR);
}

interface Candidate {
  withdrawal: WithdrawalEvent;
  deposit: DepositEvent;
  deltaMs: number;
  qtyGap: Big;
}

export function pairTransfers(
  events: readonly LedgerEvent[],
  overrides: Record<EventId, TransferOverride> = {},
): TransferPairing {
  const withdrawals = events.filter(isCandidateWithdrawal);
  const deposits = events.filter(isCandidateDeposit);
  const depositById = new Map<EventId, DepositEvent>();
  for (const d of deposits) depositById.set(d.id, d);

  const linkedTo = new Map<EventId, EventId>(); // withdrawalId → depositId
  const usedDeposits = new Set<EventId>();
  const forced = new Set<EventId>();

  // 1. Overrides d'abord : une paire imposée n'est validée que si les deux côtés existent,
  //    portent le même actif et sont encore « sans valeur » (sinon l'override est ignoré).
  for (const w of withdrawals) {
    const override = overrides[w.id];
    if (override === undefined || override === 'none') continue;
    const d = depositById.get(override);
    if (!d || usedDeposits.has(d.id) || d.in.asset !== w.out.asset) continue;
    if (d.accountId === w.accountId) continue;
    linkedTo.set(w.id, d.id);
    usedDeposits.add(d.id);
    forced.add(w.id);
  }

  // 2. Appariement automatique glouton et déterministe : |Δt| croissant, puis écart de quantité,
  //    puis ids (aucune paire ne dépend de l'ordre d'entrée).
  const candidates: Candidate[] = [];
  for (const w of withdrawals) {
    if (linkedTo.has(w.id) || overrides[w.id] === 'none') continue;
    const wMs = naiveToMs(w.at);
    const qtyOut = D(w.out.qty);
    for (const d of deposits) {
      if (usedDeposits.has(d.id)) continue;
      if (d.accountId === w.accountId || d.in.asset !== w.out.asset) continue;
      const deltaMs = naiveToMs(d.at) - wMs;
      if (deltaMs < -TRANSFER_WINDOW_BEFORE_MS || deltaMs > TRANSFER_WINDOW_AFTER_MS) continue;
      const qtyIn = D(d.in.qty);
      if (!qtyCompatible(qtyOut, qtyIn)) continue;
      candidates.push({ withdrawal: w, deposit: d, deltaMs, qtyGap: qtyOut.minus(qtyIn).abs() });
    }
  }
  candidates.sort(
    (a, b) =>
      Math.abs(a.deltaMs) - Math.abs(b.deltaMs) ||
      a.qtyGap.cmp(b.qtyGap) ||
      a.withdrawal.id.localeCompare(b.withdrawal.id) ||
      a.deposit.id.localeCompare(b.deposit.id),
  );
  for (const c of candidates) {
    if (linkedTo.has(c.withdrawal.id) || usedDeposits.has(c.deposit.id)) continue;
    linkedTo.set(c.withdrawal.id, c.deposit.id);
    usedDeposits.add(c.deposit.id);
  }

  const linkedFrom = new Map<EventId, EventId>(); // depositId → withdrawalId
  for (const [wId, dId] of linkedTo) linkedFrom.set(dId, wId);

  const decorated: LedgerEvent[] = events.map((e) => {
    if (e.kind === 'withdrawal' && linkedTo.has(e.id))
      return { ...e, transferTo: linkedTo.get(e.id)! };
    if (e.kind === 'deposit' && linkedFrom.has(e.id))
      return { ...e, transferFrom: linkedFrom.get(e.id)! };
    return e;
  });

  const pairs: TransferPair[] = [...linkedTo.entries()]
    .map(([wId, dId]): TransferPair => {
      const w = withdrawals.find((x) => x.id === wId)!;
      const d = depositById.get(dId)!;
      return {
        withdrawalId: wId,
        depositId: dId,
        asset: w.out.asset,
        qtyOut: w.out.qty,
        qtyIn: d.in.qty,
        at: w.at,
        receivedAt: d.at,
        fromAccountId: w.accountId,
        toAccountId: d.accountId,
        forced: forced.has(wId),
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.withdrawalId.localeCompare(b.withdrawalId));

  return {
    events: decorated,
    pairs,
    unpairedWithdrawals: withdrawals.filter((w) => !linkedTo.has(w.id)),
    unpairedDeposits: deposits.filter((d) => !usedDeposits.has(d.id)),
  };
}

/** Quantité perdue en route (frais réseau) d'une paire — informatif pour l'UI. */
export function pairFeeQty(pair: TransferPair): Big {
  const fee = D(pair.qtyOut).minus(pair.qtyIn);
  return fee.gt(ZERO) ? fee : ZERO;
}
