import { describe, expect, it } from 'vitest';
import { D } from '../domain/money';
import { availableMetrics, defaultMetric, metricSeries, type MetricPoint } from './metrics';

const points: MetricPoint[] = [
  { day: '2026-01-01', value: D('0'), cost: D('0'), qty: D('0'), price: D('100') },
  { day: '2026-01-02', value: D('120'), cost: D('100'), qty: D('1'), price: D('120') },
  { day: '2026-01-03', value: D('90'), cost: D('100'), qty: D('1'), price: D('90') },
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
  it('métriques disponibles selon le périmètre', () => {
    expect(availableMetrics('portfolio')).toEqual(['value', 'unrealized', 'unrealizedPct']);
    expect(availableMetrics('asset')).toContain('pru');
    expect(defaultMetric('asset')).toBe('pru');
  });
});
