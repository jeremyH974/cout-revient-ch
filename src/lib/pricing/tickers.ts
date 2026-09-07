/**
 * Table curée ticker Coinhouse → identifiants des fournisseurs de prix.
 * Les symboles CoinGecko ne sont pas uniques : on passe toujours par l'id.
 * Un ticker absent d'ici n'a pas de prix automatique (saisie manuelle ou id dans les réglages).
 */
import type { AssetCode } from '../domain/types';
import { GENERATED_TICKERS } from './tickers.generated';

export interface TickerInfo {
  name: string;
  coingeckoId: string | null;
  coinbase: string | null;
}

const T = (
  name: string,
  coingeckoId: string | null,
  coinbase: string | null = null,
): TickerInfo => ({ name, coingeckoId, coinbase });

/**
 * Table **curée**, écrite et relue à la main. Elle porte des décisions qu'aucune génération ne doit
 * écraser : `eurcv` sans identifiant parce qu'il est ancré à l'euro, `wif` → `dogwifcoin` là où le
 * symbole ne suffit pas, et les symboles Coinbase et Kraken que CoinGecko ne connaît pas.
 */
export const CURATED_TICKERS: Record<AssetCode, TickerInfo> = {
  aave: T('Aave', 'aave', 'AAVE'),
  ada: T('Cardano', 'cardano', 'ADA'),
  algo: T('Algorand', 'algorand', 'ALGO'),
  ape: T('ApeCoin', 'apecoin', 'APE'),
  apt: T('Aptos', 'aptos', 'APT'),
  arb: T('Arbitrum', 'arbitrum', 'ARB'),
  atom: T('Cosmos', 'cosmos', 'ATOM'),
  avax: T('Avalanche', 'avalanche-2', 'AVAX'),
  axs: T('Axie Infinity', 'axie-infinity', 'AXS'),
  bal: T('Balancer', 'balancer', 'BAL'),
  bat: T('Basic Attention Token', 'basic-attention-token', 'BAT'),
  bch: T('Bitcoin Cash', 'bitcoin-cash', 'BCH'),
  bonk: T('Bonk', 'bonk', 'BONK'),
  btc: T('Bitcoin', 'bitcoin', 'BTC'),
  chz: T('Chiliz', 'chiliz', 'CHZ'),
  crv: T('Curve DAO', 'curve-dao-token', 'CRV'),
  dai: T('Dai', 'dai', 'DAI'),
  doge: T('Dogecoin', 'dogecoin', 'DOGE'),
  dot: T('Polkadot', 'polkadot', 'DOT'),
  dydx: T('dYdX', 'dydx-chain', 'DYDX'),
  egld: T('MultiversX', 'elrond-erd-2', 'EGLD'),
  enj: T('Enjin Coin', 'enjincoin', 'ENJ'),
  ens: T('Ethereum Name Service', 'ethereum-name-service', 'ENS'),
  eos: T('EOS', 'eos', 'EOS'),
  eth: T('Ethereum', 'ethereum', 'ETH'),
  eurc: T('Euro Coin', 'euro-coin', 'EURC'),
  eurcv: T('EUR CoinVertible', null, null),
  fet: T('Fetch.ai', 'fetch-ai', 'FET'),
  floki: T('Floki', 'floki', 'FLOKI'),
  gmx: T('GMX', 'gmx', null),
  gno: T('Gnosis', 'gnosis', 'GNO'),
  hype: T('Hyperliquid', 'hyperliquid', 'HYPE'),
  inj: T('Injective', 'injective-protocol', 'INJ'),
  ksm: T('Kusama', 'kusama', 'KSM'),
  ldo: T('Lido DAO', 'lido-dao', 'LDO'),
  link: T('Chainlink', 'chainlink', 'LINK'),
  lrc: T('Loopring', 'loopring', 'LRC'),
  ltc: T('Litecoin', 'litecoin', 'LTC'),
  mana: T('Decentraland', 'decentraland', 'MANA'),
  matic: T('Polygon (MATIC)', 'matic-network', 'MATIC'),
  mkr: T('Maker', 'maker', 'MKR'),
  near: T('NEAR Protocol', 'near', 'NEAR'),
  ondo: T('Ondo', 'ondo-finance', 'ONDO'),
  op: T('Optimism', 'optimism', 'OP'),
  paxg: T('Pax Gold', 'pax-gold', 'PAXG'),
  pepe: T('Pepe', 'pepe', 'PEPE'),
  pol: T('Polygon', 'polygon-ecosystem-token', 'POL'),
  render: T('Render', 'render-token', 'RENDER'),
  sand: T('The Sandbox', 'the-sandbox', 'SAND'),
  shib: T('Shiba Inu', 'shiba-inu', 'SHIB'),
  sky: T('Sky', 'sky', 'SKY'),
  snx: T('Synthetix', 'havven', 'SNX'),
  sol: T('Solana', 'solana', 'SOL'),
  sui: T('Sui', 'sui', 'SUI'),
  sushi: T('SushiSwap', 'sushi', 'SUSHI'),
  tao: T('Bittensor', 'bittensor', 'TAO'),
  theta: T('Theta Network', 'theta-token', 'THETA'),
  tia: T('Celestia', 'celestia', 'TIA'),
  ton: T('Toncoin', 'the-open-network', 'TON'),
  trx: T('TRON', 'tron', 'TRX'),
  uni: T('Uniswap', 'uniswap', 'UNI'),
  usdc: T('USD Coin', 'usd-coin', 'USDC'),
  usds: T('USDS', 'usds', 'USDS'),
  usdt: T('Tether', 'tether', 'USDT'),
  vet: T('VeChain', 'vechain', 'VET'),
  wif: T('dogwifhat', 'dogwifcoin', 'WIF'),
  xlm: T('Stellar', 'stellar', 'XLM'),
  xrp: T('XRP', 'ripple', 'XRP'),
  xtz: T('Tezos', 'tezos', 'XTZ'),
  yfi: T('yearn.finance', 'yearn-finance', 'YFI'),
};

/**
 * Table effective : la couverture générée d'abord, la table curée **par-dessus**. L'ordre compte —
 * une entrée curée gagne toujours, y compris quand la génération propose autre chose pour le même
 * symbole. `tickers.test.ts` le vérifie, sans quoi une régénération effacerait silencieusement une
 * décision prise à la main.
 *
 * Un ticker absent des deux n'a pas de prix automatique : l'utilisateur peut forcer son identifiant
 * CoinGecko depuis la fiche actif. C'est délibéré — un symbole ambigu ne reçoit AUCUN identifiant,
 * parce qu'un prix faux est pire qu'un prix absent.
 */
export const TICKERS: Record<AssetCode, TickerInfo> = {
  ...GENERATED_TICKERS,
  ...CURATED_TICKERS,
};

/** Stablecoins euro : 1 € par construction quand aucun fournisseur ne cote. */
export const EUR_PEGGED: ReadonlySet<AssetCode> = new Set([
  'eurcv',
  'eurc',
  'eure',
  'eurs',
  'eurt',
]);

export function tickerInfo(code: AssetCode): TickerInfo | null {
  return TICKERS[code] ?? null;
}

export function assetName(code: AssetCode): string {
  return TICKERS[code]?.name ?? code.toUpperCase();
}

/**
 * Index inverse **nom → code**, construit une fois. eToro nomme ses actifs (« Bitcoin »,
 * « Ethereum ») là où le moteur les code (`btc`, `eth`) : sans cette résolution, un bitcoin
 * importé d'eToro formerait une position distincte de celui de Coinhouse, et l'assiette du
 * 150 VH bis — qui se calcule sur le portefeuille entier — serait fausse en silence.
 *
 * Un nom porté par deux codes ne résout vers **aucun** : un rapprochement faux coûterait plus cher
 * qu'une ligne à qualifier à la main (même règle que la décision n° 54 pour les prix).
 */
const normalizeAssetName = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, ' ');

const CODE_BY_NAME: Readonly<Record<string, AssetCode | null>> = (() => {
  const index: Record<string, AssetCode | null> = {};
  for (const [code, info] of Object.entries(TICKERS)) {
    const key = normalizeAssetName(info.name);
    index[key] = key in index ? null : code;
  }
  return index;
})();

/** Code d'un actif d'après son nom commercial ; `null` si inconnu ou ambigu. */
export function codeByName(name: string): AssetCode | null {
  return CODE_BY_NAME[normalizeAssetName(name)] ?? null;
}
