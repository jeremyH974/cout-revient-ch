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

26. **Convertisseurs natifs par plateforme et import JSON Ghostfolio : la clé d'une ligne hache le
    contenu NATIF, jamais la ligne pivot calculée** (24/08/2026, proposition v2 § 3 bis, P24 « à la
    demande » finalement livré dans la foulée). Le format pivot (décision n° 24) reste la voie
    recommandée, mais cinq plateformes ont un export propre assez répandu sur le Discord pour
    justifier un module dédié : Kraken (`ledgers.csv`), Coinbase (relevé de transactions), Bitvavo
    (historique de transactions), Ledger Live (historique des opérations) et Revolut (relevé crypto)
    — plus un import JSON Ghostfolio (export d'activités). Chaque convertisseur
    (`src/lib/import/platforms/*.ts`) est un module pur qui traduit son format natif en brouillons
    (`PlatformDraft` : jambes envoyée/reçue/frais/contre-valeur, étiquette, description, `txHash`) de
    même forme que les lignes pivot ; `draftsToPivotRows` (`platforms/drafts.ts`) les transforme en
    `RawPivotRow` et tout l'aval — valorisation EUR, dédoublonnage, écran « À qualifier », virements
    appariés, moteur — reste le pipeline pivot inchangé (`ingestPivotRows`, partagé aussi par l'import
    on-chain, décision n° 28).

    La clé d'une ligne (`pv:<compte>:<hash>[#n]`) hache le contenu **natif** (`nativeContent` :
    concaténation des cellules CSV brutes pour les cinq convertisseurs, ou les champs bruts non
    calculés de l'activité JSON pour Ghostfolio — jamais `value = quantity × unitPrice`, recalculé à
    chaque lecture) plutôt que les champs pivot que le convertisseur en déduit. Différence assumée
    avec la décision n° 24 (où la ligne pivot hache directement les champs déjà au format pivot,
    faute d'étape de traduction intermédiaire à protéger) : ici, corriger un bug de traduction (un
    frais mal plié dans la quantité, une étiquette manquante…) change la sortie du convertisseur mais
    jamais son entrée, donc jamais la clé — la ligne corrigée écrase l'ancienne au lieu de la
    dupliquer au ré-import. Un même contenu natif répété dans un fichier reste distinct par le même
    suffixe `#n` déterministe que la décision n° 24.

    `platforms/index.ts` orchestre la détection : le format pivot est essayé en premier
    (`detectPivotFormat`), puis chaque convertisseur dans l'ordre `PLATFORM_CONVERTERS` (Kraken,
    Coinbase, Bitvavo, Ledger Live, Revolut) via son propre `detect(header)` — Coinhouse est déjà
    écarté en amont par l'écran d'import. Aucune ligne n'est jamais estimée silencieusement : un cas
    non couvert devient une `issue` affichée avec son numéro de ligne, jamais une valeur inventée ;
    les mouvements strictement internes à la plateforme (staking ↔ spot, transferts internes…) sont
    comptés `skippedInternal`, à part des `issues`.

    Assumé et sourcé le 24/08/2026 (parseurs de référence BittyTax et Export-To-Ghostfolio, docs
    officielles par plateforme) : le fuseau de la colonne `Date` de Revolut n'est documenté nulle
    part par Revolut elle-même — l'app suppose l'heure locale Europe/Paris (utilisateur français),
    une hypothèse non vérifiable sans échantillon confirmé par son émetteur. Pour Ledger Live, `OUT` :
    BittyTax et Export-To-Ghostfolio ne s'accordent pas sur le traitement du frais réseau dans
    `Operation Amount` ; l'app tranche à la manière de BittyTax (frais déjà inclus dans le montant
    total débité, pas de jambe de frais séparée) plutôt que de deviner. L'export Coinbase peut être
    précédé de lignes de préambule avant l'en-tête réel ; comme `parseCsvText` prend la première
    ligne non vide comme en-tête, un tel préambule fait échouer la détection — limitation connue, non
    contournée : le fichier doit être ouvert et le préambule retiré avant import.

27. **Rendement personnel annualisé (XIRR) : les flux datés sont un sous-produit exact du moteur, le
    taux est résolu en float64 à la frontière du solveur, jamais un montant** (24/08/2026, P10 —
    seule la brique « rendement pondéré par les flux » est livrée ici ; le TWR expliqué et le
    benchmark BTC/DCA de la proposition d'origine restent à faire). Définition Excel : le taux annuel
    `r` qui annule `Σ cf_i · (1+r)^(−(d_i−d_0)/365)` (base 365 fixe, signe négatif aux achats et
    frais, positif aux produits et à la valeur finale). Les flux (`domain/xirr.ts`, `XirrFlow`) ne
    sont pas reconstruits après coup : le moteur (`engine/compute.ts`) enregistre un `CashFlow` à
    chaque mouvement d'argent externe réellement compté dans les totaux (`PortfolioReport.cashFlows`),
    miroir exact de ce qui alimente déjà `investedTotal`/`proceedsTotal` — la valeur actuelle du
    portefeuille au jour du rapport est ajoutée comme un dernier flux positif par `xirrEur`. Un
    portefeuille sans historique suffisant (moins de 30 jours entre le premier et le dernier flux,
    `XIRR_MIN_SPAN_DAYS`), sans les deux signes (que des achats, ou que des produits) ou dont le
    solveur ne converge pas n'affiche **aucun chiffre** plutôt qu'un taux trompeur — trois raisons
    distinctes remontées à l'écran (`report-model.ts`).

    Résolution : Newton amorcé à 0,1 (le germe d'Excel) sert uniquement à **semer** un encadrement du
    zéro (expansion géométrique autour du germe, repli sur une grille fixe de −0,999999 à 1e9 si le
    voisinage du germe n'encadre rien) ; la racine elle-même est toujours tranchée par bissection
    jusqu'à la précision machine, pour ne jamais dépendre de la pente locale au point de départ. Le
    taux est donc calculé en **float64**, seule exception documentée à la règle « aucun `number` ne
    porte un montant » : un taux n'est pas un montant, et les flux qui l'alimentent restent des `Big`
    jusqu'à cette frontière (conversion en `Number` seulement pour nourrir le solveur) ; le résultat
    est ramené à une chaîne décimale (`toFixed(12)`) avant de ressortir du module, pour rester
    compatible avec `format/fr.ts`. Rien n'est persisté (cohérent avec la décision n° 3) : recalculé
    à chaque construction du rapport.

    Affiché uniquement dans la synthèse du Rapport (`report-model.ts`, KPI « Rendement annualisé
    (XIRR) »), commune à l'écran (`routes/invest/Report.svelte`) et au PDF (`export/pdf.ts`). Une
    auto-vérification dédiée (« Flux datés (XIRR) », `support/self-check.ts`) ne revérifie pas le
    solveur mais son **entrée** : elle recalcule que la somme des flux négatifs redonne exactement
    Σ achats (+ abonnements) et que la somme des positifs redonne exactement Σ produits — si cette
    identité casse, l'erreur est dans le moteur, pas dans les données de l'utilisateur, et le message
    le dit explicitement.

28. **Comptes on-chain par adresse publique (BTC, EVM) : liste blanche d'adresses de contrats pour
    les jetons — jamais le symbole —, pagination et débit volontairement prudents** (24/08/2026,
    P25). Comme pour Hyperliquid (décision n° 22) et le principe fondateur (décision n° 1) : une
    adresse **publique** suffit, jamais de clé ni de seed ; elle n'est envoyée qu'à l'API de sa
    propre chaîne (`AppState.addOnchainAccount`, écran Comptes, compte `AccountKind: 'onchain'` de
    l'espace Investissement). Bitcoin via mempool.space (Esplora REST, CORS ouvert, sans clé) :
    `GET /address/{adresse}/txs` puis pagination par `txs/chain/{dernier txid}`, mouvement **net**
    par transaction (Σ sorties reçues − Σ entrées dépensées, en satoshis) — un envoi porte donc sa
    propre quote-part de frais réseau dans la quantité qui sort, cohérent avec le principe « le coût
    voyage » des virements appariés (décision n° 25) ; un mouvement net nul (monnaie rendue à
    soi-même) est un auto-transfert ignoré. Adresses simples uniquement : l'API ne résout pas les
    xpub/zpub, donc pas de dérivation automatique des adresses filles d'un portefeuille HD — hors
    périmètre v1.

    EVM via l'API v2 de **Blockscout**, une instance par chaîne codée en dur (`eth`, `arbitrum`,
    `base.blockscout.com` — Ethereum, Arbitrum One, Base), CORS ouvert et sans clé. Deux flux par
    adresse : transactions natives (le gaz d'un envoi s'ajoute à la quantité sortie, même quand la
    transaction elle-même transporte une valeur nulle — un appel de contrat pur laisse quand même
    sortir du gaz) et transferts ERC-20 filtrés par une **liste blanche d'adresses de contrats**
    (USDC/USDT par chaîne), jamais par le champ `symbol` de l'API : ce champ n'est pas fiable, l'USDT
    d'Arbitrum s'affichant « USDT0 » depuis sa migration de janvier 2026 tout en restant le même
    contrat économique — s'y fier aurait fait disparaître ce jeton de la liste du jour au lendemain.
    Tout jeton hors liste blanche est compté « ignoré » plutôt qu'importé à l'aveugle (anti-spam : un
    portefeuille actif reçoit en permanence de faux jetons) ; liste extensible sur demande, pas
    ouverte par défaut.

    Débit assumé prudent des deux côtés : mempool.space plafonné à 8 pages de 25 transactions par
    défaut, Blockscout à 2 pages par flux (~3 requêtes/minute observées sans clé, non documenté
    formellement par Blockscout) — au-delà, l'historique plus ancien n'est simplement pas lu
    (`truncated`, un bouton invite à resynchroniser plus tard plutôt qu'une boucle automatique qui
    aggraverait la limitation) ; un 429 Blockscout devient une erreur explicite (« réessayez dans une
    minute ») plutôt qu'un nouvel essai agressif. Les mouvements (`onchain/normalize.ts`) deviennent
    des brouillons pivot **sans valeur EUR** (dépôt/retrait, `netWorth: null`) — jamais une estimation
    silencieuse — donc par construction des candidats naturels à l'appariement de virements internes
    (décision n° 25, par exemple un retrait Coinhouse vers un wallet suivi ici) ou des lignes « à
    qualifier » à défaut d'appariement, au même titre que le reste du pipeline pivot (décision n° 26).

    Assumé en v1 : pas de xpub ; liste blanche EVM limitée à USDC/USDT sur trois chaînes ; aucune
    autre chaîne que BTC/Ethereum/Arbitrum/Base ; le palier de débit Blockscout sans clé n'est
    qu'observé, pas documenté par son éditeur — il pourrait changer sans préavis. Incertitude non
    résolue à documenter : Blockscout annonce elle-même, sur son blog, une migration de ses clés
    d'API « par instance » vers une API Pro multichain unifiée (un host unique, paramètre `chainid`)
    à partir du 01/07/2026 ; son annonce précise que les appels devront utiliser une clé Pro mais ne
    dit pas explicitement si l'accès anonyme actuel (sans clé, sur les hôtes par instance utilisés
    ici) est concerné ou seulement les clés existantes — à surveiller, migration vers l'API Pro prête
    à faire si l'accès actuel se dégrade.

29. **Prix « live » (WebSocket Hyperliquid) : opt-in strict, jamais de socket sans activation, jamais
    écrit dans le cache de prix persisté** (24/08/2026, P26). Un interrupteur « Prix en direct » sur
    l'écran Trading (`routes/Trading.svelte`, réglage persisté `ui.liveMids`) ouvre
    `wss://api.hyperliquid.xyz/ws` et s'abonne à `allMids` (`pricing/live.ts`, module pur, socket
    injectable dans les tests) : sans ce geste explicite, aucune connexion n'est jamais ouverte, y
    compris au chargement d'un état où le réglage était actif — `AppState` ne rouvre le flux au
    démarrage que si `ui.liveMids` était déjà vrai à la sauvegarde précédente. Keepalive applicatif
    (`{"method":"ping"}` toutes les 50 s, la documentation Hyperliquid demandant seulement de
    « gracefully reconnect » sans imposer de mécanisme) et reconnexion en cas de coupure par backoff
    exponentiel avec gigue (jusqu'à 30 s), plutôt qu'un ré-essai immédiat qui martèlerait le service.
    Le flux se coupe quand l'onglet passe en arrière-plan (`visibilitychange`) et reprend à son retour
    si le réglage est toujours actif — pas de socket qui tourne dans un onglet caché.

    Les cotations reçues ne mettent à jour que l'affichage des actifs **actuellement détenus**
    (throttle de 3 s), traduites vers les clés de marché Hyperliquid via `spotMeta` (mêmes tables que
    l'import Hyperliquid, décision n° 22) ; elles ne sont **jamais écrites dans le cache de prix
    persisté** (`pricing/service.ts`, cascade CoinGecko → Coinbase → Kraken → Hyperliquid →
    DefiLlama) : à la fermeture de l'onglet, l'app retombe sur le dernier prix mis en cache par la
    cascade habituelle, jamais sur un mid figé au dernier message reçu. Aucune donnée utilisateur ne
    transite par ce canal : `allMids` est un flux de marché public, sans adresse ni identifiant.

30. **TWR = Dietz modifié quotidien enchaîné, flux pondérés par la fraction de journée qui leur
    reste** (24/08/2026, P10). Le XIRR répond à « qu'est-ce que mon argent a rapporté », le TWR à
    « mes choix étaient-ils bons » : les deux sont affichés côte à côte dans la synthèse du Rapport,
    et leur écart est précisément l'effet du calendrier des apports. Faute de valorisation à
    l'instant exact de chaque flux, chaque journée est traitée en Dietz modifié
    (`base = V_{t−1} + Σ w_i·F_i`, `w_i` = fraction du jour restant après le flux — un achat à 23 h
    n'a pas pu produire de rendement ce jour-là), puis les journées sont enchaînées
    multiplicativement (`src/lib/domain/twr.ts`). Une journée dont la base est nulle ou négative est
    **neutralisée** plutôt que divisée, et comptée à part. L'annualisation n'apparaît qu'au-delà de
    30 jours (même seuil que le XIRR) ; en dessous, le cumulé est affiché tel quel. La fenêtre est
    celle des cotations réellement disponibles, et les journées où une position détenue n'a aucun
    cours sont valorisées à leur coût, donc comptées à rendement nul : le Rapport annonce leur
    nombre plutôt que de laisser croire à une couverture totale. Le test qui garantit tout cela est
    la propriété d'**invariance au calendrier des apports**, vérifiée sous fast-check, doublée d'un
    recoupement avec le XIRR sur le cas à flux unique.

    Corollaire découvert en construisant ce calcul : un **virement interne apparié à cheval sur deux
    jours** (retrait 23 h 30 lundi, dépôt 1 h 00 mercredi) sortait l'actif du portefeuille consolidé
    pendant deux jours — la courbe de valeur tombait à zéro puis revenait. `holdingOpsOf`
    (`history/series.ts`) écarte désormais la jambe **sortante** d'un virement apparié des vues
    consolidées et garde l'entrante (qui porte la quantité réellement reçue, frais de réseau
    déduits) : la position reste détenue pendant le transit et le solde final reste juste. Les vues
    **par compte** ne sont pas concernées : là, un virement est un vrai mouvement des deux côtés.

31. **Le repère est le rejeu des flux RÉELS de l'utilisateur sur un seul actif, jamais un conseil**
    (24/08/2026, P10). « Mêmes apports en BTC » signifie : mêmes montants, mêmes dates, au cours de
    chaque date (`src/lib/domain/benchmark.ts`). Comparer autre chose — un investissement forfaitaire
    fictif, une autre période — comparerait deux choses différentes ; la fenêtre commune est donc
    imposée et les flux antérieurs à la première cotation du repère sont comptés et **affichés**
    comme écartés. Un retrait ne peut pas vendre plus que ce que le repère détient : l'excédent est
    rogné et signalé, jamais avalé. Le TWR et le XIRR du repère passent par les mêmes fonctions que
    ceux du portefeuille — une seule implémentation, donc une seule chose à prouver. La méthodologie
    et l'aide disent explicitement qu'il s'agit d'arithmétique sur des cours passés, sans valeur
    prédictive, et que rien dans l'application n'est un conseil en investissement.

32. **Une clé d'explorateur de blocs est acceptée (facultative) ; une clé d'exchange reste refusée**
    (24/08/2026). Les deux n'ont rien de commun : une clé d'exchange peut déplacer des fonds, une clé
    d'explorateur ne lit que des données de la blockchain déjà visibles de tous et ne signe rien. Le
    motif est concret : Blockscout a transféré son trafic vers une **Pro API** à clé le 1ᵉʳ juillet
    2026 ; au 24/08/2026 les instances par chaîne répondaient encore sans clé, mais
    `api.blockscout.com` renvoyait déjà `402 Proceed with API key`. Le chemin sans clé est donc en
    sursis. Ordre d'essai (`import/onchain/evm-sync.ts`) : clé configurée → Blockscout par instance →
    Routescan (sans clé, mais Ethereum seulement — les autres chaînes répondent « chain not
    supported »). Les trois fournisseurs parlent le même dialecte `module`/`action`, d'où un
    adaptateur unique (`etherscan.ts`) qui lit au passage les **transactions internes**, donc l'ETH
    reçu via un contrat, jusqu'ici invisible. La clé vit dans `localStorage`, jamais dans une
    sauvegarde fusionnée, et `scripts/api-contract.mjs` surveille toutes les 6 h que le chemin sans
    clé vit encore : la CI préviendra avant les utilisateurs.

33. **Les clés publiques étendues Bitcoin sont dérivées LOCALEMENT, et les mouvements nettés au
    niveau du portefeuille** (24/08/2026, P25). Aucune API publique sans clé n'accepte une clé
    étendue (`mempool.space/api/v1/xpub/…` répond 404), et c'est heureux : confier un xpub à un tiers
    lui livre la vue permanente de tout le portefeuille, passé et à venir. La dérivation se fait donc
    dans le navigateur (`import/onchain/xpub.ts`, @scure/@noble chargés à la demande dans leur propre
    morceau de 23 ko gzip) ; seules les adresses individuelles sont interrogées, exactement comme
    avant. Schémas couverts : BIP44 (`xpub` → `1…`), BIP49 (`ypub` → `3…`), BIP84 (`zpub` →
    `bc1q…`) ; **Taproot (BIP86) hors périmètre**, dit dans l'interface plutôt que silencieusement
    absent. Balayage des chaînes 0 et 1 avec un **gap limit de 20** (norme BIP44) et un plafond dur
    de 500 adresses. Point de justesse essentiel : le mouvement d'une transaction est net **sur
    l'ensemble des adresses dérivées**, pas par adresse — sans quoi la monnaie rendue par une
    dépense passerait pour une réception et gonflerait symétriquement dépôts et retraits. Les clés
    **privées** étendues (`xprv`, `yprv`, `zprv`) sont refusées à la saisie avec un avertissement
    explicite et ne sont jamais enregistrées. Conformité vérifiée par les vecteurs de test officiels
    des BIP eux-mêmes.

34. **Exécutions en direct : ingestion strictement additive, dédoublonnage par `tid`, abonnements
    rejoués à chaque reconnexion** (24/08/2026, P26). Un second interrupteur « Trades en direct »,
    distinct de « Prix en direct » et **décoché par défaut** comme lui, abonne chaque compte
    Hyperliquid à `userFills` et `userFundings` sur le **même socket** que `allMids`
    (`lib/live/socket.ts`, transport extrait de `pricing/live.ts` sans en changer le comportement —
    ses tests existants sont restés verts). `aggregateByTime` est laissé à faux : agréger
    fusionnerait des exécutions et détruirait les `tid`, seule clé de dédoublonnage fiable
    (décision n° 22). Le **snapshot d'ouverture n'est pas un cas particulier** : il rejoue
    l'historique récent et passe par le même dédoublonnage que les pousses. L'ingestion n'ajoute
    jamais que des bruts et **ne touche pas aux curseurs** de la synchronisation REST — un fill reçu
    en direct ne doit pas faire sauter une fenêtre au prochain import. Les abonnements sont **relus à
    chaque (re)connexion** : un compte ajouté après coup est pris en compte, et une reconnexion ne
    repart pas amputée — c'est le défaut classique qui laisse un flux mourir en silence après la
    première coupure. Enfin, seul un message de données (ni accusé, ni pong) fait passer l'état à
    « live » et remet le backoff à zéro.

    **Vie privée, différence à ne pas taire** : `allMids` est un flux public sans identifiant, mais
    `userFills` **envoie l'adresse publique** du compte — la même qu'à chaque synchronisation, à la
    même destination et à personne d'autre. La page Confidentialité le distingue explicitement au
    lieu de laisser croire que les deux flux se valent.

35. **Un montant réalisé est daté du jour où il l'a été, jamais du jour où l'aller-retour se
    ferme** (24/08/2026, défaut signalé sur un compte Hyperliquid réel). La première version du
    calendrier de P&L rattachait le résultat NET d'un aller-retour à son `closedAt`. C'était faux
    dès qu'un trade dure plus d'une journée : une position montée le 3, allégée le 5 et soldée le 7
    affichait **zéro le 5** puis tout d'un bloc le 7 ; les frais d'ouverture et le funding d'une
    position **encore ouverte** n'apparaissaient nulle part ; et le total d'un mois ne correspondait
    ni à la plateforme ni au tableau de bord de l'application, qui compte les fills de la période
    (`computeTotals`). Sur le seul jeu de démonstration, l'écart d'un mois atteignait déjà 2,21
    USDC sur 2,27, et huit jours portant du funding réel affichaient 0,00.

    Règle retenue : `realizedEvents` (`domain/trading/calendar.ts`) produit **un montant par
    événement daté** — `closedPnl − frais` au jour du fill, un paiement de funding au jour du
    paiement, le net d'un trade manuel au jour de clôture saisi (il n'a pas d'exécution à dater).
    C'est la règle de l'exchange, et la seule qui rende le calendrier additif : la somme de la
    grille sur tout l'historique **est** `totals.net` du tableau de bord, à 1e-9 près
    (`tests/integration/hl-fixture.test.ts`), et une journée sélectionnée se décompose par trade en
    montants qui redonnent la case.

    Ce qui NE change pas : les statistiques (`stats.ts`) restent par trade — espérance, taux de
    réussite, profit factor et R n'ont de sens qu'à l'échelle d'un aller-retour, donc rattachés à sa
    clôture. Leur « P&L net des trades clos » est donc légitimement différent du réalisé net du
    tableau de bord (qui compte aussi ce qu'une position ouverte a déjà encaissé) : le libellé le
    dit désormais, plutôt que de laisser deux chiffres proches se contredire en silence.

    **Garde** : `coherence.spec.ts` couvrait l'espace Investissement seulement — c'est ce trou qui a
    laissé passer le défaut. Il vérifie maintenant aussi que la somme du calendrier égale le réalisé
    net du tableau de bord, écran contre écran.

36. **Alertes de prix relatives au PRU et simulateur « et si ? » : locaux, au franchissement,
    honnêtes sur leurs limites** (25/08/2026, P29). La feuille de route écartait « les alertes de
    prix » comme « impossibles sans serveur » ; c'était vrai du push app fermée, pas des alertes
    elles-mêmes. Recherche du 25/08/2026 (sources dans docs/alerts.md) : le Web Push exige un
    émetteur authentifié VAPID — y compris la « Declarative Web Push » de WebKit, qui change la
    réception, pas l'émission ; la Periodic Background Sync est Chromium seul, à cadence non
    garantie (pilotée par le site engagement), jugée « harmful » par Mozilla ; les Notification
    Triggers sont abandonnés. Donc : **évaluation quand l'app est ouverte uniquement**, dit tel
    quel dans l'interface — c'est le prix du « rien ne quitte le navigateur », et un polling
    ≥ 60 s survit au regroupement des réveils de Chrome (1/min en arrière-plan).

    **Sémantique de déclenchement — franchissement, jamais niveau.** Une règle armée se déclenche
    quand le prix franchit le seuil, se désarme, puis (si récurrente) se réarme quand le prix
    s'éloigne d'au moins 1 % de l'autre côté, avec au plus un déclenchement par heure et par
    règle ; un déclenchement retenu par ce délai reste dû (la règle reste armée), jamais perdu. À
    la création, si la condition est déjà remplie, la règle naît désarmée et l'aperçu le dit :
    **créer une alerte ne notifie jamais**. L'état des meilleurs (TradingView, Delta, Binance,
    CoinGecko, CoinStats, Kraken…) n'offre que des anti-spam temporels (1 h fixe chez Delta,
    1/jour chez Binance, once-per-bar chez TradingView) ; l'hystérésis de ré-armement n'est
    documentée nulle part, et **aucun tracker grand public ne propose d'alerte relative au coût
    de revient** (seul IBKR a une alerte de P&L du jour, en desktop pro) : c'est précisément le
    différenciateur d'un outil qui calcule le PRU. Les seuils relatifs **suivent le PRU
    recalculé** — un nouvel achat les déplace sans toucher aux règles, là où une alerte posée chez
    un courtier devient obsolète en silence.

    **Un seul calcul de seuil.** `alertThresholdEur` (domaine pur) sert l'aperçu de création, la
    liste, et l'évaluation : aucun écran ne peut afficher un autre seuil que celui testé. Les
    seuils vivent en euros (devise des données) ; l'évaluation lit un rapport recalculé en euros
    quand l'affichage est en dollars, et ne consomme que des cotations fraîches — le cache périmé
    ne déclenche jamais. L'évaluation est appelée explicitement (fin d'actualisation, mids live,
    prix manuel, veille) plutôt que par effet réactif : flux lisible, testable, sans boucle.

    **Objectif « net de frais »** : seuil = prix où vendre TOUTE la position dégage X % net, au
    barème figé dans la règle — `P = (PRU × (1 + X %) + fixe ÷ qté) ÷ (1 − f)`. La grille
    Coinhouse Particuliers « Classique » du 18/08/2026 (achat 0,99 % virement / 1,99 % carte,
    vente 1,29 %, crypto↔crypto 0,79 %, stable↔stable 0,19 %, + 0,12 € fixes par transaction) est
    reprise en préréglages **éditables et datés** dans `domain/fees.ts` ; le PDF source reste hors
    du dépôt (`.gitignore`) — les taux sont des faits, le document ne nous appartient pas.

    **Simulateur** : mêmes règles que le moteur (all-in : à l'achat les frais réduisent la
    quantité reçue, jamais le coût de revient ; à la vente ils réduisent le produit net ; vendre
    ne change jamais le PRU — affiché en toutes lettres, c'est contre-intuitif), montant en euros
    d'abord (l'utilisateur Coinhouse achète en euros — les calculateurs du marché saisissent des
    parts), mode inverse « quel montant pour amener mon PRU à la cible » (rare : confirmé chez le
    seul StockAverager), « récupérer ma mise » net de frais, sortie euros vs stablecoin (0,79 %
    et sursis 150 VH bis vs 1,29 % et cession imposable — information, jamais un conseil), et
    mise en garde sobre : un PRU abaissé n'améliore pas l'actif, il grossit l'exposition.
    Vérifié par propriétés (fast-check) : le PRU simulé reste strictement entre prix payé et PRU
    initial, deux rachats successifs = le rachat cumulé, réalisé + latent restant = latent
    initial, et vendre au prix d'équilibre rend exactement l'objectif net (1e-9).

    **Notifications** : permission demandée uniquement depuis un clic (pre-prompt in-app — un
    refus au prompt natif est quasi définitif), affichage par `registration.showNotification`
    (seule voie Android/iOS installé ; `new Notification()` lève sur mobile), clic géré par
    `public/sw-notifications.js` injecté dans le service worker généré (workbox `importScripts` —
    le mode `generateSW` et le flux de mise à jour existants ne bougent pas) : focaliser l'app si
    elle est ouverte, sinon ouvrir la page Alertes. Badging API en détection de capacité. La
    veille (opt-in, décochée par défaut comme les flux live de la décision n° 29) réutilise la
    cascade de fournisseurs existante à cadence choisie (1-15 min) et s'arrête d'elle-même sans
    règle armée ; la page Confidentialité décrit ce qui sort (la même liste d'actifs, plus
    souvent) et ce qui ne sort jamais (seuils, PRU).

    **Écarté, et pourquoi** : webhooks TradingView (serveur public obligatoire, abonnement
    payant, ToS hostiles aux accès programmatiques ; les serveurs MCP TradingView communautaires
    reposent sur du scraping dont la bibliothèque de base est archivée) ; Periodic Background
    Sync comme socle (au mieux un bonus opportuniste futur) ; rappels en boucle « tant que la
    condition est vraie » (Delta) — un franchissement est une information, sa répétition est du
    bruit. **Préparé pour la suite** : le moteur pur (`domain/alerts.ts`, sans DOM) peut être
    rejoué tel quel par un émetteur opt-in (micro-worker cron + Web Push VAPID, relais ntfy à
    sujet aléatoire) ou exposé par un serveur MCP local à côté du MCP officiel CoinGecko — sans
    changer une ligne des règles.

37. **Un seuil de prix saisi en dollars reste ancré en dollars ; tout le reste convertit à la
    frontière d'affichage** (25/08/2026). Quand le toggle d'affichage est en dollars, les feuilles
    d'alerte et de simulation saisissent et affichent en dollars, mais le moteur ne voit toujours
    que des euros : conversion au taux BCE du jour à l'entrée, reconversion au même taux à la
    sortie (aller-retour exact). Exception sémantique assumée : le type « Prix exact » tapé
    pendant un affichage dollar devient `price-usd` — le montant garde son sens en dollars, comme
    une alerte de paire BTC/USD chez un exchange, et s'évalue par `seuil € = prix $ ÷ taux(jour)` ;
    l'alternative (convertir une fois à la création) aurait fait dériver en silence le chiffre
    affiché dès que l'euro-dollar bouge. Les seuils relatifs au PRU sont des pourcentages, donc
    sans devise ; les libellés d'une règle gardent SA devise d'ancrage (jamais ré-ancrée par un
    changement de toggle) ; l'historique convertit au taux du jour de l'événement, comme le reste
    de l'app ; sans taux connu, une règle dollar est « dormante », jamais évaluée de travers.
    Propriété vérifiée : évaluer `price-usd` au taux r ≡ évaluer le seuil euro `$ ÷ r`.

38. **Vérification d'alertes app fermée : Periodic Background Sync opportuniste, service worker
    sans moteur, comparaison décimale exacte** (25/08/2026). Sur Chromium avec la PWA installée,
    le navigateur peut réveiller le service worker (`periodicsync`) à SA fréquence (liée à
    l'engagement — en pratique quelques fois par jour au mieux) : un bonus best-effort au-dessus
    de la veille onglet-ouvert, jamais une garantie, et l'interface le dit avec ces mots. Le
    service worker ne recalcule jamais le moteur : l'app précalcule un instantané compact (seuils
    EUR en chaînes via `alertThresholdEur`, identifiants CoinGecko, états d'armement) dans le
    meta-store IndexedDB existant ; au réveil, `public/sw-alerts-core.js` compare en décimal
    EXACT sans flottant (`cmpDec`, testé par propriétés contre big.js via node:vm) et rejoue la
    même sémantique armé/désarmé + délai minimal (`decideFires` ≡ `evaluateAlerts`, propriété
    testée) ; les déclenchements notifiés sont déposés dans IndexedDB et journalisés par l'app à
    l'ouverture, sans re-notifier. Choix conservateurs : pas de ré-armement côté service worker
    (l'app seule ré-arme — un faux silence est moins grave qu'un faux réveil), règle inconnue =
    non armée, un client visible court-circuite le réveil (l'app ouverte fait mieux), et rien ne
    sort de plus que la veille classique (identifiants d'actifs seuls — page Confidentialité mise
    à jour). La notification garantie app fermée reste un non-objectif sans serveur :
    `docs/proposals/2026-08-push-et-mcp.md` chiffre les deux options serveur (émetteur Web Push
    opt-in, serveur MCP local) avec sources du 25/08/2026, recommandation : MCP local d'abord.

39. **L'offre Coinhouse est DÉDUITE des données, jamais demandée ; la rentabilité affichée est
    celle qui s'est réellement produite** (25/08/2026). Le rapport gagne une section « Abonnement
    Coinhouse » : les lignes « Abonnement » facturées dans l'export disent si une offre est payée
    et laquelle (Classique / Investisseur / Gestion Privée, classées par le montant annualisé sur
    12 mois glissants — frontière à 400 €, qui sépare des ordres de grandeur) ; la colonne de
    remises de l'export dit ce que l'offre a fait gagner ; la rentabilité = remises − abonnements
    sur la même fenêtre, fenêtre qui se termine au dernier événement Coinhouse (pas à l'horloge :
    un export s'arrête quand il s'arrête). Deux compléments, tous deux annoncés comme estimations :
    le contrefactuel « qu'aurait coûté la grille Classique sur les mêmes opérations » (grille du
    18/08/2026, achat supposé par virement — l'export ne distingue pas la carte ; pourcentage de la
    grille + fixe paramétré une seule fois) et, pour un compte Classique, le volume annuel
    d'équilibre de l'offre Investisseur (118,80 €/an ÷ taux de frais effectif observé, hypothèse
    « frais offerts » explicitée — la grille publiée ne chiffre pas lisiblement les plafonds, et
    les montants anti-copie du PDF ne se laissent pas extraire : on n'encode que ce qui est sûr).
    Un seul modèle de rapport sert l'écran et le PDF ; la cohérence écran ↔ moteur est vérifiée
    par la spec `coherence`, rejouable sur l'export réel. Personne côté trackers grand public ne
    fait ce calcul (les courtiers pro affichent des « commission savings ») : c'est le même
    différenciateur que l'alerte relative au PRU — l'outil connaît VOS flux réels.
40. **Les constats sont produits par des règles pures et CODÉES ; le français est un rendu, pas le
    calcul** (26/08/2026). Le moteur `src/lib/domain/insights.ts` observe le rapport déjà calculé
    et émet des constats `{code, tone, priority, values}` où chaque valeur annonce sa nature
    (`money`, `ratio`, `count`, `assets`, `day`, `tier`) en chaîne décimale — jamais une phrase.
    `src/lib/format/insights.ts` en fait des phrases françaises, seul endroit où le mode discret
    masque les montants et où la devise d'affichage s'applique. Trois conséquences voulues : la
    version anglaise (P18) ne touchera pas au calcul ; l'écran d'accueil, le rapport, le PDF et le
    presse-papier affichent EXACTEMENT les mêmes phrases, calculées une fois ; un constat est du
    JSON simple, donc exposable tel quel par un futur serveur MCP. Le `switch` du rendu est
    exhaustif : ajouter un code sans écrire sa phrase ne compile pas. Le ton distingue le SIGNE
    d'un chiffre (`positive`/`negative`) d'un POINT À TRAITER (`attention` : lignes à qualifier,
    actifs sans cours, concentration) — les confondre peindrait tout un portefeuille en baisse en
    orange et noierait les vrais problèmes de données. L'ordre est déterministe (priorité
    déclarée en un seul endroit, égalité départagée par l'identifiant) et la qualité des données
    passe avant les chiffres, parce qu'un total calculé sur des lignes non qualifiées est faux.
    Enfin, la règle intangible : **un constat constate, il ne recommande jamais** d'acheter, de
    vendre ni d'arbitrer — c'est la frontière information / conseil que la doctrine AMF du
    04/08/2026 trace pour les crypto-actifs (MiCA art. 3, § 1, 24), et elle est écrite dans le
    rapport lui-même.
41. **Le risque se mesure sur l'INDICE de performance, jamais sur la valeur du portefeuille**
    (26/08/2026). Un retrait de 10 000 € fait chuter la valeur brute sans qu'aucune perte n'ait eu
    lieu : un repli calculé dessus inventerait des krachs les jours de virement, et un utilisateur
    qui a beaucoup versé verrait sa « volatilité » gonfler à mesure qu'il investit. `twrEur` expose
    donc désormais son indice chaîné jour par jour (base 1, apports et retraits neutralisés par le
    Dietz modifié déjà en place, jours neutralisés reportés à plat), et `src/lib/domain/risk.ts`
    en tire repli maximal (profondeur, dates de sommet et de creux, date de retour au niveau),
    repli en cours, volatilité annualisée (écart-type d'échantillon × √365 — la crypto se négocie
    en continu, pas 252 jours), volatilité baissière, ratio de Sortino et régularité (jours
    gagnants/perdants, meilleur et pire jour). Choix assumés : **Sortino plutôt que Sharpe**, parce
    qu'il ne demande pas de taux sans risque à inventer et qu'il ne pénalise que les baisses, ce
    que la littérature crypto recommande pour des rendements asymétriques ; **cible de rendement à
    0 %**, annoncée à l'affichage ; **30 jours de recul minimum** avant d'annoncer une volatilité
    (en dessous, un écart-type n'est que du bruit) ; le repli, lui, se mesure dès le premier recul.
    La section « Risque » du rapport (écran et PDF) écrit noir sur blanc que ces chiffres ne se
    comparent pas à un relevé de compte, et la spec `coherence` vérifie que le constat et le
    tableau annoncent le même repli. La répartition est triée par part décroissante et doublée d'un
    anneau SVG maison (`AllocationDonut`, aucune dépendance, décoratif pour un lecteur d'écran —
    le tableau reste la source lisible).
42. **Historique profond DefiLlama, interrogé en dernier, conversion injectée** (26/08/2026).
    Les séries quotidiennes butaient sur la profondeur des fournisseurs : 365 jours chez CoinGecko,
    721 points chez Kraken ; seul Coinbase pagine tout l'historique, et uniquement pour les paires
    qu'il cote en euros. Un portefeuille ouvert il y a plus d'un an, ou un actif de longue traîne,
    voyait donc **le TWR, le repère et la fiche actif travailler sur un historique tronqué**.
    `coins.llama.fi/chart` comble ce trou : profondeur réelle jusqu'à 2013 pour BTC, et les jetons
    morts restent servis (LUNC renvoie ses points de mai 2022). Trois choix, dans cet ordre
    d'importance. **(a) Il est appelé en dernier** : les trois autres cotent nativement en euros,
    lui seul cote en dollars et impose une conversion — on préfère toujours un prix coté à un prix
    converti, et le service ne fait remplir à chaque fournisseur que les bords encore vides, si
    bien qu'il ne reçoit que ce que personne n'a couvert. **(b) La conversion est injectée, jamais
    devinée** (`usdToEurAt`, série `fx.rates.USD` au taux BCE du jour, chargée indépendamment de la
    devise d'affichage — `app.fxLookup`, lui, suit l'affichage et serait vide en euros) ; un jour
    sans taux voit son point **omis**, le service marquant alors l'actif `partial`, plutôt que
    converti à un taux approximatif. **(c) `start` est ancré à midi UTC**, si bien qu'un point
    appartient sans ambiguïté à sa journée, sans la bascule de minuit que `closeDayOf` traite chez
    CoinGecko ; ces points sont donc des cours de milieu de journée et non des clôtures, ce qui ne
    mélange jamais deux natures dans une même journée puisque les bords remplis sont disjoints.
    Contrat établi par sondes réelles du 26/08/2026, la documentation officielle
    (`docs.llama.fi/coin-prices-api`) étant en 404 : CORS ouvert sur l'origine du projet, `span`
    plafonné à 500 points (501 → HTTP 400), `start` et `end` mutuellement exclusifs, actif inconnu
    → `{"coins":{}}` en HTTP 200. `scripts/api-contract.mjs` surveille la forme **et** le plafond,
    parce qu'une baisse silencieuse de celui-ci ferait échouer toutes nos requêtes d'un coup.
43. **L'estimation fiscale française rejoue les cessions avec la méthode GLOBALE, et n'est jamais
    présentée comme un calcul** (26/08/2026). L'article 150 VH bis impose une formule qui ne
    ressemble à rien de ce que fait le reste de l'app : la plus-value se calcule sur le prix total
    d'acquisition du PORTEFEUILLE (pas sur le PRU d'un actif — décision n° 10) et sur la valeur
    globale du portefeuille au jour de la cession. `src/lib/domain/tax-fr.ts` rejoue donc le grand
    livre dans l'ordre en maintenant ce PTA résiduel. Seules les sorties vers une monnaie ayant
    cours légal sont des cessions ; tout échange entre actifs numériques — stablecoins compris, y
    compris un stablecoin euro — est en sursis et ne touche à rien. La valeur globale d'un jour
    passé est reconstituée comme « valeur de clôture + produits encaissés ce jour-là » (une clôture
    est postérieure à la vente, l'actif vendu n'y figure plus) ; le champ `taxAnnotations`, réservé
    depuis la v1, permet de la corriger à la main. Quand elle manque, le module **ne consomme pas
    le PTA et laisse la plus-value à `null`** : mieux vaut un PTA trop élevé qu'une plus-value
    inventée, et l'écran le dit. Seuil de 305 € sur la SOMME DES PRIX DE CESSION (pas un
    abattement), taux par millésime (30 % jusqu'aux cessions 2024, 31,4 % ensuite — table à une
    ligne par changement), moins-values imputables sur la seule année, jamais reportées. L'aperçu
    avant vente affiche l'EFFET de la vente sur l'impôt de l'année (supplément, réduction si elle
    dégage une moins-value, exonération, année perdante), pas un montant hors contexte. Deux
    hypothèses sont écrites partout où le résultat s'affiche : ce portefeuille est supposé être le
    portefeuille entier du contribuable, et la valeur globale est reconstituée. Montants toujours
    en euros, même quand l'app affiche en dollars. **Rien de tout cela ne remplace un
    professionnel**, et le rapport l'écrit.
44. **Le contexte de marché est un opt-in réseau distinct, et il ne devient jamais un signal**
    (26/08/2026). L'indice Fear & Greed d'alternative.me est la SEULE donnée de l'app qui ne vienne
    ni des opérations de l'utilisateur ni des cours de ses actifs : il a donc sa propre case à
    cocher (`ui.marketContext`, décochée par défaut), séparée de la source de prix, et rien n'est
    chargé tant qu'elle n'est pas cochée. Trois garde-fous : l'**attribution** à la source est une
    condition d'utilisation, donc affichée avec la valeur ; la bande publiée par la source fait
    autorité (on ne reclasse la valeur nous-mêmes que si le libellé devient inconnu — il a déjà
    changé) ; et l'indice est présenté comme l'humeur du marché entier, explicitement pas comme un
    signal sur le portefeuille. Toute réponse hors contrat (valeur non numérique, hors de
    l'échelle 0-100, horodatage absent) rend `null` : mieux vaut ne rien afficher qu'un contexte
    faux. La requête ne transporte aucune donnée de l'utilisateur — elle est identique pour tout le
    monde. Le stub E2E la sert en local (aucun test ne sort sur Internet) et le monitor vérifie le
    contrat des trois champs lus.
45. **Une alerte peut expirer et porter une seconde condition, mais le service worker ne voit ni
    l'une ni l'autre** (26/08/2026). Deux manques relevés par l'étude face à TradingView :
    l'**expiration** (leur défaut est de deux mois — une alerte oubliée finit toujours par se
    déclencher pour une raison étrangère à l'intention de départ) et les **conditions composées**.
    L'app ajoute donc `expiresAt` (absolu, `null` = sans limite, choisi parmi des durées relatives)
    et `gate`, une condition supplémentaire sur le contexte de marché (décision n° 43) : les deux
    termes doivent être vrais ensemble. Trois règles de comportement : une règle expirée ne se
    déclenche plus **mais garde son état** (retirer l'expiration ne doit pas la ré-armer par
    surprise) ; une condition non satisfaite **bloque sans désarmer** (le seuil reste franchi, la
    règle partira dès que le contexte suivra) ; et sans contexte disponible, une règle conditionnée
    reste **dormante** — on ne déclenche pas une alerte dont la moitié des termes est invérifiable.
    Conséquence structurante : ces règles sont **exclues de l'instantané du service worker**, qui
    ne sait comparer qu'un prix à un seuil et ne peut vérifier ni une date au réveil ni un indice
    externe. C'est ce qui préserve l'équivalence prouvée entre `decideFires` et `evaluateAlerts`
    (décision n° 38), et l'interface le dit à la création. Enfin, les deux champs ne sont **écrits
    dans la sauvegarde que s'ils portent une valeur** : une règle ordinaire garde exactement la
    forme qu'elle avait, ce que vérifient les tests d'aller-retour.
46. **Une projection est un scénario CHOISI par l'utilisateur, jamais une prévision**
    (26/08/2026). Le mode « Plan mensuel » du simulateur déroule des versements réguliers et en
    tire les conséquences arithmétiques sur le PRU, la position, les frais et le latent — mais la
    variation de prix supposée est saisie par l'utilisateur, pas produite par un modèle. C'est la
    frontière entre « voici ce qui va se passer », qu'aucune app honnête ne peut dire, et « voici
    ce qu'impliquerait cette hypothèse », qui aide vraiment à décider. Deux hypothèses de calcul
    sont écrites sous le résultat : versements mensuels réguliers au même barème de frais, et
    variation **répartie linéairement** — un chemin parmi une infinité, alors que le PRU obtenu
    dépend du chemin et pas seulement du point d'arrivée. Le repère sourcé Vanguard (2023 :
    investir en une fois bat l'étalement ≈ 68 % du temps à un an) est cité pour que l'étalement ne
    passe pas pour une martingale. `requiredAnnualRate` répond de même à « qu'est-ce que cet
    objectif suppose ? » et non à « vais-je l'atteindre » ; `monthlyToReach` ne raisonne qu'à
    rendement NUL, le seul cas où la réponse ne dépend d'aucune hypothèse de marché. Une chute est
    bornée à −100 % (un prix négatif n'existe pas) et l'horizon à 120 mois, au-delà desquels
    l'hypothèse de régularité perd son sens. **L'échelle de vente** évoquée par l'étude n'est pas
    reprise : le mode « Vendre », désormais doublé de l'aperçu fiscal (décision n° 43), répond déjà
    à la même question sans dupliquer une mécanique.

47. **Le catalogue des sources est déclaratif, et l'attribution est vérifiée par un test — pas par
    une relecture** (26/08/2026). L'app interroge **douze** sources, dont **trois** imposent
    contractuellement une mention : CoinGecko (« Powered by CoinGecko », police lisible d'au moins
    10 pt, affichage proéminent — API ToS § 4.3, en vigueur au 05/09/2025), Etherscan (lien retour
    ou « Powered by Etherscan.io APIs », l'exemption « usage strictement personnel » ne s'appliquant
    pas à un site public) et alternative.me (déjà traitée, décision n° 44). Écrire ces mentions à la
    main dans un composant les aurait périmées au premier fournisseur ajouté, et l'oubli d'une
    attribution est **silencieux** : il se découvre à la réclamation. `src/lib/support/sources.ts`
    porte donc la table, et `sources.test.ts` la croise avec les noms que le code produit
    réellement — `defaultPriceProviders`, `defaultHistoryProviders`, `frankfurterProvider`,
    `FLAVOR_LABELS`, `BTC_HOSTS`, `FEAR_GREED_ATTRIBUTION`. **Brancher une treizième source sans
    l'inscrire casse la CI**, et créditer quelqu'un qu'on n'interroge plus la casse aussi.
    Trois devoirs sont distingués et jamais confondus : `required` (condition d'utilisation, mention
    reproduite mot pour mot avec sa référence datée), `courtesy` (citation demandée sans être
    exigée — DefiLlama), `unverified` (conditions non lues ou muettes : la source est **créditée**
    mais l'app ne prétend pas connaître une obligation qu'elle n'a pas constatée — écrire `required`
    par prudence reviendrait à afficher une contrainte inventée). Conséquence de rendu :
    l'attribution ne peut pas utiliser `--fs-xs` (12 px), **sous le plancher de 10 pt = 13,33 px**
    imposé par CoinGecko ; elle est rendue en `--fs-sm` (14 px). Le même principe s'applique aux
    logos : `NO_ICON` motive chaque ticker sans logo, et `icons.test.ts` exige que chaque entrée de
    `TICKERS` soit tranchée dans un sens ou dans l'autre — un badge d'initiales cesse d'être
    l'indice ambigu d'un choix ou d'un oubli.
48. **Serveur MCP local en lecture seule, écrit sans aucune dépendance** (26/08/2026). Le serveur
    lit une SAUVEGARDE de l'app et rejoue le pipeline existant (assemblage du grand livre,
    appariement des virements, `computePortfolio`) : il n'existe pas de « calcul du MCP » qui
    pourrait diverger de l'écran. Quatre choix structurants. **(a) Lecture seule par
    construction** : aucun chemin d'écriture, aucun ordre, tous les outils annotés `readOnlyHint`
    et `destructiveHint: false` — un test échoue si un nom d'outil évoque une écriture. **(b) La
    provenance accompagne CHAQUE réponse** (date de la sauvegarde, date des cours, mention « aucune
    source en ligne ») : le risque propre à ce genre d'outil est qu'un chiffre juste hier soit
    présenté comme actuel, et c'est le seul garde-fou qui tienne — un test a d'ailleurs attrapé un
    outil dont la note propre écrasait celle de la provenance. **(c) Transport écrit à la main** :
    la surface utile du protocole tient en quatre méthodes (`initialize`, `ping`, `tools/list`,
    `tools/call`), et le projet paie assez cher sa vigilance sur la chaîne d'approvisionnement npm
    (décisions et parades de la feuille de route) pour ne pas ajouter un arbre de dépendances au
    profit d'un outil annexe — même arbitrage que l'anneau SVG plutôt qu'une bibliothèque de
    graphiques. La négociation de version répond la version demandée si elle est connue, sinon la
    nôtre, comme l'exige la spécification. **(d) Un build Vite malgré Node 24** : Node exécute
    désormais TypeScript nativement et `erasableSyntaxOnly` était déjà satisfait, mais `src/lib`
    importe sans extension de fichier, ce que le résolveur ESM refuse ; imposer des extensions à
    toute l'app pour le confort d'un outil annexe coûterait plus cher qu'un `npm run mcp:build` qui
    n'ajoute aucune dépendance. Le serveur se tait sur ce qu'il ne peut pas savoir : sans historique
    de prix, ni repère, ni mesure de risque, ni estimation fiscale — les règles concernées ne
    produisent rien plutôt qu'un chiffre partiel.
49. **Le spread implicite s'estime en médiane, sur un agrégat, ou pas du tout** (26/08/2026).
    Coinhouse n'affiche aucun spread et répond publiquement que son prix est « une moyenne entre le
    prix d'achat et de vente » : l'écart au cours de référence est donc un coût réel, absent de la
    grille comme du relevé. Le seul cours de référence dont l'app dispose sur tout l'historique est
    QUOTIDIEN, alors qu'une opération a lieu à un instant précis — la comparaison opération par
    opération est dominée par le mouvement de la journée, souvent plus grand que le spread cherché.
    D'où trois règles. **(a) Aucun chiffre par opération n'est affiché** : le module agrège, parce
    que le bruit intrajournalier est à peu près symétrique et s'annule en médiane, là où un écart
    systématiquement défavorable subsiste. **(b) La médiane, pas la moyenne** : un test montre
    qu'une seule journée aberrante suffit à emporter la moyenne au-delà de 10 % pendant que la
    médiane reste sur le 1 % réel. **(c) Des seuils d'échantillon** : 20 opérations pour que
    l'estimation globale se déclare fiable, 5 par actif pour figurer dans la ventilation — sans
    quoi « l'actif le plus coûteux » se calcule sur une opération, ce que l'affichage a
    effectivement produit avant correction. Deux garde-fous d'affichage, découverts en regardant
    l'écran : un spread NÉGATIF (plateforme plus favorable que la référence) **ne se retranche
    jamais des commissions**, qui ont bien été payées, et un actif ne se dit « le plus coûteux »
    que s'il coûte. Les opérations cotées dans une autre devise que l'euro sont écartées et
    comptées : les convertir ajouterait le bruit du change à celui de la journée, pour une mesure
    qui vise justement quelques dixièmes de pour cent. Un cours REPORTÉ (jour sans cotation) est
    écarté lui aussi.
50. **Le 2086 est une AIDE AU REPORT, exportée en CSV, et la réconciliation DAC8 sert à comparer,
    pas à déclarer** (26/08/2026). Le moteur fiscal (décision n° 43) produit déjà, par cession,
    exactement les colonnes du formulaire : date, prix de cession, valeur globale du portefeuille,
    prix total d'acquisition, fraction imputée, plus-value. Le rapport les exporte donc en CSV
    plutôt que de les imprimer dans le PDF — une liste de cessions se travaille dans un tableur, pas
    sur une page. **Une colonne « Estimation complète » dit, LIGNE PAR LIGNE, ce qui n'a pas pu être
    chiffré** (valeur du portefeuille inconnue ce jour-là) : un fichier destiné à être recopié dans
    une déclaration ne doit jamais laisser croire qu'une case vide vaut zéro. Le récapitulatif DAC8
    (`dac8Summary`) agrège l'année par actif — cessions brutes, unités, acquisitions — dans la forme
    que les plateformes feront remonter à partir des opérations 2026 : il sert à VÉRIFIER ce que
    Coinhouse déclarera, jamais à déclarer soi-même. Les échanges en sursis n'y figurent pas, ce
    qui est justement le point à contrôler. L'ensemble reste sous le même avertissement que la
    décision n° 43 : estimation, ni déclaration ni conseil fiscal.

51. **La valeur nette est `Σ contributions − Σ passifs` dès l'origine, et l'équité de trading y
    entre RÉÉCHANTILLONNÉE au jour** (26/08/2026). Deux décisions en une, prises ensemble parce
    qu'elles se répondent.

    **La forme.** La courbe est définie comme une somme de **contributions** génériques moins une
    somme de **passifs**, où un actif crypto valorisé par son cours n'est qu'un cas particulier. Le
    terme de passif est aujourd'hui constant à zéro. C'est délibérément une dépense d'avance :
    P36 (immobilier, assurance-vie, PER, objets), P41 (actions et ETF) et P37 (crédits) s'y
    branchent en ajoutant un producteur ou en remplissant le terme de passif, sans réécrire la
    courbe. Écrite « Σ avoirs crypto », elle aurait exigé une refonte à chacune des trois.

    **Le rééchantillonnage.** La feuille de route reportait cette brique au motif d'un « historique
    de l'équité de trading inexistant » : il existe, il est récupéré à chaque synchronisation
    (`sync.ts`, point d'entrée `portfolio`), persisté, et déjà tracé sur l'écran Trading. Le vrai
    obstacle est que les deux séries sont de **natures incompatibles** — l'une calculée du grand
    livre au pas quotidien, l'autre servie par la plateforme à des horodatages irréguliers,
    sous-échantillonnée (une quarantaine de points pour six mois), commençant à l'ouverture du
    compte, et **impossible à consolider entre deux comptes** faute d'instants alignés. Les
    additionner point à point serait faux. L'équité est donc ramenée au pas quotidien par report du
    dernier point connu, comme `valueSeries` reporte le dernier cours connu.

    **Conséquence assumée : la courbe consolidée ne se superpose pas à celle de l'écran Trading**,
    qui reste volontairement non amincie parce qu'un point par jour écraserait les épisodes
    violents. Deux objets, deux questions. Le dernier point, lui, reprend l'instantané (`live`),
    sans quoi il divergerait du total du bandeau — deux montants plausibles au même écran.

    **Trois états d'un point, jamais confondus** : normal ; `estimated`, porté au coût faute de
    cotation — approché mais comparable, donc **compté** ; `unavailable`, non valorisable — le total
    est alors **incomplet, donc trop bas**, et cela se signale au lieu de se fondre dans la courbe.
    Confondre les deux derniers reviendrait à présenter un chiffre faux comme un chiffre approché.

52. **Les alertes de sécurité de `@lhci/cli` ne se corrigent pas : elles se documentent** (27/08/2026).
    Les quatre alertes ouvertes viennent d'un **seul** paquet, `@lhci/cli@0.15.1`, qui est la
    dernière version publiée (`latest` et `next`) : aucune montée de version ne les corrige, et
    `extract-zip` n'a **aucun correctif publié** (`first_patched_version: null` dans l'avis GitHub).
    `npm audit --omit=dev` rend **zéro** : rien de tout cela n'atteint le bundle servi aux
    utilisateurs. Trois des quatre sont par ailleurs **inatteignables**, constaté en lisant le code
    et non supposé : `tmp` n'est appelé que par `lhci open` — commande jamais lancée, `package.json`
    et `ci.yml` n'invoquant que `autorun` — et avec un `postfix` littéral ; `uuid.v4()` est appelé
    **sans `buf`**, or l'avis ne mord que « when buf is provided » ; `extract-zip` n'est atteint que
    depuis le **téléchargement** d'un navigateur par `@puppeteer/browsers`, or seul `puppeteer-core`
    est installé et il n'en télécharge jamais.
    **Ce qu'on ne fait pas.** Pas d'`overrides` npm : `uuid` 8 → 11 et `tmp` 0.0.33 → 0.2.6
    traversent des ruptures d'API que `@lhci/cli` n'a jamais testées, et `extract-zip` n'a aucune
    cible vers laquelle pointer — on casserait Lighthouse CI pour corriger du code qui ne s'exécute
    pas. Pas de bascule vers l'action `lighthouse-ci-action` non plus : elle embarque la même chaîne,
    simplement hors du `package-lock.json`. L'alerte disparaîtrait, le code resterait — moins de
    visibilité pour le même risque. **Le déclencheur** : prendre la prochaine `@lhci/cli` au-dessus
    de 0.15.1 dès sa publication.

53. **La carte de partage ne peut pas émettre de montant par défaut, et une propriété le prouve**
    (27/08/2026). Une carte destinée à un salon public ne doit rien dire de la taille du
    portefeuille : elle porte des pourcentages, le nombre de lignes et les trois premières
    positions **en part relative**. Les montants n'existent que si l'utilisateur les demande, et
    **cette bascule n'est pas mémorisée** — un réglage qui se souvient finit par publier ce qu'on ne
    voulait publier qu'une fois. La garantie n'est pas confiée à une relecture : `share-card.test.ts`
    tire des montants au hasard et vérifie qu'activer les montants **n'ajoute que les lignes de
    montants**, titre, sous-titre, pied et résumé restant rigoureusement identiques. Aucune grandeur
    affichée par défaut n'est donc dérivée d'un montant.
    **Canvas plutôt que SVG converti** : `foreignObject` teinte le canvas sur plusieurs moteurs et
    les polices ne survivent pas à la sérialisation — les deux échouent **sans erreur**. La
    géométrie est une fonction pure, testée séparément du dessin, ce qui permet de prouver sans
    navigateur qu'aucun texte ne sort du cadre ni ne chevauche un autre, y compris sur les libellés
    longs. **Le débordement d'une carte générée ne se voit qu'une fois l'image postée.**
    **L'aperçu est servi en `data:` et non en `blob:`** : la CSP du site publié dit
    `img-src 'self' data:`, si bien qu'un `blob:` produit une image vide **sans la moindre erreur**.
    Le piège est double, car cette CSP n'est injectée qu'au build : en développement l'aperçu
    s'affiche parfaitement. Constaté en exécutant le build, pas en le supposant. Le `Blob` reste
    utilisé pour le partage natif, le presse-papiers et le téléchargement, qui ne passent pas par
    `img-src`.
    **Le résumé texte est l'équivalent accessible de l'image, pas une commodité** : il porte les
    mêmes nombres dans le même ordre, et sert d'`alt` — un `alt` qui dirait « image de partage » ne
    servirait à personne.

54. **Couverture large des actifs : un symbole ambigu ne reçoit AUCUN identifiant, et les logos
    sortent du précache** (27/08/2026). Chacun détient des cryptos différentes, et une table de 70
    entrées écrite à la main ne suivra jamais le marché. Deux contraintes de nature opposée
    commandent les deux moitiés de la réponse.

    **Côté prix, le risque est la justesse.** Un même symbole peut désigner deux projets, et un
    mauvais identifiant ne donne pas « pas de prix » : il donne un **prix faux**, donc un PRU faux,
    sans que rien à l'écran ne le signale. Mesuré sur le top 500 CoinGecko le 27/08/2026 : 493
    symboles distincts, **7 collisions (1,4 %)**. La règle intuitive « le mieux classé gagne » est
    fausse — pour `safe`, elle donnerait _safecoin_ (#260) alors que le jeton que tout le monde
    appelle SAFE est _safe_ (#336). **Un symbole en conflit n'est donc pas cartographié du tout** :
    l'actif reste sans cotation automatique, et l'utilisateur tranche. Sept exceptions sur cinq
    cents, c'est dérisoire face au risque supprimé. `tickers.generated.ts` est écrit par
    `scripts/generate-tickers.mjs` et porte sa date : une table de marché vieillit, et sans date
    personne ne sait de quand elle parle. La table **curée** reste prioritaire — elle porte des
    décisions humaines (`eurcv` ancré à l'euro, `wif` → `dogwifcoin`) qu'une régénération
    effacerait en silence ; un test le vérifie. Coût mesuré : **+8,25 Ko comprimés** pour 409
    actifs de plus.

    **Côté logos, le risque est le poids.** Le service worker précachait **tous** les SVG : à 1 362
    octets pièce, quelques centaines de logos imposeraient des mégaoctets à **chaque installation**,
    pour des actifs que personne ne détient tous. Les icônes sortent donc de `globPatterns` et
    passent en **cache d'exécution** : chacun télécharge les logos de ses propres actifs, une fois.
    Vérifié en navigateur sur le build : précache 24 entrées et **0 icône**, cache `crypto-icons`
    exactement 11 icônes pour 11 actifs détenus. Contrepartie assumée : hors ligne, un actif jamais
    affiché montre ses initiales — ce que `CoinBadge` fait déjà. Rien ne change côté vie privée :
    même origine, même CSP, aucun tiers.

    **La troisième brique rend les deux premières honnêtes.** `AssetSettings.coingeckoId` existait
    dans le modèle et était câblé jusqu'aux fournisseurs, mais **aucun écran ne permettait de le
    saisir** — une plomberie sans robinet. La fiche actif reçoit le champ. C'est parce que
    l'utilisateur a le dernier mot que la couverture automatique peut se permettre de **refuser** un
    cas douteux plutôt que de deviner.

    **Le paquet source n'est pas une dépendance.** `@web3icons/core` (MIT) pèse 49 Mo et ne sert
    qu'à la génération ; l'installer durablement le ferait réinstaller à chaque exécution de CI pour
    rien. Il est installé le temps du script, puis retiré — la convention que `public/icons/LICENSE.md`
    énonçait déjà.

55. **Les apports nets sont des flux externes, jamais l'assiette de coût des positions**
    (27/08/2026). La courbe de patrimoine livrée avec P38 traçait en référence le **coût des
    positions détenues** et l'appelait « apports nets », le trading n'y contribuant rien. Les deux
    grandeurs se ressemblent tant qu'on n'a rien vendu, puis divergent définitivement : une vente à
    perte fait **baisser** l'assiette de coût, si bien que la moins-value réalisée disparaît du
    tableau. L'écart entre les deux courbes ne valait donc pas le gain annoncé mais
    `latent d'investissement + équité de trading entière` — un résultat additionné à un solde,
    exactement ce que la décision n° 28 interdit. Mesuré sur le jeu de démonstration :
    `21 339,47 − 18 137,39 = 3 202,08`, à comparer à `−1 969,63 + 5 171,70 = 3 202,07`.
    **La définition retenue** : pour chaque producteur de valeur, ses apports sont ses flux
    **entrants et sortants du périmètre**, cumulés jour par jour (`cumulativeContributions`). Côté
    Investissement, ce sont les flux qui servent déjà à la performance hors apports (Dietz modifié)
    — aucune seconde source. Côté Trading, c'est **`netFlows`, tous mouvements de trésorerie
    confondus** et non les seuls dépôts et retraits : la contribution suit l'équité du compte perps,
    dont un virement vers le spot sort tout autant qu'un retrait vers l'extérieur. Ne compter que
    les dépôts et retraits transformait un virement perps → spot en une perte de plusieurs centaines
    d'euros. Un virement entre les deux espaces s'annule de lui-même : il sort d'un côté et entre de
    l'autre.
    **Le paramètre `contributedAt` de `valueSeriesContribution` n'a pas de valeur par défaut** :
    c'est le seul moyen d'empêcher qu'on y reglisse `point.cost` par commodité.
    **Deux auto-vérifications tiennent la définition**, parce qu'une propriété qu'aucun test ne
    contrôle finit toujours par se perdre : « le détail par espace refait le total » (exact, donc un
    écart signale une régression, pas une donnée bancale) et « le résultat déduit des apports égale
    _réalisé + latent_ calculé lot par lot » — deux chemins de calcul entièrement distincts qui
    doivent tomber sur le même nombre. Sur la démonstration, l'Investissement donne `−2 860,60 €`
    des deux côtés, et le Trading `+115,57 €` conformément à son propre écran.

56. **Le tableau de bord : un chiffre, une variance, une réconciliation — et la couleur réservée
    aux variances** (27/08/2026). La Vue d'ensemble empilait huit cartes de poids visuel identique,
    répétait la valeur d'investissement à trois endroits et l'équité de trading à deux, et ne
    montrait que des **niveaux** : aucune variation, donc aucune réponse à « qu'est-ce qui a
    changé ? ». Trois règles la gouvernent désormais, tirées de l'ISO 24896:2026 (_Notation for
    business reporting_, publiée cette année et reprenant la formule SUCCESS de l'IBCS) :
    **un seul chiffre domine** et **une seule période gouverne l'écran** — celle du bandeau pilote
    la variation, la courbe et la répartition, car deux fenêtres de temps sur un même écran sont
    deux réponses à la même question ; **aucun chiffre n'est écrit deux fois**, chaque répétition
    étant une occasion de diverger sans rien ajouter ; **la couleur ne sert qu'aux variances**
    (composant `Delta`, unique) et jamais aux niveaux — un écran où tout est coloré ne hiérarchise
    plus rien.
    **La carte « D'où vient ce chiffre »** pose `apports nets + résultat = patrimoine` et se déplie
    espace par espace. Elle existe parce que les chiffres du portefeuille se contredisent en
    apparence — un patrimoine supérieur aux apports, un ROI négatif, un P&L négatif — et qu'un
    tableau de bord d'aide à la décision doit les **réconcilier**, pas les juxtaposer.
    **Ses trois lignes s'additionnent à l'écran** : `displayGap` soustrait les montants _arrondis_,
    sinon `21 362,675 − 24 621,894` s'affiche `−3 259,22` sous deux montants qui donnent
    `−3 259,21`. Un centime, invisible dans le calcul, mais parfaitement visible dans une colonne —
    et il détruit la seule chose que cette carte doit produire. L'exactitude reste au moteur ; ce
    qui est arrondi ici ne sert qu'à être lu.
    **Le détail par espace est replié par défaut** : il répond à une question qu'on ne se pose pas
    à chaque visite.
    **« Patrimoine » remplace « Valeur nette »** dans l'interface : le même écran affichait
    « Valeur nette » et « Valeur » à quelques centimètres l'une de l'autre.
    **Les contrôles automatiques étaient montés deux fois** — une fois dans les réglages, une fois
    ici — avec des entrées qui avaient déjà divergé. `state/checks.svelte.ts` les monte une seule
    fois : deux listes de contrôles qui ne contrôlent pas la même chose, c'est un contrôle de moins,
    et le seul écran où le voyant manquant se serait vu est justement celui qui ne le calculait pas.

57. **Toute origine externe est déclarée dans une table, et un test la croise avec la CSP**
    (28/08/2026). L'indice Fear & Greed (décision n° 44) était **inopérant sur le site publié
    depuis sa livraison** : `api.alternative.me` ne figurait pas dans le `connect-src`, écrit à la
    main dans `vite.config.ts`. La panne était invisible par construction — la CSP n'est injectée
    **qu'au build** (GitHub Pages ne permet pas d'en-tête HTTP), donc le développement marchait ;
    `loadFearGreed` avale toute erreur et rend `null`, par une décision volontaire qui rendait le
    contexte facultatif ; et `gateSatisfied` refuse de déclencher une alerte dont il ne peut pas
    vérifier la moitié des termes. Résultat : **toute alerte conditionnée au sentiment de marché
    restait silencieuse**, sans message, sans journal, sans voyant rouge.
    Aucun garde-fou existant ne pouvait le voir : les tests unitaires tournent dans Node,
    `scripts/api-contract.mjs` aussi — et il _surveillait_ pourtant cette API, en la déclarant
    verte pendant que le navigateur la bloquait. Une surveillance qui n'exerce pas la contrainte
    réelle ne surveille rien.
    Désormais `src/lib/support/csp.ts` porte **la liste des origines et la politique qui en
    découle**, et `csp.test.ts` la croise avec les origines littérales du code livré (`src/**` hors
    tests, plus les scripts du service worker) : **contacter une origine sans l'inscrire casse la
    CI**, et une entrée que le code n'écrit plus la casse aussi. Trois usages, distingués parce
    qu'ils ne donnent pas les mêmes droits : `connect` (l'app contacte), `link` (l'origine n'est
    que citée — l'autoriser élargirait la surface sans rien permettre) et `reserved` (autorisée
    sans appel, avec sa justification écrite ; seul `api.frankfurter.app` en relève, pour qu'une
    redirection depuis `.dev` ne rejoue pas la même panne muette).
    Même principe que la table des sources (décision n° 47), pour la même raison : **quand
    l'oubli est silencieux, il faut le rendre bruyant à l'endroit où il se commet**, pas espérer
    le détecter en aval. Limite assumée : le croisement lit des littéraux, donc une origine
    assemblée dynamiquement lui échappe — d'où la règle de n'écrire que des URL littérales.

58. **Le calendrier macro est compilé dans l'application, pas récupéré au vol — et le BLS est
    recopié à la main parce qu'il refuse les robots** (28/08/2026). Le calendrier des publications
    américaines (Fed, BLS, BEA) est un **fichier TypeScript engendré et committé**
    (`src/lib/calendar/events.generated.ts`), importé comme `tickers.generated.ts` l'est déjà.
    Conséquences : **aucune requête à l'exécution**, donc aucune origine à autoriser dans la CSP,
    aucun opt-in réseau, aucun tiers qui apprenne quels événements vous consultez, et un écran qui
    fonctionne **hors ligne par construction** plutôt que par précache. La fraîcheur J+1 est sans
    effet sur des dates annoncées douze à dix-huit mois à l'avance.
    **Les conditions d'accès ont choisi les sources.** Le réseau de diffusion de `www.bls.gov`
    répond 403 à tout client non-navigateur — y compris sur le flux `bls.ics` que le BLS publie
    pourtant _pour_ les agendas, et depuis deux réseaux distincts. Se faire passer pour un
    navigateur contournerait un contrôle d'accès délibéré : CPI, emploi, PPI et JOLTS sont donc
    **recopiés à la main** dans `bls-schedule.ts`, une fois par an, depuis un vrai navigateur. Ce
    n'est pas une dette, c'est le prix affiché d'une source qui ne veut pas être automatisée. La
    Fed et le BEA, eux, sont relus chaque semaine.
    **Trois garde-fous** rendent l'arrangement tenable. Le générateur **refuse d'écrire** un
    calendrier appauvri — source muette, effondrement du nombre d'événements, ou couverture BLS
    à moins de trois mois devant nous : _un calendrier vide est pire qu'un calendrier périmé, il
    affirme qu'il ne se passera rien_. Le cron hebdomadaire lance `npm run check` **avant** de
    committer, car un push du robot ne déclenche aucun workflow et rien ne validerait le résultat
    après coup ; il appelle ensuite `ci.yml` explicitement, seule à porter le déploiement. Et sa
    sortie est **déterministe** : tri et identifiants stables, fichier non réécrit quand seul
    l'horodatage change — un diff hebdomadaire bruyant ne serait jamais relu.
    **Un événement macro est un instant, pas une date naïve.** La règle « jamais de conversion de
    fuseau » vise les dates Coinhouse, dépourvues de fuseau, dont toute conversion inventerait de
    l'information. « 8 h 30 à New York » est l'inverse : un instant réel, dont la position en UTC
    dépend de l'heure d'été américaine. La conversion se fait **une fois, à la génération**, par le
    fuseau IANA plutôt que par une règle écrite à la main — la règle américaine a déjà changé en
    2007 et sa suppression revient régulièrement au Congrès. Elle est vérifiée par un **oracle
    indépendant** : le BEA publie ses dates déjà en UTC quand le BLS et la Fed les publient en
    heure locale, ce qui fournit des couples (heure de New York, instant UTC) certifiés par une
    agence fédérale, couvrant les deux régimes d'heure.
    **Deux choix de présentation sont annoncés comme tels.** Le rang « majeure » est **éditorial**
    — aucune volatilité n'a été mesurée pour l'établir — et l'écran le dit. Et le calendrier ne se
    déclare complet que jusqu'au **plus court** des horizons de ses sources : afficher la dernière
    réunion connue de la Fed, fin 2027, laisserait croire qu'il connaît les CPI de 2027, qui ne
    sont pas publiés.
    Restent dehors, faute de source propre : les _minutes_ du FOMC (la Fed n'en annonce la date
    qu'après la réunion ; la déduire de sa règle serait une prévision présentée comme un fait), le
    consensus de marché (propriétaire partout), et les valeurs de l'ISM, du Conference Board et de
    l'Université du Michigan — dont la **date** est un fait libre mais la **valeur** sous copyright.

59. **La licence d'une source choisit son mode de transport — et un chiffre ne s'affiche jamais
    sans son rang** (29/08/2026). Les indicateurs macroéconomiques suivent le motif du calendrier
    (décision n° 58) : un module TypeScript engendré, committé, compilé dans le bundle, donc aucune
    requête à l'exécution. Mais l'étude des conditions d'utilisation a produit une règle plus
    générale, qui gouvernera aussi les flux.
    **Trois modes, et c'est la licence qui tranche, pas la commodité technique.** Une source qui
    autorise explicitement le stockage et la redistribution va dans l'instantané committé — c'est
    le cas du Trésor américain, de la Réserve fédérale (« information on the Board's website is in
    the public domain and may be copied and distributed without permission. Please cite to the
    Board as the source ») et de l'EIA. Une source qui n'autorise que l'usage personnel doit être
    appelée **depuis le navigateur, jamais stockée** : DefiLlama interdit de « republish the data
    in any form without permission » mais concède l'accès personnel non commercial. Une source qui
    n'autorise ni l'un ni l'autre est **abandonnée**.
    **Le VIX est abandonné.** Cboe interdit de « store either in hard copy or in an electronic
    retrieval system » sans accord écrit ; committer un instantané tombe exactement sous cette
    clause. Et `cdn.cboe.com` n'envoie aucun en-tête CORS, ce qui ferme aussi l'appel direct. Il
    n'existe aucune source libre : c'est un indice propriétaire. Le remplacement prévu est la
    volatilité réalisée du bitcoin, calculée localement depuis l'historique que l'app détient déjà
    — aucune licence en jeu, et plus pertinent pour un portefeuille crypto que la volatilité
    implicite des actions américaines.
    **Un chiffre ne s'affiche jamais sans son rang, et jamais le rang d'un niveau qui dérive.** Un
    percentile du niveau de la masse monétaire ou du bilan de la Fed vaudrait 99 % en permanence :
    ces séries montent, c'est tout ce qu'elles disent. Les séries non stationnaires sont donc
    converties — variation sur trois mois, variation annuelle — **avant** d'être classées, et
    l'écran annonce la transformation. Le rang est un **percentile**, jamais un z-score : celui-ci
    suppose une loi normale que les queues épaisses des marchés démentent, et l'échelle 0-100 se
    lit sans explication. **Deux fenêtres sont affichées**, jamais une : un percentile n'existe que
    relativement à la sienne, et les deux se contredisent parfois — la pente de la courbe est au
    11ᵉ percentile sur un an mais au 50ᵉ sur dix ans, et c'est précisément l'information.
    **Une seule source pour la liquidité, et un chiffre officiel plutôt qu'un bricolage.** Le
    relevé H.4.1 contient les quatre composantes à la même fréquence hebdomadaire : plus besoin
    d'interroger la Fed de New York et Fiscal Data séparément — deux sources automatiques au lieu
    de quatre, et surtout plus de mélange de fréquences, qui est le piège d'alignement classique.
    Ce sont les **réserves bancaires** qui sont affichées, publiées par la Fed, et non le
    `bilan − compte du Trésor − reverse repo` que reconstituent beaucoup d'observateurs : même
    idée, mais un nombre officiel. La réserve d'usage est écrite à côté du chiffre.
    **Les colonnes de la Fed sont choisies par identifiant, jamais par libellé.** Le fichier compte
    cent cinquante-sept colonnes dont les descriptions contiennent des virgules et peuvent être
    réécrites ; la ligne d'en-tête porte des identifiants courts et stables (`RESH4R_N.WW`), et un
    identifiant absent fait échouer la génération.
    **Le catalogue d'attributions couvre désormais les sources de build.** L'app ne les contacte
    pas — les générateurs le font en CI — mais leurs données sont affichées, donc elles doivent
    être créditées. Le croisement de `sources.test.ts` lit maintenant les instantanés engendrés
    eux-mêmes : ajouter une source à un générateur fait échouer la CI tant qu'elle n'est pas
    inscrite au catalogue.

60. **Une corrélation se lit sur quatre fenêtres ou pas du tout, et la superposition passe par le
    rendement pondéré temps** (29/08/2026). La brique P50 confronte le contexte macro aux chiffres
    de l'utilisateur. Elle est faite de refus, chacun visant une erreur documentée.
    **La série de référence est l'indice de rendement du portefeuille, pas le cours du bitcoin.**
    C'est la question qui intéresse — « est-ce que _mon_ portefeuille bouge avec les taux ? » —, et
    c'est aussi la seule série exploitable : l'indice produit par `twrEur` neutralise les apports et
    les retraits par construction. Comparer une **valeur brute**, qui monte parce qu'on y verse de
    l'argent, à une série sans apports fabrique une surperformance qui n'existe pas ; c'est un
    défaut réel, mesuré chez d'autres outils à trente-quatre points de surperformance injustifiée
    sur dix-huit mois.
    **Jamais sur les niveaux.** Corréler deux séries qui ont chacune une tendance rend un
    coefficient proche de 1 sans qu'aucun lien n'existe — la régression fallacieuse de Granger et
    Newbold (1974). On corrèle donc des **variations** : rendements logarithmiques d'un côté,
    différences premières de l'autre.
    **L'alignement précède la différenciation.** Les deux séries sont d'abord superposées sur leurs
    seuls jours communs — la crypto cote sept jours sur sept, les taux cinq — _puis_ différenciées.
    L'ordre inverse comparerait un rendement de trois jours à une variation d'un jour. Reporter la
    dernière valeur du taux le week-end aurait été pire encore : cela fabrique des variations nulles
    qui diluent mécaniquement la covariance. Le nombre de jours écartés est affiché.
    **Spearman, pas Pearson.** Pearson reste sensible aux valeurs extrêmes même sur plusieurs
    centaines de points, et les rendements crypto en sont pleins. Un test le montre : sur sept
    points sans lien plus un krach commun, Pearson dépasse 0,9 quand Spearman reste sous 0,6.
    **Quatre fenêtres, jamais une, et l'écart entre elles est l'information principale.** La
    corrélation glissante entre le bitcoin et à peu près n'importe quoi change de signe selon la
    fenêtre. Les quatre sont fixées dans le code, avant tout résultat — en choisir une après coup
    serait du p-hacking. L'écart entre la plus faible et la plus forte est rendu explicitement, et
    l'écran le traduit : « les quatre fenêtres concordent », ou « elles se contredisent — aucun
    chiffre unique ne décrit cette relation ».
    **Un seul axe pour la superposition.** Deux ordonnées indépendantes permettent d'étirer l'une
    ou l'autre jusqu'à faire coïncider n'importe quelles courbes : la corrélation apparente devient
    un choix de graphiste. Les deux séries sont donc ramenées à une base commune de 100 **au premier
    jour qu'elles ont en commun** — jamais à une date choisie après coup — et partagent la même
    échelle. Les deux traits se distinguent par le style, plein et pointillé, jamais par la seule
    couleur.
    **Rien n'est calculé sans qu'on le demande.** L'écran promet de ne rien demander au réseau ; le
    calcul des corrélations exige l'historique de prix, qui n'est donc **pas** chargé d'office
    depuis cet écran. Un bouton le propose, et la superposition est derrière une case à cocher.
    **Ce qui est écarté** : les séries hebdomadaires — les réserves de la Fed — n'ont pas assez de
    points pour une fenêtre de trente jours ; elles sont nommées comme non mesurées plutôt que
    mesurées sur quatre observations. Une fenêtre sous douze couples est omise, pas assortie d'une
    réserve : un coefficient sur huit points est du bruit présenté comme une mesure.
