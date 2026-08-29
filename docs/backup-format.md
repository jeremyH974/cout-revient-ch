# Format de sauvegarde — anti-verrouillage (P72)

Documente l'enveloppe de sauvegarde JSON et chaque conteneur de `StoredStateV1`
(`src/lib/storage/schema.ts`), la politique de version, et ce qui survit — ou non — de l'export
portable Koinly/Waltio. S'appuie sur des décisions déjà prises : n° 21 (sauvegarde robuste,
IndexedDB, chiffrement optionnel), n° 24 (import « format pivot » Koinly/Waltio) et n° 26
(convertisseurs natifs). **Aucune entrée dédiée dans `docs/DECISIONS.md`** : l'arbitrage qui
l'explique est au § « Pourquoi pas de schéma publié » plus bas.

## Ce que ça garantit

**Une sauvegarde JSON écrite par une version ancienne de l'application se relit toujours par une
version plus récente. L'inverse n'est pas garanti** : un fichier écrit par une version future peut
porter un `schemaVersion` que la version installée ne reconnaît pas encore — `migrateState` refuse
alors la lecture avec un message explicite plutôt que de deviner (`src/lib/storage/migrations.ts`).

Deux fichiers portent le mot « export » à l'écran, volontairement séparés (Réglages → Données) :

| Fichier                                                | Contenu                                                                  | Pour                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| **Sauvegarde JSON**                                    | Tout l'état de l'application (`StoredStateV1`, ce document)              | Revenir exactement où vous en étiez, dans **cette** app |
| **Export portable** (Koinly / Waltio, `koinly-csv.ts`) | Achats, ventes, récompenses, frais — reconstruits en euros par le moteur | Continuer ailleurs, ou changer d'outil sans tout perdre |

Ce document couvre le premier en détail (l'enveloppe et chaque conteneur) et s'appuie sur
`docs/pivot-import.md` (qui documente déjà le format en détail) pour le second.

## L'enveloppe

Un fichier de sauvegarde est un objet JSON à quatre champs (`BackupFile`,
`src/lib/storage/json-io.ts`) :

| Champ           | Sens                                                                                                                  | Type / unité             |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `app`           | Identifiant de l'application (`'cout-revient-ch'`) : refuse un fichier d'une autre app avant même de regarder `state` | chaîne constante         |
| `schemaVersion` | Version du **format**, voir § Politique de version                                                                    | entier (`1` aujourd'hui) |
| `exportedAt`    | Instant d'export, affiché lors de la restauration                                                                     | ISO 8601                 |
| `state`         | L'état complet, voir § Les conteneurs                                                                                 | `StoredStateV1`          |

Piège documenté ici plutôt que découvert en lisant le code : `state` porte lui-même un champ
`schemaVersion` (identique à celui de l'enveloppe — `isStoredStateV1` le revérifie), et `state.ui`
porte un troisième champ qui **ressemble** à une version mais n'en est pas une : `lastSeenVersion`
est le numéro sémantique de l'application (`2.12.0`, `package.json`) dont l'utilisateur a vu les
nouveautés — il n'a **aucun rapport** avec `schemaVersion` et ne conditionne aucune migration.

Un fichier édité à la main (ou une sauvegarde ancienne à qui il manque des clés) est repassé par
`sanitizeState()` avant tout usage : une entrée invalide est écartée (comptée dans `dropped`)
plutôt que de faire planter la restauration, mais aucun champ ne change silencieusement de FORME.

## Politique de version

Une seule règle, écrite noir sur blanc pour la première fois par ce chantier — jusqu'ici tacite,
puisque `SCHEMA_VERSION` n'a jamais bougé depuis la version 1 malgré des évolutions réelles
(comptes, journal de trading, alertes, `Account.country`…), toutes passées par des champs
optionnels assainis :

- **Additif → pas de bump.** Un nouveau champ optionnel, une valeur ajoutée à une énumération, un
  nouveau conteneur qui démarre vide par défaut (`emptyState()`) : la version ne change pas. Une
  sauvegarde ancienne n'a simplement pas ce champ — `withDefaults` puis `sanitizeState` le
  complètent silencieusement (un champ absent ne fait jamais échouer la restauration).
- **Cassant → bump.** Renommer un champ, changer son unité (`number` → chaîne décimale, jamais
  l'inverse), changer son sens, ou supprimer un conteneur : `SCHEMA_VERSION` augmente, une branche
  s'ajoute dans `migrateState()` pour transformer l'ancienne forme en nouvelle, et la fixture gelée
  de l'ancienne version (ci-dessous) continue de se relire — sous sa forme MIGRÉE, jamais réécrite
  en place.

**Garantie explicite, celle que ce chantier verrouille par un test : une sauvegarde ancienne se
relit toujours plus tard ; l'inverse n'est pas garanti.**

### La fixture gelée v1

`tests/fixtures/storage/backup-v1.json` est un fichier de sauvegarde v1, **100 % synthétique**
(décision n° 17), **gelé pour toujours** : `src/lib/storage/storage.test.ts` vérifie qu'il se relit
aujourd'hui exactement comme attendu. Ce fichier ne doit **plus jamais changer** — c'est la version
1 telle qu'un vrai utilisateur pourrait encore l'avoir sur son disque. Le jour où une évolution
cassante fait grimper `SCHEMA_VERSION`, une SECONDE fixture (`backup-v2.json`, elle aussi gelée) le
rejoint ; la première continue d'être vérifiée, migrée, jamais retouchée.

## Pourquoi pas de schéma publié

Pas de JSON Schema en regard de ce document : aucun consommateur externe connu ne lit
`StoredStateV1` directement (l'interopérabilité passe par l'export portable, volontairement plus
pauvre et documenté à part), et un schéma écrit à la main **dériverait immanquablement** de
`sanitizeState()` (`src/lib/storage/schema.ts`), qui reste la seule vraie source de vérité — c'est
elle qui décide, champ par champ, ce qu'une sauvegarde a le droit de contenir. Publier un schéma
séparé, c'est publier une deuxième réponse à la même question, condamnée à diverger un jour de la
première sans qu'aucun test ne le remarque. La documentation en prose ci-dessous fait foi ; en cas
de doute, `sanitizeState()` tranche.

## Les conteneurs de `StoredStateV1`

Toutes les quantités et tous les montants sont des **chaînes décimales** (`DecimalString`, jamais
un `number` — l'arrondi n'existe qu'à l'affichage, `src/lib/format/`) ; toutes les dates
d'opération sont des `NaiveDateTime` (`AAAA-MM-JJTHH:mm:ss`, heure de Paris, **jamais** convertie
ni interprétée avec `new Date()` sur la chaîne) ; les autres horodatages (import, création, dernière
synchro…) sont de l'ISO 8601 classique, précisé champ par champ ci-dessous.

### `imports` — journal des imports

`ImportBatchMeta[]` : trace de chaque fichier importé, à but **diagnostic seulement** (jamais
relue pour reconstruire quoi que ce soit). `id`, `at` (ISO 8601), `fileName` (tronqué à 200
caractères), `rows` / `newRows` (entiers), `format?` (identifiant du format détecté), `header?` /
`unknownColumns?` (colonnes du fichier, tronquées), `accountId?` (compte de destination, absent
pour l'export Coinhouse historique).

### `rawRows` — lignes Coinhouse brutes

`Record<RowKey, RawCoinhouseRow>` : chaque ligne de l'export Coinhouse, **conservée verbatim**
(source de vérité, décision n° 3). Détail des champs et de la « règle d'or » de la contre-valeur :
`docs/coinhouse-export.md`. `qty`, `marketPrice`, `valueEur`, `feeAsset`, `feeEur`, `feeRebate`,
`balance` sont des `DecimalString | null` ; `at` un `NaiveDateTime`.

### `pivotRows` — lignes pivot brutes

`Record<RowKey, RawPivotRow>` : lignes Koinly/Waltio, convertisseurs natifs et Ghostfolio, une fois
traduites vers la même forme (`docs/pivot-import.md`, décisions n° 24 et n° 26). `sent` /
`received` / `fee` / `netWorth` sont des `PivotAmount | null`
(`{ amount: DecimalString; currency: AssetCode }`) ; `accountId` porte le compte (contrairement à
`rawRows`, implicitement `ch:main`) ; `date` est la chaîne UTC verbatim du fichier, `at` sa
conversion en heure de Paris.

### `manualEvents` — saisies manuelles

`Record<string, ManualEvent>` : opérations tapées à la main (achat, vente, récompense, dépôt,
retrait, solde d'ouverture). `qty` (`DecimalString`, toujours positif), `amountEur`
(`DecimalString | null`, sens selon `kind` : coût pour un achat/dépôt/solde d'ouverture, produit
pour une vente/un retrait, juste valeur optionnelle pour une récompense), `scope`
(`'coinhouse' | 'external'`), `accountId?` (absent sur les saisies antérieures aux comptes, déduit
alors de `scope`).

### `qualifications` — réponses à « à qualifier »

`Record<EventId, Qualification>` : réinterprétation d'une ligne que le moteur n'a pas su classer
seul (union discriminée par `kind` : `ignore`, `reward`, `deposit`, `withdrawal`, `purchase`,
`sale`, `trade` — chacun avec ses propres montants `DecimalString | null`). Ne touche jamais aux
lignes brutes : une correction du normaliseur s'applique donc sans re-qualifier.

### `transferOverrides` — corrections d'appariement de virements

`Record<EventId, TransferOverride>` : clé = identifiant du retrait, valeur = identifiant du dépôt
imposé, ou la chaîne littérale `'none'` (appariement automatique désactivé pour ce retrait). Rien
d'autre n'est persisté sur les virements : la paire elle-même est **recalculée à chaque
chargement** (`docs/pivot-import.md` § Virements internes, décision n° 25) — ce conteneur ne porte
que les exceptions à la règle automatique.

### `taxAnnotations` — réservé (mode fiscal futur)

`Record<EventId, { portfolioValueEur: DecimalString | null }>` : conteneur additif posé pour un
usage futur (valeur globale du portefeuille au jour d'une cession), non exploité aujourd'hui.

### `assetSettings` — réglages par actif

`Record<AssetCode, AssetSettings>` : `manualPriceEur` (`DecimalString | null`), `manualPriceAt`
(chaîne de date, `null` en l'absence de prix manuel), `coingeckoId` (identifiant CoinGecko choisi à
la main pour un symbole ambigu — un symbole partagé par deux projets ne reçoit jamais
d'identifiant automatique, décision n° 54).

### `accounts` — comptes déclarés

`Record<AccountId, Account>` : **seulement** les comptes créés explicitement par l'utilisateur —
les comptes implicites (`ch:main`, `man:default`) n'y figurent jamais, ils existent dès qu'un
événement les référence. `kind` (`'coinhouse' | 'manual' | 'hyperliquid' | 'csv' | 'onchain'`),
`label` (≤ 60 caractères), `space` (`'invest' | 'trading'`), `country?` (ISO 3166-1 alpha-2,
juridiction de l'organisme qui tient le compte — décision fiscale 3916-bis, décision n° 62 ;
absent = `unknown`, jamais deviné), `spotAsInvestment?`, `address?`, `chain?`
(`'btc' | 'eth' | 'arbitrum' | 'base'`), `createdAt` (ISO 8601).

### `hyperliquid` — bruts Hyperliquid

`HlState`, conteneur additif (décision n° 22) : `accounts` (fills/funding/mouvements du grand
livre par compte, clés stables — `tid`, clés composites funding/ledger —, curseurs de
synchronisation, instantané, courbe `portfolio`) et `spotPairs` (résolution des paires spot hors
ligne). Détail complet des champs : `docs/hyperliquid-import.md`.

### `journal` et `manualTrades` — espace Trading

`Record<string, JournalEntry>` : ce que l'utilisateur écrit sur un trade (thèse, revue, setup,
tags, erreurs, note, plan entrée/stop/objectif/risque) — **donnée première, jamais recalculée**
(décision n° 23). `Record<string, ManualTrade>` : trades saisis à la main sur une plateforme sans
API (`qty` / `entryPrice` / `exitPrice` en `DecimalString`, `fees`, devise de cotation
`'USD' | 'EUR'`) — le P&L n'est **jamais stocké**, toujours recalculé.

### `engineSettings` — réglages du moteur

`EngineSettings` : `migrationMode` (`'carry-cost'` par défaut, ou `'realize'`, décision n° 8),
`rewardValuation` (`'zero'` par défaut, ou `'fair-value'`, décision n° 9),
`includeSubscriptionsInPnl` (booléen).

### `priceCache` — dernier cours connu par actif

`Record<AssetCode, PriceQuoteInput>` : `priceEur` (`DecimalString`), `at` (ISO 8601 de la
cotation), `source` (nom du fournisseur), `stale` — **toujours réécrit à `true`** à la relecture
d'une sauvegarde (`sanitizeState`) : un cours qui vient de resurgir d'un fichier est par
construction périmé.

### `fx` — taux de change BCE en cache

`FxCache` : `base` (toujours `'EUR'`), `rates` (par devise, série `AAAA-MM-JJ → DecimalString`,
jours ouvrés BCE uniquement), `updatedAt` (ISO 8601 par devise), `source`.

### `alerts` — alertes de prix

`AlertsState` : `rules` (seuils relatifs au PRU ou prix fixe), `states` (armement, dernier
déclenchement, compteur), `events` (journal des déclenchements, borné à 100), `settings` (veille
opt-in, cadence, notifications système). Détail complet : `docs/alerts.md`, décision n° 36.

### `ui` — préférences d'affichage et de l'appareil

`UiSettings` : thème, mode discret, positions clôturées masquées, source des prix, devise
d'affichage, métriques par défaut des deux graphiques (courbe « Évolution » et fiche actif),
dates de dernière sauvegarde / d'acceptation de l'avertissement, mode démo, `lastSeenVersion`
(semver de l'app, voir § L'enveloppe), clé CoinGecko Demo, clé et fournisseur d'explorateur de
blocs, trois interrupteurs réseau opt-in (`liveMids`, `marketContext`, `liveFills`) — tous
booléens ou chaînes, aucun montant. Deux champs restent **propres à l'appareil** par construction
et ne devraient jamais quitter la machine qui les a réglés : `coingeckoDemoKey`, `explorerKey`
(voir § Fusion, ci-dessous).

## Fusion

`mergeStates()` (`src/lib/storage/json-io.ts`) fait l'union par identifiant de tous les conteneurs
de DONNÉES (lignes, saisies, comptes, Hyperliquid, journal, alertes…) ; les conteneurs de RÉGLAGES
(`engineSettings`, `priceCache`, `fx`, `ui`) restent ceux de l'état courant lors d'une fusion — un
fichier restauré « en fusionnant » depuis un autre appareil ne réécrit jamais les préférences de
celui-ci, `coingeckoDemoKey`/`explorerKey` compris. `src/lib/storage/storage.test.ts`
(§ « complétude du schéma ») fait échouer la CI si un conteneur futur est ajouté sans décision de
fusion explicite.

## Export portable (Koinly / Waltio) : ce qui survit, ce qui ne survit pas

`src/lib/export/koinly-csv.ts` écrit, `src/lib/import/pivot/` relit — le format lui-même
(en-têtes, règles de valeur EUR, dédoublonnage) est déjà entièrement documenté par
`docs/pivot-import.md` ; ce qui suit est spécifique à l'ALLER-RETOUR (exporter depuis cette app,
puis réimporter le fichier obtenu, ici ou dans un autre outil qui lit le même format).

**Ce qui survit exactement** (prouvé par une propriété, 150 tirages aléatoires,
`tests/integration/koinly-roundtrip.property.test.ts`) : achats et ventes en EUR et en USDC,
frais, récompenses — quantité, PRU, coût, valeur, réalisé et total identiques après aller-retour,
sur chaque actif.

**Ce qui ne survit pas** (figé par deux cas nommés,
`tests/integration/koinly-roundtrip-gaps.test.ts`) :

| Perte                                                   | Détail                                                                                                                                                                                                                                      | Code du décompte à l'écran      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Comptes                                                 | Le format pivot ne porte pas de colonne « compte » ; un ré-import atterrit dans **un seul** compte de destination, quel que soit le nombre de comptes d'origine                                                                             | `accounts-merged`               |
| Virements internes appariés                             | Jamais persistés (recalculés à chaque chargement, § `transferOverrides` ci-dessus) ; après aller-retour, retrait et dépôt vivent dans le même compte réimporté — l'appariement (qui exige deux comptes différents) ne peut plus se reformer | `paired-transfers-lost`         |
| Coût d'un solde d'ouverture crypto (non cash)           | Exporté dans la colonne `Net Worth`, mais la réimportation d'une ligne « reçu seul » ne lit `Net Worth` que pour une récompense étiquetée, jamais pour un dépôt — le coût redevient `null` (0 € retenu par le moteur)                       | `opening-balance-cost-lost`     |
| Journal, trades manuels, Hyperliquid, réglages, alertes | **Jamais prétendus portables** : hors du périmètre investissement que Koinly modélise, ils ne sont même pas tentés                                                                                                                          | — (rien n'est exporté à moitié) |

**Un cas pire qu'une perte silencieuse — le sens change** : une migration/delisting est exportée
comme un échange crypto↔crypto (`label: 'swap'`) valorisé par la colonne `Net Worth`, faute de
mieux dans un format qui ne connaît que des échanges. Une fois réimportée, cette ligne redevient un
`trade` ordinaire — **une vente réellement réalisée**, alors que l'événement d'origine (mode par
défaut « coût reporté », décision n° 8) n'avait constaté aucun gain. Code : `migration-as-trade`.

### Le décompte affiché avant le téléchargement

`src/lib/export/koinly-preview.ts` (fonction pure, `koinlyPortabilityPreview`) compte ces quatre
pertes sur les événements réels de l'utilisateur — jamais un texte générique — et
`src/lib/format/koinly-preview.ts` les met en français (un code, une phrase, un seul endroit qui
sait écrire ces phrases). Réglages → Données affiche la liste juste avant le bouton d'export, sur
le même principe que la traçabilité (décision n° 61) : **on nomme le trou, on ne le comble pas**,
et aucun chiffre ne doit changer de sens sans un avertissement écrit en face.

## Vérification

| Quoi                                               | Où                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Fixture v1 gelée, aller-retour identique           | `tests/fixtures/storage/backup-v1.json` + `src/lib/storage/storage.test.ts`                 |
| Aller-retour Koinly, propriété (150 tirages)       | `tests/integration/koinly-roundtrip.property.test.ts`                                       |
| Pertes connues, figées par deux cas nommés         | `tests/integration/koinly-roundtrip-gaps.test.ts`                                           |
| Décompte avant export, codes purs + rendu français | `src/lib/export/koinly-preview.ts`, `src/lib/format/koinly-preview.ts` (+ leurs `.test.ts`) |
