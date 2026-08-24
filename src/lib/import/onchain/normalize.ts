/**
 * Comptes on-chain par adresse publique (P25, MVP) : les mouvements bruts d'une chaîne deviennent
 * des brouillons pivot — dépôts/retraits SANS valeur EUR (pas d'estimation silencieuse) : ce sont
 * les candidats naturels de l'appariement de virements internes, ou des lignes à qualifier.
 * La clé de dédoublonnage hache le contenu natif (txid/hash) : re-synchronisation idempotente.
 */
import type { PlatformDraft } from '../platforms/types';

export interface OnchainMovement {
  /** Identité native stable (chaîne + hash + sens…) : base de la clé de ligne. */
  nativeContent: string;
  timeMs: number;
  direction: 'in' | 'out';
  /** Quantité décimale positive (chaîne). */
  qty: string;
  asset: string;
  txHash: string;
  note: string | null;
}

export interface OnchainSyncResult {
  movements: OnchainMovement[];
  /** Transferts ignorés : tokens hors liste blanche, auto-transferts, valeurs nulles. */
  ignored: number;
  /** Vrai si la pagination a été coupée au plafond (historique plus profond non lu). */
  truncated: boolean;
}

/** Erreur réseau/contrat : httpStatus 429 = limite de débit (réessayer plus tard). */
export class OnchainError extends Error {
  readonly httpStatus: number | null;
  constructor(message: string, httpStatus: number | null = null) {
    super(message);
    this.name = 'OnchainError';
    this.httpStatus = httpStatus;
  }
}

export function movementsToDrafts(movements: readonly OnchainMovement[]): PlatformDraft[] {
  return movements.map((m, i) => ({
    lineNo: i + 1,
    nativeContent: m.nativeContent,
    timeMs: m.timeMs,
    sent: m.direction === 'out' ? { amount: m.qty, currency: m.asset } : null,
    received: m.direction === 'in' ? { amount: m.qty, currency: m.asset } : null,
    fee: null,
    netWorth: null,
    label: null,
    description: m.note,
    txHash: m.txHash,
  }));
}
