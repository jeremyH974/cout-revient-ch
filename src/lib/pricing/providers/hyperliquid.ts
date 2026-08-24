/**
 * Hyperliquid `POST /info` (`{"type":"allMids"}`, `{"type":"spotMeta"}`) : cours spot/perp en
 * USDC (assimilé USD), convertis en EUR via `usdToEur`, sans clé. CORS vérifié le 23/08/2026
 * avec `Origin: https://jeremyh974.github.io` : `access-control-allow-origin: *`, y compris le
 * préflight `OPTIONS` du `POST`, HTTP 200.
 *
 * `allMids` est un objet plat : perp par nom (`"BTC"`, `"HYPE"`), spot par nom quand la paire
 * est « canonique » (`"PURR/USDC"`), sinon par index d'univers (`"@107"`) ; les clés `"#<id>"`
 * sont ignorées (non résolues ici). `spotMeta` donne `tokens` (nom → index) et `universe`
 * (paires `[tokenIndex, quoteIndex]` → nom/index/canonique) : seules les paires cotées en USDC
 * (jeton d'indice 0) sont retenues. `spotMeta` change rarement : mémoïsé 24 h par identité de
 * `fetch` ; `allMids` est en revanche redemandé à chaque appel.
 */
import { isPositive, parseDecimal, toDecimalString } from '../../domain/money';
import type { AssetCode } from '../../domain/types';
import { nowIso, nowMs } from '../../clock';
import { defaultFetch, readJson } from '../../history/providers/shared';
import type { FetchLike } from '../../history/types';
import { numberToDecimal, type PriceProvider, type PriceQuoteInput, type UsdToEur } from '../types';

const ENDPOINT = 'https://api.hyperliquid.xyz/info';
const SPOT_META_TTL_MS = 24 * 60 * 60 * 1000;
const USDC_TOKEN_INDEX = 0;

interface SpotToken {
  name: string;
  index: number;
}

interface SpotUniverseEntry {
  tokens: [number, number];
  name: string;
  index: number;
  isCanonical: boolean;
}

interface SpotMeta {
  tokens: SpotToken[];
  universe: SpotUniverseEntry[];
}

async function postInfo(
  fetchLike: FetchLike,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetchLike(ENDPOINT, {
    method: 'POST',
    signal,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readJson('Hyperliquid', response);
}

function parseSpotMeta(body: unknown): SpotMeta {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const tokens: SpotToken[] = [];
  for (const item of Array.isArray(raw['tokens']) ? raw['tokens'] : []) {
    const { name, index } = (item ?? {}) as { name?: unknown; index?: unknown };
    if (typeof name === 'string' && typeof index === 'number') tokens.push({ name, index });
  }
  const universe: SpotUniverseEntry[] = [];
  for (const item of Array.isArray(raw['universe']) ? raw['universe'] : []) {
    const {
      tokens: pair,
      name,
      index,
      isCanonical,
    } = (item ?? {}) as {
      tokens?: unknown;
      name?: unknown;
      index?: unknown;
      isCanonical?: unknown;
    };
    const [a, b] = Array.isArray(pair) ? pair : [];
    if (
      typeof a === 'number' &&
      typeof b === 'number' &&
      typeof name === 'string' &&
      typeof index === 'number'
    ) {
      universe.push({ tokens: [a, b], name, index, isCanonical: isCanonical === true });
    }
  }
  return { tokens, universe };
}

function parseAllMids(body: unknown): Record<string, string> {
  const mids: Record<string, string> = {};
  if (typeof body === 'object' && body !== null) {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (typeof value === 'string') mids[key] = value;
    }
  }
  return mids;
}

/** Clé de cotation dans `allMids` pour la paire spot USDC d'un actif, ou `undefined`. */
function spotMidKey(meta: SpotMeta, upper: string): string | undefined {
  const token = meta.tokens.find((t) => t.name === upper);
  if (!token) return undefined;
  const entry = meta.universe.find(
    (u) => u.tokens[0] === token.index && u.tokens[1] === USDC_TOKEN_INDEX,
  );
  return entry ? (entry.isCanonical ? entry.name : `@${entry.index}`) : undefined;
}

const spotMetaCache = new Map<FetchLike, { at: number; value: Promise<SpotMeta> }>();

/** `spotMeta`, mémoïsé 24 h par identité de `fetchLike` ; un échec vide l'entrée. */
function spotMeta(
  fetchLike: FetchLike,
  signal: AbortSignal,
  now: () => number = nowMs,
): Promise<SpotMeta> {
  const cached = spotMetaCache.get(fetchLike);
  if (cached && now() - cached.at < SPOT_META_TTL_MS) return cached.value;
  const value = postInfo(fetchLike, { type: 'spotMeta' }, signal).then(parseSpotMeta);
  spotMetaCache.set(fetchLike, { at: now(), value });
  value.catch(() => spotMetaCache.delete(fetchLike));
  return value;
}

export function hyperliquidProvider(options: {
  usdToEur: UsdToEur;
  fetch?: FetchLike;
}): PriceProvider {
  const doFetch = options.fetch ?? defaultFetch;

  return {
    name: 'Hyperliquid',
    async fetchPrices(codes, signal) {
      const found = new Map<AssetCode, PriceQuoteInput>();
      if (codes.length === 0) return found;
      const [mids, meta] = await Promise.all([
        postInfo(doFetch, { type: 'allMids' }, signal).then(parseAllMids),
        spotMeta(doFetch, signal),
      ]);
      const at = nowIso();
      for (const code of codes) {
        const upper = code.toUpperCase();
        const midKey = spotMidKey(meta, upper) ?? upper; // spot USDC en priorité, sinon perp
        const rawMid = mids[midKey];
        if (rawMid === undefined) continue;
        const priceUsd = numberToDecimal(rawMid);
        if (priceUsd === null) continue;
        const priceEur = options.usdToEur(priceUsd);
        if (priceEur === null) continue;
        const big = parseDecimal(priceEur);
        if (big === null || !isPositive(big)) continue;
        found.set(code, {
          asset: code,
          priceEur: toDecimalString(big),
          at,
          source: 'Hyperliquid',
          stale: false,
        });
      }
      return found;
    },
  };
}

/** Accès partagés pour le mode « prix live » (P26) : même résolution que le fournisseur. */
export { spotMeta as hlSpotMeta, spotMidKey as hlSpotMidKey };
export type { SpotMeta as HlMidsMeta };
