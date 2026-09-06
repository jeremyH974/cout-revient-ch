/**
 * Assainissement du conteneur `lending` relu depuis le disque ou une sauvegarde. Même contrat que
 * les autres assainisseurs du projet : ce qui est valide passe, ce qui ne l'est pas est COMPTÉ
 * (`dropped`) plutôt qu'accepté en silence — un état corrompu doit se voir, pas se deviner.
 *
 * Un événement orphelin (dont le prêt a disparu) n'est PAS écarté ici : `computeLending` le
 * signale déjà dans `orphanEvents`, et le supprimer effacerait une donnée de l'utilisateur.
 */
import { isDecimalString } from '../money';
import type {
  Amortisation,
  DayCount,
  LendingState,
  Loan,
  LoanEvent,
  WalletMovement,
  WriteOffProof,
} from './types';
import { emptyLendingState } from './types';

const NAIVE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const DAY_COUNTS = new Set<DayCount>(['act/365', 'act/360', '30/360', 'unknown']);
const AMORTISATIONS = new Set<Amortisation>(['in-fine', 'linear', 'constant', 'unknown']);
const PROOFS = new Set<WriteOffProof>([
  'failed-proceedings',
  'credit-insurance',
  'debtor-vanished',
  'other',
]);
const WALLET_KINDS = new Set<WalletMovement['kind']>(['deposit', 'withdrawal', 'bonus', 'tax']);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const dec = (v: unknown): v is string => str(v) && isDecimalString(v);
const naive = (v: unknown): v is string => str(v) && NAIVE.test(v);

function sanitizeLoan(id: string, raw: unknown): Loan | null {
  if (!isRecord(raw)) return null;
  const dayCount = raw['dayCount'];
  const amortisation = raw['amortisation'];
  if (
    !str(raw['accountId']) ||
    !str(raw['platform']) ||
    !str(raw['borrower']) ||
    !str(raw['label']) ||
    !dec(raw['principal']) ||
    !dec(raw['rate']) ||
    !str(dayCount) ||
    !DAY_COUNTS.has(dayCount as DayCount) ||
    !str(amortisation) ||
    !AMORTISATIONS.has(amortisation as Amortisation) ||
    !naive(raw['subscribedAt']) ||
    !str(raw['currency'])
  )
    return null;
  return {
    id,
    accountId: raw['accountId'],
    platform: raw['platform'],
    borrower: raw['borrower'],
    label: raw['label'],
    principal: raw['principal'],
    rate: raw['rate'],
    dayCount: dayCount as DayCount,
    amortisation: amortisation as Amortisation,
    subscribedAt: raw['subscribedAt'],
    maturity: naive(raw['maturity']) ? raw['maturity'] : null,
    currency: raw['currency'],
    sector: str(raw['sector']) ? raw['sector'] : null,
  };
}

function sanitizeEvent(id: string, raw: unknown): LoanEvent | null {
  if (!isRecord(raw) || !str(raw['loanId']) || !naive(raw['at'])) return null;
  const base = { id, loanId: raw['loanId'], at: raw['at'] };
  const note = str(raw['note']) ? { note: raw['note'] } : {};
  switch (raw['kind']) {
    case 'subscription':
      return dec(raw['amount'])
        ? { ...base, ...note, kind: 'subscription', amount: raw['amount'] }
        : null;
    case 'repayment':
    case 'recovery':
      return dec(raw['principal']) && dec(raw['interest']) && dec(raw['withheld'])
        ? {
            ...base,
            ...note,
            kind: raw['kind'],
            principal: raw['principal'],
            interest: raw['interest'],
            withheld: raw['withheld'],
          }
        : null;
    case 'late':
      return { ...base, ...note, kind: 'late' };
    case 'default':
      return {
        ...base,
        ...note,
        kind: 'default',
        outstandingAtDefault: dec(raw['outstandingAtDefault']) ? raw['outstandingAtDefault'] : null,
      };
    case 'write-off':
      return str(raw['proof']) && PROOFS.has(raw['proof'] as WriteOffProof)
        ? { ...base, ...note, kind: 'write-off', proof: raw['proof'] as WriteOffProof }
        : null;
    case 'secondary-sale':
      return dec(raw['proceeds'])
        ? { ...base, ...note, kind: 'secondary-sale', proceeds: raw['proceeds'] }
        : null;
    default:
      return null;
  }
}

function sanitizeMovement(id: string, raw: unknown): WalletMovement | null {
  if (!isRecord(raw) || !naive(raw['at']) || !dec(raw['amount']) || !str(raw['label'])) return null;
  const kind = raw['kind'];
  if (!str(kind) || !WALLET_KINDS.has(kind as WalletMovement['kind'])) return null;
  return {
    id,
    at: raw['at'],
    kind: kind as WalletMovement['kind'],
    amount: raw['amount'],
    label: raw['label'],
  };
}

export function sanitizeLendingState(input: unknown): { state: LendingState; dropped: number } {
  if (!isRecord(input)) return { state: emptyLendingState(), dropped: 0 };
  const state = emptyLendingState();
  let dropped = 0;
  const take = <T>(
    source: unknown,
    into: Record<string, T>,
    sanitize: (id: string, raw: unknown) => T | null,
  ): void => {
    if (!isRecord(source)) return;
    for (const [id, raw] of Object.entries(source)) {
      const value = sanitize(id, raw);
      if (value) into[id] = value;
      else dropped++;
    }
  };
  take(input['loans'], state.loans, sanitizeLoan);
  take(input['events'], state.events, sanitizeEvent);
  take(input['wallet'], state.wallet, sanitizeMovement);
  return { state, dropped };
}
