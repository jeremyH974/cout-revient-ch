# Import « format pivot » — format et sémantique (Koinly / Waltio, sourcé le 23/08/2026)

Au lieu d'un importeur natif par plateforme, l'app lit le format pivot que **Koinly** documente
publiquement pour tout import externe, et que **Waltio** lit aussi directement — un membre qui suit
déjà une autre plateforme (Kraken, Binance, Ledger…) dans l'un de ces outils récupère sa
consolidation multi-plateformes sans qu'aucune clé d'exchange n'entre jamais dans ce site
(docs/DECISIONS.md n° 24). Les lignes atterrissent dans un compte `kind: 'csv'` de l'espace
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

## Limites connues

- **JSON d'activités Ghostfolio** : hors périmètre v1 (l'app ne lit que les deux formats CSV
  ci-dessus).
- **XLSX Waltio** : Waltio lit le fichier Koinly (ci-dessus) mais publie séparément un gabarit
  générique propre en `.xlsx` [4] ; ce gabarit n'est pas lu par cet import (hors périmètre).
- **GBP et CHF** : reconnus comme fiat (une ligne 100 % GBP/CHF est ignorée comme les autres
  fiats) mais absents de la chaîne de taux BCE de l'app, qui ne convertit que EUR et USD (décision
  n° 18) — une jambe cash en GBP/CHF dans un échange part donc « à qualifier » plutôt que d'être
  convertie à un taux faux ou ignorée à tort.
- **Trésorerie fiat** : ce format ne modélise aucun solde fiat (dépôts/retraits EUR, USD, GBP, CHF
  purs sont ignorés, pas même mémorisés) ; seule une sortie explicitement étiquetée frais devient un
  événement à part entière.
- **Convertisseurs natifs par plateforme** (Kraken, Coinbase, Bitvavo, Revolut, Ledger Live…) : à la
  demande, hors périmètre v1 — l'utilisateur passe par l'export Koinly/Waltio de sa plateforme.

## Sources (consultées le 23/08/2026)

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
