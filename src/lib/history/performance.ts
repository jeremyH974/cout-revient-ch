/**
 * Assemblage de la performance affichée dans le Rapport : TWR du portefeuille et repère
 * « mêmes apports sur un seul actif ». Module pur — il ne fait que brancher la série quotidienne
 * (couche historique) sur les flux datés du moteur.
 *
 * Point délicat, et seule vraie décision de ce fichier : **les jambes de virement interne apparié
 * sont écartées des flux**. Le moteur les compte (sortie au coût d'un côté, entrée au coût de
 * l'autre) pour que les flux restent la décomposition exacte de Σ achats / Σ produits ; mais du
 * point de vue du patrimoine, aucun euro n'est entré ni sorti — seulement changé de compte. Les
 * laisser ferait apparaître un retrait puis un apport que la courbe de valeur, elle, ne voit pas
 * (cf. `holdingOpsOf`), et le rendement en serait défiguré.
 */
import type { CashFlow } from '../domain/engine';
import { toBenchmarkPrices, replayBenchmark, type BenchmarkPrice } from '../domain/benchmark';
import { twrEur, type TwrDay, type TwrFlow } from '../domain/twr';
import type { AssetCode, EventId } from '../domain/types';
import type { ReportPerformance } from '../export/report-model';
import type { MetricPoint } from './metrics';
import type { DayWindow } from './series';
import { windowTwr } from './window';

export interface PerformanceInput {
  /** Série quotidienne du portefeuille (valeur de clôture par jour), triée. */
  series: readonly MetricPoint[];
  /** Flux du moteur : achats et frais < 0, produits > 0. */
  cashFlows: readonly CashFlow[];
  /** Jambes des virements internes appariés, à neutraliser. */
  internalTransferLegs: Readonly<Record<EventId, 'out' | 'in'>>;
  /** Actif repère et ses cotations quotidiennes (devise d'affichage), ou `null`. */
  benchmark: { asset: AssetCode; prices: readonly BenchmarkPrice[] } | null;
  /** Actifs détenus dont l'historique de prix est incomplet ou absent. */
  partialAssets: number;
}

/** Flux du moteur → flux « apport positif », virements internes appariés exclus. */
export function externalFlows(
  cashFlows: readonly CashFlow[],
  internalTransferLegs: Readonly<Record<EventId, 'out' | 'in'>>,
): TwrFlow[] {
  return cashFlows
    .filter((flow) => internalTransferLegs[flow.eventId] === undefined)
    .map((flow) => ({ at: flow.at, amountEur: flow.amountEur.neg() }));
}

/**
 * TWR et repère du Rapport.
 *
 * Sur une plage (`window.from` non nul, décision n° 179), le TWR se chaîne sur la seule plage, à
 * partir de la clôture de la veille de son premier jour (`windowTwr`). Le repère, lui, n'est PAS
 * calculé : il rejoue les apports sur un seul actif en partant de zéro, et comparerait donc une
 * autre période que la plage — le rapport le dit plutôt que de le montrer.
 */
export function computePerformance(
  input: PerformanceInput,
  window: DayWindow | null = null,
): ReportPerformance {
  const days: TwrDay[] = input.series.map((point) => ({
    day: point.day,
    value: point.value,
    estimated: point.estimated,
  }));
  const flows = externalFlows(input.cashFlows, input.internalTransferLegs);
  if (window !== null && window.from !== null)
    return {
      twr: windowTwr({ series: days, flows }, window),
      benchmark: null,
      partialAssets: input.partialAssets,
    };
  const benchmark =
    input.benchmark === null
      ? null
      : replayBenchmark({
          asset: input.benchmark.asset,
          flows,
          prices: input.benchmark.prices,
          days: days.map((day) => day.day),
        });
  return { twr: twrEur(days, flows), benchmark, partialAssets: input.partialAssets };
}

export { toBenchmarkPrices, type BenchmarkPrice };
