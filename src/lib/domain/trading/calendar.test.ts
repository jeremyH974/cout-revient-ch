import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, ZERO } from '../money';
import type { JournaledTrip } from './journal';
import type { RoundTrip } from './round-trips';
import { calendarMonth, closedMonths, type CalendarDay } from './calendar';
import type { ToDisplay } from './stats';

let seq = 0;
const rt = (over: Partial<RoundTrip> = {}): RoundTrip => {
  seq += 1;
  const closedAt = over.closedAt !== undefined ? over.closedAt : '2026-08-15T10:00:00';
  return {
    id: `rt:hl:a:BTC:${seq}`,
    accountId: 'hl:a',
    market: 'perp',
    symbol: 'BTC',
    quote: 'USDC',
    direction: 'long',
    status: 'closed',
    openedAt: '2026-08-15T09:00:00',
    openedTime: seq,
    closedAt,
    closedTime: closedAt === null ? null : seq,
    executionIds: [],
    qtyOpened: D('1'),
    qtyClosed: D('1'),
    qtyMax: D('1'),
    avgEntry: D('100'),
    avgExit: D('110'),
    grossPnl: D('10'),
    fees: D('0'),
    funding: D('0'),
    netPnl: D('10'),
    holdSeconds: 3_600,
    liquidated: false,
    incomplete: false,
    source: 'hyperliquid-api',
    ...over,
  };
};

const jt = (over: Partial<RoundTrip> = {}): JournaledTrip => ({
  trip: rt(over),
  journal: null,
  r: null,
  entrySlippage: null,
});

const identity: ToDisplay = (_t, v) => v;

const flatDays = (weeks: ReturnType<typeof calendarMonth>['weeks']): (CalendarDay | null)[] =>
  weeks.flatMap((w) => w.days);

describe('calendarMonth — grille du mois', () => {
  it('août 2026 : le 1er est un samedi → 6 semaines, [null×5, 01, 02] puis [31, null×6]', () => {
    const month = calendarMonth([], '2026-08', identity);
    expect(month.weeks).toHaveLength(6);

    const week1 = month.weeks[0]!;
    expect(week1.days.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(week1.days[5]?.day).toBe('2026-08-01');
    expect(week1.days[6]?.day).toBe('2026-08-02');

    const lastWeek = month.weeks[5]!;
    expect(lastWeek.days[0]?.day).toBe('2026-08-31');
    expect(lastWeek.days.slice(1)).toEqual([null, null, null, null, null, null]);

    // 31 jours répartis sur la grille, aucun perdu ni dupliqué.
    const days = flatDays(month.weeks).filter((d): d is CalendarDay => d !== null);
    expect(days).toHaveLength(31);
    expect(days.map((d) => d.day)).toEqual(
      Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`),
    );
  });

  it('février 2028 (bissextile, 29 jours) : le 1er est un mardi → première semaine [null, 01, …]', () => {
    const month = calendarMonth([], '2028-02', identity);
    const week1 = month.weeks[0]!;
    expect(week1.days[0]).toBeNull();
    expect(week1.days[1]?.day).toBe('2028-02-01');
    expect(week1.days[2]?.day).toBe('2028-02-02');

    const days = flatDays(month.weeks).filter((d): d is CalendarDay => d !== null);
    expect(days).toHaveLength(29);
    expect(days.at(-1)?.day).toBe('2028-02-29');
  });
});

describe('calendarMonth — agrégation par jour', () => {
  it('un jour du mois sans trade clos : count 0, pnl ZERO, tripIds vide', () => {
    const month = calendarMonth([], '2026-08', identity);
    const day1 = month.weeks[0]!.days[5]!;
    expect(day1.day).toBe('2026-08-01');
    expect(day1.count).toBe(0);
    expect(day1.pnl.eq(ZERO)).toBe(true);
    expect(day1.tripIds).toEqual([]);
    expect(day1.excluded).toBe(0);
  });

  it('regroupe les trades clos du même jour : somme le net, ordre de clôture croissant', () => {
    const t1 = jt({ id: 't1', closedAt: '2026-08-05T18:00:00', closedTime: 2, netPnl: D('30') });
    const t2 = jt({ id: 't2', closedAt: '2026-08-05T09:00:00', closedTime: 1, netPnl: D('-10') });
    const month = calendarMonth([t1, t2], '2026-08', identity);
    const day = flatDays(month.weeks).find((d) => d?.day === '2026-08-05')!;
    expect(day.count).toBe(2);
    expect(day.pnl.toString()).toBe('20');
    // t2 clos avant t1 (closedTime 1 < 2) malgré l'ordre inverse en entrée.
    expect(day.tripIds).toEqual(['t2', 't1']);
  });

  it('trade à quote non convertible (toDisplay → null) : excluded incrémenté, exclu de pnl', () => {
    const known = jt({
      closedAt: '2026-08-10T10:00:00',
      closedTime: 1,
      quote: 'USD',
      netPnl: D('40'),
    });
    const unknown = jt({
      closedAt: '2026-08-10T11:00:00',
      closedTime: 2,
      quote: 'XYZ',
      netPnl: D('-15'),
    });
    const toDisplay: ToDisplay = (t, v) => (t.trip.quote === 'XYZ' ? null : v);
    const month = calendarMonth([known, unknown], '2026-08', toDisplay);
    const day = flatDays(month.weeks).find((d) => d?.day === '2026-08-10')!;

    expect(day.count).toBe(2);
    expect(day.excluded).toBe(1);
    expect(day.pnl.toString()).toBe('40'); // le trade exclu n'entre pas dans la somme.
    expect(day.tripIds).toEqual([known.trip.id, unknown.trip.id]); // listé quand même.
    expect(month.excluded).toBe(1);
    expect(month.total.toString()).toBe('40');
    expect(month.count).toBe(2);
  });

  it('ignore les trades ouverts et ceux d’un autre mois', () => {
    const open = jt({ status: 'open', closedAt: null, closedTime: null });
    const otherMonth = jt({ closedAt: '2026-09-01T10:00:00', closedTime: 1, netPnl: D('999') });
    const month = calendarMonth([open, otherMonth], '2026-08', identity);
    expect(month.count).toBe(0);
    expect(month.excluded).toBe(0);
    expect(month.total.eq(ZERO)).toBe(true);
  });
});

describe('closedMonths', () => {
  it('mois distincts, triés croissant, ignore les trades ouverts', () => {
    const trips = [
      jt({ closedAt: '2026-08-05T10:00:00' }),
      jt({ closedAt: '2026-06-01T10:00:00' }),
      jt({ closedAt: '2026-08-20T10:00:00' }),
      jt({ status: 'open', closedAt: null, closedTime: null }),
    ];
    expect(closedMonths(trips)).toEqual(['2026-06', '2026-08']);
  });

  it('aucun trade clos : liste vide', () => {
    expect(closedMonths([jt({ status: 'open', closedAt: null, closedTime: null })])).toEqual([]);
  });
});

describe('propriété', () => {
  it('la somme des totaux hebdomadaires = total du mois ; idem pour les comptes', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 31 }),
            netPnl: fc.integer({ min: -5_000, max: 5_000 }),
          }),
          { maxLength: 50 },
        ),
        (entries) => {
          const trips = entries.map((e, i) =>
            jt({
              closedAt: `2026-08-${String(e.day).padStart(2, '0')}T10:00:00`,
              closedTime: i,
              quote: 'USDC',
              netPnl: D(String(e.netPnl)),
            }),
          );
          const month = calendarMonth(trips, '2026-08', identity);

          let weeklyTotal = ZERO;
          let weeklyCount = 0;
          for (const week of month.weeks) {
            weeklyTotal = weeklyTotal.plus(week.total);
            weeklyCount += week.count;
          }

          expect(weeklyTotal.eq(month.total)).toBe(true);
          expect(weeklyCount).toBe(month.count);
          expect(month.count).toBe(trips.length);
        },
      ),
    );
  });
});
