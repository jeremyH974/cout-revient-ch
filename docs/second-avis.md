# Second avis — comparer les chiffres d'un autre outil aux nôtres

> P62, livré le 29/08/2026. Réutilise `ValueGap` (`src/lib/domain/gap.ts`, livré par P68) tel quel,
> et le modèle de la décision n° 40 : moteur muet, texte français séparé.

## Le piège central

Une divergence avec un autre outil n'est **presque jamais** une anomalie de sa part. Elle vient
d'une **méthode légitimement différente** :

| Différence                                                | Notre choix                                |
| --------------------------------------------------------- | ------------------------------------------ |
| Coût moyen pondéré invariant à la vente vs FIFO / HIFO    | décision n° 5                              |
| PRU **par actif** vs méthode globale de l'art. 150 VH bis | décisions n° 10 et n° 43                   |
| Lots consommés au prorata vs par ordre d'entrée           | décision n° 6                              |
| Frais inclus dans le coût                                 | décision n° 4                              |
| Récompenses à coût nul                                    | décision n° 9                              |
| Source des prix et taux de change                         | décision n° 18                             |
| Périmètre de portefeuille                                 | (déclaré par l'utilisateur, voir plus bas) |

Laisser croire qu'un autre outil « se trompe » alors qu'il applique une autre méthode détruirait la
crédibilité que la traçabilité (décision n° 61) vient d'établir. Le garde-fou n'est donc **pas un
avertissement** — un avertissement se lit une fois et s'oublie — **c'est une partition typée des
grandeurs**, dans le code, vérifiée par des tests.

## La partition (`METRIC_CLASS`)

| Classe             | Grandeurs                                                                                    | Un écart « à examiner » peut-il y naître ?    |
| ------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `invariant`        | `qty-held`, `proceeds-total`, `acquisitions-total`, `operation-count`                        | **Oui** — elles ne dépendent d'aucune méthode |
| `method-sensitive` | `pru`, `cost-basis`, `realized`, `unrealized`                                                | **Non** dès que la méthode déclarée diffère   |
| `statutory`        | `tax-global-value`, `tax-proceeds`, `tax-acquisition`, `tax-gain` (cases 212, 215, 216, 220) | **Oui** — la loi impose la méthode aux deux   |

Sur une grandeur `method-sensitive` dont la méthode d'en face n'est pas la nôtre, l'écart est classé
`method` **par construction** : les deux nombres sont énoncés côte à côte, mais
`ValueGap.delta` est délibérément remis à `null` — **retrancher deux chiffres produits par deux
méthodes différentes donne un nombre qui ne veut rien dire.**

Sur une grandeur `statutory`, la méthode déclarée n'a pas voix au chapitre : `theirMethodFor()`
renvoie `fr-global` quoi qu'il arrive. C'est ce qui rend une ligne du 2086 comparable sans réserve.

**Le moteur ne rejoue jamais FIFO ni HIFO.** Simuler la méthode d'un tiers contredirait les
décisions n° 5 et n° 6 ; on préfère dire « non décidable ».

## La cascade d'imputation

Ordre **fixe**, rejoué à côté par une propriété fast-check (si l'ordre change, la propriété tombe) :

1. `rounding` — `|δ|` sous le seuil d'arrondi de la grandeur ;
2. `method` — grandeur sensible **et** méthode déclarée ≠ la nôtre ;
3. `scope` — opérations absentes ou en trop (appariées par jour + actif + quantité) ;
4. `valuation` — mêmes opérations, quantités égales, contre-valeurs différentes ;
5. `unexplained` — **et lui seul est présenté comme « à examiner ».**

`rounding` d'abord : deux méthodes différentes qui tombent d'accord au centime près ne divergent
que sur le papier. `scope` avant `valuation` : des opérations absentes expliquent aussi des
contre-valeurs différentes, l'inverse est faux.

### Deux seuils, et deux seulement

| Seuil                                  | Montants en euros | Quantité | Dénombrement |
| -------------------------------------- | ----------------- | -------- | ------------ |
| **Concordance** (`displayToleranceOf`) | 0,005 €           | 5e-9     | 0            |
| **Arrondi** (`roundingToleranceOf`)    | 0,01 €            | 1e-8     | 0            |

Le premier est la moitié du dernier chiffre qu'un écran sait afficher : deux chiffres qui
s'accordent à ce point **sont le même chiffre**, personne ne pourrait montrer la différence. Sans
lui, confronter nos chiffres à pleine précision aux deux décimales d'un tableur produirait une
carte « écart d'arrondi » par ligne — du bruit, jamais une information. Entre les deux seuils,
l'écart existe et il est nommé ; au-delà, la cascade cherche vraiment.

## Ce qui est comparé, et ce qui ne l'est pas

| Outil            | Chiffres calculés exportables                 | État en v1                      |
| ---------------- | --------------------------------------------- | ------------------------------- |
| **Waltio**       | annexe **2086**, grand livre, fiche de stock  | **Comparé** (annexe 2086, CSV)  |
| **CoinTracking** | réalisé et latent, coût et valeur de vente    | Détecté, `not-yet-comparable`   |
| **CoinTracker**  | `Proceeds`, `Cost Basis`, `Gain/Loss`         | Détecté, `not-yet-comparable`   |
| **Koinly**       | rapport complet en **PDF**                    | Refusé, `pdf-only`              |
| **Blockpit**     | **aucun** — export strictement transactionnel | Refusé, `no-calculated-figures` |

L'annexe 2086 passe en premier parce que c'est le seul terrain où **le piège central disparaît** :
la méthode y est imposée par la loi des deux côtés, donc un écart y est réel.

CoinTracking et CoinTracker sont **reconnus et annoncés honnêtement**, pas comparés : leurs chiffres
sont per-lot et `method-sensitive`, et leur méthode n'est pas exposée dans le fichier. Les comparer
sans méthode déclarée ne produirait que des « comparaisons non concluantes » — beaucoup d'écran pour
aucune information. La mécanique qui les accueillera existe déjà et est testée
(`SecondOpinionSource.declaredBy: 'user'`, `declaredMethod: 'unknown'` honoré).

Koinly est hors périmètre : ajouter un lecteur de PDF ajouterait une dépendance, contraire à la
décision n° 13.

### Le repli, nommé pour ce qu'il est

Pour tout fichier sans chiffres calculés, l'écran propose d'**importer leurs opérations** (écran
Importer, `docs/pivot-import.md`). Ce n'est **pas** une comparaison de deux calculs : c'est le
calcul de ce moteur sur leurs données. Cela détecte un périmètre différent et des opérations
absentes, **jamais une méthode**. L'écran l'écrit dans ces termes.

## Les deux gardes que l'utilisateur commande

1. **Le périmètre se déclare AVANT tout affichage** (`sameScopeConfirmed`). Un utilisateur qui suit
   plus de comptes chez l'autre outil verrait un écart massif et parfaitement légitime. Tant que la
   case n'est pas cochée, `compareSecondOpinion` ne produit **aucun** écart — la garde est dans le
   moteur, pas dans l'écran, et une propriété fast-check le vérifie.
2. **« Je ne sais pas » est une réponse honorée.** Méthode `unknown` ⟹ toute grandeur sensible
   devient « comparaison non concluante ». Jamais un écart affiché qu'on ne saurait pas interpréter.

## Détection : tolérante, et qui renonce honnêtement

Les en-têtes acceptés viennent de **sources secondaires** — Koinly et CoinTracker refusent la
récupération automatisée de leur documentation (vérifié le 29/08/2026), et la relecture du cerfa
2086 officiel n'a pas pu être automatisée non plus. La détection est donc :

- **tolérante** : casse, accents, apostrophes typographiques, espaces insécables et espaces
  multiples sont normalisés ; les **numéros de case** (`211`, `212`, `215`, `216`, `220`) sont
  acceptés au même titre que les libellés français, avec plusieurs orthographes chacun ;
- **minimale** : une date de cession et au moins un prix de cession ou une plus-value suffisent —
  une case absente devient une réclamation absente, jamais un zéro ;
- **honnête en échec** : `unrecognised` **nomme les colonnes cherchées**. Un analyseur qui devine
  est pire qu'un analyseur qui renonce.

Les montants sont lus à la française comme à l'anglaise (`1 234,56`, `1.234,56`, `1,234.56`), avec
une règle décidable : quand les deux séparateurs sont présents, **le dernier est le décimal**. Une
chaîne qui ne se réduit pas à un décimal canonique reste **illisible**, jamais approchée. **Aucune
conversion de devise n'est inventée** : une valeur libellée dans une devise non gérée devient une
réclamation non comparable (`currency-not-eur`).

## Limites nommées

- **Le bouton « Pourquoi ce chiffre ? » n'apparaît sur aucun écart en v1.** Il est branché,
  entièrement piloté par `gap.ourTrace`, et les grandeurs de portefeuille (PRU, coût, réalisé,
  latent, investi, produits) portent bien leur `TraceTarget` — `ourFiguresFrom` les remplit et
  l'intégration le vérifie. Mais **une ligne 2086 n'en porte aucune**, et c'est le seul format
  comparé : `TraceScope` n'a pas de portée « une cession », et pointer la trace de la position ou
  du portefeuille ferait descendre l'utilisateur sur un **autre chiffre** que celui qu'il conteste.
  Une descente absente vaut mieux qu'une descente qui vise à côté. Le bouton s'allumera sans une
  ligne de code de plus dès qu'un format annoncera un PRU, un coût, un réalisé ou un latent.
- **Deux cessions le même jour ne sont pas comparées.** Une annexe 2086 ne date qu'au jour ; nos
  cessions portent l'heure. Quand un jour porte plusieurs cessions, aucune ne peut être rattachée à
  une ligne précise du fichier : la comparaison est déclarée non concluante (`ambiguous-line`)
  plutôt que rattachée au hasard.
- **Les échelons `scope` et `valuation` ne se déclenchent pas sur une annexe 2086** : elle ne porte
  aucune opération, donc `operations` vaut `null`. Ils sont implémentés et testés, et s'activeront
  avec le premier format qui liste des opérations. Il n'existe volontairement pas encore
  d'adaptateur « nos opérations → `ComparableOperation[]` » : ce serait du code que rien n'appelle.
- **Rien n'est persisté et rien n'est importé** (décision n° 3). Le fichier est lu en mémoire,
  comparé, puis oublié ; il n'entre **jamais** dans le grand livre.

## La discipline de formulation, vérifiée par un test

`src/lib/format/second-opinion.lexicon.test.ts` fait **échouer la CI** si le vocabulaire de
l'accusation (« erreur », « faux », « bug », « se trompe », « surestime »…), un score de fiabilité,
un classement d'outils ou une comparaison de prix ou d'offre réapparaît dans
`src/lib/format/second-opinion.ts` — commentaires compris, parce qu'une explication de code qui
emploie ce vocabulaire finit par déteindre sur les phrases. Une seule exception, nommée dans le
test : la phrase autorisée mot pour mot « Sur cette grandeur, les deux résultats peuvent différer
sans qu'aucun ne soit faux », qui est la **négation** de l'accusation.

Un second test vérifie que la phrase d'un **écart à examiner ne cite jamais un nom d'éditeur**. Les
marques ne sont citées que comme **noms de format de fichier** (« fichier Waltio »). C'est aussi ce
qui garde la comparaison licite au titre de la publicité comparative (art. L122-1 s. du code de la
consommation) : on compare des caractéristiques objectives et vérifiables, jamais des outils.

Toute vue affiche : **« Ce comparatif n'est pas un audit et ne remplace pas un professionnel. »**

## Où c'est

| Fichier                                   | Rôle                                                        |
| ----------------------------------------- | ----------------------------------------------------------- |
| `src/lib/domain/second-opinion.ts`        | partition, cascade, comparaison — pur, muet                 |
| `src/lib/domain/gap.ts`                   | `ValueGap` partagé avec la réconciliation (**non modifié**) |
| `src/lib/import/second-opinion/detect.ts` | reconnaissance d'en-tête, refus nommés                      |
| `src/lib/import/second-opinion/claims.ts` | normalisation en `SecondOpinionClaim[]` + verbatim          |
| `src/lib/format/second-opinion.ts`        | le français, cinq `switch` exhaustifs                       |
| `src/routes/invest/SecondOpinion.svelte`  | l'écran (`#/invest/second-opinion`)                         |
| `tests/fixtures/second-opinion/`          | fixtures 100 % synthétiques (décision n° 17)                |

Points d'entrée : écran **Importer** (« vous avez un fichier de chiffres déjà calculés ? ») et
**Rapport** (à côté de l'export des cessions au format 2086).

## À confirmer sur un fichier réel

Rien de ce qui suit n'est bloquant pour le code, mais **la fonctionnalité ne devrait pas être
annoncée** avant vérification sur un vrai export :

1. **Les libellés exacts des colonnes de l'annexe 2086 exportée par Waltio.** La table `HEADERS`
   accepte les numéros de case et plusieurs orthographes des libellés officiels, mais aucune n'a pu
   être confirmée sur un fichier produit par l'outil. Si la détection renonce, l'écran nomme ce
   qu'il cherchait — il suffira d'ajouter l'alias manquant à `HEADERS`.
2. **Le séparateur, l'encodage et le format des nombres réellement produits** (virgule décimale,
   espace insécable étroit, symbole €). `parseAmount` couvre les cas usuels ; un cas non couvert
   devient `value-unreadable`, visible à l'écran.
3. **Ce que la case 215 contient vraiment** dans l'export (prix de cession net des frais) et si elle
   correspond bien à `TaxCession.proceedsEur` — c'est-à-dire au produit **net** perçu.
4. **La présence éventuelle d'une ligne de totaux** en fin de fichier : elle est aujourd'hui écartée
   parce qu'elle n'a pas de date lisible, et comptée dans `unreadableDates`.
5. **Les en-têtes de CoinTracking et CoinTracker**, avant de passer leur détection de
   `not-yet-comparable` à une vraie comparaison.
