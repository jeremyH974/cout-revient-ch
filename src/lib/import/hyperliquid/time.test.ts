import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { msToParisDay, msToParisNaive } from './time';

describe('msToParisNaive', () => {
  it('convertit en heure de Paris (hiver UTC+1, été UTC+2)', () => {
    expect(msToParisNaive(Date.UTC(2026, 0, 15, 23, 30, 5))).toBe('2026-01-16T00:30:05');
    expect(msToParisNaive(Date.UTC(2026, 6, 1, 12, 0, 0))).toBe('2026-07-01T14:00:00');
    expect(msToParisDay(Date.UTC(2026, 6, 1, 22, 30, 0))).toBe('2026-07-02');
  });

  it('écrit minuit « 00 », jamais « 24 »', () => {
    expect(msToParisNaive(Date.UTC(2026, 2, 10, 23, 0, 0))).toBe('2026-03-11T00:00:00');
  });

  it('est monotone croissante', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        fc.integer({ min: 0, max: 86_400_000 }),
        (ms, delta) => msToParisNaive(ms + delta) >= msToParisNaive(ms),
      ),
    );
  });
});
