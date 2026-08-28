/**
 * Les origines externes que l'application connaît, et la Content-Security-Policy qui en découle.
 *
 * Pourquoi une table déclarative plutôt qu'une chaîne écrite à la main dans `vite.config.ts` : la
 * CSP n'est injectée **qu'au build** (GitHub Pages ne permet pas d'en-tête HTTP), donc une origine
 * oubliée fonctionne parfaitement en développement et échoue **en silence** en production.
 *
 * Ce n'est pas une précaution théorique. `https://api.alternative.me` manquait : l'indice Fear &
 * Greed rendait `null` sur le site publié — `loadFearGreed` avale toute erreur par conception — et
 * comme `gateSatisfied` refuse de déclencher une alerte dont il ne peut pas vérifier la moitié des
 * termes, **toute alerte conditionnée au sentiment de marché restait muette**. Rien ne pouvait le
 * voir : les tests unitaires tournent dans Node, `scripts/api-contract.mjs` aussi, et ni l'un ni
 * l'autre n'applique de CSP. Seul le navigateur d'un utilisateur réel bloquait la requête.
 *
 * D'où cette table, et `csp.test.ts` qui la croise avec les origines réellement écrites dans le
 * code livré : **contacter une origine sans l'inscrire ici casse la CI**, exactement comme pour la
 * table des sources et de leurs attributions (`sources.ts`, décision n° 47).
 *
 * Trois usages, jamais confondus :
 *
 * - `connect` — l'app **contacte** cette origine (`fetch` ou WebSocket). Elle doit figurer dans
 *   `connect-src`, sinon le navigateur la bloque sur le site publié.
 * - `link` — l'origine n'apparaît que dans un lien ou un texte affiché. Elle n'a **rien à faire**
 *   dans `connect-src` : l'y inscrire élargirait la surface autorisée sans rien permettre d'utile.
 * - `reserved` — autorisée alors qu'aucun appel ne l'écrit dans le code, pour une raison qui doit
 *   être justifiée sur l'entrée elle-même.
 *
 * Limite connue du croisement : le test lit des littéraux. Une origine assemblée dynamiquement
 * (`https://${chain}.example.com`) lui échappe — d'où la règle de n'écrire que des URL littérales.
 */

export type OriginUse = 'connect' | 'link' | 'reserved';

export interface KnownOrigin {
  /** Schéma + hôte, sans chemin ni barre finale : la forme que `connect-src` compare. */
  origin: string;
  use: OriginUse;
  /** Ce que l'app en fait, en français. Pour `reserved`, c'est la justification. */
  why: string;
}

export const KNOWN_ORIGINS: readonly KnownOrigin[] = [
  // — Cours et taux —
  {
    origin: 'https://api.coingecko.com',
    use: 'connect',
    why: 'Cours du jour et historique sur un an pour la longue traîne des actifs ; également interrogée par le service worker lors de la vérification des alertes, app fermée.',
  },
  {
    origin: 'https://api.coinbase.com',
    use: 'connect',
    why: 'Cours du jour cotés nativement en euros.',
  },
  {
    origin: 'https://api.exchange.coinbase.com',
    use: 'connect',
    why: 'Chandelles quotidiennes pour la courbe de patrimoine.',
  },
  {
    origin: 'https://api.kraken.com',
    use: 'connect',
    why: 'Cours et chandelles, second avis sur les paires en euros.',
  },
  {
    origin: 'https://coins.llama.fi',
    use: 'connect',
    why: 'Cours des actifs absents des places centralisées.',
  },
  {
    origin: 'https://api.frankfurter.dev',
    use: 'connect',
    why: 'Taux de change de référence de la BCE, pour les montants exprimés hors euro.',
  },
  {
    origin: 'https://api.frankfurter.app',
    use: 'reserved',
    why: "Ancien domaine de Frankfurter. Aucun appel ne l'écrit — `frankfurter.ts` ne connaît que `.dev` —, mais l'autorisation est conservée pour qu'une redirection du service ne soit pas bloquée en production, où l'échec serait de nouveau silencieux.",
  },

  // — Trading —
  {
    origin: 'https://api.hyperliquid.xyz',
    use: 'connect',
    why: 'Import et suivi des positions et des exécutions de trading.',
  },
  {
    origin: 'wss://api.hyperliquid.xyz',
    use: 'connect',
    why: 'Flux temps réel des cours de trading.',
  },

  // — Explorateurs de chaînes (import on-chain) —
  {
    origin: 'https://mempool.space',
    use: 'connect',
    why: 'Lecture des soldes et des transactions Bitcoin.',
  },
  {
    origin: 'https://blockstream.info',
    use: 'connect',
    why: 'Second explorateur Bitcoin, en repli du premier.',
  },
  {
    origin: 'https://api.etherscan.io',
    use: 'connect',
    why: 'Lecture des adresses EVM.',
  },
  {
    origin: 'https://api.blockscout.com',
    use: 'connect',
    why: 'Explorateur EVM de repli, point d’entrée multi-chaînes.',
  },
  {
    origin: 'https://eth.blockscout.com',
    use: 'connect',
    why: 'Explorateur EVM de repli, instance Ethereum.',
  },
  {
    origin: 'https://arbitrum.blockscout.com',
    use: 'connect',
    why: 'Explorateur EVM de repli, instance Arbitrum.',
  },
  {
    origin: 'https://base.blockscout.com',
    use: 'connect',
    why: 'Explorateur EVM de repli, instance Base.',
  },
  {
    origin: 'https://api.routescan.io',
    use: 'connect',
    why: 'Explorateur EVM multi-chaînes, troisième avis.',
  },

  // — Contexte de marché —
  {
    origin: 'https://api.alternative.me',
    use: 'connect',
    why: 'Indice Fear & Greed crypto (décision n° 44), derrière un opt-in réseau distinct des prix.',
  },

  // — Origines qui ne sont que des liens ou des mentions affichées —
  {
    origin: 'https://jeremyh974.github.io',
    use: 'link',
    why: 'URL canonique du site publié : liens de partage et métadonnées.',
  },
  { origin: 'https://github.com', use: 'link', why: 'Dépôt du projet.' },
  { origin: 'https://www.coingecko.com', use: 'link', why: 'Crédit de source affiché.' },
  { origin: 'https://www.coinbase.com', use: 'link', why: 'Crédit de source affiché.' },
  { origin: 'https://www.kraken.com', use: 'link', why: 'Crédit de source affiché.' },
  { origin: 'https://defillama.com', use: 'link', why: 'Crédit de source affiché.' },
  { origin: 'https://hyperliquid.xyz', use: 'link', why: 'Crédit de source affiché.' },
  { origin: 'https://frankfurter.dev', use: 'link', why: 'Crédit de source affiché.' },
  {
    origin: 'https://alternative.me',
    use: 'link',
    why: 'Crédit de source affiché, et page de l’indice Fear & Greed.',
  },
  { origin: 'https://etherscan.io', use: 'link', why: 'Crédit de source affiché.' },
  {
    origin: 'https://docs.etherscan.io',
    use: 'link',
    why: 'Conditions d’utilisation citées dans la table des sources.',
  },
  { origin: 'https://routescan.io', use: 'link', why: 'Crédit de source affiché.' },
  { origin: 'https://www.blockscout.com', use: 'link', why: 'Crédit de source affiché.' },
  {
    origin: 'https://www.ecb.europa.eu',
    use: 'link',
    why: 'Origine réelle des taux de change relayés par Frankfurter, citée dans la table des sources.',
  },
];

/** Origines autorisées par `connect-src`, dans l'ordre de la table. */
export function connectSrcOrigins(): readonly string[] {
  return KNOWN_ORIGINS.filter((o) => o.use !== 'link').map((o) => o.origin);
}

/**
 * La politique complète, injectée en `<meta>` au build par `vite.config.ts`. En développement, Vite
 * a besoin du websocket HMR et de styles inline : aucune CSP n'y est posée.
 *
 * `style-src 'unsafe-inline'` reste nécessaire aux attributs `style=""` ; aucun script inline.
 */
export function buildCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${connectSrcOrigins().join(' ')}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}
