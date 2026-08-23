# Décisions (ADR courts)

1. **Web app statique locale-first, pas de tableur ni de bot** — chaque membre importe son propre
   export ; rien ne quitte le navigateur sauf les tickers envoyés aux API de prix.
2. **Vite 8 + Svelte 5 (runes) + TypeScript strict, sans SvelteKit** — pas de SSR ni de route
   serveur ; routeur hash maison ; hébergement GitHub Pages.
3. **Source de vérité = lignes brutes dédoublonnées** ; événements, lots et rapports recalculés à
   chaque chargement → une correction du normaliseur s'applique sans ré-import.
4. **Coût all-in = contre-valeur EUR de la jambe contrepartie** (spread et frais inclus) ; la jambe
   crypto de l'export est libellée « EUR » mais exprimée en USDC quand on paie en USDC.
5. **PRU = coût moyen pondéré invariant à la vente** (règle Kraken/Binance/BoursoBank et règle
   française des titres). Réalisé + latent + total affichés partout ; « net investi » secondaire,
   sans pourcentage quand le capital est récupéré.
6. **Lots consommés au prorata** (et non FIFO) : la somme des latents des lots égale le latent CUMP.
7. **Stablecoins = positions** (section à part), incluses dans les totaux ; l'euro est du cash.
8. **Migration (delisting + migration) = coût reporté par défaut**, option « réaliser ».
9. **Récompenses à coût 0 par défaut**, hors dénominateur du ROI ; option valeur du jour.
10. **Fiscalité FR hors v1** : le PRU par actif n'est pas la plus-value de l'art. 150 VH bis ;
    disclaimer explicite ; les cessions sont conservées pour un futur mode fiscal.
11. **Arithmétique décimale stricte** (big.js, `Big.strict`) ; arrondi uniquement à l'affichage.
12. **Aucun CSV réel dans git** ; jeu de démonstration et de tests entièrement synthétique
    (voir n° 17) ; test local optionnel sur le fichier réel, ignoré par git.
13. **Chaîne d'approvisionnement verrouillée** (23/08/2026, après le retour du ver npm
    « Shai-Hulud » qui a touché des dépendances indirectes du projet) : `.npmrc` refuse les scripts
    d'installation (`ignore-scripts`) et n'installe une version qu'après 7 jours de publication
    (`min-release-age`) ; Dependabot applique le même délai (14 jours pour une majeure) ; toutes les
    actions GitHub sont épinglées par empreinte de commit avec `persist-credentials: false` ;
    CodeQL, Dependency review et OpenSSF Scorecard tournent gratuitement sur le dépôt public.
    Le site publié reste un bundle statique sans CDN : un paquet compromis ne pourrait atteindre
    les utilisateurs que via ce pipeline, d'où la priorité.
14. **Mode démo = le jeu de démonstration du dépôt, sans copie** (23/08/2026) : `AppState.loadDemo()`
    importe `tests/fixtures/coinhouse/export-demo.csv?raw` en chunk paresseux (le garde-fou « aucun
    CSV hors tests/fixtures » reste intact), marque `ui.demoMode`, et toute entrée de données
    réelles (import, saisie manuelle, restauration) passe par `exitDemo()` pour ne jamais mélanger
    fictif et réel. Le diagnostic copiable (§ Aide et retours) ne contient ni montant ni quantité :
    seuls des compteurs, statuts, libellés et colonnes — vérifié par un test sur la fixture.
15. **ROI rapporté au capital maximal engagé** (23/08/2026, revue indépendante) : diviser par
    « Σ achats » comptait plusieurs fois le même euro dès qu'il transitait par l'USDC (près du
    double des apports réels sur un portefeuille passant par l'USDC) et se diluait à chaque rachat. Le ROI du
    portefeuille = total ÷ plus haut niveau atteint par (apports − retraits en euros) ; par actif =
    total ÷ plus haut niveau de (achats − produits). Une migration à coût reporté est un transfert
    (ni achat ni produit), les remises de frais sont converties au taux implicite des frais
    Coinhouse (un frais remisé à 100 % vaut exactement 0), « Investi » partage le périmètre de
    « Valeur » (positions cotées) et le coût des actifs sans prix est annoncé à part. Un oracle
    indépendant (`tests/integration/independent-oracle.test.ts`) recalcule tout depuis le CSV
    avec un code distinct et doit concorder à 1e-9 sur la fixture et sur l'export réel.
16. **Définitions affichées** (23/08/2026, revue « justesse des chiffres ») : un seul arrondi,
    half-up, à la précision affichée, dans `format/fr.ts` ; signe et couleur décidés sur la valeur
    arrondie (« 0,00 € » n'est jamais signé ni coloré) ; chaque pourcentage porte sa base dans son
    libellé (« vs PRU », « vs prix all-in », « sur X € engagés ») ; « Investi » partage le périmètre
    de « Valeur » (actifs cotés) et le coût des actifs sans prix est annoncé à part ; les positions
    « poussière » (< 0,01 €) sont listées dans « Positions clôturées » avec leur résidu latent et un
    sous-total « dont résidus », de sorte que la somme des tableaux égale le P&L total ; les
    abonnements sont libellés « hors P&L » ou « déduits du P&L » selon le réglage ; en mode discret,
    montants et quantités sont masqués mais prix, PRU et pourcentages restent visibles (PDF compris)
    et les CSV ne sont jamais masqués ; les noms de fichiers portent la date locale.

17. **Données d'exemple 100 % synthétiques, jamais dérivées d'un export réel** (23/08/2026, incident
    de confidentialité). La première fixture « anonymisée » était une copie homothétique de l'export
    réel du mainteneur (mêmes opérations, montants multipliés par une constante, dates décalées d'un
    nombre de jours constant, cours de marché conservés) et ces constantes figuraient dans le script
    public : la transformation était réversible et le fichier, embarqué dans la démo du site, exposait
    l'historique complet. Remplacée par `scripts/generate-fixture.ts` (`npm run fixture`) : scénario
    inventé, générateur déterministe, seuls des niveaux de cours publics approximatifs servent de
    points d'ancrage ; un test vérifie que le fichier commis est la sortie exacte du générateur.
    L'ancien fichier et le script d'anonymisation ont été retirés, puis purgés de l'historique git
    (réécriture des commits, artefacts de CI supprimés). Règle : aucune donnée de démonstration ou de
    test publiée ne doit provenir d'un export réel, même transformée.

18. **Prix cotés en USD/USDC convertis en EUR au taux BCE** (23/08/2026, arrivée de
    Kraken, Hyperliquid et DefiLlama dans la chaîne de prix). Ces fournisseurs cotent en dollars
    (ou en USDC, traité comme USD) : la conversion divise par le taux EUR→USD Frankfurter du
    dernier jour disponible — le même cache que la conversion d'affichage € / $ (`src/lib/fx`),
    interrogé pour USD dès qu'un prix est actualisé, quelle que soit la devise d'affichage choisie.
    Sans taux en cache, le fournisseur laisse simplement l'actif sans prix plutôt que d'afficher un
    montant dans la mauvaise devise. La source et l'heure de chaque cotation sont conservées et
    affichées (fiche actif, ligne de fraîcheur de la synthèse), quel que soit le fournisseur qui a
    répondu. CoinMarketCap, pourtant plus complet, a été écarté : son API ne s'appelle pas depuis
    un navigateur (pas de CORS, contrairement aux cinq fournisseurs retenus).

19. **Navigation en espaces séparés, reliés par une Vue d'ensemble qui additionne des soldes,
    jamais des résultats de nature différente** (23/08/2026, proposition v2 § 6.0). Investissement
    (PRU, plus-values latentes et réalisées) et Trading (P&L net par trade, en R) sont deux natures
    de résultat incomparables : les fondre dans un total unique masquerait plus qu'il n'éclairerait.
    La Vue d'ensemble (`#/`, aussi le `start_url` de la PWA) reste donc un point d'entrée qui
    n'additionne que des grandeurs de même nature (valeur des positions, demain le solde de trading)
    et renvoie vers chaque espace pour le détail. Navigation à quatre destinations
    (`src/lib/spaces.ts`, registre `SPACES`) : Vue d'ensemble, Investissement, Trading (en
    préparation, état vide informatif), Plus (écrans secondaires : réglages, aide, nouveautés,
    confidentialité) — chacune avec son accent de couleur et son libellé de retour de barre
    d'application. Les hashes v1 (`#/portfolio`, `#/asset/btc`, `#/import`, `#/add`, `#/report`)
    restent pris en charge comme alias dans `parseHash` : liens partagés, favoris et écrans
    d'accueil déjà installés ne cassent pas.

20. **Comptes de première classe** (23/08/2026, proposition v2 § 6.0, tranche 2 de P19). Tout
    événement du grand livre porte désormais un compte (`EventBase.accountId`,
    `ManualEvent.accountId?` pour les saisies) : le compte Coinhouse (`ch:main`) est implicite dès
    qu'un export existe, les saisies manuelles « hors Coinhouse » antérieures aux comptes se
    rattachent à un second compte implicite (`man:default`) plutôt que de rester orphelines, et
    l'utilisateur peut déclarer d'autres comptes d'investissement (`AppState.addAccount`, écran
    « Comptes »). La vue consolidée (`computePortfolio`) reste le grand livre entier — PRU global,
    chiffres v1 inchangés au centime près ; la vue « par plateforme »
    (`computePortfolioByAccount`) rejoue le grand livre de chaque compte séparément, donc son propre
    PRU et son propre réalisé. Assumé : après une vente, la somme des coûts par compte ne reconstitue
    pas exactement le coût consolidé (chaque compte porte son propre coût moyen pondéré) — seule la
    quantité s'additionne à l'identique, voir `src/lib/domain/engine/accounts.test.ts`. Le contrôle
    de solde Coinhouse (`checkBalances`) reste limité au compte Coinhouse :
    `computePortfolioByAccount` ne transmet `balances` qu'à `ch:main`.

21. **Sauvegarde robuste : IndexedDB en source principale, chiffrement optionnel** (23/08/2026,
    proposition v2 § P12). L'état principal quitte localStorage (plafond ~5 Mo, déjà proche pour les
    gros portefeuilles) pour IndexedDB (base `crch-state`, `src/lib/storage/idb-state-store.ts`) ;
    localStorage devient un miroir écrit en synchrone à chaque enregistrement et à la fermeture de la
    page — seule écriture garantie quand iOS gèle ou décharge l'onglet. Au chargement
    (`state-store.ts`), l'instantané le plus récent gagne par `savedAt` ; à égalité le miroir
    l'emporte, ce qui couvre à la fois la migration v1 → IndexedDB (rien en IndexedDB, ou un miroir
    déposé manuellement) et les états écrits directement dans localStorage (tests, restauration).
    `init()` devient asynchrone et est attendu avant le montage de l'interface. Une sauvegarde
    automatique sur disque (Chrome/Edge desktop, File System Access, handle conservé en IndexedDB,
    permission persistante) complète le filet de sécurité sans dépendre du presse-papiers ni d'un
    clic répété. Chiffrement optionnel de la sauvegarde téléchargeable par phrase secrète :
    PBKDF2-HMAC-SHA-256 (600 000 itérations, recommandation OWASP 2023+) dérive une clé AES-GCM-256,
    toutes deux natives à `crypto.subtle` (`src/lib/storage/encryption.ts`, zéro dépendance).
    Argon2id, pourtant recommandé par l'OWASP en 2024+, a été écarté : il n'existe qu'en WebAssembly
    ou en JS pur, une dépendance de plus dans le chemin critique « restaurer mes données » pour un
    gain marginal face à la menace réelle (vol du fichier, pas une ferme de calcul dédiée). Une
    phrase secrète perdue rend la sauvegarde définitivement irrécupérable — aucun compte, aucun
    service de réinitialisation. `fake-indexeddb` (dépendance de développement uniquement, jamais
    importée en production) simule IndexedDB dans les tests Vitest (environnement Node, sans
    IndexedDB natif) ; stub explicite par test (`vi.stubGlobal('indexedDB', new IDBFactory())`)
    plutôt que `fake-indexeddb/auto`, pour rester local au fichier de test grâce à l'isolation par
    fichier de Vitest (`isolate: true`).

22. **Import Hyperliquid en lecture seule : adresse publique, bruts persistés, perps hors moteur
    CUMP** (23/08/2026, proposition v2 § 4 et § 6.2-6.4, P20). Un compte Hyperliquid n'est identifié
    que par son **adresse publique** (`0x` + 40 hexadécimaux, normalisée en minuscules,
    `hl:<adresse>`) : jamais de clé ni de signature (l'API `info` est intégralement en lecture seule),
    l'adresse n'est envoyée qu'à `api.hyperliquid.xyz` et n'est stockée que localement — cohérent avec
    la décision n° 1. Les bruts (fills, funding, mouvements du grand livre, instantané de compte,
    curseurs de synchronisation) sont persistés dans l'état (`StoredStateV1.hyperliquid: HlState`,
    conteneur additif) plutôt qu'un simple dérivé, parce que l'API Hyperliquid ne conserve qu'un
    historique glissant de fills par adresse : l'application devient la mémoire longue. IndexedDB
    (décision n° 21) absorbe le volume ; sauvegarde JSON, fusion (`json-io.ts`, union par `tid` et par
    clé composite pour funding/ledger) et chiffrement restent inchangés, seulement étendus au nouveau
    conteneur. Horodatage : `time` (ms UTC) conservé tel quel, `at` (`NaiveDateTime`) dérivé en
    **heure de Paris** par `Intl.DateTimeFormat` (`import/hyperliquid/time.ts`, déterministe, jamais
    `new Date()` sur une chaîne) pour que le tri mixte avec les événements Coinhouse d'une même
    journée reste juste.

    Les fills **perps** alimentent un second moteur pur, `domain/trading` (jamais `investedTotal` ni
    `proceedsTotal` de l'Investissement) : P&L net = Σ `closedPnl` (brut de frais, vérifié
    empiriquement par reconstruction d'aller-retours) − Σ frais + Σ funding. La réconciliation
    `accountValue ≈ Σ flux de trésorerie + Σ closedPnl − Σ frais perps + Σ funding + Σ P&L latent` est
    recalculée à chaque rapport (`computeTradingAccount`) et affichée comme **auto-vérification
    permanente** sur le tableau de bord Trading (tolérance 0,01 USDC), plutôt que comme un test isolé.
    Les fills **spot** vont par défaut aux « Avoirs spot » du Trading (quantité, valeur, sans PRU) ;
    l'option `spotAsInvestment` (par compte) les transforme en `TradeEvent` de l'Investissement, la
    contrepartie USDC étant modélisée comme du cash converti en euros au taux BCE du jour (décision
    n° 18), jamais comme une position stablecoin séparée — les frais d'un achat sont prélevés sur le
    jeton reçu (quantité nette), un frais payé dans un jeton tiers n'est pas valorisé (avertissement à
    l'écran) et un fill sans aucun taux EUR→USD connu ce jour-là est omis plutôt que converti au
    mauvais taux. Dépôts et retraits USDC (`userNonFundingLedgerUpdates`) sont des flux de trésorerie
    du compte de trading, jamais un achat de stablecoin.

    Assumé en v1 : les mouvements `send` (transfert inter-DEX) et `spotGenesis` (airdrop) sont listés
    pour mémoire sans effet sur les totaux, faute de sens comptable observé en sonde ; `USDH` n'est
    pas valorisé (seul `USDC` vaut USD, décision n° 18) ; vaults et sous-comptes ne sont pas suivis
    automatiquement — ce sont des adresses distinctes, à déclarer une par une. Détail complet des
    champs et de la synchronisation : `docs/hyperliquid-import.md`.

23. **Journal et statistiques de trading : le journal est une donnée première, les aller-retours et
    les statistiques sont recalculés** (23/08/2026, P21/P22). Les aller-retours (flat → position →
    flat) sont reconstruits par `src/lib/domain/trading/round-trips.ts` à partir des exécutions :
    un retournement clôt et rouvre dans la même exécution (frais au prorata, `closedPnl` à la
    clôture), le funding est rattaché par fenêtre temporelle, et `startPosition` sert de garde —
    un historique tronqué (l'API ne conserve que les 10 000 fills récents) produit un aller-retour
    « incomplet » sans moyenne d'entrée plutôt que des chiffres faux. Identifiants stables et
    uniques par (compte, symbole, instant, numéro d'ordre) : plusieurs aller-retours peuvent naître
    à la même milliseconde. Périmètre v1 : perps seulement — le spot vit dans « Avoirs spot » ou
    dans l'Investissement. Le journal (`StoredStateV1.journal`, une entrée par trade) et les trades
    manuels (`manualTrades`, P&L toujours calculé, jamais saisi) sont des conteneurs additifs de
    l'état, fusionnés par identifiant. R = P&L net ÷ risque initial (explicite, sinon
    |entrée − stop| × taille maximale). Les statistiques (`stats.ts`) sont des standards de
    praticiens (espérance, profit factor, payoff, drawdown, séries), jamais présentées comme
    prédictives : sous 30 trades clos (`MIN_SAMPLE`), l'interface affiche un avertissement à la
    place d'un verdict ; les trades non convertibles dans la devise d'affichage sont comptés à part
    plutôt que sommés dans la mauvaise devise. La courbe d'équité du tableau de bord vient de la
    réponse `portfolio` de la plateforme (persistée à la synchronisation, convertie au taux BCE de
    chaque jour) : l'application ne fabrique pas d'historique qu'elle n'a pas.

24. **Import « format pivot » : deux en-têtes Koinly acceptés, valeurs recalculées par les règles
    de l'app, jamais une estimation silencieuse** (23/08/2026, proposition v2 § 3 bis, remplace
    P17). Plutôt qu'un importeur natif par plateforme (Kraken, Coinbase, Bitvavo, Revolut, Ledger
    Live…) — chantier sans fin, et un risque : une clé d'exchange stockée dans le site
    (docs/ROADMAP.md § 5) — l'app lit le format que Koinly documente publiquement pour tout import
    externe, le CSV « Custom CSV Universal », et l'export que produit Koinly lui-même (Transactions
    → Bulk edit → Export), que Waltio lit aussi directement. Un membre qui utilise déjà un outil
    fiscal (Koinly, ou Waltio via son import Koinly) récupère ainsi ses autres plateformes sans
    qu'aucune clé d'exchange n'entre dans ce site. Les deux formats convergent vers la même ligne
    brute (`src/lib/import/pivot/detect.ts`, `rows.ts`) ; les colonnes propres à l'export interne
    (ID, Type, wallet ids…) sont reconnues mais ignorées, jamais signalées comme « inconnues ».

    Comme pour l'export Coinhouse (décision n° 4), la contre-valeur EUR n'est jamais celle que le
    fichier pourrait suggérer implicitement : elle est recalculée par les mêmes règles que le reste
    de l'app (jambe EUR directe, stables et USD au taux BCE du jour, décision n° 18) ; la colonne
    `Net Worth` du fichier n'est utilisée qu'en dernier recours, pour un échange crypto↔crypto sans
    jambe cash, avec un avertissement affiché — jamais silencieusement. Sans contre-valeur sûre
    (taux BCE manquant à cette date, devise non gérée), la ligne part dans le flux « à qualifier »
    existant plutôt que d'afficher un chiffre inventé. Le dédoublonnage se fait par hachage du
    contenu métier de la ligne (`rows.ts`, FNV-1a), pas par `TxHash` seul : le TxHash est facultatif
    dans les deux formats et une même transaction on-chain peut légitimement produire plusieurs
    lignes ; deux lignes réellement identiques dans un même fichier restent deux opérations
    distinctes (suffixe `#n` déterministe). Les lignes 100 % fiat (EUR, USD, GBP, CHF sans jambe
    crypto) sont ignorées, faute de modèle de trésorerie fiat pour ce format — sauf une sortie
    explicitement étiquetée frais (« cost », « fee », « tax »…), qui devient un événement `fee` à
    part entière. Assumé en v1 : le JSON d'activités Ghostfolio et le XLSX propriétaire de Waltio
    (distinct du fichier Koinly qu'il sait aussi lire) restent hors périmètre ; GBP et CHF sont
    reconnus comme fiat mais non convertibles (aucun taux BCE dans la chaîne de prix, décision
    n° 18) — une ligne dans ces devises part à qualifier plutôt que d'être ignorée à tort. Détail
    complet des deux formats et des sources : docs/pivot-import.md.

25. **Virements internes appariés entre comptes : fenêtre et tolérance propres à l'app (pas celles,
    différentes, de Koinly), coût transporté en entier, rien n'est persisté** (23/08/2026,
    proposition v2 § 3 bis). Un retrait sans produit renseigné (`proceedsEur: null`) et un dépôt
    sans coût renseigné (`costEur: null`) du même actif, dans deux comptes différents, sont
    candidats à l'appariement (`src/lib/domain/transfers.ts`) : la sortie se fait au coût (réalisé
    nul) et la totalité du coût de la cession devient le coût d'acquisition du dépôt — jamais une
    vente, jamais un gain fantôme, dans la même logique que les cessions déjà traitées au coût
    (migrations, décision n° 8). Critères retenus, appariement glouton et déterministe (Δt
    croissant, puis écart de quantité, puis identifiants) : même actif, comptes différents, dépôt
    reçu entre 2 h avant le retrait (décalage d'horloge entre deux plateformes indépendantes) et
    72 h après (confirmation on-chain puis traitement plateforme), écart de quantité ≤ max(2 %,
    0,000001) du montant retiré (frais réseau).

    Koinly documente des critères pour sa propre fusion automatique de virements — même actif,
    ≤ 12 h, retrait strictement avant dépôt, écart ≤ ~20 % — mais ce mécanisme s'applique à des
    mouvements déjà internes à un seul compte Koinly ; l'aide Koinly signale en outre un changement
    du traitement du coût du virement au 16/12/2024, signe que ce n'est pas un repère stable. Notre
    importeur pivot reçoit des lignes brutes indépendantes, potentiellement issues de deux
    fichiers/comptes distincts de l'app, sans marqueur « ceci est un virement » auquel se fier : la
    fenêtre et la tolérance sont donc un choix propre à l'app, pas une reprise du chiffre Koinly —
    plus large côté « après » (72 h plutôt que 12 h, pour couvrir un export/import manuel en plus de
    la confirmation on-chain), plus stricte côté quantité (2 % plutôt que ~20 %, pour éviter
    d'apparier deux mouvements seulement coïncidents), et seule l'app tolère un dépôt horodaté avant
    son retrait (décalage d'horloge entre deux plateformes que Koinly, interne à un seul produit,
    n'a pas à gérer). Le principe du coût transporté en entier, lui, rejoint ce que Koinly documente
    depuis son changement de fin 2024 (le frais de virement augmente le coût moyen du lot transféré
    plutôt que de s'ajouter comme un investissement séparé) : une convergence indépendante, pas une
    copie.

    Le moteur (`engine/compute.ts`) diffère l'application d'un dépôt apparié tant que le coût de son
    retrait n'est pas connu (`pendingTransfers`/`deferredDeposits`), pour encaisser un dépôt
    horodaté avant son retrait sans casser l'ordre chronologique du grand livre consolidé ; la vue
    par compte (`computePortfolioByAccount`) ne peut pas rejouer ce report puisque chaque compte y
    est un grand livre autonome — elle calcule d'abord le run consolidé, puis estampille le coût
    obtenu sur le dépôt (`costEur` ordinaire, lien retiré) avant de rejouer chaque compte
    séparément. Rien de cet appariement n'est persisté : recalculé à chaque chargement à partir des
    événements et de `transferOverrides` (délier une paire avec `'none'`, ou en forcer une
    manuellement depuis l'écran Comptes) — une correction du critère automatique s'applique donc
    immédiatement, sans ré-import. Assumé : au-delà de la fenêtre ou de la tolérance, un retrait ou
    un dépôt reste seul (candidat « orphelin », signalé dans Comptes et en auto-vérification) et se
    comporte comme avant cette décision — cession au coût (réalisé nul) ou dépôt à coût 0 € —
    jusqu'à correction manuelle.
