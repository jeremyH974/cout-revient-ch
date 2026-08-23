import { describe, expect, it } from 'vitest';
import { D } from '../domain/money';
import { availableMetrics, defaultMetric, metricSeries, type MetricPoint } from './metrics';

const points: MetricPoint[] = [
  {
    day: '2026-01-01',
    value: D('0'),
    cost: D('0'),
    qty: D('0'),
    price: D('100'),
    estimated: false,
  },
  {
    day: '2026-01-02',
    value: D('120'),
    cost: D('100'),
    qty: D('1'),
    price: D('120'),
    estimated: false,
  },
  {
    day: '2026-01-03',
    value: D('90'),
    cost: D('100'),
    qty: D('1'),
    price: D('90'),
    estimated: false,
  },
];

describe('métriques', () => {
  it('valeur / investi', () => {
    expect(metricSeries(points, 'value').map((p) => [p.primary, p.secondary])).toEqual([
      [0, 0],
      [120, 100],
      [90, 100],
    ]);
  });
  it('latent en € et en % (jours sans base omis)', () => {
    expect(metricSeries(points, 'unrealized').map((p) => p.primary)).toEqual([0, 20, -10]);
    expect(metricSeries(points, 'unrealizedPct').map((p) => p.primary)).toEqual([20, -10]);
  });
  it('PRU vs prix', () => {
    expect(metricSeries(points, 'pru').map((p) => [p.primary, p.secondary])).toEqual([
      [100, null],
      [120, 100],
      [90, 100],
    ]);
  });
  it('point estimé au coût : propagé à la série, omis de « PRU vs prix »', () => {
    const estimated: MetricPoint = {
      day: '2026-01-04',
      value: D('100'),
      cost: D('100'),
      qty: D('1'),
      price: null,
      estimated: true,
    };
    expect(metricSeries([...points, estimated], 'value').map((p) => p.estimated)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(metricSeries([estimated], 'unrealized')[0]).toMatchObject({
      primary: 0,
      estimated: true,
    });
    expect(metricSeries([estimated], 'unrealizedPct')[0]).toMatchObject({ primary: 0 });
    expect(metricSeries([estimated], 'pru')).toEqual([]);
  });
  it('infobulle : PRU et prix sont des prix unitaires, valeur et investi des montants', () => {
    const extras = metricSeries(points, 'unrealized')[1]!.extras;
    expect(extras.map((e) => `${e.label}:${e.format}`)).toEqual([
      'PRU:price',
      'Prix:price',
      'Valeur:money',
      'Investi:money',
    ]);
    expect(metricSeries(points, 'pru')[1]!.extras.at(-1)).toMatchObject({
      label: 'Écart prix / PRU',
      value: 20,
      format: 'percent',
    });
  });
  it('métriques disponibles selon le périmètre', () => {
    expect(availableMetrics('portfolio')).toEqual(['value', 'unrealized', 'unrealizedPct']);
    expect(availableMetrics('asset')).toContain('pru');
    expect(defaultMetric('asset')).toBe('pru');
  });
});
