/**
 * Moteur Prêts : réduit un contrat et ses événements datés à un état observable à une date
 * donnée. Fonction pure, aucune dépendance Svelte ni DOM, `Big` pour tout montant.
 *
 * Principe directeur : le statut se DÉRIVE, il ne se stocke pas. On rejoue les événements dans
 * l'ordre, et ce qui en sort — encours, retard, défaut — n'est jamais une valeur saisie.
 */
import { daysInMonth, epochDayOf } from '../date';
import { D, ZERO, compare, max, min, toDecimalString, type Big } from '../money';
import type {
  Concentration,
  DayCount,
  LendingInput,
  LendingReport,
  LendingTotals,
  Loan,
  LoanEvent,
  LoanReport,
  LoanStatus,
} from './types';

const STATUSES: LoanStatus[] = [
  'pending',
  'performing',
  'late',
  'defaulted',
  'written-off',
  'sold',
  'repaid',
];

function parseYmd(day: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

/** Convention « Bond Basis » 30/360 US : mois de 30 jours, année de 360. */
function days360(
  from: { y: number; m: number; d: number },
  to: { y: number; m: number; d: number },
): number {
  const d1 = Math.min(from.d, 30);
  const d2 = d1 === 30 && to.d === 31 ? 30 : to.d;
  return (to.y - from.y) * 360 + (to.m - from.m) * 30 + (d2 - d1);
}

/**
 * Fraction d'année entre deux jours selon la convention du prêt. `null` quand la convention est
 * inconnue : on n'affiche alors aucun intérêt couru plutôt qu'un intérêt faux — les conventions
 * varient d'une plateforme française à l'autre et l'écart se voit dans l'IFU.
 */
export function dayCountFraction(convention: DayCount, fromDay: string, toDay: string): Big | null {
  if (convention === 'unknown') return null;
  if (convention === '30/360') {
    const from = parseYmd(fromDay);
    const to = parseYmd(toDay);
    if (!from || !to) return null;
    const days = days360(from, to);
    return days <= 0 ? ZERO : D(String(days)).div(D('360'));
  }
  const from = epochDayOf(fromDay);
  const to = epochDayOf(toDay);
  if (from === null || to === null) return null;
  const days = to - from;
  if (days <= 0) return ZERO;
  return D(String(days)).div(D(convention === 'act/360' ? '360' : '365'));
}

/** Tri stable des événements : par horodatage naïf (ISO, donc lexicographique), puis par id. */
function byDate(a: LoanEvent, b: LoanEvent): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface Rolled {
  disbursed: Big;
  principalRepaid: Big;
  interestReceived: Big;
  withheld: Big;
  writtenOff: Big;
  saleProceeds: Big;
  outstanding: Big;
  hasDefault: boolean;
  hasWriteOff: boolean;
  hasSale: boolean;
  lastLateAt: string | null;
  /** Dernier encaissement d'intérêt : point de départ du prochain couru. */
  lastInterestAt: string | null;
  lastEventAt: string | null;
}

function roll(events: readonly LoanEvent[]): Rolled {
  const acc: Rolled = {
    disbursed: ZERO,
    principalRepaid: ZERO,
    interestReceived: ZERO,
    withheld: ZERO,
    writtenOff: ZERO,
    saleProceeds: ZERO,
    outstanding: ZERO,
    hasDefault: false,
    hasWriteOff: false,
    hasSale: false,
    lastLateAt: null,
    lastInterestAt: null,
    lastEventAt: null,
  };
  for (const event of events) {
    acc.lastEventAt = event.at;
    switch (event.kind) {
      case 'subscription': {
        const amount = D(event.amount);
        acc.disbursed = acc.disbursed.plus(amount);
        acc.outstanding = acc.outstanding.plus(amount);
        break;
      }
      case 'repayment':
      case 'recovery': {
        const principal = D(event.principal);
        const interest = D(event.interest);
        acc.principalRepaid = acc.principalRepaid.plus(principal);
        acc.interestReceived = acc.interestReceived.plus(interest);
        acc.withheld = acc.withheld.plus(D(event.withheld));
        // Un recouvrement POSTÉRIEUR à un passage en perte reprend sur la perte : il ne s'ajoute
        // pas au capital remboursé sans contrepartie, sinon `versé = remboursé + perte + encours`
        // se briserait — et la perte imputée fiscalement resterait surévaluée.
        const fromOutstanding = min(principal, acc.outstanding);
        acc.outstanding = acc.outstanding.minus(fromOutstanding);
        const beyond = principal.minus(fromOutstanding);
        if (beyond.gt(ZERO)) acc.writtenOff = max(ZERO, acc.writtenOff.minus(beyond));
        if (interest.gt(ZERO)) acc.lastInterestAt = event.at;
        break;
      }
      case 'late':
        acc.lastLateAt = event.at;
        break;
      case 'default':
        acc.hasDefault = true;
        break;
      case 'write-off':
        // Ce qui restait dû au moment du constat devient la perte : on ne resaisit rien.
        acc.writtenOff = acc.writtenOff.plus(acc.outstanding);
        acc.outstanding = ZERO;
        acc.hasWriteOff = true;
        break;
      case 'secondary-sale':
        acc.saleProceeds = acc.saleProceeds.plus(D(event.proceeds));
        acc.outstanding = ZERO;
        acc.hasSale = true;
        break;
    }
  }
  return acc;
}

function statusOf(acc: Rolled, daysLate: number | null): LoanStatus {
  if (acc.hasWriteOff) return 'written-off';
  if (acc.hasSale) return 'sold';
  if (acc.disbursed.eq(ZERO)) return 'pending';
  if (acc.outstanding.eq(ZERO)) return 'repaid';
  if (acc.hasDefault) return 'defaulted';
  if (daysLate !== null) return 'late';
  return 'performing';
}

/**
 * Retard à la date d'observation. Deux sources concordantes : l'échéance contractuelle dépassée
 * alors qu'il reste du capital dû, et un retard explicitement constaté par la plateforme. On
 * retient le plus ancien des deux — c'est le retard réel, pas le dernier signalé.
 */
function daysLateOf(loan: Loan, acc: Rolled, asOf: string): number | null {
  if (acc.outstanding.eq(ZERO)) return null;
  const today = epochDayOf(asOf);
  if (today === null) return null;
  const candidates: number[] = [];
  if (loan.maturity) {
    const due = epochDayOf(loan.maturity);
    if (due !== null && today > due) candidates.push(today - due);
  }
  if (acc.lastLateAt) {
    const seen = epochDayOf(acc.lastLateAt);
    if (seen !== null && today >= seen) candidates.push(today - seen);
  }
  return candidates.length === 0 ? null : Math.max(...candidates);
}

/**
 * Intérêts courus non échus sur l'encours, depuis le dernier encaissement d'intérêt (ou la
 * souscription). Comptés pour les seuls prêts qui courent encore — un prêt en défaut qui
 * continuerait d'accumuler des intérêts serait une fiction optimiste, et le secteur ne le fait
 * pas (Bondora passe le retard en perte sans provisionner l'avenir).
 */
function accruedOf(loan: Loan, acc: Rolled, status: LoanStatus, asOf: string): Big | null {
  if (status !== 'performing' && status !== 'late') return ZERO;
  const from = (acc.lastInterestAt ?? loan.subscribedAt).slice(0, 10);
  const fraction = dayCountFraction(loan.dayCount, from, asOf);
  if (fraction === null) return null;
  return acc.outstanding.times(D(loan.rate)).times(fraction);
}

function concentrationOf(entries: Map<string, Big>): Concentration {
  let total = ZERO;
  for (const value of entries.values()) total = total.plus(value);
  if (total.eq(ZERO)) return { index: null, effectiveCount: null, top: [] };
  const rows = [...entries]
    .filter(([, value]) => value.gt(ZERO))
    .map(([key, value]) => ({ key, value, weight: value.div(total) }))
    .sort((a, b) => compare(b.value, a.value));
  let index = ZERO;
  for (const row of rows) index = index.plus(row.weight.times(row.weight));
  return {
    index: toDecimalString(index),
    effectiveCount: index.eq(ZERO) ? null : toDecimalString(D('1').div(index)),
    top: rows.map((row) => ({
      key: row.key,
      outstanding: toDecimalString(row.value),
      weight: toDecimalString(row.weight),
    })),
  };
}

/** Rejoue les prêts et leurs événements à la date `asOf`. */
export function computeLending(input: LendingInput): LendingReport {
  const known = new Map<string, Loan>(input.loans.map((loan) => [loan.id, loan]));
  const grouped = new Map<string, LoanEvent[]>();
  const orphanEvents: string[] = [];
  for (const event of input.events) {
    if (!known.has(event.loanId)) {
      orphanEvents.push(event.id);
      continue;
    }
    const bucket = grouped.get(event.loanId);
    if (bucket) bucket.push(event);
    else grouped.set(event.loanId, [event]);
  }

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<LoanStatus, number>;
  const byBorrower = new Map<string, Big>();
  const byPlatform = new Map<string, Big>();
  const totals = {
    disbursed: ZERO,
    principalRepaid: ZERO,
    interestReceived: ZERO,
    withheld: ZERO,
    writtenOff: ZERO,
    saleProceeds: ZERO,
    outstanding: ZERO,
    accruedInterest: ZERO,
  };
  let accrualUnavailable = 0;

  const loans: LoanReport[] = input.loans.map((loan) => {
    const events = (grouped.get(loan.id) ?? []).slice().sort(byDate);
    const acc = roll(events);
    const daysLate = daysLateOf(loan, acc, input.asOf);
    const status = statusOf(acc, daysLate);
    const accrued = accruedOf(loan, acc, status, input.asOf);
    if (accrued === null) accrualUnavailable += 1;

    totals.disbursed = totals.disbursed.plus(acc.disbursed);
    totals.principalRepaid = totals.principalRepaid.plus(acc.principalRepaid);
    totals.interestReceived = totals.interestReceived.plus(acc.interestReceived);
    totals.withheld = totals.withheld.plus(acc.withheld);
    totals.writtenOff = totals.writtenOff.plus(acc.writtenOff);
    totals.saleProceeds = totals.saleProceeds.plus(acc.saleProceeds);
    totals.outstanding = totals.outstanding.plus(acc.outstanding);
    if (accrued) totals.accruedInterest = totals.accruedInterest.plus(accrued);

    byStatus[status] += 1;
    if (acc.outstanding.gt(ZERO)) {
      byBorrower.set(loan.borrower, (byBorrower.get(loan.borrower) ?? ZERO).plus(acc.outstanding));
      byPlatform.set(loan.platform, (byPlatform.get(loan.platform) ?? ZERO).plus(acc.outstanding));
    }

    return {
      loan,
      status,
      disbursed: toDecimalString(acc.disbursed),
      principalRepaid: toDecimalString(acc.principalRepaid),
      interestReceived: toDecimalString(acc.interestReceived),
      withheld: toDecimalString(acc.withheld),
      writtenOff: toDecimalString(acc.writtenOff),
      saleProceeds: toDecimalString(acc.saleProceeds),
      outstanding: toDecimalString(acc.outstanding),
      accruedInterest: accrued === null ? null : toDecimalString(accrued),
      daysLate,
      lastEventAt: acc.lastEventAt,
    };
  });

  const summed: LendingTotals = {
    disbursed: toDecimalString(totals.disbursed),
    principalRepaid: toDecimalString(totals.principalRepaid),
    interestReceived: toDecimalString(totals.interestReceived),
    withheld: toDecimalString(totals.withheld),
    writtenOff: toDecimalString(totals.writtenOff),
    saleProceeds: toDecimalString(totals.saleProceeds),
    outstanding: toDecimalString(totals.outstanding),
    accruedInterest: toDecimalString(totals.accruedInterest),
    accrualUnavailable,
    value: toDecimalString(totals.outstanding.plus(totals.accruedInterest)),
  };

  return {
    asOf: input.asOf,
    loans,
    totals: summed,
    byStatus,
    concentration: {
      byBorrower: concentrationOf(byBorrower),
      byPlatform: concentrationOf(byPlatform),
    },
    orphanEvents,
  };
}

export { STATUSES as LOAN_STATUSES };
