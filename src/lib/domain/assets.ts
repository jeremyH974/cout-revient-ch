/** Classification des actifs : monnaie fiat (cash), stablecoin, crypto, titre. */
import type { AssetCode } from './types';

export type AssetClass = 'fiat' | 'stablecoin' | 'crypto' | 'equity';

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
 * Marque des codes de titres (actions, ETF). La classe d'un actif est une **donnée portée par son
 * code**, jamais déduite du seul ticker : sans elle, `sol` (Solana) et `SOL` (Emeren Group, NYSE)
 * partageraient une même position, donc un même PRU. Le deux-points est sûr comme séparateur —
 * aucun ticker n'en contient, et aucune clé du domaine n'est découpée dessus. Décision n° 103.
 */
const EQUITY_PREFIX = 'eq:';

/** Normalise un ticker tel qu'exporté ('BTC ', 'Btc') vers le code interne ('btc'). */
export function normalizeAssetCode(raw: string): AssetCode {
  return raw.trim().toLowerCase();
}

/**
 * Code interne d'un titre, depuis son symbole d'origine ('AAPL' → 'eq:aapl'). Idempotent : un code
 * déjà marqué est rendu tel quel. Lève sur un symbole vide — c'est un invariant de construction,
 * un import qualifie ses lignes avant d'en fabriquer un code.
 */
export function equityCode(symbol: string): AssetCode {
  const bare = normalizeAssetCode(symbol);
  if (bare === '') throw new Error('Code de titre vide : symbole absent');
  return bare.startsWith(EQUITY_PREFIX) ? bare : `${EQUITY_PREFIX}${bare}`;
}

/** Vrai pour un code de titre. Un ticker crypto nommé 'eq' n'en est pas un (le séparateur manque). */
export function isEquityCode(code: AssetCode): boolean {
  return code.startsWith(EQUITY_PREFIX) && code.length > EQUITY_PREFIX.length;
}

/** Symbole nu, pour l'affichage : 'eq:aapl' → 'aapl', 'btc' → 'btc'. */
export function assetSymbol(code: AssetCode): string {
  return isEquityCode(code) ? code.slice(EQUITY_PREFIX.length) : code;
}

/**
 * Équivalent fiat d'une devise « cash » : 'eur' (euro et stables euro), 'usd' (dollar et stables
 * dollar, décision n° 18), null pour tout le reste (gbp/chf inclus : pas de taux BCE en cache).
 */
export function fiatEquivalent(code: AssetCode): 'eur' | 'usd' | null {
  if (code === 'eur' || EUR_STABLECOINS.has(code)) return 'eur';
  if (code === 'usd' || STABLECOINS.has(code)) return 'usd';
  return null;
}

export function assetClass(code: AssetCode): AssetClass {
  if (isEquityCode(code)) return 'equity';
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
