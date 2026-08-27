# P8, P38, P7, P9 — plan d'exécution

> **Demande traitée.** Livrer quatre briques : **P8** (finitions), **P38** (courbe de valeur nette
> consolidée, reliquat de P31), **P7** (coût réel et spread implicite par opération) et **P9**
> (carte de partage). Pour chacune, un plan écrit _avant_ le code, décomposé en parties et
> sous-parties, chaque sous-partie portant son objectif, son état de l'art, ses décisions de
> conception, ses fichiers, ses tests et son critère de réussite vérifiable.
>
> **« État de l'art »** = ce que font les meilleurs en 2026, constaté et daté, jamais supposé.
> **« Prêt pour le futur »** = les briques suivantes déjà identifiées — **P36** (actif valorisé),
> **P37** (passif et valeur nette), **P40** (fiscal consolidé), **P41** (actions et ETF) — doivent
> s'y brancher **sans réécriture**. Les interfaces qu'elles exigent sont posées maintenant, même si
> leur implémentation reste vide.
>
> Rien n'est codé avant validation de ce plan.

Établi le 26/08/2026, sur `main` à `3557cca`. Les constats de code ci-dessous ont été vérifiés dans
le dépôt à cette date ; ceux qui ne l'ont pas été sont signalés `[À VÉRIFIER]`.

## Ordre retenu et charge

| Ordre | Brique  | Charge | Pourquoi ici                                                             |
| :---: | ------- | :----: | ------------------------------------------------------------------------ |
|   1   | **P8**  | 0,5 s. | Dont une **obligation contractuelle** (attribution). Coût quasi nul.     |
|   2   | **P38** | 1,5 s. | Réutilise tout l'existant et **débloque P36/P37**. Dette d'architecture. |
|   3   | **P7**  | 2,5 s. | Le vrai différenciateur, mais le plus lourd et le plus délicat.          |
|   4   | **P9**  | 1,5 s. | Recrute des utilisateurs : à faire quand le produit montre son mieux.    |

**P38 avant P7** : P38 pose les interfaces que P36/P37 attendent. Plus on tarde, plus la courbe
existante se fige sur un modèle « crypto seulement » qu'il faudra casser.

---

# P8 — Finitions

Trois sous-parties dont **une seule** est une vraie obligation. La troisième s'est réglée seule.

## P8.1 — Les huit logos manquants

**Constat vérifié** — 70 tickers dans `src/lib/pricing/tickers.ts`, 62 icônes déclarées dans
`src/lib/pricing/icons.ts`. Manquent exactement : `bonk`, `eurcv`, `floki`, `hype`, `ondo`, `sky`,
`usds`, `wif`. La liste coïncide avec celle de la feuille de route, écrite indépendamment.

**Décisions de conception**

- Source d'abord `@web3icons/core` (MIT), déjà à l'origine de 61 fichiers sur 62. Pour ce qu'il ne
  couvre pas : kit de marque officiel, **licence vérifiée et citée fichier par fichier** dans
  `public/icons/LICENSE.md`, comme le fait déjà `crv.svg`.
- Mêmes contraintes que l'existant : SVG même origine (CSP `img-src 'self'`), svgo 4, `viewBox`
  conservé, `width`/`height`/`class` retirés, variante « background » ramenée à un disque.
- Un logo dont la licence ne permet pas la redistribution **n'est pas embarqué** : `CoinBadge`
  retombe sur les initiales, et le ticker rejoint une liste `NO_ICON` motivée. On ne devine pas.

**Prêt pour le futur — le vrai correctif.** `KNOWN_ICONS` est aujourd'hui une **connaissance
dupliquée** : un `Set` écrit à la main qui doit refléter le contenu d'un dossier. Il dérivera. Le
plan ajoute un test qui compare `KNOWN_ICONS` au contenu réel de `public/icons/` **et** exige que
chaque entrée de `TICKERS` soit soit iconifiée, soit inscrite dans `NO_ICON` avec un motif. Ajouter
un ticker sans logo devient alors un échec de CI explicite, pas un carré d'initiales découvert par
hasard.

**Fichiers** — `public/icons/*.svg` (+8), `public/icons/LICENSE.md`, `src/lib/pricing/icons.ts`,
`src/lib/pricing/icons.test.ts` (nouveau).

**Réussite** — aucun ticker de `TICKERS` sans logo ni motif ; le test échoue si l'on ajoute un
ticker sans trancher la question.

## P8.2 — Attribution des sources de données

**Constat vérifié** — aucune mention « Powered by CoinGecko » dans l'interface. La seule occurrence
de `coingecko.com` (`src/routes/Settings.svelte:306`) parle de la clé API, pas de l'attribution.
Les CGU du plan gratuit l'exigent. `[À VÉRIFIER]` : relire le texte exact des CGU au jour de
l'implémentation et le citer dans le commit — elles bougent.

**Décision de conception — ne pas traiter le cas CoinGecko seul.** L'app interroge **douze
sources**. Poser un « Powered by CoinGecko » isolé règle une obligation et laisse les onze autres
sans crédit — dont **une autre obligation réelle**.

Recherche du 26/08/2026, sources primaires :

| Source              | Rôle                           | Devoir         | Ce qu'exige la source                                                                                                    |
| ------------------- | ------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **CoinGecko**       | Prix spot + historique 365 j   | **Obligation** | « Powered by CoinGecko », police lisible **≥ 10 pt**, affichage **proéminent** — API ToS § 4.3, en vigueur au 05/09/2025 |
| **Etherscan V2**    | EVM avec clé                   | **Obligation** | Lien retour **ou** « Powered by Etherscan.io APIs », **sauf usage strictement personnel**                                |
| **alternative.me**  | Indice Fear & Greed            | **Obligation** | Source visible à l'écran — **déjà traitée** (`FEAR_GREED_ATTRIBUTION`, décision n° 44)                                   |
| **DefiLlama**       | Prix spot + historique profond | Courtoisie     | API ouverte et libre ; la citation est « appréciée », non exigée                                                         |
| Coinbase (Exchange) | Prix spot + chandelles         | `[À VÉRIFIER]` | —                                                                                                                        |
| Kraken              | Prix spot + OHLC               | `[À VÉRIFIER]` | —                                                                                                                        |
| Hyperliquid         | Mids, fills, positions         | `[À VÉRIFIER]` | —                                                                                                                        |
| BCE via Frankfurter | Taux de change quotidiens      | `[À VÉRIFIER]` | Taux publiés à titre d'information ; aucune clause d'attribution trouvée                                                 |
| mempool.space       | Bitcoin (Esplora)              | Aucune trouvée | Projet AGPL-3.0 — la licence lie le _code_, pas l'appel à l'instance publique                                            |
| blockstream.info    | Bitcoin (secours)              | Aucune trouvée | —                                                                                                                        |
| Blockscout          | EVM sans clé                   | Aucune trouvée | Ne pas confondre avec le _Data API_ (`data-api.blockscout.ai`), aux conditions restrictives                              |
| Routescan           | EVM (secours)                  | `[À VÉRIFIER]` | —                                                                                                                        |

**Ce que ce tableau change** : l'obligation Etherscan était invisible jusqu'ici, et elle est
conditionnelle (« sauf usage personnel ») — or l'app est publique. Elle se serait découverte à la
première réclamation. La distinction **obligation / courtoisie / à vérifier** est portée dans le
code, pas seulement dans cette page : une source `[À VÉRIFIER]` s'affiche créditée mais sans
prétendre à une obligation qu'on n'a pas constatée.

**Ce qui est fait à la place** : une table **déclarative** `DATA_SOURCES` (nom, rôle, lien, licence
ou condition d'attribution, obligatoire oui/non), rendue à un seul endroit — un bloc « Sources et
attributions » dans Réglages — et résumée en pied de rapport et de PDF.

**Prêt pour le futur** : un test croise `DATA_SOURCES` avec les fournisseurs réellement déclarés
dans le code (`defaultHistoryProviders`, les fournisseurs spot, le module de change, les
explorateurs). **Brancher un onzième fournisseur sans écrire son attribution devient un échec de
CI.** C'est la seule forme d'attribution qui survit à trois ans de développement.

**Fichiers** — `src/lib/support/sources.ts` (nouveau), `src/components/settings/SourcesSection.svelte`
(nouveau), `src/routes/Settings.svelte`, `src/lib/export/report-model.ts`, `src/lib/export/pdf.ts`,
`docs/ARCHITECTURE.md`.

**Réussite** — chaque fournisseur interrogé est crédité, avec son lien ; le test le prouve ; axe
reste vert sur Réglages.

## P8.3 — Historique long EURCV et GMX — **déjà réglé, à prouver et à acter**

**Constat vérifié** — `gmx` porte l'identifiant CoinGecko `gmx`, donc bénéficie depuis la 2.5.1 de
l'historique profond DefiLlama. `eurcv` est dans `EUR_PEGGED` : il vaut 1 € par construction quand
aucun fournisseur ne le cote, ce qui est le comportement correct pour un stablecoin euro.

**Il n'y a rien à développer.** Le plan se limite à : un test qui verrouille les deux comportements
(série complète pour `gmx`, ancrage à 1 € pour `eurcv`), et la mise à jour de la feuille de route.
Le signaler évite de rouvrir le sujet dans six mois.

---

# P38 — Courbe de valeur nette consolidée

_« Le seul écran que tous ont et pas nous »_ — reliquat de P31, repris en P38 par l'étude de
consolidation patrimoniale.

## P38.0 — Le constat de la feuille de route est faux

La feuille de route reporte P38 au motif qu'il _« exige un historique de l'équité de trading
inexistant à ce jour »_. **Cet historique existe, et il est déjà utilisé.**

- Hyperliquid le sert par son point d'entrée `portfolio`, parsé par `parsePortfolio`
  (`api-types.ts:366`) en séries `[ms UTC, valeur]` pour les périodes `day`, `week`, `month`,
  `allTime` et leurs variantes `perp*`.
- Il est **récupéré à chaque synchronisation** (`sync.ts:184-187`), **rangé** dans
  `data.portfolio` (`data.ts:43`) et **survit à la sauvegarde** (`sanitize.ts:156`).
- Il est **déjà affiché** : l'écran Trading en trace la courbe, avec bascule équité / P&L et
  sélecteur 1J / 1S / 1M / Tout (`Trading.svelte:96-120`).

Le vrai obstacle est ailleurs, et il est de nature différente — c'est lui que ce plan doit traiter.

## P38.1 — Le vrai obstacle : deux séries de natures incompatibles

|                 | Côté Investissement                            | Côté Trading                                                                                                                                         |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origine         | **calculée** du grand livre + cours quotidiens | **servie** telle quelle par la plateforme                                                                                                            |
| Cadence         | strictement **quotidienne** (`DayString`)      | horodatages **irréguliers** (12:00, 00:00, …)                                                                                                        |
| Profondeur      | première opération du grand livre              | **ouverture du compte Hyperliquid**                                                                                                                  |
| Échantillonnage | un point par jour                              | **sous-échantillonné par la plateforme** — 41 points pour ~6 mois sur `allTime` (mesuré sur la fixture)                                              |
| Consolidation   | naturelle, tous actifs confondus               | **impossible telle quelle** : `Trading.svelte:92` ne trace la courbe que s'il n'y a **qu'un seul compte**, faute d'horodatages alignés entre comptes |

Additionner ces deux séries point à point est donc faux à trois titres : elles n'ont ni la même
cadence, ni la même profondeur, ni la même granularité.

## P38.2 — La décision de conception : rééchantillonner pour consolider, réconcilier pour prouver

**Ce qui est fait.** La contribution du trading est ramenée au **pas quotidien** par
`lastPointAtOrBefore` — la fonction existe déjà (`series.ts:86`, recherche dichotomique sur points
triés) et c'est exactement la convention maison : `valueSeries` fait déjà porter au dernier prix
connu, `fillGaps` fait déjà le report. Avant le premier point d'un compte, sa contribution vaut
**zéro** : le compte n'existait pas, ce n'est pas une valeur manquante.

**Ce qui n'est PAS fait, et c'est délibéré.** L'écran Trading **garde sa courbe exacte**, non
rééchantillonnée. Son commentaire dit pourquoi : _« l'écraser à un point par jour déforme les
épisodes violents »_. La courbe consolidée est **un autre objet, pour une autre question** —
« combien vaut l'ensemble de mon patrimoine, jour après jour » et non « qu'a fait mon compte de
trading cette semaine ». Les deux coexistent, et l'écart entre elles est assumé et écrit, pas
masqué.

**La preuve que le rééchantillonnage ne ment pas.** `compute.ts` réconcilie déjà
`accountValue ≈ Σ flux + Σ closedPnl − Σ frais + Σ funding + latent` et **expose l'écart**
(`{ expected, actual, gap }`). La courbe consolidée est donc vérifiable contre un calcul
indépendant, dérivé du grand livre et non de la plateforme. Un écart matériel se signale au lieu
de se fondre dans la courbe.

## P38.3 — Prêt pour le futur : la forme de la série

C'est ici que se joue la demande « prêt pour le futur ». La série est définie **dès maintenant**
comme

```
valeurNette(jour) = Σ contributions(jour) − Σ passifs(jour)
```

où une **contribution** est une interface générique — `{ id, label, valueAt(day), firstDay }` — et
où un actif crypto valorisé par son cours **n'est qu'un cas particulier**. Trois producteurs
existent au départ : les avoirs d'investissement (`valueSeries`), chaque compte de trading
(équité rééchantillonnée), et les avoirs on-chain. Le terme de passif est **constant à zéro**.

Conséquence concrète : **P36** (immobilier, AV, PER, objets, via `ValuationEvent`) et **P41**
(actions et ETF) s'y branchent en ajoutant un producteur ; **P37** remplit le terme de passif.
Aucun des trois ne demande de réécrire la courbe. Sans cette forme, chacun exigerait une refonte —
c'est la dette que P38 paie d'avance.

## P38.4 — Le rendu

**Décision : ne pas écrire un second graphique.** `EvolutionChart.svelte` (678 lignes) porte déjà
les marqueurs d'achat/vente, les lignes de niveau, trois modes de couleur, le mode masqué
(`fmtMasked`), la devise d'affichage et l'intraday. Un deuxième composant divergerait. On ajoute un
**mode** à l'existant, et `PeriodToggle` est réutilisé tel quel.

- Courbe principale = **valeur nette**. Courbe secondaire = **apports nets cumulés** (`ValuePoint`
  porte déjà `cost` du côté investissement ; `compute.ts` porte les flux du côté trading).
  L'écart entre les deux **est** le gain — c'est ce que montrent Finary et Ghostfolio, et c'est ce
  qui distingue cette courbe d'un solde de compte, où un virement ressemble à une performance.
- Un jour sans cours est **porté au coût et marqué `estimated`**, jamais retiré : `valueSeries`
  le fait déjà et remplit `missing`. Un trou se lit comme une chute — c'est le piège à éviter.
- Emplacement : **Vue d'ensemble**, au-dessus des cartes des deux espaces.

## P38.5 — Vérification

- **Le dernier point de la courbe égale au centime le total affiché par la Vue d'ensemble.**
  Contrôle dans `self-check.ts` et assertion dans `coherence.spec.ts`, qui recoupe déjà les écrans
  entre eux.
- **Réconciliation** : pour chaque compte de trading, l'équité rééchantillonnée du dernier jour
  concorde avec `compute.ts` à l'écart près déjà exposé par `reconcile`.
- **Propriété** (fast-check) : ajouter un dépôt déplace la courbe d'apports nets **exactement** du
  montant déposé et **laisse l'indice de performance inchangé** — la décision n° 41 rendue
  exécutable.
- **Cas limite à couvrir explicitement** : deux comptes de trading aux horodatages disjoints. C'est
  précisément ce que la plateforme ne sait pas consolider, et donc ce que ce module doit prouver.

# P7 — Coût réel et spread implicite par opération — **RÉTRACTÉ**

> **Ce plan est caduc, et sur un point il était faux.** La PR #16 a livré la mesure du spread le
> 26/08/2026 (décision n° 49) : elle compare le **prix déclaré par la plateforme**, celui de la
> colonne `Prix du marché` transportée par `TradeEvent.quotePrice`, à une **référence quotidienne
> indépendante**, en médiane et sur agrégat. C'est l'étage 2 ci-dessous.
>
> **L'étage 1 — comparer ce prix déclaré au prix effectivement obtenu — ne mesure rien.** L'import
> rapproche déjà les deux jambes dans `feeReconciliationWarning`
> (`src/lib/import/coinhouse/trade.ts:72`) : `|quantité contrepartie| ∓ (frais − remise)` contre
> `|contre-valeur de la jambe actif|`, avec avertissement au-delà de 0,05 unité ou 0,5 %. Mesuré sur
> la fixture, 100 paires : **27 % d'identité exacte, pire écart relatif 0,004228 %** — du bruit
> d'arrondi. Les deux nombres sont le même par construction de l'export.
>
> Le raisonnement qui manquait : **on ne détecte pas une marge en comparant le prix affiché par un
> vendeur à ce qu'il a facturé à ce prix affiché.** La marge est _à l'intérieur_ du `Prix du
marché` ; seule une référence indépendante peut la voir. C'est exactement ce que fait #16.
>
> **Ce qui resterait légitime** : non pas une nouvelle mesure, mais une **référence plus fine** pour
> celle de #16 — des chandelles à la minute, à la demande, opération par opération, qui
> supprimeraient le bruit intrajournalier à la source et donc le besoin de médiane et de seuils.
> Non prioritaire.
>
> La section ci-dessous est conservée telle qu'elle a été écrite, pour que l'erreur reste lisible.

La brique que personne ne fournit pour Coinhouse. C'est aussi celle où il est le plus facile
d'afficher un chiffre faux avec assurance.

## P7.0 — La découverte qui change le plan

La feuille de route prévoyait d'estimer le spread par des **chandelles Coinbase à la minute**. Ce
n'est pas nécessaire pour la mesure principale : **l'export porte déjà la colonne `Prix du marché`**
(`RawCoinhouseRow.marketPrice`), et `docs/coinhouse-export.md` en documente le sens exact —
exprimée **dans la devise de contrepartie** sur la jambe actif, et valant **taux EUR de la
contrepartie** sur la jambe contrepartie (1 pour `eur`, ≈ 0,85–0,89 pour `usdc`).

Autrement dit : **le prix de référence déclaré et le taux de conversion sont tous deux dans le
fichier.** La mesure principale est calculable hors ligne, sans aucune requête, sur tout
l'historique. Le réseau ne sert plus qu'au contrôle de P7.2.

## P7.1 — Le socle : coût effectif par opération (moteur pur)

Pour chaque opération, trois grandeurs :

- **`prixEffectif`** = contre-valeur EUR de la **jambe contrepartie**, corrigée des frais
  explicites, divisée par la quantité d'actif. La correction des frais est indispensable : sans
  elle, le spread avalerait la commission et la compterait deux fois.
- **`prixRéférence`** = `Prix du marché` de la jambe actif, converti en euros par le `Prix du
marché` de la jambe contrepartie quand celle-ci est `usdc`.
- **`spread`** = `(prixEffectif − prixRéférence) / prixRéférence`, **signé de sorte qu'un nombre
  positif soit toujours défavorable** — payé au-dessus à l'achat, encaissé en dessous à la vente.
  Un signe qui change de sens selon le sens de l'opération est un piège de lecture.

**Discipline décimale** : `Big` de bout en bout, `DecimalString` en frontière, précision de division
posée explicitement (`Big.strict`), arrondi nulle part ailleurs que dans `src/lib/format/`.

**Ce qui rend `null`, sans jamais deviner** : `Prix du marché` absent, quantité nulle, contrepartie
ni `eur` ni `usdc`, ligne à qualifier. Un `null` s'affiche « non calculable » et **n'entre dans
aucun total**.

**Fichiers** — `src/lib/domain/spread.ts` (nouveau), son test colocalisé,
`src/lib/domain/fees.ts` (extension des agrégats).

## P7.2 — Le contrôle indépendant, et l'honnêteté sur la granularité

`Prix du marché` est **déclaré par Coinhouse**. Le prendre pour argent comptant, c'est mesurer
l'écart d'un vendeur à son propre prix affiché. Le contrôle indépendant compare ce prix déclaré à
**notre propre historique** (Coinbase, Kraken, CoinGecko, DefiLlama).

**Le point délicat, traité de front.** Notre historique est **quotidien** ; l'opération porte un
horodatage à la seconde. Comparer un prix d'exécution de 14 h 32 à un cours de clôture et appeler
la différence « spread » serait faux.

- **Sans donnée intrajournalière** : afficher la **fourchette [bas, haut] du jour**, et si le prix
  effectif tombe **dedans**, écrire « conforme au marché du jour » et **ne revendiquer aucun
  spread**. Un intervalle honnête vaut mieux qu'un point précis et faux.
- **Avec donnée intrajournalière** : chandelles Coinbase Exchange `granularity=60`, paginables sur
  tout l'historique. **À la demande, opération par opération** (depuis la fiche actif), jamais en
  balayage global : une requête par opération épuiserait les quotas et n'apporterait rien sur
  99 % des lignes. Résultat mis en cache.
- L'écran distingue toujours **trois choses** : la commission (connue), le spread contre le prix
  déclaré (calculé), l'écart du prix déclaré au marché indépendant (contrôle). Les confondre serait
  reproduire l'opacité qu'on prétend mesurer.

**Cadre.** L'obligation d'exécution aux meilleures conditions pesant sur les prestataires de
services sur crypto-actifs (règlement MiCA) est exactement la question posée. On la cite dans la
doc comme cadre, **jamais dans l'interface** : l'app **constate**, elle n'accuse pas et ne conseille
pas — frontière information/conseil déjà tenue par le moteur de constats (décision n° 40).

## P7.3 — Agrégation et présentation

- Par année et sur 12 mois glissants : commissions nettes de remise, spread estimé, **coût total**,
  et sa **part du volume**. La section « Abonnement Coinhouse » du rapport existe déjà et accueille
  ces lignes.
- Sur la fiche actif : le coût réel ligne à ligne, avec le détail au survol.
- **Étiqueté « estimation » partout où un chiffre apparaît**, comme l'estimation fiscale.
- Deux ou trois constats nouveaux dans le moteur d'`insights` — règles pures et codées, le français
  n'étant qu'un rendu.

## P7.4 — Vérification

- **Oracle indépendant** : `tests/integration/independent-oracle.test.ts` recalcule les coûts from
  scratch et concorde à 1e-9 près, sur la fixture **et** sur l'export réel local.
- **Propriété** : une opération synthétique construite exactement au prix du marché a un spread de
  **zéro** — pas « proche de zéro ».
- **Invariant** : Σ(coût total) ne dépasse jamais Σ(volume), et chaque `null` est exclu des totaux
  plutôt que traité comme zéro. C'est l'erreur classique, et elle est silencieuse.
- Le jeu de démonstration reste **100 % synthétique** (décision n° 17) : la vérification sur données
  réelles reste locale et optionnelle (`it.skipIf`).

---

# P9 — Carte de partage

Dernière brique du plan. P7 est désormais couvert par la PR #16 ; P9 est le seul levier d'adoption
qui reste non tiré.

## P9.0 — Ce qui existe déjà et qu'il ne faut PAS réécrire

Trois briques sont en place, vérifiées dans le dépôt le 26/08/2026 :

- **`canShareFiles()` et `shareTextFile()`** (`src/lib/export/download.ts`) : la détection Web Share
  avec fichiers et le repli téléchargement existent, écrits pour la sauvegarde JSON. `shareTextFile`
  prend une **chaîne** ; il faut le généraliser au `Blob`, car un PNG est binaire. Un `AbortError`
  y est déjà traité comme une annulation et non comme une panne.
- **Le résumé anonymisé de P27** (`TradeStats.svelte:44-70`) : ratios, R et compteurs, jamais un
  montant ni une adresse. Il est aujourd'hui **enfermé dans un composant d'écran** ; P9 le remonte
  dans un module pur et le réutilise au lieu de le dupliquer.
- **L'image Open Graph du site est déjà en 1200 × 630** (`index.html:25-27`). La carte adopte la
  même dimension : c'est le format d'aperçu attendu par Discord, et cela évite deux géométries
  concurrentes dans le même dépôt.

## P9.1 — Le modèle : une promesse tenue par une propriété, pas par une relecture

`shareCardModel(...)` rend une structure **pure** : période, performance en **pourcentage**, trois
premiers actifs par **poids relatif**, nombre de lignes, rendement personnel, repère. Aucun rendu,
aucun DOM, donc entièrement testable sans navigateur.

**Vie privée par défaut, et par construction.** Des pourcentages, jamais de montants. Les montants
n'apparaissent que sur bascule explicite, **non mémorisée** — un réglage qui se souvient finit par
publier ce qu'on ne voulait publier qu'une fois. Jamais de quantité, jamais d'adresse, jamais de
date d'opération.

**Ce qui rend la promesse vérifiable** : une propriété fast-check tire des portefeuilles aléatoires
et vérifie qu'**aucun nombre du modèle en mode par défaut ne peut être un montant** — quelles que
soient les données d'entrée. C'est ce qui distingue une promesse d'une intention : une relecture
attentive ne prouve rien sur les données qu'elle n'a pas vues.

**Fichiers** — `src/lib/export/share-card.ts` (nouveau, pur), son test colocalisé ;
`TradeStats.svelte` allégé de son résumé, qui migre dans ce module.

## P9.2 — Le rendu : canvas, et pourquoi pas SVG

**Canvas 2D à 1200 × 630**, exporté par `canvas.toBlob('image/png')`.

**Pourquoi pas un SVG converti en image** : `foreignObject` teinte le canvas sur plusieurs moteurs
(la conversion échoue alors silencieusement), et les polices ne suivent pas la sérialisation. Du
`fillText` explicite est mesurable, déterministe, et ne dépend d'aucune police distante — ce qui
compte doublement ici, entre la CSP du site et le fonctionnement hors ligne.

**Thème sombre par défaut**, bascule claire disponible : Discord est majoritairement sombre, une
carte claire y brûle les yeux et se repère comme une pièce rapportée.

**Testabilité du rendu.** La **géométrie est une fonction pure** (positions, tailles, retours à la
ligne) testée séparément du dessin ; le dessin lui-même est verrouillé par une capture Playwright.
Tester des pixels de canvas en unitaire serait fragile pour ce que ça prouve.

## P9.3 — La distribution, du plus intégré au plus universel

1. `navigator.share({ files })` derrière `navigator.canShare({ files })` — partage natif. C'est le
   seul chemin en trois gestes depuis un téléphone, et le seul qui atteigne l'application Discord
   installée. `canShare` est appelable **sans geste utilisateur**, donc le bouton sait avant d'être
   cliqué s'il doit proposer « Partager » ou « Télécharger ».
2. **« Copier l'image »** via `ClipboardItem` là où c'est supporté : sur ordinateur, coller dans
   Discord bat télécharger puis glisser.
3. **Téléchargement du PNG** partout ailleurs (Firefox notamment, qui n'a pas le niveau 2).
4. **« Copier un résumé texte »** partout, sans exception.

**Accessibilité — le point qui décide de la conception, pas une finition.** Une image seule est
illisible pour un lecteur d'écran, et un `alt` de dix mots ne remplace pas des chiffres. Le résumé
texte **est** l'équivalent accessible de la carte, pas une commodité : il porte les mêmes nombres,
dans le même ordre. La carte affichée à l'écran reçoit un `alt` qui les énonce. axe (WCAG 2.2 AA)
doit rester vert sur les 26 parcours — une violation est un échec de CI, on corrige le balisage.

## P9.4 — Prêt pour le futur

- **Le modèle ne connaît pas le canvas.** Une carte carrée pour un autre réseau, ou une variante
  claire pour l'impression, se branche en ajoutant une géométrie ; le modèle et la distribution ne
  bougent pas.
- **La distribution ne connaît pas la carte.** `shareBlobFile(filename, blob, type)` généralise
  `shareTextFile` et servira à tout fichier binaire ultérieur — un PDF, un export d'image de
  rapport.
- **Le résumé texte est le même objet que celui de P27** : une évolution des statistiques se
  répercute d'elle-même dans la carte.

## P9.5 — Vérification

- Propriété : aucun montant ne peut sortir du modèle en mode par défaut, sur des portefeuilles
  tirés au hasard.
- La géométrie place tout le texte **dans** le cadre, y compris avec un libellé d'actif long et un
  pourcentage à quatre chiffres (le débordement silencieux est le défaut classique d'une carte
  générée).
- E2E : le bouton produit un blob PNG non vide de 1200 × 630 ; le repli téléchargement s'active
  quand `canShare` répond faux (stubé).
- axe vert sur les 26 parcours, résumé texte présent et concordant avec l'image.
- Aucun appel réseau : le rendu est local, comme tout le reste de l'application.

---

# Décision n° 52 — les alertes de sécurité de `@lhci/cli`

À écrire dans la même PR, une quinzaine de lignes, pour qu'aucune session ne réenquête.

**Ce qu'elle doit contenir** : les quatre alertes viennent d'un seul paquet, `@lhci/cli@0.15.1`, qui
est **la dernière version publiée** (`latest` et `next`) — aucune montée de version ne les corrige,
et `extract-zip` n'a **aucun correctif publié** (`first_patched_version: null`).
`npm audit --omit=dev` rend **zéro** : rien n'atteint le bundle servi.

**Trois des quatre sont inatteignables**, constaté en lisant le code et non supposé : `tmp` n'est
appelé que par `lhci open` — commande jamais lancée, `package.json` et `ci.yml` n'invoquant que
`autorun` — et avec un `postfix` **littéral** ; `uuid.v4()` est appelé **sans `buf`**, or l'avis ne
mord que « when buf is provided » ; `extract-zip` n'est atteint que depuis le **téléchargement** d'un
navigateur par `@puppeteer/browsers`, or seul `puppeteer-core` est installé et il n'en télécharge
jamais.

**Ce qu'on ne fait pas, et pourquoi.** Pas d'`overrides` npm : `uuid` 8 → 11 et `tmp` 0.0.33 → 0.2.6
traversent des ruptures d'API que `@lhci/cli` n'a jamais testées, et `extract-zip` n'a aucune cible
vers laquelle pointer — on casserait Lighthouse CI pour corriger du code qui ne s'exécute pas. Pas
de bascule vers l'action GitHub `lighthouse-ci-action` non plus : elle embarque la même chaîne, hors
du `package-lock.json`. L'alerte disparaîtrait, le code resterait — moins de visibilité pour le même
risque.

**Le déclencheur** : prendre la prochaine `@lhci/cli` au-dessus de 0.15.1 dès sa publication.

# Ce que ce plan n'inclut pas

- **Le passif (P37) et l'actif valorisé (P36)** : seules leurs _interfaces_ sont posées en P38.1.
  Leur implémentation est une décision séparée.
- **Les chandelles à la minute en balayage global** (P7.2) : à la demande uniquement.
- **Toute recommandation d'achat, de vente ou d'arbitrage**, dans les quatre briques.
- **Une clé d'API d'exchange**, dans les quatre briques.

# Décisions à consigner

État au 26/08/2026, après les fusions des PR #13, #15 et #16 :

1. **n° 47 — livrée** (PR #15). Le catalogue de sources est déclaratif et vérifié par un test ;
   ajouter un fournisseur sans l'attribuer échoue en CI.
2. **n° 49 — livrée par la PR #16**, et non par ce plan. Le spread s'estime en médiane, sur agrégat,
   contre une référence indépendante — voir la rétractation en tête de la section P7.
3. **n° 51 — livrée** (PR #18). La valeur nette est `Σ contributions − Σ passifs` dès l'origine ;
   le trading entre par son equity rééchantillonnée au jour, jamais par son notionnel.
4. **n° 52 — à écrire.** Les alertes `@lhci/cli` : ce qu'on ne fait pas, pourquoi, et le déclencheur.
5. **n° 53 — à écrire avec P9.** La carte de partage ne peut pas émettre de montant en mode par
   défaut, et cette impossibilité est prouvée par une propriété, pas par une relecture.
