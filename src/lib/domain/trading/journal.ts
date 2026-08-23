/**
 * Journal de trading (P21) : ce que l'utilisateur écrit sur un trade — thèse avant, revue après,
 * setup, tags, erreurs, note, plan (entrée / stop / objectif / risque). Le journal est une donnée
 * première (jamais recalculée) rattachée à un aller-retour reconstruit (`RoundTrip.id`) ou à un
 * trade saisi à la main (`man:<id>`). Ce module fusionne les deux et calcule le R
 * (résultat ÷ risque initial) et l'écart plan / exécution. Pur, `big.js` seulement.
 */
import { D, ZERO, divOrNull, type Big } from '../money';
import type { AccountId, DecimalString, NaiveDateTime } from '../types';
import type { RoundTrip } from './round-trips';

/** Plan de trade : ce qui était prévu AVANT l'entrée ; le risque en devise de cotation. */
export interface TradePlan {
  entry: DecimalString | null;
  stop: DecimalString | null;
  target: DecimalString | null;
  /** Risque assumé (devise de cotation) ; sinon déduit de |entrée − stop| × taille maximale. */
  risk: DecimalString | null;
}

export interface JournalEntry {
  tradeId: string;
  /** « Pourquoi je prends ce trade » — écrit avant (ou pendant). */
  thesis: string;
  /** Revue après clôture : ce qui a marché, ce qui n'a pas marché. */
  review: string;
  setup: string | null;
  tags: string[];
  mistakes: string[];
  rating: 1 | 2 | 3 | 4 | 5 | null;
  plan: TradePlan | null;
}

/**
 * Trade saisi à la main (plateforme sans API) : les prix et quantités sont saisis, le P&L est
 * toujours calculé — jamais saisi. `exitPrice` vide = position encore ouverte.
 */
export interface ManualTrade {
  id: string;
  accountId: AccountId;
  symbol: string;
  direction: 'long' | 'short';
  qty: DecimalString;
  entryPrice: DecimalString;
  exitPrice: DecimalString | null;
  openedAt: NaiveDateTime;
  closedAt: NaiveDateTime | null;
  fees: DecimalString;
  /** Devise de cotation du trade (conversion à l'affichage seulement). */
  quote: 'USD' | 'EUR';
}

/** Setups proposés par défaut — liste courte à dessein (trop de setups = pas de discipline). */
export const DEFAULT_SETUPS = [
  'Cassure',
  'Retour sur moyenne',
  'Tendance',
  'Range',
  'News',
  'Autre',
] as const;

/** Erreurs classiques proposées à la revue. */
export const DEFAULT_MISTAKES = [
  'Entrée trop tôt',
  'Entrée trop tard',
  'Stop trop serré',
  'Pas de stop',
  'Taille trop grande',
  'Sortie émotionnelle',
  'Plan non suivi',
] as const;

export const emptyJournalEntry = (tradeId: string): JournalEntry => ({
  tradeId,
  thesis: '',
  review: '',
  setup: null,
  tags: [],
  mistakes: [],
  rating: null,
  plan: null,
});

export const isEmptyJournalEntry = (entry: JournalEntry): boolean =>
  entry.thesis === '' &&
  entry.review === '' &&
  entry.setup === null &&
  entry.tags.length === 0 &&
  entry.mistakes.length === 0 &&
  entry.rating === null &&
  (entry.plan === null ||
    (entry.plan.entry === null &&
      entry.plan.stop === null &&
      entry.plan.target === null &&
      entry.plan.risk === null));

/** Instant approché d'une date naïve (tri et fenêtres de période uniquement, jamais affiché). */
export function naiveToMs(naive: NaiveDateTime): number {
  const [date, time] = naive.split('T') as [string, string];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm, ss] = time.split(':').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, hh, mm, ss);
}

/** Trade manuel → aller-retour (même forme que la reconstruction Hyperliquid). */
export function manualTradeToRoundTrip(m: ManualTrade): RoundTrip {
  const qty = D(m.qty);
  const entry = D(m.entryPrice);
  const exit = m.exitPrice === null ? null : D(m.exitPrice);
  const sign = m.direction === 'long' ? D('1') : D('-1');
  const gross = exit === null ? ZERO : exit.minus(entry).times(qty).times(sign);
  const fees = D(m.fees);
  const closed = exit !== null;
  return {
    id: `man:${m.id}`,
    accountId: m.accountId,
    market: 'perp',
    symbol: m.symbol,
    quote: m.quote,
    direction: m.direction,
    status: closed ? 'closed' : 'open',
    openedAt: m.openedAt,
    openedTime: naiveToMs(m.openedAt),
    closedAt: m.closedAt,
    closedTime: m.closedAt === null ? null : naiveToMs(m.closedAt),
    executionIds: [],
    qtyOpened: qty,
    qtyClosed: closed ? qty : ZERO,
    qtyMax: qty,
    avgEntry: entry,
    avgExit: exit,
    grossPnl: gross,
    fees,
    funding: ZERO,
    netPnl: gross.minus(fees),
    holdSeconds:
      m.closedAt === null
        ? null
        : Math.round((naiveToMs(m.closedAt) - naiveToMs(m.openedAt)) / 1000),
    liquidated: false,
    incomplete: false,
    source: 'manual',
  };
}

/** Risque initial du trade : explicite, sinon |entrée du plan − stop| × taille maximale. */
export function riskOf(trip: RoundTrip, plan: TradePlan | null): Big | null {
  if (!plan) return null;
  if (plan.risk !== null) {
    const risk = D(plan.risk);
    return risk.gt(ZERO) ? risk : null;
  }
  if (plan.entry !== null && plan.stop !== null) {
    const perUnit = D(plan.entry).minus(plan.stop).abs();
    return perUnit.gt(ZERO) ? perUnit.times(trip.qtyMax) : null;
  }
  return null;
}

export interface JournaledTrip {
  trip: RoundTrip;
  journal: JournalEntry | null;
  /** Résultat net ÷ risque initial (trades clos avec un risque connu). */
  r: Big | null;
  /** (entrée réelle − entrée prévue) ÷ entrée prévue, signée (long : positif = payé plus cher). */
  entrySlippage: Big | null;
}

export function journaledTrip(trip: RoundTrip, entry: JournalEntry | null): JournaledTrip {
  // Une entrée entièrement vide compte comme « pas de journal » (badge et filtres).
  const journal = entry !== null && !isEmptyJournalEntry(entry) ? entry : null;
  const risk = riskOf(trip, entry?.plan ?? null);
  const r = trip.status === 'closed' && risk !== null ? divOrNull(trip.netPnl, risk) : null;
  const planned = entry?.plan?.entry ?? null;
  const entrySlippage =
    planned !== null && trip.avgEntry !== null && D(planned).gt(ZERO)
      ? trip.avgEntry.minus(planned).div(planned)
      : null;
  return { trip, journal, r, entrySlippage };
}

/** Fusionne aller-retours (auto + manuels) et journal, du plus récent au plus ancien. */
export function journaledTrips(
  trips: readonly RoundTrip[],
  manual: readonly ManualTrade[],
  journal: Readonly<Record<string, JournalEntry>>,
): JournaledTrip[] {
  const all = [...trips, ...manual.map(manualTradeToRoundTrip)];
  all.sort((a, b) => b.openedTime - a.openedTime || (a.id < b.id ? -1 : 1));
  return all.map((trip) => journaledTrip(trip, journal[trip.id] ?? null));
}
