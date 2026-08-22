/** Classification des actifs : monnaie fiat (cash), stablecoin, crypto. */
import type { AssetCode } from './types';

export type AssetClass = 'fiat' | 'stablecoin' | 'crypto';

const FIAT: ReadonlySet<AssetCode> = new Set(['eur', 'usd', 'gbp', 'chf']);

/** Stablecoins connus (USD et EUR). Les EUR-stables ont un P&L de change ≈ 0. */
const STABLECOINS: ReadonlySet<AssetCode> = new Set([
  'usdc',
  'usdt',
  'dai',
  'usds',
  'pyusd',
  'fdusd',
  'tusd',
  'usde',
  'usdp',
  'gusd',
  'eurc',
  'eurcv',
  'eure',
  'eurs',
  'eurt',
]);

/** Normalise un ticker tel qu'exporté ('BTC ', 'Btc') vers le code interne ('btc'). */
export function normalizeAssetCode(raw: string): AssetCode {
  return raw.trim().toLowerCase();
}

export function assetClass(code: AssetCode): AssetClass {
  if (FIAT.has(code)) return 'fiat';
  if (STABLECOINS.has(code)) return 'stablecoin';
  return 'crypto';
}

export function isFiat(code: AssetCode): boolean {
  return FIAT.has(code);
}

export function isStablecoin(code: AssetCode): boolean {
  return STABLECOINS.has(code);
}

/** Vrai pour les actifs qui servent de contrepartie « cash-like » dans une opération. */
export function isCashLike(code: AssetCode): boolean {
  return isFiat(code) || isStablecoin(code);
}
