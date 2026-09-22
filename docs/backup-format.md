# Format de sauvegarde — anti-verrouillage (P72)

Documente l'enveloppe de sauvegarde JSON et chaque conteneur de `StoredStateV1`
(`src/lib/storage/schema.ts`), la politique de version, la fusion multi-appareils, et ce qui
survit — ou non — de l'export portable Koinly/Waltio. S'appuie sur des décisions déjà prises :
n° 21 (sauvegarde robuste, IndexedDB, chiffrement optionnel), n° 24 (import « format pivot »
Koinly/Waltio), n° 26 (convertisseurs natifs) et n° 182 (fusion multi-appareils, § Fusion
ci-dessous). Le § « Pourquoi pas de schéma publié » plus bas explique pourquoi ce document en
prose, et non un schéma séparé, reste la référence pour l'enveloppe elle-même.

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
est le numéro sémantique de l'application (`2.13.0`, `package.json`) dont l'utilisateur a vu les
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

Elle rougit à chaque ajout additif, et **c'est son rôle** : l'ajout de `aiEnabled` et `aiModelId`
(P65) l'a fait échouer aussitôt. Ce qui bouge alors, ce n'est pas la fixture — c'est l'**attendu**
du test, qui constate que le fichier de 2026 gagne deux préférences à leur valeur par défaut, sans
qu'aucune donnée de l'utilisateur ne change et sans montée de `SCHEMA_VERSION`. Un échec de ce test
pose donc toujours la même question, la bonne : « l'ajout est-il vraiment additif ? »

## Ce fichier ne va jamais dans git

La sauvegarde porte **tout** : lignes brutes, saisies, qualifications, comptes, réglages, cache de
prix. Elle n'est pas un relevé de courtier, mais elle contient ce qu'un relevé contient et le reste
avec. `.gitignore` l'exclut par son nom (`*cout-revient-ch-sauvegarde*.json`, `demo-` et `-chiffree`
compris) et `scripts/check-no-personal-exports.js` fait échouer `lint` si une sauvegarde est suivie
hors de `tests/fixtures/` — chiffrée ou non, car un fichier chiffré aujourd'hui est un fichier
déchiffrable le jour où la phrase secrète fuite. La fixture gelée (`backup-v1.json`) porte un autre
nom, et reste suivie. Décision n° 167.

## Le chiffrement optionnel du fichier exporté

Deux versions d'enveloppe coexistent, et **les deux s'ouvrent**. Chaque fichier porte le KDF avec
lequel il a été écrit : c'est lui qui décide, jamais la version de l'application qui le relit.

| Version | KDF                            | Ce que l'en-tête porte en clair        | Écrite aujourd'hui |
| ------- | ------------------------------ | -------------------------------------- | ------------------ |
| 1       | PBKDF2-HMAC-SHA-256, 600 000 i | `iterations`, `salt`, `iv`             | non, **mais lue**  |
| 2       | Argon2id (`@noble/hashes`)     | `params` (`m`, `t`, `p`), `salt`, `iv` | oui                |

Le chiffrement lui-même est **AES-GCM-256** dans les deux cas : chiffrement authentifié, donc toute
altération du fichier fait échouer le déchiffrement plutôt que de rendre silencieusement des données
corrompues. Les paramètres du KDF voyagent en clair, comme dans `age` ou dans JWE (`p2s`, `p2c`) —
ils ne sont pas des secrets, et les écrire est la seule façon de pouvoir les relever un jour sans
rendre illisible un seul fichier existant.

**Pourquoi ce n'est plus PBKDF2** (décision n° 151). PBKDF2 n'est coûteux qu'en temps ; une carte
graphique en calcule des milliards en parallèle. Argon2id est coûteux en **mémoire** — 46 Mio par
tentative ici —, ce qu'un attaquant ne peut pas paralléliser à bon marché. C'était déjà le KDF du
coffre du navigateur : la sauvegarde, c'est-à-dire le **seul fichier qui voyage**, gardait le plus
faible des deux.

**Pourquoi pas de WebAssembly.** Toutes les implémentations WASM d'Argon2 exigent
`wasm-unsafe-eval` dans la CSP — une contrainte de la plateforme, pas des bibliothèques. Les adopter
reviendrait à trouer la CSP stricte de l'application pour renforcer un mot de passe. `@noble/hashes`
est en JavaScript pur, déjà en dépendance de production, et ne demande aucune exception ; le prix
est ~250 ms de dérivation, payés une fois par export ou par ouverture.

### La sauvegarde chiffrée de version 1 est gelée dans un test

`src/lib/storage/encryption.test.ts` porte un fichier v1 **complet et figé** — sel, IV, texte
chiffré — produit par l'ancien code et jamais régénéré. Il est déchiffré à chaque exécution de la
suite. C'est le seul moyen de garantir ce qui compte vraiment ici : **une sauvegarde est une
assurance, elle ne vaut que si elle s'ouvre le jour où tout le reste a disparu.** Le régénérer
reviendrait à ne plus rien prouver.

## Enveloppe v3 de la boîte aux lettres

Troisième format, **distinct** de la sauvegarde ci-dessus : celui des fichiers qu'un appareil dépose
dans un dossier synchronisé (Drive, OneDrive…) pour que les autres appareils du même propriétaire
les lisent. Code : `src/lib/storage/mailbox-envelope.ts` (format, chiffrement),
`src/lib/storage/mailbox.ts` (nommage, sélection — pur, sans chiffrement),
`src/lib/storage/mailbox-sync.ts` (orchestre UN cycle : lit les pairs, fusionne, dépose, élague —
pur lui aussi, un dossier abstrait en paramètre), `src/lib/storage/mailbox-folder.ts` (le dossier
réel, File System Access, et ce que cet appareil retient entre deux sessions), écran
`src/routes/Synchro.svelte` (`#/synchro`, espace « Plus »).

### Le cycle d'écriture et de lecture

Un cycle (`syncMailbox`) fait toujours les trois dans cet ordre, sur le dossier ENTIER relu à
chaque fois (jamais un delta) :

1. **Lire.** Lister le dossier, lire chaque fichier, ne garder que ceux dont l'en-tête se lit
   (`readMailboxHeader` — un fichier vide, tronqué ou d'un autre format est silencieusement écarté,
   jamais une erreur). Parmi ce qui reste, `selectPeerFiles` garde le plus récent (`seq`) de CHAQUE
   appareil PAIR — jamais le sien — trié par identifiant d'appareil pour que l'ordre de découverte du
   système de fichiers ne change rien.
2. **Fusionner.** Pour chaque pair dont le `seq` dépasse le dernier déjà fusionné (persisté en méta
   IndexedDB, par appareil pair) : déchiffrer (phrase de synchronisation de la session,
   `mailbox-session.ts` — jamais enregistrée) puis fusionner via `AppState.restoreBackup(json,
'merge')`, donc `mergeSynced` (§ Fusion ci-dessous), exactement comme une restauration de
   sauvegarde classique. Une mauvaise phrase ou un texte chiffré altéré (message indistinguable,
   voir plus bas) rapporte un statut nommé pour CE pair et n'avance pas son `seq` connu — il sera
   retenté au cycle suivant — sans jamais bloquer la lecture des autres pairs.
3. **Déposer, puis élaguer.** Chiffrer l'état COURANT (post-fusion, donc incluant ce qui vient
   d'être appris à l'étape 2 — la propagation entre pairs qui ne partagent pas le même dossier
   passe ainsi par un appareil intermédiaire) sous un **nouveau** nom numéroté
   (`mailboxFileName(device, seq)`, `seq` réservé et persisté AVANT l'écriture — voir plus bas
   pourquoi), jamais une réécriture. Puis supprimer ses propres fichiers au-delà des deux plus
   récents (`ownFilesToPrune`, qui ne touche jamais un fichier dont l'en-tête porte un autre
   appareil) ; une suppression qui échoue (fichier verrouillé par le client cloud en plein envoi)
   est silencieusement retentée au cycle suivant.

**Pourquoi `seq` est réservé avant l'écriture, pas après son succès.** Le nom d'un fichier ne dépend
que de l'appareil et de `seq` : réutiliser un `seq` après une écriture ratée risquerait d'écrire
sous un nom déjà PRIS (par exemple par un envoi du client cloud encore en cours), donc de corrompre
ou de retarder ce dépôt-là. Un `seq` sauté à la place est inoffensif : ni la sélection ni l'élagage
ne supposent une suite sans trou.

**Quand un cycle a lieu.** Au démarrage (si un dossier et sa permission sont déjà là), au retour au
premier plan de l'onglet, 60 secondes après la dernière modification locale (jamais en mode démo,
jamais sans aucune donnée réelle), et à la demande depuis l'écran. Toujours silencieux (jamais
d'erreur, jamais de blocage de l'interface) tant que le dossier, sa permission ou la phrase de
synchronisation manquent — c'est ce qui permet de l'appeler sans condition depuis ces quatre points.

**Android, sans dossier.** `navigator.share`/le sélecteur de fichiers remplacent le dossier :
`buildMailboxDeposit` construit le MÊME fichier (chiffrement, nom) sans jamais toucher à un
`MailboxFolder`, et `AppState.ingestMailboxFile` en reçoit un (sélecteur ou Web Share Target,
`shared-inbox.ts`) en appliquant exactement les étapes 1-2 ci-dessus à ce seul fichier.

### Pourquoi `.txt`, et pas `.json`

Sur Android, un fichier s'envoie vers la boîte aux lettres par la feuille de partage du système
(`navigator.share()`), qui refuse certains types de fichiers : `.json` / `application/json` n'est
**pas** sur la liste blanche de Chromium, `.txt` / `text/plain` l'est (MDN, `Navigator.share()`,
vérifié le 22/09/2026). Les fichiers de la boîte aux lettres sont donc du JSON **dans un fichier
`.txt`** — la réception (`share_target` du manifeste), elle, accepte les deux (`text/plain`, `.txt`,
`application/json`, `.json`) : mieux vaut être large en lecture que perdre un partage sur un type
que l'expéditeur a étiqueté différemment.

### L'en-tête

En clair, à la différence du texte chiffré :

| Champ         | Sens                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| `app`         | `'cout-revient-ch'`, comme la sauvegarde                                  |
| `kind`        | `'mailbox'` — distingue une enveloppe v3 d'une sauvegarde v1/v2           |
| `version`     | `3`                                                                       |
| `device`      | UUID de l'appareil écrivain (fourni par l'appelant — pas de ce module)    |
| `seq`         | Entier croissant, propre à CET appareil (pas un compteur global)          |
| `writtenAt`   | ISO 8601, instant d'écriture                                              |
| `kdf`         | `'argon2id'`, seul KDF que la v3 écrit                                    |
| `params`      | `{ m, t, p }` d'Argon2id, comme la sauvegarde v2                          |
| `salt`        | Base64. **Stable par appareil** (voir plus bas), pas régénéré par fichier |
| `iv`          | Base64, 96 bits. Aléatoire à CHAQUE écriture                              |
| `compression` | `'gzip'`, seule valeur que la v3 écrit                                    |
| `ciphertext`  | Base64. Le seul champ qui n'est PAS en clair                              |

`readMailboxHeader(text)` lit et valide cette forme SANS déchiffrer — c'est ce qui permet de trier
des dizaines de fichiers d'un dossier sans payer une dérivation Argon2id par fichier avant d'avoir
choisi lesquels valent la peine d'être déchiffrés.

### Pourquoi l'AAD couvre l'en-tête ENTIER

AES-GCM authentifie toujours le texte chiffré : l'altérer fait déjà échouer le déchiffrement, en v3
comme en v2. Mais un en-tête en clair reste, par nature, modifiable sans toucher au texte chiffré —
et `seq`/`device`/`writtenAt` ne participent à aucune dérivation de clé, donc les modifier ne casse
rien côté clé. `additionalData` (AAD) d'AES-GCM ferme ce trou : MDN (`AesGcmParams`, vérifié le
22/09/2026) — « This contains additional data that will not be encrypted but will be authenticated
along with the encrypted data. […] If the data given to the decrypt() call does not match the
original data, the decryption will throw an exception. » L'AAD utilisée ici est le JSON canonique
(clés triées, récursivement) de l'enveloppe entière SAUF `ciphertext` : changer un seul caractère
d'un seul champ d'en-tête change l'AAD, donc fait échouer le déchiffrement — jamais produire un
contenu associé à des métadonnées fausses. Contre-épreuve (décision n° 75) dans
`mailbox-envelope.test.ts` : voir le rapport de ce chantier pour le détail de ce qui a été vu rougir.

### Compression avant chiffrement

Le JSON (état complet ou sous-ensemble synchronisé) compresse bien : texte répétitif, mêmes clés
partout. `CompressionStream`/`DecompressionStream('gzip')` sont natifs du navigateur — Chrome 80,
Firefox 113, Safari 16.4 (web.dev/blog/compressionstreams, vérifié le 22/09/2026) — aucune
dépendance ajoutée. Ordre : JSON → gzip → AES-GCM ; l'inverse au déchiffrement.

### Le cache de clés par sel, et pourquoi un sel stable par appareil

`deriveAesKey` (`kdf.ts`, décision n° 151, seul point de dérivation) coûte ~250 ms : lire les
fichiers de plusieurs appareils sur plusieurs synchronisations ne doit pas re-payer ce coût à chaque
fichier. Un cache EN MÉMOIRE DE SESSION (jamais persisté, vidé au rechargement de l'onglet) associe
chaque (SEL, phrase secrète) déjà rencontré à sa clé dérivée. Cela suppose que l'écrivain d'un
appareil donné utilise toujours le MÊME sel (fourni par l'appelant, pas régénéré par ce module à
chaque écriture) : pour l'usage normal — une seule phrase déverrouille toute la boîte aux lettres,
le temps d'une session — c'est ce qui fait qu'un lecteur ne dérive qu'une fois par appareil pair,
pas une fois par fichier.

**Piège trouvé par le test, pas anticipé au premier jet** : indexer le cache par le sel SEUL (sans
la phrase) déchiffrait avec succès une enveloppe sur une phrase secrète FAUSSE, dès lors que la
bonne phrase avait déjà été dérivée pour ce même sel plus tôt dans la session — la clé mise en cache
répondait à la place de la vérification. Le test « mauvaise phrase secrète » l'a fait rougir
immédiatement. La clé du cache est donc la PAIRE (sel, phrase), jamais le sel seul : le cas normal
garde la même propriété (une dérivation par sel, la phrase ne changeant pas en cours de session),
et une phrase différente sur un sel déjà vu redérive, puis échoue comme elle le doit.

Limite connue et acceptée : NIST SP 800-38D borne un IV aléatoire de 96 bits à 2^32 chiffrements
sous une même clé. Un sel stable par appareil implique une clé stable par appareil (via le cache) ;
au rythme d'une synchronisation manuelle, cette limite reste hors d'atteinte de plusieurs ordres de
grandeur — nommée ici pour ne pas être oubliée, pas parce qu'elle est proche.

### Ce qui ne change PAS

`encryption.ts` (sauvegarde v1 PBKDF2, v2 Argon2id) reste inchangé : la v3 ne l'importe pas, ne le
modifie pas, et le message d'erreur générique « phrase secrète incorrecte » qu'elle réutilise pour
un mot de passe faux ou une enveloppe altérée est dupliqué à l'identique plutôt qu'importé — pour
que ce fichier se lise seul, et que `encryption.ts` ait un historique de modifications qui n'inclut
jamais ce chantier.

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

### `duplicateOverrides` — doublons candidats déjà tranchés

`Record<string, DuplicateReview>` (P68) : clé = `duplicatePairKey(a, b)` (deux identifiants
d'événement joints par `~`), valeur = `'confirmed' | 'dismissed'`. Même forme que
`transferOverrides` : un doublon confirmé ou écarté n'est plus reproposé, mais rien n'est jamais
supprimé automatiquement des données (`src/lib/domain/reconciliation.ts`).

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

### `lending` — prêts de financement participatif

`LendingState` (proposition du 06/09/2026) : `loans` (`Record<LoanId, Loan>`, le contrat — plateforme,
emprunteur, capital, taux, convention de décompte des jours, amortissement, échéance), `events`
(`Record<string, LoanEvent>`, append-only — remboursements, retards, défaut — jamais modifié après
coup) et `wallet` (`Record<string, WalletMovement>`, trésorerie de la plateforme — dépôts, retraits,
intérêts). Rien de dérivé n'y est stocké : encours, statut et TRI se recalculent à chaque
chargement, jamais persistés.

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
blocs, trois interrupteurs réseau opt-in (`liveMids`, `marketContext`, `liveFills`), l'opt-in du
récit par IA (`aiEnabled`, `aiModelId` — P65), et les tailles tapées dans l'onglet « Seuil » de
l'espace Trading, par actif (`breakevenSizes`, décision n° 158 — des quantités hypothétiques, jamais
une position), et le foyer de l'écran « Impôts » (`taxBasis`, `householdIncomeEur`,
`householdParts`, décision n° 170).

#### Le seul montant de `ui`, et c'est le plus personnel

`householdIncomeEur` est le **revenu imposable du foyer**. Cette rubrique n'en contenait aucun
jusqu'au 20/09/2026, et la phrase « aucun montant » figurait ici : elle est désormais fausse, et
la corriger vaut mieux que de la laisser rassurer.

Ce revenu suit le même chemin que le reste de `ui` : il vit dans le stockage local, **il figure
dans le fichier de sauvegarde** — chiffré si vous chiffrez votre sauvegarde (décision n° 167) —,
et une restauration « en fusionnant » conserve celui de l'appareil courant (§ Fusion). Il ne part
sur aucun réseau : l'application n'en a pas. Le **mode discret** le masque, comme les autres
montants, et l'écran ne le réaffiche que sur demande explicite. `.gitignore` et
`scripts/check-no-personal-exports.js` refusent de laisser entrer une sauvegarde dans le dépôt.

#### Les clés, et laquelle n'y est pas

Deux clés d'API **figurent dans le fichier de sauvegarde** : `coingeckoDemoKey` et `explorerKey`.
Elles n'en sont écartées que lors d'une restauration « en fusionnant », qui conserve les réglages
de l'appareil courant (§ Fusion). C'est un choix : les deux sont **gratuites** et en **lecture
seule** — au pire, quelqu'un lit à votre place des cours ou des transactions déjà publiques —, et
les ressaisir à chaque restauration coûterait plus que ce qu'on protégerait. Le commentaire du
schéma prétendait l'inverse (« jamais dans une sauvegarde ») : il était faux, et c'est le sujet sur
lequel une phrase fausse coûte le plus cher. Il est corrigé.

**La clé d'API du modèle de langage (P65), elle, n'apparaît dans aucune sauvegarde, et ne le pourra
pas** : elle ne fait pas partie de `StoredStateV1`. Elle vit en mémoire vive
(`src/state/ai-key.svelte.ts`) et disparaît au rechargement de l'onglet. La différence n'est pas
une nuance de prudence : une clé d'IA est un **moyen de paiement**, pas un laissez-passer de
lecture. L'exclusion est donc structurelle — il n'y a pas de champ à oublier de filtrer — et un
test la prouve sur le **texte** d'une sauvegarde issue d'un état renseigné, sentinelle à l'appui
(`src/lib/storage/storage.test.ts`, § « clé Anthropic »). Le même test constate que les deux clés
gratuites, elles, y sont bien : les deux moitiés de la règle sont vérifiées, pas seulement celle
qui rassure.

### `sync` — métadonnées de fusion multi-appareils

`SyncMeta | undefined` (décision de ce chantier, `docs/DECISIONS.md`) : `v` (`1`), `clock`
(horloge logique hybride la plus avancée jamais vue par cet appareil, chaîne triable
lexicographiquement — voir `src/lib/storage/sync/hlc.ts`) et `versions` (par collection SUIVIE,
par clé d'enregistrement : `{ t: string, del?: true }`). Champ **additif** : absent d'une
sauvegarde antérieure à ce chantier, ce qui se relit comme « tout hérité » (§ Fusion). Jamais posé
par `emptyState()` — un état neuf n'a rien à dater — et jamais copié tel quel par `sanitizeState()`
sans validation de forme (chaînes HLC bien formées, collections connues ; un champ malformé est
écarté plutôt que de faire planter la restauration). Vit dans `StoredStateV1` pour voyager avec la
sauvegarde, mais **jamais dans l'état réactif de l'application** une fois chargé — voir
`docs/ARCHITECTURE.md` § stockage.

## Fusion

Deux mécanismes coexistent, sur des conteneurs différents.

**Conteneurs SUIVIS** (LWW — _last write wins_ — par enregistrement, avec pierres tombales) :
`imports`, `manualEvents`, `qualifications`, `transferOverrides`, `duplicateOverrides`,
`taxAnnotations`, `assetSettings`, `accounts`, `journal`, `manualTrades`, `alerts.rules`,
`alerts.states` — la liste exacte est `TRACKED_COLLECTIONS`, `src/lib/storage/sync/tracked.ts`.
`mergeSynced()` (`src/lib/storage/sync/merge.ts`) compare, **par clé d'enregistrement**, la version
de chaque côté (`sync.versions`, horloge logique hybride) : la plus récente gagne, qu'il s'agisse
d'une valeur ou d'une suppression — une pierre tombale ne ressuscite donc jamais face à une version
plus ancienne, seulement face à une écriture strictement postérieure. Une clé sans version connue
d'un côté (sauvegarde antérieure à ce chantier, ou jamais modifiée depuis) est dite « héritée » :
héritée des deux côtés à contenu identique, elle est conservée sans version ; héritée des deux
côtés à contenu **différent**, c'est un **conflit hérité** — la valeur de l'appareil **courant**
l'emporte et reçoit une date fraîche (décision explicite, qui se propage ensuite normalement à tous
les appareils) ; le rapport de fusion le signale. Trois élagages déterministes suivent
automatiquement un enregistrement devenu pierre tombale : les lignes brutes et pivot d'un lot
d'import supprimé, les bruts Hyperliquid d'un compte supprimé, et l'état d'armement d'une règle
d'alerte supprimée.

**Conteneurs d'UNION** (faits immuables, comme avant ce chantier) : `rawRows`, `pivotRows`,
`hyperliquid`, `lending`, `alerts.events` — l'entrant est simplement ajouté par identifiant, jamais
remplacé ni daté (une ligne brute ou un fill Hyperliquid ne change pas après coup).

**Conteneurs LOCAUX** (réglages de l'appareil courant, jamais fusionnés) : `engineSettings`,
`priceCache`, `fx`, `ui`, `alerts.settings` — un fichier restauré « en fusionnant » depuis un autre
appareil ne réécrit jamais les préférences de celui-ci, `coingeckoDemoKey`/`explorerKey` compris.

Une restauration « en remplaçant » ignore tout ceci : l'état devient exactement celui du fichier,
`sync` compris (horloge portée au plus grand des deux, pour qu'un appareil qui revient à une
sauvegarde plus ancienne ne fasse pas reculer sa propre horloge).

`src/lib/storage/storage.test.ts` (§ « complétude du schéma ») fait échouer la CI si un conteneur
futur est ajouté sans décision de fusion explicite (suivi, union ou local).

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

| Quoi                                                                                                             | Où                                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Fixture v1 gelée, aller-retour identique                                                                         | `tests/fixtures/storage/backup-v1.json` + `src/lib/storage/storage.test.ts`                 |
| Aller-retour Koinly, propriété (150 tirages)                                                                     | `tests/integration/koinly-roundtrip.property.test.ts`                                       |
| Pertes connues, figées par deux cas nommés                                                                       | `tests/integration/koinly-roundtrip-gaps.test.ts`                                           |
| Décompte avant export, codes purs + rendu français                                                               | `src/lib/export/koinly-preview.ts`, `src/lib/format/koinly-preview.ts` (+ leurs `.test.ts`) |
| Fusion : LWW, pierres tombales, propriétés algébriques (commutative, associative, idempotente), horloge, élagage | `src/lib/storage/sync/*.test.ts` (mutation ≥ 90 %, `npm run mutation:survivants`)           |
| Fusion : fichier hérité sans `sync`, non-régression                                                              | `src/lib/storage/storage.test.ts` § « fixture gelée v1 »                                    |
| Fusion : bout en bout, deux appareils réels (import, note, suppression, ré-fusion d'un fichier périmé)           | `tests/e2e/multi-device.spec.ts`                                                            |
