/**
 * Logos embarqués dans `public/icons/<ticker>.svg` (même origine : compatibles avec la CSP
 * `img-src 'self'`, aucune requête vers un tiers). La liste évite une requête 404 quand aucun
 * logo n'existe : `CoinBadge` retombe alors sur les initiales. Voir `public/icons/LICENSE.md`.
 */
import type { AssetCode } from '../domain/types';

export const KNOWN_ICONS: ReadonlySet<string> = new Set([
  '1inch',
  'aave',
  'ada',
  'adi',
  'aioz',
  'akt',
  'algo',
  'ape',
  'apt',
  'ar',
  'arb',
  'arc',
  'ath',
  'atom',
  'avax',
  'axl',
  'axs',
  'bal',
  'bat',
  'bch',
  'bdx',
  'beam',
  'blur',
  'bnb',
  'bsv',
  'btc',
  'btse',
  'cake',
  'cap',
  'celo',
  'cfg',
  'cfx',
  'cheems',
  'chz',
  'ckb',
  'comp',
  'cow',
  'cro',
  'crv',
  'crvusd',
  'cspr',
  'ctc',
  'cusd',
  'dai',
  'dash',
  'data',
  'dbr',
  'dcr',
  'dexe',
  'dgb',
  'dog',
  'doge',
  'dola',
  'dot',
  'dydx',
  'edge',
  'egld',
  'elf',
  'enj',
  'ens',
  'eos',
  'etc',
  'eth',
  'eurc',
  'fdusd',
  'fet',
  'fil',
  'flow',
  'flr',
  'fluid',
  'frax',
  'fun',
  'gala',
  'gas',
  'gcoin',
  'geod',
  'gho',
  'glm',
  'gmx',
  'gno',
  'gram',
  'grt',
  'gt',
  'gusd',
  'hbar',
  'hdx',
  'hot',
  'icp',
  'imx',
  'inj',
  'iota',
  'jasmy',
  'jst',
  'jup',
  'kas',
  'kau',
  'kava',
  'kcs',
  'koge',
  'ksm',
  'ldo',
  'leo',
  'link',
  'lit',
  'lpt',
  'lrc',
  'ltc',
  'lunc',
  'mana',
  'matic',
  'meme',
  'met',
  'meta',
  'metal',
  'mina',
  'mkr',
  'mnt',
  'mog',
  'mx',
  'near',
  'neo',
  'nex',
  'nexo',
  'nmr',
  'npc',
  'nxm',
  'omi',
  'one',
  'ong',
  'ont',
  'op',
  'ordi',
  'ozo',
  'paxg',
  'peaq',
  'pendle',
  'pepe',
  'pi',
  'pol',
  'polyx',
  'popcat',
  'prom',
  'pros',
  'pyth',
  'pyusd',
  'qnt',
  'qrl',
  'qtum',
  'rail',
  'ray',
  'render',
  'req',
  'rif',
  'rlb',
  'rose',
  'rsr',
  'rune',
  'rvn',
  'sand',
  'sei',
  'sfp',
  'shib',
  'shx',
  'snx',
  'sol',
  'soon',
  'spx',
  'strk',
  'stx',
  'sui',
  'sun',
  'sushi',
  'tao',
  'tel',
  'tfuel',
  'theta',
  'tia',
  'ton',
  'toshi',
  'trac',
  'trb',
  'trx',
  'tusd',
  'twt',
  'uni',
  'usdc',
  'usdd',
  'usde',
  'usdt',
  'velo',
  'vet',
  'wbt',
  'wemix',
  'xaut',
  'xdc',
  'xec',
  'xlm',
  'xmr',
  'xno',
  'xpr',
  'xrp',
  'xtz',
  'xvs',
  'xyo',
  'yfi',
  'zano',
  'zec',
  'zen',
  'zig',
  'zil',
  'zrx',
]);

/**
 * Tickers connus **sans** logo embarqué, avec le motif. Sans cette table, un ticker ajouté sans
 * logo se découvre par hasard, sous la forme d'un badge d'initiales, et rien ne dit si c'est un
 * choix ou un oubli. `icons.test.ts` exige que chaque entrée de `TICKERS` soit ici ou dans
 * `KNOWN_ICONS`, jamais dans aucune des deux ni dans les deux.
 *
 * Un logo n'est embarqué que si sa licence permet la redistribution, vérifiée fichier par fichier
 * dans `public/icons/LICENSE.md`. Dans le doute, `CoinBadge` retombe sur les initiales : afficher
 * une marque sans en avoir le droit coûte plus cher qu'un badge sobre.
 */
export const NO_ICON: ReadonlyMap<string, string> = new Map([
  // Vérifié dans le paquet installé (4.0.55), et non sur un listing résumé : aucun des huit n'y
  // figure, sous aucun nom ni aucune variante. Une note antérieure prétendait le contraire pour
  // quatre d'entre eux — elle envoyait chercher des fichiers inexistants.
  [
    'bonk',
    'absent de @web3icons/core 4.0.55 — kit de marque officiel à obtenir, licence à vérifier',
  ],
  [
    'floki',
    'absent de @web3icons/core 4.0.55 — kit de marque officiel à obtenir, licence à vérifier',
  ],
  [
    'ondo',
    'absent de @web3icons/core 4.0.55 — kit de marque officiel à obtenir, licence à vérifier',
  ],
  [
    'wif',
    'absent de @web3icons/core 4.0.55 — kit de marque officiel à obtenir, licence à vérifier',
  ],
  [
    'eurcv',
    'absent de @web3icons/core 4.0.55 — kit de marque officiel à obtenir, licence à vérifier',
  ],
  [
    'hype',
    'absent de @web3icons/core 4.0.55 — kit de marque officiel à obtenir, licence à vérifier',
  ],
  [
    'sky',
    'absent de @web3icons/core 4.0.55 — kit de marque officiel à obtenir, licence à vérifier',
  ],
  [
    'usds',
    'absent de @web3icons/core 4.0.55 — kit de marque officiel à obtenir, licence à vérifier',
  ],
]);

/** URL (même origine, sous `BASE_URL`) du logo d'un actif, ou `null` s'il n'en existe pas. */
export function iconUrl(asset: AssetCode): string | null {
  const code = asset.toLowerCase();
  return KNOWN_ICONS.has(code) ? `${import.meta.env.BASE_URL}icons/${code}.svg` : null;
}

export interface IconFailure {
  asset: string;
  url: string;
  /** Résultat d'une requête de contrôle (statut HTTP et type), ou l'erreur réseau. */
  probe: string;
}

/** Logos qui n'ont pas pu être affichés (après réessai) : lu par le diagnostic copiable. */
export const iconFailures: IconFailure[] = [];

export function recordIconFailure(asset: string, url: string): void {
  if (iconFailures.some((f) => f.asset === asset)) return;
  const failure: IconFailure = { asset, url, probe: 'en cours' };
  iconFailures.push(failure);
  if (typeof fetch !== 'function') {
    failure.probe = 'fetch indisponible';
    return;
  }
  fetch(url, { cache: 'no-store' })
    .then((r) => {
      failure.probe = `${r.status} ${r.headers.get('content-type') ?? 'sans type'}`;
    })
    .catch((error: unknown) => {
      failure.probe = `erreur réseau : ${error instanceof Error ? error.message : String(error)}`;
    });
}
