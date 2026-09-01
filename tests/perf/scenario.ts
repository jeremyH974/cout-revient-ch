/**
 * Deux formes de portefeuille, engendrées à la demande (décision n° 85).
 *
 * Elles existent parce qu'elles ne relèvent PAS de la même complexité, et que confondre les deux
 * fait dire n'importe quoi à une mesure :
 *
 * - `accumulation` — n achats, aucune vente. Le DCA pur. Le moteur y est linéaire.
 * - `roundTrip` — achats et ventes alternés. Chaque cession parcourt **tous** les lots ouverts
 *   (`position.ts`), et la méthode proportionnelle n'en épuise aucun : le travail et la trace
 *   `lotsConsumed` croissent donc en O(n²).
 *
 * Le même générateur sert au garde-fou déterministe (`engine-load.test.ts`) et au banc d'essai
 * (`engine-load.bench.ts`) : une mesure et son garde-fou doivent décrire le même scénario, sans
 * quoi le second ne garde rien.
 */
import type { LedgerEvent, TradeEvent } from '../../src/lib/domain/types';

/**
 * Instant naïf strictement croissant, engendré par arithmétique — jamais par `Date`, qui
 * introduirait un fuseau là où le format n'en a pas.
 */
function instantAt(index: number): string {
  const minute = index % 60;
  const hour = Math.floor(index / 60) % 24;
  const dayIndex = Math.floor(index / 1440);
  const day = 1 + (dayIndex % 28);
  const month = 1 + (Math.floor(dayIndex / 28) % 12);
  const year = 2015 + Math.floor(dayIndex / 336);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(year, 4)}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:00`;
}

const base = (index: number) => ({
  id: `perf:${index}`,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main',
  rowKeys: [],
  warnings: [],
});

const buy = (index: number, qty: string, eur: string): TradeEvent => ({
  ...base(index),
  kind: 'trade',
  at: instantAt(index),
  out: { asset: 'eur', qty: eur },
  in: { asset: 'btc', qty },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});

const sell = (index: number, qty: string, eur: string): TradeEvent => ({
  ...base(index),
  kind: 'trade',
  at: instantAt(index),
  out: { asset: 'btc', qty },
  in: { asset: 'eur', qty: eur },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});

/** `n` achats du même actif, aucune cession : la forme saine. */
export function accumulation(n: number): LedgerEvent[] {
  return Array.from({ length: n }, (_, i) => buy(i, '0.01', '500'));
}

/**
 * `n` opérations alternées, en commençant par deux achats pour qu'aucune cession ne manque de
 * quantité. Les cessions sont **partielles** — c'est le cas normal, et c'est celui qui n'épuise
 * jamais un lot.
 */
export function roundTrip(n: number): LedgerEvent[] {
  const events: LedgerEvent[] = [buy(0, '1', '50000'), buy(1, '1', '50000')];
  for (let i = 2; i < n; i++)
    events.push(i % 2 === 0 ? buy(i, '1', '50000') : sell(i, '0.5', '25000'));
  return events;
}
