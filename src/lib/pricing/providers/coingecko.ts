/** CoinGecko `/simple/price` : un seul appel groupé, sans clé, CORS vérifié le 22/08/2026. */
import type { AssetCode } from '../../domain/types';
import { TICKERS } from '../tickers';
import { numberToDecimal, type PriceProvider, type PriceQuoteInput } from '../types';

const ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price';

export function coingeckoProvider(
  idOverrides: Record<AssetCode, string | null> = {},
): PriceProvider {
  return {
    name: 'CoinGecko',
    async fetchPrices(codes, signal) {
      const idToCode = new Map<string, AssetCode>();
      for (const code of codes) {
        const id = idOverrides[code] ?? TICKERS[code]?.coingeckoId ?? null;
        if (id) idToCode.set(id, code);
      }
      const found = new Map<AssetCode, PriceQuoteInput>();
      if (idToCode.size === 0) return found;
      const url = `${ENDPOINT}?ids=${[...idToCode.keys()].join(',')}&vs_currencies=eur&precision=full&include_last_updated_at=true`;
      const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
      const body = (await response.json()) as Record<
        string,
        { eur?: unknown; last_updated_at?: unknown }
      >;
      for (const [id, code] of idToCode) {
        const priceEur = numberToDecimal(body[id]?.eur);
        if (!priceEur) continue;
        const updated = body[id]?.last_updated_at;
        const at =
          typeof updated === 'number'
            ? new Date(updated * 1000).toISOString()
            : new Date().toISOString();
        found.set(code, { asset: code, priceEur, at, source: 'CoinGecko', stale: false });
      }
      return found;
    },
  };
}
