import type { BrowserContext } from '@playwright/test';

/**
 * Aucune requête ne sort vers Internet pendant les tests : chaque appel externe reçoit une réponse
 * déterministe (les abandonner produirait des erreurs console, que la spec PWA interdit).
 * Prix fixes pour les actifs de la fixture → totaux reproductibles ; chandelles Coinbase fixes →
 * la courbe se trace ; Kraken n'a aucune paire ; tout le reste reçoit un objet vide.
 */
export const STUB_PRICES_EUR: Record<string, number> = {
  bitcoin: 60000,
  ethereum: 2000,
  solana: 100,
  cardano: 0.5,
  ripple: 2,
  chainlink: 12,
  'avalanche-2': 15,
  dogecoin: 0.12,
  near: 2,
  pepe: 0.000004,
  sky: 0.05,
  'usd-coin': 0.92,
};

/** Produits Coinbase Exchange « X-EUR » pour tous les tickers de la fixture (positions et clôturées). */
const COINBASE_TICKERS = [
  'BTC',
  'ETH',
  'SOL',
  'ADA',
  'XRP',
  'LINK',
  'AVAX',
  'DOGE',
  'NEAR',
  'PEPE',
  'SKY',
  'USDC',
  'LTC',
  'ATOM',
  'UNI',
  'XLM',
  'ENS',
  'AAVE',
  'ALGO',
  'DOT',
  'MKR',
];

const DAY_S = 86_400;

/** Hachage FNV-1a 32 bits : prix stable par identifiant, sans table. */
function fnv(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function stubPrice(seconds: number): number {
  // Cours synthétique, strictement positif, qui varie d'un jour à l'autre.
  return 100 + ((Math.floor(seconds / DAY_S) * 7) % 23);
}

/** Chandelles Coinbase `[time, low, high, open, close, volume]`, du plus récent au plus ancien. */
function coinbaseCandles(url: URL): number[][] {
  const granularity = Number(url.searchParams.get('granularity') ?? DAY_S);
  const start = Math.floor(new Date(url.searchParams.get('start') ?? 0).getTime() / 1000);
  const end = Math.floor(new Date(url.searchParams.get('end') ?? Date.now()).getTime() / 1000);
  const rows: number[][] = [];
  const first = Math.floor(start / granularity) * granularity;
  for (let t = Math.floor(end / granularity) * granularity; t >= first; t -= granularity) {
    const close = stubPrice(t);
    rows.unshift([t, close - 1, close + 1, close, close, 1000]);
    if (rows.length >= 300) break;
  }
  return rows.reverse();
}

function coingeckoMarketChart(url: URL): { prices: number[][] } {
  const days = Math.min(365, Number(url.searchParams.get('days') ?? 365));
  const now = Date.now();
  const prices: number[][] = [];
  for (let i = days; i >= 0; i--) {
    const ms = now - i * DAY_S * 1000;
    prices.push([ms, stubPrice(ms / 1000)]);
  }
  return { prices };
}

export async function stubNetwork(context: BrowserContext): Promise<void> {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown): Promise<void> =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });

    if (url.hostname === 'api.coingecko.com') {
      if (url.pathname.endsWith('/simple/price')) {
        const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
        const body: Record<string, { eur: number; last_updated_at: number }> = {};
        const now = Math.floor(Date.now() / 1000);
        for (const id of ids) {
          // Identifiant hors fixture (export réel local) : prix déterministe, strictement positif.
          const price = STUB_PRICES_EUR[id] ?? 0.5 + (fnv(id) % 2000) / 100;
          body[id] = { eur: price, last_updated_at: now };
        }
        return json(body);
      }
      if (url.pathname.includes('/market_chart')) return json(coingeckoMarketChart(url));
      return json({});
    }
    if (url.hostname === 'api.exchange.coinbase.com') {
      if (url.pathname === '/products') {
        return json(
          COINBASE_TICKERS.map((t) => ({
            id: `${t}-EUR`,
            base_currency: t,
            quote_currency: 'EUR',
          })),
        );
      }
      if (url.pathname.includes('/candles')) return json(coinbaseCandles(url));
      return json([]);
    }
    if (url.hostname === 'api.coinbase.com' && url.pathname.includes('/prices/')) {
      const symbol = url.pathname.split('/prices/')[1]?.split('-')[0] ?? 'BTC';
      return json({ data: { base: symbol, currency: 'EUR', amount: '50' } });
    }
    if (url.hostname === 'api.kraken.com') return json({ error: [], result: {} });
    if (url.hostname.startsWith('api.frankfurter.')) {
      return json({ amount: 1, base: 'EUR', rates: {} });
    }
    return json({});
  });
}
