import { describe, expect, it } from 'vitest';
import { D, toDecimalString } from '../../domain/money';
import { addDays, dayToMs, daysBetween, eachDay } from '../days';
import { RequestQueue } from '../queue';
import type { FetchLike } from '../types';
import { coinbaseExchangeHistoryProvider } from './coinbase';
import { coingeckoHistoryProvider } from './coingecko';
import { DEFILLAMA_MAX_SPAN, defillamaHistoryProvider, type UsdToEurAt } from './defillama';
import { defaultHistoryProviders } from './index';
import { krakenHistoryProvider, krakenPairName } from './kraken';

type Route = (url: string) => { status?: number; body?: unknown } | undefined;

function fakeFetch(route: Route): { calls: string[]; fetch: FetchLike } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const hit = route(url);
    const status = hit?.status ?? (hit ? 200 : 404);
    const body = hit ? (hit.body ?? null) : { message: 'NotFound' };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetch };
}

const fastQueue = (): RequestQueue =>
  new RequestQueue({ minIntervalMs: 0, maxAttempts: 1, backoffMs: 0, sleep: async () => {} });
const NOW = Date.UTC(2026, 7, 22, 16, 19);
const now = (): number => NOW;
const signal = new AbortController().signal;
const sec = (day: string): number => dayToMs(day) / 1000;

describe('CoinGecko market_chart', () => {
  const chart = {
    prices: [
      [dayToMs('2026-08-19'), 100],
      [dayToMs('2026-08-20'), 101.5],
      [dayToMs('2026-08-21'), 102],
      [dayToMs('2026-08-22'), 103],
      [NOW, 104.25],
    ],
    market_caps: [],
    total_volumes: [],
  };

  it('rattache les points de minuit à la veille et garde le dernier point du jour', async () => {
    const { calls, fetch } = fakeFetch((url) =>
      url.includes('/coins/bitcoin/market_chart') ? { body: chart } : undefined,
    );
    const provider = coingeckoHistoryProvider({ fetch, queue: fastQueue(), now });
    expect(await provider.supports!('btc', signal)).toBe(true);
    const points = await provider.fetchDaily('btc', '2026-08-18', '2026-08-22', signal);
    expect(points).toEqual([
      { day: '2026-08-18', priceEur: '100' },
      { day: '2026-08-19', priceEur: '101.5' },
      { day: '2026-08-20', priceEur: '102' },
      { day: '2026-08-21', priceEur: '103' },
      { day: '2026-08-22', priceEur: '104.25' },
    ]);
    expect(calls).toEqual([
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=eur&days=5',
    ]);
  });

  it('plafonne days à 365, ignore les actifs sans id et accepte les surcharges', async () => {
    const { calls, fetch } = fakeFetch(() => ({ body: chart }));
    const provider = coingeckoHistoryProvider({
      fetch,
      queue: fastQueue(),
      now,
      idOverrides: { zzz: 'zzz-coin' },
    });
    await provider.fetchDaily('btc', '2020-01-01', '2026-08-22', signal);
    expect(calls[0]).toContain('days=365');
    expect(await provider.fetchDaily('eurcv', '2026-08-01', '2026-08-22', signal)).toEqual([]);
    expect(calls).toHaveLength(1);
    await provider.fetchDaily('zzz', '2026-08-20', '2026-08-22', signal);
    expect(calls[1]).toContain('/coins/zzz-coin/market_chart');
  });

  it('404 → vide, 429 persistant → erreur, intraday filtré sur les dernières heures', async () => {
    const notFound = fakeFetch(() => ({ status: 404, body: { error: 'coin not found' } }));
    const missing = coingeckoHistoryProvider({ fetch: notFound.fetch, queue: fastQueue(), now });
    expect(await missing.fetchDaily('btc', '2026-08-20', '2026-08-22', signal)).toEqual([]);

    const limited = fakeFetch(() => ({ status: 429, body: {} }));
    const throttled = coingeckoHistoryProvider({ fetch: limited.fetch, queue: fastQueue(), now });
    await expect(throttled.fetchDaily('btc', '2026-08-20', '2026-08-22', signal)).rejects.toThrow(
      'CoinGecko HTTP 429',
    );

    const fiveMin = 300_000;
    const intraday = {
      prices: Array.from({ length: 288 }, (_, i) => [NOW - (287 - i) * fiveMin, 60_000 + i]),
    };
    const { calls, fetch } = fakeFetch(() => ({ body: intraday }));
    const provider = coingeckoHistoryProvider({ fetch, queue: fastQueue(), now });
    const points = await provider.fetchIntraday!('btc', 2, signal);
    expect(calls[0]).toContain('days=1');
    expect(points).toHaveLength(25);
    expect(points[0]).toEqual({
      at: new Date(NOW - 24 * fiveMin).toISOString(),
      priceEur: '60263',
    });
    expect(points[24]!.at).toBe(new Date(NOW).toISOString());
  });
});

describe('Kraken OHLC', () => {
  const assetPairs = {
    error: [],
    result: {
      XXBTZEUR: { altname: 'XBTEUR', wsname: 'XBT/EUR', base: 'XXBT', quote: 'ZEUR' },
      XDGEUR: { altname: 'XDGEUR', wsname: 'XDG/EUR', base: 'XXDG', quote: 'ZEUR' },
      ZZZEUR: { altname: 'ZZZEUR', quote: 'ZEUR' },
      SOLUSD: { altname: 'SOLUSD', quote: 'ZUSD' },
    },
  };
  const candle = (day: string, close: string): unknown[] => [
    sec(day),
    '60000.0',
    '61000.0',
    '59000.0',
    close,
    '60200.1',
    '317.70301156',
    14029,
  ];
  const ohlc = (key: string, rows: unknown[][]): unknown => ({
    error: [],
    result: { [key]: rows, last: sec('2026-08-21') },
  });
  const route: Route = (url) => {
    if (url.endsWith('/AssetPairs')) return { body: assetPairs };
    if (url.includes('pair=XBTEUR')) {
      return {
        body: ohlc('XXBTZEUR', [
          candle('2026-08-20', '60500.5'),
          candle('2026-08-21', '61000.0'),
          candle('2026-08-22', '62000.0'),
        ]),
      };
    }
    if (url.includes('pair=XDGEUR'))
      return { body: ohlc('XDGEUR', [candle('2026-08-22', '0.0777612')]) };
    if (url.includes('pair=ZZZEUR')) return { body: { error: ['EQuery:Unknown asset pair'] } };
    return { body: { error: ['EGeneral:Invalid arguments'] } };
  };

  it('construit la paire, lit la clé variable et ne charge AssetPairs qu’une fois', async () => {
    expect(krakenPairName('btc')).toBe('XBTEUR');
    expect(krakenPairName('doge')).toBe('XDGEUR');
    expect(krakenPairName('eth')).toBe('ETHEUR');
    const { calls, fetch } = fakeFetch(route);
    const provider = krakenHistoryProvider({ fetch, queue: fastQueue(), now });
    expect(await provider.supports!('btc', signal)).toBe(true);
    expect(await provider.supports!('sol', signal)).toBe(false);
    const btc = await provider.fetchDaily('btc', '2026-08-21', '2026-08-22', signal);
    expect(btc).toEqual([
      { day: '2026-08-21', priceEur: '61000' },
      { day: '2026-08-22', priceEur: '62000' },
    ]);
    const doge = await provider.fetchDaily('doge', '2026-08-01', '2026-08-22', signal);
    expect(doge).toEqual([{ day: '2026-08-22', priceEur: '0.0777612' }]);
    expect(await provider.fetchDaily('sol', '2026-08-01', '2026-08-22', signal)).toEqual([]);
    expect(calls.filter((url) => url.endsWith('/AssetPairs'))).toHaveLength(1);
    const ohlcUrl = calls.find((url) => url.includes('pair=XBTEUR'))!;
    expect(ohlcUrl).toContain(`interval=1440&since=${sec('2026-08-20')}`);
    expect(calls.filter((url) => url.includes('OHLC'))).toHaveLength(2);
  });

  it('paire inconnue → vide, autre erreur Kraken → exception', async () => {
    const { fetch } = fakeFetch(route);
    const provider = krakenHistoryProvider({ fetch, queue: fastQueue(), now });
    expect(await provider.fetchDaily('zzz', '2026-08-01', '2026-08-22', signal)).toEqual([]);
    const broken = fakeFetch((url) =>
      url.endsWith('/AssetPairs') ? { body: { error: ['EService:Unavailable'] } } : undefined,
    );
    const failing = krakenHistoryProvider({ fetch: broken.fetch, queue: fastQueue(), now });
    await expect(failing.fetchDaily('btc', '2026-08-01', '2026-08-22', signal)).rejects.toThrow(
      'Kraken : EService:Unavailable',
    );
  });

  it('intraday : intervalle adapté et bornes', async () => {
    const rows = [
      candle('2026-08-21', '1'),
      [NOW - 3_600_000, '0', '0', '0', '62000.0', '0', '0', 1],
      [NOW - 600_000, '0', '0', '0', '62500.0', '0', '0', 1],
    ];
    const { calls, fetch } = fakeFetch((url) =>
      url.endsWith('/AssetPairs') ? { body: assetPairs } : { body: ohlc('XXBTZEUR', rows) },
    );
    const provider = krakenHistoryProvider({ fetch, queue: fastQueue(), now });
    const points = await provider.fetchIntraday!('btc', 24, signal);
    expect(calls[1]).toContain('interval=5');
    expect(points.map((p) => p.priceEur)).toEqual(['62000', '62500']);
  });
});

describe('Coinbase Exchange candles', () => {
  const LISTED = '2026-08-10';
  const products = [
    { id: 'BTC-EUR', base_currency: 'BTC', quote_currency: 'EUR', status: 'online' },
    { id: 'MATIC-EUR', base_currency: 'MATIC', quote_currency: 'EUR', status: 'delisted' },
    { id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', status: 'online' },
  ];
  const route = (listedFrom: string, delistedAfter = '9999-12-31'): Route => {
    return (url) => {
      if (url.endsWith('/products')) return { body: products };
      const match =
        /products\/([A-Z-]+)\/candles\?granularity=86400&start=(\S+?)T00:00:00Z&end=(\S+?)T00:00:00Z/.exec(
          url,
        );
      if (!match) return undefined;
      if (match[1] !== 'BTC-EUR') return undefined;
      const rows = eachDay(match[2]!, match[3]!)
        .filter((day) => day >= listedFrom && day <= delistedAfter)
        .reverse()
        .map((day, index) => [sec(day), 1, 2, 1.5, 100 + index, 10]);
      return { body: rows };
    };
  };

  it('lit la clôture, garde les produits délistés, ignore les actifs hors table', async () => {
    const { calls, fetch } = fakeFetch(route(LISTED));
    const provider = coinbaseExchangeHistoryProvider({ fetch, queue: fastQueue(), now });
    expect(await provider.supports!('btc', signal)).toBe(true);
    expect(await provider.supports!('matic', signal)).toBe(true);
    expect(await provider.supports!('sol', signal)).toBe(false);
    expect(await provider.supports!('gmx', signal)).toBe(false);
    const points = await provider.fetchDaily('btc', '2026-08-01', '2026-08-22', signal);
    expect(points).toHaveLength(13);
    expect(points[0]).toEqual({ day: '2026-08-10', priceEur: '112' });
    expect(points[12]).toEqual({ day: '2026-08-22', priceEur: '100' });
    expect(await provider.fetchDaily('gmx', '2026-08-01', '2026-08-22', signal)).toEqual([]);
    expect(calls.filter((url) => url.endsWith('/products'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/candles'))).toHaveLength(1);
  });

  it('pagine par fenêtres de 300 jours, s’arrête à la fenêtre vide qui suit des données', async () => {
    const { calls, fetch } = fakeFetch(route('2025-01-01'));
    const provider = coinbaseExchangeHistoryProvider({ fetch, queue: fastQueue(), now });
    const points = await provider.fetchDaily('btc', '2024-06-01', '2026-08-22', signal);
    const candles = calls.filter((url) => url.includes('/candles'));
    expect(candles).toHaveLength(3);
    expect(candles[0]).toContain('start=2025-10-27T00:00:00Z&end=2026-08-22T00:00:00Z');
    expect(candles[1]).toContain('start=2024-12-31T00:00:00Z&end=2025-10-26T00:00:00Z');
    expect(candles[2]).toContain('start=2024-06-01T00:00:00Z&end=2024-12-30T00:00:00Z');
    expect(points).toHaveLength(eachDay('2025-01-01', '2026-08-22').length);
    expect(points[0]!.day).toBe('2025-01-01');
    expect(points[points.length - 1]!.day).toBe('2026-08-22');
    expect(addDays(points[0]!.day, points.length - 1)).toBe('2026-08-22');
  });

  it('produit délisté : les fenêtres récentes vides n’arrêtent pas la remontée', async () => {
    const { calls, fetch } = fakeFetch(route('2024-09-01', '2025-03-01'));
    const provider = coinbaseExchangeHistoryProvider({ fetch, queue: fastQueue(), now });
    const points = await provider.fetchDaily('btc', '2024-06-01', '2026-08-22', signal);
    expect(calls.filter((url) => url.includes('/candles'))).toHaveLength(3);
    expect(points).toHaveLength(eachDay('2024-09-01', '2025-03-01').length);
    expect(points[0]!.day).toBe('2024-09-01');
    expect(points[points.length - 1]!.day).toBe('2025-03-01');
  });

  it('404 sur les bougies → vide ; intraday en granularité 5 min', async () => {
    const gone = fakeFetch((url) => (url.endsWith('/products') ? { body: products } : undefined));
    const provider = coinbaseExchangeHistoryProvider({
      fetch: gone.fetch,
      queue: fastQueue(),
      now,
    });
    expect(await provider.fetchDaily('btc', '2026-08-01', '2026-08-22', signal)).toEqual([]);

    const rows = [
      [(NOW - 600_000) / 1000, 1, 2, 1.5, 62500, 1],
      [(NOW - 3_600_000) / 1000, 1, 2, 1.5, 62000, 1],
      [(NOW - 30 * 3_600_000) / 1000, 1, 2, 1.5, 1, 1],
    ];
    const intraday = fakeFetch((url) =>
      url.endsWith('/products') ? { body: products } : { body: rows },
    );
    const live = coinbaseExchangeHistoryProvider({
      fetch: intraday.fetch,
      queue: fastQueue(),
      now,
    });
    const points = await live.fetchIntraday!('btc', 24, signal);
    expect(intraday.calls[1]).toContain('granularity=300');
    expect(points.map((p) => p.priceEur)).toEqual(['62000', '62500']);
  });
});

describe('DefiLlama chart (historique profond)', () => {
  const ENDPOINT = 'https://coins.llama.fi/chart/coingecko:bitcoin';
  /** `start` est ancré à midi UTC : le point ne tombe jamais sur la frontière de minuit. */
  const noon = (day: string): number => sec(day) + 43_200;
  /** Taux BCE de test : 2 USD pour 1 EUR, donc 100 $ valent 50 €. */
  const halve: UsdToEurAt = (_day, priceUsd) => toDecimalString(D(priceUsd).div('2'));
  const provider = (fetch: FetchLike, usdToEurAt: UsdToEurAt = halve) =>
    defillamaHistoryProvider({ fetch, queue: fastQueue(), usdToEurAt });

  const point = (day: string, price: number) => ({ timestamp: noon(day), price });
  const series = (prices: { timestamp: number; price: number }[], confidence = 0.99) => ({
    coins: { 'coingecko:bitcoin': { symbol: 'BTC', confidence, prices } },
  });
  const serve =
    (body: unknown): Route =>
    (url) =>
      url.startsWith(ENDPOINT) ? { body } : undefined;

  it('annonce une profondeur illimitée', () => {
    expect(defillamaHistoryProvider({ usdToEurAt: halve }).maxDays).toBeNull();
  });

  it('convertit chaque point au taux de son jour, ancré à midi UTC', async () => {
    const { calls, fetch } = fakeFetch(
      serve(series([point('2026-08-18', 100), point('2026-08-19', 120), point('2026-08-20', 90)])),
    );
    const points = await provider(fetch).fetchDaily('btc', '2026-08-18', '2026-08-20', signal);
    expect(points).toEqual([
      { day: '2026-08-18', priceEur: '50' },
      { day: '2026-08-19', priceEur: '60' },
      { day: '2026-08-20', priceEur: '45' },
    ]);
    expect(calls).toEqual([`${ENDPOINT}?start=${noon('2026-08-18')}&span=3&period=1d`]);
  });

  it('pagine en marche avant par fenêtres de 500 points au plus', async () => {
    const from = '2023-01-01';
    const to = '2026-08-22';
    const { calls, fetch } = fakeFetch(serve(series([point('2023-01-02', 100)])));
    await provider(fetch).fetchDaily('btc', from, to, signal);
    const second = addDays(from, DEFILLAMA_MAX_SPAN);
    const third = addDays(second, DEFILLAMA_MAX_SPAN);
    expect(calls).toEqual([
      `${ENDPOINT}?start=${noon(from)}&span=${DEFILLAMA_MAX_SPAN}&period=1d`,
      `${ENDPOINT}?start=${noon(second)}&span=${DEFILLAMA_MAX_SPAN}&period=1d`,
      `${ENDPOINT}?start=${noon(third)}&span=${daysBetween(third, to) + 1}&period=1d`,
    ]);
  });

  it("s'arrête à la première fenêtre vide qui suit des données (actif délisté)", async () => {
    const from = '2023-01-01';
    const { calls, fetch } = fakeFetch((url) => {
      if (!url.startsWith(ENDPOINT)) return undefined;
      return url.includes(`start=${noon(from)}`)
        ? { body: series([point('2023-01-02', 100)]) }
        : { body: { coins: {} } };
    });
    await provider(fetch).fetchDaily('btc', from, '2026-08-22', signal);
    expect(calls).toHaveLength(2); // la troisième fenêtre n'est jamais demandée
    expect(calls[1]).toContain(`start=${noon(addDays(from, DEFILLAMA_MAX_SPAN))}`);
  });

  it('ignore un actif sans identifiant CoinGecko, sans aucun appel', async () => {
    const { calls, fetch } = fakeFetch(() => undefined);
    const p = provider(fetch);
    await expect(p.supports!('zzz', signal)).resolves.toBe(false);
    expect(await p.fetchDaily('zzz', '2026-08-18', '2026-08-20', signal)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('ne se déclare pas compatible sans convertisseur de change', async () => {
    const { calls, fetch } = fakeFetch(() => undefined);
    const p = defillamaHistoryProvider({ fetch, queue: fastQueue() });
    await expect(p.supports!('btc', signal)).resolves.toBe(false);
    expect(await p.fetchDaily('btc', '2026-08-18', '2026-08-20', signal)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("renvoie [] quand l'API ne connaît pas l'actif (coins vide, HTTP 200)", async () => {
    const { fetch } = fakeFetch(serve({ coins: {} }));
    expect(await provider(fetch).fetchDaily('btc', '2026-08-18', '2026-08-20', signal)).toEqual([]);
  });

  // L'API sert aujourd'hui cette erreur en HTTP 400 (`readJson` la remonte alors) ; la garde de
  // `seriesOf` couvre le cas où elle passerait un jour en 200, plutôt que de traiter un corps
  // d'erreur comme une série vide.
  it("lève si un corps d'erreur applicative arrivait en HTTP 200", async () => {
    const message = 'Requested 5000 data points exceeds the maximum of 500.';
    const { fetch } = fakeFetch(serve({ message }));
    await expect(
      provider(fetch).fetchDaily('btc', '2026-08-18', '2026-08-20', signal),
    ).rejects.toThrow(message);
  });

  it('rejette une série dont la confiance est sous le seuil', async () => {
    const { fetch } = fakeFetch(serve(series([point('2026-08-18', 100)], 0.4)));
    expect(await provider(fetch).fetchDaily('btc', '2026-08-18', '2026-08-20', signal)).toEqual([]);
  });

  it("omet le point d'un jour sans taux plutôt que de le convertir de travers", async () => {
    const { fetch } = fakeFetch(
      serve(series([point('2026-08-18', 100), point('2026-08-19', 120)])),
    );
    const convert: UsdToEurAt = (day, usd) => (day === '2026-08-19' ? null : halve(day, usd));
    const points = await provider(fetch, convert).fetchDaily(
      'btc',
      '2026-08-18',
      '2026-08-20',
      signal,
    );
    expect(points).toEqual([{ day: '2026-08-18', priceEur: '50' }]);
  });

  it('remonte un échec HTTP', async () => {
    const { fetch } = fakeFetch((url) =>
      url.startsWith(ENDPOINT) ? { status: 429, body: {} } : undefined,
    );
    await expect(
      provider(fetch).fetchDaily('btc', '2026-08-18', '2026-08-20', signal),
    ).rejects.toThrow('DefiLlama HTTP 429');
  });
});

describe('defaultHistoryProviders', () => {
  it('range DefiLlama en dernier : un prix coté en euros prime sur un prix converti (décision n° 42)', () => {
    const names = defaultHistoryProviders({}, () => '1').map((p) => p.name);
    expect(names).toEqual(['Coinbase', 'Kraken', 'CoinGecko', 'DefiLlama']);
  });

  it('omet DefiLlama faute de convertisseur : il ne sait coter qu’en dollars', () => {
    const names = defaultHistoryProviders({}).map((p) => p.name);
    expect(names).toEqual(['Coinbase', 'Kraken', 'CoinGecko']);
  });
});
