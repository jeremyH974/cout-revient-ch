# Version 2 — deux espaces « Investissement / Spot » et « Trading » + Vue d'ensemble

> Proposition du 23 août 2026, validée par le propriétaire le jour même. Elle répond à la demande
> d'un membre du Discord (ci-dessous) et à l'exigence du propriétaire de **séparer clairement** la
> partie spot/investissement de la partie trading, avec une page de récapitulatif. Méthode : six
> recherches documentaires en lecture seule (benchmark produits, journaux de trading, API de prix,
> API Hyperliquid, agrégateurs multi-plateformes, architecture d'information) avec sondes CORS
> réelles, plus un audit du code existant. Les numéros `[B…]`, `[P…]`, `[H…]`, `[A…]`, `[U…]`
> renvoient aux sources en fin de document ; ce qui n'a pas pu être vérifié est signalé.
>
> La version 1 est figée (tag `v1.0.0`, release GitHub « V1 », toujours déployée) ; cette
> proposition se réalise sur la branche `v2`.

## Contexte

Un membre du Discord demande :

> « J'aimerais avoir un tracker pour les trades et investissement spot. Pour tout répertorier avec
> mes PRU etc. J'aimerais pouvoir regrouper tout au même endroit (invest spot avec PRU et perf à
> l'instant, on doit pouvoir avoir un bouton actualiser en connectant à CoinMarketCap ou autre pour
> avoir le prix au jour) et pouvoir suivre tous mes trades (entrées, sorties, gain ou perte, une
> partie note pour dire pourquoi je prends le trade, etc.). Le but est d'essayer de tracker mes
> perfs pour voir ce qui marche ou pas. »

L'app est aujourd'hui un calculateur de PRU / plus-values **mono-source** (export CSV Coinhouse),
statique, local-first, sans backend ni compte. La demande pousse vers un **tracker multi-sources**
(Coinhouse + Hyperliquid + saisie manuelle) avec **journal de trading** et **statistiques de
performance**. Exigence du propriétaire : la partie **Spot / Investissement** (Coinhouse et autres)
doit être **clairement séparée** de la partie **Trading** (Hyperliquid et autres), quitte à avoir
une **page de récapitulatif** reprenant les deux, en visant ce que font les meilleurs et une
architecture prête pour le futur.

## 1. Analyse de la demande

### Ce que le membre demande explicitement

| #   | Demande                                                                     | Ce que l'app fait déjà                                                     | Ce qui manque                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Investissements spot « avec PRU et perf à l'instant », tout au même endroit | PRU all-in, latent/réalisé/total, ROI, lots — **pour Coinhouse seulement** | Plusieurs sources (Hyperliquid, autres plateformes, saisie manuelle) agrégées, PRU par plateforme **et** consolidé                                                                 |
| B   | Bouton « Actualiser » relié à CoinMarketCap « ou autre »                    | Prix rafraîchis via Coinbase → CoinGecko, FX Frankfurter, cache            | Bouton explicite + horodatage + source + état « périmé » ; couverture des tokens Hyperliquid (HYPE, PURR…) ; CoinMarketCap n'est pas appelable depuis un navigateur (confirmé § 3) |
| C   | Suivre « tous mes trades » : entrées, sorties, gain ou perte                | Historique d'opérations avec PRU après chaque ligne                        | Notion de **trade** (aller-retour, long/short, perps) distincte de la position d'investissement ; P&L par trade net de frais et de funding                                         |
| D   | Partie « note » : pourquoi je prends le trade                               | `ManualEvent.note` existe (non exploité)                                   | Journal structuré : thèse avant, revue après, tags (setup, erreur), plan (entrée / stop / cible → R), capture optionnelle                                                          |
| E   | « Tracker mes perfs pour voir ce qui marche ou pas »                        | ROI global, courbes d'évolution                                            | Statistiques par setup / actif / sens / jour / durée : espérance, profit factor, taux de réussite, R moyen, drawdown, courbe d'equity, garde-fous d'échantillon                    |

### Besoins implicites (à traiter pour que ce soit « excellent »)

- **Deux modèles mentaux, donc deux espaces** (décision du propriétaire) : l'_investisseur_
  raisonne en position et PRU (inventaire, CUMP) ; le _trader_ raisonne en aller-retours (entrée →
  sortie, R-multiple, setup). Chaque **compte** appartient à un espace (Coinhouse → Investissement ;
  Hyperliquid → Trading par défaut, avec option de router ses achats spot « à garder » vers
  Investissement) ; détection automatique des aller-retours (flat → position → flat) dans Trading ;
  une **Vue d'ensemble** consolide les deux sans mélanger leurs vocabulaires (§ 6.0).
- **Perps Hyperliquid** : pas d'inventaire, P&L = `closedPnl` − frais ± funding, long/short, levier,
  liquidations. Ils ne rentrent pas dans le moteur CUMP : il faut un moteur « trades » séparé, pur,
  qui partage les types de base (`DecimalString`, `NaiveDateTime`).
- **Unité de compte** : USDC sur Hyperliquid ; l'app affiche en EUR/USD avec taux BCE à la date de
  chaque mouvement (`src/lib/fx`). Le P&L trading doit être stocké dans sa devise native et converti
  à l'affichage, comme aujourd'hui.
- **Lecture seule, sans secret** : l'adresse publique suffit sur Hyperliquid ; aucune clé privée,
  aucune clé API, rien ne quitte le navigateur sauf les appels aux API publiques. C'est cohérent avec
  la promesse du produit et la décision n° 1 (`docs/DECISIONS.md`).
- **Saisie manuelle de trades** (plateformes sans API ou sans export) : indispensable pour « tout
  regrouper », mobile-first (un trade saisi en 20 s depuis le téléphone).
- **Le journal est une donnée précieuse** : sauvegarde/export (P12 de la roadmap devient un
  prérequis), formats ouverts (CSV/JSON) pour ne pas enfermer l'utilisateur.
- **Fiabilité des chiffres** : même exigence que le moteur PRU — invariants, oracle indépendant,
  auto-vérifications (`src/lib/support/self-check.ts`) étendues aux trades
  (Σ P&L des trades = Σ `closedPnl` − Σ frais ± Σ funding sur la période).

### Hors périmètre (à dire clairement au membre)

- Passer des ordres ou se connecter avec une clé privée : jamais (lecture seule, par conception).
- Alertes de prix / notifications : impossible sans serveur (déjà exclu dans `docs/ROADMAP.md` § 5).
- Fiscalité des perps (BNC/BIC) : hors v1, comme le mode fiscal spot (décision n° 10).
- Temps réel permanent : le bouton « Actualiser » (et éventuellement un mode « live » optionnel sur
  l'écran trading) suffit ; pas de flux ouvert en permanence par défaut (batterie, quotas).

## 2. État de l'art 2025-2026 (recherche du 23/08/2026, sources [B…] en fin de document)

### Trackers de portefeuille — ce que font les meilleurs

| Outil                     | Modèle              | Import                                        | Cost-basis / perf                                                     | À retenir                                                                                |
| ------------------------- | ------------------- | --------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Rotki                     | OSS, local-first    | Clés API CEX (lecture), adresses EVM/ENS, CSV | Rapports P&L, historique de valeur nette (2 semaines en gratuit)      | La référence « données chez soi » ; même promesse que nous [B1][B2]                      |
| Ghostfolio                | OSS AGPL, self-host | CoinGecko/Yahoo, manuel, JSON d'activités     | Rendement multi-période, TWR seulement (MWR demandé, cf. roadmap S26) | Format JSON d'activités devenu référence d'échange [B6][B7][B8]                          |
| CoinStats / Delta         | Cloud freemium      | 300+ sources, 50+ chaînes                     | P&L par coin et portefeuille                                          | Largeur d'import > profondeur analytique ; données hébergées chez l'éditeur [B3][B4][B5] |
| Kubera                    | Cloud payant        | Agrégateurs banques/brokers/crypto            | IRR par actif, benchmark BTC/indices (présence de TWR contestée)      | Le « TWR/IRR + benchmark » devient un standard attendu [B9][B10]                         |
| Finary / Waltio           | Cloud FR            | Banques/PEA/AV/crypto ; exchanges/wallets     | Vue patrimoine ; fiscalité FR                                         | Se différencient par la conformité fiscale, pas par les métriques [B11][B12][B13]        |
| CoinGecko / CMC Portfolio | Cloud gratuit       | Saisie manuelle                               | P&L simple                                                            | Ni TWR ni XIRR [B14][B15]                                                                |

Position libre sur le marché : **aucun outil ne combine local-first strict + XIRR/TWR sérieux +
import multi-sources + journal de trading** (constat [B1]–[B15]).

### Journaux de trading — fonctions indispensables vs gadgets

| Outil                                                                | Ce qu'il apporte                                                                                                                       | Prix                          |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| TradeZella                                                           | Tags émotionnels, captures, playbooks, « Zella Scale » (P&L réel vs potentiel), IA Zella                                               | dès 35 $/mois [B16][B18][B19] |
| Edgewonk                                                             | Psychologie/discipline, « Edge Finder » hebdo, 10 métriques clés (win rate, R:R, espérance, drawdown)                                  | 197 $/an [B16][B33][B34]      |
| TraderSync                                                           | 700+ brokers, 600+ statistiques, plan gratuit 3 000 exécutions/mois                                                                    | dès 29,95 $/mois [B16]        |
| TradesViz                                                            | 100-600+ graphiques (MFE/MAE, calendrier, R-multiples, equity curve), import CSV **Hyperliquid**, résumés IA                           | n.c. [B21][B22][B23]          |
| Outils Hyperliquid (HyperTracker, Dexly, phantomliquid, GASPNTRADER) | PnL réalisé/latent, funding, win rate, equity curve **depuis la seule adresse publique**, sans clé API ; mais pas de journal structuré | gratuits [B24]–[B27]          |

**Indispensables** (convergence de toutes les sources) : champs fiables entrée/sortie/taille/frais ;
résultat en R **et** en devise ; tags/setups pour trancher par stratégie ; champ « pourquoi » ;
win rate + R:R + espérance affichés **ensemble** ; calendrier / equity curve ; écart plan vs
exécution ; import automatique (la saisie manuelle est le premier facteur d'abandon) [B16][B33].
**Gadgets** : replay vidéo, score gamifié propriétaire, chat IA, simulateur what-if.

### Métriques qui comptent vraiment (et leurs garde-fous)

- **Espérance en R** (gain moyen par trade rapporté au risque initial) > taux de réussite seul ;
  **profit factor** (Σ gains / Σ pertes > 1) en complément [B30][B31][B32][B33][B34].
- **Taille d'échantillon** : ≥ 30 trades pour un signal exploitable, 100–200 pour une image
  fiable ; en dessous, afficher un avertissement plutôt qu'un verdict [B31][B32].
- Trop de setups suivis = signe de manque de discipline (Edgewonk) → limiter les tags proposés par
  défaut [B33]. Aucune étude académique indépendante validant ces métriques n'a été trouvée :
  ce sont des standards de praticiens, à présenter comme tels.

### Tendances 2025-2026

- IA embarquée (auto-tagging, résumé de session, requêtes en langage naturel) : couche d'assistance,
  pas un remplacement des statistiques [B36][B37]. Pour nous : « copier un résumé anonymisé de mes
  stats » à coller dans l'IA de son choix, sans backend ni clé.
- Synchronisation automatique généralisée chez les CEX ; pour **Hyperliquid, le modèle dominant est
  la lecture on-chain par adresse publique** (pas de clé API), exactement ce qu'une app statique
  peut faire [B21][B25][B26][B27].
- Formats ouverts : CSV « Universal » de Koinly (`YYYY-MM-DD HH:mm:ss` UTC) et JSON d'activités
  Ghostfolio comme cibles d'export/import [B35][B6][B7].

## 2bis. Comment les meilleurs séparent « investissement » et « trading » (sources [U…])

| Produit              | Navigation de 1er niveau                                            | Vue d'ensemble                                               | Sommé / jamais sommé                                                                                 | Transferts internes                      |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Binance              | Wallets Spot / Futures / Earn / Funding + « Wallet Overview »       | Solde total estimé                                           | Soldes sommés ; **P&L jamais sommé** : « Spot P&L Analysis » ≠ « Futures P&L Analysis » [U1][U2][U3] | Écran de transfert dédié                 |
| Kraken Pro           | Un onglet par wallet (Main, Margin, Derivatives, Earn) + Overview   | Solde par wallet, graphe valeur / P&L                        | Spot/margin : prix moyen, cost basis, P&L ; **Derivatives exclu** des totaux, onglet séparé [U6][U7] | Bouton dédié, instantané                 |
| Coinbase Advanced    | Sélecteur « Portfolio » (≤ 100 portefeuilles isolés, un Primary)    | Par portefeuille                                             | Chaque portefeuille = environnement isolé (positions, clé API) [U4]                                  | Instantané, gratuit                      |
| Trading 212          | Comptes séparés Invest / ISA / CFD / SIPP + sélecteur               | « Net Worth » agrégé au sélecteur                            | Cash transférable sous conditions, **titres jamais** [U10][U11][U12]                                 | Documenté compte par compte              |
| Hyperliquid          | Page Portfolio unique, graphe Account value / PnL (24 h, 7 j, 30 j) | Account value = collatéral + PnL latent perps + vaults [U13] | Spot et perps unifiés par actif en « portfolio margin » [U14]                                        | Dépôts/retraits horodatés, vaults à part |
| eToro                | Portfolio → History filtrable (manuel / copiés / Smart Portfolios)  | Liste unique filtrable                                       | Typé par filtre, pas de fusion de stratégies [U8][U9] (non vérifié, pages 403)                       | Filtres, pas de transfert                |
| Kubera / Ghostfolio  | Comptes et plateformes filtrables par classe d'actif                | Net worth unique + allocation                                | Agrégation puis filtre ; détail ligne à ligne [U16][U18]                                             | Lecture seule                            |
| TradeZella (journal) | Dashboard / Trades / Journal / Playbooks / Reports                  | KPI en tête, calendrier de P&L, equity curve                 | Dashboard dérivé des trades, P&L par stratégie séparé [U19][U20]                                     | Sans objet                               |

Enseignements repris dans § 6.0 :

1. **On somme des soldes, jamais des P&L de nature différente** — aucune référence ne fusionne
   plus-value spot et P&L à levier dans un chiffre [U2][U7]. La Vue d'ensemble affiche donc une
   valeur nette et **deux** résultats côte à côte, sans « résultat global ».
2. **Équité d'un compte à levier = collatéral + latent + vaults** (Hyperliquid « Account value »
   [U13] ; Binance distingue wallet balance et margin balance [U2]).
3. **Comptes / portefeuilles de première classe avec sélecteur** (Trading 212, Coinbase, Kraken).
4. **Transferts entre espaces explicites, visibles des deux côtés**, jamais un recalcul silencieux
   du PRU [U4][U6].
5. **Vocabulaire distinct** : détention (Spot / Invest / Holdings / Main wallet) vs levier
   (Futures / Margin / CFD / Perps / Derivatives) [U2][U6][U10].
6. **Journal → rapports → tableau de bord** : le tableau de bord ne contient jamais de saisie
   [U19] ; KPI récurrents : win rate, profit factor, espérance, drawdown max, gain/perte moyens,
   nombre de trades, calendrier [U19][U21].
7. **3 à 5 destinations en navigation mobile** (Apple HIG, Material 3) ; rail de navigation
   (3-7 destinations) sur grand écran ; sous-navigation en contrôle segmenté, pas d'onglets racine
   supplémentaires [U22][U23][U24][U25] ; résumé puis détail à la demande [U26].
8. Kraken route par **nature de la ligne** (spot → cost basis, dérivés → séparés) [U7] : c'est
   l'option « spot de ce compte = investissement » offerte par compte Hyperliquid (§ 6.0).

Non couvert par le budget : Finary et Rotki (pas de source exploitable), détail dérivés de
Delta/CoinStats, pages d'aide Coinbase/eToro (403 → reconstruites depuis les extraits, marquées
non vérifiées).

## 3. Le bouton « Actualiser » et CoinMarketCap — ce qui est possible sans backend

Sondes CORS exécutées le 23/08/2026 avec `Origin: https://jeremyh974.github.io` (sources [P…]).

| Source                                                 | Clé                       | CORS (en-tête observé)                                                                                                      | Quota gratuit                    | Rôle recommandé                                                                                          |
| ------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **CoinMarketCap**                                      | obligatoire               | **Aucun `Access-Control-Allow-Origin`**, même en preflight ; FAQ officielle : appels client-side « not supported » [P1][PE] | 15 k crédits/mois [P2]           | **Impossible depuis le navigateur** — il faudrait un proxy (serveur), contraire à la promesse du produit |
| CoinGecko sans clé                                     | non                       | `*` [PE]                                                                                                                    | ~10-30 req/min, non garanti [P3] | Déjà en prod (prix + historique 365 j)                                                                   |
| CoinGecko Demo                                         | gratuite, par utilisateur | `*`                                                                                                                         | 100 req/min, 10 k/mois [P4]      | **Seule « clé optionnelle » qui a du sens** (déjà prévue, roadmap § 6.5)                                 |
| Coinbase Exchange / v2                                 | non                       | `*` [PE]                                                                                                                    | généreux                         | Déjà en prod, premier de la chaîne                                                                       |
| Kraken                                                 | non                       | reflète l'origine [PE]                                                                                                      | ~1 req/s                         | Déjà en prod (prix + OHLC)                                                                               |
| Binance (`api.binance.com`, `data-api.binance.vision`) | non                       | `*` [PE]                                                                                                                    | 1 200 poids/min                  | Secours possible ; géoblocage 451 signalé, CGU restrictives (roadmap § 5) → pas par défaut               |
| OKX / Bybit                                            | non                       | reflète l'origine [PE]                                                                                                      | élevé                            | Secours de fin de chaîne                                                                                 |
| **Hyperliquid `allMids`**                              | non                       | `*` [PE]                                                                                                                    | élevé                            | **Prix HYPE/PURR et tout le spot Hyperliquid** (aujourd'hui sans logo ni prix fiable)                    |
| **DefiLlama `coins.llama.fi`**                         | non                       | `*` [PE]                                                                                                                    | ~500/5 min [P5]                  | Filet universel long tail par `chaîne:adresse` (Solana inclus), prix courant + `/chart`                  |
| Pyth Hermes                                            | non                       | `*` [PE]                                                                                                                    | élevé                            | Oracle temps réel des majors (option « futur »)                                                          |
| Bitstamp, CryptoCompare/CoinDesk Data                  | — / clé                   | **pas de CORS** / 401 [PE]                                                                                                  | —                                | À exclure                                                                                                |

Architecture cible du bouton (toutes briques déjà présentes dans `src/lib/pricing/service.ts`, à
épaissir) :

- Chaîne prix courants : Coinbase → Kraken → CoinGecko (Demo si clé saisie) → Hyperliquid `allMids`
  (univers HL) → DefiLlama (long tail) → OKX/Bybit ; premier succès gagne, coalescence des requêtes
  en vol, backoff exponentiel avec jitter sur 429/403, respect de `Retry-After`.
- Cache stale-while-revalidate : TTL 30-60 s pour le prix courant, 1 h pour l'historique récent,
  figé pour les points anciens (cache IndexedDB existant `crch-history`).
- UI : bouton « Actualiser » visible sur la synthèse **et** sur l'écran trading, avec « il y a
  2 min · Coinbase » par actif, badge « périmé » au-delà d'un seuil, saisie manuelle persistée pour
  tout actif non pricé (existe : `assetSettings.manualPriceEur`).
- Clé CoinGecko Demo : champ dans Réglages, `localStorage` seulement, envoyée en en-tête
  `x-cg-demo-api-key`, jamais en query string ni dans le bundle.
- Piège vérifié dans le code : la CSP `connect-src` est figée dans `vite.config.ts:21` et injectée
  **au build seulement** → tout nouveau domaine (`api.hyperliquid.xyz`, `coins.llama.fi`) doit y être
  ajouté, sinon blocage silencieux en production, invisible en dev.
- Réponse au membre sur CoinMarketCap : « non, et ce n'est pas un choix : CMC interdit les appels
  depuis un site ; on utilise Coinbase/Kraken/CoinGecko/Hyperliquid, avec horodatage et source
  affichés ».

## 4. Hyperliquid en lecture seule — faisabilité vérifiée (sources [H…])

**Verdict : faisable entièrement côté navigateur, sans clé, avec la seule adresse publique.**

- API `info` = `POST https://api.hyperliquid.xyz/info` avec `{"type": "…"}`, publique, sans
  signature [H1]. **CORS ouvert** : sonde du 23/08/2026 → `access-control-allow-origin: *` [PE].
- Endpoints utiles : `userFillsByTime` (fills spot **et** perps, 2 000 par réponse, fenêtre
  `startTime`/`endTime`, pagination par dernier `time` + 1 ms ; seuls les fills les plus récents
  restent accessibles — d'où la nécessité de **persister les fills bruts localement** pour garder un
  historique qui dépasse la fenêtre de l'API) ; `userFunding` (funding perps) ;
  `userNonFundingLedgerUpdates` (dépôts, retraits, transferts, liquidations) ;
  `clearinghouseState` (positions perps ouvertes, marge) ; `spotClearinghouseState` (soldes spot) ;
  `spotMeta` (résolution des paires `@<index>` → `tokens[]`) ; `allMids` (prix courants) ;
  `candleSnapshot` (≤ 5 000 chandelles) ; `portfolio` (valeur de compte et P&L par période) ;
  `subAccounts` [H1][H2][H3].
- Sémantique d'un fill [H1][H7][H8] : `coin` (perp `BTC`, spot `PURR/USDC` ou `@107`), `px`, `sz`
  (chaînes décimales → `Big` direct, pas de `number`), `side` `B`/`A`, `dir` (`Open Long`,
  `Close Short`, `Buy`, `Sell`…), `closedPnl` (≠ 0 seulement en clôture), `fee` (négatif = rebate
  maker), `feeToken` (USDC ou HYPE), `builderFee` (déjà inclus dans `fee`), `crossed` (taker),
  `liquidation`, `startPosition`, `tid` (id unique → clé de dédoublonnage), `oid`, `hash`.
- **À trancher empiriquement** (non documenté) : `closedPnl` est-il net de `fee` ? Réponse obtenue
  par une auto-vérification de réconciliation : `valeur de compte = Σ dépôts − Σ retraits +
Σ closedPnl − Σ frais + Σ funding + latent` — c'est exactement le type d'invariant que
  `self-check.ts` sait afficher, et il servira de garde permanente.
- Débit [H5] : 1 200 de poids/min par IP ; `allMids`/`clearinghouseState` = 2, la plupart = 20,
  `userFills*` +1 par 20 éléments ; quota par adresse = 1 requête par USDC de volume cumulé avec un
  buffer initial de 10 000 requêtes → largement suffisant pour un import interactif sérialisé avec
  backoff.
- WebSocket `wss://api.hyperliquid.xyz/ws` (`allMids`, `userFills`, `userFundings`, `webData3`…)
  [H6] : inutile pour l'import ; option future « mode live » sur l'écran trading seulement.
- Autres chemins : export CSV de l'app Hyperliquid (Portfolio → Trade History → Export, action
  manuelle, plafond rapporté ~10 000 lignes, non vérifié) = filet de secours / complément pour les
  historiques très longs ; S3 `hl-mainnet-node-data` (requester-pays, ~1 Gio/jour) hors sujet
  navigateur ; HypurrScan a une API publique non officielle [H11] — pas de dépendance en prod.
- Bibliothèques : `@nktkas/hyperliquid` (TypeScript, navigateur, maintenu) existe [H9], mais sa
  valeur est dans la signature d'ordres ; **recommandation : client `fetch` maison minimal**
  (6-8 types de requêtes, contrat stable), cohérent avec « moteur pur, `big.js` seule dépendance ».
- Pièges P&L : tranches TWAP (`userTwapSliceFills`) ; fees en HYPE à convertir au cours du moment ;
  poussière spot ; USDC ≠ EUR (conversion à la date du fill via `src/lib/fx`) ; sous-comptes et
  vaults HLP (adresses séparées, P&L de vault hors `userFills`) ; funding = flux séparé ;
  liquidations à signaler ; mainnet par défaut ; adresse normalisée en minuscules.
- Vie privée : l'adresse publique est plus identifiante qu'un ticker (décision n° 1 à amender :
  « l'adresse est envoyée à Hyperliquid uniquement, jamais ailleurs ; l'app ne la stocke que
  localement »).

## 5. Agrégateur multi-plateformes — ce qui est faisable sans backend (sources [A…])

**Verdict : trois voies saines, une voie à refuser.**

| Voie                                                                              | Faisable depuis le site statique ?                                                                                                                                                                                                                                                                                    | Secret à stocker ?         | Couverture                                                                                                                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CSV natif par plateforme** (convertisseur pur + fixture synthétique par source) | Oui (déjà le modèle Coinhouse)                                                                                                                                                                                                                                                                                        | Non                        | Kraken, Coinbase, Bitvavo, Revolut, Trade Republic, Ledger Live… (1 fichier = 1 convertisseur, prouvé en TypeScript par Export-To-Ghostfolio, 26 sources [A17]) |
| **Format pivot** (CSV « Universal » Koinly / Waltio)                              | Oui                                                                                                                                                                                                                                                                                                                   | Non                        | Toute plateforme via l'export d'un outil fiscal que le membre utilise déjà [A15][A9]                                                                            |
| **Lecture on-chain par adresse publique**                                         | Oui : mempool.space (BTC), Etherscan V2 et Blockscout (EVM) répondent `Access-Control-Allow-Origin: *` [A30] ; Solana RPC public 403 (anti-abus)                                                                                                                                                                      | Non                        | Soldes et mouvements bruts ; le coût d'acquisition reste à qualifier (prix à la date)                                                                           |
| **Clé API d'exchange dans le navigateur**                                         | **Non** : Kraken `OPTIONS /0/private/Balance` → 404 sans en-tête CORS [A13][A30] ; Coinbase ne renvoie pas d'`Allow-Origin` pour notre origine et réserve CORS aux endpoints non authentifiés [A14] ; Bitvavo 405 ; Binance préflight ouvert mais **Binance cesse ses services en France au 01/07/2026** [A4][A5][A6] | Oui — et c'est le problème | —                                                                                                                                                               |

Pourquoi refuser les clés API dans le site : l'app ne détient aujourd'hui **aucun secret** ; une clé
dans `localStorage` transformerait toute XSS future ou toute compromission de dépendance (ver npm
d'août 2026, roadmap § 2.4) en exfiltration silencieuse chez chaque visiteur, sans journal serveur ni
détection ; aucune allow-list IP côté produit. Les scopes lecture seule (Kraken « View Funds/Ledger »
[A12]) n'enlèvent ni le blocage CORS ni ce risque. Si un jour une lecture API est voulue, elle passera
par un proxy **déployé et possédé par l'utilisateur**, jamais par une clé dans l'origine du site.

Plateformes qui comptent pour un public français 2026 : Coinhouse (déjà), Revolut (2ᵉ plateforme
d'achat citée, 24 % des détenteurs [A2]), Kraken, Coinbase, Bitpanda, Bitvavo, Trade Republic
(plateformes MiCA citées post-Binance [A4][A7]), auto-garde (Ledger Live, MetaMask, Phantom),
Hyperliquid. Non vérifié : Boursorama, Crypto.com, classement n° 1.

Prior art open source à imiter (pas à embarquer) : **dali-rp2** (loader pur par source + 1 fixture
par plugin + schéma pivot, Apache-2.0 [A20]), **BittyTax** (~50 parseurs CSV avec fichiers exemples
[A22]), **rotki** (comptes de première classe, connecteurs par exchange/chaîne [A19]),
**Export-To-Ghostfolio** (TypeScript, 1 convertisseur par courtier → JSON Ghostfolio [A17]),
**Wealthfolio** (desktop local-first, Tauri + SQLite [A24]). **ccxt à éviter** : CORS non fiable en
navigateur, bundle lourd [A26].

Format pivot interne recommandé (montants en chaînes) : `date` (UTC ou heure locale **avec la
convention explicite de la source**), `type` (trade | transfer-in | transfer-out | income | fee |
staking-reward | unknown), `from{amount, currency}`, `to{amount, currency}`, `fee{amount, currency}`,
`venueId`, `externalId` (id natif, sinon hash déterministe → dédoublonnage et ré-import idempotent),
`sourceImporter`, `note` (libellé brut). Import et export dans le CSV Universal Koinly [A15] (lu
nativement par Waltio [A9]) et export JSON d'activités Ghostfolio [A18].

Patrons produit (les plaintes n° 1 des agrégateurs sont : PRU faux après synchronisation, coût
d'acquisition à zéro, doublons, virements comptés comme cessions) :

- Compte = objet de première classe (déjà prévu § 6) ; PRU par compte puis consolidation.
- **Virements internes appariés** (actif, montant ± frais, fenêtre de temps) → report de coût,
  jamais une réalisation ; un seul côté visible → avertissement « virement non apparié » au lieu d'un
  gain fantôme (mécanisme Koinly [A16]).
- Ré-import = upsert par `externalId`, jamais un doublon.
- Réconciliation de solde par compte avant de déclarer un importeur « prêt » (comme Coinhouse :
  0 ligne à qualifier, 0 écart).

## 6. Architecture cible (fondée sur l'audit du code du 23/08/2026)

### 6.0 Deux espaces séparés + une Vue d'ensemble (exigence du propriétaire)

**Principe** : _Investissement_ et _Trading_ sont deux **espaces** autonomes — navigation, données,
moteur, auto-vérifications, exports, fixtures et tests E2E propres — et ne se rencontrent que dans
la **Vue d'ensemble**, qui lit leurs deux rapports sans jamais y écrire. C'est le découpage observé
chez Binance (wallets Spot / Futures, P&L analysés séparément), Kraken Pro (Derivatives exclu des
totaux spot), Trading 212 (comptes Invest / CFD + « Net Worth ») et Coinbase (portefeuilles
isolés) — § 2bis.

**Navigation**

| Contexte                                                     | Destinations                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mobile (barre du bas, 4 destinations — HIG/Material : 3 à 5) | **Vue d'ensemble** (accueil) · **Investissement** · **Trading** · **Plus** (Comptes, Import, Réglages, Aide, Nouveautés, Confidentialité)                                                                                                                                                                                      |
| ≥ 1024 px                                                    | Rail de navigation à gauche avec les mêmes destinations ; contenu `max-width` inchangé                                                                                                                                                                                                                                         |
| Sous-navigation Investissement (contrôle segmenté)           | Positions (défaut, avec filtre « par plateforme ») · Opérations · Rapport · badge « À qualifier »                                                                                                                                                                                                                              |
| Sous-navigation Trading (contrôle segmenté)                  | Tableau de bord (défaut : équité, positions ouvertes, KPI — jamais de saisie) · Trades · Journal · Statistiques                                                                                                                                                                                                                |
| Routes (hash)                                                | `#/overview`, `#/invest`, `#/invest/asset/:code`, `#/invest/ops`, `#/invest/report`, `#/invest/import`, `#/invest/add` ; `#/trading`, `#/trading/trades`, `#/trading/trade/:id`, `#/trading/journal`, `#/trading/stats`, `#/trading/add` ; `#/accounts`, `#/settings`… — **anciens hashes redirigés** (liens Discord, favoris) |

Identité visuelle : une teinte d'accent par espace (onglet actif, liseré des cartes KPI), toujours
doublée d'une icône et d'un libellé (jamais la couleur seule, règle d'accessibilité existante).

**Vocabulaire — ne jamais mélanger**

| Investissement                                                                                       | Trading                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| position, quantité, **PRU**, coût total, valeur                                                      | **trade** (aller-retour), sens long/short, taille, prix d'entrée moyen / de sortie                |
| plus-value **latente**, **réalisée**, totale, ROI sur capital engagé                                 | **P&L net** (brut − frais ± funding), **R**, espérance, taux de réussite, profit factor, drawdown |
| un seul composant « période » partagé (Jour · Semaine · Mois · Année · Tout), préréglages par espace | idem + calendrier de P&L                                                                          |
| « Actualiser les prix »                                                                              | « Actualiser » (prix **et** synchronisation des comptes)                                          |

Un avoir spot sur Hyperliquid apparaît dans Trading comme « Avoirs spot » (quantité, valeur, prix
d'entrée moyen), sans le mot PRU ; si l'utilisateur coche « traiter le spot de ce compte comme de
l'investissement », ses fills spot alimentent l'espace Investissement (compte « Hyperliquid —
spot ») avec un vrai PRU, et disparaissent des aller-retours.

**Vue d'ensemble — contenu, dans l'ordre**

1. **Valeur nette** = valeur des positions Investissement + équité Trading (marge + latent perps +
   avoirs spot), variation sur la période, bouton « Actualiser » global (horodatage, source,
   badge périmé).
2. Deux cartes d'espace côte à côte (2 colonnes même en mobile) : _Investissement_ (valeur, latent,
   réalisé, ROI) · _Trading_ (équité, P&L net de la période, espérance en R, n trades, positions
   ouvertes) — chacune mène à son espace.
3. Alertes : position perp proche de la liquidation, drawdown au-delà d'un seuil, prix périmés,
   écarts de réconciliation, lignes à qualifier, synchronisation ancienne, sauvegarde ancienne.
4. Répartition du capital Investissement / Trading (barre), puis top actifs consolidés.
5. Flux entre espaces sur la période (capital envoyé vers le trading, rapatrié), transferts non
   appariés.
6. (Plus tard) courbe de valeur nette et rendement global XIRR (P10) — uniquement quand les deux
   historiques existent.

Ce qui est **sommé** : valeurs et équités (soldes, en devise d'affichage au taux du jour). Ce qui
reste **séparé, sans total** : plus-values d'investissement et P&L de trading — aucune référence du
marché ne fusionne ces deux résultats dans un chiffre (§ 2bis, point 1), et un total mixte
induirait en erreur (latent à levier + plus-value spot).

**Partition des données et du code (monolithe modulaire, additif — pas de réécriture)**

```
src/lib/domain/engine/      Investissement (inchangé : CUMP, lots, ROI)
src/lib/domain/trading/     Trading (aller-retours, journal, statistiques)       ← nouveau
src/lib/domain/overview/    Composition pure des deux rapports (valeur nette, flux, alertes) ← nouveau
src/lib/import/{coinhouse,manual,hyperliquid,pivot}/
src/state/shared.svelte.ts  comptes (avec leur espace), prix, FX, UI            ← extrait de app.svelte.ts
src/state/invest.svelte.ts  = l'actuel app.svelte.ts (clés de stockage conservées)
src/state/trading.svelte.ts bruts Hyperliquid (IndexedDB `crch-trading`), trades manuels, journal
src/lib/spaces.ts           registre des espaces : id, libellé, icône, route d'accueil, onglets,
                            auto-vérifications, exports — un futur module s'y déclare
src/routes/{Overview.svelte, invest/*, trading/*}  chunks chargés à la demande (budget Lighthouse)
```

- `StoredStateV1` garde ses clés actuelles (= espace Investissement) ; conteneurs additifs
  `accounts`, `trading`, `overview` ; bruts volumineux en IndexedDB ; sauvegarde JSON = tout.
- Auto-vérifications par espace (`self-check.ts` scindé) + une vérification de cohérence de la
  Vue d'ensemble (valeur nette = Σ des deux rapports).
- Transferts entre espaces : `transfer-out` / `transfer-in` appariés (actif, montant ± frais,
  fenêtre) — côté Investissement report de coût, côté Trading capital déposé ; visibles dans les
  deux historiques et dans la Vue d'ensemble.
- Mode démo : jeu synthétique **des deux espaces** (fixture Coinhouse existante + fixture
  Hyperliquid générée), sinon la Vue d'ensemble de démo serait vide à moitié.
- États vides : espace Trading sans compte → carte d'accueil « Ajouter une adresse Hyperliquid ·
  Saisir un trade · Importer un CSV ».

**Prêt pour le futur** : de nouveaux modules se déclarent dans `spaces.ts` sans toucher aux autres —
_Rendement / Staking_ (lignes Coinhouse à venir, P5 → sous-section « Revenus » d'Investissement),
_Fiscal_ (P13, lit Investissement), _On-chain_ (P25, comptes par adresse, routés vers l'un ou
l'autre espace), _Vaults HLP_ (sous-section Trading), autres venues de trading (CSV Binance Futures,
Bybit, Lighter…) via le format pivot.

Pièges à éviter : plus de 5 destinations en bas ; « PRU » sur un perp ; additionner un P&L USDC et
une plus-value EUR sans taux à la date ; casser les anciens liens ; une Vue d'ensemble qui recalcule
au lieu de composer les rapports existants.

### 6.1 Principes conservés et étendus

- **Source de vérité = données brutes par source** (décision n° 3) : lignes Coinhouse, fills/ledger
  Hyperliquid bruts, saisies manuelles, entrées de journal, qualifications, réglages. Tout le reste
  (événements, positions, aller-retours, statistiques) est recalculé au chargement.
- **Deux moteurs purs, sans Svelte/DOM, `big.js` seule dépendance** : `domain/engine` (inventaire
  spot, CUMP, lots — inchangé) et nouveau `domain/trading` (aller-retours, perps, journal, stats).
  Pourquoi séparer : `PositionState.dispose` bloque toute survente (`position.ts:131-165`), `pru`
  suppose `qty > 0`, et l'invariant `total = valeur + Σ produits − Σ achats` (`self-check.ts:69-73`)
  suppose que tout passe par `acquire`/`dispose` — un short perp casse les trois.
- **Comptes (venues) de première classe, chacun rattaché à un espace** (`space: 'invest' |
'trading'`) : tout événement porte un `accountId`. Dans Investissement, le PRU existe **par compte
  et consolidé** (un même actif sur Coinhouse et sur un compte manuel est fusionné dans la vue
  consolidée, séparé dans la vue par plateforme). Dans Trading, chaque compte a son équité, ses
  trades et ses statistiques ; les statistiques peuvent être filtrées par compte ou agrégées.
- **Rien ne quitte le navigateur** sauf les appels publics : adresse Hyperliquid envoyée à
  Hyperliquid seulement, stockée localement ; aucune clé API d'exchange dans l'app (cf. § 5).

### 6.2 Modèle de données (additions, `src/lib/domain/types.ts`)

```ts
export type EventSource = 'coinhouse-csv' | 'manual' | 'hyperliquid-api';   // ligne 57
export type AccountId = string;            // 'ch:main' | 'hl:0x…' | 'man:<uuid>'
export interface Account {
  id: AccountId; kind: 'coinhouse' | 'hyperliquid' | 'manual' | 'csv'; label: string;
  /** Espace d'appartenance : 'invest' (positions/PRU) ou 'trading' (aller-retours/journal). */
  space: 'invest' | 'trading';
  /** Trading seulement : router les fills spot « à garder » vers l'espace Investissement. */
  spotAsInvestment?: boolean;
  address?: string; createdAt: string;
}
// EventBase += accountId: AccountId  (les événements Coinhouse existants → 'ch:main',
// ManualEvent.scope 'external' → compte manuel par défaut ; migration additive)

/** Fill Hyperliquid conservé tel quel (chaînes), clé `hl:<adresse>:<tid>`. */
export interface RawHlFill { key; address; time: number; at: NaiveDateTime; market: 'spot' | 'perp';
  coin; base; quote; px; sz; side: 'A' | 'B'; dir; closedPnl; fee; feeToken; builderFee?; crossed;
  liquidation?; startPosition; oid; tid; hash; twapId? }
export interface RawHlFunding { key; address; time; at; coin; usdc; szi; fundingRate }
export interface RawHlLedger  { key; address; time; at; kind; asset; amount; usdc?; hash; fee? }

/** Exécution normalisée (spot ou perp), entrée du moteur trading. */
export interface Execution { id; accountId; at; time; market; symbol; side: 'buy' | 'sell';
  qty; price; notionalQuote; quote: 'USDC' | 'EUR' | …; feeQuote; feeNative?: { asset; qty };
  closedPnlQuote: DecimalString | null; liquidation: boolean; source: EventSource }

/** Aller-retour reconstruit (flat → position → flat ; un flip = clôture + ouverture). */
export interface RoundTrip { id; accountId; market; symbol; direction: 'long' | 'short';
  status: 'open' | 'closed'; openedAt; closedAt: NaiveDateTime | null; executions: string[];
  qtyMax; avgEntry; avgExit: DecimalString | null; grossPnlQuote; feesQuote; fundingQuote;
  netPnlQuote; quote; holdSeconds: number | null; liquidated: boolean }

/** Journal : ce que l'utilisateur ajoute, jamais recalculé. */
export interface JournalEntry { tradeId: string;          // RoundTrip.id ou trade manuel
  plan: { entry; stop; target; riskQuote } | null;         // → R = netPnl / riskQuote
  thesis: string; review: string; tags: string[]; setup: string | null;
  mistakes: string[]; rating: 1 | 2 | 3 | 4 | 5 | null; screenshotIds: string[] }
```

- Horodatage : Hyperliquid fournit un instant UTC en ms ; Coinhouse une heure locale naïve. Règle
  proposée (décision à consigner) : conserver `time` (ms) et dériver `at` en **heure de Paris**
  formatée en `NaiveDateTime` via `Intl.DateTimeFormat` (déterministe, sans `new Date()` sur des
  chaînes), pour que le tri mixte Coinhouse/Hyperliquid d'une même journée reste juste.
- Montants : l'API renvoie `px`/`sz`/`closedPnl` en chaînes → `Big` direct ; tout `number`
  (timestamps exceptés) passe par un convertisseur type `numberToDecimal` (`pricing/types.ts:13-20`).
- Vocabulaire : `RoundTrip` (journal) ≠ `TradeEvent` (swap du domaine, `types.ts:87-96`) — ne pas
  réutiliser le mot « trade » pour les deux dans le code.

### 6.3 Flux des données par type d'opération

| Donnée Hyperliquid                                                                   | Moteur inventaire (PRU)                                                                                                                                                      | Moteur trading                                                            | Cash / ROI                                        |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| Fill **spot** (`PURR/USDC`, `@index`)                                                | Seulement si `spotAsInvestment` : `TradeEvent` out/in, `valueEur` = notionnel USDC converti au taux BCE du jour, frais convertis (USDC ou HYPE au cours du moment)           | Par défaut : `Execution` → aller-retours spot + « Avoirs spot » du compte | —                                                 |
| Fill **perp**                                                                        | jamais                                                                                                                                                                       | `Execution` avec `closedPnlQuote`, `liquidation`                          | —                                                 |
| Funding (`userFunding`)                                                              | jamais                                                                                                                                                                       | attribué à l'aller-retour ouvert sur ce `coin` dans la fenêtre            | —                                                 |
| Dépôt / retrait USDC (`userNonFundingLedgerUpdates`)                                 | **pas** un achat de stablecoin (décision n° 7 nuancée : marge ≠ position)                                                                                                    | —                                                                         | flux de trésorerie du compte (base ROI, XIRR P10) |
| Transfert depuis un autre compte de l'utilisateur (ex. retrait Coinhouse → dépôt HL) | `transfer` apparié (actif, montant ± frais, fenêtre de temps) = **report de coût, pas de réalisation** ; non apparié → `deposit` à qualifier (flux « À qualifier » existant) | —                                                                         | neutre                                            |
| Sous-comptes, vaults HLP                                                             | adresses distinctes, à ajouter comme comptes séparés ; P&L de vault hors v1                                                                                                  | —                                                                         | —                                                 |

Réconciliations (auto-vérifications, `src/lib/support/self-check.ts`) : soldes spot calculés =
`spotClearinghouseState` (comme le contrôle de solde Coinhouse) ; compte perps :
`accountValue ≈ Σ dépôts − Σ retraits + Σ closedPnl − Σ frais + Σ funding + latent` — c'est aussi
ce qui tranchera empiriquement la question « `closedPnl` net ou brut de frais ».

### 6.4 Modules à créer / modifier

| Module                                                      | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Notes d'implémentation                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/import/hyperliquid/client.ts`                      | `info(type, body, signal)` : `fetch` POST, file d'attente sérialisée, backoff exponentiel + jitter sur 429, poids respectés                                                                                                                                                                                                                                                                                                                                                                                                                                       | Aucune dépendance ; types de réponse garantis par des gardes runtime                                                                                                                                                                 |
| `src/lib/import/hyperliquid/sync.ts`                        | Synchronisation **incrémentale** : `userFillsByTime` depuis le dernier `time` + 1 ms par pages de 2 000 ; idem funding et ledger ; `spotMeta` en cache 24 h ; dédoublonnage par `tid`/hash                                                                                                                                                                                                                                                                                                                                                                        | Persister les bruts : l'API ne garde que les fills récents, l'app devient la mémoire longue                                                                                                                                          |
| `src/lib/import/hyperliquid/normalize.ts`                   | bruts → `LedgerEvent[]` (spot) + `Execution[]` + flux de trésorerie                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Miroir de `import/coinhouse/normalize.ts` et `import/manual.ts:4`                                                                                                                                                                    |
| `src/lib/domain/trading/round-trips.ts`                     | Reconstruction des aller-retours par (compte, symbole) à partir de `startPosition` et des fills                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Tests de propriétés : Σ quantités entrées = Σ sorties sur un trade clos ; additivité du P&L ; flips                                                                                                                                  |
| `src/lib/domain/trading/stats.ts`                           | n, taux de réussite, profit factor, espérance (devise et R), gain/perte moyens, drawdown max de la courbe de P&L cumulé, séries, ventilation par tag / symbole / sens / jour / heure / durée, part des frais et du funding, **avertissement si n < 30**                                                                                                                                                                                                                                                                                                           | Tout en `Big` ; arrondi dans `format/` uniquement                                                                                                                                                                                    |
| `src/lib/domain/trading/journal.ts`                         | Fusion aller-retours + entrées de journal, calcul de R, écart plan / exécution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Pur                                                                                                                                                                                                                                  |
| `src/lib/domain/engine/*`                                   | `accountId` sur les événements ; positions **par compte** puis consolidation ; `HistoryEntry.source` réel (remplace `eventId.startsWith('man:')` dans `export/csv-export.ts:138`)                                                                                                                                                                                                                                                                                                                                                                                 | Refactor préalable, sans changement de résultat sur la fixture (oracle inchangé)                                                                                                                                                     |
| `src/lib/pricing/providers/hyperliquid.ts` + `defillama.ts` | `allMids` pour l'univers HL ; DefiLlama en filet long tail ; horodatage + source par cotation                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Chaîne câblée dans `app.svelte.ts:289` ; CSP `vite.config.ts:21`                                                                                                                                                                     |
| `src/lib/storage/schema.ts`                                 | Conteneurs additifs `accounts`, `journal`, `manualTrades`, curseurs de sync ; **bruts Hyperliquid en IndexedDB** (base dédiée, comme `crch-history`) car 10 000 fills ≈ plusieurs Mo > localStorage                                                                                                                                                                                                                                                                                                                                                               | À répercuter dans `withDefaults`, `sanitizeState`, `json-io.ts mergeStates` (sinon perte silencieuse à la restauration) ; la sauvegarde JSON inclut les bruts                                                                        |
| UI                                                          | Navigation à deux espaces + Vue d'ensemble (§ 6.0) : `Overview.svelte` ; espace Trading = tableau de bord (équité, P&L période, positions ouvertes, KPI), `trades`, `trade/:id` (détail + journal), `stats` ; **Comptes** (ajouter une adresse Hyperliquid, un compte manuel, choisir l'espace, option spot → investissement) ; formulaire « Ajouter un trade » (gabarit `routes/ManualEntry.svelte`) ; dans Investissement : filtre par compte, tableau « par plateforme » sur la page d'un actif ; bouton « Actualiser » avec « il y a N min · source » partout | Réutiliser `Money/Pct/Qty/Sheet/CoinBadge`, `EvolutionChart` (courbe d'equity), nouveau calendrier de P&L ; 2 colonnes en mobile ; chunks par espace chargés à la demande pour tenir le budget Lighthouse ; anciens hashes redirigés |
| Tests / CI                                                  | Fixture Hyperliquid **synthétique** générée par `scripts/generate-fixture.ts` (TWAP, rebate maker, liquidation, frais en HYPE, paire `@index`) ; stub `api.hyperliquid.xyz` dans `tests/e2e/helpers/network.ts` ; oracle indépendant des stats ; `coherence.spec.ts` étendu ; `scripts/api-contract.mjs` (`meta`, `spotMeta`, `allMids`) ; axe sur les nouvelles routes                                                                                                                                                                                           | Jamais de fixture capturée sur une adresse réelle (décision n° 17)                                                                                                                                                                   |
| Docs                                                        | `docs/hyperliquid-import.md` (sémantique des champs, comme `coinhouse-export.md`), DECISIONS n° 18-23, README, page Confidentialité (adresse publique)                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                    |

### 6.5 Décisions à consigner (`docs/DECISIONS.md`)

18. Comptes/plateformes de première classe ; PRU par compte et consolidé.
19. Perps hors moteur CUMP : moteur trading séparé ; jamais dans `investedTotal`/`proceedsTotal`.
20. Adresses publiques : stockées localement, envoyées à la seule API de leur plateforme.
21. Horodatage des sources « instant » : ms conservées, `at` dérivé en heure de Paris.
22. Transferts internes appariés = report de coût ; non appariés = dépôt à qualifier.
23. Statistiques de trading = standards de praticiens (espérance en R, profit factor…), affichées
    avec garde-fous d'échantillon, jamais présentées comme prédictives.

## 7. Propositions priorisées (même barème que `docs/ROADMAP.md` § 3 : Valeur, Fiabilité, Satisfaction /5 ; effort en sessions de 2-3 h ; ROI = somme ÷ sessions)

| #        | Proposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Val. | Fiab. | Satisf. |        Sessions        |  ROI   | Quand                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | :---: | :-----: | :--------------------: | :----: | ------------------------------------------------------------------ |
| **P23**  | **Bouton « Actualiser » v2** : horodatage + source + badge « périmé » par actif, bouton sur la synthèse et la page actif, fournisseurs Hyperliquid `allMids` (prix HYPE/PURR) et DefiLlama (long tail), clé CoinGecko Demo optionnelle en réglages, CSP mise à jour, contrat API monitoré                                                                                                                                                                                                                            |  3   |   4   |    4    |           1            | **11** | **Tout de suite** (réponse immédiate au membre, aucune dépendance) |
| **P19**  | **Espaces + comptes + navigation v2** : `Account` rattaché à un espace (Coinhouse, manuel, Hyperliquid, CSV), `accountId` sur les événements, PRU **par compte et consolidé** dans Investissement, barre de navigation « Vue d'ensemble · Investissement · Trading · Plus » avec anciens liens redirigés, registre `spaces.ts`, état scindé (`shared` / `invest` / `trading`), Vue d'ensemble v1 (Investissement seul + carte Trading « à venir »), provenance réelle dans les exports (corrige `csv-export.ts:138`) |  4   |   3   |    4    |           3            |  3,7   | Phase T0 (fondation, après P5)                                     |
| **P12'** | **Sauvegarde robuste** (roadmap P12) devient un **prérequis** : bruts Hyperliquid en IndexedDB, sauvegarde JSON complète, rappel iOS                                                                                                                                                                                                                                                                                                                                                                                 |  3   |   5   |    3    |           2            |  5,5   | Phase T1, juste avant P20                                          |
| **P20**  | **Import Hyperliquid lecture seule** : client `info` minimal, synchronisation incrémentale (fills spot + perps, funding, dépôts/retraits), résolution `spotMeta`, conversion USDC→EUR à la date, spot → moteur PRU, perps → moteur trading, réconciliations (soldes spot, valeur de compte), fixture synthétique, stub E2E, `docs/hyperliquid-import.md`                                                                                                                                                             |  5   |   3   |    5    |           4            |  3,3   | Phase T1                                                           |
| **P21**  | **Journal de trading** : aller-retours automatiques (flat → position → flat, flips, liquidations), saisie manuelle d'un trade en 20 s (mobile), notes « pourquoi » avant / revue après, tags et setups (liste courte par défaut), plan entrée / stop / cible → **R**, écart plan vs exécution                                                                                                                                                                                                                        |  5   |   2   |    5    |           3            |   4    | Phase T2                                                           |
| **P22**  | **Statistiques de performance** : n, taux de réussite, profit factor, espérance (€ et R), gain/perte moyens, drawdown max, séries, courbe d'equity, calendrier, ventilation par setup / actif / sens / jour / heure / durée, part des frais et du funding, **avertissement si n < 30**, export CSV/JSON du journal (colonnes TradesViz/Koinly)                                                                                                                                                                       |  5   |   2   |    4    |          2,5           |  4,4   | Phase T3                                                           |
| **P27**  | « Copier un résumé anonymisé de mes stats » à coller dans l'IA de son choix (revue assistée sans backend ni clé)                                                                                                                                                                                                                                                                                                                                                                                                     |  2   |   1   |    3    |          0,5           |   12   | Avec P22                                                           |
| **P28**  | **Vue d'ensemble v2** : valeur nette consolidée (positions + équité trading), cartes des deux espaces, répartition du capital, flux entre espaces et transferts appariés, alertes, « Actualiser » global, démo à deux espaces, vérification « valeur nette = Σ rapports »                                                                                                                                                                                                                                            |  4   |   3   |    5    |          1,5           |   8    | Phase T3 (dès que P20 + P21 existent)                              |
| **P24**  | **Import format pivot** (CSV Universal Koinly/Waltio, JSON Ghostfolio) + **virements internes appariés** + convertisseurs natifs à la demande (Kraken, Coinbase, Bitvavo, Revolut, Ledger Live : ≈ 0,5 session chacun, fixture synthétique obligatoire). **Remplace P17.**                                                                                                                                                                                                                                           |  4   |   3   |    3    | 3 (+0,5/convertisseur) |  3,3   | Phase T4                                                           |
| **P25**  | Lecture on-chain par adresse (BTC mempool.space, EVM Etherscan V2 / Blockscout) : soldes + mouvements, coût à qualifier                                                                                                                                                                                                                                                                                                                                                                                              |  2   |   2   |    3    |           3            |  2,3   | Plus tard, si demande                                              |
| **P26**  | Mode « live » WebSocket optionnel sur l'écran trading (prix et fills en direct)                                                                                                                                                                                                                                                                                                                                                                                                                                      |  2   |   1   |    2    |          1,5           |  3,3   | Plus tard                                                          |

**Ordre recommandé** : P23 (maintenant) → **P5 reste prioritaire** (lignes de staking Coinhouse
imminentes, roadmap phase 1) → P19 → P12' → P20 → P21 → P28 → P22 + P27 → P24 → P10 (XIRR/TWR, qui
profite des flux de trésorerie par compte) → P25/P26 si demande. Effort du tracker proprement dit
(P23 + P19 + P12' + P20 + P21 + P28 + P22) ≈ **17 sessions**, soit 35-50 h de développement
assisté, livrables un par un (chaque étape est utilisable seule : après P19 l'app a déjà sa
nouvelle navigation et sa Vue d'ensemble, après P20 le trading Hyperliquid est lisible, etc.).

**Ce qui n'est pas recommandé** (à ajouter au § 5 de la roadmap) : clés API d'exchange stockées
dans le site ; proxy CoinMarketCap ; `ccxt` dans le navigateur ; SDK Hyperliquid complet pour un
besoin lecture seule ; temps réel permanent par défaut ; fiscalité des perps en v1.

**Risques et parades** : volume de données (10 000 fills → IndexedDB, P12' d'abord) ; contrat API
Hyperliquid non versionné (monitor `api-contract.mjs` + gardes runtime + bruts conservés pour
rejouer) ; ambiguïté `closedPnl` net/brut (tranchée par la réconciliation de valeur de compte) ;
fuseau horaire mixte (décision n° 21) ; vie privée (adresse publique → page Confidentialité) ;
budget Lighthouse (route trading en chunk différé) ; sur-interprétation des stats (garde-fous
d'échantillon, libellés « standards de praticiens »).

## 8. Réponse proposée au membre (à coller dans Discord, à ajuster à votre ton)

> Merci pour la demande, elle est très claire et elle tombe bien : c'est exactement la direction
> qu'on voulait prendre. Concrètement, voilà ce qui est prévu et dans quel ordre :
>
> 1. **Bouton « Actualiser »** : oui, très vite. Petite précision : pas via CoinMarketCap — CMC
>    interdit les appels depuis un site (c'est bloqué dans le navigateur, pas un choix de notre
>    part). On utilise Coinbase, Kraken, CoinGecko et l'API Hyperliquid pour HYPE & co, et tu verras
>    pour chaque actif l'heure et la source du dernier prix.
> 2. **Tout au même endroit, mais pas mélangé** : l'app aura deux espaces bien séparés —
>    **Investissement** (tes positions spot avec PRU, plus-values, par plateforme et consolidé :
>    Coinhouse, saisie manuelle, autres exports) et **Trading** (tes trades, P&L, journal,
>    stats) — plus une **Vue d'ensemble** qui additionne ta valeur nette et met les deux côte à
>    côte. Pour Hyperliquid, tu colles simplement ton adresse publique : aucune clé, rien d'autre
>    ne quitte ton navigateur, l'outil ne peut rien faire d'autre que lire.
> 3. **Journal de trades** : entrées/sorties reconstituées automatiquement depuis tes fills
>    (spot et perps), gain/perte **net de frais et de funding**, note « pourquoi je prends ce
>    trade », tags/setups, et si tu renseignes entrée/stop/cible, ton résultat en R.
> 4. **Ce qui marche ou pas** : espérance par trade (en € et en R), profit factor, taux de réussite,
>    drawdown, ventilation par setup, actif, sens, jour, durée… avec un garde-fou honnête : en
>    dessous de ~30 trades, l'outil te dira que l'échantillon est trop petit pour conclure.
> 5. Les autres plateformes passeront par import CSV (export Koinly/Waltio ou export natif), pas par
>    des clés API stockées dans le site : on refuse de détenir le moindre secret.
>
> Ce qu'on ne fera pas : passer des ordres, alertes de prix (pas de serveur), fiscalité des perps.
>
> Pour bien cadrer, trois questions : tu trades surtout en **perps ou en spot** sur Hyperliquid ?
> Quelles **autres plateformes** tu utilises ? Tu veux bien être **testeur** (on ne verra jamais
> tes données : tu copies juste un diagnostic anonyme depuis l'app) ?

## 9. Décisions prises, décisions à prendre, prochaines étapes

**Décidé le 23/08/2026** : même app avec deux espaces et une Vue d'ensemble (pas deux apps) ;
version 1 figée (`v1.0.0`), développement de la version 2 sur la branche `v2`, déploiement de
`main` inchangé jusqu'à la sortie de la V2.

**Reste à trancher par le propriétaire** (recommandation en premier) :

- Ordre : garder P5 avant P19/P20 (recommandé : les lignes de staking Coinhouse arrivent) ou faire
  passer Hyperliquid devant.
- Périmètre Hyperliquid v1 : spot + perps (recommandé, c'est l'usage majoritaire) ou spot seulement.
- Journal : captures d'écran stockées localement (IndexedDB, poids) dès P21 ou plus tard
  (recommandé : plus tard).
- Spot Hyperliquid : dans Trading par défaut avec option « traiter comme de l'investissement » par
  compte (recommandé) ou toujours dans Investissement.

**Prochaines étapes** : P23 (bouton « Actualiser » v2, 1 session) en premier, puis P5 (import v2
Coinhouse) comme prévu dans la roadmap, puis P19 → P12' → P20 → P21 → P28 → P22 + P27 → P24.
Chaque session part de ce document et de `docs/ROADMAP.md`, sans nouvelle recherche.

## Sources (consultées le 23/08/2026)

### [B] Benchmark trackers et journaux

- [B1] rotki — https://rotki.com/
- [B2] GitHub rotki/rotki — https://github.com/rotki/rotki
- [B3] CoinStats, « Top 11 Crypto Trackers of 2026 » (01/08/2026) — https://coinstats.app/blog/best-crypto-portfolio-trackers/
- [B4] Blacknewfie, « CoinStats vs Delta » — https://blacknewfie.substack.com/p/coinstats-vs-delta-which-crypto-portfolio
- [B5] Slashdot, CoinStats vs Delta — https://slashdot.org/software/comparison/CoinStats-vs-Delta-Crypto/
- [B6] GitHub ghostfolio/ghostfolio — https://github.com/ghostfolio/ghostfolio
- [B7] Pocket Portfolio, import Ghostfolio — https://www.pocketportfolio.app/import/ghostfolio
- [B8] Ghostfolio, discussion #1927 — https://github.com/ghostfolio/ghostfolio/discussions/1927
- [B9] Capitally, comparatif Kubera (21/07/2025) — https://www.mycapitally.com/blog/best-portfolio-tracker-for-the-modern-diy-investor
- [B10] PortfolioGlance, Kubera review 2026 — https://www.portfolioglance.com/investing-apps/kubera
- [B11] Cryptoactu, avis Finary 2026 — https://cryptoactu.com/avis/finary/
- [B12] Waltio, portfolio tracker — https://www.waltio.com/fr/blog/portfolio-tracker-suivre-wallets-crypto/
- [B13] Divly, comparatif France 2026 — https://divly.com/fr/guides/divly-comparison-france-1
- [B14] CoinGecko Portfolio — https://www.coingecko.com/en/portfolio
- [B15] CoinMarketCap Portfolio — https://coinmarketcap.com/events/portfolio/
- [B16] TradeZella, « Best Trading Journal Software 2026 » — https://www.tradezella.com/blog/best-trading-journal-software
- [B17] Tradervue, « 7 Best Trading Journals » — https://www.tradervue.com/blog/best-trading-journal
- [B18] TradeZella, « Edgewonk vs TradeZella » — https://www.tradezella.com/blog/edgewonk-vs-tradezella
- [B19] TradeZella, « TradeZella vs TraderVue » — https://www.tradezella.com/blog/tradezella-vs-tradervue
- [B20] Mastery Trader Academy, TradeZella vs Tradervue — https://masterytraderacademy.com/tradezella-tradervue-trading-journals/
- [B21] TradesViz, courtier Hyperliquid — https://www.tradesviz.com/brokers/Hyperliquid
- [B22] TradesViz, MFE & MAE — https://www.tradesviz.com/blog/mfe-mae-charts/
- [B23] TradesViz, référence statistiques — https://www.tradesviz.com/blog/charts-statistics-reference/
- [B24] GASPNTRADER, Hyperliquid — https://gaspntrader.com/brokers/hyperliquid
- [B25] Hyper Trader — https://hypertrader.info/
- [B26] Dexly, Hyperliquid Explorer — https://dexly.trade/hyperliquid/explorer
- [B27] HyperTracker — https://hypertracker.io/
- [B28] Coin Market Manager, journal automatisé — https://coinmarketman.com/en/blog/automated-crypto-trading-journal/
- [B29] Coinwire, Coin Market Manager review 2025 — https://coinwire.com/coin-market-manager-review/
- [B30] TraderLion, R et R-multiples — https://traderlion.com/risk-management/r-and-r-multiples/
- [B31] Van Tharp Institute, Tharp Think — https://vantharpinstitute.com/tharp-think-trading-concepts/
- [B32] PnL Ledger, expectancy & R-multiples — https://www.pnlledger.com/expectancy-r-multiples-the-plain-english-guide/
- [B33] Edgewonk, « 10 Most Important Trading Metrics » (17/02/2025) — https://edgewonk.com/blog/the-ultimate-guide-to-the-10-most-important-trading-metrics
- [B34] Edgewonk, Profit Factor — https://edgewonk.zendesk.com/hc/en-us/articles/360010087620-Profit-Factor
- [B35] Koinly, CSV personnalisé — https://support.koinly.io/en/articles/9489976-how-to-create-a-custom-csv-file-with-your-data
- [B36] TradeZella, « AI Trading Journal » — https://www.tradezella.com/blog/ai-trading-journal-how-ai-replaces-manual-logging
- [B37] Lunefi, « Best Trading Journal with AI 2026 » — https://lunefi.com/blog/best-trading-journal-with-ai-2026-top-tools-features-pricing-reviews

Non couvert par le benchmark (budget) : sites officiels Waltio/Finary/Kubera, méthodes de
cost-basis de CoinTracker/Koinly.

### [P] API de prix (sondes CORS du 23/08/2026 = [PE])

- [P1] CoinMarketCap API FAQ (CORS non supporté côté client) — https://coinmarketcap.com/api/faq/
- [P2] CoinMarketCap, tarifs et crédits — https://coinmarketcap.com/api/pricing/ ; https://coinmarketcap.com/academy/article/how-to-understand-api-credits-rate-limits-and-pagination
- [P3] CoinGecko, limite du plan public — https://support.coingecko.com/hc/en-us/articles/4538771776153 ; https://www.coingecko.com/learn/best-free-crypto-api
- [P4] CoinGecko, tarifs API (Demo : 100 req/min, 10 k/mois) — https://www.coingecko.com/en/api/pricing
- [P5] DefiLlama, FAQ API — https://docs.llama.fi/faqs/frequently-asked-questions
- [P6] Jupiter, Price API et limites — https://developers.jup.ag/docs/price ; https://dev.jup.ag/portal/rate-limit
- [P7] CoinPaprika, comparatif 2026 (non vérifié empiriquement) — https://coinpaprika.com/education/best-crypto-api-2026/
- [P8] CoinCap v3 (clé obligatoire) — https://pro.coincap.io/api-docs/
- [P9] Messari, limites — https://docs.messari.io/reference/rate-limits
- [P12] Cloudflare Workers, limites du palier gratuit — https://developers.cloudflare.com/workers/platform/limits/
- [P13] CoinDesk Data (ex-CryptoCompare), fin du gratuit — https://data.coindesk.com/press-releases/cryptocompare-adds-commercial-api-market-data-service-to-existing-free-service
- [PE] Sondes `curl -H "Origin: https://jeremyh974.github.io"` : CMC 401/200 sans ACAO ; CoinGecko `*` ; Coinbase Exchange/v2 `*` ; Kraken origine reflétée ; Binance `*` ; Bitstamp aucun en-tête ; OKX/Bybit origine reflétée ; DefiLlama `*` ; Pyth `*` ; Hyperliquid `/info` `*` ; CryptoCompare 401 sans ACAO ; Frankfurter `*`.

### [H] Hyperliquid (docs officielles consultées le 23/08/2026)

- [H1] Info endpoint (vue d'ensemble) — https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- [H2] Info endpoint / Perpetuals — https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
- [H3] Info endpoint / Spot — https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot
- [H4] Notation — https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/notation
- [H5] Rate limits and user limits — https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits
- [H6] WebSocket / Subscriptions — https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
- [H7] QuickNode (miroir), userFills — https://www.quicknode.com/docs/hyperliquid/info-endpoints/userFills
- [H8] Chainstack / sqd.dev (miroirs, sémantique `dir`, `crossed`, `liquidation`) — https://docs.chainstack.com/reference/hyperliquid-info-user-fills ; https://sqd.dev/learn/hyperliquid-perps-data
- [H9] SDK `@nktkas/hyperliquid` — https://github.com/nktkas/hyperliquid ; https://www.npmjs.com/package/@nktkas/hyperliquid
- [H10] SDK `hyperliquid` (npm) — https://www.npmjs.com/package/hyperliquid
- [H11] HypurrScan, API publique — https://api.hypurrscan.io/ui/
- [H13] Export CSV de l'app (sources secondaires : Cryptact, Hypedexer) — non vérifié
- [H15] Fees (réduction via staking HYPE) — https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees (non fetchée directement)
- [PE] Sonde CORS `POST /info` `{"type":"allMids"}` avec `Origin: https://jeremyh974.github.io` → `access-control-allow-origin: *` (sonde du 23/08/2026)

### [A] Agrégateur multi-plateformes (consultées le 23/08/2026 ; sondes CORS = [A30])

- [A1] ADAN / Deloitte / Ipsos, « Web3 et crypto en France et en Europe » (2025) — https://adan.eu/en/publication/survey-2024-web3-and-crypto-in-france-and-europe/
- [A2] Journal du Coin, « 1 Français sur 10 détient de la crypto » (rapport ADAN 2025) — https://journalducoin.com/actualites/1-francais-sur-10-detient-crypto-selon-rapport-annuel-adan/
- [A3] KPMG France, chiffres clés crypto — https://kpmg.com/fr/fr/insights/crypto/crypto-france-etude-kpmg-adan.html
- [A4] CoinAcademy, « Après Binance, quelle plateforme MiCA choisir en France ? » (2026) — https://coinacademy.fr/academie/apres-binance-quelle-plateforme-crypto-agreee-mica-choisir-france/
- [A5] Cyril Jarnias, « Binance quitte la France en 2026 » — https://cyriljarnias.fr/binance-retrait-france-mica-alternatives-regulees/
- [A6] CryptoPulse Info, plateformes MiCA au 01/07/2026 — https://cryptopulseinfo.com/psan-mica-etat-lieux-post-1-juillet-2026/
- [A7] CryptoActu, 33 plateformes autorisées AMF (2026) — https://cryptoactu.com/guides/plateformes-psan-amf-france/
- [A8] Waltio, fichier Coinhouse — https://help.waltio.com/en/articles/5177093-coinhouse-file
- [A9] Waltio, fichier Koinly — https://help.waltio.com/en/articles/13368700-koinly-file
- [A10] Bitvavo, export d'historique — https://support.bitvavo.com/hc/en-us/articles/24858391166097
- [A11] Bitvavo, API — https://docs.bitvavo.com/
- [A12] Kraken, création de clé API (permissions) — https://support.kraken.com/articles/360000919966-how-to-create-an-api-key
- [A13] vdegenne/kraken-api-browser (CORS refusé) — https://github.com/vdegenne/kraken-api-browser
- [A14] Coinbase Developer Docs, CORS — https://docs.cdp.coinbase.com/coinbase-business/api-architecture/cors
- [A15] Koinly, CSV personnalisé (Universal) — https://support.koinly.io/en/articles/9489976-how-to-create-a-custom-csv-file-with-your-data
- [A16] Koinly, virements entre ses propres wallets — https://support.koinly.io/en/articles/9490024-how-koinly-handles-transfers-between-your-own-wallets
- [A17] dickwolff/Export-To-Ghostfolio — https://github.com/dickwolff/Export-To-Ghostfolio
- [A18] ghostfolio/ghostfolio — https://github.com/ghostfolio/ghostfolio
- [A19] rotki/rotki — https://github.com/rotki/rotki
- [A20] eprbell/dali-rp2 — https://github.com/eprbell/dali-rp2
- [A21] eprbell/rp2 — https://github.com/eprbell/rp2
- [A22] BittyTax/BittyTax — https://github.com/BittyTax/BittyTax
- [A23] portfolio-performance/portfolio — https://github.com/portfolio-performance/portfolio
- [A24] wealthfolio/wealthfolio — https://github.com/wealthfolio/wealthfolio
- [A25] MyCapitally, trackers privés 2026 (Actual Budget E2EE ; non vérifié en détail) — https://www.mycapitally.com/blog/best-private-portfolio-tracker
- [A26] ccxt, issues #3193 et #2097 (CORS navigateur) — https://github.com/ccxt/ccxt/issues/3193 ; https://github.com/ccxt/ccxt/issues/2097
- [A27] mempool/mempool — https://github.com/mempool/mempool
- [A28] Etherscan V2, limites (gratuit : 5 req/s, 100 k/jour) — https://docs.etherscan.io/etherscan-v2/rate-limits
- [A29] Blockscout, API REST — https://docs.blockscout.com/devs/apis
- [A30] Sondes `curl -H "Origin: https://jeremyh974.github.io"` (aucun identifiant envoyé) : Kraken `OPTIONS /0/private/Balance` 404 sans CORS ; Binance `OPTIONS /api/v3/account` 204 `*` sans `Allow-Headers` pour la clé ; Coinbase `OPTIONS /api/v3/brokerage/accounts` 200 sans `Allow-Origin` ; Bitvavo `OPTIONS /v2/balance` 405 ; mempool.space 200 `*` ; Blockscout 200 `*` ; Etherscan V2 200 `*` ; Solana RPC public 403.

Non couvert (budget) : Boursorama/BoursoBank, Crypto.com, détail MetaMask/Phantom, RPC EVM
génériques, Helius, standard « OCTF », CRDT d'Actual Budget.

### [U] Séparation investissement / trading — produits et guides UX (consultées le 23/08/2026)

- [U1] Binance Support, Wallet Overview — https://binance.com/en/support/faq/how-to-check-balance-and-transfer-funds-on-wallet-overview-b10712050ff945089aea7160f5e8f6b6
- [U2] Binance Support, Futures/Options PNL Analysis — https://www.binance.com/en/support/faq/how-are-pnl-calculated-on-binance-futures-and-options-pnl-analysis-dbb171c4db1e4626863ec8bc545be46a
- [U3] Binance Support, Spot Wallet PNL — https://www.binance.com/en/support/faq/how-to-view-my-binance-spot-wallet-pnl-c681d247dde746b7833426fd6a7e09fc
- [U4] Coinbase Developer Docs, Advanced Trade Portfolios — https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/guides/portfolios
- [U5] Coinbase Help, portefeuilles multiples (non vérifié, 403) — https://help.coinbase.com/en/coinbase/trading-and-funding/advanced-trade/multiple-portfolios
- [U6] Kraken Support, wallets sur Kraken Pro — https://support.kraken.com/articles/understanding-wallets-kraken-pro
- [U7] Kraken Support, performance du portefeuille sur Kraken Pro — https://support.kraken.com/hc/en-us/articles/portfolio-performance-on-kraken-pro
- [U8] eToro Help, Smart Portfolios (non vérifié, 403) — https://help.etoro.com/en-us/s/article/what-are-smart-portfolios-US
- [U9] eToro Help, historique (non vérifié) — https://help.etoro.com/en-us/s/article/how-can-i-view-my-trading-history-US
- [U10] Trading 212, changer de compte — https://helpcentre.trading212.com/hc/en-us/articles/8614634278685-How-to-switch-between-my-accounts
- [U11] Trading 212, déplacer du cash — https://helpcentre.trading212.com/hc/en-us/articles/360007139978-Can-I-move-cash-between-the-accounts
- [U12] Trading 212, déplacer des titres — https://helpcentre.trading212.com/hc/en-us/articles/30334253768605-Can-I-move-shares-between-my-Trading212-accounts
- [U13] Hyperliquid Docs, Portfolio graphs — https://hyperliquid.gitbook.io/hyperliquid-docs/trading/portfolio-graphs
- [U14] Hyperliquid Docs, Portfolio margin — https://hyperliquid.gitbook.io/hyperliquid-docs/trading/portfolio-margin
- [U16] Kubera, Delta vs Blockfolio vs Kubera — https://www.kubera.com/blog/delta-vs-blockfolio-vs-kubera
- [U18] elest.io, Ghostfolio (source secondaire, non vérifié) — https://blog.elest.io/ghostfolio-free-open-source-privacy-first-portfolio-wealth-tracker/
- [U19] TradeZella, « Trading Dashboard: 8 KPIs That Actually Matter » — https://www.tradezella.com/blog/trading-dashboard
- [U20] TradeZella, fonctionnalités — https://www.tradezella.com/features
- [U21] Tradervue, 7 Best Trading Journals of 2026 — https://www.tradervue.com/blog/best-trading-journal
- [U22] Apple HIG, Tab bars — https://developer.apple.com/design/human-interface-guidelines/components/navigation-and-search/tab-bars
- [U23] Material Design 3, Navigation bar — https://m3.material.io/components/navigation-bar/overview
- [U24] Material Design 3, Navigation rail — https://m3.material.io/components/navigation-rail/guidelines
- [U25] Nielsen Norman Group, « Tabs, Used Right » — https://www.nngroup.com/articles/tabs-used-right/
- [U26] Nielsen Norman Group, Progressive Disclosure — https://www.nngroup.com/videos/progressive-disclosure/
