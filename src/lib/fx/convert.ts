/**
 * Conversion du grand livre dans une devise d'affichage : chaque mouvement est converti au
 * taux BCE de son jour (report au dernier jour ouvré disponible), les cotations au taux du jour.
 * Le moteur est agnostique : les champs `*Eur` contiennent alors des montants dans la devise cible.
 */
import { isFiat } from '../domain/assets';
import type { PriceQuoteInput } from '../domain/engine/report';
import { D, toDecimalString, type DecimalString } from '../domain/money';
import type { AssetCode, LedgerEvent } from '../domain/types';
import type { RateSeries } from './types';

export interface RateLookup {
  /** Taux du jour, ou du dernier jour ouvré précédent ; premier taux connu si antérieur. */
  rate(day: string): DecimalString | null;
  firstDay: string | null;
  latestDay: string | null;
}

export function rateLookup(series: RateSeries): RateLookup {
  const days = Object.keys(series).sort();
  return {
    firstDay: days[0] ?? null,
    latestDay: days[days.length - 1] ?? null,
    rate(day) {
      if (days.length === 0) return null;
      if (day < days[0]!) return series[days[0]!] ?? null;
      let lo = 0;
      let hi = days.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (days[mid]! <= day) lo = mid;
        else hi = mid - 1;
      }
      return series[days[lo]!] ?? null;
    },
  };
}

const mul = (value: DecimalString, rate: DecimalString): DecimalString =>
  toDecimalString(D(value).times(rate));
const mulOrNull = (value: DecimalString | null, rate: DecimalString): DecimalString | null =>
  value === null ? null : mul(value, rate);

function convertLeg(leg: { asset: AssetCode; qty: DecimalString }, rate: DecimalString) {
  return isFiat(leg.asset) ? { asset: leg.asset, qty: mul(leg.qty, rate) } : leg;
}

export function convertEvent(event: LedgerEvent, rate: DecimalString): LedgerEvent {
  switch (event.kind) {
    case 'trade':
      return {
        ...event,
        out: convertLeg(event.out, rate),
        in: convertLeg(event.in, rate),
        valueEur: mul(event.valueEur, rate),
        fee: event.fee
          ? {
              ...event.fee,
              grossEur: mul(event.fee.grossEur, rate),
              rebateEur: mul(event.fee.rebateEur, rate),
            }
          : null,
      };
    case 'migration':
      return {
        ...event,
        fairValueOutEur: mulOrNull(event.fairValueOutEur, rate),
        fairValueInEur: mulOrNull(event.fairValueInEur, rate),
      };
    case 'fee':
      return { ...event, amountEur: mul(event.amountEur, rate) };
    case 'reward':
      return { ...event, fairValueEur: mulOrNull(event.fairValueEur, rate) };
    case 'deposit':
      return { ...event, costEur: mulOrNull(event.costEur, rate) };
    case 'withdrawal':
      return { ...event, proceedsEur: mulOrNull(event.proceedsEur, rate) };
    case 'opening-balance':
      return { ...event, costEur: mul(event.costEur, rate) };
    case 'unqualified':
      return {
        ...event,
        legs: event.legs.map((l) => ({ ...l, valueEur: mulOrNull(l.valueEur, rate) })),
      };
  }
}

export type ConvertResult = { ok: true; events: LedgerEvent[] } | { ok: false; reason: string };

/** Convertit tous les événements ; échoue si aucun taux n'est disponible. */
export function convertEvents(events: readonly LedgerEvent[], lookup: RateLookup): ConvertResult {
  if (lookup.firstDay === null) return { ok: false, reason: 'Aucun taux de change disponible.' };
  const converted: LedgerEvent[] = [];
  for (const event of events) {
    const rate = lookup.rate(event.at.slice(0, 10));
    if (!rate) return { ok: false, reason: `Pas de taux pour le ${event.at.slice(0, 10)}.` };
    converted.push(convertEvent(event, rate));
  }
  return { ok: true, events: converted };
}

/** Convertit les cotations au taux de leur jour (en pratique : le dernier taux connu). */
export function convertQuotes(
  quotes: Record<AssetCode, PriceQuoteInput>,
  lookup: RateLookup,
): Record<AssetCode, PriceQuoteInput> {
  const result: Record<AssetCode, PriceQuoteInput> = {};
  for (const [asset, quote] of Object.entries(quotes)) {
    const rate = lookup.rate(quote.at.slice(0, 10));
    if (rate) result[asset] = { ...quote, priceEur: mul(quote.priceEur, rate) };
  }
  return result;
}

/** Premier jour à couvrir : la plus ancienne opération (ou aujourd'hui). */
export function earliestDay(events: readonly LedgerEvent[], today: string): string {
  let min = today;
  for (const event of events) {
    const day = event.at.slice(0, 10);
    if (day < min) min = day;
  }
  return min;
}
