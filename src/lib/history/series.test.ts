import { describe, expect, it } from 'vitest';
import { D, ZERO } from '../domain/money';
import { eachDay } from './days';
import {
  downsample,
  holdingStep,
  holdingsByDay,
  lastPointAtOrBefore,
  minMax,
  periodPerformance,
  periodWindow,
  sliceSeries,
  valueSeries,
  type ValuePoint,
} from './series';

const op = (at: string, qtyAfter: string, pruAfter: string | null) => ({
  at,
  qtyAfter: D(qtyAfter),
  pruAfter: pruAfter === null ? null : D(pruAfter),
});
const point = (day: string, value: string): ValuePoint => ({
  day,
  value: D(value),
  cost: ZERO,
  missing: [],
});

describe('holdingsByDay', () => {
  it('fonction en escalier : dernière opération du jour, zéro avant la première', () => {
    const step = holdingStep([
      op('2026-08-20T10:00:00', '2', '100'),
      op('2026-08-18T09:00:00', '1', '100'),
      op('2026-08-20T18:00:00', '1.5', '100'),
      op('2026-08-22T08:00:00', '0', null),
    ]);
    expect(step('2026-08-17').qty.toString()).toBe('0');
    expect(step('2026-08-18').qty.toString()).toBe('1');
    expect(step('2026-08-19').cost.toString()).toBe('100');
    expect(step('2026-08-20').qty.toString()).toBe('1.5');
    expect(step('2026-08-20').cost.toString()).toBe('150');
    expect(step('2026-08-21').qty.toString()).toBe('1.5');
    expect(step('2026-08-22').cost.toString()).toBe('0');
    expect(step('2030-01-01').qty.toString()).toBe('0');
    const steps = holdingsByDay({ btc: [op('2026-08-18T00:00:00', '1', '50')], eth: [] });
    expect(steps['btc']!('2026-08-18').cost.toString()).toBe('50');
    expect(steps['eth']!('2026-08-18').qty.toString()).toBe('0');
  });
});

describe('valueSeries', () => {
  const holdings = holdingsByDay({
    btc: [op('2026-08-18T10:00:00', '1', '50000'), op('2026-08-20T10:00:00', '2', '55000')],
    eth: [op('2026-08-19T10:00:00', '10', '2000')],
    gmx: [op('2026-08-18T10:00:00', '5', '10')],
  });
  const prices = {
    btc: {
      points: [
        { day: '2026-08-18', priceEur: '60000' },
        { day: '2026-08-19', priceEur: '61000' },
      ],
    },
    eth: {
      points: [
        { day: '2026-08-20', priceEur: '3000' },
        { day: '2026-08-21', priceEur: '3100' },
      ],
    },
  };

  it('Σ qté × prix du jour, dernier prix connu, actifs sans prix exclus et comptés', () => {
    const series = valueSeries({ holdings, prices, days: eachDay('2026-08-17', '2026-08-21') });
    expect(series.map((p) => `${p.day} ${p.value} ${p.cost} [${p.missing.join(',')}]`)).toEqual([
      '2026-08-17 0 0 []',
      '2026-08-18 60000 50000 [gmx]',
      '2026-08-19 61000 50000 [eth,gmx]',
      '2026-08-20 152000 130000 [gmx]',
      '2026-08-21 153000 130000 [gmx]',
    ]);
  });

  it('lastPointAtOrBefore : recherche binaire sur points triés', () => {
    const points = prices.btc.points;
    expect(lastPointAtOrBefore(points, '2026-08-17')).toBeNull();
    expect(lastPointAtOrBefore(points, '2026-08-18')!.priceEur).toBe('60000');
    expect(lastPointAtOrBefore(points, '2026-12-31')!.priceEur).toBe('61000');
    expect(lastPointAtOrBefore([], '2026-08-18')).toBeNull();
  });
});

describe('périodes', () => {
  it('periodWindow borne chaque période en calendaire UTC', () => {
    expect(periodWindow('1d', '2026-08-22')).toEqual({ from: '2026-08-21', to: '2026-08-22' });
    expect(periodWindow('1w', '2026-08-22')).toEqual({ from: '2026-08-15', to: '2026-08-22' });
    expect(periodWindow('1m', '2026-03-31')).toEqual({ from: '2026-02-28', to: '2026-03-31' });
    expect(periodWindow('3m', '2026-08-22')).toEqual({ from: '2026-05-22', to: '2026-08-22' });
    expect(periodWindow('1y', '2024-02-29')).toEqual({ from: '2023-02-28', to: '2024-02-29' });
    expect(periodWindow('all', '2026-08-22')).toEqual({ from: null, to: '2026-08-22' });
  });

  it('sliceSeries restreint à la fenêtre', () => {
    const series = eachDay('2026-08-01', '2026-08-31').map((day) => point(day, '1'));
    expect(sliceSeries(series, periodWindow('1w', '2026-08-22')).map((p) => p.day)).toEqual(
      eachDay('2026-08-15', '2026-08-22'),
    );
    expect(sliceSeries(series, { from: null, to: '2026-08-02' })).toHaveLength(2);
  });

  it('periodPerformance neutralise les apports de la période (bornes exclusive/inclusive)', () => {
    const series = [
      point('2026-08-18', '1000'),
      point('2026-08-20', '1450'),
      point('2026-08-22', '1600'),
    ];
    const flows = [
      { day: '2026-08-18', amountEur: D('1000') }, // déjà dans la valeur de départ
      { day: '2026-08-20', amountEur: D('500') },
      { day: '2026-08-22', amountEur: D('-100') },
      { day: '2026-08-23', amountEur: D('999') }, // hors période
    ];
    const perf = periodPerformance(series, flows)!;
    expect(perf.from).toBe('2026-08-18');
    expect(perf.to).toBe('2026-08-22');
    expect(perf.netFlows.toString()).toBe('400');
    expect(perf.gain.toString()).toBe('200');
    expect(perf.pct!.toFixed(4)).toBe('0.1429');
    expect(periodPerformance([], flows)).toBeNull();
    const zeroBase = periodPerformance([point('2026-08-18', '0'), point('2026-08-19', '10')], []);
    expect(zeroBase!.gain.toString()).toBe('10');
    expect(zeroBase!.pct).toBeNull();
  });
});

describe('minMax et downsample', () => {
  it('minMax renvoie les points extrêmes', () => {
    const series = [point('2026-08-18', '5'), point('2026-08-19', '1'), point('2026-08-20', '9')];
    const extremes = minMax(series)!;
    expect(extremes.min.day).toBe('2026-08-19');
    expect(extremes.max.day).toBe('2026-08-20');
    expect(minMax([])).toBeNull();
  });

  it('downsample LTTB garde les extrémités, la taille demandée et les pics', () => {
    const days = eachDay('2026-01-01', '2026-02-19'); // 50 jours
    const series = days.map((day, i) => point(day, i === 25 ? '100' : '1'));
    const sampled = downsample(series, 10);
    expect(sampled).toHaveLength(10);
    expect(sampled[0]!.day).toBe('2026-01-01');
    expect(sampled[9]!.day).toBe('2026-02-19');
    expect(sampled.some((p) => p.value.eq(D('100')))).toBe(true);
    expect(downsample(series, 100)).toHaveLength(50);
    expect(downsample(series, 2).map((p) => p.day)).toEqual(['2026-01-01', '2026-02-19']);
    expect(downsample([], 5)).toEqual([]);
  });
});
