/** Métriques traçables à partir des séries quotidiennes (valeur, coût, quantité, prix). */
import { Big, ZERO } from '../domain/money';

export type Metric = 'value' | 'unrealized' | 'unrealizedPct' | 'pru';
export const METRICS: readonly Metric[] = ['value', 'unrealized', 'unrealizedPct', 'pru'];

/**
 * Nature d'une valeur affichée : `money` = montant (masqué en mode discret), `price` = prix
 * unitaire (toujours visible), `percent` = pourcentage en points (12.3 = 12,3 %).
 */
export type ValueFormat = 'money' | 'percent' | 'price';

export interface MetricPoint {
  /** `YYYY-MM-DD`, ou ISO 8601 pour l'intraday. */
  day: string;
  value: Big;
  cost: Big;
  /** Quantité détenue (null pour le portefeuille global). */
  qty: Big | null;
  /** Prix de marché unitaire (null pour le portefeuille global ou sans cotation). */
  price: Big | null;
  /** Valeur estimée au coût : au moins un actif détenu n'a aucune cotation connue ce jour-là. */
  estimated: boolean;
}

export interface MetricExtra {
  label: string;
  value: number;
  format: ValueFormat;
}

export interface MetricSeriesPoint {
  day: string;
  primary: number;
  secondary: number | null;
  /** Valeurs complémentaires affichées dans l'infobulle (PRU, prix, écart…). */
  extras: MetricExtra[];
  estimated: boolean;
}

export interface MetricSpec {
  key: Metric;
  label: string;
  format: ValueFormat;
  primaryLabel: string;
  secondaryLabel: string | null;
  zeroLine: boolean;
  /** Couleur de la courbe : tendance sur la période, signe de la valeur, ou écart à la courbe secondaire. */
  colorMode: 'trend' | 'sign' | 'vsSecondary';
  /**
   * Courbe secondaire mise en avant (trait plein accentué + étiquette) ; seule la zone entre les
   * deux courbes est colorée gain/perte, les courbes elles-mêmes restent neutres.
   */
  band: boolean;
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
    band: false,
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
    band: false,
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
    band: false,
    assetOnly: false,
  },
  pru: {
    key: 'pru',
    label: 'PRU vs prix',
    format: 'price',
    primaryLabel: 'Prix',
    secondaryLabel: 'PRU',
    zeroLine: false,
    colorMode: 'vsSecondary',
    band: true,
    assetOnly: true,
  },
};

export function availableMetrics(scope: 'portfolio' | 'asset'): Metric[] {
  return METRICS.filter((m) => scope === 'asset' || !METRIC_SPECS[m].assetOnly);
}

/** Métrique par défaut : le PRU face au prix sur un actif, la valeur sur le portefeuille. */
export function defaultMetric(scope: 'portfolio' | 'asset'): Metric {
  return scope === 'asset' ? 'pru' : 'value';
}

/** Big → nombre pour la géométrie SVG (8 décimales ; aucun montant affiché n'en est issu). */
const num = (b: Big): number => Number(b.round(8, Big.roundHalfUp).toString());
const pruOf = (p: MetricPoint): Big | null =>
  p.qty !== null && p.qty.gt(ZERO) ? p.cost.div(p.qty) : null;

function extrasOf(p: MetricPoint, metric: Metric): MetricExtra[] {
  const extras: MetricExtra[] = [];
  const pru = pruOf(p);
  if (metric !== 'pru') {
    if (pru !== null) extras.push({ label: 'PRU', value: num(pru), format: 'price' });
    if (p.price !== null && p.qty !== null)
      extras.push({ label: 'Prix', value: num(p.price), format: 'price' });
  }
  if (metric !== 'value') {
    extras.push({ label: 'Valeur', value: num(p.value), format: 'money' });
    extras.push({ label: 'Investi', value: num(p.cost), format: 'money' });
  }
  if (metric === 'pru' && pru !== null && p.price !== null && pru.gt(ZERO)) {
    extras.push({
      label: 'Écart prix / PRU',
      value: num(p.price.minus(pru).div(pru).times('100')),
      format: 'percent',
    });
  }
  return extras;
}

/** Projette les points quotidiens sur une métrique ; les jours sans valeur calculable sont omis. */
export function metricSeries(points: readonly MetricPoint[], metric: Metric): MetricSeriesPoint[] {
  const out: MetricSeriesPoint[] = [];
  for (const p of points) {
    const extras = extrasOf(p, metric);
    const estimated = p.estimated;
    switch (metric) {
      case 'value':
        out.push({ day: p.day, primary: num(p.value), secondary: num(p.cost), extras, estimated });
        break;
      case 'unrealized':
        out.push({
          day: p.day,
          primary: num(p.value.minus(p.cost)),
          secondary: null,
          extras,
          estimated,
        });
        break;
      case 'unrealizedPct':
        if (p.cost.gt(ZERO))
          out.push({
            day: p.day,
            primary: num(p.value.minus(p.cost).div(p.cost).times('100')),
            secondary: null,
            extras,
            estimated,
          });
        break;
      case 'pru':
        if (p.price !== null) {
          const pru = pruOf(p);
          out.push({
            day: p.day,
            primary: num(p.price),
            secondary: pru === null ? null : num(pru),
            extras,
            estimated,
          });
        }
        break;
    }
  }
  return out;
}
