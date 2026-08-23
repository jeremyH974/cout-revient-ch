/**
 * Réponses de `POST https://api.hyperliquid.xyz/info` (lecture seule, sans clé) telles que
 * l'application les conserve : chaînes décimales intactes (`px`, `sz`, `fee`, `closedPnl`…),
 * millisecondes UTC (`time`), jamais de `number` pour un montant. Chaque garde runtime
 * (`parse*`) vérifie champ par champ et écarte silencieusement les éléments inattendus : le
 * contrat de l'API n'est pas versionné, l'app ne suppose rien (docs/hyperliquid-import.md).
 */
import { numberToDecimal } from '../../pricing/types';
import type { DecimalString } from '../../domain/types';

export const HL_INFO_ENDPOINT = 'https://api.hyperliquid.xyz/info';
/** Une adresse EVM publique : `0x` + 40 hexadécimaux (normalisée en minuscules). */
export const HL_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const normalizeAddress = (address: string): string | null => {
  const trimmed = address.trim();
  return HL_ADDRESS.test(trimmed) ? trimmed.toLowerCase() : null;
};

/** Fill (exécution) spot ou perp, conservé tel quel ; clé de dédoublonnage = `tid`. */
export interface HlFill {
  /** Perp : `BTC` ; spot : `PURR/USDC` (paire canonique) ou `@107` (index d'univers). */
  coin: string;
  px: DecimalString;
  sz: DecimalString;
  /** `B` = achat (bid), `A` = vente (ask). */
  side: 'A' | 'B';
  /** Millisecondes UTC. */
  time: number;
  /** Position signée AVANT le fill (négative = short). */
  startPosition: DecimalString;
  /** `Open Long`, `Close Short`, `Long > Short`, `Buy`, `Sell`, `Liquidated …`… (affichage). */
  dir: string;
  /** Réalisé par ce fill, BRUT de frais (0 à l'ouverture). */
  closedPnl: DecimalString;
  hash: string;
  oid: string;
  /** true = taker. */
  crossed: boolean;
  /** Frais en `feeToken` ; négatif = rebate maker. `builderFee` (si présent) est déjà inclus. */
  fee: DecimalString;
  tid: string;
  feeToken: string;
  builderFee: DecimalString | null;
  liquidation: { liquidatedUser: string; markPx: DecimalString; method: string } | null;
  twapId: string | null;
}

/** Paiement de funding (perps) : `usdc` signé (négatif = payé). */
export interface HlFunding {
  time: number;
  hash: string;
  coin: string;
  usdc: DecimalString;
  szi: DecimalString;
  fundingRate: DecimalString;
}

/**
 * Mouvement du grand livre hors funding : dépôt, retrait, transfert spot ↔ perp, transfert
 * interne, vault, liquidation… `type` brut + champs primitifs conservés (sans interprétation),
 * l'interprétation vit dans `normalize.ts` et ignore ce qu'elle ne connaît pas.
 */
export interface HlLedgerUpdate {
  time: number;
  hash: string;
  type: string;
  fields: Record<string, string | number | boolean | null>;
}

export interface HlPerpPosition {
  coin: string;
  /** Taille signée (négative = short). */
  szi: DecimalString;
  entryPx: DecimalString | null;
  positionValue: DecimalString;
  unrealizedPnl: DecimalString;
  returnOnEquity: DecimalString | null;
  liquidationPx: DecimalString | null;
  marginUsed: DecimalString;
  leverage: { type: 'cross' | 'isolated'; value: number };
  maxLeverage: number | null;
  cumFunding: {
    allTime: DecimalString;
    sinceOpen: DecimalString;
    sinceChange: DecimalString;
  } | null;
}

/** Résumé de `clearinghouseState` (compte perps). */
export interface HlClearinghouse {
  accountValue: DecimalString;
  totalNtlPos: DecimalString;
  totalRawUsd: DecimalString;
  totalMarginUsed: DecimalString;
  withdrawable: DecimalString;
  positions: HlPerpPosition[];
  time: number;
}

export interface HlSpotBalance {
  coin: string;
  token: number;
  total: DecimalString;
  hold: DecimalString;
  entryNtl: DecimalString;
}

export interface HlSpotToken {
  name: string;
  index: number;
}

export interface HlSpotPair {
  /** `PURR/USDC`, `@107`… tel qu'il apparaît dans `coin` des fills et dans `allMids`. */
  name: string;
  index: number;
  base: string;
  quote: string;
  isCanonical: boolean;
}

export interface HlSpotMeta {
  tokens: HlSpotToken[];
  pairs: HlSpotPair[];
}

/** Série `portfolio` d'une période : tuples `[ms UTC, valeur décimale]`. */
export interface HlPortfolioSeries {
  accountValueHistory: [number, DecimalString][];
  pnlHistory: [number, DecimalString][];
}

/** Réponse `portfolio` : une série par période (`day`, `week`, `month`, `allTime`, `perp*`). */
export type HlPortfolio = Record<string, HlPortfolioSeries>;

// --- Gardes runtime -------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const dec = (v: unknown): DecimalString | null => numberToDecimal(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Identifiants numériques (`tid`, `oid`) conservés en chaîne ; les chaînes sont acceptées. */
const id = (v: unknown): string | null =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v : null;

export function parseFill(raw: unknown): HlFill | null {
  if (!isRecord(raw)) return null;
  const coin = str(raw['coin']);
  const px = dec(raw['px']);
  const sz = dec(raw['sz']);
  const side = raw['side'];
  const time = int(raw['time']);
  const startPosition = dec(raw['startPosition']);
  const closedPnl = dec(raw['closedPnl']);
  const fee = dec(raw['fee']);
  const tid = id(raw['tid']);
  if (
    coin === null ||
    px === null ||
    sz === null ||
    (side !== 'A' && side !== 'B') ||
    time === null ||
    startPosition === null ||
    closedPnl === null ||
    fee === null ||
    tid === null
  )
    return null;
  const liq = isRecord(raw['liquidation']) ? raw['liquidation'] : null;
  return {
    coin,
    px,
    sz,
    side,
    time,
    startPosition,
    dir: str(raw['dir']) ?? '',
    closedPnl,
    hash: str(raw['hash']) ?? '',
    oid: id(raw['oid']) ?? '',
    crossed: raw['crossed'] === true,
    fee,
    tid,
    feeToken: str(raw['feeToken']) ?? 'USDC',
    builderFee: dec(raw['builderFee']),
    liquidation: liq
      ? {
          liquidatedUser: str(liq['liquidatedUser']) ?? '',
          markPx: dec(liq['markPx']) ?? '0',
          method: str(liq['method']) ?? '',
        }
      : null,
    twapId: id(raw['twapId']),
  };
}

export function parseFills(body: unknown): HlFill[] {
  if (!Array.isArray(body)) return [];
  const fills: HlFill[] = [];
  for (const item of body) {
    const fill = parseFill(item);
    if (fill) fills.push(fill);
  }
  return fills;
}

export function parseFunding(body: unknown): HlFunding[] {
  if (!Array.isArray(body)) return [];
  const entries: HlFunding[] = [];
  for (const item of body) {
    if (!isRecord(item) || !isRecord(item['delta'])) continue;
    const delta = item['delta'];
    const time = int(item['time']);
    const coin = str(delta['coin']);
    const usdc = dec(delta['usdc']);
    if (time === null || coin === null || usdc === null) continue;
    entries.push({
      time,
      hash: str(item['hash']) ?? '',
      coin,
      usdc,
      szi: dec(delta['szi']) ?? '0',
      fundingRate: dec(delta['fundingRate']) ?? '0',
    });
  }
  return entries;
}

export function parseLedger(body: unknown): HlLedgerUpdate[] {
  if (!Array.isArray(body)) return [];
  const entries: HlLedgerUpdate[] = [];
  for (const item of body) {
    if (!isRecord(item) || !isRecord(item['delta'])) continue;
    const delta = item['delta'];
    const time = int(item['time']);
    const type = str(delta['type']);
    if (time === null || type === null) continue;
    const fields: HlLedgerUpdate['fields'] = {};
    for (const [key, value] of Object.entries(delta)) {
      if (key === 'type') continue;
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null
      )
        fields[key] = value;
      else if (Array.isArray(value) || isRecord(value)) fields[key] = JSON.stringify(value);
    }
    entries.push({ time, hash: str(item['hash']) ?? '', type, fields });
  }
  return entries;
}

function parsePosition(raw: unknown): HlPerpPosition | null {
  if (!isRecord(raw) || !isRecord(raw['position'])) return null;
  const p = raw['position'];
  const coin = str(p['coin']);
  const szi = dec(p['szi']);
  if (coin === null || szi === null) return null;
  const lev = isRecord(p['leverage']) ? p['leverage'] : {};
  const cf = isRecord(p['cumFunding']) ? p['cumFunding'] : null;
  return {
    coin,
    szi,
    entryPx: dec(p['entryPx']),
    positionValue: dec(p['positionValue']) ?? '0',
    unrealizedPnl: dec(p['unrealizedPnl']) ?? '0',
    returnOnEquity: dec(p['returnOnEquity']),
    liquidationPx: dec(p['liquidationPx']),
    marginUsed: dec(p['marginUsed']) ?? '0',
    leverage: {
      type: lev['type'] === 'isolated' ? 'isolated' : 'cross',
      value: int(lev['value']) ?? 1,
    },
    maxLeverage: int(p['maxLeverage']),
    cumFunding: cf
      ? {
          allTime: dec(cf['allTime']) ?? '0',
          sinceOpen: dec(cf['sinceOpen']) ?? '0',
          sinceChange: dec(cf['sinceChange']) ?? '0',
        }
      : null,
  };
}

export function parseClearinghouse(body: unknown): HlClearinghouse | null {
  if (!isRecord(body) || !isRecord(body['marginSummary'])) return null;
  const m = body['marginSummary'];
  const accountValue = dec(m['accountValue']);
  if (accountValue === null) return null;
  const positions: HlPerpPosition[] = [];
  for (const item of Array.isArray(body['assetPositions']) ? body['assetPositions'] : []) {
    const position = parsePosition(item);
    if (position) positions.push(position);
  }
  return {
    accountValue,
    totalNtlPos: dec(m['totalNtlPos']) ?? '0',
    totalRawUsd: dec(m['totalRawUsd']) ?? '0',
    totalMarginUsed: dec(m['totalMarginUsed']) ?? '0',
    withdrawable: dec(body['withdrawable']) ?? '0',
    positions,
    time: int(body['time']) ?? 0,
  };
}

export function parseSpotClearinghouse(body: unknown): HlSpotBalance[] {
  if (!isRecord(body) || !Array.isArray(body['balances'])) return [];
  const balances: HlSpotBalance[] = [];
  for (const item of body['balances']) {
    if (!isRecord(item)) continue;
    const coin = str(item['coin']);
    const total = dec(item['total']);
    if (coin === null || total === null) continue;
    balances.push({
      coin,
      token: int(item['token']) ?? -1,
      total,
      hold: dec(item['hold']) ?? '0',
      entryNtl: dec(item['entryNtl']) ?? '0',
    });
  }
  return balances;
}

export function parseSpotMeta(body: unknown): HlSpotMeta {
  const tokens: HlSpotToken[] = [];
  const pairs: HlSpotPair[] = [];
  if (!isRecord(body)) return { tokens, pairs };
  for (const item of Array.isArray(body['tokens']) ? body['tokens'] : []) {
    if (!isRecord(item)) continue;
    const name = str(item['name']);
    const index = int(item['index']);
    if (name !== null && index !== null) tokens.push({ name, index });
  }
  const byIndex = new Map(tokens.map((t) => [t.index, t.name]));
  for (const item of Array.isArray(body['universe']) ? body['universe'] : []) {
    if (!isRecord(item) || !Array.isArray(item['tokens'])) continue;
    const [a, b] = item['tokens'] as unknown[];
    const name = str(item['name']);
    const index = int(item['index']);
    const base = typeof a === 'number' ? byIndex.get(a) : undefined;
    const quote = typeof b === 'number' ? byIndex.get(b) : undefined;
    if (name === null || index === null || base === undefined || quote === undefined) continue;
    pairs.push({ name, index, base, quote, isCanonical: item['isCanonical'] === true });
  }
  return { tokens, pairs };
}

function parseSeries(raw: unknown): [number, DecimalString][] {
  if (!Array.isArray(raw)) return [];
  const points: [number, DecimalString][] = [];
  for (const item of raw) {
    if (!Array.isArray(item)) continue;
    const time = int(item[0]);
    const value = dec(item[1]);
    if (time !== null && value !== null) points.push([time, value]);
  }
  return points.sort((a, b) => a[0] - b[0]);
}

/** `portfolio` : tableau de tuples `[période, données]` → séries par période (invalide écarté). */
export function parsePortfolio(body: unknown): HlPortfolio {
  const result: HlPortfolio = {};
  if (!Array.isArray(body)) return result;
  for (const item of body) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || !isRecord(item[1])) continue;
    result[item[0]] = {
      accountValueHistory: parseSeries(item[1]['accountValueHistory']),
      pnlHistory: parseSeries(item[1]['pnlHistory']),
    };
  }
  return result;
}

/** Paire spot d'un `coin` de fill (`PURR/USDC`, `@107`) → jetons base/quote, ou `null` (perp). */
export function resolveSpotPair(
  coin: string,
  pairs: readonly Pick<HlSpotPair, 'name' | 'base' | 'quote'>[],
): { base: string; quote: string } | null {
  const pair = pairs.find((p) => p.name === coin);
  if (pair) return { base: pair.base, quote: pair.quote };
  const slash = coin.indexOf('/');
  if (slash > 0) return { base: coin.slice(0, slash), quote: coin.slice(slash + 1) };
  return null;
}

/** Un fill est spot si son `coin` est une paire (`X/Y`) ou un index d'univers (`@n`). */
export const isSpotCoin = (coin: string): boolean => coin.includes('/') || coin.startsWith('@');
