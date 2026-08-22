/** Coinbase `/v2/prices/{SYM}-EUR/spot` : un appel par actif, sans clé, CORS documenté. */
import type { AssetCode } from '../../domain/types';
import { TICKERS } from '../tickers';
import { numberToDecimal, type PriceProvider, type PriceQuoteInput } from '../types';

const CONCURRENCY = 4;

export function coinbaseProvider(): PriceProvider {
  return {
    name: 'Coinbase',
    async fetchPrices(codes, signal) {
      const found = new Map<AssetCode, PriceQuoteInput>();
      const queue = codes.filter((code) => TICKERS[code]?.coinbase);
      const worker = async (): Promise<void> => {
        for (let code = queue.shift(); code !== undefined; code = queue.shift()) {
          const symbol = TICKERS[code]!.coinbase!;
          try {
            const response = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-EUR/spot`, {
              signal,
              headers: { accept: 'application/json' },
            });
            if (!response.ok) continue;
            const body = (await response.json()) as { data?: { amount?: unknown } };
            const priceEur = numberToDecimal(body.data?.amount);
            if (priceEur)
              found.set(code, {
                asset: code,
                priceEur,
                at: new Date().toISOString(),
                source: 'Coinbase',
                stale: false,
              });
          } catch (error) {
            if (signal.aborted) throw error;
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      return found;
    },
  };
}
