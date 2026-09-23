# Tests de mutation — mesurer ce qui vérifie, pas ce qui s'exécute

La règle maison de la **contre-épreuve** (décision n° 75) dit qu'un test vert ne prouve rien tant
qu'on ne l'a pas vu rougir : on fausse la chose qu'il surveille, on vérifie qu'il échoue en la
nommant, puis on restaure. C'est une discipline manuelle, appliquée à ce qu'on **pense** à éprouver.

Le test de mutation est la même idée, mécanisée et exhaustive : l'outil altère le code lui-même —
un `>` devient `>=`, une chaîne devient `""`, une condition devient `true` — puis relance les tests.
Un mutant **tué** signifie qu'un test a rougi. Un mutant **survivant** signifie que le code a changé
de comportement **sans qu'aucun test ne s'en aperçoive** : la ligne était exécutée, elle n'était pas
vérifiée.

C'est exactement la classe de défaut qui a coûté le plus cher ici — les décisions n° 130, 135, 136,
137 et 140 sont toutes des **chiffres silencieusement faux** : aucune exception, aucun total qui
détonne, simplement un mauvais nombre affiché calmement.

## Ce que ça a trouvé le premier jour (13/09/2026)

**`src/lib/derive` tenait un seuil de couverture de 95 % avec 11,6 % de mutants survivants.** Trois
manques réels, tous corrigés dans la foulée :

- `qualified.ts` — remplacer le rattachement de repli `` `ch:${r.key}` === eventId `` par `true` ne
  faisait rougir personne : aucun test n'avait de ligne **sans identifiant dont la clé ne
  correspond pas**. Le filtre était exécuté ; sa capacité à écarter ne l'était jamais.
- `accounts.ts` — **neuf** mutants de chaîne survivaient : remplacer `'coinhouse'`, `'Coinhouse'` ou
  `'invest'` par `""` ne cassait rien, les tests ne regardant que les identifiants. Ces valeurs
  atterrissent pourtant dans les sélecteurs de compte.
- `qualified.ts` encore — la branche « numéro de ligne nul » était gardée côté Coinhouse et pas côté
  pivot. Un chemin sur deux, et rien ne le disait.

`derive/` est passé de **88,39 % à 100 %** (112 mutants, zéro survivant).

**Et l'outil a attrapé un trou dans du code écrit une heure plus tôt** : `tax-boxes.ts`, le registre
canonique des cases, sortait à **63 %**. Ses cinq entrées propres — `2086`, `3AN`, `3BN`, `3CN`,
`3916-bis` — n'ont aucun équivalent dans les registres locaux, donc le test d'adossement ne les
regardait jamais. Ce sont des codes que l'utilisateur recopiera dans sa déclaration. Après
correction : **87,5 %**.

### Le relevé de départ

| Périmètre                      |       Score | Survivants |
| ------------------------------ | ----------: | ---------: |
| **Ensemble muté**              | **79,98 %** |        172 |
| `derive/` (4 fichiers)         |       100 % |          0 |
| `domain/tax-boxes.ts`          |      87,5 % |         23 |
| `domain/equity-income-fr.ts`   |      80,5 % |         31 |
| `domain/lending/tax-fr.ts`     |      78,8 % |         31 |
| `domain/interest-income-fr.ts` |      79,0 % |          8 |
| `domain/equity-tax-fr.ts`      |      77,7 % |         19 |
| `domain/declarations-fr.ts`    |      75,4 % |         17 |
| `domain/tax-fr.ts`             |      70,7 % |         43 |

Les 172 survivants restants sont un **arriéré**, pas une urgence : chacun est une assertion
manquante à écrire quand on retouche le module concerné. _(Cet arriéré a été traité le 15/09/2026 —
voir plus bas.)_

### Le relevé du 13/09/2026, après l'écran de déclaration

| Périmètre                      |       Score | Survivants |
| ------------------------------ | ----------: | ---------: |
| **Ensemble muté**              | **84,79 %** |        179 |
| `derive/` (5 fichiers)         |     96,15 % |         19 |
| `derive/tax-return.ts`         |     95,09 % |         19 |
| `domain/tax-boxes.ts`          |     94,24 % |         11 |
| `domain/equity-income-fr.ts`   |     80,50 % |         31 |
| `domain/lending/tax-fr.ts`     |     78,81 % |         31 |
| `domain/interest-income-fr.ts` |     78,95 % |          8 |
| `domain/equity-tax-fr.ts`      |     77,65 % |         19 |
| `domain/declarations-fr.ts`    |     75,41 % |         17 |
| `domain/tax-fr.ts`             |     70,65 % |         43 |

`tax-return.ts` est né à **80,68 %** avec 74 survivants, dans un dossier qui tenait 100 %. Les tuer
a demandé trois choses, dans cet ordre d'importance :

1. **Vérifier les mots, pas seulement les nombres.** Trente et un mutants remplaçaient un libellé
   de terme ou une phrase de réserve par `""`. Ce sont les mots que l'utilisateur lit **sous** un
   montant qu'il recopie : ils se vérifient un par un, en entier.
2. **Vérifier les absences.** Chaque famille a une garde `année introuvable **ou** rien cette
année-là` ; seul le premier membre était éprouvé. Une année sans cession, sans dividende, sans
   versement d'intérêts est un cas courant, et c'était un angle mort.
3. **Vérifier que l'année demandée est bien celle qui ressort.** Quatre `find` rendaient la bonne
   année par accident : les registres de test n'en contenaient qu'une. C'est exactement le défaut
   de la décision n° 141, à l'échelle d'un moteur — des montants justes, pour la mauvaise année.

### Les 19 survivants restants, et pourquoi ils restent

Ce sont des **mutants équivalents** : la mutation ne peut pas changer le résultat. Écrit ici pour
ne pas les re-instruire à chaque relevé.

- **`return { contributions: [] }` → `["Stryker was here"]`** (9). Une contribution sans `boxCode`
  ne correspond à aucune case : la liste sort identique. Un retour anticipé vide est indistinguable
  d'un retour anticipé de déchets.
- **La garde de type `contributed`** et le `mine.filter(contributed)` qui l'utilise (2). Seules les
  lignes `kind: 'box'` l'atteignent, et leurs contributions portent toutes un montant. C'est une
  ceinture qui ne sert que si un futur appelant marque une case à montant.
- **`if (range === null) return null`** dans `carryBoxCode` (1). `taxBox('2TU')` ne rend jamais
  `null` — un test du registre canonique l'exige déjà.
- **La déduplication de famille dans `merge`** (2). Aucun moteur n'alimente aujourd'hui une même
  case depuis deux familles : la branche existe pour le jour où cela arrivera.
- **Cinq libellés** que seule une combinaison non atteignable distinguerait.

La règle appliquée : on écrit une assertion quand elle décrit ce que l'utilisateur verrait
changer. On ne tord pas le code pour faire tomber un mutant qui ne change rien.

### Le relevé du 13/09/2026, après l'arbitrage forfait / barème

| Périmètre                 |       Score | Survivants |
| ------------------------- | ----------: | ---------: |
| **Ensemble muté**         | **86,47 %** |        175 |
| `derive/` (6 fichiers)    |     96,81 % |         19 |
| `derive/pfu-vs-bareme.ts` |       100 % |          0 |
| `domain/income-tax-fr.ts` |       100 % |          0 |
| `domain/tax-boxes.ts`     |     96,39 % |          7 |

Les deux modules nés avec P108 sont à **100 %** dès leur première mesure — non par chance, mais
parce que le relevé précédent avait déjà nommé les trois familles de manques (les mots, les
absences, l'année). Les connaître évite de les refaire.

**Un troisième piège, pour la deuxième fois** : `CSG_DEDUCTIBLE_SOURCE_ID` survivait à sa mise à
`""` parce que le croisement avec la veille écarte les identifiants vides **avant** de chercher. Un
filtre `Boolean(id)` rend muet exactement le cas qu'on veut attraper : le chiffre qui perd sa
source. La parade est une assertion nominative à côté du croisement.

## Le relevé du 15/09/2026 : l'arriéré traité (décision n° 153)

Les 175 survivants laissés en arriéré ont été repris moteur par moteur.

| Périmètre                      |         Avant |                                 Après |
| ------------------------------ | ------------: | ------------------------------------: |
| **Ensemble muté**              | 86,47 % — 233 |                      **96,51 % — 60** |
| `domain/tax-fr.ts`             |  71,04 % — 86 |                      **96,53 % — 10** |
| `domain/declarations-fr.ts`    |  75,41 % — 30 |                       **95,28 % — 6** |
| `domain/equity-tax-fr.ts`      |  77,65 % — 19 |                       **94,12 % — 5** |
| `domain/lending/tax-fr.ts`     |  78,81 % — 32 |                      **90,73 % — 14** |
| `domain/interest-income-fr.ts` |   78,95 % — 8 |                       **97,37 % — 1** |
| `domain/equity-income-fr.ts`   |  80,50 % — 31 |                       **98,11 % — 3** |
| `domain/tax-boxes.ts`          |   96,39 % — 7 |                       **99,48 % — 1** |
| `derive/tax-return.ts`         |  95,05 % — 20 | 95,05 % — 20 (équivalents, ci-dessus) |

### La distinction que le score global écrasait

Les 233 mutants non tués n'étaient pas de même nature : **175 étaient exécutés sans être vérifiés,
58 n'étaient jamais atteints**. `tax-fr.ts` en portait 43 à lui seul — c'est-à-dire qu'aucun test de
ce moteur ne l'avait jamais fait traverser par une récompense, un dépôt, un retrait ni un solde
d'ouverture. Les trois compteurs que le rapport affiche en réserve (« le prix d'acquisition est
sous-estimé ») n'étaient donc vérifiés par rien. Un `NoCoverage` est un pan de code que personne
n'appelle : un trou plus large qu'un survivant, et souvent plus vite comblé.

### Cinq familles, les mêmes dans les sept moteurs

Aux trois de septembre (**les mots**, **les absences**, **la bonne année**) s'en ajoutent deux, et
ces cinq-là suffisent à expliquer la quasi-totalité de l'arriéré :

4. **Les tris ne sont éprouvés par rien.** Retirer un `.sort(...)` survivait dans **six** modules.
   Un ordre est pourtant ce que l'utilisateur lit : s'il dépend de l'ordre d'arrivée des lignes d'un
   relevé, il change d'un import à l'autre. Pire pour `tax-fr.ts`, dont l'en-tête promet d'accepter
   un grand livre « dans n'importe quel ordre » alors que le prix total d'acquisition se consomme
   cession après cession : un rejeu désordonné donne d'autres chiffres, et rien ne le disait.
5. **Les drapeaux d'état ne sont affirmés que dans un sens.** `hasLosses`, `hasUndesignated`,
   `hasWithholding` : leur valeur initiale pouvait être inversée sans qu'aucun test ne rougisse.
   Ils commandent l'affichage de réserves entières — un drapeau bloqué montre ou cache un
   avertissement, sans qu'un seul montant ne bouge.

### Ce que la mesure a corrigé dans le moteur

Deux vrais défauts, trouvés en cherchant des assertions manquantes :

- **`declarations-fr.ts` ne redimensionnait pas le solde d'un fractionnement.** Le commentaire du
  module disait lui-même que « le hasard a tenu lieu de garde-fou ». Il ne tenait plus : un relevé
  rapporte les mouvements **suivants** en quantités post-fractionnement — c'est pour cela que
  `engine/position.ts` redimensionne ses lots —, si bien qu'un retrait intégral laissait ici un
  solde **négatif**, et `holdsAny` ne regarde que la nullité. Le compte paraissait ouvert le jour
  même où il était soldé. Corrigé en miroir de `position.ts`.
- **`tax-fr.ts` portait un compteur mort.** `if (event.kind === 'deposit' …) externalInflows++`
  était posé dans la branche `acquisition`, que `taxKindOf` ne rend jamais pour un dépôt : une copie
  littérale de la branche voisine, dans un chemin qu'aucun dépôt n'atteint. Sept mutants y vivaient
  à l'abri. Retiré.

### Les 60 qui restent, et pourquoi ils restent

Tous vérifiés **empiriquement** — mutation appliquée, suite relancée, aucun test rouge — et non pas
supposés. On n'écrit pas d'assertion pour un mutant qui ne change rien, et on ne tord pas le code
pour le faire tomber.

- **Du code défensif structurellement inatteignable** (24). Dans `lending/tax-fr.ts`, le second
  calcul de la première année (lignes 251-255) ne peut jamais trouver plus petit que le premier, qui
  balaie déjà **tous** les événements. Dans `lending/` et `equity-tax-fr.ts`, `cohorts.sort(...)`
  trie un tableau que la boucle annuelle remplit déjà par années croissantes, et le `break` qui suit
  n'économise qu'un tour : une fois la place à zéro, `min(reste, 0) = 0` rend chaque itération
  neutre. Ces gardes restent — elles coûtent un mutant, pas un risque.
- **Des comparateurs de tri dont seul le signe compte** (9). `Array.prototype.sort` ne consulte que
  la **branche négative** du comparateur : `a.at > b.at ? 1 : 0` peut valoir `true`, `false`, `>=`
  ou `<=` sans que la permutation change. La branche `a.at < b.at`, elle, est bien éprouvée — c'est
  la seule qui décide.
- **Un premier membre de garde impliqué par le second** (5). Sur
  `if (event.kind !== 'income' || event.nature !== 'interest')`, remplacer le premier membre par
  `false` ne change rien : un événement d'un autre genre ne porte pas de `nature`, donc le second
  membre l'écarte déjà. Le premier membre sert au **compilateur**, pas à l'exécution.
- **Les 20 de `tax-return.ts`**, inchangés et déjà instruits plus haut.
- **Un artefact de l'outil** (1) : voir le piège n° 5.

## Comment on s'en sert

```bash
npm run mutation                                   # le relevé, environ 3 minutes
npm run mutation:survivants                        # le score par fichier
npm run mutation:survivants domain/tax-fr.ts       # ce qui reste à vérifier dans un module
```

Le rapport HTML sort dans `reports/mutation/index.html` (dossier ignoré par git) : 1,3 Mo, bon pour
flâner, inutilisable pour travailler. **C'est `mutation:survivants` qui sert** : il lit le rapport
JSON du même relevé et rend, pour chaque mutant non tué, le **fragment exact** qu'il remplace — pas
la ligne. La nuance n'est pas cosmétique : une ligne porte souvent plusieurs mutants distincts, et
lue entière, la mutation d'un seul membre de garde ressemble à un trou béant. Cette confusion a
coûté une demi-heure et une fausse piste donnée à un agent, le 15/09/2026.

Un mutant non tué se lit comme une question : _quel test aurait dû rougir ici ?_ La réponse est
presque toujours une **assertion** manquante, pas un test manquant.

`thresholds.break` vaut **96**, posé **sous** le score mesuré : il a été resserré de 94 à 96 le
20/09/2026, quand l'ensemble est passé de 96,51 % à 97,03 % (décision n° 173). C'est un cliquet
contre la régression, jamais une cible. Un score qu'on atteint en écrivant des tests pour le chiffre
ne vaut rien.

## Cinq pièges, tous vécus

1. **Le fichier incrémental rejoue des résultats périmés.** `reports/stryker-incremental.json`
   conserve le verdict de fichiers **sortis du périmètre** : on croit mesurer, on relit un cache.
   Symptôme : deux exécutions de suite rendent exactement les mêmes chiffres alors que le périmètre
   a changé. Remède : supprimer le fichier, ou `--force`.
2. **`EPERM (rename)` sous Windows.** Stryker relie `node_modules` à son bac à sable au lieu de le
   copier ; le cache de pré-bundling de Vite y étant logé par défaut, deux processus écrivaient le
   même dossier et Windows refusait le renommage final. Réglé en sortant ce cache de
   `node_modules` — `cacheDir: '.vite'` dans `vite.config.ts`. L'erreur n'accusait ni le code ni les
   tests, ce qui est le pire des symptômes.

3. **Le bac à sable recopie ce qu'il ne devrait pas** (13/09/2026). `.vite` — le cache de Vite
   sorti de `node_modules` au piège n° 2 — se retrouvait copié **dans** le bac à sable, où deux
   exécutions qui se chevauchent se disputent le même renommage : `EPERM (rename)` de nouveau, sur
   un chemin qui n'accuse ni le code ni les tests. Réglé par `ignorePatterns` dans
   `stryker.config.json`. **Ancrez les motifs avec `/`** : un `dist` nu exclut aussi `mcp/dist`,
   dont un test a besoin, et la course initiale échoue alors sur « mcp/dist/server.js est
   introuvable » — un message qui envoie chercher très loin de la cause.

4. **Dix ouvriers, et deux morts d'affilée** (15/09/2026). Stryker prend la **moitié des cœurs** par
   défaut : dix ici, chacun démarrant son Vitest. Sur une machine de 16 Go dont 1,8 libre, deux
   courses de suite sont mortes — `EPERM (rename)` de nouveau, puis
   `Fatal process out of memory`. Deux symptômes, une cause : trop d'ouvriers. Le piège n° 2 avait
   réglé la collision **entre** exécutions, pas celle qui se joue **au sein** d'une même : un seul
   bac à sable, mais plusieurs processus qui y pré-bundlent ensemble dans le même `.vite` vide.
   Réglé des deux côtés — `concurrency: 4` dans `stryker.config.json`, et un cache **par processus**
   dans le bac à sable (`vite.config.ts`). La course passe de 2 à 3 minutes : le prix d'un relevé
   qui aboutit.

   **Le corollaire est plus dangereux que la panne.** Une course qui meurt laisse le rapport
   précédent en place, et la commande de lecture rend alors des chiffres **au mot près identiques** :
   on croit n'avoir rien gagné alors qu'on n'a rien mesuré. C'est arrivé, et seule l'égalité parfaite
   avec le relevé de la veille a mis la puce à l'oreille. `mutation:survivants` date donc toujours
   son relevé, et crie si `src/` a changé depuis. **Vérifiez le code de retour de `npm run mutation`,
   jamais la seule présence d'un rapport.**

5. **Un mutant qui casse le chargement du module est compté « survivant »** (15/09/2026). Muter
   l'arrière de `TAX_BOXES.map((box) => [box.code, box])` en `() => undefined` fait échouer
   l'évaluation du module entier : **zéro test ne démarre**, donc zéro test n'échoue, et Stryker le
   classe survivant par défaut (`testsCompleted: 0` dans le rapport JSON). Aucun test ne peut le
   tuer — le rendre vert demanderait de tromper l'outil. Un seul mutant de tout le périmètre est
   dans ce cas ; il est laissé tel quel, et compté au dénominateur.

## Vitest 5 attend Stryker (22/09/2026, décision n° 180)

Sous Vitest 5.0.0, la suite passe entière (2 939 tests), mais le relevé tombe de **97,23 % à
25,17 %** — même code, mêmes tests. `@stryker-mutator/vitest-runner` 10.0.0 lance les tests d'un
mutant en les filtrant par leur nom, qu'il joint d'une espace ; Vitest 5 compare ce filtre au nom
joint de « > » (changement documenté de sa migration). Le filtre ne trouve rien, **aucun test ne
tourne**, et tout mutant couvert est compté survivant : 1 639 des 1 646 survivants avaient des
tests qui les couvraient et `testsCompleted: 0`. C'est le cinquième piège à grande échelle, et le
seul symptôme est un score qui s'effondre — le signalement amont est `stryker-js#6210`, son
correctif `#6214`, ni fusionné ni publié à cette date. Aucune option (`coverageAnalysis: "all"`,
`related: false`) ne le contourne.

Le dépôt reste donc en Vitest 4 : `.github/dependabot.yml` exclut `vitest` et `@vitest/*` à partir
de la 5, et `tests/integration/dependabot-policy.test.ts` fait rougir la CI si le verrou contredit
l'exclusion — un `npm install` à la main passerait sinon, la mutation ne tournant pas en CI.

**Pour lever l'exclusion**, quand le lanceur publie le correctif :

1. monter `vitest` et `@vitest/coverage-v8` **ensemble** (ils s'exigent l'un l'autre à la version
   exacte ; installés seuls, `npm ci` échoue en ERESOLVE) ;
2. réécrire `tests/perf/engine-load.bench.ts`, seul fichier que Vitest 5 casse : `bench` n'est plus
   une fonction globale mais un outil du contexte de test (`test('…', async ({ bench }) => …)`), et
   les itérations passent de l'appel à `.run(options)` ou `bench.compare(…, options)` ;
3. relancer `npm run mutation` **sans** `reports/stryker-incremental.json`, et comparer au dernier
   relevé ; compter dans le rapport JSON les survivants à `testsCompleted: 0` — c'est là que le
   défaut se voit ;
4. retirer les deux entrées de l'exclusion.

Un relevé qui échoue laisse `.stryker-tmp/` derrière lui, avec une **jonction** `node_modules` vers
le dépôt. Retirer la jonction seule (`(Get-Item -Force <jonction>).Delete()`) avant d'effacer le
reste : effacer récursivement à travers elle viderait le `node_modules` du dépôt.

## Le périmètre, et pourquoi il est étroit

`stryker.config.json` mute `src/lib/derive` et les **sept moteurs fiscaux** de `src/lib/domain` —
les modules **purs**, sans DOM, sans horloge, sans navigateur, et ceux qui produisent les montants
qu'un utilisateur recopiera dans une déclaration. S'y ajoute `src/lib/history/window.ts` (P118) :
pur lui aussi, il produit les flux, le gain et les rendements de la fenêtre d'analyse du Rapport,
et il vit dans `history` parce qu'il lit la série quotidienne. Et `src/lib/storage/sync` (décision
n° 182) : pur aussi, mais un plancher SÉPARÉ (≥ 90 %, mesuré seul avec `--mutate`) — il ne produit
pas des montants mais des décisions de fusion, et son plancher est délibérément plus bas que celui,
déjà durci au fil des relevés, du reste du périmètre ci-dessous.

À P121-P123 (décision n° 184) s'ajoutent
`src/lib/domain/trading/filter.ts`, `tags.ts` et `liquidation.ts` : mêmes contraintes (purs, big.js
seul), et mêmes chiffres qu'un utilisateur peut recopier ou suivre — le sous-ensemble filtré de ses
trades, ses tags, la distance à la liquidation d'une position ouverte.

- **`src/state` est hors périmètre** : ce sont des classes à runes couplées au navigateur, que
  Vitest n'exécute pas. C'est pourtant là qu'est le vrai trou — `app.svelte.ts` est à **0 %** de
  couverture et a été modifié **22 fois** en deux semaines, avec **49 `$derived`** dedans. La
  réponse n'est pas d'y muter quoi que ce soit : c'est d'en **extraire** les règles vers
  `src/lib/derive` (décision n° 94), où elles deviennent mesurables — et où le score est de 100 %.
- **Les composants `.svelte` sont hors périmètre** : muter du rendu produit des mutants bruyants
  pour une valeur faible. Leur exclusion de la couverture est déjà argumentée (décision n° 78).
- **Le reste de `domain` n'y est pas encore** : une exécution sur les ~11 600 lignes du dossier
  entier a dépassé **vingt-cinq minutes** sans finir. Élargir demande de mesurer ce coût, pas de le
  supposer.

## Ce qu'on ne fait pas, et pourquoi

Écrit ici pour ne pas avoir à le redécouvrir dans six mois (décision n° 147).

| Écarté                                       | Raison                                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Fusionner la couverture des tests E2E**    | Une ligne « couverte » par un parcours s'est **exécutée**, elle n'a pas été **vérifiée** — précisément l'angle mort. `coherence.spec.ts` compare déjà l'écran au moteur, ce qui vaut mieux.      |
| **Relever le seuil global de couverture**    | Il ne regarde pas la zone aveugle ; le relever durcirait des tests-alibis là où on est déjà mesuré.                                                                                              |
| **Tester les composants en mode navigateur** | `vitest-browser-svelte` est mûr, mais 21 000 lignes de composants en navigateur, c'est des dizaines de minutes de CI pour un développeur seul.                                                   |
| **Muter toute l'application**                | Voir ci-dessus : le dossier `domain` entier dépasse vingt-cinq minutes. Le périmètre pur suffit à la classe de défaut visée.                                                                     |
| **Lancer la mutation en CI**                 | Pas tant que le coût d'un élargissement n'est pas connu. Un jour, plutôt en hebdomadaire sur le cron existant qu'à chaque PR : le mode incrémental a besoin d'un fichier conservé.               |
| **Passer en `coverageAnalysis: "all"`**      | Soupçonné un instant de fausser le verdict. Vérifié le 15/09/2026 sur `interest-income-fr.ts` : **même score, même survivant**. `perTest` reste, et son unique artefact connu est le piège n° 5. |
| **Muter `domain/second-opinion.ts`**         | 726 lignes pures, et un candidat sérieux — mais ce module **compare** des chiffres, il n'en produit aucun que l'utilisateur recopie. À reconsidérer le jour où on élargit, en mesurant le coût.  |
