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
  calendarMonth,
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

  it('ignore le spot (les aller-retours sont des perps) et les montants nuls sans clôture', () => {
    const spot = fill(3, 'buy', '1', '10', { market: 'spot', symbol: 'PURR', fee: '0.05' });
    const free = fill(4, 'buy', '1', '100'); // fill perp sans frais ni P&L : rien à dater
    const events = realizedEvents(
      journaledTrips(buildRoundTrips([free]), [], {}),
      [spot, free],
      [],
    );
    expect(events).toEqual([]);
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
    expect(events).toHaveLength(1);
    expect(events[0]!.day).toBe('2026-08-09');
    expect(events[0]!.amount.toString()).toBe('19');
    expect(events[0]!.closes).toBe(true);
  });
});

const ev = (day: string, amount: string, over: Partial<RealizedEvent> = {}): RealizedEvent => ({
  day,
  time: Number(day.slice(8, 10)),
  quote: 'USDC',
  amount: D(amount),
  tripId: `rt:${day}:${amount}`,
  closes: false,
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
