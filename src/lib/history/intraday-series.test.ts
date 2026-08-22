import { describe, expect, it } from 'vitest';
import { D } from '../domain/money';
import { intradayValueSeries } from './intraday-series';

describe('intradayValueSeries', () => {
  it('somme les avoirs sur une grille commune avec le dernier prix connu', () => {
    const base = Date.parse('2026-08-22T00:00:00Z');
    const series = intradayValueSeries({
      points: {
        btc: [
          { at: '2026-08-22T00:00:00.000Z', priceEur: '100' },
          { at: '2026-08-22T00:20:00.000Z', priceEur: '110' },
        ],
        eth: [{ at: '2026-08-22T00:10:00.000Z', priceEur: '10' }],
      },
      qty: { btc: D('1'), eth: D('2') },
      cost: { btc: D('90'), eth: D('15') },
      rate: '2',
      fromMs: base,
      toMs: base + 30 * 60_000,
      stepMs: 15 * 60_000,
    });
    expect(series.map((p) => p.value.toString())).toEqual(['200', '240', '260']);
    expect(series[0]?.cost.toString()).toBe('105');
  });
});
