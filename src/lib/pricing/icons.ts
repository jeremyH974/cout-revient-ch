/**
 * Logos embarqués dans `public/icons/<ticker>.svg` (même origine : compatibles avec la CSP
 * `img-src 'self'`, aucune requête vers un tiers). La liste évite une requête 404 quand aucun
 * logo n'existe : `CoinBadge` retombe alors sur les initiales. Voir `public/icons/LICENSE.md`.
 */
import type { AssetCode } from '../domain/types';

export const KNOWN_ICONS: ReadonlySet<string> = new Set([
  'aave',
  'ada',
  'algo',
  'ape',
  'apt',
  'arb',
  'atom',
  'avax',
  'axs',
  'bal',
  'bat',
  'bch',
  'btc',
  'chz',
  'crv',
  'dai',
  'doge',
  'dot',
  'dydx',
  'egld',
  'enj',
  'ens',
  'eos',
  'eth',
  'eurc',
  'fet',
  'gmx',
  'gno',
  'inj',
  'ksm',
  'ldo',
  'link',
  'lrc',
  'ltc',
  'mana',
  'matic',
  'mkr',
  'near',
  'op',
  'paxg',
  'pepe',
  'pol',
  'render',
  'sand',
  'shib',
  'snx',
  'sol',
  'sui',
  'sushi',
  'tao',
  'theta',
  'tia',
  'ton',
  'trx',
  'uni',
  'usdc',
  'usdt',
  'vet',
  'xlm',
  'xrp',
  'xtz',
  'yfi',
]);

/** URL (même origine, sous `BASE_URL`) du logo d'un actif, ou `null` s'il n'en existe pas. */
export function iconUrl(asset: AssetCode): string | null {
  const code = asset.toLowerCase();
  return KNOWN_ICONS.has(code) ? `${import.meta.env.BASE_URL}icons/${code}.svg` : null;
}
