# Aide à la décision « data-driven » — étude sourcée et feuille de route

> Question traitée : « Concevoir l'aide à la décision data-driven de l'app : (1) panorama sourcé et
> à jour de ce que font les meilleurs — concurrents crypto France et monde, inspirations
> hors-concurrence (courtiers, robo-advisors, finances personnelles, open source privacy-first) ;
> (2) fondations vérifiées : métriques (TWR/XIRR, risque), méthodes (DCA, rébalancement), fiscalité
> française 2026, frontière réglementaire information/conseil (AMF/MiCA), faisabilité données (API
> gratuites) ; (3) feuille de route chiffrée et classée par ROI, compatible avec les contraintes du
> projet — local-first sans backend, arithmétique décimale exacte, jamais de recommandation
> personnalisée. Rien n'est implémenté avant validation. »

_Établie le 26/08/2026 à partir de quatre recherches en ligne parallèles menées ce jour (France,
monde, hors-concurrence, méthodes et cadre) : ≈ 35 pages officielles lues ; les sites bloqués (403)
sont signalés et remplacés par des sources secondaires datées ; ce qui n'a été vu qu'en extraits de
recherche est marqué « (à vérifier) ». Statut : **proposition** — rien n'est décidé ni construit.
Les numéros P30-P35 prolongent la numérotation de [`docs/ROADMAP.md`](../ROADMAP.md)._

## 1. La ligne rouge d'abord : de l'information, jamais du conseil

- MiCA (règlement UE 2023/1114, art. 3, § 1, 24) définit le « conseil en crypto-actifs » comme des
  **recommandations personnalisées** sur des transactions crypto — service réservé aux CASP agréés.
  La doctrine AMF mise à jour le **04/08/2026** précise que la **diffusion d'informations non
  personnalisées destinées au public ne requiert pas d'agrément** : la frontière tient à la prise en
  compte des circonstances individuelles et au fait de présenter une opération comme **adaptée à la
  personne** [D26] [D27] [D28].
- Conséquence produit (déjà l'esprit de la décision n° 10) : l'app **calcule, montre, simule,
  alerte — elle ne recommande jamais** (« vous devriez vendre/acheter/arbitrer »). Chaque brique
  ci-dessous suit quatre règles : hypothèses affichées, étiquette « estimation », seuils choisis par
  l'utilisateur, aucune formulation prescriptive.
- Sur l'échelle de maturité analytique descriptif → diagnostic → prédictif → prescriptif (modèle
  Gartner [D33]), la cible est : tout le descriptif et le diagnostic, le prédictif sous forme de
  **what-if à hypothèses explicites**, et s'arrêter **au bord du prescriptif** — l'app calcule les
  conséquences d'une décision _avant_ qu'elle soit prise ; la décision reste à l'utilisateur.

## 2. Ce que l'app fait déjà (version 2.3.0, 26/08/2026)

| Niveau              | Déjà livré                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Descriptif          | PRU all-in, réalisé/latent/total, ROI, net investi, graphiques 1J→Tout avec PRU, répartition (rapport), valeur nette consolidée et répartition du capital entre espaces, EUR/USD mouvement par mouvement                                                                 |
| Diagnostic          | XIRR **et** TWR côte à côte + repère « mêmes apports en BTC » (décisions n° 27, 30, 31), **rentabilité de l'abonnement Coinhouse déduite de l'export** (décision n° 39), statistiques de trading (espérance, profit factor, drawdown), self-check, écran « à qualifier » |
| Prédictif (what-if) | Simulateur d'achat/vente/objectif de PRU aux frais Coinhouse réels (décision n° 36), en € et en $                                                                                                                                                                        |
| Vigilance           | Alertes locales relatives au PRU (repli, objectif, prix € et $), notifications système, vérification opportuniste app fermée (décision n° 38)                                                                                                                            |

C'est déjà plus que la plupart des trackers du panorama ci-dessous. Les trous restants : **risque et
structure** (concentration, drawdown de la valeur, courbe de valeur nette — reliquats de P11, P15 et
P28), **fiscalité française à la cession** (P13, jamais lancé), **projections d'objectifs**,
**constats automatiques**, et le **copilote conversationnel local** (proposition MCP du 25/08).

## 3. Panorama — ce que font les meilleurs (vérifié le 26/08/2026)

### 3.1 France

- **Waltio** (fiscalité crypto, leader FR ; Free → Unlimited 999 €/an) : suivi de portefeuille
  gratuit, « Simulateur d'impôts crypto » et simulateur de gains/pertes par jeton, et — vendu en
  premier plan — la **fiabilité des données** : détection d'incohérences, de scams, auto-correction
  de soldes [D1]. Pas d'alerte de prix ni d'IA générative constatées.
- **Finary** (agrégateur patrimoine, référence UX ; décision payante ≈ 150 €/an) : « Scanner de
  frais », score de **Diversification**, simulation de patrimoine à 30 ans (« âge de votre liberté
  financière »), rapports hebdo/mensuels automatiques [D2]. « Finary AI » (2023, GPT-4) n'est plus
  mis en avant sur la page tarifs (à vérifier) — l'IA visible sert la catégorisation budgétaire.
- **Coinhouse** (site en 403 ; lu via MoneyVox, page du 27/07/2026 [D3]) : l'aide à la décision y
  est **humaine et éditoriale** — questionnaire de profil → 3 allocations types dans l'app ; offre
  Investisseur : alertes marché, analyses exclusives, webinaires ; Gestion Privée (798 €/an) :
  gérant dédié, « bilan d'investissement », consultation d'un avocat fiscaliste. Pas d'analytics
  self-service.
- **Koinly / Blockpit en France** : le « Tax Optimization dashboard » de Koinly **n'est pas
  disponible avec la méthode française** (PFU) [D5] ; les comparatifs FR 2026 relèvent que Blockpit
  calcule en **FIFO non conforme** à la méthode de l'art. 150 VH bis [D4]. Autrement dit :
  l'optimisation fiscale « à la française » n'existe chez personne.
- **Nalo / Yomoni** (robo-advisors) : la décision y est cadrée **par objectif daté** — multiprojets,
  « sécurisation progressive » à l'approche de l'échéance, « Simuler mon projet », questionnaire →
  profil [D6].

### 3.2 Monde

- **Koinly** (49 → 279 $+) : la brique universelle du segment fiscal — **gains latents par actif +
  simulation de vente + aperçu d'impôt avant achat du rapport** (support en 403, vu via extraits et
  review datée) [D7].
- **CoinTracking** : 25+ rapports historiques, dont « Short & Long-Term Holding » (quantités
  cédables à fiscalité réduite — un outil de _timing_ sans équivalent français), « Timeline »,
  contrôle de soldes/doublons ; « AI Tax Saver » annoncé, peu documenté [D8].
- **CoinStats / Delta** (grand public) : bascule 2025-2026 vers l'**IA explicative** — agent
  CoinStats multi-sources (news, sentiment, on-chain, positions) [D9] ; Delta « Why Is It
  Moving? » et récap quotidien généré (site en 403, à vérifier) [D10].
- **Blockpit** : « Crypto Tax Optimizer » — latents + **périodes de détention** (clé en
  Allemagne/Autriche : exonération > 1 an) [D4].
- **Kubera** (250 $/an) : **IRR par actif comparé à S&P 500/BTC/AAPL**, « Fast Forward »
  (projections par scénarios), « Club Benchmarks » (pairs anonymisés) [D11].
- **Rotki** — le seul local-first comparable : décision quasi absente (historique net worth limité,
  ni simulation, ni benchmark, ni projection ; le rétrospectif est payant) [D12]. **C'est notre
  espace différenciant.**
- **Glassnode** : la décision s'y prend contre des **métriques de valorisation** (MVRV, SOPR, Cost
  Basis Distribution), avec alertes sur métriques [D13].
- **TradingView** — l'étalon des alertes : conditions multiples, 10+ déclencheurs, **expiration
  explicite** (2 mois par défaut !), multi-canaux, webhooks [D14].

### 3.3 Hors concurrence (les idées à prendre)

- **Betterment « Tax Impact Preview »** : l'estimation d'impôt s'affiche **avant** de confirmer une
  vente — « pas de surprise des mois plus tard » [D16]. La leçon n° 1 de toute l'étude.
- **Wealthfront « Path »** : projections d'objectifs manipulables, what-if recalculés en direct,
  hypothèses et limites affichées [D15]. Le tax-loss harvesting automatisé, lui, est **sans objet en
  France** (moins-values non reportables — § 4, P30).
- **IBKR « PortfolioAnalyst »** : bascule **TWR/MWR**, jusqu'à 3 benchmarks simultanés, widget
  risque (Max Drawdown, Sortino, Sharpe, Calmar, périodes positives/négatives) [D17].
- **Monarch Money** (18/12/2025) : « Automated Insights » (anomalies signalées sur les widgets),
  **« Weekly Recap »** narratif automatique, objectifs « On track / At risk » [D18].
- **Ghostfolio / Portfolio Performance** — la preuve qu'un public privacy-first veut ces analytics
  en local : X-ray de concentration, drawdown, TTWROR + IRR, rébalancement sur allocation cible,
  données 100 % locales [D19]. (Reproche récurrent à Ghostfolio : pas de MWR — nous avons déjà les
  deux.)
- **Tendance MCP** : l'accès conversationnel aux données financières se standardise — serveur MCP
  communautaire lisant le cache local de Copilot Money, connecteur Daloopa × Microsoft 365
  (25/06/2026) [D20]. Conforte la proposition MCP locale du 25/08.

### 3.4 Synthèse : où est le trou

| Capacité                                 | Qui le fait le mieux                                                                   | Nous (2.3.0) → après                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| Simulation de cession + impact fiscal FR | **Personne** (Koinly désactivé en FR, Blockpit FIFO ; Betterment le fait pour les USA) | ✗ → **P30**                                 |
| XIRR + TWR + benchmark                   | IBKR, Portfolio Performance, Kubera                                                    | ✓ (repère « DCA BTC » introuvable ailleurs) |
| Risque (drawdown, Sortino), X-ray        | IBKR, Ghostfolio                                                                       | trading seulement → **P31**                 |
| Courbe de valeur nette                   | tous les trackers                                                                      | ✗ (différée en P28) → **P31**               |
| Projections / what-if d'objectifs        | Wealthfront Path, Nalo, Kubera « Fast Forward »                                        | simulateur d'achat/vente seul → **P32**     |
| Constats / récap automatiques            | Monarch, Delta                                                                         | section abonnement seulement → **P33**      |
| Alertes composées, expiration, métriques | TradingView, Glassnode                                                                 | seuils simples PRU/prix → **P35**           |
| Contexte de valorisation (F&G, 52 sem.)  | Glassnode, CoinStats                                                                   | ✗ → **P34**                                 |
| Copilote IA sur ses données              | Monarch (cloud)                                                                        | ✗ → **MCP local** (proposition du 25/08)    |
| 100 % local, sans compte                 | Rotki, Portfolio Performance (aucun ne combine tout le reste)                          | ✓ → ✓                                       |

**Le positionnement qui en sort** : le seul outil qui combine méthode fiscale française exacte,
100 % local et données Coinhouse all-in fiables. Personne n'occupe cette case ; Rotki prouve que la
case « local » existe, Waltio que la case « France » paie, Betterment que la case « avant la
transaction » est la bonne.

## 4. Fondations vérifiées (fiscal, méthodes, données)

- **Art. 150 VH bis (version en vigueur, lu sur Légifrance)** : plus-value = prix de cession −
  prix total d'acquisition × (prix de cession ÷ **valeur globale du portefeuille au jour de la
  cession**) — chaque cession imposable exige donc la valorisation de _tout_ le portefeuille ce
  jour-là [D21]. Seuil de **305 €** de cessions/an toujours en vigueur ; **sursis crypto↔crypto**
  (stablecoins compris) confirmé ; imposables : conversion en euros et achat de biens/services
  [D21] [D22] [D25].
- **Taux : le PFU crypto est passé à 31,4 %** (12,8 % IR + 18,6 % de prélèvements sociaux, CSG
  portée à 10,6 % par la LFSS 2026), affiché sur la FAQ impots.gouv du 17/07/2026 ; application aux
  cessions 2025 signalée (rétroactivité discutée dans la presse) [D22] [D23]. Option barème
  possible ; déclaration via l'annexe 2086. **Moins-values : imputables uniquement sur les
  plus-values de la même année, aucun report** (lecture contestée par un cabinet, position
  administrative constante) [D24].
- **Métriques** : afficher TWR **et** MWR/XIRR est l'état de l'art (GIPS impose le TWR aux gérants,
  le MWR mesure l'expérience réelle du particulier) [D29] — déjà fait chez nous. Pour le risque
  crypto, la littérature récente privilégie **Sortino et max drawdown** (asymétrie des rendements)
  [D30]. DCA vs investissement immédiat : Vanguard (fév. 2023), l'investissement immédiat gagne
  ≈ 68 % du temps à horizon 1 an — le DCA reste un outil comportemental [D31]. Rébalancement par
  bandes « 5/25 » de Swedroe : agir seulement à ±5 points absolus ou ±25 % relatifs [D32].
- **Données (limites au 26/08/2026)** : CoinGecko Demo = 10 000 appels/mois, **historique limité à
  1 an** [D34] ; l'app a déjà les chandelles Coinbase/Kraken pour l'historique long (ROADMAP S69,
  S70) — **aucune dépendance nouvelle n'est nécessaire pour la courbe de valeur nette**. Fear &
  Greed : API gratuite d'alternative.me, historique complet, **attribution obligatoire** [D35].
  Taux BCE historiques : Frankfurter, gratuit, sans clé [D36].

## 5. Les briques proposées

### P30 — « Aperçu avant cession » : le simulateur de vente devient fiscal (méthode française)

- **Quoi.** Étendre le simulateur de vente : pour « je vends X € de BTC », afficher — en plus du
  produit net de frais et du nouveau PRU — l'**estimation fiscale française** : plus-value
  imposable 150 VH bis (avec la valeur globale du portefeuille au jour de la cession), seuil des
  305 €, rappel du sursis (« convertir vers USDC/EURCV ne déclenche pas l'impôt ; vendre en euros,
  si »), impôt estimé au **taux paramétrable par millésime** (31,4 % depuis la LFSS 2026, 30 %
  avant ; option barème signalée, pas calculée), moins-values imputables la même année seulement.
- **Pourquoi.** La leçon Betterment (« l'impact fiscal AVANT la vente » [D16]) appliquée au trou de
  marché français (§ 3.1) : personne ne le fait en méthode française. Le moteur PRU et les cessions
  conservées (décision n° 10) fournissent la matière.
- **Garde-fous.** La formule exige la valeur de _tout_ le portefeuille : l'app somme les comptes
  qu'elle connaît (Coinhouse, pivot, on-chain) et demande un champ « avoirs hors de l'app » ;
  étiquette « estimation, pas un conseil fiscal » ; **relecture par un professionnel avant
  publication** (même exigence que P13). Le rapport 2086 complet et la réconciliation DAC8 restent
  le périmètre de P13.
- **Effort.** 3,5 sessions (moteur pur + tests de propriétés ; feuille de simulation ; docs).

### P31 — Risque et structure : courbe de valeur nette, drawdown, concentration (« X-ray » local)

- **Quoi.** La **courbe de valeur du portefeuille** (reliquat assumé de P28) : quantités du grand
  livre × prix journaliers déjà en cache — puis ce qui en découle : **max drawdown**, volatilité,
  **Sortino**, périodes positives/négatives façon IBKR [D17] [D30] ; et la structure :
  **concentration** (top 1/top 3, seuil d'_information_ paramétrable — jamais « réduisez »), part
  de stablecoins, **contribution de chaque actif au résultat** (reliquat P11), façon X-ray
  Ghostfolio [D19].
- **Pourquoi.** Le standard des références, absent du seul concurrent local-first (Rotki) ; la
  courbe de valeur nette est aussi la fondation visuelle de P34.
- **Effort.** 2,5 sessions.

### P32 — Projections et objectifs : le what-if à hypothèses affichées

- **Quoi.** Trois what-if déterministes, hypothèses en clair (à la Wealthfront Path / Nalo, sans
  boîte noire [D15] [D6]) : **plan DCA** (« si je continue X €/mois pendant N mois aux frais de mon
  offre » → coût, quantité, PRU projetés sous des scénarios de prix ±x % choisis par l'utilisateur,
  avec le rappel sourcé Vanguard sur le coût d'opportunité de l'étalement [D31]) ; **objectif de
  valeur** (« pour atteindre X € à l'horizon H, il faudrait r %/an — sensibilité affichée ») ;
  **échelle de vente** (« vendre p % à +x %, q % à +y % » → produit, PRU restant, et l'estimation
  fiscale de P30 si elle est livrée). En option : bandes de rébalancement 5/25 sur une répartition
  cible **fixée par l'utilisateur** [D32].
- **Effort.** 2,5 sessions (réutilise le simulateur et ses frais).

### P33 — Constats automatiques : le récap qui explique (sans IA, sans réseau)

- **Quoi.** Un moteur de **constats à règles** (déterministe, testable) produisant des cartes
  « Constats » sur la Vue d'ensemble, une section rapport/PDF et un texte copiable : « frais 12
  mois : X € (y % du volume) », « abonnement rentabilisé : +Z € », « votre XIRR bat/ne bat pas le
  repère BTC », « BTC pèse 72 % du portefeuille », « 3 lignes à qualifier », « écart de solde
  détecté ». Chaque constat cite son chiffre et se clique vers l'écran concerné.
- **Pourquoi.** La bascule 2025-2026 des meilleurs est l'« IA **explicative** » (Monarch Automated
  Insights / Weekly Recap [D18], Delta « Why Is It Moving? » [D10]) — mais la valeur vient du
  récap, pas du LLM : en local, des règles rendent le même service sans qu'aucune donnée sorte.
  (Pour le conversationnel : MCP, § 5 bis.)
- **Effort.** 2 sessions.

### P34 — Contexte de marché opt-in : Fear & Greed, 52 semaines, distance à l'ATH

- **Quoi.** Un bandeau « contexte » **opt-in réseau** (comme les prix) : indice Fear & Greed
  (alternative.me, attribution affichée [D35]), position du prix dans sa fourchette 52 semaines et
  distance à l'ATH par actif (depuis le cache de prix existant). Du contexte daté et sourcé, jamais
  un « signal ».
- **Pourquoi.** Glassnode a imposé la décision contre des métriques de valorisation plutôt que
  contre le prix brut [D13] ; F&G est la seule gratuite et stable de la famille.
- **Effort.** 1,5 session.

### P35 — Alertes v2 : conditions composées, expiration, alertes sur métriques

- **Quoi.** Porter les alertes au niveau TradingView [D14] : conditions composées (« prix sous
  PRU −20 % **et** F&G < 20 » quand P34 existe), **expiration optionnelle** et snooze, alertes sur
  métriques du portefeuille (concentration, part stable) et non plus seulement sur prix, historique
  des déclenchements enrichi.
- **Effort.** 1,5 session.

### § 5 bis — Copilote local (rappel)

Déjà chiffré dans [`2026-08-push-et-mcp.md`](2026-08-push-et-mcp.md) (MCP local, 1,5-2,5 jours,
recommandé avant l'émetteur push) : c'est l'aile conversationnelle de cette feuille de route —
« pourquoi mon patrimoine a-t-il bougé ? » façon Monarch, mais données locales et LLM choisi par
l'utilisateur, avertissement de confidentialité explicite (le pattern copilot-money-mcp le
documente [D20]).

## 6. Chiffrage et ordre recommandé

Barème identique à la feuille de route : Valeur, Fiabilité, Satisfaction sur 5 ; une session ≈ 2-3 h
de développement assisté, tests compris ; ROI = (V + F + S) ÷ sessions.

| #   | Brique                                    | Valeur | Fiabilité | Satisf. | Sessions | ROI | Différenciation                 |
| --- | ----------------------------------------- | :----: | :-------: | :-----: | :------: | :-: | ------------------------------- |
| P33 | Constats automatiques                     |   4    |     2     |    5    |    2     | 5,5 | égal Monarch, en local          |
| P35 | Alertes v2                                |   3    |     2     |    3    |   1,5    | 5,3 | égal TradingView, sur le PRU    |
| P31 | Risque, structure, courbe de valeur nette |   4    |     2     |    4    |   2,5    | 4,0 | égal IBKR/Ghostfolio, en local  |
| P34 | Contexte de marché opt-in                 |   2    |     1     |    3    |   1,5    | 4,0 | courant ailleurs, rare en local |
| P30 | Aperçu avant cession (fiscal FR)          |   5    |     3     |    5    |   3,5    | 3,7 | **unique au monde** (§ 3.4)     |
| P32 | Projections et objectifs                  |   4    |     1     |    4    |   2,5    | 3,6 | rare hors robo-advisors         |

**Ordre recommandé : P33 → P31 → P30 → P35 → P32 → P34** (≈ 13,5 sessions au total, chaque brique
livrable seule) :

1. **P33 d'abord** : deux sessions, ne réutilise que l'existant, rend le « data-driven » visible
   immédiatement.
2. **P31 ensuite** : la courbe de valeur nette est la fondation visuelle du reste.
3. **P30 est la pièce maîtresse** (seule brique sans équivalent mondial) mais exige le garde-fou
   juridique : lancer la relecture professionnelle pendant P33/P31 pour ne pas attendre.
4. P35 puis P32 capitalisent sur P30/P31 ; P34 en dernier (seule brique qui ajoute une dépendance
   réseau, même optionnelle).
5. **MCP local** : indépendant, à lancer quand voulu via sa proposition dédiée.

## 7. Ce qui reste exclu (et pourquoi)

- **Recommandations personnalisées, scores « achetez/vendez », signaux, copy-trading** : frontière
  AMF/MiCA (§ 1) et promesse du produit.
- **Prédictions de prix** (ML ou autres) : indémontrables, hors modèle de confiance ; les what-if de
  P32 affichent des scénarios choisis par l'utilisateur, pas des prévisions.
- **IA cloud sur les données du portefeuille** : contraire à « rien ne quitte le navigateur » ; le
  conversationnel passe par le MCP local opt-in.
- **Tax-loss harvesting automatisé** façon Wealthfront [D15] : sans objet en France (moins-values
  non reportables, même année seulement [D24]) — la transposition française utile est P30.
- Les exclusions déjà actées au § 5 de la feuille de route restent valables.

## 8. Décisions attendues du propriétaire

1. Valider le périmètre de P30 (fiscal à la cession) et prévoir la **relecture par un
   professionnel** avant publication ; choisir le taux affiché par défaut (31,4 %, paramétrable par
   millésime).
2. Accepter (ou non) la dépendance réseau optionnelle d'alternative.me pour P34.
3. Confirmer l'ordre P33 → P31 → P30 → P35 → P32 → P34, ou piocher à la carte.

## Sources (consultées le 26/08/2026)

**France**

- [D1] Waltio — <https://www.waltio.com/fr/> ; tarifs : <https://www.waltio.com/fr/tarif/>
- [D2] Finary — <https://finary.com/fr> ; <https://finary.com/en/pricing> ;
  <https://finary.com/en/insights/diversification> ; <https://finary.com/en/budget>
- [D3] Coinhouse (site en 403) via MoneyVox, page mise à jour le 27/07/2026 —
  <https://www.moneyvox.fr/epargne/coinhouse>
- [D4] Blockpit — <https://www.blockpit.io/> ; non-conformité FIFO relevée par les comparatifs FR
  2026 (Journal du Coin, Cryptoast, Divly)
- [D5] Koinly France — <https://koinly.io/guides/crypto-tax-france/> ; indisponibilité du Tax
  Optimization dashboard en méthode PFU : <https://support.koinly.io/en/articles/9490070> (403,
  extraits)
- [D6] Nalo — <https://www.nalo.fr/> ; <https://blog.nalo.fr/nalo-ou-yomoni/> (02/04/2026) ;
  Yomoni — <https://www.yomoni.fr/>

**Monde**

- [D7] Koinly, Tax Optimization dashboard (support en 403 ; extraits + review KuCoin du
  23/03/2026 : <https://www.kucoin.com/blog/koinly-review>)
- [D8] CoinTracking — <https://cointracking.info/more-features>
- [D9] CoinStats — <https://coinstats.app> ; comparatif altFINS (05/2026)
- [D10] Delta (site en 403) — review euinvestinghub du 12/06/2026 ; « Why Is It Moving? », récap
  quotidien (à vérifier)
- [D11] Kubera — <https://www.kubera.com/net-worth-tracker> ; <https://help.kubera.com/article/79>
- [D12] Rotki — <https://rotki.com> ; <https://rotki.com/products>
- [D13] Glassnode — <https://glassnode.com> ; guides MVRV : <https://docs.glassnode.com>
- [D14] TradingView, alertes —
  <https://www.tradingview.com/support/solutions/43000520149>

**Hors concurrence**

- [D15] Wealthfront — <https://www.wealthfront.com/planning> ;
  <https://www.wealthfront.com/tax-loss-harvesting>
- [D16] Betterment, Tax Impact Preview — <https://www.betterment.com/resources/tax-impact-preview> ;
  projections d'objectifs : <https://www.betterment.com/legal/goal-projection>
- [D17] IBKR PortfolioAnalyst (site principal en 403) —
  <https://www.ibkrguides.com/brokerportal/performanceandstatements/pa_viewingaccountperformance.htm>
- [D18] Monarch Money, « Winter Release » (18/12/2025) —
  <https://www.monarch.com/blog/winter-release>
- [D19] Ghostfolio — <https://ghostfol.io/en> ; Portfolio Performance —
  <https://www.portfolio-performance.info/en/>
- [D20] copilot-money-mcp —
  <https://github.com/ignaciohermosillacornejo/copilot-money-mcp> ; Daloopa × Microsoft 365
  (25/06/2026) —
  <https://daloopa.com/blog/press-release/daloopa-microsoft-365-copilot-mcp-connector>

**Fiscalité et cadre réglementaire**

- [D21] Art. 150 VH bis CGI (version en vigueur) —
  <https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050366751>
- [D22] impots.gouv.fr, FAQ cessions d'actifs numériques (mise à jour 17/07/2026) —
  <https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-plus-ou-moins-values-sur-cessions-dactifs-numeriques>
- [D23] MoneyVox, hausse de CSG et cessions crypto —
  <https://www.moneyvox.fr/impot/actualites/108257/impots-2026-une-hausse-de-la-csg-retroactive-qui-va-alourdir-la-revente-de-vos-cryptos>
- [D24] TGS Avocats, moins-values sur actifs numériques —
  <https://www.tgs-avocats.fr/blog/cessions-actifs-numeriques-moins-values>
- [D25] Waltio, guide fiscalité — <https://www.waltio.com/fr/tout-savoir-sur-la-fiscalite-crypto/>
- [D26] AMF, doctrine conseil en crypto-actifs (04/08/2026) —
  <https://www.amf-france.org/en/news-publications/news/advice-crypto-assets-amf-updates-its-doctrine-relation-fias>
- [D27] FMA, services MiCAR (définition du conseil) —
  <https://www.fma.gv.at/en/cross-sectoral-topics/markets-in-crypto-assets-regulation-micar/specific-aspects-of-crypto-asset-services/>
- [D28] AMF, fin de la période transitoire PSAN →
  <https://www.amf-france.org/en/news-publications/news/amf-reminds-digital-asset-service-providers-transitional-period-allowing-them-continue-providing>

**Méthodes**

- [D29] TWR vs MWR —
  <https://analystprep.com/cfa-level-1-exam/quantitative-methods/money-weighted-and-time-weighted-rates-of-return/> ;
  <https://ryanoconnellfinance.com/twr-vs-mwr/>
- [D30] Sharpe/Sortino/Calmar appliqués à la crypto —
  <https://www.xbto.com/resources/sharpe-sortino-and-calmar-a-practical-guide-to-risk-adjusted-return-metrics-for-crypto-investors>
- [D31] Vanguard, « Cost averaging: Invest now or temporarily hold your cash? » (février 2023) —
  <https://corporate.vanguard.com/content/dam/corp/research/pdf/cost_averaging_invest_now_or_temporarily_hold_your_cash.pdf>
- [D32] Règle 5/25 (Swedroe) —
  <https://awealthofcommonsense.com/2014/03/larry-swedroe-525-rebalancing-rule/> ;
  <https://www.bogleheads.org/wiki/Rebalancing>
- [D33] Modèle de maturité analytique (Gartner, via source secondaire) —
  <https://learningdiscourses.com/subdiscourse/analytics-maturity-gartner-analytic-ascendancy-model/>

**Données**

- [D34] CoinGecko, market_chart (limites Demo : 1 an, 10 000 appels/mois) —
  <https://docs.coingecko.com/reference/coins-id-market-chart> ;
  <https://www.coingecko.com/learn/best-free-crypto-api> (22/08/2026)
- [D35] alternative.me, Crypto Fear & Greed Index (API gratuite, attribution obligatoire) —
  <https://alternative.me/crypto/fear-and-greed-index/>
- [D36] Frankfurter (taux BCE, gratuit, sans clé) — <https://frankfurter.dev/>
