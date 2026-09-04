# Le tableau de bord — lire son patrimoine sans se tromper

> Refonte du 27/08/2026. Décisions de conception : [`DECISIONS.md`](DECISIONS.md) n° 55 (les
> apports) et n° 56 (la composition de l'écran).

## La question à laquelle l'écran répond

**Combien j'ai, et est-ce que ça vient de ce que j'ai versé ou de ce que j'ai gagné ?**

C'est la seule question qu'un portefeuille rende difficile. Un solde de compte ne sait pas y
répondre : un virement de 1 000 € et un gain de 1 000 € y produisent le même chiffre. Tout le reste
de l'écran découle de cette distinction.

## Ce qu'on lit, dans l'ordre

| Bloc                      | Ce qu'il dit                                                               |
| ------------------------- | -------------------------------------------------------------------------- |
| **Patrimoine**            | Un chiffre, sa variation sur la période choisie, **hors apports**          |
| **D'où vient ce chiffre** | `apports nets + résultat = patrimoine`, dépliable espace par espace        |
| **Évolution**             | Les deux courbes : ce que vous possédez, ce que vous avez versé            |
| **Répartition**           | Une ligne par espace : valeur, part, ce qu'il a **produit** sur la période |
| **Constats**              | Des observations chiffrées — jamais un conseil                             |
| **À vérifier**            | Ce que l'app ne sait pas garantir, et quoi faire                           |

La **période choisie en haut gouverne tout l'écran**. Deux fenêtres de temps sur une même page sont
deux réponses à la même question : le bandeau, la courbe et la répartition parlent toujours de la
même période.

### Deux pourcentages, deux questions

Chaque résultat par espace est rapporté à une base — et les deux cartes ne posent pas la même
question, ce que chacune écrit noir sur blanc (décision n° 96) :

- **« D'où vient ce chiffre »** est un **bilan** à la date du jour : le pourcentage est le résultat
  rapporté aux **apports** (`roiOf`), la base de la ligne « Résultat total » juste au-dessus ;
- **« Répartition »** suit le **sélecteur de période** : le pourcentage est celui de la fenêtre,
  apports neutralisés (Dietz modifié, `periodPerformance`) — la mesure du bandeau. Rapporter le gain
  d'un mois aux apports de toute la vie d'un compte n'aurait aucun sens.

Le pourcentage d'un espace sort de la **même fonction** que celui du total, appliquée à la série de
la part : un test exige que, sur un patrimoine à un seul espace, les deux soient égaux.

### Ce qui n'a pas été mesuré ne s'affiche pas comme un zéro

Un espace dont la valeur manque **ne vaut pas zéro** (décision n° 97, statut d'observation SDMX) :

| État                         | Valeur                          | Résultat | Ce que dit l'écran                                         |
| ---------------------------- | ------------------------------- | -------- | ---------------------------------------------------------- |
| Jamais mesuré                | « — », mention « non valorisé » | « — »    | le total se déclare **incomplet, pas approché**            |
| Contredit par le grand livre | affichée telle quelle           | « — »    | « ne se recoupe pas », et « À vérifier » dit quoi relancer |

La deuxième ligne se déclenche quand l'écart de réconciliation du compte — celui que le moteur
Trading calcule déjà — **dépasse le résultat qu'on s'apprêtait à afficher** : au-delà, le signe de
ce résultat n'est plus établi. Aucun seuil arbitraire n'intervient.

## Les apports nets : la définition qui commande tout

> Les apports nets sont l'argent **entré dans le périmètre** moins celui qui en est sorti. Ce n'est
> pas le coût de vos positions.

Les deux se ressemblent tant qu'on n'a rien vendu, puis divergent définitivement. Vendre 1 000 € de
BTC pour 600 € fait tomber le coût des positions à zéro — mais vous avez bien versé 1 000 € et il
n'en reste que 600. La moins-value de 400 € n'apparaît que si la référence reste à 1 000 €.

Conséquences pratiques :

- **Un virement ne ressemble jamais à une performance** : il déplace les deux courbes ensemble.
- **Un transfert entre vos deux espaces ne produit rien** : il sort d'un côté, entre de l'autre, et
  s'annule dans le total. La ligne « apports » de chaque espace le montre.
- **L'écart entre patrimoine et apports est votre résultat complet** — réalisé et latent confondus,
  tous espaces réunis.

Côté Trading, **tous les mouvements de trésorerie** comptent, pas seulement les dépôts et retraits :
la contribution suit l'équité du compte perps, dont un virement vers le spot sort exactement comme
un retrait vers l'extérieur.

## Ce qui est vérifié, et pourquoi ça compte

Une carte qui affirme une égalité doit la prouver. Trois contrôles tournent en permanence et
apparaissent dans **Réglages → auto-vérifications** :

1. **Patrimoine · détail** — la somme des espaces refait le total. Vrai par construction : un écart
   signale une régression du calcul, jamais une donnée bancale. C'est donc une **anomalie**, pas un
   avertissement.
2. **Patrimoine · investissement** — le résultat déduit des apports égale « réalisé + latent »
   calculé lot par lot. C'est le contrôle qui tient toute la carte : il relie une notion de **flux**
   à des plus-values calculées par un chemin entièrement différent. Sur le jeu de démonstration, les
   deux donnent `−2 860,60 €`.
3. **Trading** — la réconciliation d'équité de la plateforme, déjà en place :
   `équité = apports + réalisé − frais + funding + latent`.

Un test de bout en bout (`coherence.spec.ts`) rejoue les trois niveaux sur les montants **affichés**,
puis va relire chaque espace sur son propre écran.

## Trois règles de présentation

Elles viennent de l'**ISO 24896:2026**, _Notation for business reporting_ — la mise en norme ISO des
standards IBCS et de leur formule SUCCESS.

- **Un seul chiffre domine.** Le patrimoine, en taille d'affichage fluide. Le reste se lit ensuite.
- **Aucun chiffre n'est écrit deux fois.** Chaque répétition est une occasion de diverger sans rien
  ajouter à personne.
- **La couleur est réservée aux variances.** Un niveau — une valeur, un solde — reste neutre ; seule
  une variation est colorée, et toujours par le composant `Delta`, qui l'accompagne d'un triangle,
  d'un signe et d'un équivalent parlé. Le rouge/vert seul est le défaut d'accessibilité le plus
  courant des graphiques financiers ; ici il n'est jamais le seul porteur du sens.

Et une règle qui vient du projet : **les montants d'une réconciliation s'additionnent à l'écran**.
L'écart affiché est calculé sur les montants _arrondis_, sinon trois nombres justes affichent une
addition fausse d'un centime — invisible dans le calcul, fatale dans une colonne. L'exactitude reste
au moteur ; ce qui est arrondi ne sert qu'à être lu.

## Ce que ça ne fait pas

Le tableau de bord **calcule, montre et compare — il ne recommande rien**. Aucune phrase n'y dit
d'acheter, de vendre ou d'arbitrer. Les constats sont des observations chiffrées tirées de vos
données, et le disent.

Les avoirs **spot** d'un compte de trading ne sont pas comptés dans le patrimoine, sauf si vous
cochez « traiter le spot comme de l'investissement » sur le compte (écran Comptes) : ils entrent
alors par le grand livre, avec un PRU et des plus-values. Sans cette option, ils sortent des apports
en même temps que de la valeur — la lecture reste cohérente, simplement incomplète.
