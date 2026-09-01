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

import { SERVICE_WORKER_POLICY } from './trusted-types.ts';

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

  // — Modèle de langage (P65), uniquement si l'utilisateur colle sa propre clé —
  {
    origin: 'https://api.anthropic.com',
    use: 'connect',
    why: 'Récit narratif rédigé par un modèle de langage, à partir de constats DÉJÀ calculés. Contactée seulement si l’utilisateur a collé sa propre clé d’API et confirmé l’envoi, écran par écran ; jamais au chargement, jamais en tâche de fond.',
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
  {
    origin: 'https://ec.europa.eu',
    use: 'link',
    why: 'Eurostat : conditions de réutilisation citées dans la table des sources.',
  },
  { origin: 'https://www.blockscout.com', use: 'link', why: 'Crédit de source affiché.' },
  {
    origin: 'https://www.ecb.europa.eu',
    use: 'link',
    why: 'Taux de change relayés par Frankfurter, et calendriers officiels du Conseil des gouverneurs et de l’IPCH.',
  },

  /*
   * Calendrier macroéconomique : ces trois origines ne sont **jamais** contactées par l'app. Le
   * calendrier est compilé dans le bundle par `scripts/generate-calendar.ts`, qui les interroge
   * depuis la CI. Ce qui en reste dans le code livré, ce sont les liens « publication officielle »
   * que l'utilisateur peut suivre.
   */
  {
    origin: 'https://www.federalreserve.gov',
    use: 'link',
    why: 'Calendrier officiel des réunions du FOMC, lié depuis chaque décision affichée.',
  },
  {
    origin: 'https://www.bls.gov',
    use: 'link',
    why: 'Calendriers officiels du Bureau of Labor Statistics (CPI, emploi, PPI, JOLTS).',
  },
  {
    origin: 'https://www.bea.gov',
    use: 'link',
    why: 'Pages officielles du Bureau of Economic Analysis (inflation PCE, PIB).',
  },
  {
    origin: 'https://home.treasury.gov',
    use: 'link',
    why: 'Courbe des taux du Trésor américain, liée depuis chaque indicateur de taux. Le flux XML est lu par le générateur, en CI, jamais par le navigateur.',
  },
  {
    origin: 'https://www.eia.gov',
    use: 'link',
    why: 'Prix spot du pétrole, crédité dans la table des sources. L’API est interrogée en CI, avec une clé qui ne quitte jamais les secrets du dépôt.',
  },

  /*
   * Veille réglementaire (P67) : table tenue à la main, jamais interrogée par l'app — seuls les
   * liens « source » de chaque entrée (`src/lib/watch/entries.ts`) subsistent dans le code livré.
   */
  {
    origin: 'https://www.legifrance.gouv.fr',
    use: 'link',
    why: 'Textes officiels (lois, décrets, articles du CGI) cités par la table de veille réglementaire, liés depuis chaque entrée qui en a une.',
  },
];

/** Origines autorisées par `connect-src`, dans l'ordre de la table. */
export function connectSrcOrigins(): readonly string[] {
  return KNOWN_ORIGINS.filter((o) => o.use !== 'link').map((o) => o.origin);
}

/**
 * Politiques Trusted Types autorisées — **liste fermée**, croisée avec le bundle livré par
 * `tests/e2e/csp-build.spec.ts`.
 *
 * `svelte-trusted-html` n'est pas de nous : Svelte 5 la crée au chargement de son runtime et la
 * traverse avant toute affectation `innerHTML` sur ses `<template>`. Le framework était donc prêt
 * sans qu'on ait rien à adapter.
 *
 * La seconde est la nôtre, et elle **épingle** l'URL du service worker — `register()` est un puits
 * `TrustedScriptURL`, et son échec serait silencieux. Voir `trusted-types.ts`.
 *
 * Pas de `*`, qui reviendrait à n'autoriser personne en particulier. Pas de politique `default`, qui
 * rendrait passants **tous** les puits et annulerait l'intérêt de la directive. Pas de
 * `allow-duplicates` : Svelte ne la crée qu'une fois.
 */
export const TRUSTED_TYPES_POLICIES = ['svelte-trusted-html', SERVICE_WORKER_POLICY] as const;

/**
 * La politique complète, injectée en `<meta>` au build par `vite.config.ts`. En développement, Vite
 * a besoin du websocket HMR et de styles inline : aucune CSP n'y est posée.
 *
 * `style-src 'unsafe-inline'` reste nécessaire aux attributs `style=""` ; aucun script inline.
 *
 * **Pourquoi Trusted Types, et pourquoi seulement maintenant.** La directive aurait été du zèle tant
 * que `connect-src` ne listait que des API de prix : elles n'acceptent pas de charge utile
 * arbitraire, et une XSS n'aurait eu nulle part où exfiltrer. La décision n° 69 a changé cela en
 * inscrivant `api.anthropic.com` en `connect` — et comme cette CSP est **statique**, l'origine est
 * autorisée pour tous les visiteurs, y compris ceux qui ne colleront jamais de clé : le
 * consentement par usage vit dans le code applicatif, qu'une XSS contourne par construction. Le
 * puits d'exfiltration existe donc désormais, ce qui rend la dernière classe de XSS DOM concrète.
 * Ne pas retirer ces deux lignes en les croyant décoratives — voir la décision n° 75.
 *
 * Un navigateur qui ignore Trusted Types ignore aussi ces directives : leur ajout ne peut rien
 * casser chez un visiteur ancien.
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
    "require-trusted-types-for 'script'",
    `trusted-types ${TRUSTED_TYPES_POLICIES.join(' ')}`,
  ].join('; ');
}
