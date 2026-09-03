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
  réconciliation `accountValue ≈ Σ flux + Σ closedPnl − Σ frais perps + Σ funding + latent` —
  auto-vérification permanente affichée sur `routes/Trading.svelte` ; `computeTrading` consolide
  plusieurs comptes, docs/DECISIONS.md n° 22), `calendar.ts` (`realizedEvents` : un montant par
  événement daté — `closedPnl − frais` au jour du fill, funding au jour du paiement — puis les
  trois mailles de la carte « Calendrier de P&L » de `routes/trading/TradeStats.svelte` :
  `calendarMonth` (jours d'un mois), `calendarMonths` (douze mois d'une année) et `calendarYears`,
  toutes trois bâties sur la **même** addition interne `groupEvents` pour qu'elles ne puissent pas
  diverger. La somme de la grille sur tout l'historique **est** `totals.net`, docs/DECISIONS.md
  n° 35 et n° 95), `stats.ts` (`computeStats`, `statsBuckets` et `tripsClosedIn` : le filtre de
  période de l'écran Statistiques, qui retient les aller-retours **clos** dans une fenêtre de jours
  — le calendrier, lui, ne suit pas ce filtre, docs/DECISIONS.md n° 95).
- `src/lib/import` — parseur tolérant, détection de format par alias d'en-têtes, construction des
  opérations à deux jambes (`trade.ts`), normalisation, dédoublonnage idempotent (`index.ts`).
- `src/lib/import/hyperliquid` — client `info` minimal sans clé (`client.ts` : une requête à la fois,
  120 ms d'espacement, nouvel essai avec délai exponentiel et jitter sur 429/5xx, `Retry-After`
  respecté), synchronisation incrémentale par curseur (`sync.ts` : fills par pages de 2 000, funding
  et grand livre par pages de 100, borne inclusive et dédoublonnage par clé — idempotente), gardes
  runtime champ par champ sur chaque réponse (`api-types.ts`), normalisation vers `domain/trading` et,
  en option (`spotAsInvestment`), vers des `TradeEvent` de l'Investissement (`normalize.ts`). Détail
  complet : docs/hyperliquid-import.md, docs/DECISIONS.md n° 22.
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
  DefiLlama (filet de sécurité, par identifiant CoinGecko) ; cascade avec cache et prix manuels.
  Les trois derniers cotent en USD/USDC, convertis en EUR au taux BCE du jour (`src/lib/fx`,
  docs/DECISIONS.md n° 18). `live.ts` (`createLiveMids`) : prix « live » Hyperliquid par WebSocket
  (`allMids`), strictement opt-in (interrupteur « Prix en direct » de `routes/Trading.svelte`,
  réglage `ui.liveMids`), jamais écrit dans le cache de prix persisté ci-dessus — un canal
  d'affichage à part, docs/DECISIONS.md n° 29. Hôtes joignables déclarés dans `connect-src`
  (`src/lib/support/csp.ts`, table `KNOWN_ORIGINS` — **source de vérité**, croisée avec cette liste
  par `tests/integration/architecture-doc.test.ts`). **Liste vérifiée** : `api.coingecko.com`, `api.coinbase.com`,
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
  `json-io.ts`, jamais remplacé en bloc.
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
- `src/lib/derive` — les dérivations qui portaient une **règle** et vivaient dans `src/state`, sorties
  en fonctions pures testables (décision n° 94) : priorité des cotations (prix manuel > direct >
  cache), comptes implicites (trois comptes existent parce que des données existent), rattachement
  d'une qualification à ses lignes brutes. Le câblage réactif, lui, reste dans `src/state` : l'y
  extraire déplacerait du code sans rien rendre testable.
- `src/state/app.svelte.ts` — store runes : état persisté + dérivés (`events`, `quotes`, `report`).
  **Ne jamais déplacer le `$state.snapshot(this.state)` de l'effet de sauvegarde** : ce clone EST le
  traqueur de dépendances, et l'en sortir ferait cesser silencieusement l'enregistrement des
  mutations profondes (décision n° 81).
- `src/state/history.svelte.ts` — historique des prix et **séries** : `dailySeries`, `flows` (les
  apports, au sens des flux externes) et la courbe consolidée `netWorth`, définie **ici** et non
  dans un composant pour que le bandeau, la réconciliation et le graphique lisent le même objet.
- `src/state/checks.svelte.ts` — les auto-vérifications, montées **une seule fois** : les réglages et
  le tableau de bord affichaient auparavant deux listes qui avaient déjà divergé.
- `src/components/shared/Delta.svelte` — **toute** variance de l'interface passe par lui : couleur,
  triangle, signe et équivalent parlé. Un niveau reste neutre (docs/DECISIONS.md n° 56).
- `src/routes`, `src/components` — présentation uniquement. Navigation en quatre espaces
  (`src/lib/spaces.ts`, registre `SPACES` — **source de vérité**, croisée avec la liste ci-dessous
  par `tests/integration/architecture-doc.test.ts`), chacun avec son libellé, sa couleur d'accent et
  sa cible de retour de barre d'application :
  - **Vue d'ensemble** (`#/`, aussi le `start_url` de la PWA — additionne des soldes, jamais des
    résultats de nature différente) : `overview`, `welcome`.
  - **Investissement** (`#/invest…`) : `portfolio`, `asset`, `import`, `add`, `report`,
    `secondOpinion`, `alerts`.
  - **Trading** (`#/trading`) : `trading`, `trades`, `trade`, `tradeAdd`, `tradeStats`, `fills`.
    État vide tant qu'aucun compte Hyperliquid n'est déclaré, puis tableau de bord — équité, P&L par
    période, positions ouvertes, avoirs spot, derniers fills, réconciliation permanente, et
    l'interrupteur « Prix en direct », opt-in (`pricing/live.ts`).
  - **Plus** (`#/more`) : `more`, `market`, `watch`, `accounts`, `reconciliation`, `settings`,
    `help`, `news`, `privacy`. `routes/Accounts.svelte` y liste les comptes implicites et déclarés,
    permet d'ajouter ou de supprimer un compte déclaré ou une adresse on-chain BTC/EVM suivie en
    lecture seule, et porte le bouton « Synchroniser ».

  Routes déclarées, **Liste vérifiée** : `overview`, `welcome`, `portfolio`, `asset`, `import`,
  `add`, `report`, `secondOpinion`, `alerts`, `trading`, `trades`, `trade`, `tradeAdd`,
  `tradeStats`, `fills`, `more`, `market`, `watch`, `accounts`, `reconciliation`, `settings`,
  `help`, `news`, `privacy`.

  L'import, la saisie manuelle et le rapport appartiennent à l'**Investissement**, pas au menu
  « Plus » — ce document affirmait le contraire jusqu'au 01/09/2026 (décision n° 90).
  `src/lib/router.svelte.ts` traduit le hash en route (`parseHash`/`toHash`) ; les hashes v1
  (`#/portfolio`, `#/asset/btc`, `#/import`, `#/add`, `#/report`) restent pris en charge comme alias
  pour ne pas casser liens partagés, favoris et écrans d'accueil déjà installés.

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
  lots réconciliés, survente bloquée. Neuf fichiers `*.property.test.ts`, croisés avec le dépôt par
  `tests/integration/architecture-doc.test.ts`. **Liste vérifiée** : `anchor.property.test.ts`,
  `engine.property.test.ts`, `sort-order.property.test.ts`, `trace.property.test.ts`,
  `reconciliation.property.test.ts`, `second-opinion.property.test.ts`,
  `mapping.property.test.ts`, `payload.property.test.ts`, `koinly-roundtrip.property.test.ts`.
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
  portefeuille), quatorze contrôles identifiés — liste croisée avec le code par
  `tests/integration/architecture-doc.test.ts`. **Liste vérifiée** : `data`, `invariant`, `cashflows`, `lots`,
  `balances`, `blocked`, `unqualified`, `prices`, `mirror`, `backup`, `install`, `transfers`,
  `net-worth-parts`, `net-worth-invest`. Compteurs et tickers seulement.
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
