import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  closeDayOf,
  dayOfNaive,
  dayToMs,
  daysBetween,
  eachDay,
  isDayString,
  msToDay,
  todayOf,
} from './days';

describe('jours calendaires UTC', () => {
  it('convertit sans fuseau local', () => {
    expect(dayToMs('2026-08-22')).toBe(Date.UTC(2026, 7, 22));
    expect(msToDay(Date.UTC(2026, 7, 22, 23, 59, 59))).toBe('2026-08-22');
    expect(todayOf(Date.UTC(2026, 0, 1))).toBe('2026-01-01');
    expect(() => dayToMs('22/08/2026')).toThrow(/invalide/);
  });

  it('addDays franchit mois, années et 29 février', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2025-08-22', '2026-08-22')).toBe(365);
    expect(daysBetween('2026-08-22', '2026-08-21')).toBe(-1);
  });

  it('addMonths borne le quantième', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(addMonths('2026-01-15', -3)).toBe('2025-10-15');
    expect(addMonths('2026-08-22', -12)).toBe('2025-08-22');
    expect(addMonths('2025-12-31', 2)).toBe('2026-02-28');
  });

  it('closeDayOf rattache un point à minuit UTC à la veille', () => {
    expect(closeDayOf(Date.UTC(2026, 7, 22))).toBe('2026-08-21');
    expect(closeDayOf(Date.UTC(2026, 7, 22, 0, 0, 1))).toBe('2026-08-22');
    expect(closeDayOf(Date.UTC(2026, 7, 22, 16, 19))).toBe('2026-08-22');
  });

  it('eachDay, dayOfNaive et isDayString', () => {
    expect(eachDay('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
    expect(eachDay('2026-09-02', '2026-09-01')).toEqual([]);
    expect(dayOfNaive('2026-08-22T23:59:59')).toBe('2026-08-22');
    expect(isDayString('2026-02-28')).toBe(true);
    expect(isDayString('2026-02-30')).toBe(false);
    expect(isDayString('22/08/2026')).toBe(false);
  });
});
