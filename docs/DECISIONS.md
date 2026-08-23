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
