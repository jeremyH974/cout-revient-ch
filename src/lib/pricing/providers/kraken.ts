/**
 * Kraken `GET /0/public/Ticker?pair=<alt1,alt2,…>` : dernier cours coté, jusqu'à 20 paires par
 * appel, sans clé. Réutilise l'index `altname → clé de résultat` de
 * `history/providers/kraken.ts` (mémoïsé, partagé avec ce fournisseur en production).
 *
 * CORS vérifié le 23/08/2026 avec
 * `curl -s -D - -o /dev/null -H "Origin: https://jeremyh974.github.io" <url>` :
 * `Access-Control-Allow-Origin: https://jeremyh974.github.io` (l'origine demandée est renvoyée
 * telle quelle), HTTP 200.
 */
import { isPositive, parseDecimal, toDecimalString } from '../../domain/money';
import type { AssetCode, DecimalString } from '../../domain/types';
import { krakenEurPairIndex, krakenPairName, krakenQueue } from '../../history/providers/kraken';
import { defaultFetch, readJson } from '../../history/providers/shared';
import type { FetchLike } from '../../history/types';
import { nowIso } from '../../clock';
import { numberToDecimal, type PriceProvider, type PriceQuoteInput } from '../types';

const ENDPOINT = 'https://api.kraken.com/0/public/Ticker';
const CHUNK_SIZE = 20;

interface KrakenBody {
  error?: unknown;
  result?: unknown;
}

function krakenErrors(body: KrakenBody): string[] {
  return Array.isArray(body.error)
    ? body.error.filter((item): item is string => typeof item === 'string')
    : [];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Chaîne décimale strictement positive, ou `null` (valeur absente, invalide ou ≤ 0). */
function positiveDecimal(value: unknown): DecimalString | null {
  const text = numberToDecimal(value);
  if (text === null) return null;
  const big = parseDecimal(text);
  return big !== null && isPositive(big) ? toDecimalString(big) : null;
}

export function krakenTickerProvider(options: { fetch?: FetchLike } = {}): PriceProvider {
  const doFetch = options.fetch ?? defaultFetch;
  const queue = krakenQueue();

  return {
    name: 'Kraken',
    async fetchPrices(codes, signal) {
      const found = new Map<AssetCode, PriceQuoteInput>();
      const index = await krakenEurPairIndex(doFetch, signal);

      // Ne retient que les codes dont la paire EUR existe chez Kraken.
      const codeByAltname = new Map<string, AssetCode>();
      for (const code of codes) {
        const altname = krakenPairName(code);
        if (index.has(altname)) codeByAltname.set(altname, code);
      }
      const altnames = [...codeByAltname.keys()];

      for (const group of chunk(altnames, CHUNK_SIZE)) {
        const url = `${ENDPOINT}?pair=${group.join(',')}`;
        const response = await queue.run(
          () => doFetch(url, { signal, headers: { accept: 'application/json' } }),
          signal,
        );
        const body = (await readJson('Kraken', response)) as KrakenBody;
        const errors = krakenErrors(body);
        if (errors.length > 0) throw new Error(`Kraken : ${errors.join(', ')}`);
        const result =
          typeof body.result === 'object' && body.result !== null
            ? (body.result as Record<string, { c?: unknown }>)
            : {};
        const at = nowIso();
        for (const altname of group) {
          const code = codeByAltname.get(altname);
          const key = index.get(altname);
          if (!code || !key) continue;
          const last = result[key]?.c;
          const priceEur = positiveDecimal(Array.isArray(last) ? last[0] : undefined);
          if (priceEur === null) continue;
          found.set(code, { asset: code, priceEur, at, source: 'Kraken', stale: false });
        }
      }
      return found;
    },
  };
}
