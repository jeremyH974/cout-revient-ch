# Import « format pivot » — format et sémantique (Koinly / Waltio, sourcé le 23/08/2026)

Au lieu d'un importeur natif par plateforme, l'app lit le format pivot que **Koinly** documente
publiquement pour tout import externe, et que **Waltio** lit aussi directement — un membre qui suit
déjà une autre plateforme (Binance, Bybit, un wallet…) dans l'un de ces outils récupère sa
consolidation multi-plateformes sans qu'aucune clé d'exchange n'entre jamais dans ce site
(docs/DECISIONS.md n° 24). Cinq plateformes assez présentes sur le Discord ont depuis reçu un
convertisseur natif dédié (§ « Convertisseurs natifs » ci-dessous, docs/DECISIONS.md n° 26) : pour
les autres, ce format pivot reste la voie normale. Les lignes atterrissent dans un compte `kind: 'csv'` de l'espace
Investissement (écran Importer → glisser un fichier → choisir le compte de destination), au même
titre qu'un compte Coinhouse ou qu'un compte Hyperliquid. Les exemples de ce document viennent des
fixtures 100 % synthétiques `tests/fixtures/pivot/demo-exchange.csv` et `demo-ledger.csv`
(docs/DECISIONS.md n° 17) ; aucune donnée réelle n'apparaît ici.

## Formats acceptés (en-têtes verbatim)

Détection insensible à la casse et aux espaces multiples (`detectPivotFormat`,
`src/lib/import/pivot/detect.ts`) ; seule la colonne `Date` (ou `Date (UTC)`) est strictement
obligatoire, avec au moins une paire montant + devise envoyée ou reçue.

**A — « Custom CSV Universal » Koinly** (gabarit générique publié pour construire soi-même un CSV
à destination de Koinly) :

```
Date, Sent Amount, Sent Currency, Received Amount, Received Currency, Fee Amount, Fee Currency,
Net Worth Amount, Net Worth Currency, Label, Description, TxHash
```

**B — export interne Koinly** (`Transactions → Bulk edit → Export`), le fichier que Waltio ingère
directement comme « fichier Koinly » :

```
ID, Date (UTC), Type, Tag, From Wallet ID, From Amount, From Currency, To Wallet ID, To Amount,
To Currency, Fee Amount, Fee Currency, Net Worth Amount, Net Worth Currency, TxHash, Description
```

Les deux convergent vers la même ligne brute (`RawPivotRow`) : `Sent`/`From` → jambe envoyée,
`Received`/`To` → jambe reçue, `Label`/`Tag` → une seule étiquette en minuscules. Le format est
déduit de la colonne effectivement présente (`From Amount` ⇒ export interne, `Sent Amount` ⇒
Universal). Les colonnes propres à l'export interne sans équivalent Universal (`ID`, `Type`,
`From/To Wallet ID`, `Fee Worth Amount/Currency`, `Net Worth`, `Deleted`, `TxSrc`, `TxDest`) sont
reconnues mais ignorées, jamais signalées comme « inconnues » ; toute autre colonne imprévue
déclenche un avertissement listant son nom, sans bloquer l'import.

## Règle de date

Les deux formats exigent une date **en UTC**, `YYYY-MM-DD HH:mm:ss` (Koinly : « must be in UTC
time » [1]) ; les variantes avec `T`, secondes absentes, millisecondes ou suffixe `Z`/`+00:00` sont
tolérées (`utcStringToMs`, `src/lib/import/time.ts`). L'instant est converti en heure de Paris de
façon déterministe par `Intl.DateTimeFormat` (`msToParisNaive`), **jamais** avec `new Date()` sur
une chaîne — exactement la règle déjà utilisée pour Hyperliquid (docs/DECISIONS.md n° 22), pour que
le tri chronologique mixte avec les événements Coinhouse et Hyperliquid d'une même journée reste
juste.

## Table de mapping (ligne → événement du grand livre)

Reprend exactement `src/lib/import/pivot/events.ts` ; rien n'y est estimé silencieusement.

| Lignes présentes                              | Condition                                                                                                                       | Événement                            | Valeur EUR                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `Sent` + `Received`                           | jambe reçue « cash » (fiat/stable) et (jambe envoyée non cash, ou reçue = EUR/stable EUR)                                       | `trade` (vente, ou cash→cash)        | contre-valeur de la jambe **reçue**, **nette** des frais                                 |
| `Sent` + `Received`                           | jambe envoyée « cash », cas ci-dessus non applicable                                                                            | `trade` (achat)                      | contre-valeur de la jambe **envoyée**, frais **compris** (all-in)                        |
| `Sent` + `Received`                           | ni l'une ni l'autre jambe cash (crypto ↔ crypto) et `Net Worth` exploitable                                                     | `trade` (échange)                    | `Net Worth` du fichier (avertissement : « Contre-valeur issue de la colonne Net Worth ») |
| `Sent` + `Received`                           | crypto ↔ crypto sans `Net Worth` exploitable, ou jambe cash non convertible ce jour-là                                          | **à qualifier**                      | —                                                                                        |
| `Received` seul                               | `Label`/`Tag` ∈ reward, staking, stake, airdrop, fork, mining, interest, lending interest, salary, income, cashback, fee refund | `reward`                             | `Net Worth` si présent, sinon `null` (coût 0 par défaut, décision n° 9)                  |
| `Received` seul                               | actif « cash » (stable, USD…), pas une étiquette de récompense                                                                  | `deposit`                            | contre-valeur BCE du jour (avertissement « valorisé au taux BCE »)                       |
| `Received` seul                               | actif crypto non cash, pas une étiquette de récompense                                                                          | `deposit`, `costEur: null`           | — (candidat à l'appariement de virement, docs/DECISIONS.md n° 25)                        |
| `Sent` seul                                   | `Label`/`Tag` ∈ cost, fee, tax, margin fee, loan fee, other fee, futures fee, funding fee, et convertible                       | `fee`                                | contre-valeur convertie                                                                  |
| `Sent` seul                                   | même étiquette mais non convertible ce jour-là                                                                                  | `withdrawal`, `proceedsEur: null`    | — (avertissement « sortie non convertible : sortie au coût », pas de frais compté)       |
| `Sent` seul                                   | `Label`/`Tag` ∈ gift, lost, donation                                                                                            | `withdrawal`                         | BCE si actif cash, sinon `null` (avertissement « sortie au coût, aucune plus-value »)    |
| `Sent` seul                                   | actif « cash », aucune étiquette particulière                                                                                   | `withdrawal`                         | contre-valeur BCE du jour (avertissement « valorisé au taux BCE »)                       |
| `Sent` seul                                   | actif crypto non cash, aucune étiquette                                                                                         | `withdrawal`, `proceedsEur: null`    | — (candidat à l'appariement de virement)                                                 |
| Jambes présentes 100 % fiat (EUR/USD/GBP/CHF) | pas de sortie étiquetée frais                                                                                                   | **ignorée** (compteur `skippedCash`) | — (pas de trésorerie fiat modélisée pour ce format)                                      |

« Cash » = EUR, USD, GBP, CHF (`isFiat`) ou un stablecoin connu (`usdc`, `usdt`, `dai`, `usds`,
`pyusd`, `fdusd`, `tusd`, `usde`, `usdp`… pour l'équivalent USD ; `eurc`, `eurcv`, `eure`, `eurs`,
`eurt` pour l'équivalent EUR au pair). Un frais (`Fee Amount`/`Fee Currency`) dans une devise non
convertible ce jour-là n'est **ni déduit ni compté** (avertissement affiché), plutôt que d'ajuster
le montant avec un taux faux. Les lignes « à qualifier » rejoignent l'écran **À qualifier** déjà
utilisé par l'import Coinhouse (même mécanisme de qualification, `applyQualification`).

## Règles de valeur EUR

Comme le reste de l'app (docs/DECISIONS.md n° 4 et n° 18) : jambe EUR directe au pair, USD et
stablecoins USD au taux BCE Frankfurter du jour, stablecoins EUR au pair. La colonne `Net Worth` du
fichier n'est utilisée **qu'en dernier recours**, pour un échange crypto ↔ crypto sans aucune jambe
cash, et toujours avec un avertissement visible à l'écran — jamais silencieusement. Sans
contre-valeur sûre (taux BCE indisponible à cette date, devise non gérée), la ligne part « à
qualifier » plutôt que d'afficher un chiffre inventé.

## Dédoublonnage et ré-import

Clé stable par **hachage du contenu métier de la ligne** (FNV-1a sur date, montants/devises
envoyé/reçu/frais/Net Worth, étiquette, description, TxHash — `src/lib/import/pivot/rows.ts`),
préfixée par le compte (`pv:<compte>:<hash>[#n]`) : le `TxHash` seul ne suffit pas, il est
facultatif dans les deux formats et une même transaction on-chain peut légitimement produire
plusieurs lignes (un envoi et sa réception, par exemple). Deux lignes réellement identiques dans un
même fichier restent deux opérations distinctes grâce à un suffixe `#n` déterministe. Un ré-import
du même fichier (ou d'un export plus récent qui le recouvre) est donc **idempotent** : les lignes
déjà connues sont comptées « déjà connues » et ignorées ; une même clé avec un contenu différent est
un conflit signalé, la version déjà importée étant conservée. Les lignes brutes sont persistées
telles quelles (`StoredStateV1.pivotRows`), au même titre que les lignes Coinhouse (décision n° 3) —
une correction du normaliseur (`events.ts`) s'applique donc sans ré-import. Une sauvegarde JSON se
fusionne par union des clés. Supprimer un compte CSV supprime ses lignes et nettoie les
appariements de virement qui le référençaient.

## Virements internes

Un retrait sans produit renseigné et un dépôt sans coût renseigné, du même actif, dans deux comptes
différents de l'app, sont candidats à l'appariement automatique (`src/lib/domain/transfers.ts`,
docs/DECISIONS.md n° 25) : fenêtre de 2 h avant à 72 h après le retrait, écart de quantité
≤ max(2 %, 0,000001) (frais réseau). Effet moteur : la sortie se fait **au coût** (réalisé nul) et
la **totalité** du coût de la cession devient le coût d'acquisition du dépôt — le PRU du compte de
destination peut donc légèrement monter (il absorbe le coût des unités perdues en frais réseau),
sans qu'aucune plus-value ne soit jamais constatée sur le trajet. Rien n'est persisté : recalculé à
chaque chargement à partir des événements et des overrides de l'utilisateur.

Correction manuelle depuis l'écran **Comptes** : chaque paire automatique peut être déliée
(« Délier », l'override `'none'` désactive l'appariement automatique pour ce retrait) ; un retrait
ou un dépôt resté orphelin (hors fenêtre, quantité trop éloignée, ou seul de son côté) peut être
apparié manuellement avec un candidat compatible, ou laissé tel quel (cession au coût, dépôt à coût
0 €). Une ligne d'auto-vérification (Réglages → Vérifications automatiques) résume les paires
appariées et les mouvements sans contrepartie.

## Export

Réglages → **« Format Koinly / Waltio (CSV) »** (`src/lib/export/koinly-csv.ts`) génère un CSV
Universal (format A ci-dessus) à partir de **toutes** les opérations de l'app, tous comptes et
toutes sources confondus (Coinhouse, Hyperliquid, pivot, saisies manuelles) : virgule, point
décimal, dates UTC, sans BOM — les exigences de Koinly, pas celles d'Excel FR. `Net Worth` porte la
valeur EUR déjà calculée par l'app (jamais recalculée par l'outil de destination), `TxHash` porte
l'identifiant d'événement (stable, donc un ré-export produit les mêmes clés). Les lignes « à
qualifier » sont laissées de côté et comptées à part plutôt qu'exportées avec une valeur inventée ;
un virement interne apparié est annoté « Virement interne (apparié) » en description.

## Convertisseurs natifs

Cinq plateformes ont un export propre assez utilisé sur le Discord pour justifier un convertisseur
dédié plutôt que de renvoyer systématiquement vers Koinly/Waltio (`src/lib/import/platforms/`,
docs/DECISIONS.md n° 26). Le fichier s'importe depuis le même écran **Importer**, dans le même
compte `kind: 'csv'` à choisir ou à créer que pour le format pivot — la détection du format est
automatique (en-tête reconnu), rien à choisir. Comme pour le format pivot, une ligne non reconnue
devient une ligne « à qualifier » ou un avertissement affiché, jamais une estimation silencieuse ;
le dédoublonnage se fait par hachage du **contenu natif** de la ligne (décision n° 26), pas du
résultat calculé — corriger un convertisseur ne duplique jamais les lignes déjà importées.

### Kraken

- **Où l'exporter** : compte Kraken → icône de profil → _Documents_ (ou _History → Export_ sur
  Kraken Pro) → export **Ledgers** (pas _Trades_) au format CSV [5].
- **En-tête attendu** : `txid, refid, time, type, subtype, asset, amount, fee, balance`
  (`ledgers.csv`, `src/lib/import/platforms/kraken.ts`).
- **Ce qui est importé** : échanges (`trade`/`spend`/`receive`, reliés par `refid`), dépôts,
  retraits, staking/earn (y compris les suffixes `.S`/`.M`/`28.S`…), dividendes et bonus de
  parrainage (`reward`), ajustements positifs (`airdrop`). Les codes d'actifs historiques (`XXBT`,
  `ZEUR`…) sont traduits automatiquement.
- **Pièges et limites** : un frais dans l'actif de la jambe (non convertible en cash) est plié dans
  la quantité plutôt que d'apparaître comme un frais séparé ; les lignes de marge (`margin`,
  `rollover`, `settled`) sont hors périmètre spot et signalées, jamais importées ; les transferts
  internes (hors airdrop) sont ignorés (comptés à part, pas en erreur).

### Coinbase

- **Où l'exporter** : _Profil → Rapports et relevés → Générer un rapport → Historique des
  transactions_ (CSV) — le libellé exact du menu varie selon les versions de l'interface [6].
- **En-tête attendu** : colonnes `Transaction Type`, `Quantity Transacted`, `Subtotal`
  obligatoires ; deux variantes coexistent pour les frais et la devise (`Fees and/or Spread` ou
  `Fees`, `Price Currency` ou `Spot Price Currency`), reconnues l'une comme l'autre.
- **Ce qui est importé** : achats/ventes (y compris « Advanced Trade », les deux orthographes
  Coinbase `Advanced Trade`/`Advance Trade` sont reconnues), `Convert` (jambe reçue lue dans
  `Notes`), envois/réceptions, récompenses (staking, intérêts, remises d'abonnement), dons,
  dépenses carte (`Card Spend` → étiquette « spend » : cession réalisée à la contre-valeur du
  relevé, cf. § « Étiquette dépense » plus bas).
- **Pièges et limites** : Coinbase fait parfois précéder son export de lignes de préambule avant
  l'en-tête réel ; la détection du format échoue si elles sont présentes — ouvrez le fichier et
  retirez ce préambule avant import (limitation connue, non contournée). Les mouvements internes
  (Pro/Exchange/Prime/Vault/staking Coinbase) sont ignorés ; les migrations d'actif ne sont pas
  gérées automatiquement (qualification manuelle).

### Bitvavo

- **Où l'exporter** : _Historique des transactions_ → bouton **Export** (en haut à droite) →
  **Transaction history** (CSV) [7].
- **En-tête attendu** : `Timezone, Date, Time, Type, Currency, Amount, Quote Currency, Quote
Price, Received / Paid Currency, Received / Paid Amount, Fee currency, Fee amount, Status,
Transaction ID, Address` — `Quote Currency`/`Quote Price`/`Address` ne sont jamais lus.
- **Ce qui est importé** : achats, ventes, dépôts, retraits, staking, remises/parrainage/
  distributions (`reward`). Le fuseau vient de la colonne `Timezone`, **ligne par ligne** (repli sur
  `Europe/Amsterdam` si elle est absente).
- **Pièges et limites** : un frais de retrait dans l'actif retiré est plié dans la quantité envoyée
  (le solde réel débité) ; seules les lignes au statut `Completed`/`Distributed` sont importées ; les
  retraits annulés et les transferts internes sont ignorés.

### Ledger Live

- **Où l'exporter** : application **desktop** uniquement (pas l'app mobile) → _Paramètres →
  Comptes → Exporter l'historique des opérations_, choisir les comptes, _Enregistrer_ [8].
- **En-tête attendu** : `Operation Date, Operation Type, Currency Ticker, Operation Amount`
  obligatoires (`Status` optionnel selon la version exportée : filtré sur `CONFIRMED` quand il est
  présent).
- **Ce qui est importé** : opérations `IN`/`OUT`, récompenses (`REWARD`) et — seulement quand des
  frais sont dus — `FEES`/`REVEAL`/`BOND`/`UNBOND`/`WITHDRAW_UNBONDED`/`DELEGATE`/`UNDELEGATE`/
  `OPT_IN`/`OPT_OUT` (sinon mouvement interne ignoré).
- **Pièges et limites** : sur `OUT`, `Operation Amount` est déjà le montant total débité, **frais
  réseau inclus** — choix assumé face à une contradiction entre deux parseurs de référence
  (docs/DECISIONS.md n° 26) ; les colonnes `Countervalue…` sont délibérément ignorées (estimations
  jugées peu fiables) ; les opérations NFT (`NFT_IN`/`NFT_OUT`) ne sont pas gérées.

### Revolut

- **Où l'exporter** : app Revolut → Crypto → _Relevé de compte_ (aussi accessible depuis
  _Documents et relevés → Crypto_) → période → format Excel/CSV → _Générer_ [9].
- **En-tête attendu** : `Symbol, Type, Quantity, Price, Value, Fees, Date` (virgule) — l'absence
  de colonne `Transaction Type` sert à ne pas confondre ce fichier avec un export Coinbase.
- **Ce qui est importé** : achats/ventes (valorisés par `Value`, jamais par `Price` recalculé),
  envois/réceptions, récompenses de staking et d'apprentissage (`Learn`).
- **Pièges et limites** : le fuseau de la colonne `Date` n'est pas documenté par Revolut — l'app
  suppose l'heure locale Europe/Paris (hypothèse assumée pour un utilisateur français,
  docs/DECISIONS.md n° 26) ; `Staking reward` est souvent sans contre-valeur (`Value` vide) ;
  `stake`/`unstake` (mouvement interne spot ↔ staking Revolut) sont ignorés.

### Étiquette dépense (« spend »)

Une sortie étiquetée dépense (paiement carte, débit — `spend`/`card spend`/`payment`, aujourd'hui
produite par le convertisseur Coinbase) est traitée comme une **cession réalisée** : le prix de
vente est la contre-valeur fournie par le relevé (`Net Worth`/`Total` selon la source), et non le
coût — contrairement aux étiquettes « sans plus-value » (`gift`, `lost`, `donation`) qui sortent au
coût (`src/lib/import/pivot/events.ts`). Sans contre-valeur convertible ce jour-là, la dépense sort
au coût comme les autres cas non convertibles, avec un avertissement affiché.

## Import JSON Ghostfolio

Un compte Ghostfolio (auto-hébergé ou cloud) exporte ses activités en JSON depuis **Réglages →
Exporter** ; le fichier importé peut être l'export complet ou simplement `{ "activities": [...] }`
(`src/lib/import/ghostfolio/index.ts`, format vérifié dans le dépôt `ghostfolio/ghostfolio`, branche
`main`, le 24/08/2026) [10]. Il rejoint, lui aussi, un compte `kind: 'csv'` de l'espace
Investissement — le même écran **Importer**, la même liste de comptes que les CSV ci-dessus.

- **Ce qui est importé** : activités `BUY`, `SELL`, `DIVIDEND`, `INTEREST`, `FEE` —
  `value = quantity × unitPrice` (brut, hors frais) et `fee` partagent la devise de `currency`,
  jamais celle de l'actif (même règle d'or que l'export Coinhouse, décision n° 4). Le symbole est
  résolu selon `dataSource` : `COINGECKO` (slug retrouvé dans la table curée des tickers de l'app
  quand il y figure) ou `YAHOO` (ticker, suffixe `-EUR`/`-USD`/`-USDT`/`-BTC`/`-GBP` retiré) ; toute
  autre source garde le symbole tel quel, en minuscules.
- **Ce qui n'est pas importé** : `LIABILITY` (mouvement interne, ignoré) ; un type d'activité
  inconnu devient une ligne signalée, jamais une estimation.
- **Pièges et limites** : une `DIVIDEND`/`INTEREST` dont la source est `COINGECKO`/`YAHOO` devient
  une récompense en nature (valorisée par `Net Worth`) ; sinon (`MANUAL` ou source absente), c'est un
  revenu 100 % fiat, volontairement ignoré comme le reste du pipeline pivot (aucune trésorerie fiat
  modélisée pour ce format, même règle que ci-dessus). Un slug CoinGecko absent de la table de l'app
  est conservé tel quel plutôt que de bloquer l'import, avec une note affichée à l'écran.

## Appariement de colonnes assisté (fichiers inconnus)

Livré avec P64. Quand un CSV ne ressemble à **aucun** des formats ci-dessus, l'application ne
renonce plus : elle lit ses en-têtes et la forme de ses valeurs, propose un appariement de ses
colonnes vers les douze champs pivot, et l'utilisateur le **confirme ligne par ligne** avant tout
import (`src/lib/import/mapping/`). Le fichier rejoint ensuite le pipeline pivot inchangé, sous le
format `mapped-csv`.

**Cette voie fonctionne sans clé et sans réseau.** C'est celle que tout le monde a. Un modèle de
langage peut, en option, **combler ses trous** (voir `docs/ia-harnais.md`) ; il ne peut jamais
écraser un appariement que l'application a trouvé avec confiance, et sa proposition arrive toujours
« à confirmer ».

### Ce qui décide d'un appariement

| Règle         | Confiance | Ce qu'elle constate                                          |
| ------------- | --------- | ------------------------------------------------------------ |
| en-tête connu | 1,00      | l'en-tête est déjà un en-tête pivot (`Sent Amount`…)         |
| synonyme      | 0,90      | l'en-tête normalisé figure dans la table FR/EN               |
| distance      | 0,75      | Damerau-Levenshtein normalisée ≥ 0,85 (faute de frappe)      |
| forme         | 0,60      | la forme des valeurs convient, et cette colonne est la seule |

La normalisation va au-delà de la casse et des espaces : décomposition NFD et dépose des accents,
`_ - . /` ramenés à l'espace, **parenthèses extraites en jetons d'indice** (`Date (UTC)`,
`Contre-valeur (EUR)` — l'indice sert aussi de devise quand la colonne n'en a pas), et **dépliage
des collages** (`sentamount` → `sent amount`) par segmentation sur un vocabulaire fermé. La forme
des valeurs est inférée sur les cent premières lignes, en classes exclusives (`iso-datetime`,
`dmy-datetime`, `epoch-s`, `epoch-ms`, `decimal-dot`, `decimal-comma`, `signed-decimal`,
`asset-code`, `hash-hex`, `enum-small`, `free-text`, `empty`), une classe n'étant retenue qu'au-delà
de 90 % des cellules non vides.

Deux pénalités : ×0,4 si la forme contredit le champ, −0,15 par colonne concurrente. Au-delà de
0,80 l'appariement est pré-coché, entre 0,50 et 0,80 il est « à confirmer », en dessous il n'est pas
proposé. L'affectation est **gloutonne et stable** (un champ ↔ une colonne) : pour au plus une
trentaine de colonnes et douze champs, un couplage optimal (Hongrois) apporterait un gain
théorique et perdrait ce qui compte ici — un résultat qu'on peut suivre ligne à ligne.

Les **libellés de type** de la colonne retenue sont appariés par les trois mêmes règles vers les
quatre tables d'étiquettes du moteur (`REWARD_LABELS`, `FEE_LABELS`, `NEUTRAL_OUT_LABELS`,
`SPEND_LABELS`, `src/lib/import/pivot/events.ts`). Un libellé non traduit passe tel quel : le
moteur l'ignore, et la ligne suit son traitement par défaut.

### Rien n'est importé sans être vérifié

Avant tout import, l'appariement courant **rejoue le fichier entier à blanc** — le pipeline est pur,
rien n'est écrit — et sept contrôles s'enchaînent, dans l'ordre, avec arrêt au premier échec :
admissibilité (`date` + une paire complète), lignes retenues ≥ 90 % et anomalies ≤ 10 %, dates lues
≥ 99 % / montants 100 % / devises reconnues ≥ 95 %, invariant comptable sur tout actif, **aucune
position bloquée**, lignes non qualifiées ≤ 5 %, et l'écart de solde.

Le contrôle « aucune position bloquée » est le plus discriminant : une **survente** est la signature
d'un `envoyé`/`reçu` inversé, et c'est le seul cas où tout le reste passe — dates, montants et
devises sont parfaitement lisibles, seul le moteur s'aperçoit que le sens des opérations a été
retourné.

L'écart de solde n'est contrôlé **que si le fichier porte une colonne de solde**, et sur les seules
lignes à une jambe (une ligne à deux jambes touche deux actifs, et rien ne dit lequel la colonne
décrit). Sinon il est **déclaré inapplicable**, jamais réputé vert.

### Mémorisation, et annulation

L'appariement confirmé est **mémorisé sur le compte** de destination, sous l'empreinte de l'en-tête
qu'il décrit (`Account.columnMapping`, champ optionnel additif — aucune montée de
`SCHEMA_VERSION`, décision n° 66). L'export du mois suivant, s'il a le même en-tête, le retrouve
seul ; une plateforme qui ajoute, retire ou renomme une colonne repose la question — un appariement
rejoué sur des colonnes décalées produirait des montants faux en silence.

Et parce qu'une fonctionnalité qui _propose_ un appariement doit pouvoir défaire son erreur,
**« Annuler cet import »** retire, par identifiant d'import, les lignes que cet import a réellement
ajoutées (une ligne déjà connue garde l'identifiant de l'import qui l'a insérée la première) et
recalcule le portefeuille. Sans lui, un appariement confirmé à tort ne se corrigerait qu'en
supprimant le compte entier : le dédoublonnage par hachage du contenu natif (décision n° 26) ne
rattrape pas ce cas, les clés d'un mauvais appariement étant, elles, parfaitement valides.

### Limite de la v1 : le montant unique signé

L'appariement n'écrit que des **paires envoyé/reçu** (`two-legs`). Un fichier à **montant unique
signé** — une seule colonne de montant, négative pour une sortie, positive pour une entrée — est
**reconnu et refusé en le disant** (« ce fichier a une colonne de montant signée : cette forme
n'est pas encore prise en charge »), plutôt que par un « format non reconnu » qui n'apprendrait
rien. Cette forme est déjà traitée par les convertisseurs natifs des plateformes qui l'emploient
(Kraken, Bitvavo…) ; la reproduire ici doublerait le périmètre pour un gain marginal.

Autre limite assumée : une colonne de **texte libre** dont l'en-tête n'est reconnu par aucune règle
reste non appariée — sa forme ne dit rien, et deviner qu'elle est « la description » plutôt que
« le hachage » serait exactement l'invention que ce module s'interdit.

## Limites connues

- **XLSX Waltio** : Waltio lit le fichier Koinly (ci-dessus) mais publie séparément un gabarit
  générique propre en `.xlsx` [4] ; ce gabarit n'est pas lu par cet import (hors périmètre).
- **GBP et CHF** : reconnus comme fiat (une ligne 100 % GBP/CHF est ignorée comme les autres
  fiats) mais absents de la chaîne de taux BCE de l'app, qui ne convertit que EUR et USD (décision
  n° 18) — une jambe cash en GBP/CHF dans un échange part donc « à qualifier » plutôt que d'être
  convertie à un taux faux ou ignorée à tort. S'applique à toutes les sources de ce document (pivot,
  convertisseurs natifs, Ghostfolio), qui partagent le même normaliseur.
- **Trésorerie fiat** : aucune de ces sources ne modélise de solde fiat (dépôts/retraits EUR, USD,
  GBP, CHF purs sont ignorés, pas même mémorisés) ; seule une sortie explicitement étiquetée frais
  devient un événement à part entière.
- **Plateformes sans convertisseur dédié** (Binance, Bybit, OKX, la plupart des wallets…) : import
  via le format pivot Koinly/Waltio (ci-dessus), pas de module natif prévu sauf demande.

## Sources (consultées le 23/08/2026, complément le 24/08/2026)

- [1] Koinly, comment créer un CSV personnalisé (« Custom CSV Universal », dates en UTC) —
  https://support.koinly.io/en/articles/9489976-how-to-create-a-custom-csv-file-with-your-data
- [2] Koinly, les Tags (liste des étiquettes reconnues) —
  https://support.koinly.io/en/articles/9490023-what-are-tags
- [3] Koinly, traitement des virements entre ses propres wallets (fusion automatique interne à un
  compte Koinly : même actif, ≤ 12 h, retrait avant dépôt, écart ≤ ~20 % — critères propres à ce
  mécanisme, non repris tels quels ici, voir docs/DECISIONS.md n° 25) —
  https://support.koinly.io/en/articles/9490024-how-koinly-handles-transfers-between-your-own-wallets
  et mise à jour du 16/12/2024 (coût du virement réparti sur le lot plutôt qu'ajouté à part) —
  https://support.koinly.io/en/articles/10301657-2024-dec-16th-updates-to-transfer-handling
- [4] Waltio, fichier Koinly (confirme que Waltio lit ce format, et publie par ailleurs son propre
  gabarit XLSX) — https://help.waltio.com/en/articles/13368700-koinly-file
- Sondage du dépôt (23/08/2026) : `support.koinly.io` refuse la récupération automatisée directe
  (403) ; le contenu ci-dessus est corroboré par plusieurs recherches indépendantes recoupant les
  mêmes pages plutôt que par une lecture verbatim — à revérifier si un détail fin est mis en cause.
- [5] Kraken Support, exporter l'historique de compte (Ledgers) —
  https://support.kraken.com/articles/208267878-how-to-export-your-account-history
- [6] Coinbase, annonce de l'export de l'historique des transactions (rapports et relevés) —
  https://www.coinbase.com/blog/you-can-now-export-your-transaction-history
- [7] Bitvavo Help Center, consulter et télécharger l'historique des transactions —
  https://support.bitvavo.com/hc/en-us/articles/24858391166097-How-can-I-view-and-download-my-transaction-history-and-balance-statement
- [8] Ledger Support, exporter l'historique des opérations en CSV —
  https://support.ledger.com/article/360014094879-zd
- [9] Revolut Help, télécharger un relevé de compte crypto —
  https://help.revolut.com/help/profile-and-plan/managing-my-account/cryptocurrency-statement/
- [10] Dépôt GitHub `ghostfolio/ghostfolio`, branche `main` (structure de l'export JSON
  d'activités, lue le 24/08/2026) — https://github.com/ghostfolio/ghostfolio
- Les pages [5]-[9] documentent le parcours d'export au moment de la rédaction ; les libellés de
  menu de chaque plateforme évoluent régulièrement et peuvent différer de ce qui est décrit
  ci-dessus — l'en-tête du fichier reste le repère fiable (détection automatique par l'app).
