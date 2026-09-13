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
manquante à écrire quand on retouche le module concerné.

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

## Comment on s'en sert

```bash
npm run mutation
```

Environ **1 min 30 s**. Le rapport lisible sort dans `reports/mutation/index.html` (dossier ignoré
par git). Un mutant survivant se lit comme une question : _quel test aurait dû rougir ici ?_ La
réponse est presque toujours une **assertion** manquante, pas un test manquant.

`thresholds.break` vaut **83**, posé **sous** le score mesuré : c'est un cliquet contre la
régression, jamais une cible. Un score qu'on atteint en écrivant des tests pour le chiffre ne vaut
rien.

## Trois pièges, tous vécus

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

## Le périmètre, et pourquoi il est étroit

`stryker.config.json` mute `src/lib/derive` et les **sept moteurs fiscaux** de `src/lib/domain` —
les modules **purs**, sans DOM, sans horloge, sans navigateur, et ceux qui produisent les montants
qu'un utilisateur recopiera dans une déclaration.

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

| Écarté                                       | Raison                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fusionner la couverture des tests E2E**    | Une ligne « couverte » par un parcours s'est **exécutée**, elle n'a pas été **vérifiée** — précisément l'angle mort. `coherence.spec.ts` compare déjà l'écran au moteur, ce qui vaut mieux. |
| **Relever le seuil global de couverture**    | Il ne regarde pas la zone aveugle ; le relever durcirait des tests-alibis là où on est déjà mesuré.                                                                                         |
| **Tester les composants en mode navigateur** | `vitest-browser-svelte` est mûr, mais 21 000 lignes de composants en navigateur, c'est des dizaines de minutes de CI pour un développeur seul.                                              |
| **Muter toute l'application**                | Voir ci-dessus : le dossier `domain` entier dépasse vingt-cinq minutes. Le périmètre pur suffit à la classe de défaut visée.                                                                |
| **Lancer la mutation en CI**                 | Pas tant que le coût d'un élargissement n'est pas connu. Un jour, plutôt en hebdomadaire sur le cron existant qu'à chaque PR : le mode incrémental a besoin d'un fichier conservé.          |
