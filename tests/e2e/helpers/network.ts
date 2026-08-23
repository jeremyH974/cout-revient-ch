import type { BrowserContext } from '@playwright/test';
import { generateHlFixture } from '../../../scripts/generate-hl-fixture';
import { addDays } from '../../../src/lib/fx/service';
import { answerInfo } from '../../../src/lib/import/hyperliquid/fixture-client';

/**
 * Aucune requête ne sort vers Internet pendant les tests : chaque appel externe reçoit une réponse
 * déterministe (les abandonner produirait des erreurs console, que la spec PWA interdit).
 * Prix fixes pour les actifs de la fixture → totaux reproductibles ; chandelles Coinbase fixes →
 * la courbe se trace ; Kraken ne connaît que BTC/ETH/SOL ; Frankfurter renvoie un taux EUR→USD fixe
 * sur toute la plage demandée (nécessaire à Hyperliquid/DefiLlama, docs/DECISIONS.md n° 18) ;
 * DefiLlama reste inerte en E2E (couvert par les tests unitaires). `near` (voir FALLTHROUGH_ASSET
 * ci-dessous) n'a jamais de prix CoinGecko/Coinbase/Kraken : seul actif de la fixture à retomber
 * jusqu'à Hyperliquid, pour exercer toute la chaîne (tests/e2e/prices.spec.ts).
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

/**
 * Actif choisi pour tester la bascule complète de la chaîne de prix (P23). Le jeton `hype`
 * (candidat naturel : c'est celui d'Hyperliquid) est absent de la fixture démo ; parmi les 21
 * actifs qu'elle contient, aucun n'a `coinbase: null` dans `src/lib/pricing/tickers.ts`, donc
 * Coinbase est neutralisé ci-dessous pour ce seul actif, en plus de CoinGecko — Kraken ne le
 * connaît de toute façon pas (`AssetPairs` ne liste ici que BTC/ETH/SOL).
 */
const FALLTHROUGH_ASSET = {
  coingeckoId: 'near',
  coinbaseSymbol: 'NEAR',
  hyperliquidCoin: 'NEAR',
} as const;

/**
 * Taux EUR→USD fixe des tests, sur toute la plage demandée à Frankfurter : décimales exactes avec
 * STUB_PRICES_EUR pour que « usd ÷ taux » retombe pile sur le prix EUR d'origine
 * (2 × 1,1 = 2,2 ; 60000 × 1,1 = 66000 — voir HYPERLIQUID_MIDS).
 */
const EUR_USD_RATE = '1.1';

/** Mids Hyperliquid (USDC, en chaînes comme la vraie API) dérivés de STUB_PRICES_EUR × EUR_USD_RATE. */
const HYPERLIQUID_MIDS: Record<string, string> = {
  BTC: '66000',
  [FALLTHROUGH_ASSET.hyperliquidCoin]: '2.2',
};

/** Jeu de démonstration Hyperliquid synthétique (P20) : mêmes réponses `info` que le mode démo. */
const HL_FIXTURE = generateHlFixture();

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

/**
 * Résultat Kraken `pair` → prix EUR connu (btc/eth/sol seulement, comme AssetPairs ci-dessous).
 * La vraie API indexe `result` par la clé de paire (`XXBTZEUR`, `XETHZEUR`, `SOLEUR`), pas par
 * l'altname demandé (`XBTEUR`, `ETHEUR`, `SOLEUR`) — vérifié le 23/08/2026 sur
 * `pair=XBTEUR,ETHEUR,SOLEUR` ; `pricing/providers/kraken.ts` fait `result[index.get(altname)]`.
 */
function krakenTickerResult(url: URL): Record<string, { c: [string, string] }> {
  const altnames = (url.searchParams.get('pair') ?? '').split(',').filter(Boolean);
  // altname demandé → [clé de résultat, prix EUR], en miroir du AssetPairs stub ci-dessus.
  const known: Record<string, [string, number]> = {
    XBTEUR: ['XXBTZEUR', STUB_PRICES_EUR['bitcoin']!],
    ETHEUR: ['XETHZEUR', STUB_PRICES_EUR['ethereum']!],
    SOLEUR: ['SOLEUR', STUB_PRICES_EUR['solana']!],
  };
  const result: Record<string, { c: [string, string] }> = {};
  for (const altname of altnames) {
    const entry = known[altname];
    // Altname inconnu : simplement omis, comme la vraie API (jamais d'erreur pour ça).
    if (entry) result[entry[0]] = { c: [String(entry[1]), '1.0'] };
  }
  return result;
}

/** Taux EUR→devise Frankfurter fixe sur toute la plage `fromDay..toDay` demandée. */
function frankfurterRates(url: URL): {
  amount: number;
  base: string;
  start_date: string;
  end_date: string;
  rates: Record<string, { USD: string }>;
} {
  const range = /(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(url.pathname);
  const today = new Date().toISOString().slice(0, 10);
  const fromDay = range?.[1] ?? today;
  const toDay = range?.[2] ?? today;
  const rates: Record<string, { USD: string }> = {};
  let day = fromDay;
  // Bornée : la fixture démo couvre au plus quelques années, largement sous cette garde.
  for (let i = 0; i < 900 && day <= toDay; i++) {
    rates[day] = { USD: EUR_USD_RATE };
    day = addDays(day, 1);
  }
  return { amount: 1, base: 'EUR', start_date: fromDay, end_date: toDay, rates };
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
          // Force la bascule vers les fournisseurs suivants pour cet actif (FALLTHROUGH_ASSET).
          if (id === FALLTHROUGH_ASSET.coingeckoId) continue;
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
      // Même actif que CoinGecko ci-dessus : pas de cotation Coinbase non plus (FALLTHROUGH_ASSET).
      // Réponse 200 sans montant plutôt qu'un 404 : un 404 laisse une erreur console dans le
      // navigateur, que pwa.spec.ts interdit.
      if (symbol === FALLTHROUGH_ASSET.coinbaseSymbol)
        return json({ data: { base: symbol, currency: 'EUR' } });
      return json({ data: { base: symbol, currency: 'EUR', amount: '50' } });
    }
    if (url.hostname === 'api.kraken.com') {
      if (url.pathname === '/0/public/AssetPairs') {
        return json({
          error: [],
          result: {
            XXBTZEUR: { altname: 'XBTEUR', quote: 'ZEUR' },
            XETHZEUR: { altname: 'ETHEUR', quote: 'ZEUR' },
            SOLEUR: { altname: 'SOLEUR', quote: 'ZEUR' },
          },
        });
      }
      if (url.pathname === '/0/public/Ticker')
        return json({ error: [], result: krakenTickerResult(url) });
      // OHLC (chandelles) et le reste : forme vide, inchangée depuis avant P23.
      return json({ error: [], result: {} });
    }
    if (url.hostname === 'api.hyperliquid.xyz') {
      const body = route.request().postDataJSON() as Record<string, unknown> | null;
      if (body?.['type'] === 'allMids') return json({ ...HL_FIXTURE.allMids, ...HYPERLIQUID_MIDS });
      if (body?.['type'] === 'spotMeta') return json(HL_FIXTURE.spotMeta);
      return json(answerInfo(HL_FIXTURE, body ?? {}) ?? {});
    }
    if (url.hostname === 'coins.llama.fi') return json({ coins: {} });
    if (url.hostname.startsWith('api.frankfurter.')) return json(frankfurterRates(url));
    return json({});
  });
}
