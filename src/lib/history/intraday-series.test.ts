import { describe, expect, it } from 'vitest';
import { D } from '../domain/money';
import { formatInstant, intradayValueSeries, localDayOf, spansMidnight } from './intraday-series';

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

describe('libellés d’instants en heure locale', () => {
  const tz = 'Europe/Paris';
  const plain = (text: string): string => text.replace(/\s/g, ' ');

  it('formatInstant : heure locale, jour préfixé sur demande', () => {
    expect(formatInstant('2026-08-22T12:30:00.000Z', { timeZone: tz })).toBe('14:30');
    expect(plain(formatInstant('2026-08-22T22:15:00.000Z', { withDate: true, timeZone: tz }))).toBe(
      '23/08 00:15',
    );
    expect(formatInstant('2026-01-15T12:30:00.000Z', { timeZone: tz })).toBe('13:30'); // heure d'hiver
  });

  it('localDayOf et spansMidnight suivent le jour local, pas le jour UTC', () => {
    expect(localDayOf('2026-08-22T22:15:00.000Z', tz)).toBe('2026-08-23');
    expect(localDayOf('2026-08-22T22:15:00.000Z', 'UTC')).toBe('2026-08-22');
    expect(spansMidnight('2026-08-22T12:30:00.000Z', '2026-08-22T21:00:00.000Z', tz)).toBe(false);
    expect(spansMidnight('2026-08-22T12:30:00.000Z', '2026-08-22T22:15:00.000Z', tz)).toBe(true);
  });
});
