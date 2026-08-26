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
  ['bonk', 'disponible sous MIT dans @web3icons/core — à intégrer'],
  ['floki', 'disponible sous MIT dans @web3icons/core — à intégrer'],
  ['ondo', 'disponible sous MIT dans @web3icons/core — à intégrer'],
  ['wif', 'disponible sous MIT dans @web3icons/core — à intégrer'],
  ['eurcv', 'absent de @web3icons/core — kit de marque officiel à obtenir, licence à vérifier'],
  ['hype', 'absent de @web3icons/core — kit de marque officiel à obtenir, licence à vérifier'],
  ['sky', 'absent de @web3icons/core — kit de marque officiel à obtenir, licence à vérifier'],
  ['usds', 'absent de @web3icons/core — kit de marque officiel à obtenir, licence à vérifier'],
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
