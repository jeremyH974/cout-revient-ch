import { describe, expect, it } from 'vitest';
import { refreshPrices } from './service';
import type { PriceProvider, PriceQuoteInput } from './types';
import { numberToDecimal } from './types';

const quote = (asset: string, priceEur: string, source: string): PriceQuoteInput => ({
  asset,
  priceEur,
  at: '2026-08-22T10:00:00.000Z',
  source,
  stale: false,
});
const provider = (name: string, prices: Record<string, string>, fail = false): PriceProvider => ({
  name,
  async fetchPrices(codes) {
    if (fail) throw new Error('HTTP 429');
    return new Map(codes.filter((c) => prices[c]).map((c) => [c, quote(c, prices[c]!, name)]));
  },
});
const NOW = Date.parse('2026-08-22T10:05:00.000Z');
const opts = (providers: PriceProvider[]) => ({ providers, maxAgeMs: 600_000, now: () => NOW });

describe('cascade de prix', () => {
  it('manuel > cache frais > fournisseurs > cache périmé > manquant', async () => {
    const cache = {
      btc: quote('btc', '60000', 'CoinGecko'),
      eth: { ...quote('eth', '2000', 'CoinGecko'), at: '2026-08-01T00:00:00.000Z' },
      sky: { ...quote('sky', '0.05', 'CoinGecko'), at: '2026-08-01T00:00:00.000Z' },
    };
    const settings = {
      sol: { manualPriceEur: '123', manualPriceAt: '2026-08-20T00:00:00.000Z', coingeckoId: null },
    };
    const result = await refreshPrices(
      ['btc', 'eth', 'sol', 'sky', 'eurcv', 'zzz'],
      cache,
      settings,
      opts([provider('CoinGecko', {}, true), provider('Coinbase', { eth: '2100' })]),
    );
    expect(result.quotes['sol']?.source).toBe('manuel');
    expect(result.quotes['btc']?.priceEur).toBe('60000');
    expect(result.quotes['eth']?.priceEur).toBe('2100');
    expect(result.quotes['sky']?.stale).toBe(true);
    expect(result.quotes['eurcv']?.priceEur).toBe('1');
    expect(result.missing).toEqual(['zzz']);
    expect(result.errors[0]).toMatch(/CoinGecko : HTTP 429/);
    expect(result.online).toBe(true);
  });

  it('hors ligne : tout vient du cache, marqué périmé', async () => {
    const cache = {
      btc: { ...quote('btc', '60000', 'CoinGecko'), at: '2026-08-01T00:00:00.000Z' },
    };
    const result = await refreshPrices(['btc'], cache, {}, opts([provider('CoinGecko', {}, true)]));
    expect(result.online).toBe(false);
    expect(result.quotes['btc']?.stale).toBe(true);
  });
});

describe('numberToDecimal', () => {
  it('convertit sans exposant', () => {
    expect(numberToDecimal(65936)).toBe('65936');
    expect(numberToDecimal(0.705375)).toBe('0.705375');
    expect(numberToDecimal(2.67585969e-7)).toBe('0.000000267585969');
    expect(numberToDecimal('0.85475')).toBe('0.85475');
    expect(numberToDecimal('abc')).toBeNull();
    expect(numberToDecimal(Number.NaN)).toBeNull();
  });
});
