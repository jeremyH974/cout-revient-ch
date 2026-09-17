import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { civilFromDays, dayOfEpoch, daysSinceEpoch, epochDayOf } from './date';

describe('civilFromDays — l’inverse exact de daysSinceEpoch', () => {
  it('dates connues : l’époque, la veille, un 29 février, un 31 décembre', () => {
    expect(civilFromDays(0)).toEqual({ year: 1970, month: 1, day: 1 });
    expect(civilFromDays(-1)).toEqual({ year: 1969, month: 12, day: 31 });
    expect(dayOfEpoch(daysSinceEpoch(2028, 2, 29))).toBe('2028-02-29');
    expect(dayOfEpoch(daysSinceEpoch(2026, 12, 31))).toBe('2026-12-31');
    expect(dayOfEpoch(daysSinceEpoch(2000, 3, 1))).toBe('2000-03-01');
  });

  it('aller-retour sur quatre siècles, années bissextiles séculaires comprises', () => {
    fc.assert(
      fc.property(fc.integer({ min: -150_000, max: 150_000 }), (epochDay) => {
        const { year, month, day } = civilFromDays(epochDay);
        expect(daysSinceEpoch(year, month, day)).toBe(epochDay);
        expect(epochDayOf(dayOfEpoch(epochDay))).toBe(epochDay);
      }),
    );
  });
});
