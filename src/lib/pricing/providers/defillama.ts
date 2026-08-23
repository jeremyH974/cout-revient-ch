/**
 * DefiLlama `GET /prices/current/<coingecko:id1,…>?searchWidth=4h` : cours USD par identifiant
 * CoinGecko, jusqu'à 50 identifiants par appel, sans clé, convertis en EUR via `usdToEur`. Filet
 * de sécurité générique : sert à tout actif ayant un id CoinGecko, y compris ceux absents des
 * autres fournisseurs.
 *
 * CORS vérifié le 23/08/2026 avec
 * `curl -s -D - -o /dev/null -H "Origin: https://jeremyh974.github.io" <url>` :
 * `access-control-allow-origin: *`, HTTP 200.
 */
import { isPositive, parseDecimal } from '../../domain/money';
import type { AssetCode } from '../../domain/types';
import { nowIso } from '../../clock';
import { defaultFetch, readJson } from '../../history/providers/shared';
import type { FetchLike } from '../../history/types';
import { TICKERS } from '../tickers';
import { numberToDecimal, type PriceProvider, type PriceQuoteInput, type UsdToEur } from '../types';

const ENDPOINT = 'https://coins.llama.fi/prices/current';
const CHUNK_SIZE = 50;
/** En deçà, DefiLlama juge le prix trop incertain (faible profondeur de marché). */
const MIN_CONFIDENCE = 0.8;

interface CoinEntry {
  price?: unknown;
  timestamp?: unknown;
  confidence?: unknown;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** ISO du point de prix : `timestamp` (secondes, DefiLlama) si fini, sinon l'instant présent. */
function isoAt(timestamp: unknown): string {
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000).toISOString()
    : nowIso();
}

export function defillamaProvider(options: {
  usdToEur: UsdToEur;
  idOverrides?: Record<AssetCode, string | null>;
  fetch?: FetchLike;
}): PriceProvider {
  const doFetch = options.fetch ?? defaultFetch;
  const idOverrides = options.idOverrides ?? {};

  return {
    name: 'DefiLlama',
    async fetchPrices(codes, signal) {
      const found = new Map<AssetCode, PriceQuoteInput>();
      const codeByKey = new Map<string, AssetCode>();
      for (const code of codes) {
        const id = idOverrides[code] ?? TICKERS[code]?.coingeckoId ?? null;
        if (id) codeByKey.set(`coingecko:${id}`, code);
      }
      const keys = [...codeByKey.keys()];

      for (const group of chunk(keys, CHUNK_SIZE)) {
        const url = `${ENDPOINT}/${group.join(',')}?searchWidth=4h`;
        const response = await doFetch(url, { signal, headers: { accept: 'application/json' } });
        const body = (await readJson('DefiLlama', response)) as { coins?: unknown };
        const coins =
          typeof body.coins === 'object' && body.coins !== null
            ? (body.coins as Record<string, CoinEntry>)
            : {};
        for (const key of group) {
          const code = codeByKey.get(key);
          const coin = coins[key];
          if (!code || !coin) continue;
          const confidence = coin.confidence;
          if (typeof confidence === 'number' && confidence < MIN_CONFIDENCE) continue;
          const priceUsd = numberToDecimal(coin.price);
          if (priceUsd === null) continue;
          const big = parseDecimal(priceUsd);
          if (big === null || !isPositive(big)) continue;
          const priceEur = options.usdToEur(priceUsd);
          if (priceEur === null) continue;
          found.set(code, {
            asset: code,
            priceEur,
            at: isoAt(coin.timestamp),
            source: 'DefiLlama',
            stale: false,
          });
        }
      }
      return found;
    },
  };
}
