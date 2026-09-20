# Un rapport par espace, et un rapport global — ce qu'il reste à construire après le vocabulaire

> Demande traitée : « Je veux pouvoir avoir un rapport de ce genre pour chaque catégorie
> (investissement, patrimoine, trading) et un global. Et pouvoir aussi voir l'année en cours (donc
> ici 2027 si c'est par année de déclaration ?). Vise l'état de l'art et prêt pour le futur. »

_Établi le 20/09/2026 contre `main` à `eda1736` (**2.17.0**, 170 décisions). Les faits sont marqués
**vérifié** (relu par moi dans le dépôt ce jour, référence de fichier donnée) ou **sourcé** (URL et
date en fin de document). Propositions numérotées **P115-P118** : P114 était le dernier numéro pris (étude du
13/09/2026). Statut : **proposition** — le seul lot livré ce jour est le vocabulaire de l'année
(décision n° 171), qui ne figure pas ici._

---

## 1. La demande portait un doute, et le doute était le vrai défaut

La parenthèse « donc ici 2027 si c'est par année de déclaration ? » n'était pas une question
annexe : c'était le défaut. **Vérifié** — le 20/09/2026, `declarationYear` rend 2026 depuis le
1er juillet ([`src/lib/domain/tax-fr.ts:104`](../../src/lib/domain/tax-fr.ts)), et le sélecteur du
Rapport affichait bien 2026, c'est-à-dire **l'année en cours**. Rien ne manquait au calcul. Ce qui
manquait, c'était un mot : « Année déclarée » se lit dans les deux sens.

C'est livré (décision n° 171) et hors périmètre de cette proposition. On le note ici parce que la
leçon vaut pour la suite : **avant de construire un rapport par espace, vérifier que le besoin n'est
pas déjà servi sous un nom illisible.** Deux des quatre propositions ci-dessous ont rétréci pour
cette raison.

## 2. Ce qui existe déjà, et que personne n'appelle « rapport »

Trois briques portent l'essentiel du travail supposé restant.

**Le global est calculé, testé, et affiché — sous le nom de « réconciliation ». Vérifié.**
[`reconcileNetWorth`](../../src/lib/history/net-worth.ts) pose `apports nets + résultat =
patrimoine`, le déplie **producteur par producteur**, et porte déjà les deux drapeaux qui font
qu'un total est honnête : `incomplete` (une part n'a pas pu être valorisée — elle ne compte pas pour
zéro) et `unreconciled` (une valeur servie ne se recoupe pas avec son grand livre — aucun résultat
n'en sort). C'est la synthèse d'un rapport global, moins la mise en page.

**La plage d'analyse est déjà unique et libre pour toute l'application. Vérifié.** Décisions
n° 156 et 157 : une seule liste `PERIODS`, un seul `PeriodToggle`, une plage libre de date à date,
le tout rangé dans `UiSettings` et non dans l'URL. **Le Rapport est le seul écran qui l'ignore** —
`Overview`, `Trading` et `TradeStats` la lisent, lui non.

**Les trois espaces existent comme registre. Vérifié.** [`src/lib/spaces.ts`](../../src/lib/spaces.ts)
déclare `overview`, `invest`, `wealth`, `trading`, `more`, et une route neuve se rattache à un
espace sans toucher aux autres. C'est le patron qu'un registre de rapports doit copier.

## 3. Les trois obstacles réels

### 3.1 Le modèle de rapport ne peut porter qu'un portefeuille d'investissement

**Vérifié.** [`ReportModel`](../../src/lib/export/report-model.ts) expose des champs **nommés** et
quatre tableaux **non optionnels** — `allocation`, `positions`, `stablecoins`, `closed` — qui n'ont
aucun sens pour des prêts ou pour du trading. Et
[`src/lib/export/pdf.ts:401-440`](../../src/lib/export/pdf.ts) code en dur la séquence des sections,
chacune derrière un `if (model.x)`. Un rapport de prêts ne s'exprime pas dans ce type, et
l'exprimer par des tableaux vides serait pire qu'un refus.

C'est **le** travail structurant, et il ne se voit pas à l'écran : tant que le modèle n'est pas une
liste ordonnée de sections typées, chaque nouveau périmètre coûte une branche de plus dans les deux
rendus.

### 3.2 « Patrimoine » nomme deux choses différentes

**Vérifié.** La Vue d'ensemble appelle « Patrimoine » le **total consolidé**
([`Overview.svelte:208`](../../src/routes/Overview.svelte)), et la navigation appelle « Patrimoine »
l'**espace des prêts** ([`spaces.ts`](../../src/lib/spaces.ts)). Un rapport global intitulé
« Patrimoine » contenant une part intitulée « Patrimoine » viole le MECE — mutuellement exclusif,
collectivement exhaustif — dès son titre.

**Arbitrage retenu par le propriétaire le 20/09/2026** : l'espace des prêts est renommé
**« Prêts »**, et « Patrimoine » reste réservé au total consolidé.

### 3.3 Le moteur calcule depuis l'origine, jamais sur une fenêtre

**Vérifié.** `computePortfolio` produit des positions, un PRU et un réalisé **cumulés depuis la
première opération**. Un rapport « 2026 » demande de séparer deux natures de grandeurs :

| Nature                                       | Ce que la fenêtre veut dire            |
| -------------------------------------------- | -------------------------------------- |
| Stocks (quantité, PRU, valeur)               | l'état **à la date de fin**            |
| Flux (réalisé, frais, récompenses)           | ce qui s'est passé **dans la fenêtre** |
| Performance (TWR, taux de rendement interne) | mesurée **sur la fenêtre**             |

Rien d'impossible : les flux cumulés se différencient entre les deux bornes, et la courbe de
patrimoine sait déjà donner une valeur à un jour quelconque. Mais c'est un chantier de moteur, avec
son invariant à re-démontrer, et c'est la seule partie de la demande qui puisse déraper.

**Deux règles s'imposent ici, et elles sont sourcées.** D'abord : **un résultat de moins d'un an ne
s'annualise pas.** Les normes GIPS 2020 l'écrivent — prolonger une période partielle produit un
rendement simulé, qui ne reflète pas la performance d'actifs réels. C'est exactement le piège d'un
rapport « année en cours » ouvert en septembre. Ensuite : **l'année fiscale n'est pas une plage
d'analyse.** La décision n° 156 avait déjà écarté « l'ancrage sur une année fiscale décalée » ; les
deux sélecteurs doivent coexister, et chacun dire ce qu'il gouverne — c'est ce que la décision
n° 171 vient de faire pour le second.

## 4. Ce que l'état de l'art impose, et ce qu'il n'impose pas

**Sourcé.** Trois cadres, et un seul point commun utile.

- **ISO 24896:2026** (notation pour le reporting d'entreprise, publiée le 11/06/2026, issue des
  travaux IBCS) ne dit rien du contenu : elle impose que **la même signification reçoive la même
  apparence** — libellés, tableaux, graphiques. Appliquée ici : un seul squelette de rapport, quatre
  périmètres, jamais quatre mises en page.
- **IFRS 8** pose l'**approche par la direction** : les segments publiés sont ceux que la direction
  regarde réellement, pas une taxonomie inventée pour le lecteur. Appliquée ici : les périmètres du
  rapport sont **les espaces de l'application**, pas une nouvelle classification.
- **Le principe MECE** (Minto, McKinsey) : des catégories sœurs sans recouvrement ni trou. C'est
  l'invariant du § 5, lot 3 — la somme des parts refait le tout, ou l'écran le dit.

Ce que ces cadres **n'imposent pas**, et qu'il serait tentant d'importer : l'échelle de périodes
prescrite par la _Marketing Rule_ de la SEC (1, 5, 10 ans plus la vie du portefeuille) est une
obligation de **publicité** faite à des conseillers américains. Elle n'a aucune portée ici, et
l'appliquer imposerait des colonnes que les données locales ne remplissent pas.

## 5. Les propositions

| #    | Proposition                                                                        | Valeur | Fiabilité | Satisf. | Sessions |   ROI   |
| ---- | ---------------------------------------------------------------------------------- | :----: | :-------: | :-----: | :------: | :-----: |
| P115 | Le modèle de rapport devient une liste ordonnée de sections                        |   2    |     4     |    0    |    1     |  **6**  |
| P116 | Registre `REPORTS` : un rapport par espace, une route par périmètre                |   4    |     2     |    5    |    2     | **5,5** |
| P117 | Le rapport global, assis sur `reconcileNetWorth`, avec l'invariant Σ parts = total |   5    |     3     |    4    |    1     | **12**  |
| P118 | Le rapport honore la plage d'analyse, année en cours comprise                      |   5    |     2     |    5    |   2,5    | **4,8** |

**Ordre retenu : P115 → P117 → P116 → P118.** Ce n'est pas l'ordre du ROI brut, et la raison est la
même que pour l'ordre P106 → P108 de l'étude précédente : **P115 conditionne les trois autres.**
Tant que le modèle impose quatre tableaux d'investissement, ni le global ni les prêts ne s'y
expriment. P117 passe devant P116 parce que le global est celui dont le calcul existe déjà : il
livre la valeur la plus vite, et il **met à l'épreuve** le modèle refondu avant que trois rapports
n'en dépendent.

### P115 — Le modèle de rapport devient une liste ordonnée de sections (1 session)

`ReportModel` expose `sections: ReportSection[]`, union discriminée — bandeau d'indicateurs, table
de détails, liste à puces, tableau, paragraphes. Les deux rendus (jsPDF et l'écran) **itèrent** au
lieu d'énumérer. Refactor pur : aucun changement visible, gardé par les 675 lignes de
`report-model.test.ts` et le parcours « rapport PDF généré dans le navigateur ».

Contre-épreuve : retirer une section du constructeur doit faire disparaître la même section des deux
rendus, et rougir le même test.

### P117 — Le rapport global (1 session)

Synthèse = `reconcileNetWorth` du dernier jour : apports nets, patrimoine, résultat, et une ligne
par producteur avec son résultat et son rapport aux apports. Les drapeaux `incomplete` et
`unreconciled` deviennent des notes de couverture, jamais des silences.

L'invariant à tenir, et à faire échouer : **la somme des parts refait le tout**. Une auto-vérification
existe déjà pour la Vue d'ensemble ; le rapport lit la même, il n'en crée pas une seconde.

### P116 — Un rapport par espace (2 sessions)

Un registre `REPORTS` à côté de `SPACES` : identifiant, libellé, constructeur de modèle,
disponibilité (un espace sans données n'offre pas de rapport vide). Routes `#/report` (global),
`#/invest/report` (conservée), `#/trading/report`, `#/wealth/report` — **un seul composant**, le
périmètre porté par la route.

Une route neuve implique, dans ce dépôt : le routeur et ses tests, `spaces.ts`, `App.svelte`, les
deux listes de `docs/ARCHITECTURE.md` (dont la **Liste vérifiée**, croisée par
`architecture-doc.test.ts`) et les deux listes de `tests/e2e/a11y.spec.ts`.

Le renommage de l'espace en **« Prêts »** (§ 3.2) se fait ici, pas avant : c'est le rapport global
qui rend la collision visible.

### P118 — La plage d'analyse (2,5 sessions)

Le rapport lit `ui.period` et `ui.customRange`, comme les trois autres écrans. Stocks à la date de
fin, flux sur la fenêtre, performance sur la fenêtre, **jamais annualisée** sur une période
partielle (§ 3.3). Le sélecteur d'année fiscale **reste** : il gouverne les sections fiscales, et
depuis la décision n° 171 il le dit.

### Ce qui n'est pas recommandé

- **Une taxonomie de rapport indépendante des espaces** (par classe d'actif, par compte, par
  juridiction). Elle multiplierait les périmètres sans que personne ne les regarde — contraire à
  l'approche par la direction d'IFRS 8, et contraire au constat qui a fondé la décision n° 156 :
  l'anomalie n'est pas le vocabulaire choisi, c'est d'en avoir plusieurs.
- **Un rapport consolidé qui compterait un solde inconnu pour zéro** pour rendre un total « propre ».
  La décision n° 97 l'interdit déjà, et c'est le mensonge le plus discret qu'un écran puisse faire.
- **Un sélecteur de périmètre dans l'URL.** La décision n° 156 a tranché : le routeur est à hash
  sans modèle de requête, et le lien ne transporterait rien. Le périmètre est porté par la route.

### Ce qui demande une décision du propriétaire

- **Le renommage de l'espace « Patrimoine » en « Prêts »** touche la navigation, donc les captures,
  les parcours E2E et l'habitude. Arbitré le 20/09/2026, à exécuter en P116.
- **Ce qu'un rapport de prêts doit contenir.** `LendingSummary` expose quinze grandeurs, dont le
  **recyclage** (capital prêté ÷ apports nets) qui n'a aucun équivalent dans les deux autres
  espaces. Un squelette commun ne veut pas dire un contenu commun.

## 6. Limites de cette étude

Elle n'a **pas** mesuré le coût d'exécution d'un rejeu du grand livre aux deux bornes d'une fenêtre
(§ 3.3) : la décision n° 152 a montré que le coût quadratique venait de la trace, pas du calcul,
mais ce chiffre-là reste à prendre avant de s'engager sur P118. Elle n'a pas non plus examiné ce que
le rapport global doit faire d'un espace **vide** — le cas est réglé pour la Vue d'ensemble, pas
pour un document destiné à circuler.

## Sources

Consultées le 20/09/2026.

- [S1] GIPS 2020 pour les sociétés de gestion — https://www.gipsstandards.org/wp-content/uploads/2021/03/2020_gips_standards_firms.pdf
- [S2] GIPS, base de questions-réponses, rendements de périodes partielles — https://www.gipsstandards.org/qadatabase/5001/
- [S3] ISO 24896:2026, notation pour le reporting d'entreprise — https://www.iso.org/standard/88366.html
- [S4] IBCS, ISO 24896 (origine de la norme, parties UNIFY et CHECK) — https://www.ibcs.com/iso-24896/
- [S5] IFRS 8, identification des secteurs opérationnels (approche par la direction) — https://www.grantthornton.global/globalassets/1.-member-firms/global/insights/insight-content-blocks-and-media/ifrs/ifrs-8/ifrs-8-operating-segments.pdf
- [S6] Principe MECE — https://en.wikipedia.org/wiki/MECE_principle
- [S7] SEC, Marketing Rule, périodes prescrites (écarté, § 4) — https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/marketing-compliance-frequently-asked-questions
- [S8] Formulaire 2086, plus ou moins-values de cessions d'actifs numériques — https://www.impots.gouv.fr/formulaire/2086/declaration-des-plus-ou-moins-values-de-cessions-dactifs-numeriques
