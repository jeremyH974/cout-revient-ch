/** Métriques traçables à partir des séries quotidiennes (valeur, coût, quantité, prix). */
import { ZERO, type Big } from '../domain/money';

export type Metric = 'value' | 'unrealized' | 'unrealizedPct' | 'pru';
export const METRICS: readonly Metric[] = ['value', 'unrealized', 'unrealizedPct', 'pru'];

export interface MetricPoint {
  /** `YYYY-MM-DD`, ou ISO 8601 pour l'intraday. */
  day: string;
  value: Big;
  cost: Big;
  /** Quantité détenue (null pour le portefeuille global). */
  qty: Big | null;
  /** Prix de marché unitaire (null pour le portefeuille global ou sans cotation). */
  price: Big | null;
}

export interface MetricSeriesPoint {
  day: string;
  primary: number;
  secondary: number | null;
}

export interface MetricSpec {
  key: Metric;
  label: string;
  format: 'money' | 'percent';
  primaryLabel: string;
  secondaryLabel: string | null;
  zeroLine: boolean;
  /** Couleur de la courbe : tendance sur la période, signe de la valeur, ou écart à la courbe secondaire. */
  colorMode: 'trend' | 'sign' | 'vsSecondary';
  assetOnly: boolean;
}

export const METRIC_SPECS: Record<Metric, MetricSpec> = {
  value: {
    key: 'value',
    label: 'Valeur',
    format: 'money',
    primaryLabel: 'Valeur',
    secondaryLabel: 'Investi',
    zeroLine: false,
    colorMode: 'trend',
    assetOnly: false,
  },
  unrealized: {
    key: 'unrealized',
    label: 'Latent €',
    format: 'money',
    primaryLabel: 'Plus-value latente',
    secondaryLabel: null,
    zeroLine: true,
    colorMode: 'sign',
    assetOnly: false,
  },
  unrealizedPct: {
    key: 'unrealizedPct',
    label: 'Latent %',
    format: 'percent',
    primaryLabel: 'Latent (% vs investi)',
    secondaryLabel: null,
    zeroLine: true,
    colorMode: 'sign',
    assetOnly: false,
  },
  pru: {
    key: 'pru',
    label: 'PRU vs prix',
    format: 'money',
    primaryLabel: 'Prix',
    secondaryLabel: 'PRU',
    zeroLine: false,
    colorMode: 'vsSecondary',
    assetOnly: true,
  },
};

export function availableMetrics(scope: 'portfolio' | 'asset'): Metric[] {
  return METRICS.filter((m) => scope === 'asset' || !METRIC_SPECS[m].assetOnly);
}

const num = (b: Big): number => Number(b.toFixed(8));

/** Projette les points quotidiens sur une métrique ; les jours sans valeur calculable sont omis. */
export function metricSeries(points: readonly MetricPoint[], metric: Metric): MetricSeriesPoint[] {
  const out: MetricSeriesPoint[] = [];
  for (const p of points) {
    switch (metric) {
      case 'value':
        out.push({ day: p.day, primary: num(p.value), secondary: num(p.cost) });
        break;
      case 'unrealized':
        out.push({ day: p.day, primary: num(p.value.minus(p.cost)), secondary: null });
        break;
      case 'unrealizedPct':
        if (p.cost.gt(ZERO))
          out.push({
            day: p.day,
            primary: num(p.value.minus(p.cost).div(p.cost).times('100')),
            secondary: null,
          });
        break;
      case 'pru':
        if (p.price !== null) {
          const pru = p.qty !== null && p.qty.gt(ZERO) ? p.cost.div(p.qty) : null;
          out.push({
            day: p.day,
            primary: num(p.price),
            secondary: pru === null ? null : num(pru),
          });
        }
        break;
    }
  }
  return out;
}
