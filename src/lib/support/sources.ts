/**
 * Catalogue des sources de données interrogées par l'application, et de ce que chacune exige en
 * retour (décision n° 47).
 *
 * Pourquoi une table déclarative plutôt qu'une phrase dans un écran : l'app interroge **douze**
 * sources, dont **quatre** imposent contractuellement une mention. Une attribution écrite à la main
 * dans un composant se périme au premier fournisseur ajouté, et l'oubli est silencieux — il se
 * découvre à la réclamation. Ici, `sources.test.ts` croise cette table avec les noms que le code
 * produit réellement (`defaultPriceProviders`, `defaultHistoryProviders`, `frankfurterProvider`,
 * `FLAVOR_LABELS`, `BTC_HOSTS`, `FEAR_GREED_ATTRIBUTION`) : **brancher une source sans l'inscrire
 * ici casse la CI**.
 *
 * Trois devoirs distincts, jamais confondus :
 *
 * - `required` — la mention est une **condition d'utilisation**. Elle est reproduite **mot pour
 *   mot** (`notice`) et reste visible ; `terms` dit d'où vient l'obligation et à quelle date elle
 *   a été lue.
 * - `courtesy` — la source demande à être citée sans l'exiger. On cite quand même.
 * - `unverified` — les conditions n'ont pas été lues, ou n'ont rien donné de net. La source est
 *   **créditée** mais l'app ne prétend pas connaître une obligation qu'elle n'a pas constatée.
 *   Écrire `required` par prudence serait afficher une contrainte inventée.
 *
 * Recherche du 26/08/2026 ; `checkedOn` porte la date de lecture de chaque texte, car ces
 * conditions changent sans préavis.
 */

export type AttributionDuty = 'required' | 'courtesy' | 'unverified';

export interface SourceTerms {
  url: string;
  /** Jour de lecture du texte, `AAAA-MM-JJ`. */
  checkedOn: string;
  /** Clause invoquée, telle qu'elle est référencée par la source. */
  clause: string | null;
}

export interface DataSource {
  /** Clé stable, indépendante du libellé affiché. */
  id: string;
  label: string;
  /** Ce que l'app lui demande, en français, pour l'écran « Sources ». */
  role: string;
  url: string;
  /**
   * Mention imposée par les conditions, à afficher **telle quelle**, sans traduction ni
   * reformulation. `null` quand aucune mention n'est imposée.
   */
  notice: string | null;
  duty: AttributionDuty;
  terms: SourceTerms | null;
  /**
   * Tout nom ou hôte que le code peut produire pour cette source (nom de fournisseur, libellé de
   * parfum d'explorateur, hôte d'API). Sert au croisement automatique du test.
   */
  emits: readonly string[];
}

export const DATA_SOURCES: readonly DataSource[] = [
  {
    id: 'coingecko',
    label: 'CoinGecko',
    role: 'Cours du jour et historique sur un an, pour la longue traîne des actifs.',
    url: 'https://www.coingecko.com',
    // Formulation et taille minimale imposées : 10 pt = 13,33 px, d'où un rendu en `--fs-sm`
    // (14 px) et non `--fs-xs` (12 px), qui passerait sous le plancher.
    notice: 'Powered by CoinGecko',
    duty: 'required',
    terms: {
      url: 'https://www.coingecko.com/en/api_terms',
      checkedOn: '2026-08-26',
      clause:
        'API Terms of Service § 4.3 (en vigueur au 05/09/2025) — mention proéminente, police lisible, taille minimale 10 pt',
    },
    emits: ['CoinGecko'],
  },
  {
    id: 'coinbase',
    label: 'Coinbase',
    role: 'Cours du jour et chandelles quotidiennes, cotées nativement en euros.',
    url: 'https://www.coinbase.com',
    notice: null,
    duty: 'unverified',
    terms: null,
    emits: ['Coinbase'],
  },
  {
    id: 'kraken',
    label: 'Kraken',
    role: 'Cours du jour et chandelles quotidiennes, cotées nativement en euros.',
    url: 'https://www.kraken.com',
    notice: null,
    duty: 'unverified',
    terms: null,
    emits: ['Kraken'],
  },
  {
    id: 'hyperliquid',
    label: 'Hyperliquid',
    role: 'Cours des jetons Hyperliquid, et lecture d’un compte suivi par son adresse publique.',
    url: 'https://hyperliquid.xyz',
    notice: null,
    duty: 'unverified',
    terms: null,
    emits: ['Hyperliquid'],
  },
  {
    id: 'defillama',
    label: 'DefiLlama',
    role: 'Filet de sécurité : cours des actifs peu courants et historique antérieur à un an.',
    url: 'https://defillama.com',
    notice: null,
    // API ouverte et libre d'accès ; la citation est demandée sans être imposée. On cite quand même.
    duty: 'courtesy',
    terms: {
      url: 'https://defillama.com/terms',
      checkedOn: '2026-08-26',
      clause: null,
    },
    emits: ['DefiLlama'],
  },
  {
    id: 'ecb',
    label: 'Banque centrale européenne',
    role: 'Taux de change de référence quotidiens, via le relais Frankfurter.',
    url: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.fr.html',
    // Le commentaire précédent affirmait « aucune clause d'attribution constatée au 26/08/2026 ».
    // C'était faux, et l'application relayait donc de la donnée BCE sans la citer (décision n° 91).
    // Disclaimer relu le 01/09/2026 : « users of this website may make free use of the information
    // obtained directly from it subject to the following conditions: When such information is
    // distributed or reproduced, it must appear accurately and the ECB must be cited as the
    // source. » La réutilisation est donc libre — mais l'attribution est une CONDITION, pas une
    // politesse.
    notice: 'Source : Banque centrale européenne',
    duty: 'required',
    terms: {
      url: 'https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html',
      checkedOn: '2026-09-01',
      clause:
        'Disclaimer & copyright — « the ECB must be cited as the source » lorsque l’information est distribuée ou reproduite',
    },
    emits: ['BCE via Frankfurter'],
  },
  {
    id: 'mempool-space',
    label: 'mempool.space',
    role: 'Mouvements d’une adresse ou d’une clé publique étendue Bitcoin.',
    url: 'https://mempool.space',
    notice: null,
    // Le projet est sous AGPL-3.0 : la licence lie qui redistribue LE CODE, pas qui appelle
    // l'instance publique. Aucune obligation d'attribution ne nous incombe à ce titre.
    duty: 'unverified',
    terms: null,
    emits: ['https://mempool.space/api'],
  },
  {
    id: 'blockstream',
    label: 'Blockstream.info',
    role: 'Secours Bitcoin quand mempool.space ne répond pas.',
    url: 'https://blockstream.info',
    notice: null,
    duty: 'unverified',
    terms: null,
    emits: ['https://blockstream.info/api'],
  },
  {
    id: 'blockscout',
    label: 'Blockscout',
    role: 'Mouvements d’une adresse Ethereum, Arbitrum One ou Base, sans clé.',
    url: 'https://www.blockscout.com',
    notice: null,
    // À ne pas confondre avec le « Data API » (data-api.blockscout.ai), produit distinct aux
    // conditions restrictives, que l'app n'interroge pas.
    duty: 'unverified',
    terms: null,
    emits: ['Blockscout', 'Blockscout Pro'],
  },
  {
    id: 'routescan',
    label: 'Routescan',
    role: 'Secours EVM sans clé, sur Ethereum.',
    url: 'https://routescan.io',
    notice: null,
    duty: 'unverified',
    terms: null,
    emits: ['Routescan (sans clé, Ethereum seulement)'],
  },
  {
    id: 'etherscan',
    label: 'Etherscan',
    role: 'Mouvements EVM lorsque vous fournissez votre propre clé d’explorateur.',
    url: 'https://etherscan.io',
    // L'exemption « usage personnel » ne s'applique pas : le site est public.
    notice: 'Powered by Etherscan.io APIs',
    duty: 'required',
    terms: {
      url: 'https://docs.etherscan.io/etherscan',
      checkedOn: '2026-08-26',
      clause:
        'Conditions d’utilisation des API — lien retour ou mention, hors usage strictement personnel',
    },
    emits: ['Etherscan V2'],
  },
  {
    id: 'alternative-me',
    label: 'alternative.me',
    role: 'Indice « Fear & Greed », affiché seulement si vous l’activez.',
    url: 'https://alternative.me/crypto/fear-and-greed-index/',
    notice: 'alternative.me',
    duty: 'required',
    terms: {
      url: 'https://alternative.me/crypto/fear-and-greed-index/',
      checkedOn: '2026-08-26',
      clause: 'Source visible à l’écran à côté de la valeur (décision n° 44)',
    },
    emits: ['alternative.me'],
  },

  /*
   * Sources du contexte de marché. Elles se distinguent de toutes les précédentes sur un point :
   * l'application ne les contacte **jamais**. Leurs données sont récupérées par les générateurs,
   * en intégration continue, et compilées dans le bundle (décisions n° 58 et n° 59). Elles n'en
   * doivent pas moins être créditées — c'est même parce que leurs conditions autorisent
   * explicitement le stockage et la redistribution qu'elles ont été retenues.
   */
  {
    id: 'federal-reserve',
    label: 'Réserve fédérale',
    role: 'Calendrier des réunions du FOMC, et bilan hebdomadaire de la Fed (relevé H.4.1).',
    url: 'https://www.federalreserve.gov',
    notice: 'Federal Reserve Board',
    duty: 'courtesy',
    terms: {
      url: 'https://www.federalreserve.gov/disclaimer.htm',
      checkedOn: '2026-08-29',
      clause:
        'Disclaimer — « information on the Board’s website is in the public domain and may be copied and distributed without permission. Please cite to the Board as the source of the information. »',
    },
    emits: ['fomc', 'fed'],
  },
  {
    id: 'bls',
    label: 'Bureau of Labor Statistics',
    role: 'Dates de publication de l’inflation CPI, de l’emploi, des prix à la production et des postes vacants.',
    url: 'https://www.bls.gov/schedule/news_release/',
    notice: null,
    duty: 'unverified',
    terms: null,
    emits: ['bls'],
  },
  {
    id: 'bea',
    label: 'Bureau of Economic Analysis',
    role: 'Dates de publication de l’inflation PCE et du PIB américain.',
    url: 'https://www.bea.gov/news/schedule',
    notice: null,
    duty: 'unverified',
    terms: null,
    emits: ['bea'],
  },
  {
    id: 'treasury',
    label: 'Département du Trésor américain',
    role: 'Courbe des taux souverains : dix ans nominal, deux ans, et dix ans réel (TIPS).',
    url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates',
    notice: null,
    duty: 'unverified',
    terms: null,
    emits: ['treasury'],
  },
  {
    id: 'eia',
    label: 'U.S. Energy Information Administration',
    role: 'Prix spot quotidien du pétrole WTI.',
    url: 'https://www.eia.gov/dnav/pet/pet_pri_spt_s1_d.htm',
    notice: 'Source: U.S. Energy Information Administration',
    duty: 'courtesy',
    terms: {
      url: 'https://www.eia.gov/about/copyrights_reuse.php',
      checkedOn: '2026-08-29',
      clause:
        'Copyrights and Reuse — « U.S. government publications are in the public domain » ; la mention est recommandée (« should »), non imposée',
    },
    emits: ['eia'],
  },
];

/** Sources dont la mention est contractuelle : celles-là ne peuvent pas être masquées. */
export function requiredAttributions(): readonly DataSource[] {
  return DATA_SOURCES.filter((s) => s.duty === 'required');
}

/** Retrouve la source qui émet ce nom (nom de fournisseur, libellé d’explorateur, hôte d’API). */
export function sourceEmitting(name: string): DataSource | null {
  return DATA_SOURCES.find((s) => s.emits.includes(name)) ?? null;
}
