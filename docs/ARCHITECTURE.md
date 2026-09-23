# Architecture

Application statique locale-first : **aucun backend**. Tout est calculé dans le navigateur à
partir des lignes brutes de l'export Coinhouse, conservées telles quelles.

```
texte CSV ─▶ import/csv.ts ─▶ coinhouse/detect.ts ─▶ coinhouse/rows.ts ─▶ RawCoinhouseRow[] (persistées)
                                                                              │
      saisies manuelles + qualifications + réglages (persistés) ──────────────┤
                                                                              ▼
                             coinhouse/normalize.ts + import/manual.ts ─▶ LedgerEvent[] (dérivés)
                                                                              │
        prix (pricing/service.ts : manuel > cache > CoinGecko > Coinbase > Kraken > Hyperliquid >
                                          DefiLlama ; prix USD/USDC convertis en EUR au taux BCE)
                                                                              ▼
                                    domain/engine (compute → position → aggregate) ─▶ PortfolioReport
                                                                              │
                                        state/app.svelte.ts ($derived) ─▶ router.svelte.ts (#/…) ─▶ routes/*.svelte
```

## Couches

- `src/lib/domain` — moteur pur TypeScript (aucun import Svelte/DOM, seule dépendance big.js).
  `money.ts` (arithmétique décimale, mode strict), `types.ts` (événements du grand livre, tout
  événement porte un `accountId` — comptes de première classe, docs/DECISIONS.md n° 20),
  `engine/position.ts` (CUMP invariant à la vente, lots au prorata), `engine/compute.ts`
  (boucle chronologique), `engine/aggregate.ts` (`computePortfolio` : rapport consolidé sur tout le
  grand livre ; `computePortfolioByAccount` : le même grand livre groupé par `accountId`, un rapport
  — donc un PRU — par compte, le contrôle de solde n'étant transmis qu'au compte Coinhouse),
  `engine/integrity.ts` (colonne Solde), `engine/trace.ts` (« Pourquoi ce chiffre ? » : la chaîne
  d'un montant jusqu'aux lignes brutes — ne recalcule rien, assemble ce que le moteur conservait
  déjà ; sous un opérateur additif la somme des enfants **est** celle du parent, et un trou est
  nommé plutôt que comblé. Rendu français dans `format/trace.ts`, docs/tracabilite.md,
  docs/DECISIONS.md n° 61), `transfers.ts` (virements internes appariés entre comptes,
  coût transporté vers le dépôt, jamais persisté, docs/DECISIONS.md n° 25), `xirr.ts` (rendement
  personnel annualisé money-weighted : Newton pour semer, bissection pour trancher, taux en float64
  seulement à la frontière du solveur, docs/DECISIONS.md n° 27) et `date.ts` (arithmétique de dates
  civiles en entiers purs, algorithme de Hinnant, base des jours écoulés du XIRR).
- `src/lib/domain/trading` — second moteur pur (même contrainte : aucun import Svelte/DOM, seule
  dépendance big.js), vocabulaire volontairement distinct de l'Investissement (jamais de PRU ici).
  `types.ts` (`Execution` : fill spot ou perp ; `FundingPayment` ; `CashFlow` ; `OpenPosition` ;
  `SpotHolding` ; `TradingSnapshot`), `compute.ts` (`computeTradingAccount` : totaux réalisé brut,
  frais, funding, net = réalisé − frais perps + funding, dépôts nets, P&L latent, équité, et
  réconciliation `perps + spot ≈ Σ flux externes + Σ closedPnl − Σ frais + Σ funding + latent`
  (décision n° 100 : le périmètre est le COMPTE, pas la seule poche perps — un compte sans position
  ouverte a une équité perps nulle et tout son argent sur le spot) —
  auto-vérification permanente affichée sur `routes/Trading.svelte` ; `computeTrading` consolide
  plusieurs comptes, docs/DECISIONS.md n° 22), `calendar.ts` (`realizedEvents` : un montant par
  événement daté — `closedPnl − frais` au jour du fill, funding au jour du paiement — puis les
  quatre mailles de la carte « Calendrier de P&L » de `routes/trading/TradeStats.svelte` :
  `calendarMonth` (jours d'un mois), `calendarWeeks` (semaines ISO d'une année), `calendarMonths`
  (douze mois d'une année) et `calendarYears`, toutes bâties sur la **même** addition interne
  `groupEvents` pour qu'elles ne puissent pas diverger. La somme de la grille sur tout l'historique
  **est** `totals.net`, docs/DECISIONS.md n° 35, n° 95 et n° 165), `stats.ts` (`computeStats`, `statsBuckets` et `tripsClosedIn` : le filtre de
  période de l'écran Statistiques, qui retient les aller-retours **clos** dans une fenêtre de jours
  — le calendrier, lui, ne suit pas ce filtre, docs/DECISIONS.md n° 95), `costs.ts`
  (`executionLines` : les exécutions d'un aller-retour, tranches d'un même instant regroupées, part
  d'un retournement au prorata exact de la reconstruction, rôle maker/taker ; `tradeCosts` : part du
  brut en frais, taux moyen, seuil de rentabilité et point mort — tirés du brut du moteur, jamais
  recalculés depuis les prix, pour que le seuil ne puisse pas contredire le net affiché ;
  `observedFeeRates` et `sizeBreakeven` : médiane des taux réellement payés par rôle, et point mort
  exact d'un aller-retour hypothétique selon son sens — prix à atteindre, écart, gain brut minimum —
  pour l'onglet « Seuil », docs/DECISIONS.md n° 158), `curve.ts` (`curveWindow` : gain ou perte
  d'une fenêtre de la courbe de la plateforme, lu sur sa série de P&L, équité de départ et
  d'arrivée, et dépôts, retraits et transferts **déduits** de la différence, pour que l'addition
  tombe juste, docs/DECISIONS.md n° 162), `equity-path.ts` (`detailedCurve` : la valeur du compte
  reconstituée entre les points de la plateforme — fills, funding et apports rejoués, positions
  suivies par `startPosition`, valorisées aux bougies —, calée sur les points à plat les plus proches
  puis recoupée sur chaque point de la fenêtre, et **écartée** au-delà de ce que le cours explique,
  docs/DECISIONS.md n° 164).
- `src/lib/import` — parseur tolérant, détection de format par alias d'en-têtes, construction des
  opérations à deux jambes (`trade.ts`), normalisation, dédoublonnage idempotent (`index.ts`).
- `src/lib/import/hyperliquid` — client `info` minimal sans clé (`client.ts` : une requête à la fois,
  120 ms d'espacement, nouvel essai avec délai exponentiel et jitter sur 429/5xx, `Retry-After`
  respecté), synchronisation incrémentale par curseur (`sync.ts` : fills par pages de 2 000, funding
  et grand livre par pages de 100, borne inclusive et dédoublonnage par clé — idempotente), gardes
  runtime champ par champ sur chaque réponse (`api-types.ts`), normalisation vers `domain/trading` et,
  en option (`spotAsInvestment`), vers des `TradeEvent` de l'Investissement (`normalize.ts`). La
  courbe détaillée y prend ses bougies (`candles.ts` : pas choisi selon la fenêtre et son ancienneté,
  cache de session) et ses mouvements rejoués (`equity-moves.ts`) ; la démonstration tire bougies et
  courbes `portfolio` d'un même tracé de cours (`fixture-prices.ts`). Détail complet :
  docs/hyperliquid-import.md, docs/DECISIONS.md n° 22 et n° 164.
- `src/lib/import/pivot` — import CSV « pivot » (CSV Universal Koinly, ou export interne Koinly lu
  par Waltio) dans des comptes `kind: 'csv'` de l'espace Investissement : détection de format
  (`detect.ts`), lignes brutes dédoublonnées par hachage de contenu (`rows.ts`), normalisation vers
  `LedgerEvent[]` avec les mêmes règles de valeur EUR que le reste de l'app (`events.ts`). Détail
  complet : docs/pivot-import.md, docs/DECISIONS.md n° 24.
- `src/lib/import/platforms` — convertisseurs natifs purs, un module par plateforme. **Liste vérifiée** :
  `kraken.ts`, `coinbase.ts`, `bitvavo.ts`, `ledgerlive.ts`, `revolut.ts`, `binance.ts`,
  `bitpanda.ts`, `swissborg.ts`. Chacun traduit son export propre en
  brouillons pivot (`types.ts` : `PlatformDraft`) ; `drafts.ts` (`draftsToPivotRows`) les transforme
  en `RawPivotRow` — clé de dédoublonnage = hachage du **contenu natif**, jamais du résultat calculé
  — et `index.ts` (`importAnyCsv`, `PLATFORM_CONVERTERS`, `FORMAT_LABELS`) orchestre la détection en
  essayant le format pivot puis chaque convertisseur. `src/lib/import/ghostfolio` (import JSON
  d'activités Ghostfolio) et `src/lib/import/onchain` (ci-dessous) réutilisent la même
  `draftsToPivotRows` et le même `ingestPivotRows` du pipeline pivot. Détail complet :
  docs/pivot-import.md, docs/DECISIONS.md n° 26.
- `src/lib/import/onchain` — suivi en lecture seule d'une adresse publique BTC (`btc.ts`,
  mempool.space, mouvement net par transaction) ou EVM (`evm.ts`, Blockscout v2 sur Ethereum,
  Arbitrum One et Base ; ERC-20 filtrés par liste blanche d'adresses de contrats, jamais par
  symbole) ; `normalize.ts` transforme les mouvements en brouillons pivot **sans valeur EUR**
  (candidats à l'appariement de virement ou lignes à qualifier). Détail complet :
  docs/onchain-import.md, docs/DECISIONS.md n° 28.
- `src/lib/export` — CSV tableur pour tableur FR (`csv-export.ts`) et CSV pivot Koinly/Waltio
  réimportable ailleurs, valeurs EUR de l'app (`koinly-csv.ts`, docs/pivot-import.md).
- `src/lib/pricing` — table curée des tickers, fournisseurs CoinGecko (groupé), Coinbase (par
  actif), Kraken (groupé), Hyperliquid (mids USDC : HYPE, PURR et tokens spot Hyperliquid) et
  DefiLlama (filet de sécurité, par identifiant CoinGecko) et Twelve Data (actions et ETF, seul
  fournisseur à clé obligatoire — inactif tant que l'utilisateur n'en a pas saisi une, décisions
  n° 32 et 104) ; cascade avec cache et prix manuels.
  Les trois derniers cotent en USD/USDC, convertis en EUR au taux BCE du jour (`src/lib/fx`,
  docs/DECISIONS.md n° 18). `live.ts` (`createLiveMids`) : prix « live » Hyperliquid par WebSocket
  (`allMids`), strictement opt-in (interrupteur « Prix en direct » de `routes/Trading.svelte`,
  réglage `ui.liveMids`), jamais écrit dans le cache de prix persisté ci-dessus — un canal
  d'affichage à part, docs/DECISIONS.md n° 29. Hôtes joignables déclarés dans `connect-src`
  (`src/lib/support/csp.ts`, table `KNOWN_ORIGINS` — **source de vérité**, croisée avec cette liste
  par `tests/integration/architecture-doc.test.ts`). **Liste vérifiée** : `api.coingecko.com`, `api.coinbase.com`, `api.twelvedata.com`, `www.alphavantage.co`,
  `api.exchange.coinbase.com`, `api.kraken.com`, `api.hyperliquid.xyz`, `coins.llama.fi`,
  `api.frankfurter.dev`, `api.frankfurter.app`, `mempool.space`, `blockstream.info`,
  `eth.blockscout.com`, `arbitrum.blockscout.com`, `base.blockscout.com`, `api.blockscout.com`,
  `api.etherscan.io`, `api.routescan.io`, `api.alternative.me`, `api.anthropic.com`.
- `src/lib/history` — séries de prix **quotidiennes en euros** par actif (`DailyPoint.priceEur`),
  socle du TWR, du repère et de la fiche actif. Cache IndexedDB ne comblant que les bords manquants
  (`service.ts` : `probedFrom` mémorise une absence déjà constatée, `fillGaps` reporte la dernière
  valeur connue). Quatre fournisseurs interrogés **dans l'ordre**, chacun ne recevant que ce que les
  précédents n'ont pas couvert : Coinbase Exchange (profondeur illimitée, paire `-EUR`, 300 bougies
  par requête), Kraken (721 points), CoinGecko (365 jours, `vs_currency=eur`), puis **DefiLlama**
  (`providers/defillama.ts` : profondeur illimitée — BTC remonte à 2013 —, `/chart` paginé par
  fenêtres de 500 points ancrées à midi UTC, `confidence` au niveau de la série). DefiLlama est le
  seul fournisseur coté en **dollars** : sa conversion au taux BCE du jour est **injectée** depuis
  `state/history.svelte.ts` (série `fx.rates.USD`, chargée quelle que soit la devise d'affichage) et
  un jour sans taux voit son point omis plutôt que converti de travers. Décision n° 42.
  `window.ts` (P118) est le cœur pur de la **fenêtre d'analyse** du Rapport : une fenêtre
  `{ from, to }` couvre ses jours bornes incluses, part de la clôture de la **veille** de `from` et
  arrive à celle de `to`. Ses flux de résultat sont un filtre de dates sur un seul résultat du
  moteur (aucun rejeu du grand livre), son TWR la série tranchée à la veille de `from` (chaînage
  géométrique, GIPS 2020 2.A.24.f), son rendement pondéré par les flux reçoit la valeur d'ouverture
  comme un premier versement, et son gain est exactement additif d'une fenêtre à la suivante.
  Depuis l'origine, elle redonne au dernier chiffre le XIRR et le TWR que le Rapport affichait.
  **Cette lecture vaut pour toute l'application** depuis la décision n° 179 : `periodWindow` rend
  le premier jour compris (et non plus le jour de base), `openingDay` la veille, et les courbes
  se découpent par `windowSeries` (`series.ts`), point d'ouverture compris — une seule définition
  d'une plage pour la Vue d'ensemble, la carte Évolution, les statistiques de trading et le
  Rapport. `derive/report-window.ts` assemble ce que la synthèse du Rapport lit ;
  `history.reportWindow` (état) ne fait que le câbler.
- `src/lib/storage` — schéma versionné (`StoredStateV1`), migrations, sauvegarde JSON et fusion.
  Persistance à deux étages (docs/DECISIONS.md n° 21) : `idb-state-store.ts` (IndexedDB, base
  `crch-state`, source principale, sans le plafond ~5 Mo de localStorage) et `local-storage.ts`
  (clé `crch:v1:state`, miroir synchrone) ; `state-store.ts` les orchestre — au chargement,
  l'instantané le plus récent gagne (`savedAt`), à égalité le miroir l'emporte ; à l'enregistrement,
  IndexedDB puis miroir, `ok` dès que l'un des deux réussit. `encryption.ts` chiffre en option la
  sauvegarde téléchargeable par phrase secrète (PBKDF2-HMAC-SHA-256 → AES-GCM-256, `crypto.subtle`,
  zéro dépendance). `accounts: Record<AccountId, Account>` ne contient que les comptes
  **déclarés** par l'utilisateur (id `man:<aléatoire>`, assaini par motif
  `^[a-z]{2,3}:[A-Za-z0-9._-]{1,80}$`) ; les comptes **implicites** (Coinhouse `ch:main`, saisies
  « hors Coinhouse » `man:default`) ne sont jamais persistés, ils existent dès qu'un événement les
  référence (`AppState.accounts`, dérivé). `hyperliquid: HlState` (conteneur additif,
  docs/DECISIONS.md n° 22) porte les bruts par compte Hyperliquid ; assaini champ par champ
  (`sanitize.ts`) et fusionné par union de clés (`tid`, clés composites funding/ledger) dans
  `sync/merge.ts`, jamais remplacé en bloc.
  `src/lib/storage/sync` (fusion multi-appareils, docs/DECISIONS.md n° 182) porte toute la LOGIQUE,
  en modules purs testés (mutation ≥ 90 %, hors Stryker par défaut — voir `stryker.config.json`) :
  `hlc.ts` (horloge logique hybride, chaîne triable), `canon.ts` (JSON canonique pour comparer deux
  enregistrements), `tracked.ts` (registre des collections SUIVIES — LWW par enregistrement — et
  accès uniforme, `imports` compris malgré sa forme de tableau), `stamp.ts` (`stampChanges` : date
  un diff entre deux instantanés, jamais un mutateur), `merge.ts` (`mergeSynced` : LWW + pierres
  tombales sur les collections suivies, union sur `rawRows`/`pivotRows`/`hyperliquid`/`lending`/
  `alerts.events`, réglages locaux inchangés sur les autres) et `import-prune.ts` (règle de
  suppression des lignes d'un lot d'import, partagée par `undoImport` et l'élagage post-fusion).
  Le seul point d'entrée IMPUR est `src/state/app.svelte.ts` — voir ce fichier ci-dessous.
- `src/lib/calendar` — calendrier macroéconomique américain **et de la zone euro**, **compilé dans le bundle et jamais
  récupéré au vol** : `events.generated.ts` est engendré et committé par
  `scripts/generate-calendar.ts` (Fed et BEA relus par le cron hebdomadaire ; BLS recopié à la main
  dans `bls-schedule.ts`, son CDN refusant les clients non-navigateurs). D'où : aucune origine à
  autoriser dans la CSP, aucun opt-in réseau, et un écran qui marche hors ligne par construction.
  `types.ts` pose qu'un événement macro est un **instant** — converti depuis l'heure de New York
  une seule fois, à la génération — contrairement aux dates Coinhouse, naïves et jamais converties.
  `index.ts` ne fait que sélectionner et regrouper par jour local. Détail : docs/calendrier-macro.md,
  docs/DECISIONS.md n° 58.
- `src/lib/macro` — indicateurs macroéconomiques américains **et européens**, **compilés dans le bundle** comme le
  calendrier : `snapshot.generated.ts` est engendré par `scripts/generate-macro.ts` (Trésor et Fed
  en CI, pétrole si la clé EIA est fournie). `stats.ts` porte les seules décisions statistiques du
  projet — rang percentile à rangs moyens, transformations des séries non stationnaires,
  volatilité par Welford — et vérifie qu'aucun rang ne regarde vers l'avenir. `types.ts` pose la
  règle : jamais une valeur sans son rang, jamais le rang d'un niveau qui dérive, deux fenêtres
  plutôt qu'une. `correlation.ts` et `overlay.ts` confrontent ces séries à l'**indice de rendement
  pondéré temps** du portefeuille (`domain/twr.ts`) : corrélation sur les variations et non les
  niveaux, alignement sur les jours communs avant différenciation, Spearman plutôt que Pearson,
  quatre fenêtres fixées d'avance, et superposition à axe unique rebasée au premier jour commun.
  Détail : docs/macro.md, docs/DECISIONS.md n° 59 et n° 60.
- `src/lib/support` — diagnostic copiable (`diagnostic.ts`, pur : compteurs, statuts, colonnes —
  jamais de montant) et collecte navigateur (`environment.ts`), liens publics (`links.ts`), et la
  table des origines externes d'où découle la CSP (`csp.ts`, docs/DECISIONS.md n° 57), qui exige
  aussi **Trusted Types** (`require-trusted-types-for 'script'`) en n'autorisant qu'une politique,
  `svelte-trusted-html`, celle que le runtime de Svelte crée lui-même ; un croisement du bundle
  livré casse la CI si une dépendance en introduit une autre (docs/DECISIONS.md n° 75).
- `src/lib/ai` — le **harnais d'évaluation des fonctions d'IA** (P70), et rien d'autre : il
  n'existe aucun modèle dans ce code. `numbers.ts` lit les nombres d'un texte français et les
  classe avant de les normaliser (les milliers d'`Intl` fr-FR sont en U+202F, pas en U+00A0) ;
  `anchor.ts` les confronte au JSON source par une **liste fermée** de dérivations, comparée par
  `Big.eq` et sans epsilon ; `contract.ts` porte l'étiquette obligatoire, les motifs de refus et
  l'invariant « une sortie acceptée n'a aucun nombre non ancré » ; `adapters/recorded.ts` rejoue
  des cassettes, **sans aucun chemin réseau**. Module pur, sans DOM, donc exposable au serveur
  MCP. Détail : docs/ia-harnais.md.
- `src/lib/format/lexicon.ts` — les lexiques proscrits (accusation, conseil, garantie, classement),
  appliqués soit au TEXTE d'un fichier (commentaires compris, avec exception nommée mot pour mot),
  soit à des phrases rendues (sans exception). Généralise le garde-fou du second avis
  (docs/DECISIONS.md n° 67) pour qu'il serve aussi aux sorties de modèle.
- `src/lib/format/fr.ts` — le seul endroit qui arrondit (Intl fr-FR). C'est aussi là que vit
  `displayGap` : l'écart entre deux montants **tel qu'il doit s'afficher**, calculé sur les valeurs
  arrondies, sans quoi trois nombres justes affichent une addition fausse d'un centime.
- `src/lib/export/global-report-model.ts` — le **second** constructeur de rapport, assis sur
  `reconcileNetWorth` : apports nets + résultat = patrimoine, une ligne par producteur. Il rend
  le même `ReportModel` que le premier, et `src/components/report/ReportBody.svelte` le dessine
  sans une ligne de rendu en plus — c'est la mise à l'épreuve de la liste ordonnée de sections.
  Le seul ajout exigé fut un gabarit de largeurs de colonnes, réclamé par le compilateur.
- `src/lib/export/trading-report-model.ts` et `src/lib/export/lending-report-model.ts` — les
  constructeurs des rapports de **trading** et de **prêts** (décision n° 178). Même contrat que le
  consolidé : un `ReportModel`, zéro ligne de rendu en plus, une forme de tableau chacun que le
  compilateur fait déclarer dans `pdf.ts`. Le rapport de prêts reprend l'écran Prêts, ni plus ni
  moins ; le rapport de trading dit sur combien de trades clos portent ses statistiques, et que sa
  synthèse (tous les fills) et ses statistiques (les seuls allers-retours clos) ne se recoupent pas,
  à dessein.
- `src/lib/reports.ts` — le registre `REPORTS` : un rapport par espace qui produit de la valeur,
  plus le consolidé, avec sa route, son titre (lu dans son modèle) et l'ordre des liens croisés.
  `components/report/ReportShell.svelte` est la coquille commune (barre, liens, actions, état vide,
  corps) et `components/report/ReportLinks.svelte` les liens entre rapports, les mêmes dans le même
  ordre sur les quatre (WCAG 2.2 § 3.2.3).
- `src/lib/page-title.ts` — le titre de l'onglet, route par route (WCAG 2.2 § 2.4.2) : un
  `Record<RouteName, string>`, si bien qu'une route sans titre ne compile pas. `App.svelte` le pose
  à chaque navigation ; aucune route ne le faisait avant la décision n° 178.
- `src/lib/export/report-model.ts` — le rapport, **mise en page exclue** : `ReportModel.sections`
  est une LISTE ORDONNÉE (décision n° 174). Chaque section porte son enveloppe (titre, `lead` avant
  le bloc, `note` après, avertissements, `breakBefore`) et l'un de six `ReportBlock`. Les deux
  rendus — `export/pdf.ts` et `routes/invest/Report.svelte` — **itèrent** cette liste : aucun ne
  connaît une section par son nom, et une section de plus qui réemploie une forme existante ne leur
  coûte rien. Avant, chacun écrivait la séquence à la main, et celle du PDF avait perdu le 3916-bis.
- `src/lib/format/tax-year.ts` — le vocabulaire de l'année fiscale, **un seul pour les trois écrans
  qui en portent un et pour le PDF** (décision n° 172) : le libellé nu « Année », l'état de l'année
  et le printemps où elle se déclare. Le rendu partagé est `src/components/tax/TaxYearPicker.svelte`,
  qui n'ajoute que le rattachement accessible entre le champ et sa phrase. L'état lui-même vient de
  `yearStatus` (`src/lib/derive/tax-outlook.ts`) et se lit sur le seul calendrier.
- `src/lib/derive` — les dérivations qui portaient une **règle** et vivaient dans `src/state`, sorties
  en fonctions pures testables (décision n° 94) : priorité des cotations (prix manuel > direct >
  cache), comptes implicites (trois comptes existent parce que des données existent), rattachement
  d'une qualification à ses lignes brutes, l'aplatissement des cinq moteurs fiscaux en une liste
  de cases à remplir (`tax-return.ts`, décision n° 149) et l'arbitrage forfait / barème
  (`pfu-vs-bareme.ts`, décision n° 150), qui chiffre un écart à une hypothèse donnée sans jamais
  recommander une option. La règle de présentation d'un rendement y vit aussi
  (`presented-return.ts`, P118) : annualisé à partir de 365 jours, rendement de la période en deçà
  (GIPS 2020, 2.A.12 et 5.A.1.b) — un seuil de présentation, distinct du plancher de bruit de
  30 jours du moteur, qui ne bouge pas. L'assemblage de la synthèse sur une plage y vit également
  (`report-window.ts`) : la valeur et le coût de revient qui ferment la plage sont deux choix, pas
  du câblage — écrits d'abord dans l'état, aucun test ne les exécutait, et c'est le seuil de
  couverture de `src/state` qui l'a dit en CI. Le câblage réactif, lui, reste dans `src/state` :
  l'y extraire déplacerait du code sans rien rendre testable.
- `src/state/app.svelte.ts` — store runes : état persisté + dérivés (`events`, `quotes`, `report`).
  **Ne jamais déplacer le `$state.snapshot(this.state)` de l'effet de sauvegarde** : ce clone EST le
  traqueur de dépendances, et l'en sortir ferait cesser silencieusement l'enregistrement des
  mutations profondes (décision n° 81).
  **Seul point de branchement, impur, de la fusion multi-appareils** (décision n° 182) : trois
  champs privés HORS de l'état réactif (`deviceId`, `syncMeta`, `baseline` — jamais `$state`, pour
  la même raison que ci-dessus : les y mêler daterait `sync` lui-même et bouclerait l'effet).
  `stampSnapshot()` — appelé par `flush`/`flushSync`/`exportBackup`/`installVault`/`removeVault`,
  jamais l'inverse — date les changements depuis `baseline` (`stampChanges`, pur) et avance
  `baseline` jusqu'au nouvel instantané ; sauté en mode démo, pour qu'aucune pierre tombale ne naisse
  de données fictives. `restoreBackup()` appelle `mergeSynced` (« en fusionnant ») et réaligne
  `baseline` sur le résultat **avant** le prochain `flush` — l'oublier redaterait les valeurs reçues
  comme des éditions locales fraîches, cassant « le plus récent gagne » à la fusion suivante
  (contre-épreuve dans le rapport de la PR). `clearAll()` réinitialise `baseline` et `syncMeta` SANS
  pierre tombale : effacer les données d'un appareil ne doit jamais se propager comme des
  suppressions aux autres. `deviceId` (UUID, `$lib/storage/device-id.ts`) vit dans le magasin `meta`
  d'IndexedDB, jamais dans `StoredStateV1` — deux appareils ne partagent jamais d'identifiant.
- `src/state/history.svelte.ts` — historique des prix et **séries** : `dailySeries`, `flows` (les
  apports, au sens des flux externes) et la courbe consolidée `netWorth`, définie **ici** et non
  dans un composant pour que le bandeau, la réconciliation et le graphique lisent le même objet.
- `src/state/checks.svelte.ts` — les auto-vérifications, montées **une seule fois** : les réglages et
  le tableau de bord affichaient auparavant deux listes qui avaient déjà divergé.
- `src/components/shared/Delta.svelte` — **toute** variance de l'interface passe par lui : couleur,
  triangle, signe, pourcentage facultatif et équivalent parlé. Un niveau reste neutre
  (docs/DECISIONS.md n° 56). Deux pourcentages coexistent et ne se mélangent pas : `roiOf`
  (résultat ÷ apports) pour un bilan, `periodPerformance` (Dietz modifié) pour une fenêtre — chaque
  carte nomme le sien (docs/DECISIONS.md n° 96).
- `src/lib/pwa/install.ts` — installation Android (P124, décision n° 185) : capture de
  `beforeinstallprompt` **au chargement du module** (posée en tête de `main.ts`, avant
  `app.init()`, qui est asynchrone et laisserait échapper un événement précoce),
  `preventDefault()` pour supprimer la mini-infobar native, invite gardée en mémoire de module et
  rejouable par `promptInstall()`. Module framework-agnostic sur le patron de
  `$lib/net/local-only.ts` (`scope` injectable, `resetInstallPromptForTests`) : le composant
  Svelte (bouton « Installer l'application » de `routes/Settings.svelte`) porte l'état réactif
  lui-même, abonné par `onInstallableChange`. Masqué si l'app tourne déjà en
  `display-mode: standalone` (`isStandalone`) ou si l'événement n'est jamais venu — jamais en
  variante privée, qui n'a pas de manifeste (`disable: isPrivate`, aucun `beforeinstallprompt`
  possible).
- **Manifeste** (`vite.config.ts`, bloc `VitePWA({ manifest: … })`, P124) — `id` aligné sur
  `start_url`/`scope` (le sous-chemin GitHub Pages, décision n° 32 ; sans lui, vite-pwa dérive un
  `id` implicite du seul `start_url`, qui casserait si celui-ci gagnait un jour une requête,
  vite-pwa/vite-plugin-pwa#263), `screenshots` (deux captures `form_factor: "narrow"`, viewport
  390×844 à DPR 2 — donc `sizes: "780x1688"`, les pixels physiques du fichier, pas le viewport
  logique —, écrites par `scripts/generate-screenshots.ts` — `npm run screenshots` — sur les
  données d'exemple, jamais un export réel ; exclues du précache par `globIgnores`), `shortcuts` (Trading,
  Trades, Vue d'ensemble, Importer, vers les hashes canoniques de `src/lib/router.svelte.ts`) et
  `launch_handler: { client_mode: ['navigate-existing', 'auto'] }` (réutilise la fenêtre déjà
  ouverte). Le générateur de captures construit le build public, sert `dist/` par `vite preview`
  sur un port dédié (`SCREENSHOTS_PORT`, jamais celui de `npm run e2e`), et rejoue `stubNetwork` +
  `openDemo` comme les specs E2E.
- `src/lib/format/bytes.ts` — `fmtBytes`, seul format hors du domaine dans `src/lib/format` :
  `navigator.storage.estimate()` rend des octets en `number` (une taille de stockage, jamais un
  montant ni une quantité de l'application), donc hors de la règle « chaînes décimales + `Big` ».
- `src/routes`, `src/components` — présentation uniquement. Navigation en cinq espaces
  (`src/lib/spaces.ts`, registre `SPACES` — **source de vérité**, croisée avec la liste ci-dessous
  par `tests/integration/architecture-doc.test.ts`), chacun avec son libellé, sa couleur d'accent et
  sa cible de retour de barre d'application :
  - **Vue d'ensemble** (`#/`, aussi le `start_url` de la PWA — additionne des soldes, jamais des
    résultats de nature différente) : `overview`, `welcome`, `netWorthReport`.
    Ce dernier (`#/patrimoine`) est le **rapport consolidé**. Il appartient à la Vue d'ensemble,
    qui est elle-même la consolidation — ce document disait « à aucun espace » alors que le
    registre l'y rangeait déjà ; c'est le texte qui a été corrigé. Son hash reste de premier
    niveau, comme `#/impots`. `#/report` reste l'alias v1 du rapport d'investissement — le
    détourner aurait cassé des favoris.
  - **Investissement** (`#/invest…`) : `portfolio`, `asset`, `import`, `add`, `report`,
    `secondOpinion`, `alerts`, `titles` — ce dernier est l’écran des actions et fonds indiciels,
    classe d’actif et régime fiscal distincts de la crypto (décisions n° 103 et 106), rattaché
    ici par la décision n° 122. Ce document le rangeait encore dans l’espace voisin.
  - **Prêts** (`#/wealth`) : `loans`, et son rapport `loansReport` (`#/wealth/report`, décision
    n° 178), qu'on rejoint au pied de la carte de rendement. Le libellé de navigation disait
    « Patrimoine » jusqu’au 20/09/2026 ; ce mot est maintenant réservé au **total consolidé**,
    que le rapport de patrimoine et la Vue d’ensemble nomment ainsi. L’identifiant `wealth` et
    le hash `#/wealth` ne changent pas.
    `loans` (`#/wealth/loans`) est l'écran des prêts de financement participatif : il ne dépend pas
    de `hasData` (état vide informatif, comme l'espace Trading) et n'affiche en tête que deux
    chiffres — apports nets et valeur — le capital prêté cumulé étant relégué au bloc explicatif
    pour ne pas se lire comme un investissement.
  - **Trading** (`#/trading`) : `trading`, `trades`, `trade`, `tradeAdd`, `tradeStats`,
    `tradeBreakeven`, `fills`, et le rapport `tradingReport` (`#/trading/report`, décision n° 178),
    qu'on rejoint au pied de la carte de synthèse — pas depuis un sixième onglet, que la largeur
    d'un téléphone ne tient pas (décision n° 158).
    État vide tant qu'aucun compte Hyperliquid n'est déclaré, puis tableau de bord — équité, P&L par
    période, positions ouvertes, avoirs spot, derniers fills, réconciliation permanente, et
    l'interrupteur « Prix en direct », opt-in (`pricing/live.ts`).

    **La liste des trades filtre et synthétise (P121), et s'annote en trois gestes (P122).**
    `routes/trading/Trades.svelte` applique `domain/trading/filter.ts` (recherche + facettes en
    puces — sens, issue, setup, erreur, tag, compte — dont quatre visibles et le reste dans une
    feuille « Filtres (n) ») et affiche `summarizeFiltered` au-dessus de la liste : exactement la
    recette de `TradeStats.svelte`, pour que les deux écrans ne puissent pas se contredire sur le
    même sous-ensemble. L'état du filtre vit dans `ui.tradeFilter` (réglages de l'appareil), comme
    `ui.period` et pour la même raison (décisions n° 156-157 et n° 184) : il survit ainsi à
    l'aller-retour vers la fiche d'un trade. `components/trading/JournalSheet.svelte` (sur
    `Sheet.svelte`) ouvre une annotation rapide — setup, erreurs, tags, note, une ligne de revue —
    depuis chaque ligne et depuis le haut de `TradeDetail.svelte` ; « Enregistrer » fusionne ce
    patch dans l'entrée existante (`app.saveJournal`), jamais ne la remplace, et un brouillon non
    enregistré vit en mémoire (une carte hors de `app.state`, perdue au rechargement) pour être
    restitué à la réouverture. Le retour Android (et le bouton retour du navigateur) referme la
    feuille sans quitter l'écran (`history.pushState`/`popstate`, jamais de `hashchange` sur la
    même URL) ; une fermeture par la croix consomme l'entrée d'historique posée.
    `components/trading/TagField.svelte` est le champ de saisie des tags (motif APG « combobox
    with list autocomplete », suggestions par fréquence via `tagSuggestions`, normalisation à
    l'écriture par `domain/trading/tags.ts` — jamais réécrite dans le composant).
    `components/trading/TagManageSheet.svelte` liste l'usage des tags, renomme (fusionne si la
    cible existe déjà, `renameTag`, une seule mutation de l'état via `app.renameJournalTag`) et
    supprime avec confirmation ; ouverte depuis la feuille de filtres, sans route à elle.

  - **Plus** (`#/more`) : `more`, `market`, `watch`, `declaration`, `taxes`, `accounts`,
    `reconciliation`, `synchro`, `settings`, `help`, `news`, `privacy`. `routes/Accounts.svelte` y liste les comptes implicites et
    déclarés, permet d'ajouter ou de supprimer un compte déclaré ou une adresse on-chain BTC/EVM
    suivie en lecture seule, et porte le bouton « Synchroniser ». `routes/Declaration.svelte`
    (`#/declaration`) réunit les cinq moteurs fiscaux pour **une** année, case par case et dans
    l'ordre du parcours en ligne (décision n° 149). `routes/Taxes.svelte` (`#/impots` — le seul
    hash de cet espace qui ne porte pas le nom de sa route, parce qu'un favori se lit) met les deux
    voies d'imposition **côte à côte** : impôt et prélèvements sociaux séparés, échelle des tranches
    avec la vôtre et la bascule, et ce qui reste ouvert d'une année en cours (décision n° 170). L'écran
    **ouvre** sur `components/tax/TaxBill.svelte` : l'addition des deux options, moins ce qui a déjà
    été prélevé, et la date à laquelle le solde se règle (`derive/tax-bill.ts` et
    `derive/tax-calendar.ts`, décision n° 173) — c'est le seul endroit où les crédits d'impôt, que
    l'arbitrage écarte parce qu'ils se déduisent des deux côtés, reviennent dans le calcul. Sur
    l'année en cours seulement, `components/tax/SaleForecast.svelte` y ajoute le **prévisionnel** :
    l'année rejouée avec une vente de plus, seuil de 305 € et poche d'imputation compris
    (`derive/tax-forecast.ts`, décision n° 171). `routes/Synchro.svelte` (`#/synchro`, décision
    n° 186) est l'écran de la boîte aux lettres chiffrée (P125) : dossier synchronisé côté PC
    (File System Access), réception/partage côté Android, état par appareil pair et dernier rapport
    de fusion — voir `docs/backup-format.md` § Enveloppe v3.

  Routes déclarées, **Liste vérifiée** : `overview`, `welcome`, `netWorthReport`, `portfolio`,
  `asset`, `import`, `add`, `report`, `secondOpinion`, `alerts`, `loans`, `loansReport`, `titles`, `trading`, `trades`, `trade`, `tradeAdd`,
  `tradeStats`, `tradeBreakeven`, `fills`, `tradingReport`, `more`, `market`, `watch`, `declaration`, `taxes`, `accounts`,
  `reconciliation`, `synchro`, `settings`, `help`, `news`, `privacy`.

  L'import, la saisie manuelle et le rapport appartiennent à l'**Investissement**, pas au menu
  « Plus » — ce document affirmait le contraire jusqu'au 01/09/2026 (décision n° 90).
  `src/lib/router.svelte.ts` traduit le hash en route (`parseHash`/`toHash`) ; les hashes v1
  (`#/portfolio`, `#/asset/btc`, `#/import`, `#/add`, `#/report`) restent pris en charge comme alias
  pour ne pas casser liens partagés, favoris et écrans d'accueil déjà installés.

## Primitives d'interface partagées

Le constat qui a ouvert la décision n° 181 : `.card` n'avait **aucun padding** — la plupart des
`<section class="card">` collaient leur texte au bord —, aucun style de bouton n'était partagé
(24 fichiers redéfinissaient `.primary`/`.secondary`, dont dix sans aucune définition locale,
affichés en texte nu), et les deux barres d'onglets d'espace dupliquaient le même markup.

- **Cartes** (`src/app.css`) : `.card` porte `padding: var(--space-4)` par défaut ; `.card.flush`
  (padding 0) sert aux cartes pleine largeur dont les enfants gèrent leur propre padding — une
  liste à séparateurs (`routes/More.svelte`, la carte des positions ouvertes de
  `routes/Trading.svelte`) où le padding de la carte empêcherait les séparateurs d'atteindre son
  bord.
- **Boutons** (`src/app.css`) : `.primary` et `.secondary` partagent un même gabarit (hauteur
  tactile, rayon, texte non souligné), et ne différent que par la couleur et la bordure — valable
  sur `<button>` ET `<a>`. `.large` (52 px, rayon plus large) sert aux deux CTA pleine largeur de
  l'accueil et de la saisie manuelle. Un écran garde une couleur locale (teintée à l'accent, sous-
  écrans des alertes) ou une taille locale (confirmation de fiche, 48 px) quand la variante est
  volontaire ; le reste — mise en page seule (marges, `justify-self`) — demeure dans le composant.
- **Grille de chiffres** (`dl.stat-grid`, modificateur `.cols-3`) : le patron dt/dd commun à un
  tableau de résultat (deux colonnes sur téléphone, trois à partir du gabarit tablette, un premier
  chiffre `.main` qui s'étend sur toute la largeur et se lit plus grand). `.trio` et `.bridge` (Vue
  d'ensemble, tableau de bord Trading) restent des styles « héros » propres à un seul écran, jamais
  dupliqués ailleurs : ils ne migrent pas.
- **Onglets d'espace** (`src/components/layout/SpaceTabs.svelte`) : une seule ligne, toujours
  (recommandation Material 3 pour les onglets), qui défile horizontalement plutôt que de passer à
  la ligne ou de déborder — l'ancien comportement de la barre Trading à 390 px (décision n° 158).
  Ce sont des LIENS entre pages (`nav` + `a[aria-current="page"]`), jamais le motif ARIA tablist,
  réservé aux panneaux d'une même page. `InvestTabs` et `TradingTabs` calculent chacun leur `href`
  et leur `current` ; le composant partagé ne porte que la présentation, dont les ombres de
  débordement en CSS pur (`background-attachment: local`) et le rappel de l'onglet courant en vue
  au montage.
- **Bouton d'aide** (`src/components/shared/Info.svelte`) : le glyphe visuel reste un cercle de
  22 px, mais la zone cliquable est agrandie par un pseudo-élément à ≥ 24 px partout et ≥ 44 px
  (`var(--tap)`) sous `(any-pointer: coarse)` (WCAG 2.2 SC 2.5.8, target-size-minimum) — sans
  grossir le rond ni décaler la mise en page d'un titre où l'icône est en ligne avec du texte.

  **P124 (décision n° 185)** ajoute deux primitives sur le même principe — un endroit, jamais un
  style redéfini par écran :

  - **Interrupteur** (`src/components/shared/Switch.svelte`) : `<input type="checkbox"
role="switch">` dans un `<label>` qui porte aussi le texte — toute la ligne bascule le
    contrôle, comportement natif, aucun JS de clic à écrire. `checked`/`onCheckedChange` plutôt
    qu'un `bind:checked` Svelte : la plupart des appelants lisent la valeur du store et la
    modifient par un mutateur (`app.setUi`…), jamais un `$state` local. Cible ≥ 44 px
    (`var(--tap)`) sous `(any-pointer: coarse)`, ≥ 24 px sinon, par le `min-height` de la ligne —
    pas par le glyphe du commutateur, qui reste petit. Réservé aux réglages BINAIRES À EFFET
    IMMÉDIAT ; les listes à choix multiples et les cases de confirmation (« ces deux fichiers
    portent sur le même périmètre », `routes/invest/SecondOpinion.svelte`) restent des cases à
    cocher ordinaires — le rôle switch suppose un état qui bascule seul, pas un consentement donné
    une fois (APG). Onze conversions hors Trading (Réglages, Comptes, Alertes, Marché, partage).
  - **Résumé de section repliable** (`src/app.css`, règles globales `summary`/`summary h2`) : le
    patron déjà utilisé par `routes/wealth/Loans.svelte` (« le titre vit DANS le résumé, pour que
    le triangle le commande ») — `display` n'est volontairement pas touché, pour garder le
    marqueur natif, et la cible tactile vient du `padding`, jamais d'une hauteur qui entrerait en
    conflit avec le contenu. `routes/Settings.svelte` (neuf sections en `<details>`, la première —
    Données — ouverte, un sommaire d'ancres en tête qui ouvre la section visée par script plutôt
    que par le hash du routeur — `#coffre` n'est pas une route, et un `hashchange` y renverrait à
    la Vue d'ensemble) en est le principal appelant.

- **Règle de formatage** (`eslint.config.js`) : `no-restricted-syntax` interdit `.toFixed(` et
  `.toLocaleString(` dans `src/routes/**` et `src/components/**` — le formatage d'affichage
  (arrondi half-up, virgule française) n'a qu'un seul endroit, `src/lib/format`. Les exceptions
  légitimes (précision interne d'un `ChartPoint`, largeur CSS en pourcentage, presse-papiers vers
  un champ officiel qui n'accepte pas l'espace insécable de groupement d'`Intl`) portent un
  commentaire `eslint-disable-next-line` qui dit pourquoi.

## Invariants testés

- Exemple canonique (1@100, 1@200, vente 1@300, 1@150, cours 250 → PRU 150, réalisé +150,
  latent +200, total +350).
- `total = valeur + Σ produits − Σ acquisitions`, par actif et globalement, quel que soit le mode
  de migration ou de valorisation des récompenses.
- Sur le jeu de démonstration synthétique (`npm run fixture`, 21 actifs) et sur un export réel
  (local, ignoré par git) : 0 bloqué, 0 à qualifier, tous les soldes cohérents, ré-import idempotent.
- Trading (par compte Hyperliquid synchronisé) : réconciliation permanente de l'équité (tolérance
  0,01 USDC, formule complète dans docs/hyperliquid-import.md) — c'est elle qui a permis de trancher
  empiriquement que `closedPnl` est brut de frais.

## Tests

- **Unitaires** (Vitest, `*.test.ts` colocalisés) : moteur, import, stockage, prix, change,
  historique, exports, diagnostic. **Propriétés** (fast-check) : séquences aléatoires
  d'achats/ventes/récompenses → `total = valeur + Σ produits − Σ achats`, PRU invariant à la vente,
  lots réconciliés, survente bloquée ; et, sur le barème de l'impôt, qu'un supplément de revenu
  coûte au moins sa tranche de départ et au plus celle d'arrivée — la propriété qui justifie de
  saisir un revenu plutôt que de choisir une tranche ; et, sur l'écran Impôts, que les prélèvements
  sociaux sont le même montant des deux côtés et que la bascule est un préfixe de l'échelle des
  tranches ; et, sur le prévisionnel, que vendre davantage fait varier le résultat de l'année
  toujours dans le même sens — c'est elle qui a montré que le domaine est borné par la valeur du
  portefeuille ; et, sur l'addition, que la somme des lignes vaut toujours le solde et que le
  défaut ne coûte jamais plus cher qu'un choix imposé ; et, sur la fenêtre d'analyse du Rapport,
  que le TWR de deux fenêtres contiguës se chaîne en celui de leur réunion, que « depuis
  l'origine » redonne le XIRR du Rapport, que flux et gains s'additionnent exactement d'une fenêtre
  à l'autre, que le gain se décompose en réalisé et variation du latent sur le vrai moteur, et
  qu'aucun rendement n'est présenté annualisé sous 365 jours. Quinze fichiers `*.property.test.ts`,
  croisés avec le dépôt par `tests/integration/architecture-doc.test.ts`. **Liste vérifiée** :
  `anchor.property.test.ts`, `engine.property.test.ts`, `sort-order.property.test.ts`,
  `trace.property.test.ts`, `reconciliation.property.test.ts`, `second-opinion.property.test.ts`,
  `mapping.property.test.ts`, `payload.property.test.ts`, `koinly-roundtrip.property.test.ts`,
  `household-tax.property.test.ts`, `tax-choice.property.test.ts`, `tax-forecast.property.test.ts`,
  `tax-bill.property.test.ts`, `window.property.test.ts`, `presented-return.property.test.ts`.
- **Charge** (`tests/perf/`) : le garde-fou `engine-load.test.ts` tourne en CI et **ne chronomètre
  rien** — un test qui mesure des millisecondes sur un runner partagé clignote, et un garde-fou qui
  clignote finit désactivé. Il compte deux grandeurs déterministes : objets de trace produits
  (O(n²)) et décimales portées par les quantités (bornées à 18 depuis la décision n° 87). Le
  chronomètre vit dans `engine-load.bench.ts`, lancé à la demande par `npm run bench`.
- **Bout en bout** (Playwright, `tests/e2e/*.spec.ts`, sur le build servi par `vite preview`) :
  projets Chromium desktop, Chromium mobile (Pixel 7) et WebKit (parcours visuels). Les valeurs
  attendues sont calculées par le moteur à partir de la fixture (`helpers/expected.ts`) ; toutes les
  requêtes externes reçoivent des réponses déterministes (`helpers/network.ts`). Accessibilité axe
  (WCAG 2.2 AA) sur chaque route, PWA (manifeste, service worker, CSP, aucune erreur console).
  **Cohérence transversale** (`coherence.spec.ts`) : les chiffres affichés se recoupent d'un écran à
  l'autre (synthèse = Σ lignes + clôturées, fiche actif et onglet Calcul = ligne, rapport et export
  CSV = synthèse, graphique = synthèse), à l'arrondi près ; rejouable localement sur un export réel
  avec `COHERENCE_CSV=<fichier.csv>` (jamais en CI).
- **Lighthouse CI** (`lighthouserc.json`) : accessibilité, bonnes pratiques, SEO ≥ 0,95 (erreur),
  performance ≥ 0,9 (avertissement). Rapports en artefacts de CI ; `deploy` attend `check` et `e2e`.

## Amélioration continue

- **Auto-vérifications** (`src/lib/support/self-check.ts`, section Réglages + rappel en pied de
  portefeuille), seize contrôles identifiés — liste croisée avec le code par
  `tests/integration/architecture-doc.test.ts`. **Liste vérifiée** : `data`, `invariant`, `cashflows`, `lots`,
  `balances`, `blocked`, `unqualified`, `prices`, `mirror`, `backup`, `install`, `transfers`,
  `net-worth-parts`, `net-worth-invest`, `fx` (âge du taux BCE qui convertit les montants en
  dollars, décision n° 101), `loans` (invariant d'encours des prêts de financement participatif). Compteurs et tickers seulement.
- **Oracle indépendant** (`tests/integration/independent-oracle.test.ts`) : parseur minimal +
  boucle naïve, comparé au moteur à 1e-9 (fixture et export réel local).
- **Retours** : diagnostic copiable (`diagnostic.ts`, jamais de montant) + formulaire GitHub
  pré-rempli par identifiants de champs (`links.ts`) ; erreurs capturées (`errors.ts`,
  `<svelte:boundary>` dans `App.svelte`, `error`/`unhandledrejection`).
- **Surveillance** (`.github/workflows/monitor.yml`, `tests/monitor/`, `scripts/api-contract.mjs`,
  `scripts/contract-state.ts`) : site en ligne + forme des réponses des fournisseurs, toutes les 6 h.
  Trois états et non deux — **conforme**, **en sursis** (écart connu et accepté, avec une date
  d'expiration : signalé, ne fait pas échouer), **en écart** (échec). Un sursis expiré, ou dont le
  fournisseur s'est rétabli, **redevient un échec** : il ne peut pas pourrir. L'issue unique porte
  l'état courant dans son corps, réécrit à chaque exécution, et n'est **commentée que lorsque l'état
  change** — une dégradation permanente ne notifie donc pas quatre fois par jour. Réactivation du
  planning à chaque exécution.
- **Nouveautés** (`src/lib/support/changelog.ts`, `src/routes/News.svelte`) : `CHANGELOG.md`
  rendu dans l'app ; `ui.lastSeenVersion` déclenche un bandeau à chaque mise à jour.
- **Garde-fous** : seuils de couverture Vitest (`vite.config.ts`), propriétés fast-check, E2E, axe,
  Lighthouse CI, Dependabot (délai), CodeQL, Scorecard. **Ce que la couverture mesure, et ce qu'elle
  ne mesure pas** (décision n° 78) : le périmètre couvre `src/lib`, `src/state` et les `.ts` de
  `src/components` — soit tout ce qu'un test Vitest peut exécuter. Restent dehors les `.svelte` et
  la totalité de `src/routes`, qui n'a aucun `.ts` : sans test de composant, ils afficheraient 0 % à
  perpétuité. « Couverture » ne veut donc pas dire « tout est mesuré », et l'écart est nommé plutôt
  que masqué.
