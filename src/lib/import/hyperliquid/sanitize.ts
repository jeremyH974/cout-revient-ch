/**
 * Assainissement du conteneur `hyperliquid` d'une sauvegarde (éditée à la main, version future) :
 * chaque brut invalide est écarté plutôt que de faire planter le moteur ; les fills repassent par
 * la garde de l'API (`parseFill`), le reste est vérifié champ par champ.
 */
import { numberToDecimal } from '../../pricing/types';
import {
  HL_ADDRESS,
  parseFill,
  parsePortfolio,
  type HlClearinghouse,
  type HlFunding,
  type HlLedgerUpdate,
  type HlPerpPosition,
  type HlSpotBalance,
} from './api-types';
import { emptyHlState, type HlAccountData, type HlSnapshot, type HlState } from './data';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const dec = (v: unknown): string | null => numberToDecimal(v);
const decOr = (v: unknown, fallback: string): string => dec(v) ?? fallback;
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function sanitizeFunding(raw: unknown): HlFunding | null {
  if (!isRecord(raw)) return null;
  const time = int(raw['time']);
  const usdc = dec(raw['usdc']);
  if (time === null || usdc === null || typeof raw['coin'] !== 'string') return null;
  return {
    time,
    hash: str(raw['hash']),
    coin: raw['coin'],
    usdc,
    szi: decOr(raw['szi'], '0'),
    fundingRate: decOr(raw['fundingRate'], '0'),
  };
}

function sanitizeLedger(raw: unknown): HlLedgerUpdate | null {
  if (!isRecord(raw)) return null;
  const time = int(raw['time']);
  if (time === null || typeof raw['type'] !== 'string') return null;
  const fields: HlLedgerUpdate['fields'] = {};
  if (isRecord(raw['fields'])) {
    for (const [k, v] of Object.entries(raw['fields'])) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null)
        fields[k] = v;
    }
  }
  return { time, hash: str(raw['hash']), type: raw['type'], fields };
}

function sanitizePosition(raw: unknown): HlPerpPosition | null {
  if (!isRecord(raw) || typeof raw['coin'] !== 'string') return null;
  const szi = dec(raw['szi']);
  if (szi === null) return null;
  const lev = isRecord(raw['leverage']) ? raw['leverage'] : {};
  const cf = isRecord(raw['cumFunding']) ? raw['cumFunding'] : null;
  return {
    coin: raw['coin'],
    szi,
    entryPx: dec(raw['entryPx']),
    positionValue: decOr(raw['positionValue'], '0'),
    unrealizedPnl: decOr(raw['unrealizedPnl'], '0'),
    returnOnEquity: dec(raw['returnOnEquity']),
    liquidationPx: dec(raw['liquidationPx']),
    marginUsed: decOr(raw['marginUsed'], '0'),
    leverage: {
      type: lev['type'] === 'isolated' ? 'isolated' : 'cross',
      value: int(lev['value']) ?? 1,
    },
    maxLeverage: int(raw['maxLeverage']),
    cumFunding: cf
      ? {
          allTime: decOr(cf['allTime'], '0'),
          sinceOpen: decOr(cf['sinceOpen'], '0'),
          sinceChange: decOr(cf['sinceChange'], '0'),
        }
      : null,
  };
}

function sanitizeSnapshot(raw: unknown): HlSnapshot | null {
  if (!isRecord(raw) || typeof raw['at'] !== 'string' || !isRecord(raw['perps'])) return null;
  const p = raw['perps'];
  const accountValue = dec(p['accountValue']);
  if (accountValue === null) return null;
  const positions: HlPerpPosition[] = [];
  for (const item of Array.isArray(p['positions']) ? p['positions'] : []) {
    const position = sanitizePosition(item);
    if (position) positions.push(position);
  }
  const perps: HlClearinghouse = {
    accountValue,
    totalNtlPos: decOr(p['totalNtlPos'], '0'),
    totalRawUsd: decOr(p['totalRawUsd'], '0'),
    totalMarginUsed: decOr(p['totalMarginUsed'], '0'),
    withdrawable: decOr(p['withdrawable'], '0'),
    positions,
    time: int(p['time']) ?? 0,
  };
  const spot: HlSpotBalance[] = [];
  for (const item of Array.isArray(raw['spot']) ? raw['spot'] : []) {
    if (!isRecord(item) || typeof item['coin'] !== 'string') continue;
    const total = dec(item['total']);
    if (total === null) continue;
    spot.push({
      coin: item['coin'],
      token: int(item['token']) ?? -1,
      total,
      hold: decOr(item['hold'], '0'),
      entryNtl: decOr(item['entryNtl'], '0'),
    });
  }
  return { at: raw['at'], perps, spot };
}

/** Compte Hyperliquid d'une sauvegarde ; `null` si l'adresse est invalide. `dropped` = bruts écartés. */
export function sanitizeHlAccount(raw: unknown): { data: HlAccountData; dropped: number } | null {
  if (!isRecord(raw) || typeof raw['address'] !== 'string' || !HL_ADDRESS.test(raw['address']))
    return null;
  let dropped = 0;
  const fills: HlAccountData['fills'] = {};
  for (const item of Object.values(isRecord(raw['fills']) ? raw['fills'] : {})) {
    const fill = parseFill(item);
    if (fill) fills[fill.tid] = fill;
    else dropped++;
  }
  const funding: HlAccountData['funding'] = {};
  for (const [key, item] of Object.entries(isRecord(raw['funding']) ? raw['funding'] : {})) {
    const entry = sanitizeFunding(item);
    if (entry) funding[key] = entry;
    else dropped++;
  }
  const ledger: HlAccountData['ledger'] = {};
  for (const [key, item] of Object.entries(isRecord(raw['ledger']) ? raw['ledger'] : {})) {
    const entry = sanitizeLedger(item);
    if (entry) ledger[key] = entry;
    else dropped++;
  }
  const cursors = isRecord(raw['cursors']) ? raw['cursors'] : {};
  return {
    data: {
      address: raw['address'].toLowerCase(),
      fills,
      funding,
      ledger,
      cursors: {
        fills: int(cursors['fills']),
        funding: int(cursors['funding']),
        ledger: int(cursors['ledger']),
      },
      snapshot: sanitizeSnapshot(raw['snapshot']),
      portfolio: isRecord(raw['portfolio'])
        ? parsePortfolio(Object.entries(raw['portfolio']))
        : null,
      lastSyncAt: typeof raw['lastSyncAt'] === 'string' ? raw['lastSyncAt'] : null,
    },
    dropped,
  };
}

export function sanitizeHlState(raw: unknown): { state: HlState; dropped: number } {
  const state = emptyHlState();
  let dropped = 0;
  if (!isRecord(raw)) return { state, dropped };
  for (const [id, item] of Object.entries(isRecord(raw['accounts']) ? raw['accounts'] : {})) {
    const result = sanitizeHlAccount(item);
    if (result && id === `hl:${result.data.address}`) {
      state.accounts[id] = result.data;
      dropped += result.dropped;
    } else dropped++;
  }
  for (const [name, item] of Object.entries(isRecord(raw['spotPairs']) ? raw['spotPairs'] : {})) {
    if (isRecord(item) && typeof item['base'] === 'string' && typeof item['quote'] === 'string')
      state.spotPairs[name] = { base: item['base'], quote: item['quote'] };
  }
  return { state, dropped };
}
