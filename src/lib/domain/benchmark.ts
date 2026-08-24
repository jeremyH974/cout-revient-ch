/**
 * Repère « et si j'avais tout mis sur un seul actif ? » — rejeu des flux RÉELS de l'utilisateur
 * (mêmes montants, mêmes dates) sur un actif unique, bitcoin par défaut. Ce n'est ni un conseil,
 * ni une prédiction : c'est une opération arithmétique sur des prix passés, dont le seul mérite
 * est de comparer ce qui est comparable — le calendrier d'apports est le même des deux côtés.
 *
 * Règles assumées :
 * - un retrait ne peut pas vendre plus que ce que le repère détient (pas de vente à découvert) :
 *   l'excédent est compté dans `clampedEur` et affiché, jamais avalé en silence ;
 * - un flux antérieur à la première cotation connue est écarté (`skippedFlows`) et la fenêtre du
 *   repère commence à cette cotation : comparer sur deux fenêtres différentes n'aurait aucun sens ;
 * - le TWR du repère est calculé par la MÊME fonction que celui du portefeuille.
 */
import { D, ZERO, type Big } from './money';
import type { AssetCode } from './types';
import { twrEur, type TwrDay, type TwrFlow, type TwrResult } from './twr';
import { xirrEur, type XirrResult } from './xirr';

export interface BenchmarkPrice {
  day: string;
  priceEur: Big;
}

export interface BenchmarkInput {
  asset: AssetCode;
  /** Flux externes du portefeuille : positif = apport, négatif = retrait. */
  flows: readonly TwrFlow[];
  /** Cotations quotidiennes de l'actif repère, triées par jour croissant. */
  prices: readonly BenchmarkPrice[];
  /** Grille quotidienne contiguë et triée (celle du portefeuille), pour une fenêtre identique. */
  days: readonly string[];
}

export interface BenchmarkResult {
  asset: AssetCode;
  /** Quantité détenue à la fin de la fenêtre. */
  qty: Big;
  valueEur: Big;
  investedEur: Big;
  withdrawnEur: Big;
  /** Retraits impossibles faute de position : montant rogné. */
  clampedEur: Big;
  /** Flux écartés faute de cotation à leur date. */
  skippedFlows: number;
  since: string;
  until: string;
  series: TwrDay[];
  twr: TwrResult;
  xirr: XirrResult;
}

/** Dernière cotation dont le jour ≤ `day` (prix triés), sinon `null`. */
function priceAt(prices: readonly BenchmarkPrice[], day: string): Big | null {
  let low = 0;
  let high = prices.length - 1;
  let found: Big | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const point = prices[mid]!;
    if (point.day <= day) {
      found = point.priceEur;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

export function replayBenchmark(input: BenchmarkInput): BenchmarkResult | null {
  const { asset, prices, days } = input;
  const firstPriceDay = prices[0]?.day;
  if (firstPriceDay === undefined || days.length < 2) return null;
  // Fenêtre commune : le repère ne peut pas commencer avant sa première cotation.
  const windowDays = days.filter((day) => day >= firstPriceDay);
  if (windowDays.length < 2) return null;
  const since = windowDays[0]!;
  const until = windowDays[windowDays.length - 1]!;

  const byDay = new Map<string, TwrFlow[]>();
  let skippedFlows = 0;
  const kept: TwrFlow[] = [];
  for (const flow of input.flows) {
    const day = flow.at.slice(0, 10);
    // Le premier jour de la fenêtre est un état de départ (comme dans `twrEur`) : un flux daté ce
    // jour-là ou avant n'a pas de contrepartie possible dans le repère, il est compté et signalé.
    if (day <= since) {
      skippedFlows++;
      continue;
    }
    if (day > until) continue;
    const list = byDay.get(day) ?? [];
    list.push(flow);
    byDay.set(day, list);
    kept.push(flow);
  }

  let qty = ZERO;
  let investedEur = ZERO;
  let withdrawnEur = ZERO;
  let clampedEur = ZERO;
  const series: TwrDay[] = [];
  for (const day of windowDays) {
    const price = priceAt(prices, day);
    for (const flow of byDay.get(day) ?? []) {
      if (price === null || price.lte(ZERO)) {
        skippedFlows++;
        continue;
      }
      if (flow.amountEur.gt(ZERO)) {
        qty = qty.plus(flow.amountEur.div(price));
        investedEur = investedEur.plus(flow.amountEur);
      } else if (flow.amountEur.lt(ZERO)) {
        const wanted = flow.amountEur.abs().div(price);
        const sold = wanted.gt(qty) ? qty : wanted;
        qty = qty.minus(sold);
        withdrawnEur = withdrawnEur.plus(sold.times(price));
        clampedEur = clampedEur.plus(wanted.minus(sold).times(price));
      }
    }
    series.push({ day, value: price === null ? ZERO : qty.times(price) });
  }

  const valueEur = series[series.length - 1]?.value ?? ZERO;
  // Le repère détient exactement les mêmes flux que le portefeuille (aux flux écartés près) :
  // ses taux se calculent avec les mêmes fonctions, donc sur la même définition.
  const xirrFlows = kept.map((flow) => ({ at: flow.at, amountEur: flow.amountEur.neg() }));
  return {
    asset,
    qty,
    valueEur,
    investedEur,
    withdrawnEur,
    clampedEur,
    skippedFlows,
    since,
    until,
    series,
    twr: twrEur(series, kept),
    xirr: xirrEur(xirrFlows, valueEur.gt(ZERO) ? { day: until, valueEur } : null),
  };
}

/** Écart de valeur finale entre le portefeuille et son repère (positif = le portefeuille devant). */
export function benchmarkGap(portfolioValueEur: Big, benchmark: BenchmarkResult): Big {
  return portfolioValueEur.minus(benchmark.valueEur);
}

/** Prix `DecimalString` → `Big`, filtrés et triés : entrée type de `replayBenchmark`. */
export function toBenchmarkPrices(
  points: readonly { day: string; priceEur: string }[],
): BenchmarkPrice[] {
  return points
    .map((point) => ({ day: point.day, priceEur: D(point.priceEur) }))
    .filter((point) => point.priceEur.gt(ZERO))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
