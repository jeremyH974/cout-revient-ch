# Changelog

Toutes les évolutions notables de ce projet sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions : [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

## [2.10.0] - 2026-08-26

### Added

- **Serveur MCP local** : Claude (Code ou Desktop) peut désormais LIRE votre portefeuille et
  répondre à « quel est mon PRU sur BTC ? », « combien de frais cette année ? », « que donnerait la
  vente de la moitié à 90 000 € ? ». Rien ne quitte votre machine : le serveur lit une sauvegarde
  de l’app, calcule avec le même moteur et n’ouvre aucune connexion réseau. Sept outils, tous en
  **lecture seule** (aucun ordre, aucune écriture), et chaque réponse porte la date de la
  sauvegarde et celle des cours utilisés. Aucune dépendance ajoutée : le transport du protocole
  est écrit à la main. Détail : docs/mcp.md, décision n° 47.

## [2.9.0] - 2026-08-26

### Added

- **Mode « Plan mensuel » du simulateur (P32)** : « si je verse X par mois pendant N mois », avec
  une hypothèse de prix que VOUS choisissez (de −50 % à +100 %). L’app en tire le PRU projeté, la
  quantité acquise, les frais et le latent. **Un scénario, pas une prévision** : la variation est
  répartie linéairement, et le PRU obtenu dépend du chemin autant que du point d’arrivée — le repère
  Vanguard (2023) est cité pour que l’étalement ne passe pas pour une martingale. Décision n° 46.

## [2.8.0] - 2026-08-26

### Added

- **Alertes v2 (P35)** : une règle peut désormais **expirer** (sans limite, 1, 2, 3 ou 6 mois — une
  alerte oubliée finit par se déclencher pour une raison qui n’a plus rien à voir avec l’intention
  de départ) et porter une **condition supplémentaire** sur l’indice Fear & Greed : les deux termes
  doivent être vrais en même temps. Une condition non satisfaite bloque le déclenchement sans
  désarmer la règle ; sans contexte de marché disponible, la règle reste dormante et le dit. Ces
  règles sont évaluées **app ouverte seulement** : le service worker ne sait comparer qu’un prix à
  un seuil. Décision n° 45.

## [2.7.0] - 2026-08-26

### Added

- **Contexte de marché (P34), opt-in** : l’indice Fear & Greed du jour s’affiche sur la Vue
  d’ensemble quand vous cochez le réglage correspondant (décoché par défaut). Il décrit l’humeur du
  marché entier, pas votre portefeuille, et ne dit pas quoi en faire. La requête ne transporte
  aucune de vos données ; la source (alternative.me) est citée à l’écran comme ses conditions
  l’exigent. Décision n° 44.

## [2.6.0] - 2026-08-26

### Added

- **Estimation fiscale française (P30)** — la brique que personne n’offre en méthode française.
  Dans le **simulateur**, en mode « Vendre » avec sortie en euros, un dépliant donne la plus-value
  imposable estimée et l’effet de la vente sur l’impôt de l’année (supplément dû, réduction si la
  vente dégage une moins-value, exonération sous 305 €, ou année nette perdante). Dans le
  **rapport** (écran et PDF), une section « Fiscalité française (estimation) » récapitule les trois
  derniers millésimes et le prix total d’acquisition restant. Méthode GLOBALE de l’article 150 VH
  bis : la plus-value porte sur le portefeuille entier, pas sur le PRU d’un actif ; seules les
  sorties vers l’euro sont imposables, les échanges entre actifs numériques (stablecoins compris)
  restent en sursis ; taux par millésime (30 % jusqu’aux cessions 2024, 31,4 % ensuite) ;
  moins-values imputables sur la seule année, sans report. Quand une valeur manque, l’app le dit
  au lieu d’inventer une plus-value. **Estimation, ni déclaration ni conseil fiscal** — faites
  vérifier votre situation par un professionnel. Détail : `docs/tax-fr.md`, décision n° 43.
- **Nouveau constat « Fiscalité de l’année »**.

## [2.5.1] - 2026-08-26

### Added

- **Historique de prix profond** : les courbes ne s'arrêtent plus à un an. Un quatrième
  fournisseur (DefiLlama) complète Coinbase, Kraken et CoinGecko lorsque ceux-ci butent sur leur
  profondeur — 365 jours pour CoinGecko, 721 points pour Kraken. Le rendement pondéré par le temps,
  le repère, la section « Risque » et la fiche actif remontent désormais jusqu'à la première
  opération du grand livre, y compris pour les actifs peu courants et ceux qui ne sont plus cotés.
  Il est interrogé en dernier : les trois autres cotant nativement en euros, on leur laisse la
  priorité et la conversion au taux BCE du jour n'intervient que sur ce qu'eux seuls ne couvrent
  pas. Un jour sans taux de change laisse son point de côté plutôt que d'afficher une valeur
  approximative (docs/DECISIONS.md n° 42).

## [2.5.0] - 2026-08-26

### Added

- **Section « Risque » dans le rapport (P31)**, écran et PDF : repli maximal avec ses dates et la
  date de retour au niveau, repli en cours, volatilité annualisée, ratio de Sortino, jours gagnants
  et perdants. **Ces mesures portent sur l’indice de performance, apports et retraits neutralisés**
  — un virement ne compte pas comme une baisse, à la différence de ce que montre un solde de compte.
  Sortino plutôt que Sharpe (pas de taux sans risque à inventer) ; volatilité annoncée à partir de
  30 jours de recul seulement. Détail : `docs/risk.md`, décision n° 41.
- **Anneau de répartition** dans le rapport (SVG maison, aucune dépendance) et tableau « Répartition »
  trié de la plus grosse part à la plus petite. L’anneau est décoratif : le tableau reste la source
  lisible par un lecteur d’écran.
- **Deux nouveaux constats** : « Repli maximal » et « Vos trois premiers actifs »
  (`docs/insights.md`).

## [2.4.0] - 2026-08-26

### Added

- **Section « Constats » (P33)** : l'app tire de vos chiffres des observations en une phrase, avec
  le nombre qui les fonde — frais payés sur 12 mois et leur part du volume, rentabilité de l'offre
  Coinhouse, concentration du portefeuille, rendement personnel (XIRR), résultat encaissé, actifs
  qui pèsent le plus en bien et en mal, mise de départ déjà récupérée, part des stablecoins, lignes
  à qualifier, actifs sans cours. Visibles sur la **Vue d'ensemble** (les 6 principales, avec un
  bouton « Copier »), dans le **Rapport** (toutes, plus le repère « mêmes apports en BTC ») et dans
  le **PDF**. Un constat constate : il ne recommande jamais d'acheter, de vendre ni d'arbitrer
  (frontière information / conseil, doctrine AMF du 04/08/2026). Détail : `docs/insights.md`,
  décision n° 40.
- **Étude « aide à la décision »** (26/08/2026) : panorama sourcé des concurrents France et monde,
  des références hors crypto, du cadre AMF/MiCA et de la fiscalité 2026, avec six briques chiffrées
  P30-P35 — `docs/proposals/2026-08-26-aide-a-la-decision.md`.

## [2.3.0] - 2026-08-25

### Added

- **Section « Abonnement Coinhouse » dans le rapport** (écran et PDF) : l'offre est **déduite de
  votre export** (Classique, Investisseur ou Gestion Privée, d'après les lignes d'abonnement
  facturées) ; les **remises de frais** réellement obtenues, les abonnements payés et la
  **rentabilité de l'offre** (remises − abonnements, sur 12 mois glissants et depuis le début) ;
  l'estimation « qu'aurait coûté la grille Classique sur les mêmes opérations » ; et, pour un
  compte Classique, le **volume annuel à partir duquel l'offre Investisseur (118,80 €/an) se
  rembourserait** à votre taux de frais effectif observé. Tout est déduit des données — rien
  n'est demandé — et chaque estimation est annoncée comme telle. Décision n° 39.

### Changed

- **Feuille « Créer une alerte » repensée** : les quatre types d'alerte deviennent des cartes
  expliquées en une ligne chacune (le groupe de boutons radio, visuellement cassé, est remplacé) ;
  une **jauge** situe d'un coup d'œil le PRU, le seuil et le prix actuel avec la zone de
  déclenchement teintée ; unités (€, $, %) affichées dans les champs ; un dépliant « Comment
  fonctionne le déclenchement ? » explique franchissement, ré-armement à 1 % et délai d'une heure.
- **Simulateur plus lisible et plus sûr** : position résumée en trois repères (Détenu, PRU,
  Investi — avec l'équivalent en euros du PRU quand l'affichage est en dollars : le PRU en
  dollars bouge avec le taux BCE du jour, celui en euros non) ; **équivalent « ≈ x BTC » sous le
  montant saisi** (fini le 0,5 $ tapé en croyant saisir 0,5 BTC) ; unités dans tous les champs ;
  états vides qui annoncent ce que le calcul produira ; variation de PRU masquée quand elle
  arrondit à zéro ; exposition avant → après affichée avec le résultat d'achat ; prix d'équilibre
  mis en évidence côté vente. Aucun changement de calcul — moteur, seuils et règles inchangés.

## [2.2.0] - 2026-08-25

### Added

- **Alertes et simulateur en dollars, avec le toggle de devise** : quand l'affichage est en
  dollars, les feuilles saisissent et affichent en dollars (taux BCE du jour, comme le reste de
  l'app) — le moteur reste en euros. Un seuil « Prix exact » tapé en dollars est **ancré en
  dollars** (comme une alerte de paire chez un exchange) : le montant garde son sens quand
  l'euro-dollar bouge ; sans taux connu, la règle est « dormante » et le dit. Aperçu bi-devise
  (dollars + euros), historique converti au taux du jour de chaque événement. Décision n° 37,
  propriété vérifiée : évaluer un seuil `$` au taux r ≡ évaluer le seuil `€ = $ ÷ r`.
- **Vérification opportuniste des alertes app fermée** (Chrome/Edge, PWA installée) : quand la
  veille et les notifications système sont activées, le navigateur peut réveiller le service
  worker de temps en temps (Periodic Background Sync) pour comparer les seuils **précalculés en
  euros** aux prix CoinGecko et notifier — à sa fréquence, jamais garantie, et l'interface le dit
  avec ces mots. Le service worker compare en décimal exact (jamais de flottant sur un montant,
  équivalence avec le moteur prouvée par propriétés) et ne ré-arme jamais ; les déclenchements
  sont journalisés par l'app à l'ouverture. Rien de plus ne sort de l'appareil que la veille
  classique (identifiants d'actifs seuls) — page Confidentialité mise à jour. Décision n° 38.
- **Proposition chiffrée** pour la suite (`docs/proposals/2026-08-push-et-mcp.md`, sources
  vérifiées le 25/08/2026) : émetteur Web Push opt-in (Cloudflare Worker + VAPID, 0 €/mois en
  free tier, 3-5 j, seuils hors de l'appareil) contre serveur MCP local en lecture seule
  (0 €, 1,5-2,5 j, rien ne sort) — recommandation : MCP local d'abord.

## [2.1.0] - 2026-08-25

### Added

- **Alertes de prix relatives au PRU** (`#/invest/alerts`, aussi depuis la fiche de chaque actif) :
  « sous le PRU de X % », « objectif PRU +X % », « objectif **net de frais de vente** » (grille
  Coinhouse du 18/08/2026, modifiable) ou prix exact. Déclenchement au **franchissement** (jamais
  de rappel en boucle), « une fois » ou récurrente avec ré-armement à marge de 1 % et au plus un
  déclenchement par heure et par règle ; les seuils relatifs **suivent votre PRU** — un nouvel
  achat les déplace d'eux-mêmes. Centre d'alertes (déclenchements récents, historique), pastille
  d'application, notifications système **opt-in** (le clic ramène à l'app), veille des prix
  opt-in (cadence 1 à 15 min, app ouverte). 100 % local : aucun serveur ne connaît vos seuils —
  en contrepartie, pas de notification quand l'app est fermée, et l'interface le dit.
- **Simulateur « et si ? »** sur chaque actif et depuis chaque alerte : **rachat** (nouveau PRU,
  frais Coinhouse virement/carte ou personnalisés), **vente** (produit net, résultat réalisé net
  de frais, **prix d'équilibre frais inclus**, « récupérer ma mise », sortie en euros ou en
  stablecoin avec rappel du sursis fiscal de l'art. 150 VH bis), et **objectif de PRU** (montant à
  investir pour amener le PRU à une cible). Mêmes règles de calcul que le moteur, vérifié par
  tests de propriétés.
- Échelle de prise de profit en un geste : trois alertes PRU +25 % / +50 % / +100 %.

## [2.0.0] - 2026-08-24

### Added

- Rendement hors apports (TWR) dans la synthèse du Rapport (écran et PDF), à côté du XIRR : taux
  insensible à la date de vos versements, chaîné jour par jour ; leur écart mesure l'effet du
  « moment » de vos apports. Annualisé au-delà de 30 jours, cumulé en dessous.
- Repère « mêmes apports en BTC » : vos apports et retraits réels rejoués aux mêmes dates sur le
  bitcoin, avec la valeur obtenue et l'écart. Les retraits impossibles et les flux hors profondeur
  de cotation sont signalés, jamais avalés.
- Suivi d'un **portefeuille Bitcoin entier** à partir de sa clé publique étendue (zpub, ypub, xpub) :
  toutes les adresses sont dérivées **dans votre navigateur** (la clé n'est envoyée nulle part),
  balayage jusqu'à 20 adresses vides consécutives, mouvements nets sur l'ensemble du portefeuille —
  une dépense qui vous rend la monnaie compte pour une seule sortie. Une clé privée étendue est
  refusée à la saisie.
- Secours pour les comptes on-chain EVM : Routescan sans clé (Ethereum), et une clé d'explorateur
  facultative (Etherscan V2 ou Blockscout Pro) dans les Réglages — clé de lecture seule, sans accès
  aux fonds. L'API publique Blockscout, utilisée par défaut, a été basculée vers une offre à clé par
  son éditeur : l'application ne dépend plus d'un seul chemin, et la surveillance prévient si celui
  sans clé s'arrête.
- Fonds EVM reçus **via un contrat** (pont, DEX, vault) désormais visibles : ils n'apparaissaient
  dans aucun flux jusqu'ici.
- Interrupteur « Trades en direct » (opt-in) sur l'écran Trading : vos exécutions et votre funding
  arrivent par WebSocket dès qu'ils ont lieu, sans cliquer « Actualiser ».
- Convertisseurs natifs supplémentaires : **Binance** (les trois exports : Transaction History et
  les deux Trade History), **Bitpanda** (préambule et lignes actions/ETF écartées) et **SwissBorg**
  (colonnes dont le nom change avec la devise du compte). Binance ayant cessé ses services en France
  le 1ᵉʳ juillet 2026, récupérer cet historique avant qu'il ne devienne inaccessible est une
  urgence pratique.
- Convertisseurs natifs d'import pour Kraken, Coinbase, Bitvavo, Ledger Live et Revolut : même
  compte, mêmes règles de valorisation et de virements appariés que l'import pivot ; dédoublonnage
  par hachage du contenu natif de la ligne, une correction de convertisseur ne duplique jamais une
  ligne déjà importée.
- Import JSON d'activités Ghostfolio (BUY/SELL/DIVIDEND/INTEREST/FEE) dans le même compte que les
  CSV pivot et les convertisseurs natifs.
- Rendement personnel annualisé (XIRR) dans la synthèse du Rapport (écran et PDF) : taux pondéré par
  les flux réels du grand livre (méthode Excel, base 365), masqué sous 30 jours d'historique ou sur
  des flux non calculables plutôt qu'un chiffre trompeur.
- Suivi en lecture seule d'adresses publiques on-chain (Bitcoin via mempool.space, Ethereum/
  Arbitrum One/Base via Blockscout) depuis l'écran Comptes : mouvements sans valeur EUR, candidats à
  l'appariement de virement ou lignes à qualifier ; jetons ERC-20 reconnus par liste blanche
  d'adresses de contrats, jamais par symbole affiché.
- Interrupteur « Prix en direct » (opt-in) sur l'écran Trading : cotations Hyperliquid par WebSocket
  pour les actifs détenus, jamais activées par défaut, jamais écrites dans le cache de prix persisté.
- Espace Trading complet : tableau de bord (synthèse dépôts nets / équité / P&L total, courbe
  d'équité et de P&L fournie par la plateforme et conservée hors ligne, résultat par période,
  positions ouvertes en tableau — taille · entrée, marque · liquidation, valeur, latent et % sur
  marge — reliées à leur aller-retour, avoirs spot, auto-vérification de réconciliation), onglets
  Trades, Fills et Statistiques.
- Graphique du détail d'un trade : prix quotidien de l'actif sur la fenêtre du trade, marqueurs
  d'entrées/sorties et lignes de niveau comme sur la plateforme (entrée moyenne, prix de
  liquidation, stop et objectif du plan).
- Journal de trading : aller-retours reconstruits automatiquement depuis les fills (retournements,
  liquidations, historique partiel signalé), saisie manuelle d'un trade, thèse/revue, setups,
  erreurs, note, plan entrée / stop / objectif → résultat en R, export CSV des trades.
- Statistiques de performance : espérance (devise et R), taux de réussite, profit factor, payoff,
  drawdown maximal, séries, ventilations (setup, actif, sens, jour, heure, durée, compte),
  avertissement d'échantillon sous 30 trades clos, résumé anonymisé à coller dans une IA.
- Vue d'ensemble au format synthèse : valeur nette (investissement + équité de trading), colonnes
  par espace, répartition du capital et flux vers/depuis le trading.
- Rail de navigation à gauche sur grand écran (≥ 1024 px).

- Bouton « Actualiser » sur la synthèse avec fraîcheur et source des prix, badge « périmé ».
- Fournisseurs de prix Kraken, Hyperliquid (HYPE, PURR et tokens spot Hyperliquid) et DefiLlama,
  prix en USD convertis au taux BCE du jour.
- Clé CoinGecko Demo optionnelle dans les réglages.
- Navigation en espaces : Vue d'ensemble (accueil), Investissement, Trading (en préparation), Plus ;
  anciens liens (`#/asset/btc`, `#/import`…) toujours valables.
- Comptes : écran « Comptes » (Plus), rattachement des saisies manuelles à un compte, filtre
  « Plateforme » sur les positions avec PRU par plateforme, colonne « Compte » dans l'export des
  opérations.
- Sauvegarde robuste : état principal dans IndexedDB (plus de plafond de 5 Mo), miroir localStorage,
  sauvegarde automatique dans un dossier choisi (Chrome/Edge), chiffrement optionnel de la
  sauvegarde par phrase secrète, partage vers Fichiers et rappel « écran d'accueil » sur iPhone.
- Import Hyperliquid en lecture seule par adresse publique (jamais de clé) : synchronisation
  incrémentale des fills spot et perps, du funding et des mouvements du compte, bruts persistés pour
  dépasser la fenêtre d'historique conservée par l'API.
- Espace Trading : tableau de bord par compte Hyperliquid — équité, P&L net par période (réalisé
  brut − frais + funding), positions ouvertes, avoirs spot, derniers fills, réconciliation
  permanente de l'équité affichée à l'écran.
- Option « traiter le spot comme de l'investissement » sur un compte Hyperliquid : route ses fills
  spot vers le PRU de l'espace Investissement, contrepartie USDC convertie en euros au taux BCE du
  jour.
- Moteur Trading séparé du moteur d'investissement (`domain/trading`), jamais mêlé au PRU.
- Import CSV « pivot » (CSV Universal Koinly, ou export interne Koinly lu aussi par Waltio) dans des
  comptes dédiés de l'espace Investissement, multi-plateformes : dédoublonnage par hachage de
  contenu, ré-import idempotent, écran « À qualifier » partagé avec l'import Coinhouse.
- Virements internes appariés entre deux comptes (retrait sans produit et dépôt sans coût du même
  actif, fenêtre 72 h, écart ≤ frais réseau) : le coût d'acquisition voyage vers le dépôt, aucune
  plus-value fantôme ; correction manuelle et auto-vérification dans l'écran Comptes.
- Export « Format Koinly / Waltio (CSV) » (Réglages) : toutes les opérations de l'app au format CSV
  Universal, valeurs EUR déjà calculées, réimportable dans un autre outil.
- Calendrier de P&L dans Trading → Statistiques : P&L réalisé net par jour de clôture, navigation
  par mois, jour cliquable vers ses trades.

### Fixed

- **Calendrier de P&L : les gains et pertes tombaient au mauvais jour.** Tout le résultat d'un
  aller-retour était affiché le jour de sa clôture. Une position allégée sur plusieurs jours
  montrait donc 0 € les jours de prise de bénéfice puis tout d'un bloc le dernier jour, les frais et
  le funding d'une position encore ouverte n'apparaissaient nulle part, et le total du mois ne
  correspondait ni à votre plateforme ni au tableau de bord de l'application. Chaque montant est
  désormais daté du jour où il a été réalisé, et cliquer sur une journée détaille ce que chaque
  trade a réalisé **ce jour-là**.
- Un virement interne apparié à cheval sur deux jours (retrait le soir, dépôt le surlendemain)
  creusait un trou dans la courbe d'évolution : la valeur du portefeuille tombait à zéro puis
  revenait, alors que les coins n'avaient jamais quitté votre patrimoine.

### Changed

- **L'application est désormais organisée en deux espaces séparés** — « Investissement » (vos
  positions, votre PRU, vos plus-values) et « Trading » (vos aller-retours, votre P&L, votre
  journal) — reliés par une **Vue d'ensemble** qui additionne votre valeur nette. On additionne des
  soldes, jamais des résultats de nature différente : une plus-value spot et un P&L à levier ne se
  mélangent nulle part. Vos données de la version 1 sont reprises telles quelles, sans rien à
  refaire ; les anciens liens (`#/portfolio`, `#/report`…) continuent de fonctionner.

## [1.1.0] - 2026-08-23

### Added

- Écran « À qualifier » guidé : un choix cohérent avec les jambes de l'opération (récompense,
  dépôt, retrait, achat ou vente hors plateforme, échange, ou ignorer), un montant facultatif ou
  requis selon le choix, une qualification annulable à tout moment depuis le portefeuille.
- Table de libellés extensible (`row-types.ts`) avec des suggestions pré-sélectionnées pour les
  nouveaux types annoncés par Coinhouse en 2026 (staking, parrainage…), jamais appliquées sans
  confirmation.
- Section « Revenus (récompenses) » dans le portefeuille.
- Message dédié quand le fichier importé est l'« Export basique » Coinhouse (sans la contre-valeur
  en euros) plutôt que l'avancé, avec la marche à suivre.

### Changed

- Un libellé `Staking` seul n'est plus interprété automatiquement comme une récompense : Coinhouse
  ne l'a pas confirmé sur un export réel, il reste à qualifier (avec « Ignorer » suggéré).

## [1.0.0] - 2026-08-23

### Security

- Données d'exemple entièrement synthétiques : le jeu de démonstration (et fixture de tests) est
  désormais inventé par un générateur déterministe (`npm run fixture`) ; l'ancien export « anonymisé »,
  dérivé d'un export réel par une transformation réversible, est retiré du dépôt et de son historique.
- Chaîne d'approvisionnement : scripts d'installation npm désactivés et délai de 7 jours avant toute
  nouvelle version (`.npmrc`), même délai côté Dependabot, actions GitHub épinglées par empreinte de
  commit, ajout de CodeQL, de la revue des dépendances sur les pull requests et du Scorecard OpenSSF
  (badges dans le README).

### Changed

- ROI rapporté au capital maximal engagé (portefeuille : apports − retraits en euros à leur plus
  haut ; actif : achats − produits à leur plus haut) au lieu de « Σ achats », qui comptait plusieurs
  fois le même euro transitant par l'USDC et se diluait à chaque rachat (docs/DECISIONS.md n° 15).
- « Investi » ne couvre plus que les positions cotées (même périmètre que « Valeur », donc
  Latent = Valeur − Investi) ; le coût des actifs sans prix est annoncé à part.

### Fixed

- Moteur (audit + oracle indépendant) : une migration à coût reporté n'est plus comptée comme un
  achat et un produit ; les remises de frais sont converties au taux implicite des frais Coinhouse
  (plus de frais net négatif de quelques millièmes) ; à la même seconde, un échange qui produit du
  cash/stablecoin précède celui qui en consomme ; une migration depuis un actif à historique
  incomplet crée quand même l'actif reçu (coût 0, avertissement) ; les apports/retraits en euros
  d'une opération non appliquée ne sont plus comptés ; un actif entièrement « à qualifier » est
  signalé par le contrôle de solde ; une cotation sans date fiable est convertie au dernier taux
  BCE connu ; vendre une poussière d'un actif jamais détenu est un historique manquant, pas un
  arrondi.
- Exports CSV : arrondi au plus proche (demi vers le haut) comme à l'écran, quantités à 9
  décimales, prix et PRU à 10 (PEPE/BONK ne sont plus tronqués).
- Accessibilité : la liste des positions est une vraie liste de liens (plus de rôles de tableau
  incorrects sur des liens), avec des libellés lus par les lecteurs d'écran (quantité, prix, valeur,
  latent, réalisé, total) ; l'en-tête visuel de colonnes est décoratif.
- Logos des cryptos : chargement immédiat (plus de `loading="lazy"`, qui laissait les badges vides
  dans un onglet masqué) et un réessai automatique en contournant les caches avant de retomber sur
  les initiales ; les échecs restants sont listés dans le diagnostic copiable (URL et statut HTTP)
  pour identifier les blocages côté navigateur.

### Added

- Bouton « Rapport PDF » en tête de la carte Synthèse du portefeuille (il n'était proposé qu'en pied
  de page).
- Test de cohérence transversale (`tests/e2e/coherence.spec.ts`) : synthèse, lignes, positions
  clôturées, fiche actif, onglet Calcul, rapport, export CSV et graphique doivent donner les mêmes
  chiffres, à l'arrondi près ; rejouable localement sur un export réel.
- Amélioration continue : section « Vérifications automatiques » (cohérence comptable, lots,
  soldes, opérations à qualifier, prix, sauvegarde) avec rappel en pied de portefeuille ; oracle
  indépendant qui recalcule tout depuis le CSV ; signalement GitHub pré-rempli avec le diagnostic ;
  page « Nouveautés » (changelog dans l'application) et bandeau à chaque mise à jour ; page
  d'erreur avec « Réessayer » et diagnostic (erreurs récentes capturées) ; surveillance
  automatique toutes les 6 h du site en ligne et des API de prix avec issue ouverte/refermée
  automatiquement ; seuils de couverture bloquants.
- Qualité automatisée : tests de bout en bout Playwright (Chromium desktop et mobile, WebKit sur
  les parcours visuels) sur le build de production — démo, import par fichier, PRU comparés au
  moteur, fiche actif, exports CSV/PDF, sauvegarde → effacement → restauration, thème et mode
  discret, diagnostic, accessibilité axe (WCAG 2.2 AA) sur toutes les pages, manifeste/service
  worker/CSP sans erreur console, tout réseau externe stubé ; Lighthouse CI avec seuils ; tests de
  propriétés fast-check sur les invariants du moteur (total = valeur + produits − achats, PRU
  invariant à la vente, lots réconciliés, survente bloquée). La CI ne déploie que si tout est vert.
- Mode démo : « Essayer avec des données d'exemple » sur l'accueil charge l'export anonymisé du
  dépôt (chunk séparé, chargé à la demande) avec un bandeau « Données d'exemple (fictives) » et un
  bouton « Quitter la démo » ; importer un fichier, saisir une opération ou restaurer une sauvegarde
  efface d'abord les données fictives (préférences d'affichage conservées) ; sauvegardes préfixées
  `demo-`.
- Aide et retours : section dans les réglages (et sur la carte d'échec d'import) avec un diagnostic
  copiable qui ne contient ni montant ni quantité (version, commit déployé, navigateur, colonnes des
  fichiers importés, compteurs, statuts d'intégrité, libellés d'opérations inconnus) et un lien vers
  les gabarits de signalement GitHub (fichier non reconnu, bug, idée) ; `SECURITY.md`.
- Graphiques : couleur par zone — vert en gain, rouge en perte, avec bascule exacte au
  croisement de la référence (zéro pour le latent, capital investi pour la valeur, PRU pour le
  prix) ; PRU tracé en trait plein avec étiquette et zone gain/perte entre prix et PRU ; légende ;
  PRU et prix rappelés dans l'en-tête et l'infobulle ; « PRU vs prix » par défaut sur un actif.
- Bascule de thème clair / sombre / système dans la barre ; couleur de la barre du navigateur
  mobile suit le thème.
- Cartes « Évolution » (portefeuille et actif) : courbe reconstituée jour par jour à partir des
  quantités réellement détenues × prix historiques (Coinbase Exchange, Kraken, CoinGecko ; cache
  IndexedDB), périodes 1J · 1S · 1M · 3M · 1A · Tout, métriques valeur / latent € / latent % /
  PRU vs prix, performance de période hors apports, marqueurs d'achats/ventes, export CSV de la
  série.
- Exports CSV : positions, opérations normalisées avec PRU après chaque ligne, lots ouverts,
  historique d'un actif — dans la devise affichée (voir `docs/exports.md`).
- Devise d'affichage EUR/USD : chaque mouvement converti au taux de référence BCE de son jour
  (Frankfurter, sans clé, cache incrémental inclus dans la sauvegarde) ; prix actuels au dernier
  taux ; bascule dans la barre et les réglages.
- Vrais logos des cryptos (62 SVG, web3icons MIT / cryptocurrency-icons CC0), repli sur les
  initiales pour les tickers sans source libre.
- Import de l'export Coinhouse (CSV reçu par e-mail) : détection du format par en-têtes,
  opérations à deux jambes, migrations (delisting + migration), abonnements, ré-import idempotent.
- Moteur : PRU = coût moyen pondéré all-in invariant à la vente, lots au prorata,
  réalisé / latent / total par actif, ROI, net investi, contrôle de cohérence par la colonne
  « Solde », stablecoins en section à part.
- Écrans mobile-first façon eToro : portefeuille (investi / valeur / P&L total), détail par actif
  (historique avec PRU après chaque ligne, positions, « comment c'est calculé »), saisie manuelle,
  réglages, aide, confidentialité.
- Prix en direct (CoinGecko groupé, repli Coinbase), prix manuels, cache hors ligne.
- Sauvegarde / restauration JSON, export CSV pour Excel, mode discret, PWA installable avec
  invite de mise à jour, image Open Graph pour Discord.
- Rapport de portefeuille en PDF (page de garde, synthèse, répartition, positions ouvertes,
  stablecoins, positions clôturées, méthodologie), généré dans le navigateur avec jsPDF chargé à
  la demande ; vue imprimable `#/report` de repli (« Imprimer / Enregistrer en PDF »), mode discret
  respecté.
- Squelette : Vite 8 + Svelte 5 + TypeScript, lint/format/typecheck/tests, CI GitHub Actions avec
  déploiement sur GitHub Pages.
