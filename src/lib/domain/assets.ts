/** Classification des actifs : monnaie fiat (cash), stablecoin, crypto. */
import type { AssetCode } from './types';

export type AssetClass = 'fiat' | 'stablecoin' | 'crypto';

const FIAT: ReadonlySet<AssetCode> = new Set(['eur', 'usd', 'gbp', 'chf']);

/** Stablecoins adossés à l'euro : P&L de change ≈ 0, valorisables 1:1. */
const EUR_STABLECOINS: ReadonlySet<AssetCode> = new Set(['eurc', 'eurcv', 'eure', 'eurs', 'eurt']);

/** Stablecoins connus (USD et EUR). */
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
  ...EUR_STABLECOINS,
]);

/**
 * Équivalent fiat d'une devise « cash » : 'eur' (euro et stables euro), 'usd' (dollar et stables
 * dollar, décision n° 18), null pour tout le reste (gbp/chf inclus : pas de taux BCE en cache).
 */
export function fiatEquivalent(code: AssetCode): 'eur' | 'usd' | null {
  if (code === 'eur' || EUR_STABLECOINS.has(code)) return 'eur';
  if (code === 'usd' || STABLECOINS.has(code)) return 'usd';
  return null;
}

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
