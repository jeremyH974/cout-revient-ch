import { describe, expect, it } from 'vitest';
import type { LedgerEvent, TradeEvent } from '../domain/types';
import { convertEvents, convertQuotes, earliestDay, rateLookup, toEurConverter } from './convert';
import { addDays, refreshRates } from './service';
import { EMPTY_FX_CACHE, type FxProvider, type RateSeries } from './types';

const series: RateSeries = {
  '2026-08-18': '1.1576',
  '2026-08-19': '1.1605',
  '2026-08-21': '1.1699',
};

const trade: TradeEvent = {
  id: 't1',
  at: '2026-08-20T10:00:00',
  source: 'manual',
  scope: 'coinhouse',
  rowKeys: [],
  warnings: [],
  kind: 'trade',
  out: { asset: 'eur', qty: '1000' },
  in: { asset: 'btc', qty: '0.01' },
  valueEur: '1000',
  valueEurSource: 'manual',
  fee: { asset: 'eur', gross: '10', rebate: '0', grossEur: '10', rebateEur: '0' },
  quotePrice: null,
};

describe('taux de change', () => {
  it('reporte au dernier jour ouvré et utilise le premier taux pour les dates antérieures', () => {
    const lookup = rateLookup(series);
    expect(lookup.rate('2026-08-20')).toBe('1.1605');
    expect(lookup.rate('2026-08-23')).toBe('1.1699');
    expect(lookup.rate('2026-08-01')).toBe('1.1576');
    expect(lookup.latestDay).toBe('2026-08-21');
    expect(rateLookup({}).rate('2026-08-20')).toBeNull();
  });

  it('convertit chaque mouvement au taux de son jour', () => {
    const reward: LedgerEvent = {
      id: 'r',
      at: '2026-08-21T08:00:00',
      source: 'manual',
      scope: 'coinhouse',
      rowKeys: [],
      warnings: [],
      kind: 'reward',
      in: { asset: 'eth', qty: '0.1' },
      fairValueEur: '200',
    };
    const result = convertEvents([trade, reward], rateLookup(series));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [t, r] = result.events as [TradeEvent, LedgerEvent & { kind: 'reward' }];
    expect(t.valueEur).toBe('1160.5');
    expect(t.out.qty).toBe('1160.5');
    expect(t.in.qty).toBe('0.01');
    expect(t.fee?.grossEur).toBe('11.605');
    expect(r.fairValueEur).toBe('233.98');
    expect(convertEvents([trade], rateLookup({})).ok).toBe(false);
  });

  it('convertit les cotations et trouve la première date', () => {
    const quotes = convertQuotes(
      {
        btc: {
          asset: 'btc',
          priceEur: '60000',
          at: '2026-08-22T10:00:00Z',
          source: 'x',
          stale: false,
        },
      },
      rateLookup(series),
    );
    expect(quotes['btc']?.priceEur).toBe('70194');
    expect(earliestDay([trade], '2026-08-22')).toBe('2026-08-20');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('rafraîchit la tête puis seulement la queue', async () => {
    const calls: string[] = [];
    const provider: FxProvider = {
      name: 'mock',
      async fetchRange(_c, from, to) {
        calls.push(`${from}..${to}`);
        return { [from]: '1.1', [to]: '1.2' };
      },
    };
    const now = () => Date.parse('2026-08-22T12:00:00Z');
    const first = await refreshRates('USD', EMPTY_FX_CACHE, {
      provider,
      fromDay: '2026-01-01',
      toDay: '2026-08-22',
      now,
    });
    expect(first.fetched).toBe(true);
    expect(calls).toEqual(['2026-01-01..2026-08-22']);
    const stale = {
      ...first.cache,
      updatedAt: { USD: '2026-07-01T00:00:00Z' },
      rates: { USD: { '2026-01-01': '1.1', '2026-07-01': '1.15' } },
    };
    const second = await refreshRates('USD', stale, {
      provider,
      fromDay: '2026-01-01',
      toDay: '2026-08-22',
      now,
    });
    expect(calls[1]).toBe('2026-07-01..2026-08-22');
    expect(Object.keys(second.cache.rates.USD ?? {})).toHaveLength(3);
    const third = await refreshRates('USD', second.cache, {
      provider,
      fromDay: '2026-01-01',
      toDay: '2026-08-22',
      now,
    });
    expect(third.fetched).toBe(false);
    expect(
      (
        await refreshRates('EUR', EMPTY_FX_CACHE, {
          provider,
          fromDay: '2026-01-01',
          toDay: '2026-08-22',
          now,
        })
      ).fetched,
    ).toBe(false);
  });
});

describe('toEurConverter (prix cotés en dollars)', () => {
  it('divise par le taux du jour, avec report au dernier jour ouvré connu', () => {
    const toEur = toEurConverter(series, '2026-08-20'); // jeudi sans taux → 19/08 (1.1605)
    expect(toEur('116.05')).toBe('100');
    expect(toEurConverter(series, '2026-08-23')('1.1699')).toBe('1');
  });

  it('renvoie null sans aucun taux ou avec un taux invalide', () => {
    expect(toEurConverter({}, '2026-08-20')('100')).toBeNull();
    expect(toEurConverter({ '2026-08-20': '0' }, '2026-08-20')('100')).toBeNull();
  });

  it('conserve une précision décimale suffisante pour les petits prix', () => {
    const toEur = toEurConverter({ '2026-08-20': '1.25' }, '2026-08-20');
    expect(toEur('0.0000125')).toBe('0.00001');
    expect(toEur('80')).toBe('64');
  });
});
