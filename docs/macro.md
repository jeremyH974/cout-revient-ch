# Les indicateurs macroéconomiques — ce qu'ils disent, et ce qu'ils taisent

La section « Régime macroéconomique » de l'écran [`#/market`](../src/routes/Market.svelte) affiche
quelques indicateurs américains à côté du portefeuille. Elle ne commente rien, ne recommande rien,
et ne connaît pas vos positions. Le raisonnement complet est dans [`DECISIONS.md`](DECISIONS.md)
n° 59 ; ce document est le mode d'emploi.

## La règle qui gouverne l'écran

**Aucun chiffre n'est affiché seul.** « Taux réel à 2,42 % » ne dit rien : est-ce haut ? bas ?
Chaque valeur vient donc avec son **rang percentile dans son propre passé**, sur **deux fenêtres**.

Les deux se contredisent parfois, et c'est exactement l'information à voir. Au 28 août 2026, la
pente de la courbe américaine est au **11ᵉ percentile sur un an** — plate par rapport à l'année
écoulée — mais au **50ᵉ sur dix ans** — parfaitement banale à l'échelle de la décennie. Un chiffre
unique aurait raconté l'une ou l'autre histoire selon la fenêtre choisie, et rien n'aurait signalé
au lecteur qu'un choix avait été fait.

**Un percentile, jamais un z-score.** Le z-score suppose une loi normale que les marchés démentent :
sur une série à queues épaisses, il écrase l'information et produit des écarts absurdes. Le rang
percentile ne suppose rien de la distribution, et son échelle 0-100 se lit sans explication.

**Jamais le rang d'un niveau qui dérive.** Un percentile du niveau du bilan de la Fed vaudrait 99 %
en permanence : cette série monte, c'est tout ce qu'elle dit. Les séries non stationnaires sont donc
transformées **avant** d'être classées, et l'écran annonce la transformation sous la valeur.

## Les indicateurs

| Indicateur                  | Transformation        | Fenêtres          | Source | Cadence      |
| --------------------------- | --------------------- | ----------------- | ------ | ------------ |
| Réserves bancaires à la Fed | variation sur 3 mois  | 1 an, depuis 2021 | Fed    | hebdomadaire |
| Taux réel à 10 ans (TIPS)   | niveau                | 1 an, 10 ans      | Trésor | quotidienne  |
| Taux à 10 ans               | niveau                | 1 an, 5 ans       | Trésor | quotidienne  |
| Pente 10 ans − 2 ans        | niveau                | 1 an, 10 ans      | Trésor | quotidienne  |
| Pétrole WTI                 | variation sur 12 mois | 1 an, 5 ans       | EIA    | quotidienne  |
| Taux directeur de la BCE    | niveau                | 1 an, 5 ans       | BCE    | quotidienne  |

Le pétrole n'apparaît que si le secret `EIA_API_KEY` est disponible ; sinon l'écran dit que
l'indicateur manque et pourquoi, plutôt que de le faire disparaître en silence.

## Ce qui n'y est pas, et pourquoi

- **Le VIX.** Les conditions de Cboe interdisent de « store either in hard copy or in an electronic
  retrieval system » sans accord écrit — un instantané committé tombe exactement sous cette clause.
  Et `cdn.cboe.com` n'envoie aucun en-tête CORS, ce qui ferme aussi l'appel direct depuis le
  navigateur. Il n'existe pas de source libre : c'est un indice propriétaire. Le remplacement prévu
  est la volatilité réalisée du bitcoin, calculée localement (brique P50).
- **La « liquidité nette » `bilan − TGA − reverse repo`.** Ce que l'écran affiche, ce sont les
  **réserves bancaires**, chiffre publié par la Fed. Même idée, mais un nombre officiel plutôt
  qu'une reconstitution : la formule populaire n'est pas une statistique publiée, et son lien avec
  les marchés est réel sans être mécanique. La réserve est écrite à côté du chiffre.
- **La masse monétaire M2 et l'indice dollar.** Reportés : ils demandent d'autres jeux du Data
  Download Program, et leur apport se recoupe largement avec les taux réels.

## Comment c'est fabriqué

```bash
npm run macro
```

[`scripts/generate-macro.ts`](../scripts/generate-macro.ts) interroge le Trésor et la Fed, calcule
les percentiles **sur tout l'historique disponible** (depuis 2015), et écrit
[`src/lib/macro/snapshot.generated.ts`](../src/lib/macro/snapshot.generated.ts) — un module
TypeScript committé et compilé dans l'application. D'où l'absence totale de requête à l'exécution.

Le fichier n'embarque que **deux ans** de série par indicateur : assez pour les sparklines et pour
les corrélations à venir, sans traîner vingt ans d'historique dans le bundle. Les rangs, eux, sont
calculés en CI sur la profondeur complète.

Les calculs vivent dans [`src/lib/macro/stats.ts`](../src/lib/macro/stats.ts), module pur et testé.
Une propriété y est vérifiée en particulier : **tronquer la fin d'une série ne change aucun point du
passé** — autrement dit, aucun rang ne regarde vers l'avenir.

### Les colonnes de la Fed se choisissent par identifiant

Le relevé H.4.1 compte cent cinquante-sept colonnes, dont les descriptions contiennent des virgules
et peuvent être réécrites. La sélection se fait donc sur les identifiants courts et stables de la
ligne d'en-tête (`RESH4R_N.WW` pour les réserves), jamais sur le libellé ni sur la position. Un
identifiant absent **fait échouer la génération** plutôt que de produire un indicateur muet — ou
pire, de décaler silencieusement sur la mauvaise série.

### La BCE se choisit par nom de colonne, et honore la négociation de contenu

Le portail de données de la BCE rend du SDMX-CSV avec un **en-tête nommé** (`TIME_PERIOD`,
`OBS_VALUE`) : les colonnes s'y choisissent par leur nom, ce qui est encore plus solide que la
sélection par identifiant du CSV de la Fed. La colonne `KEY` répète la clé de série complète et le
parseur la vérifie — si la BCE renommait sa clé, la série serait **vide**, donc arrêtée par la
barrière, plutôt que remplie par les chiffres d'une série voisine.

Un piège qui a coûté un aller-retour : **la BCE honore la négociation de contenu**, contrairement au
Trésor et à la Fed. Le contrôleur de contrat envoie `accept: application/json` par défaut, et
recevait donc du SDMX-JSON — il validait un document que le générateur ne lit jamais. Le contrôle
demande désormais explicitement `text/csv`.

### Les barrières

Le générateur refuse d'écrire si un indicateur obligatoire manque, si une observation est trois fois
plus vieille que sa propre tolérance, si un rang n'est pas calculable, ou si une série est trop
courte pour être tracée. Il ne réécrit rien quand seul l'horodatage change, pour que le diff reste
relisible.

Le cron [`market-data.yml`](../.github/workflows/market-data.yml) tourne **lundi et vendredi** — le
vendredi rattrape le relevé H.4.1 publié le jeudi après-midi à New York. Il valide par
`npm run check` **avant** de committer, puis appelle `ci.yml`, seule à publier sur Pages.

## Confronter le décor à vos chiffres

La section « Vos chiffres face au décor » corrèle les variations quotidiennes de **l'indice de
rendement pondéré temps de votre portefeuille** — celui de [`twr.ts`](../src/lib/domain/twr.ts),
où les apports et retraits sont neutralisés — à celles de chaque indicateur quotidien.

Quatre refus fondent [`correlation.ts`](../src/lib/macro/correlation.ts) : jamais sur les niveaux
(régression fallacieuse), alignement sur les jours communs **avant** différenciation, Spearman
plutôt que Pearson (queues épaisses), et quatre fenêtres fixées d'avance plutôt qu'une choisie après
coup. L'écart entre fenêtres est affiché : c'est lui qui dit si un coefficient veut dire quelque
chose.

La superposition ([`overlay.ts`](../src/lib/macro/overlay.ts)) est optionnelle, à **axe unique**, et
rebasée au premier jour commun aux deux séries. Les séries hebdomadaires — les réserves de la Fed —
sont nommées comme non mesurées : elles n'ont pas assez de points pour une fenêtre de trente jours.

Rien de tout cela n'est calculé sans une action explicite : l'historique de prix nécessaire n'est
pas chargé d'office depuis cet écran.

## Les licences, qui ont décidé de tout

C'est la conclusion la plus utile de cette brique : **la licence d'une source choisit son mode de
transport**, pas la commodité technique.

| Source           | Stockage et redistribution                                                                                                    | Mode         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Réserve fédérale | « in the public domain and may be copied and distributed without permission. Please cite to the Board as the source »         | instantané   |
| BCE              | « users of this website may make free use of the information obtained directly from it… the ECB must be cited as the source » | instantané   |
| EIA              | « U.S. government publications are in the public domain » ; mention recommandée                                               | instantané   |
| Trésor américain | domaine public par défaut (17 U.S.C. § 105) ; aucune clause contraire trouvée, aucune clause explicite lue non plus           | instantané   |
| DefiLlama        | « republish the data in any form without permission » **interdit** ; usage personnel autorisé                                 | appel direct |
| Cboe (VIX)       | « store … in an electronic retrieval system » **interdit** sans accord écrit                                                  | abandonné    |

Toutes sont inscrites au catalogue d'attributions
([`sources.ts`](../src/lib/support/sources.ts)), dont le test croise désormais les instantanés
engendrés : ajouter une source à un générateur casse la CI tant qu'elle n'y figure pas.
