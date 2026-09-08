/**
 * Calendrier de P&L. Le test qui compte est celui de l'attribution : un montant réalisé apparaît
 * le jour où la plateforme l'a réalisé, pas le jour où l'aller-retour finit par se fermer.
 * La première version rattachait tout à la clôture — une position allégée sur plusieurs jours
 * affichait zéro les jours de prise de bénéfice, et le mois ne collait ni à l'exchange ni au
 * tableau de bord de l'app (décision n° 35).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, ZERO } from '../money';
import { journaledTrips, type JournaledTrip } from './journal';
import { buildRoundTrips } from './round-trips';
import {
  activeMonths,
  activeYears,
  calendarMonth,
  calendarMonths,
  calendarYears,
  realizedEvents,
  type CalendarDay,
  type QuoteToDisplay,
  type RealizedEvent,
} from './calendar';
import type { Execution, FundingPayment } from './types';

const identity: QuoteToDisplay = (_quote, v) => v;
const ACCOUNT = 'hl:0xdemo';

const fill = (
  day: number,
  side: 'buy' | 'sell',
  qty: string,
  price: string,
  over: Partial<Execution> = {},
): Execution => ({
  id: `hl:${day}${side}${qty}`,
  accountId: ACCOUNT,
  at: `2026-08-${String(day).padStart(2, '0')}T10:00:00`,
  time: day * 86_400_000,
  market: 'perp',
  symbol: 'BTC',
  quote: 'USDC',
  side,
  qty,
  price,
  notional: D(price).times(qty).toString(),
  fee: '0',
  feeNative: null,
  closedPnl: '0',
  startPosition: '0',
  direction: side === 'buy' ? 'Open Long' : 'Close Long',
  liquidation: false,
  crossed: true,
  source: 'hyperliquid-api',
  ...over,
});

const fundingOn = (day: number, amount: string): FundingPayment => ({
  id: `f:${day}`,
  accountId: ACCOUNT,
  at: `2026-08-${String(day).padStart(2, '0')}T08:00:00`,
  time: day * 86_400_000 + 3_600_000,
  symbol: 'BTC',
  amount,
  rate: '0.0001',
  positionSize: '2',
});

/** Long de 2 BTC ouvert le 3, allégé le 5, soldé le 7 ; funding les 4 et 6. */
const scaleOut = (): { trips: JournaledTrip[]; events: RealizedEvent[] } => {
  const executions = [
    fill(3, 'buy', '2', '100', { fee: '0.2' }),
    fill(5, 'sell', '1', '120', { fee: '0.12', closedPnl: '20', startPosition: '2' }),
    fill(7, 'sell', '1', '130', { fee: '0.13', closedPnl: '30', startPosition: '1' }),
  ];
  const funding = [fundingOn(4, '-0.5'), fundingOn(6, '-0.4')];
  const trips = journaledTrips(buildRoundTrips(executions, funding), [], {});
  return { trips, events: realizedEvents(trips, executions, funding) };
};

const flatDays = (weeks: ReturnType<typeof calendarMonth>['weeks']): (CalendarDay | null)[] =>
  weeks.flatMap((w) => w.days);
const amountOn = (month: ReturnType<typeof calendarMonth>, day: string): string =>
  flatDays(month.weeks)
    .find((d) => d?.day === day)!
    .pnl.toString();

describe('realizedEvents — attribution au jour de réalisation', () => {
  it('répartit le résultat sur les jours où il a été réalisé, pas sur le jour de clôture', () => {
    const { trips, events } = scaleOut();
    const trip = trips[0]!.trip;
    expect(trip.status).toBe('closed');
    expect(trip.closedAt?.slice(0, 10)).toBe('2026-08-07');
    expect(trip.netPnl.toString()).toBe('48.65'); // 50 − 0,45 de frais − 0,9 de funding

    const month = calendarMonth(events, '2026-08', identity);
    expect(amountOn(month, '2026-08-03')).toBe('-0.2'); // frais d'ouverture, aucun trade clos
    expect(amountOn(month, '2026-08-04')).toBe('-0.5'); // funding
    expect(amountOn(month, '2026-08-05')).toBe('19.88'); // prise de bénéfice partielle : 20 − 0,12
    expect(amountOn(month, '2026-08-06')).toBe('-0.4');
    expect(amountOn(month, '2026-08-07')).toBe('29.87'); // solde : 30 − 0,13
    // Le mois entier vaut exactement le net de l'aller-retour : rien n'est perdu ni compté deux fois.
    expect(month.total.eq(trip.netPnl)).toBe(true);
    expect(month.closed).toBe(1); // un seul trade clos, le 7
  });

  it('les frais et le funding d’une position ENCORE OUVERTE apparaissent quand même', () => {
    const executions = [fill(3, 'buy', '2', '100', { fee: '0.2' })];
    const funding = [fundingOn(4, '-0.5')];
    const trips = journaledTrips(buildRoundTrips(executions, funding), [], {});
    expect(trips[0]!.trip.status).toBe('open');
    const month = calendarMonth(realizedEvents(trips, executions, funding), '2026-08', identity);
    expect(amountOn(month, '2026-08-03')).toBe('-0.2');
    expect(amountOn(month, '2026-08-04')).toBe('-0.5');
    expect(month.total.toString()).toBe('-0.7');
    expect(month.closed).toBe(0);
  });

  it('somme des événements = Σ (closedPnl − frais) + Σ funding (contrat avec `computeTotals`)', () => {
    const { trips, events } = scaleOut();
    const total = events.reduce((acc, e) => acc.plus(e.amount), ZERO);
    expect(total.toString()).toBe('48.65');
    expect(trips[0]!.trip.netPnl.eq(total)).toBe(true);
  });

  it('ignore le spot, et les montants nuls qui n’ouvrent ni ne clôturent rien', () => {
    const spot = fill(3, 'buy', '1', '10', { market: 'spot', symbol: 'PURR', fee: '0.05' });
    // Deux fills perp sans frais ni P&L : le premier OUVRE l'aller-retour et mérite d'être daté
    // (décision n° 131), le second ne fait que renforcer la position et n'a rien à dire.
    const opening = fill(4, 'buy', '1', '100');
    const adding = fill(5, 'buy', '1', '100', { startPosition: '1' });
    const events = realizedEvents(
      journaledTrips(buildRoundTrips([opening, adding]), [], {}),
      [spot, opening, adding],
      [],
    );
    expect(events).toHaveLength(1);
    expect(events[0]!).toMatchObject({ day: '2026-08-04', opens: true, closes: false });
    expect(events[0]!.amount.toString()).toBe('0');
  });

  it('un trade manuel n’a pas d’exécution : son net est daté de la clôture saisie', () => {
    const trips = journaledTrips(
      [],
      [
        {
          id: 'm1',
          accountId: 'man:trading',
          symbol: 'ETH',
          direction: 'long',
          qty: '2',
          entryPrice: '100',
          exitPrice: '110',
          openedAt: '2026-08-03T10:00:00',
          closedAt: '2026-08-09T15:00:00',
          fees: '1',
          quote: 'EUR',
        },
      ],
      {},
    );
    const events = realizedEvents(trips, [], []);
    // Deux marqueurs : l'ouverture saisie, à zéro, et le net au jour de clôture. Sans le premier,
    // un trade saisi à la main ne serait jamais compté parmi les trades ouverts du jour.
    expect(events).toHaveLength(2);
    expect(events[0]!).toMatchObject({ day: '2026-08-03', opens: true, closes: false });
    expect(events[0]!.amount.toString()).toBe('0');
    expect(events[1]!).toMatchObject({ day: '2026-08-09', opens: false, closes: true });
    expect(events[1]!.amount.toString()).toBe('19');
  });

  it('un trade manuel encore ouvert est compté le jour où il a été ouvert', () => {
    const trips = journaledTrips(
      [],
      [
        {
          id: 'm2',
          accountId: 'man:trading',
          symbol: 'ETH',
          direction: 'long',
          qty: '2',
          entryPrice: '100',
          exitPrice: null,
          openedAt: '2026-08-03T10:00:00',
          closedAt: null,
          fees: '1',
          quote: 'EUR',
        },
      ],
      {},
    );
    const month = calendarMonth(realizedEvents(trips, [], []), '2026-08', identity);
    const days = flatDays(month.weeks);
    expect(days.find((d) => d?.day === '2026-08-03')).toMatchObject({ opened: 1, closed: 0 });
    expect(month.opened).toBe(1);
    expect(month.closed).toBe(0);
  });
});

const ev = (day: string, amount: string, over: Partial<RealizedEvent> = {}): RealizedEvent => ({
  day,
  time: Number(day.slice(8, 10)),
  quote: 'USDC',
  amount: D(amount),
  tripId: `rt:${day}:${amount}`,
  closes: false,
  opens: false,
  ...over,
});

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
  it('un jour sans rien de réalisé : count 0, pnl ZERO, tripIds vide', () => {
    const day1 = calendarMonth([], '2026-08', identity).weeks[0]!.days[5]!;
    expect(day1.day).toBe('2026-08-01');
    expect(day1.count).toBe(0);
    expect(day1.closed).toBe(0);
    expect(day1.pnl.eq(ZERO)).toBe(true);
    expect(day1.tripIds).toEqual([]);
    expect(day1.excluded).toBe(0);
  });

  it('somme les montants du même jour, liste chaque trade une seule fois, dans l’ordre', () => {
    const events = [
      ev('2026-08-05', '-10', { tripId: 'b', time: 2 }),
      ev('2026-08-05', '30', { tripId: 'a', time: 1 }),
      ev('2026-08-05', '5', { tripId: 'a', time: 3, closes: true }),
    ];
    const day = flatDays(calendarMonth(events, '2026-08', identity).weeks).find(
      (d) => d?.day === '2026-08-05',
    )!;
    expect(day.pnl.toString()).toBe('25');
    expect(day.count).toBe(2); // deux aller-retours, trois événements
    expect(day.closed).toBe(1);
    expect(day.tripIds).toEqual(['b', 'a']); // ordre d'apparition dans la liste fournie
  });

  it('devise non convertible : signalée, listée, jamais sommée dans la mauvaise devise', () => {
    const events = [
      ev('2026-08-10', '40', { quote: 'USD', tripId: 'ok' }),
      ev('2026-08-10', '-15', { quote: 'XYZ', tripId: 'nope' }),
    ];
    const toDisplay: QuoteToDisplay = (quote, v) => (quote === 'XYZ' ? null : v);
    const month = calendarMonth(events, '2026-08', toDisplay);
    const day = flatDays(month.weeks).find((d) => d?.day === '2026-08-10')!;
    expect(day.count).toBe(2);
    expect(day.excluded).toBe(1);
    expect(day.pnl.toString()).toBe('40');
    expect(day.tripIds).toEqual(['ok', 'nope']);
    expect(month.excluded).toBe(1);
    expect(month.total.toString()).toBe('40');
  });

  it('ignore ce qui relève d’un autre mois', () => {
    const month = calendarMonth([ev('2026-09-01', '999')], '2026-08', identity);
    expect(month.closed).toBe(0);
    expect(month.total.eq(ZERO)).toBe(true);
  });
});

describe('activeMonths', () => {
  it('mois distincts, triés croissant', () => {
    const events = [ev('2026-08-05', '1'), ev('2026-06-01', '2'), ev('2026-08-20', '3')];
    expect(activeMonths(events)).toEqual(['2026-06', '2026-08']);
  });

  it('aucun montant réalisé : liste vide', () => {
    expect(activeMonths([])).toEqual([]);
  });
});

describe('propriété', () => {
  it('la somme des totaux hebdomadaires = total du mois, quels que soient les jours', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 31 }),
            amount: fc.integer({ min: -5_000, max: 5_000 }),
          }),
          { maxLength: 50 },
        ),
        (entries) => {
          const events = entries.map((e, i) =>
            ev(`2026-08-${String(e.day).padStart(2, '0')}`, String(e.amount), {
              tripId: `t${i}`,
              time: i,
            }),
          );
          const month = calendarMonth(events, '2026-08', identity);
          let weeklyTotal = ZERO;
          let weeklyCount = 0;
          for (const week of month.weeks) {
            weeklyTotal = weeklyTotal.plus(week.total);
            weeklyCount += week.count;
          }
          expect(weeklyTotal.eq(month.total)).toBe(true);
          expect(weeklyCount).toBe(events.length); // un aller-retour distinct par événement
          const direct = events.reduce((acc, e) => acc.plus(e.amount), ZERO);
          expect(month.total.eq(direct)).toBe(true);
        },
      ),
    );
  });
});

const pad = (n: number): string => String(n).padStart(2, '0');

describe('calendarMonths — les 12 mois d’une année', () => {
  it('une case par mois, même sans trade, dans l’ordre du calendrier', () => {
    const grid = calendarMonths([ev('2026-03-04', '10'), ev('2026-11-20', '-4')], '2026', identity);
    expect(grid.buckets).toHaveLength(12);
    expect(grid.buckets.map((b) => b.key)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(grid.buckets[2]!.pnl.eq(D('10'))).toBe(true);
    expect(grid.buckets[2]!.count).toBe(1);
    expect(grid.buckets[10]!.pnl.eq(D('-4'))).toBe(true);
    expect(grid.buckets[0]!.count).toBe(0);
    expect(grid.buckets[0]!.pnl.eq(ZERO)).toBe(true);
    expect(grid.total.eq(D('6'))).toBe(true);
  });

  it('les montants des autres années sont écartés', () => {
    const events = [ev('2025-03-04', '100'), ev('2026-03-04', '10')];
    expect(calendarMonths(events, '2026', identity).total.eq(D('10'))).toBe(true);
    expect(calendarMonths(events, '2025', identity).total.eq(D('100'))).toBe(true);
  });

  it('un aller-retour qui réalise deux fois dans le mois n’y est compté qu’une fois', () => {
    const events = [
      ev('2026-03-04', '10', { tripId: 't1' }),
      ev('2026-03-20', '5', { tripId: 't1' }),
    ];
    const grid = calendarMonths(events, '2026', identity);
    expect(grid.buckets[2]!.count).toBe(1);
    expect(grid.buckets[2]!.pnl.eq(D('15'))).toBe(true);
  });

  it('clôtures sans doublon, et devise non convertible signalée plutôt que sommée', () => {
    const usdcOnly: QuoteToDisplay = (quote, v) => (quote === 'USDC' ? v : null);
    const events = [
      ev('2026-03-04', '10', { tripId: 't1', closes: true }),
      ev('2026-03-28', '2', { tripId: 't1', closes: false }),
      ev('2026-04-04', '7', { tripId: 't2', quote: 'BTC' }),
    ];
    const grid = calendarMonths(events, '2026', usdcOnly);
    expect(grid.closed).toBe(1);
    expect(grid.excluded).toBe(1);
    expect(grid.total.eq(D('12'))).toBe(true);
    expect(grid.buckets[3]!.excluded).toBe(1);
    expect(grid.buckets[3]!.pnl.eq(ZERO)).toBe(true);
  });
});

describe('calendarYears — une case par année', () => {
  it('de la première à la dernière année active, les années creuses comprises', () => {
    const grid = calendarYears([ev('2024-05-02', '3'), ev('2026-01-02', '4')], identity);
    expect(grid.buckets.map((b) => b.key)).toEqual(['2024', '2025', '2026']);
    expect(grid.buckets[1]!.count).toBe(0);
    expect(grid.buckets[1]!.pnl.eq(ZERO)).toBe(true);
    expect(grid.total.eq(D('7'))).toBe(true);
  });

  it('aucun montant réalisé : grille vide, total nul', () => {
    const grid = calendarYears([], identity);
    expect(grid.buckets).toEqual([]);
    expect(grid.total.eq(ZERO)).toBe(true);
  });
});

describe('activeYears', () => {
  it('années distinctes, triées croissant', () => {
    const events = [ev('2026-08-05', '1'), ev('2024-06-01', '2'), ev('2026-01-20', '3')];
    expect(activeYears(events)).toEqual(['2024', '2026']);
  });

  it('aucun montant réalisé : liste vide', () => {
    expect(activeYears([])).toEqual([]);
  });
});

describe('propriété — les trois mailles ne peuvent pas diverger', () => {
  it('Σ jours d’un mois = case du mois, et Σ des 12 mois = case de l’année', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            month: fc.integer({ min: 1, max: 12 }),
            day: fc.integer({ min: 1, max: 28 }),
            amount: fc.integer({ min: -5_000, max: 5_000 }),
          }),
          { maxLength: 60 },
        ),
        (entries) => {
          const events = entries.map((e, i) =>
            ev(`2026-${pad(e.month)}-${pad(e.day)}`, String(e.amount), {
              tripId: `t${i}`,
              time: i,
            }),
          );
          const monthGrid = calendarMonths(events, '2026', identity);
          for (const bucket of monthGrid.buckets) {
            const dayGrid = calendarMonth(events, bucket.key, identity);
            expect(bucket.pnl.eq(dayGrid.total)).toBe(true);
            expect(bucket.count).toBeLessThanOrEqual(
              dayGrid.weeks.reduce((n, w) => n + w.count, 0),
            );
          }
          const yearCell = calendarYears(events, identity).buckets.find((b) => b.key === '2026');
          if (events.length === 0) expect(yearCell).toBeUndefined();
          else expect(yearCell!.pnl.eq(monthGrid.total)).toBe(true);
        },
      ),
    );
  });
});

/*
 * Le nombre affiché sous le montant disait « trades » en comptant les aller-retours ayant réalisé
 * QUELQUE CHOSE — funding compris. Sur un compte réel, sept positions ouvertes tout l'été
 * affichaient sept « trades » chaque jour sans qu'aucun ne soit ouvert ni fermé. Ces tests tiennent
 * la distinction (décision n° 131).
 */
describe('ouverts et clos, distincts des jours de simple funding', () => {
  it('date l’ouverture au premier fill et la clôture au dernier, funding exclu', () => {
    const { events } = scaleOut();
    const month = calendarMonth(events, '2026-08', identity);
    const days = flatDays(month.weeks);
    const on = (day: string): CalendarDay | null | undefined => days.find((d) => d?.day === day);

    expect(on('2026-08-03')).toMatchObject({ opened: 1, closed: 0 });
    // Le 4 n'a qu'un paiement de funding : la case porte un montant, mais AUCUNE activité.
    expect(on('2026-08-04')).toMatchObject({ count: 1, opened: 0, closed: 0 });
    // Le 5 allège la position sans la solder : ni ouverture, ni clôture.
    expect(on('2026-08-05')).toMatchObject({ count: 1, opened: 0, closed: 0 });
    expect(on('2026-08-07')).toMatchObject({ opened: 0, closed: 1 });
    expect(month.opened).toBe(1);
    expect(month.closed).toBe(1);
  });

  it('un aller-retour dont l’ouverture n’a pas été vue n’est compté nulle part', () => {
    // `startPosition` annonce 3 BTC déjà en position : l'historique ne couvre pas l'ouverture, et
    // la dater au premier fill connu inventerait une activité ce jour-là.
    const executions = [
      fill(3, 'sell', '3', '120', { closedPnl: '60', startPosition: '3', fee: '0.3' }),
    ];
    const trips = journaledTrips(buildRoundTrips(executions), [], {});
    expect(trips[0]!.trip.incomplete).toBe(true);
    const month = calendarMonth(realizedEvents(trips, executions, []), '2026-08', identity);
    const day = flatDays(month.weeks).find((d) => d?.day === '2026-08-03');
    expect(day).toMatchObject({ opened: 0, closed: 1 });
    expect(month.opened).toBe(0);
  });

  it('les mailles mois et année comptent les mêmes ouvertures que les jours', () => {
    const { events } = scaleOut();
    const months = calendarMonths(events, '2026', identity);
    const years = calendarYears(events, identity);
    expect(months.buckets.find((b) => b.key === '2026-08')).toMatchObject({
      opened: 1,
      closed: 1,
    });
    expect(months.opened).toBe(1);
    expect(years.buckets.find((b) => b.key === '2026')).toMatchObject({ opened: 1, closed: 1 });
    expect(years.opened).toBe(1);
  });
});
