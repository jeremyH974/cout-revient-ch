import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, ZERO } from '../money';
import { emptyJournalEntry, type JournaledTrip } from './journal';
import type { RoundTrip } from './round-trips';
import { computeStats, statsBuckets, weekdayOf, type ToDisplay } from './stats';

let seq = 0;
const rt = (over: Partial<RoundTrip> = {}): RoundTrip => {
  seq += 1;
  const closedAt = over.closedAt !== undefined ? over.closedAt : '2026-08-01T10:00:00';
  return {
    id: `rt:hl:a:BTC:${seq}`,
    accountId: 'hl:a',
    market: 'perp',
    symbol: 'BTC',
    quote: 'USD',
    direction: 'long',
    status: 'closed',
    openedAt: '2026-08-01T09:00:00',
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

const jt = (
  overTrip: Partial<RoundTrip> = {},
  overJt: Partial<Omit<JournaledTrip, 'trip'>> = {},
): JournaledTrip => ({
  trip: rt(overTrip),
  journal: null,
  r: null,
  entrySlippage: null,
  ...overJt,
});

describe('computeStats', () => {
  it('cas nominal : comptes, taux, profit factor, espérance, séries, drawdown', () => {
    const win1 = jt({ closedTime: 1, netPnl: D('100') }, { r: D('2') });
    const win2 = jt({ closedTime: 2, netPnl: D('50') });
    const loss1 = jt({ closedTime: 3, netPnl: D('-30') }, { r: D('-1') });
    const win3 = jt({ closedTime: 4, netPnl: D('80') }, { r: D('1.5') });
    const loss2 = jt({ closedTime: 5, netPnl: D('-20') });
    const loss3 = jt({ closedTime: 6, netPnl: D('-40') });
    const breakeven1 = jt({ closedTime: 7, netPnl: ZERO });
    const win4 = jt({ closedTime: 8, netPnl: D('10') });
    const open1 = jt({ status: 'open', closedAt: null, closedTime: null });
    const open2 = jt({ status: 'open', closedAt: null, closedTime: null });

    // Ordre d'entrée volontairement mélangé : computeStats doit trier lui-même par closedTime.
    const s = computeStats([open1, win3, win1, open2, breakeven1, win2, win4, loss1, loss3, loss2]);

    expect(s.total).toBe(10);
    expect(s.closed).toBe(8);
    expect(s.open).toBe(2);
    expect(s.excluded).toBe(0);
    expect(s.wins).toBe(4);
    expect(s.losses).toBe(3);
    expect(s.breakeven).toBe(1);
    expect(s.winRate?.toString()).toBe(D('4').div('7').toString());
    expect(s.profitFactor?.toString()).toBe(D('240').div('90').toString());
    expect(s.expectancy?.toString()).toBe(D('150').div('8').toString());
    expect(s.nR).toBe(3);
    expect(s.expectancyR?.toString()).toBe(D('2.5').div('3').toString());
    expect(s.avgWin?.toString()).toBe('60');
    expect(s.avgLoss?.toString()).toBe('-30');
    expect(s.payoff?.toString()).toBe('2');
    expect(s.best?.toString()).toBe('100');
    expect(s.worst?.toString()).toBe('-40');
    expect(s.netTotal.toString()).toBe('150');
    // Séries en ordre chronologique (closedTime croissant) : gagne,gagne,perd,gagne,perd,perd,BE,gagne.
    expect(s.longestWinStreak).toBe(2);
    expect(s.longestLossStreak).toBe(2);
    // Creux calculé à la main sur le cumul chronologique 100,150,120,200,180,140,140,150 (pic 200) : 60.
    expect(s.maxDrawdown?.toString()).toBe('60');
    expect(s.smallSample).toBe(true);
  });

  it('toDisplay renvoyant null pour une devise inconnue : exclut le trade des sommes, pas des compteurs', () => {
    const known1 = jt({ quote: 'USD', closedTime: 1, netPnl: D('40') });
    const unknown = jt({ quote: 'XYZ', closedTime: 2, netPnl: D('-15') });
    const known2 = jt({ quote: 'USD', closedTime: 3, netPnl: D('-10') });
    const toDisplay: ToDisplay = (t, value) => (t.trip.quote === 'XYZ' ? null : value);

    const s = computeStats([known1, unknown, known2], toDisplay);

    expect(s.closed).toBe(3);
    expect(s.excluded).toBe(1);
    // Gains/pertes et séries comptent le trade exclu, sur le signe natif.
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(2);
    expect(s.longestLossStreak).toBe(2);
    // Les sommes en devise d'affichage ignorent le trade non convertible (−15 absent).
    expect(s.netTotal.toString()).toBe('30');
    expect(s.best?.toString()).toBe('40');
    expect(s.worst?.toString()).toBe('-10');
  });
});

describe('statsBuckets', () => {
  it('ventile par direction : deux seaux, triés par P&L net décroissant', () => {
    const buckets = statsBuckets(
      [
        jt({ direction: 'long', closedTime: 1, netPnl: D('50') }),
        jt({ direction: 'long', closedTime: 2, netPnl: D('30') }),
        jt({ direction: 'short', closedTime: 3, netPnl: D('10') }),
      ],
      'direction',
    );
    expect(buckets).toHaveLength(2);
    expect(buckets.map((b) => b.key)).toEqual(['Long', 'Short']);
    expect(buckets[0]!.stats.netTotal.toString()).toBe('80');
    expect(buckets[1]!.stats.netTotal.toString()).toBe('10');
  });

  it('ventile par setup : « Sans setup » regroupe les trades sans entrée de journal', () => {
    const withSetup = jt(
      { closedTime: 1, netPnl: D('20') },
      { journal: { ...emptyJournalEntry('t1'), setup: 'Cassure' } },
    );
    const withoutJournal = jt({ closedTime: 2, netPnl: D('5') });
    const buckets = statsBuckets([withSetup, withoutJournal], 'setup');
    expect(buckets.map((b) => b.key).sort()).toEqual(['Cassure', 'Sans setup']);
  });

  it('ventile par durée : bornes des seaux (< 1 h, 1 h–1 j, 1–7 j, > 7 j, en cours)', () => {
    const buckets = statsBuckets(
      [
        jt({ holdSeconds: 1_800, closedTime: 1 }),
        jt({ holdSeconds: 7_200, closedTime: 2 }),
        jt({ holdSeconds: 3 * 86_400, closedTime: 3 }),
        jt({ holdSeconds: 10 * 86_400, closedTime: 4 }),
        jt({ status: 'open', holdSeconds: null, closedAt: null, closedTime: null }),
      ],
      'duration',
    );
    expect(buckets.map((b) => b.key).sort()).toEqual(
      ["moins d'une heure", '1 h à 1 jour', '1 à 7 jours', 'plus de 7 jours', 'en cours'].sort(),
    );
  });

  it('weekdayOf : la semaine complète, aux deux bouts (dimanche = dernier index, piège classique)', () => {
    expect(weekdayOf('2026-08-23T10:00:00')).toBe('dimanche');
    expect(weekdayOf('2026-08-24T10:00:00')).toBe('lundi');
    expect(weekdayOf('2026-08-29T23:59:59')).toBe('samedi');
    // Bissextile et changement de siècle : l'arithmétique civile ne doit pas déraper.
    expect(weekdayOf('2028-02-29')).toBe('mardi');
    expect(weekdayOf('2000-02-29')).toBe('mardi');
    expect(weekdayOf('1970-01-01')).toBe('jeudi');
    expect(weekdayOf('pas une date')).toBe('?');
  });
});

describe('propriété', () => {
  it('netTotal = Σ des P&L nets ; maxDrawdown ≥ 0 ; wins + losses + breakeven = closed', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -10_000, max: 10_000 }), { maxLength: 40 }),
        (values) => {
          const trips = values.map((v, i) => jt({ closedTime: i, netPnl: D(String(v)) }));
          const s = computeStats(trips);

          let total = ZERO;
          for (const t of trips) total = total.plus(t.trip.netPnl);
          expect(s.netTotal.eq(total)).toBe(true);
          expect(s.maxDrawdown === null || s.maxDrawdown.gte(ZERO)).toBe(true);
          expect(s.wins + s.losses + s.breakeven).toBe(s.closed);
        },
      ),
    );
  });
});
