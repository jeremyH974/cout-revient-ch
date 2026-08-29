# Feuille de route — **livré (29/08/2026)**s classées par ROI (23 août 2026)

> Question traitée : « Comment améliorer le produit ? Recherches en ligne sourcées et à jour, **livré (29/08/2026)**s
> classées par ROI (qualité, fiabilité, satisfaction des utilisateurs), ordre d'exécution, pour un
> commanditaire non développeur. »
>
> Méthode : audit mesuré du produit en ligne (Lighthouse, tests, couverture, poids, dépôt) + trois
> recherches documentaires menées le 23/08/2026 (≈ 490 pages lues, sources primaires privilégiées :
> Légifrance, BOFiP, impots.gouv, Coinhouse, App Store, WebKit, GitHub, npm, docs des API). Les
> numéros `[S…]` renvoient à la liste des sources en fin de document. Ce qui n'a pas pu être vérifié
> est signalé comme tel.

> **Complément du 23/08/2026 — version 2** : la demande d'un membre du Discord (tracker des
> investissements spot et des trades, journal, statistiques) et l'exigence du propriétaire de séparer
> clairement « Investissement » et « Trading » font l'objet d'une **livré (29/08/2026)** dédiée, sourcée, dans
> [`docs/proposals/2026-08-23-espaces-investissement-trading.md`](proposals/2026-08-23-espaces-investissement-trading.md).
> Ses propositions P19-P28 sont reprises ci-dessous (§ 3 bis et phase T). La version 1 est figée
> (`v1.0.0`) ; la version 2 se développe sur la branche `v2`.

> **Complément du 26/08/2026 — aide à la décision** : étude sourcée (concurrents France/monde,
> inspirations hors-concurrence, cadre AMF/MiCA, fiscalité 2026, faisabilité données) et briques
> P30-P35 dans
> [`docs/proposals/2026-08-26-aide-a-la-decision.md`](proposals/2026-08-26-aide-a-la-decision.md).
> Au passage : le volet « abonnement rentable ? » de P7 est livré (2.3.0, décision n° 39) ; le
> spread implicite par opération reste à faire ; P11, P15 et le reliquat de P28 (courbe de valeur
> nette) sont refondus dans P31.
>
> **P33 (constats automatiques) est livré** en 2.4.0 le 26/08/2026 —
> [`docs/insights.md`](insights.md), décision n° 40. **P31 (risque et structure) est livré** en
> 2.5.0 le 26/08/2026 — [`docs/risk.md`](risk.md), décision n° 41 : repli maximal, volatilité,
> Sortino, régularité (tous mesurés sur l'indice de performance), anneau de répartition et
> tableau trié. Reste de P31 : la **courbe de valeur nette consolidée** (investissement +
> trading), qui exige un historique de l'équité de trading inexistant à ce jour — reportée avec
> P28. Restent ensuite, dans cet ordre : P30 (aperçu fiscal avant cession), P35 (alertes v2),
> P32 (projections), P34 (contexte de marché).
>
> **P30 (aperçu fiscal avant cession) est livré** en 2.6.0 le 26/08/2026 —
> [docs/tax-fr.md](tax-fr.md), décision n° 43. Le formulaire 2086 pré-rempli et la réconciliation
> DAC8 restent le périmètre de P13.
>
> **P34, P35 et P32 sont livrés** le 26/08/2026 (2.7.0 à 2.9.0, décisions n° 44 à 46) : contexte de
> marché opt-in, expiration et conditions composées des alertes, mode « Plan mensuel » du
> simulateur. **Les six briques de l’étude sont donc livrées.** Restent en réserve : la courbe de
> valeur nette consolidée (avec P28), le rapport 2086 et la réconciliation DAC8 (P13), le spread
> implicite par opération (P7), et le serveur MCP local (proposition du 25/08).
>
> **P38 (courbe de valeur nette consolidée) est livré** le 26/08/2026 — décision n° 51. Au passage,
> le motif du report était **faux** : l'historique d'équité de trading n'était pas « inexistant »,
> il est récupéré à chaque synchronisation depuis le point d'entrée `portfolio` d'Hyperliquid,
> persisté, et déjà tracé sur l'écran Trading. Le vrai obstacle était l'incompatibilité des deux
> séries — l'une quotidienne et calculée, l'autre irrégulière, sous-échantillonnée et servie par la
> plateforme — résolue par un rééchantillonnage au jour. La série est écrite `Σ contributions −
Σ passifs` dès l'origine pour que **P36, P37 et P41 s'y branchent sans réécriture**.

> **P9 (carte de partage) est livré** le 27/08/2026 — décision n° 53. Deux découvertes au passage :
> la CSP du site publié refuse `blob:` dans `img-src`, si bien qu'un aperçu en `blob:` reste vide
> **sans erreur** — et comme cette CSP n'est injectée qu'au build, le développement ne montre rien ;
> et l'absence de montant est désormais une **propriété testée**, pas une intention. La feuille de
> route est close pour P8, P38, P7 (livré par la PR #16) et P9.

> **La Vue d'ensemble est devenue un tableau de bord d'aide à la décision** le 27/08/2026 —
> décisions n° 55 et 56, PR #21, documentée dans [`tableau-de-bord.md`](tableau-de-bord.md).
> Elle a d'abord corrigé un défaut de P38 : la courbe de référence traçait le **coût des positions
> détenues** et l'appelait « apports nets », le trading n'y contribuant rien. L'écart annoncé comme
> le gain valait `latent + équité de trading entière`, et une vente à perte faisait **baisser** la
> référence — la moins-value réalisée disparaissait du tableau. Les apports sont désormais des
> **flux externes cumulés**, des deux côtés, et deux auto-vérifications le prouvent, dont celle qui
> compare le résultat déduit des apports à « réalisé + latent » calculé lot par lot.
> Le reste suit l'**ISO 24896:2026** : un chiffre domine, une seule période gouverne l'écran, aucun
> chiffre n'est écrit deux fois, la couleur est réservée aux variances.
> **Reste ouvert** : les avoirs spot d'un compte de trading ne sont toujours pas comptés dans le
> patrimoine sauf option « traiter le spot comme de l'investissement » — cohérent (ils sortent des
> apports en même temps que de la valeur) mais incomplet.

## 1. État des lieux (mesuré le 23/08/2026)

**Forces**

- Site en ligne : Lighthouse mobile **98 / 100 / 100 / 100** (performance, accessibilité, bonnes
  pratiques, SEO), aucun audit en échec ; premier affichage 1,5 s ; 86 Ko compressés pour l'app, le
  module PDF (130 Ko) n'étant chargé qu'à la demande.
- 123 tests automatisés verts, couverture 85 % (moteur de calcul 92–95 %, export 94 %, prix 95 %).
- Fonctionnel déjà au niveau ou au-dessus des trackers payants sur le cœur : PRU all-in invariant aux
  ventes, lots par achat, réalisé/latent/total, ROI, net investi, EUR/USD mouvement par mouvement,
  graphiques 1J→Tout avec PRU, vert/perte par zone, CSV, PDF, PWA, thème, mode discret, contrôle des
  soldes, aperçu Discord (Open Graph) déjà en place.

**Faiblesses mesurées**

| Constat                                                                                                                                   | Pourquoi c'est un risque                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Aucun test de bout en bout (navigateur réel), aucun contrôle d'accessibilité ni Lighthouse en CI                                          | Une régression d'interface ou d'import passe inaperçue ; le commanditaire ne code pas et ne peut pas relire le code. |
| Couverture faible sur l'import CSV (66 %, branches 19 %), le change (75 %) et le stockage (74 %)                                          | C'est précisément là que l'export Coinhouse peut changer.                                                            |
| Dépendances : pas de délai de sécurité ni de blocage des scripts d'installation ; actions GitHub épinglées par version, pas par empreinte | Les attaques npm de 2025-2026 ont touché des paquets que ce projet utilise indirectement (voir §2.4).                |
| Aucun canal de retour : 0 issue, Discussions désactivées, pas de lien « signaler un problème » dans l'app                                 | Impossible de savoir si un membre du Discord bloque à l'import.                                                      |
| Pas de mode démo                                                                                                                          | Un membre doit d'abord demander son export par e-mail avant de voir quoi que ce soit.                                |
| Écran « À qualifier » minimal : les opérations inconnues sont listées mais pas qualifiables                                               | Les nouveaux types d'opérations Coinhouse (staking, parrainage…) resteront bloqués.                                  |
| 8 logos manquants (BONK, EURCV, FLOKI, HYPE, ONDO, SKY, USDS, WIF) ; historique > 1 an indisponible pour EURCV et GMX                     | Finition visible ; courbe « Tout » tronquée pour ces actifs.                                                         |
| Pas de rendement « vrai » (XIRR/TWR), pas de comparaison à un benchmark, pas de répartition, pas de partage en image                      | Ce sont les fonctions les plus visibles chez les trackers 2026 (§2.3).                                               |

## 2. Ce qui a changé autour du produit

### 2.1 Coinhouse (2026)

- L'app Coinhouse affiche elle-même, depuis la version 5.3.0 (05/05/2026), des **performances par
  crypto et par période**, sans documenter la méthode ; puis **staking flexible** (5.8.0, 22/06),
  **espace « produits de rendement »** (5.9.1, 03/07) et **retraits de staking** (5.12.0, 10/08) [S1].
  Staking annoncé sur ETH, SOL, ADA, SUI, AVAX, NEAR, DOT, ATOM, APT, POL avec récompenses
  quotidiennes [S2]. Conséquence : **des lignes d'un type encore jamais vu arriveront dans les exports
  des membres dans les semaines qui viennent** (libellés non documentés publiquement).
- Export : deux variantes, « Export basique » (CSV filtré) et « Export avancé » (informations
  comptables détaillées), envoyées par e-mail [S3] ; Waltio exige l'export avancé et une interface en
  français [S4] — des en-têtes en anglais sont probables pour un utilisateur ayant l'app en anglais
  (non vérifié). Toujours **aucune API** (confirmé par Finary en février 2026 [S5], Koinly sans
  intégration [S6]).
- Grille tarifaire publiée le 18/08/2026 : achat 0,99 % (CB 1,99 %), vente 1,29 %, crypto→crypto
  0,79 %, stable→stable 0,19 %, + 0,12 € fixe par transaction, retrait réseau + 0,29 % [S7]. Le spread
  n'apparaît nulle part ; Coinhouse répond sur Trustpilot que le prix affiché est « une moyenne entre
  le prix d'achat et de vente », les clients mesurent 1,45 % à ≈ 2 % [S8].
- Pas de rapport fiscal Coinhouse : le blog du 24/06/2026 renvoie vers Waltio, Divly, Koinly, Blockpit,
  Finary [S9]. Agrément MiCA (PSCA) le 07/05/2026 [S10].
- Voix du client (Play Store, Trustpilot, forums) : « le prix de revient n'est pas calculé. Cela
  m'oblige à entretenir un classeur Excel » [S11], « la performance des investissements est très mal
  visualisée » [S11], plaintes récurrentes sur le spread non affiché [S8] et sur l'affichage EUR/USD.
  → Exactement le périmètre de cet outil.

### 2.2 Fiscalité française (pour un futur mode fiscal « estimation »)

- Art. 150 VH bis CGI, version en vigueur au 01/07/2026 : plus-value = prix de cession − (prix total
  d'acquisition × prix de cession ÷ valeur globale du portefeuille au jour de la cession) ; échanges
  crypto↔crypto (dont vers USDC/EURCV) en sursis ; seuil de 305 € de cessions par an ; moins-values
  non reportables [S12] [S13].
- **Taux : PFU 31,4 %** (12,8 % + prélèvements sociaux 18,6 %) depuis la LFSS 2026 (CSG capital
  portée à 10,6 %), applicable dès les revenus 2025 ; confirmé par la FAQ impots.gouv mise à jour le
  17/07/2026 [S14] [S15]. L'option barème devient révocable pour les revenus 2026 (LF 2026) [S16].
  Attention : certaines pages du BOFiP (30-30, 23/04/2024) indiquent encore 30 %.
- Formulaire 2086 millésime 2026 : 5 cessions par page (date, valeur globale du portefeuille, prix de
  cession, prix total d'acquisition…) [S17].
- **DAC8** : CGI art. 1649 AC bis à sexies en vigueur au 01/01/2026 ; les plateformes déclareront
  avant le 15 juin 2027 les opérations 2026 (montants bruts, unités, nombre de transactions, valeur de
  marché par crypto-actif) [S18] [S19]. Selon notre lecture du texte, les clients français de
  Coinhouse sont concernés. Aucun pré-remplissage du 2086 annoncé.
- Concurrents payants : Waltio 39–999 €/an [S20], Koinly 49–279 $/an [S21], Blockpit 49–549 €/an
  [S22]. Un mode « estimation » gratuit, limité à Coinhouse, a donc une vraie valeur, à condition
  d'être clairement étiqueté.

### 2.3 Marché des trackers (ce que font les meilleurs en 2026)

- Métriques : les outils sérieux affichent **deux rendements** — pondéré par le temps (TWR) et
  pondéré par l'argent (MWR/XIRR) — car ils divergent et déroutent (« perdu 17 €, IRR −3,6 %, TTWROR
  +1,9 % » [S23]) ; Vanguard présente au particulier un « personal rate of return » = XIRR [S24] ;
  la norme GIPS impose le TWR aux gérants mais reconnaît le MWR pour le résultat réel du client
  [S25] ; Ghostfolio est critiqué pour n'offrir que le TWR [S26]. Kubera compare au S&P 500 et au
  BTC [S27] ; **aucun tracker trouvé ne propose « si j'avais fait le même DCA sur BTC »**.
- Partage : Binance/OKX/CoinStats génèrent une **image de P&L** avec choix des informations incluses
  [S28] [S29] [S30] ; Coinbase ne partage que des pourcentages d'allocation, jamais les soldes [S31] ;
  la leçon Wordle (résultat partageable sans détails) a fait passer le jeu de 300 000 à 10 M de
  joueurs en un mois [S32]. Discord lit Open Graph (1200×630) et la couleur de thème [S33].
- Adoption : démo sans compte chez Ghostfolio [S34], réclamée chez Finary [S35] ; outils « sans compte,
  données sur l'appareil » explicitement recherchés en 2026.
- Frustrations récurrentes des utilisateurs de trackers : PRU faux après synchronisation (Finary
  [S36]), coût d'acquisition à 0 → « gains fantômes » (Koinly [S37]), imports cassés par un nom de
  fichier ou un ordre de colonnes (Waltio [S4]), perte de données (Delta [S38]), fuites (Waltio,
  janvier 2026, ≈ 50 000 utilisateurs [S39]). Notre architecture locale-first répond à la dernière ;
  les autres dictent les priorités ci-dessous.
- Mobile : tableaux → cartes, en-têtes figés, colonnes priorisées [S40] (déjà appliqué).

### 2.4 Socle technique 2026

- **Chaîne d'approvisionnement npm** : vers Shai-Hulud (sept. et nov. 2025 [S41]), axios compromis le
  30/03/2026 [S42], **retour de Shai-Hulud le 04/08/2026** sur keyv/cacheable/flat-cache/
  file-entry-cache — des dépendances indirectes d'ESLint, donc de ce projet — plus de 1 300 versions
  touchées [S43]. Parades disponibles gratuitement : délai de sécurité Dependabot (3 jours par défaut
  depuis le 14/07/2026, réglable [S44]), `min-release-age` et `ignore-scripts` dans npm 11 [S45],
  épinglage des actions par empreinte SHA [S46], revue des dépendances, CodeQL, Scorecard [S47] [S48].
- **Qualité automatisée** : Playwright 1.62 (tests de bout en bout, traces) [S49], Vitest 4.1 (mode
  navigateur, captures de référence) [S50], axe-core pour l'accessibilité [S51] ; la catégorie PWA de
  Lighthouse a disparu en 2024, à remplacer par un test du manifeste/service worker [S52].
- **Accessibilité** : l'European Accessibility Act (applicable depuis le 28/06/2025) ne vise pas une
  app gratuite et bénévole [S53] ; WCAG 2.2 AA reste la bonne cible volontaire (cibles ≥ 24 px, focus
  visible, jamais la couleur seule pour le signe) [S54].
- **iOS 26** : tout site ajouté à l'écran d'accueil s'ouvre comme une app [S55] ; Safari efface le
  stockage d'un site non installé après 7 jours sans visite [S56] ; Web Share avec fichiers
  fonctionne sur iOS/Android [S57] ; l'accès au système de fichiers (sauvegarde automatique sur
  disque) n'existe que sur Chrome/Edge desktop [S58] [S59].
- **Versions** : TypeScript 7.0 (08/07/2026) n'a pas encore d'API stable pour les outils Svelte/ESLint
  → rester en 5.9/6.0 jusqu'à TS 7.1 [S60] [S61] ; Node 24 passe en maintenance le 20/10/2026, Node 26
  devient LTS le 28/10/2026 [S62] ; GitHub retire Node 20 de ses runners à l'automne 2026 [S63] ;
  Vite 8 / Svelte 5 sont à jour [S64] [S65].
- **Données de prix** : CoinGecko sans clé ≈ 10–30 appels/min et historique limité à 365 jours,
  attribution « Powered by CoinGecko » exigée par les CGU [S66] [S67] [S68] ; Coinbase Exchange :
  300 chandelles par requête, paginables sur tout l'historique [S69] ; Kraken : 720 points [S70] ;
  CoinDesk Data (ex-CryptoCompare) a supprimé son offre gratuite le 21/05/2026 [S71] ; Frankfurter
  reste gratuit et sans clé [S72].

## 3. Propositions classées par ROI

Barème : Valeur (chiffres plus justes / plus utiles), Fiabilité (risque d'erreur ou de perte évité),
Satisfaction (plaisir d'usage, adoption sur le Discord), chacun sur 5. Effort en **sessions** : une
session = un créneau de développement assisté (≈ 2–3 h) incluant tests et vérification dans le
navigateur. ROI = (Valeur + Fiabilité + Satisfaction) ÷ sessions.

| #   | Proposition                                                                                                                                                                  | Valeur | Fiabilité | Satisf. | Sessions |  ROI   |   Phase   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | :-----: | :------: | :----: | :-------: |
| P2  | Canal de retours + « copier le diagnostic »                                                                                                                                  |   3    |     4     |    4    |   0,5    | **22** |     0     |
| P3  | Mode démo en un clic                                                                                                                                                         |   4    |     1     |    5    |   0,5    | **20** |     0     |
| P1  | Verrouillage de la chaîne d'approvisionnement                                                                                                                                |   2    |     5     |    1    |   0,5    | **16** |     0     |
| P16 | Veille et mises à jour planifiées (par trimestre)                                                                                                                            |   1    |     4     |    1    |   0,5    |   12   | récurrent |
| P8  | **Attribution livrée (26/08/2026), logos à sourcer.** Logos manquants, historique EURCV/GMX, attribution des sources                                                         |   1    |     1     |    3    |   0,5    |   10   |     1     |
| P11 | Répartition (donut), alerte de concentration, contribution par actif                                                                                                         |   2    |     1     |    3    |    1     |   8    |     2     |
| P9  | Carte de partage en image + résumé texte pour Discord                                                                                                                        |   4    |     1     |    5    |   1,5    |  6,7   |     2     |
| P4  | Tests de bout en bout + accessibilité + Lighthouse en CI                                                                                                                     |   2    |     5     |    2    |   1,5    |   6    |     0     |
| P10 | **Livré (v2, 24/08/2026) — complet : XIRR, TWR et repère BTC.** Rendement personnel (XIRR) + TWR expliqué + benchmark BTC / DCA BTC                                          |   5    |     2     |    4    |    2     |  5,5   |     2     |
| P12 | **Livré (v2, 23/08/2026).** Sauvegarde robuste (IndexedDB, sauvegarde auto sur disque, chiffrement optionnel, rappel iOS)                                                    |   3    |     5     |    3    |    2     |  5,5   |     2     |
| P5  | **Livré (v1.1, 23/08/2026) — alias réels à compléter avec les testeurs.** Import v2 : variantes d'export, en-têtes EN, nouveaux types Coinhouse, écran « À qualifier » guidé |   5    |     5     |    5    |    3     |   5    |     1     |
| P7  | Frais réels et spread implicite par opération + « abonnement rentable ? »                                                                                                    |   5    |     2     |    5    |   2,5    |  4,8   |     1     |
| P14 | Transfert entre appareils (QR / lien compressé)                                                                                                                              |   2    |     2     |    3    |   1,5    |  4,7   |     3     |
| P15 | Drawdown maximal et volatilité                                                                                                                                               |   2    |     1     |    2    |    1     |   5    |     3     |
| P18 | Version anglaise                                                                                                                                                             |   2    |     1     |    2    |    2     |  2,5   |     3     |
| P13 | Mode fiscal FR « estimation » (150 VH bis, 31,4 %, 2086) + réconciliation DAC8                                                                                               |   5    |     3     |    4    |    5     |  2,4   |     3     |
| P17 | Importeur générique multi-plateformes (Binance, Kraken, Ledger…)                                                                                                             |   2    |     1     |    2    |    4     |  1,3   |     3     |

### 3 bis. Propositions ajoutées le 23/08/2026 (version 2 — détail dans `docs/proposals/`)

| #   | Proposition                                                                                                                    | Valeur | Fiabilité | Satisf. | Sessions |  ROI   |                                                  Phase                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | :----: | :-------: | :-----: | :------: | :----: | :-----------------------------------------------------------------------------------------------------: |
| P27 | « Copier un résumé anonymisé de mes stats » pour une revue assistée par l'IA de son choix                                      |   2    |     1     |    3    |   0,5    | **12** |                                               livré (v2)                                                |
| P23 | Bouton « Actualiser » v2 : horodatage, source, badge « périmé », prix Hyperliquid/DefiLlama, clé CoinGecko optionnelle         |   3    |     4     |    4    |    1     | **11** |                                         livré (v2, 23/08/2026)                                          |
| P28 | Vue d'ensemble v2 : valeur nette consolidée, cartes des deux espaces, flux entre espaces, alertes                              |   4    |     3     |    5    |   1,5    |   8    |                                 livré (v2, hors courbe de valeur nette)                                 |
| P22 | Statistiques de trading : espérance, profit factor, drawdown, ventilations, calendrier, garde-fous, export                     |   5    |     2     |    4    |   2,5    |  4,4   |                                               livré (v2)                                                |
| P21 | Journal de trading : aller-retours automatiques, saisie manuelle, notes, tags/setups, plan → R                                 |   5    |     2     |    5    |    3     |   4    |                                               livré (v2)                                                |
| P19 | Espaces Investissement / Trading + comptes de première classe + navigation v2 + Vue d'ensemble v1                              |   4    |     3     |    4    |    3     |  3,7   |                              livré (v2, 23/08/2026 — rail desktop compris)                              |
| P20 | Import Hyperliquid en lecture seule (adresse publique) : fills spot + perps, funding, dépôts/retraits                          |   5    |     3     |    5    |    4     |  3,3   |                                               livré (v2)                                                |
| P24 | Import « format pivot » (CSV Universal Koinly/Waltio) + virements internes appariés + convertisseurs natifs                    |   4    |     3     |    3    |   3 +    |  3,3   | livré (v2, 23/08/2026 ; convertisseurs natifs par plateforme livrés le 24/08/2026, voir P24 ci-dessous) |
| P26 | Mode « live » WebSocket optionnel sur l'écran Trading                                                                          |   2    |     1     |    2    |   1,5    |  3,3   |                               livré (v2, 24/08/2026 — prix ET exécutions)                               |
| P25 | Lecture on-chain par adresse (BTC mempool.space, EVM Etherscan V2 / Blockscout)                                                |   2    |     2     |    3    |    3     |  2,3   |      livré (v2, 24/08/2026 — BTC adresse et xpub, EVM Blockscout + secours Routescan/Etherscan V2)      |
| P29 | Alertes de prix relatives au PRU (repli, objectif, net de frais) + simulateur rachat/vente/objectif de PRU aux frais Coinhouse |   4    |     2     |    5    |   1,5    |  7,3   |                       livré (2.1.0, 25/08/2026 — docs/alerts.md, décision n° 36)                        |

P12 (sauvegarde robuste, IndexedDB) devient un **prérequis** de P20 (volume des fills Hyperliquid).
**P17 est remplacé par P24** (format pivot, complété par des convertisseurs natifs livrés le
24/08/2026, jamais de clé API d'exchange dans le site).

Le ROI brut ne fait pas tout : l'ordre ci-dessous tient compte de l'**urgence** (P5 : les lignes de
staking arrivent), des **dépendances** (P4 avant P5, car P5 réécrit l'import) et du **risque**
(P13 : juridique → dernier, avec garde-fous).

## 4. Ordre d'exécution recommandé

### Phase 0 — Socle de confiance (≈ 3 sessions, à faire en premier)

**P2 — Canal de retours + diagnostic copiable (0,5 session)**

- Quoi : activer les Discussions GitHub (ou un salon Discord dédié), un gabarit d'issue « fichier non
  reconnu » qui ne demande que la ligne d'en-tête, et dans l'app un bouton « Copier le diagnostic »
  (version, navigateur, en-têtes du CSV, nombre de lignes, types inconnus — jamais de montants).
- Pourquoi : aujourd'hui aucun signal ne remonte ; les imports qui cassent sont la frustration n° 1
  des trackers [S4] [S37].
- Réussite : un membre colle son diagnostic dans Discord en < 30 s ; vous recevez les en-têtes sans
  jamais recevoir un fichier.

**P3 — Mode démo (0,5 session)**

- Quoi : bouton « Essayer avec des données d'exemple » sur l'accueil, chargeant le jeu de démonstration
  synthétique du dépôt, avec bandeau « Données fictives » et sortie en un clic.
- Pourquoi : la démo sans compte est le premier levier d'adoption (Ghostfolio [S34], demande Finary
  [S35]) ; un membre voit l'outil avant d'avoir reçu son export par e-mail.
- Réussite : depuis le lien Discord, voir un portefeuille complet en moins de 10 s sans rien fournir.

**P1 — Verrouillage de la chaîne d'approvisionnement (0,5 session)**

- Quoi : `min-release-age=7` et `ignore-scripts` dans `.npmrc`, `npm ci --ignore-scripts` en CI,
  délai Dependabot à 7 jours, actions épinglées par empreinte SHA, revue des dépendances, CodeQL et
  Scorecard activés (tout est gratuit pour un dépôt public).
- Pourquoi : le ver d'août 2026 a touché des dépendances indirectes de ce projet [S43] ; un paquet
  compromis peut injecter du code dans le site publié, donc chez tous les membres.
- Réussite : badge Scorecard ≥ 7/10 visible dans le README ; aucune dépendance installée le jour de
  sa publication.

**P4 — Tests de bout en bout, accessibilité et Lighthouse en CI (1,5 session)**

- Quoi : scénarios Playwright sur la fixture (import → PRU attendus → graphiques → exports CSV/PDF),
  axe-core sur chaque page, test du manifeste/service worker, Lighthouse CI avec seuils (≥ 95),
  tests de propriétés sur le moteur (invariant `total = valeur + produits − achats`).
- Pourquoi : vous ne pouvez pas relire le code ; ces tests sont votre relecture automatique à chaque
  modification, y compris celles faites par l'assistant [S49] [S51].
- Réussite : la CI refuse tout changement qui casse un PRU ou l'accessibilité ; rapport lisible
  (captures, traces) joint à chaque exécution.

### Phase 1 — Fiabilité face à Coinhouse 2026 (≈ 6 sessions, mois 1–2)

**P5 — Import v2 (3 sessions) — priorité absolue de la phase**

**Livré (v1.1, 23/08/2026) — alias réels à compléter avec les testeurs.**

- Quoi : reconnaître « Export basique » vs « Export avancé » (message guidant vers l'avancé) ; alias
  d'en-têtes anglais ; table extensible des nouveaux types (staking, récompenses, retraits de staking,
  achats récurrents, dépôts/retraits crypto, parrainage, conversions stable↔stable vers EURCV/USDC) ;
  écran « À qualifier » guidé (choix : récompense, dépôt, retrait, solde d'ouverture…) avec les
  réglages déjà prévus par le moteur (récompenses valorisées à 0 ou à la juste valeur) ; section
  « Revenus de staking » ; fixture par variante ; diagnostics avec numéro de ligne.
- Pourquoi : staking et retraits déployés par Coinhouse entre juin et août 2026 [S1] [S2] ; sans
  cela, un membre qui stake verra ses soldes diverger ou ses lignes bloquées.
- Réussite : 0 ligne « à qualifier » sur les exports de 3 testeurs (dont un avec staking, un avec DCA,
  un avec l'app en anglais) ; contrôle des soldes vert chez chacun.
- Ce qu'il faut : recruter ces testeurs sur le Discord et leur demander le diagnostic P2.

**P7 — Frais réels et spread implicite (2,5 sessions)**

- Quoi : pour chaque opération, coût total = commission (grille du 18/08/2026 [S7]) + 0,12 € + spread
  implicite estimé par l'écart entre le prix Coinhouse et le cours de référence au même instant
  (chandelles Coinbase à la minute, paginables sur tout l'historique [S69]) ; totaux par an ; encart
  « Votre abonnement Investisseur (118,80 €/an) vous a-t-il fait économiser plus qu'il ne coûte ? » à
  partir des remises présentes dans l'export. Étiqueté « estimation ».
- Pourquoi : demande d'origine du Discord et plainte récurrente Trustpilot [S8] ; aucun outil ne le
  montre pour Coinhouse.
- Réussite : sur une opération récente, l'écart affiché correspond (± 0,3 %) à ce que le membre a
  constaté ; le total annuel des frais est cohérent avec la grille.

**P8 — Finitions (0,5 session) — livré le 26/08/2026, sauf les huit logos**

- **Attribution : livrée**, et élargie. L'étude ne visait que « Powered by CoinGecko » [S68] ; le
  code en interrogeait **douze** sources, dont une **deuxième obligation restée invisible** —
  Etherscan exige un lien retour ou sa mention hors usage strictement personnel, ce qu'un site
  public n'est pas. Table déclarative `src/lib/support/sources.ts`, croisée par un test avec les
  fournisseurs réels ; décision n° 47.
- **Historique long EURCV/GMX : sans objet.** GMX a son historique profond depuis la 2.5.1
  (DefiLlama, décision n° 42) et EURCV vaut 1 € par ancrage. Ni Kraken ni Coinbase n'y sont pour
  quoi que ce soit. Verrouillé par un test portant sur les 70 actifs curés.
- **Logos : très largement élargis le 27/08/2026** — 62 → 211 fichiers, générés depuis
  `@web3icons/core` (MIT) par `scripts/generate-icons.mjs`, et sortis du précache du service worker
  pour ne pas imposer des mégaoctets à l'installation. **Les huit d'origine restent à faire** :
  vérification dans le paquet installé, aucun des huit n'y figure sous aucun nom — une note
  antérieure affirmait à tort que quatre y étaient. Tous demandent un kit de marque officiel avec
  licence vérifiée.

### Phase 2 — Satisfaction et partage Discord (≈ 5 sessions, mois 2–3)

**P9 — Carte de partage (1,5 session)**

- Quoi : image PNG (thème sombre par défaut, Discord l'est majoritairement [S33]) montrant par défaut
  uniquement des pourcentages et la période, montants masqués sauf choix explicite, signature
  « Coût de revient CH » + lien ; partage natif sur mobile (Web Share) [S57], téléchargement sinon ;
  plus un « Copier un résumé texte » compatible mode discret.
- Pourquoi : modèle Binance/OKX/CoinStats [S28] [S29] [S30], Coinbase en % seulement [S31], effet
  Wordle [S32] : chaque carte postée dans le Discord recrute.
- Réussite : un membre poste sa carte depuis son téléphone en 3 gestes ; aucun montant n'y figure par
  défaut.

**P10 — Rendement personnel et benchmark (2 sessions)**

**Livré (v2, 24/08/2026) — XIRR seul ; TWR expliqué et benchmark BTC / DCA BTC restent à faire.**

- Quoi : « Votre rendement personnel » (XIRR annualisé, comme Vanguard [S24]) en chiffre-titre, TWR
  en secondaire avec une phrase d'explication, et deux comparaisons : « si vous aviez acheté du BTC
  aux mêmes dates et pour les mêmes montants » et « vs BTC sur la période ».
- Pourquoi : c'est la question de départ du Discord (« +1150 % devenu +455 % ») ; les deux rendements
  côte à côte sont la pratique des outils de référence [S23] [S25] ; le DCA contrefactuel n'existe
  nulle part ailleurs.
- Réussite : sur la fixture, XIRR et TWR vérifiés à la main (tableur) ; explication comprise par un
  testeur non initié.

**P11 — Répartition et contribution (1 session)**

- Donut de répartition, alerte « plus de 50 % sur un actif », contribution de chaque actif au résultat
  total. Fonctions attendues partout (eToro, Kubera, Ghostfolio) pour un effort faible.

**P12 — Sauvegarde robuste (2 sessions)**

**Livré (v2, 23/08/2026).**

- Quoi : état principal déplacé de localStorage (5 Mo) vers IndexedDB ; sur Chrome/Edge desktop,
  sauvegarde automatique dans un dossier choisi une fois (ex. iCloud Drive/OneDrive/Google Drive)
  [S58] [S59] ; chiffrement optionnel de la sauvegarde par phrase secrète ; sur iPhone, message
  « ajoutez à l'écran d'accueil » (sinon Safari efface après 7 jours sans visite [S56]) et partage du
  fichier vers « Fichiers ».
- Pourquoi : la perte de données est la frustration n° 2 des trackers [S38] ; la fuite Waltio montre
  la valeur d'une sauvegarde chiffrée [S39].
- Réussite : vider les données du navigateur puis tout retrouver en < 1 min depuis la sauvegarde.

### Phase 3 — Futur (trimestre suivant, à décider)

**P13 — Mode fiscal « estimation » + réconciliation DAC8 (5 sessions, risque juridique)**

- Quoi : calcul 150 VH bis (valeur globale du portefeuille à chaque cession en euros, prix total
  d'acquisition résiduel, seuil 305 €, sursis crypto↔crypto y compris USDC/EURCV), taux par année
  (30 % jusqu'aux cessions 2024, 31,4 % ensuite [S14] [S15]), lignes prêtes pour le 2086 [S17], et
  un récapitulatif par actif (montants bruts de cession, unités, nombre de transactions) pour
  contrôler ce que Coinhouse déclarera au titre de DAC8 à partir de 2027 [S18] [S19].
- Garde-fous : étiquette « estimation, Coinhouse uniquement, pas un conseil fiscal », saisie
  obligatoire de la valeur des autres portefeuilles (la méthode est globale), revue par un
  professionnel avant publication.
- Pourquoi : aucun rapport fiscal chez Coinhouse [S9], concurrents à 39–999 € [S20] [S21] [S22].

**P14 — Transfert entre appareils (1,5 session)** : QR code ou lien contenant l'état compressé
(jamais envoyé à un serveur) ; pas de synchronisation temps réel (nécessiterait un serveur).

**P15 — Drawdown et volatilité (1 session)** : indicateurs de risque façon Portfolio Performance
[S73] ; utile mais moins demandé.

**P16 — Veille planifiée (0,5 session par trimestre)** : Node 26 après le 28/10/2026 [S62],
TypeScript 7.1 quand svelte-check et typescript-eslint le supporteront [S61], Svelte 6 et Vitest 5 à
leur sortie, vérification des actions tierces avant le retrait de Node 20 [S63].

**P17 — Importeur générique multi-plateformes (4 sessions)** et **P18 — Version anglaise
(2 sessions)** : élargissent le public au-delà du Discord ; à ne lancer que si la demande existe.

### Phase T — Version 2 : deux espaces « Investissement » et « Trading » + Vue d'ensemble (≈ 17 sessions)

Ordre : **P23** (immédiat, 1 session) → **P5** (reste prioritaire : lignes de staking Coinhouse)
→ **P19** → **P12** → **P20** → **P21** → **P28** → **P22 + P27** → **P24** → **P10** → **P25** →
**P26**. Chaque étape est utilisable seule ; la V1 reste déployée tant que la V2 n'est pas prête.
Toutes ces étapes sont livrées au 24/08/2026.

- **P19 — Espaces + comptes + navigation v2 (3 sessions)** : `Account` rattaché à un espace
  (Coinhouse, manuel, Hyperliquid, CSV), PRU par compte et consolidé dans Investissement, barre de
  navigation « Vue d'ensemble · Investissement · Trading · Plus » (anciens liens redirigés),
  registre des espaces, état scindé, Vue d'ensemble v1, provenance réelle dans les exports.
- **P20 — Import Hyperliquid lecture seule (4 sessions)** : client `info` minimal (CORS vérifié,
  sans clé), synchronisation incrémentale des fills spot et perps, funding, dépôts/retraits, USDC →
  EUR à la date, spot → moteur PRU (option), perps → moteur trading, réconciliations, fixture
  synthétique, monitor de contrat API.
- **P21 — Journal de trading (3 sessions)** : aller-retours automatiques (flips, liquidations),
  saisie manuelle en 20 s, notes avant/après, tags et setups, plan entrée/stop/cible → R.
- **P28 — Vue d'ensemble v2 (1,5 session)** : valeur nette = positions + équité trading ; deux
  résultats côte à côte, jamais additionnés ; répartition du capital ; flux entre espaces ; alertes.
- **P22 — Statistiques (2,5 sessions)** : espérance (€ et R), profit factor, taux de réussite,
  drawdown, ventilations par setup/actif/sens/jour/durée, calendrier, avertissement si n < 30,
  export CSV/JSON du journal. **P27** (0,5 session) : résumé anonymisé à coller dans une IA.
- **P24 — Format pivot (3 sessions).** **Livré (v2, 23/08/2026 ; convertisseurs natifs et JSON
  Ghostfolio livrés le 24/08/2026).** CSV Universal Koinly (lu aussi par Waltio) et export interne
  Koinly (Bulk edit → Export), virements internes appariés (report de coût), export au même format,
  fixtures synthétiques. Convertisseurs natifs par plateforme (Kraken, Coinbase, Bitvavo, Revolut,
  Ledger Live) et import JSON Ghostfolio, finalement livrés dans la foulée plutôt que laissés « à la
  demande » : détail dans docs/pivot-import.md, docs/DECISIONS.md n° 26.
- **P10 — Rendement personnel (2 sessions).** **Livré (v2, 24/08/2026) — complet.** Taux de
  rendement interne annualisé (méthode Excel, base 365) calculé sur les flux réels du grand livre,
  affiché dans la synthèse du Rapport (écran et PDF), à côté du **TWR** (rendement hors apports,
  Dietz modifié quotidien enchaîné) et du **repère « mêmes apports en BTC »** — vos flux réels
  rejoués aux mêmes dates sur un seul actif. Détail : docs/DECISIONS.md n° 27, 30 et 31.
- **P25 — On-chain par adresse (3 sessions).** **Livré (v2, 24/08/2026).** Bitcoin (mempool.space)
  et EVM Ethereum/Arbitrum One/Base (Blockscout, liste blanche d'adresses de contrats pour les
  jetons, jamais le symbole) ; mouvements sans valeur EUR, candidats à l'appariement de virement ou
  lignes à qualifier. **Clés publiques étendues Bitcoin** (xpub/ypub/zpub) dérivées localement, avec
  netting au niveau du portefeuille ; **secours EVM** Routescan (sans clé) et clé d'explorateur
  facultative (Etherscan V2 / Blockscout Pro), l'API publique Blockscout étant en sursis. Taproot hors
  périmètre. Détail : docs/onchain-import.md, docs/DECISIONS.md n° 28, 32 et 33.
- **P26 — Prix « live » (1,5 session).** **Livré (v2, 24/08/2026).** Interrupteur opt-in sur l'écran
  Trading, WebSocket Hyperliquid : `allMids` pour les prix (jamais écrits dans le cache persisté) et
  `userFills`/`userFundings` pour les exécutions, sur un socket partagé. Deux interrupteurs distincts,
  décochés par défaut. Détail : docs/DECISIONS.md n° 29 et 34.

## 5. Ce qui n'est pas recommandé

- **Notifications push app fermée** : impossible sans serveur — le Web Push exige un émetteur
  authentifié (VAPID), y compris dans sa variante « déclarative » de WebKit. Nuances apportées le
  25/08/2026 : des **alertes locales** (évaluées quand l'app est ouverte, notifications système
  via le service worker) sont possibles sans serveur et sont **livrées** (P29,
  docs/DECISIONS.md n° 36, docs/alerts.md) ; en 2.2.0 s'y ajoute une vérification
  **opportuniste** app fermée (Periodic Background Sync, Chromium installé, jamais garantie —
  décision n° 38). Seul le push **garanti** app fermée reste exclu tant que le projet refuse tout
  backend ; les deux options serveur (émetteur Web Push opt-in, serveur MCP local) sont chiffrées
  et sourcées dans docs/proposals/2026-08-push-et-mcp.md — recommandation : MCP local d'abord.
- **Comptes utilisateurs, cloud, analytics** : contraires à la promesse « rien ne quitte le
  navigateur », qui est l'argument n° 1 face aux fuites de 2024-2026 [S39].
- **Bot Discord stockant les portefeuilles** : même objection.
- **Synchronisation WebRTC/CRDT** : nécessite un serveur de signalisation ; le transfert par QR/lien
  (P14) couvre le besoin réel.
- **API Binance** comme source de prix : conditions d'utilisation restrictives, accès navigateur non
  garanti.
- **Clés API d'exchange stockées dans le site** (Kraken, Coinbase, Bitvavo…) : les API privées
  refusent le CORS depuis un site tiers, et un secret dans `localStorage` transformerait toute faille
  XSS ou dépendance compromise en exfiltration silencieuse. Lecture par adresse publique ou CSV
  seulement.
- **Proxy pour CoinMarketCap** : CMC interdit les appels depuis un navigateur ; un proxy casserait la
  promesse « aucun serveur ». Coinbase, Kraken, CoinGecko, Hyperliquid et DefiLlama suffisent.
- **`ccxt` ou un SDK Hyperliquid complet dans le navigateur** : CORS non fiable, poids du bundle,
  fonctions de signature inutiles pour de la lecture seule.

## 6. Ce que vous devez décider ou faire vous-même

1. **Testeurs** : recruter 3 à 5 membres du Discord (au moins un qui stake, un en achats récurrents,
   un avec l'app en anglais, un sur iPhone) et leur demander, après P2, de coller leur diagnostic.
2. **Canal** : choisir Discussions GitHub ou un salon Discord « coût-de-revient » pour les retours.
3. **Image de marque** : valider le texte et le visuel de la carte de partage (P9).
4. **Mode fiscal** : décider si vous voulez le publier (P13) et, si oui, faire relire la méthode par
   un professionnel ; l'outil restera une estimation.
5. **Clé CoinGecko « Demo »** (facultatif, gratuit, à créer vous-même) : lève les limites de débit si
   le Discord grandit ; l'app la stockera localement.
6. **Rythme** : une session par proposition, validée par vous dans le navigateur avec le critère de
   réussite indiqué, puis publiée (la CI déploie automatiquement).
7. **Version 2** : confirmer l'ordre (P23, puis P5, puis P19…), le périmètre Hyperliquid de départ
   (spot + perps recommandé) et le routage par défaut du spot Hyperliquid (Trading, avec option
   « investissement » par compte).
8. **Testeurs trading** : recruter 2 ou 3 membres actifs sur Hyperliquid (dont le demandeur) ; ils
   ne fournissent jamais leurs données, seulement le diagnostic anonyme de l'app.

## 7. Indicateurs de suivi

| Indicateur                                          | Cible                                                        |
| --------------------------------------------------- | ------------------------------------------------------------ |
| Membres ayant importé leur export (sondage Discord) | ≥ 10 sous 1 mois après P3 + P9                               |
| Fichiers « non reconnus » signalés                  | 0 après P5 sur les exports des testeurs                      |
| Temps entre l'ouverture du lien et le premier PRU   | < 2 min (démo : < 10 s)                                      |
| CI                                                  | verte sur chaque publication, tests E2E + axe sans violation |
| Lighthouse (mobile)                                 | ≥ 95 sur les quatre catégories, maintenu en CI               |
| Scorecard OpenSSF                                   | ≥ 7/10                                                       |
| Cartes de partage postées dans le Discord           | suivi mensuel                                                |

## Sources (consultées le 23/08/2026)

- [S1] Notes de version Coinhouse, App Store — https://apps.apple.com/fr/app/coinhouse-crypto-bitcoin/id1588692948
- [S2] Coinhouse, page Staking — https://www.coinhouse.com/fr/staking
- [S3] Support Coinhouse, exporter ses transactions — https://support.coinhouse.com/hc/fr/articles/4410163290386
- [S4] Waltio, fichier Coinhouse — https://help.waltio.com/en/articles/5177093-coinhouse-file
- [S5] Communauté Finary, absence d'API Coinhouse (09/02/2026) — https://community.finary.com/t/blocage-api-pour-connexion-coinhouse-et-yuh-solution-manuelle/34251
- [S6] Koinly, demande d'intégration Coinhouse — https://feedback.koinly.io/integrations/p/coinhousecom-integration
- [S7] Coinhouse, grille tarifaire (18/08/2026) — https://cms-www.coinhouse.com/wp-content/uploads/2026/08/CH_-GrilleTarifaire_Web_FR_AUG26.pdf
- [S8] Trustpilot Coinhouse, avis et réponses officielles sur le spread — https://fr.trustpilot.com/review/coinhouse.com?search=spread
- [S9] Coinhouse, blog déclaration fiscale (24/06/2026) — https://www.coinhouse.com/fr/blog/securite-conformite/crypto-declaration-fiscale
- [S10] Coinhouse, communiqué agrément MiCA — https://www.coinhouse.com/fr/blog/communique-de-presse/coinhouse-obtient-lagrement-mica-aupres-de-lamf
- [S11] Avis Google Play Coinhouse — https://play.google.com/store/apps/details?id=com.coinhouse&hl=fr
- [S12] Légifrance, art. 150 VH bis CGI — https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038612228
- [S13] BOFiP, BOI-RPPM-PVBMC-30-20 — https://bofip.impots.gouv.fr/bofip/11968-PGP.html/identifiant=BOI-RPPM-PVBMC-30-20-20190902
- [S14] LFSS 2026, art. 12 (JO) — https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000053226452
- [S15] impots.gouv, FAQ cessions d'actifs numériques (màj 17/07/2026) — https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-plus-ou-moins-values-sur-cessions-dactifs-numeriques
- [S16] Loi de finances 2026 (JO) — https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053508155
- [S17] Formulaire 2086, millésime 2026 — https://www.impots.gouv.fr/sites/default/files/formulaires/2086/2026/2086_5515.pdf
- [S18] Légifrance, CGI art. 1649 AC quater (DAC8) — https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051215656
- [S19] Décret n° 2025-1276 du 19/12/2025 (DAC8) — https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053157956
- [S20] Waltio, tarifs — https://www.waltio.com/fr/tarif/
- [S21] Koinly, tarifs — https://koinly.io/fr/pricing/
- [S22] Blockpit, tarifs — https://www.blockpit.io/pricing
- [S23] Forum Portfolio Performance, TTWROR vs IRR (07/2025) — https://forum.portfolio-performance.info/t/i-dont-understand-the-cumulative-ttwror/33677
- [S24] Vanguard, personal rate of return — https://investor.vanguard.com/investor-resources-education/portfolio-management/performance-details
- [S25] CFA Institute, GIPS overview (2026) — https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/overview-of-the-global-investment-performance-standards
- [S26] Ghostfolio, discussion #2960 (MWR) — https://github.com/ghostfolio/ghostfolio/discussions/2960
- [S27] Kubera review (benchmark BTC/S&P, 04/2026) — https://jeangalea.com/kubera-review/
- [S28] OKX, partager son PnL — https://web3.okx.com/tutorial/home/how-to-share-your-pnl
- [S29] Dappgrid, partage PnL Binance — https://dappgrid.com/share-binance-futures-profit-pnl/
- [S30] CoinStats, partage P/L — https://coinstats.app/blog/profit-loss/
- [S31] Coinbase Help, partager son portefeuille — https://help.coinbase.com/coinbase/getting-started/other/sharing-my-coinbase-portfolio
- [S32] Enchant, leçons de Wordle — https://www.enchant.com/lessons-from-wordle
- [S33] PreviewOG, aperçus de liens Discord — https://previewog.com/discord-link-preview/
- [S34] Ghostfolio, démo sans compte — https://ghostfol.io/en/demo
- [S35] Communauté Finary, demande de mode démo — https://community.finary.com/t/mode-demo-de-finary/18286
- [S36] Communauté Finary, PRU Binance en USD (03/2026) — https://community.finary.com/t/probleme-de-synchronisation-finary-binance/34863
- [S37] Koinly review 2026 (coût d'acquisition à 0) — https://countonsheep.com/blog/koinly-review-2026
- [S38] Avis App Store Delta (perte de données) — https://apps.apple.com/us/app/delta-investment-tracker/id1288676542
- [S39] Cryptoast, fuite de données Waltio (01/2026) — https://cryptoast.fr/waltio-frappe-violation-donnees-tentative-extorsion/
- [S40] Nielsen Norman Group, tableaux sur petits écrans — https://www.nngroup.com/videos/big-tables-small-screens/
- [S41] Unit 42, attaque npm Shai-Hulud (màj 03/12/2025) — https://unit42.paloaltonetworks.com/npm-supply-chain-attack/
- [S42] Zscaler, compromission axios (03/04/2026) — https://www.zscaler.com/blogs/security-research/supply-chain-attacks-surge-march-2026
- [S43] CSA Singapour, avis AD-2026-009 Shai-Hulud (06/08/2026) — https://www.csa.gov.sg/alerts-and-advisories/advisories/ad-2026-009
- [S44] GitHub changelog, délai Dependabot par défaut (14/07/2026) — https://github.blog/changelog/2026-07-14-dependabot-version-updates-introduce-default-package-cooldown
- [S45] npm 11, options `min-release-age` et `ignore-scripts` — https://docs.npmjs.com/cli/v11/using-npm/config
- [S46] GitHub changelog, épinglage SHA des actions (15/08/2025) — https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/
- [S47] actions/dependency-review-action — https://github.com/actions/dependency-review-action
- [S48] OpenSSF Scorecard action — https://github.com/ossf/scorecard-action
- [S49] Playwright, notes de version — https://playwright.dev/docs/release-notes
- [S50] Vitest 4.1 (12/03/2026) — https://vitest.dev/blog/vitest-4-1.html
- [S51] @axe-core/playwright — https://www.npmjs.com/package/@axe-core/playwright
- [S52] Lighthouse, changelog (retrait de la catégorie PWA en 12.0) — https://github.com/GoogleChrome/lighthouse/blob/main/changelog.md
- [S53] Directive (UE) 2019/882 (EAA) — https://eur-lex.europa.eu/eli/dir/2019/882/oj
- [S54] W3C, WCAG 2.2 — https://www.w3.org/TR/WCAG22/
- [S55] WebKit, Safari 26 (15/09/2025) — https://webkit.org/blog/17333/
- [S56] WebKit, suppression du stockage après 7 jours — https://webkit.org/blog/10218/
- [S57] caniuse, Web Share API — https://caniuse.com/web-share
- [S58] caniuse, File System Access API — https://caniuse.com/native-filesystem-api
- [S59] Chrome, permissions persistantes File System Access — https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api
- [S60] Microsoft, TypeScript 7.0 (08/07/2026) — https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- [S61] typescript-eslint, issue #12518 (TS 7) — https://github.com/typescript-eslint/typescript-eslint/issues/12518
- [S62] Node.js, calendrier des versions — https://nodejs.org/en/about/previous-releases
- [S63] GitHub changelog, retrait de Node 20 des runners — https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
- [S64] Vite 8 (12/03/2026) — https://vite.dev/blog/announcing-vite8
- [S65] Svelte, nouveautés août 2026 — https://svelte.dev/blog/whats-new-in-svelte-august-2026
- [S66] CoinGecko, API publique sans clé — https://docs.coingecko.com/docs/keyless-public-api
- [S67] CoinGecko, tarifs API — https://www.coingecko.com/en/api/pricing
- [S68] CoinGecko, conditions d'utilisation de l'API (05/09/2025) — https://www.coingecko.com/en/api_terms
- [S69] Coinbase Exchange, chandelles — https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles
- [S70] Kraken, OHLC — https://docs.kraken.com/api/docs/rest-api/get-ohlc-data
- [S71] CoinDesk Data, fin de l'offre gratuite (17/04/2026) — https://data.coindesk.com/blogs/changes-to-coindesk-data-indices-api-free-tier-access
- [S72] Frankfurter — https://frankfurter.dev
- [S73] Portfolio Performance, indicateurs de performance — https://help.portfolio-performance.info/en/reference/view/reports/performance/

### 3 ter. Propositions issues de l'étude du 29/08/2026 (data, IA et agentique)

Détail et sources : [`proposals/2026-08-29-data-ia-et-agentique.md`](proposals/2026-08-29-data-ia-et-agentique.md).

| #    | Proposition                                                      | Valeur | Fiabilité | Satisf. | Sessions |  ROI   |            État             |
| ---- | ---------------------------------------------------------------- | :----: | :-------: | :-----: | :------: | :----: | :-------------------------: |
| P66  | Comptes à déclarer (3916-bis) déduits des comptes saisis         |   4    |     4     |    4    |    1     | **12** |   **livré (29/08/2026)**    |
| P63a | Serveur MCP installable sans build (actif de release)            |   3    |     2     |    5    |    1     | **10** |   **livré (29/08/2026)**    |
| P67  | Veille réglementaire compilée (millésimes et textes en cours)    |   3    |     3     |    3    |    1     | **9**  |   **livré (29/08/2026)**    |
| P61  | « Pourquoi ce chiffre ? » — traçabilité jusqu'aux lignes brutes  |   5    |     5     |    4    |    2     | **7**  |   **livré (29/08/2026)**    |
| P72  | Anti-verrouillage : format de sauvegarde documenté et versionné  |   2    |     3     |    2    |    1     |   7    |   **livré (29/08/2026)**    |
| P68  | Réconciliation : écarts, trous et doublons en liste d'actions    |   4    |     5     |    3    |    2     |   6    |   **livré (29/08/2026)**    |
| P62  | Second avis sur un export concurrent (Koinly/CoinTracker/Waltio) |   5    |     4     |    5    |   2,5    |  5,6   |   **livré (29/08/2026)**    |
| P70  | Harnais d'évaluation des fonctions IA + garde-fous testés        |   2    |     5     |    1    |   1,5    |  5,3   | proposition — **prérequis** |
| P65  | « Votre année crypto » — rapport narratif étiqueté IA, en BYOK   |   3    |     2     |    5    |    2     |   5    |         proposition         |
| P64  | Qualification assistée des lignes inconnues (IA locale)          |   5    |     4     |    4    |    3     |  4,3   |         proposition         |
| P63b | MCP v2 : parité fonctionnelle, MCP Apps, compétence de domaine   |   4    |     3     |    5    |    3     |   4    |         proposition         |
| P73  | Banc d'essai public d'exactitude (jeu synthétique, rejouable)    |   3    |     4     |    2    |   2,5    |  3,6   |         proposition         |
| P69  | Assistant intégré (BYOK, outils = les fonctions du moteur)       |   3    |     2     |    4    |    3     |   3    |         proposition         |
| P71  | Version anglaise                                                 |   2    |     1     |    2    |    2     |  2,5   |         proposition         |

**P70 est un prérequis strict** de P64, P65 et P69 : aucune fonction d'IA n'est livrée avant son
harnais d'évaluation. Règle de fond de l'étude : **l'IA n'entre jamais dans le calcul ; elle entre
dans la compréhension, la qualification et la distribution.**
