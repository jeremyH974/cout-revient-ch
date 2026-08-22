/** Rééchantillonnage des séries intraday de plusieurs actifs sur une grille commune. */
import { D, ZERO, type Big } from '../domain/money';
import type { AssetCode } from '../domain/types';
import type { IntradayPoint } from './types';

export interface IntradayValuePoint {
  /** ISO 8601 de l'instant. */
  at: string;
  value: Big;
  cost: Big;
}

export interface IntradayInput {
  points: Record<AssetCode, readonly IntradayPoint[]>;
  qty: Record<AssetCode, Big>;
  cost: Record<AssetCode, Big>;
  /** Multiplicateur de devise appliqué aux prix (1 en euros). */
  rate: string;
  fromMs: number;
  toMs: number;
  stepMs: number;
}

/** Valeur des avoirs actuels à chaque pas : dernier prix connu ≤ instant, actifs sans point ignorés. */
export function intradayValueSeries(input: IntradayInput): IntradayValuePoint[] {
  const assets = Object.keys(input.qty).filter((a) => (input.points[a]?.length ?? 0) > 0);
  const cursors: Record<AssetCode, number> = {};
  const sorted: Record<AssetCode, IntradayPoint[]> = {};
  for (const asset of assets) {
    sorted[asset] = [...(input.points[asset] ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    cursors[asset] = -1;
  }
  const totalCost = assets.reduce((acc, a) => acc.plus(input.cost[a] ?? ZERO), ZERO);
  const result: IntradayValuePoint[] = [];
  for (let t = input.fromMs; t <= input.toMs; t += input.stepMs) {
    const at = new Date(t).toISOString();
    let value = ZERO;
    let any = false;
    for (const asset of assets) {
      const list = sorted[asset]!;
      let i = cursors[asset]!;
      while (i + 1 < list.length && list[i + 1]!.at <= at) i++;
      cursors[asset] = i;
      if (i < 0) continue;
      any = true;
      value = value.plus(
        D(list[i]!.priceEur)
          .times(input.rate)
          .times(input.qty[asset] ?? ZERO),
      );
    }
    if (any) result.push({ at, value, cost: totalCost });
  }
  return result;
}
