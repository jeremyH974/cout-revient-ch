import { describe, expect, it } from 'vitest';
import { answerInfo, demoFixtureClient, type HlFixture } from './fixture-client';
import {
  pathCandles,
  pathPrice,
  priceKnots,
  priceText,
  type PricedFixture,
} from './fixture-prices';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 7, 1, 9);
const END = T0 + 48 * HOUR;

const FIXTURE: PricedFixture = {
  userFillsByTime: [
    { coin: 'BTC', px: '62000.0', time: T0 },
    { coin: 'BTC', px: '62500.0', time: T0 + 10 * HOUR },
    // Deux tranches à la même milliseconde : la dernière donne le cours.
    { coin: 'BTC', px: '62400.0', time: T0 + 20 * HOUR },
    { coin: 'BTC', px: '62450.0', time: T0 + 20 * HOUR },
    { coin: '@107', px: '30.0', time: T0 + HOUR },
  ],
  userNonFundingLedgerUpdates: [
    {
      time: T0 + 5 * HOUR,
      delta: { type: 'spotTransfer', token: 'HYPE', amount: '10', usdcValue: '320' },
    },
    { time: T0 + 6 * HOUR, delta: { type: 'deposit', usdc: '100' } },
  ],
  clearinghouseState: { time: END },
  spotMeta: {
    tokens: [
      { name: 'USDC', index: 0 },
      { name: 'HYPE', index: 150 },
    ],
    universe: [{ tokens: [150, 0], name: '@107', index: 107 }],
  },
  allMids: { BTC: '63000', '@107': '33', ETH: '2000' },
};

describe('demoFixtureClient — le client hors ligne de la démonstration', () => {
  it('chargé une fois, il sert les bougies du jeu commis', async () => {
    const first = demoFixtureClient();
    expect(demoFixtureClient()).toBe(first);
    const client = await first;
    const candles = (await client.info({
      type: 'candleSnapshot',
      req: { coin: 'BTC', interval: '1h', startTime: T0, endTime: T0 + 3 * HOUR },
    })) as { t: number }[];
    expect(candles.map((c) => c.t)).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR, T0 + 3 * HOUR]);
  });
});

describe('priceText — un cours fictif en chaîne décimale', () => {
  it('six chiffres significatifs, arrondi au plus proche ou vers l’extérieur', () => {
    expect(priceText(64123.456)).toBe('64123.5');
    expect(priceText(0.1765432)).toBe('0.176543');
    expect(priceText(2300)).toBe('2300');
    expect(priceText(64123.41, 'up')).toBe('64123.5');
    expect(priceText(64123.49, 'down')).toBe('64123.4');
    expect(priceText(0)).toBe('0');
  });
});

describe('priceKnots — un tracé par marché, qui passe par chaque cours observé', () => {
  const knots = priceKnots(FIXTURE);

  it('fills, transferts de jeton et cours de l’instantané sont des nœuds exacts', () => {
    expect(Object.keys(knots).sort()).toEqual(['@107', 'BTC']);
    const btc = knots['BTC']!;
    expect(pathPrice(btc, T0)).toBe(62000);
    expect(pathPrice(btc, T0 + 10 * HOUR)).toBe(62500);
    expect(pathPrice(btc, T0 + 20 * HOUR)).toBe(62450);
    expect(pathPrice(btc, END)).toBe(63000);
    expect(pathPrice(knots['@107']!, T0 + 5 * HOUR)).toBe(32);
    // Avant le premier nœud et après le dernier : le cours reste posé.
    expect(pathPrice(btc, END + HOUR)).toBe(63000);
    // ETH n'a pas de fill : l'instantané seul ne crée pas de marché.
    expect(knots['ETH']).toBeUndefined();
  });

  it('l’agitation reste sous 0,4 % de la droite des vrais nœuds, et loin d’eux', () => {
    const btc = knots['BTC']!;
    const real = new Set([T0, T0 + 10 * HOUR, T0 + 20 * HOUR, END]);
    const line = btc.filter(([t]) => real.has(t));
    const wiggles = btc.filter(([t]) => !real.has(t));
    expect(wiggles.length).toBeGreaterThan(5);
    for (const [t, price] of wiggles) {
      expect([...real].every((r) => Math.abs(r - t) >= HOUR / 2)).toBe(true);
      expect(Math.abs(price / pathPrice(line, t) - 1)).toBeLessThanOrEqual(0.004 + 1e-12);
    }
    // Déterministe : même jeu, mêmes nœuds.
    expect(priceKnots(FIXTURE)).toEqual(knots);
  });
});

describe('pathCandles — des bougies qui encadrent le tracé', () => {
  const knots = priceKnots(FIXTURE)['BTC']!;
  const hour = { id: '1h', ms: HOUR };

  it('ouverture et clôture sur le tracé, plus haut et plus bas au-delà de tout nœud intérieur', () => {
    const candles = pathCandles(knots, 'BTC', hour, T0 + 30 * 60_000, T0 + 12 * HOUR);
    expect(candles[0]!['t']).toBe(T0 + HOUR);
    expect(candles).toHaveLength(12);
    for (const candle of candles) {
      const t = candle['t'] as number;
      expect(candle['T']).toBe(t + HOUR - 1);
      expect(candle['o']).toBe(priceText(pathPrice(knots, t)));
      expect(candle['c']).toBe(priceText(pathPrice(knots, t + HOUR)));
      for (let k = 0; k <= 12; k++) {
        const price = pathPrice(knots, t + (k * HOUR) / 12);
        expect(Number(candle['h'])).toBeGreaterThanOrEqual(price);
        expect(Number(candle['l'])).toBeLessThanOrEqual(price);
      }
    }
  });

  it('rien au-delà du dernier nœud, rien sans tracé', () => {
    const last = pathCandles(knots, 'BTC', hour, END - 2 * HOUR, END + 10 * HOUR);
    expect(last.map((c) => c['t'])).toEqual([END - 2 * HOUR, END - HOUR, END]);
    expect(pathCandles([], 'BTC', hour, T0, END)).toEqual([]);
  });

  it('le client hors ligne sert ces bougies sous candleSnapshot, et rien pour l’inconnu', () => {
    const fixture = {
      ...FIXTURE,
      address: '0x',
      userFunding: [],
      spotClearinghouseState: {},
      portfolio: [],
    } as HlFixture;
    const req = (over: Record<string, unknown>) =>
      answerInfo(fixture, {
        type: 'candleSnapshot',
        req: { coin: 'BTC', interval: '1h', startTime: T0, endTime: T0 + 2 * HOUR, ...over },
      });
    expect(req({})).toEqual(pathCandles(knots, 'BTC', hour, T0, T0 + 2 * HOUR));
    expect(req({ endTime: undefined })).toHaveLength(49);
    expect(req({ coin: 'DOGE' })).toEqual([]);
    expect(req({ interval: '7m' })).toEqual([]);
    expect(answerInfo(fixture, { type: 'candleSnapshot' })).toEqual([]);
  });
});
