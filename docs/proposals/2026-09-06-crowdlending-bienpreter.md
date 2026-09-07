# Crowdlending — un onglet Prêts, et la question qu'il faut trancher avant

> Proposition du 6 septembre 2026. Question traitée : « Peut-on ajouter un onglet pour intégrer
> mes actifs BienPrêter ? Comment font les meilleurs ? Que donne l'état de l'art, avec une
> architecture prête pour le futur ? »
>
> Méthode : trois recherches **parallèles** menées le 06/09/2026 — données réellement exportables
> de BienPrêter `[B…]`, pratiques des meilleurs outils et métriques de place `[P…]`, fiscalité
> française des prêts participatifs `[X…]` — plus un audit des points d'extension du code. Chaque
> affirmation porte sa source ; ce qui n'a pas pu être vérifié sur source primaire est marqué
> **[INCERTAIN]** ou **[PROBABLE]** et **ne doit pas être codé sans contrôle**.
>
> Ce document ne modifie aucun code. Il propose des décisions.

---

## 1. La question, reformulée

Comme pour la consolidation patrimoniale (proposition du 25/08), la demande recouvre deux choses
qu'il faut cesser de confondre :

1. **La collecte** — récupérer automatiquement la liste des prêts et leur échéancier.
2. **Le modèle et le calcul** — savoir quoi en faire : encours, rendement réel, retard, défaut,
   déclaration fiscale.

Sur la crypto, la réponse était « la collecte est réglée, le modèle est le travail ». **Ici c'est
l'inverse, et c'est le résultat le plus important de cette étude** : le modèle est faisable et
même élégant, la collecte n'est pas démontrée possible (§ 2), et c'est la saisie qui décide de
tout (§ 4).

---

## 2. Ce que BienPrêter permet réellement

### 2.1 Ce n'est pas une créance, c'est un prêt

Le nom commercial est « crowdfactoring », présenté comme « le mariage réussi entre le financement
participatif et l'affacturage classique » `[B3]`. **Le montage juridique dit autre chose.**
L'article 1 des CGU définit l'instrument comme un **« Contrat de prêt »** entre un **« Prêteur »**
et un **« Emprunteur »** `[B2]`. [VÉRIFIÉ] Les mots « créancier », « débiteur » et « cédant »
n'y figurent pas ; « créance » n'apparaît qu'une fois, dans la grille tarifaire, à propos de la
solvabilité du débiteur de la facture `[B1]`.

**Conséquence directe et non cosmétique** : la facture est le **sous-jacent** qui gage le prêt, le
prêteur n'en devient pas cessionnaire. Le modèle de données doit donc s'appeler `Loan`, pas
`Receivable`, et son vocabulaire d'interface doit reprendre celui du contrat — _Prêteur,
Emprunteur, Collecte, Échéance_ `[B2]`. Nommer l'objet « créance » ferait entrer dans le code une
qualification juridique fausse, et fausserait au passage le raisonnement fiscal du § 7, qui repose
précisément sur le régime des **prêts** participatifs.

Éditeur : **ULENDS SAS**, RCS Aix-en-Provence 832 998 108. Plateforme **agréée PSFP par l'AMF sous
le n° FP-2023-38** `[B1]`. [VÉRIFIÉ] C'est un établissement français : par le même mécanisme que
Coinhouse dans `declarations-fr.ts`, un compte BienPrêter serait `excluded-domestic` au regard du
3916-bis.

### 2.2 Mécanique

| Paramètre      | Valeur                                                  | Source             |
| -------------- | ------------------------------------------------------- | ------------------ |
| Ticket minimum | 20 €                                                    | `[B3]` [PROBABLE]  |
| Taux prêteur   | **8 % à 15 %** brut annuel                              | `[B1]` [VÉRIFIÉ]   |
| Amortissement  | **« prêt amortissable ou In Fine »** selon le projet    | `[B1]` [VÉRIFIÉ]   |
| Périodicité    | intérêts « généralement versés chaque mois »            | `[B3]` [INCERTAIN] |
| Commission     | 3 % à 11 % du collecté, **à la charge de l'emprunteur** | `[B1]` [VÉRIFIÉ]   |
| Frais Lemonway | 1,02 % HT de la collecte, emprunteur                    | `[B1]` [VÉRIFIÉ]   |
| IFU            | mis à disposition chaque année, art. 8 des CGU          | `[B2]` [VÉRIFIÉ]   |

Le fait que **les deux modes d'amortissement coexistent** est structurant : le modèle ne peut pas
présupposer l'un ou l'autre, il doit porter un champ explicite (§ 5.2).

### 2.3 Ce qui est récupérable — et ce qui ne l'est pas

| Donnée                            |      Export      |     IFU      | Écran seul | Statut                |
| --------------------------------- | :--------------: | :----------: | :--------: | --------------------- |
| Contrat de prêt par projet        | PDF **unitaire** |      —       |     —      | Confirmé `[B4]`       |
| Échéancier de remboursement       |        —         |      —       |     ✔      | Confirmé `[B4]`       |
| Intérêts perçus dans l'année      |        —         |      ✔       |     ✔      | Confirmé `[B2]`       |
| Solde du portefeuille (Wallet)    |        —         |      —       |     ✔      | Confirmé `[B2]`       |
| Historique d'opérations groupé    | **non confirmé** |      —       |     ✔      | Signal faible `[B5]`  |
| **API / webhook**                 |        —         |      —       |     —      | **Non trouvé** `[B4]` |
| Cases fiscales précises sur l'IFU |        —         | non confirmé |     —      | **Non trouvé**        |

**Verdict.** Aucune API et aucun export CSV/XLSX officiellement documenté n'ont été trouvés sur
les canaux publics. Un fil d'investisseurs mentionne un export BienPrêter utilisé dans un outil
communautaire, décrit comme riche mais peu structuré — « plusieurs lignes par écriture : capital,
intérêt, retenue fiscale » `[B5]`. [INCERTAIN] **L'absence de preuve n'est pas la preuve de
l'absence** : la recherche s'est délibérément arrêtée aux pages publiques, sans connexion à
l'espace investisseur. C'est exactement la question à trancher (§ 11).

### 2.4 Le taux de défaut affiché ne doit jamais être repris tel quel

La page d'indicateurs affiche **0,00 % de taux de défaut** pour 421 M€ financés et 4 921 projets
depuis 2018, avec un TRI net de 12,42 % `[B6]`. [VÉRIFIÉ — pour l'affichage, pas pour le fond]

Ce chiffre n'est pas une donnée de risque, c'est **une convention de calcul non explicitée**. Le
baromètre du crowdfunding publié par France FinTech et Forvis Mazars documente la coexistence de
**deux définitions concurrentes** du taux de défaut — rapporté à l'ensemble des projets financés
depuis l'origine, ou au seul capital encore en cours — qui donnent des pourcentages très
différents pour un même portefeuille `[P7]`. [PROBABLE — méthodologie à relire dans le PDF source]

**Règle qui en découle, et qui est une règle de justesse, pas de prudence commerciale :**
l'application n'affiche **jamais** le taux de défaut communiqué par une plateforme. Elle affiche
ce qu'elle sait calculer sur les prêts de l'utilisateur, avec son dénominateur nommé à l'écran.
C'est la transposition directe de la décision n° 9 (un chiffre non calculable ne vaut pas zéro).

### 2.5 Addendum du 06/09/2026 — l'export existe, et voici sa forme

Le § 2.3 concluait « non démontré ». **Il l'est désormais** : l'espace investisseur produit bien un
export (`transactions_<nom>_<horodatage>.csv`), obtenu le jour même. Il faut le demander **sans
filtre** — un premier export filtré ne contenait que les six dépôts de fonds.

**Forme.** 11 colonnes, séparateur `;`, UTF-8 sans BOM, dates `dd/MM/yyyy`, décimales à la virgule :
`Opération`, `N°Contrat`, `Projet`, `Entreprise`, `Date`, `Montant`, `Remarques`,
`Capital remboursé`, `Intérêts remboursés`, `Prélèvements fiscaux et sociaux`, `Montant net`.
Neuf libellés d'opération observés, dont cinq de remboursement.

**La plateforme ventile elle-même capital / intérêt / prélèvement, ligne par ligne.** C'est mieux
qu'espéré : l'assiette fiscale du § 7 et le TRI brut comme net se calculent sans aucune hypothèse.

**Trois pièges, tous constatés sur l'export de référence (1 425 lignes, 116 prêts) :**

1. **`Montant` change de sens en cours d'historique.** Ancien flux (`Remboursement mensuel`,
   jusqu'au 07/09/2025) : montant NET, 551/551. Nouveau flux (`… (new)`, depuis le 08/08/2025) :
   BRUT capital + intérêts, 589/589. On ne lit donc jamais cette colonne sur un remboursement.
2. **Un remboursement anticipé est éclaté en plusieurs lignes au même (contrat, date)** — une porte
   le capital, les autres les intérêts période par période. 36 groupes concernés ; dédoublonner sur
   ce couple perdrait des intérêts.
3. **Le même impôt figure deux fois** depuis le nouveau flux : dans la colonne ventilée ET comme
   débit autonome du portefeuille (131,28 € des deux côtés en 2025). La colonne fait foi.

**Ce que l'export ne contient pas** : taux nominal, échéance, convention de jours, mode
d'amortissement — et aucun événement de retard ou de défaut. **Cette limite est levée par le
§ 2.6** : les contrats, eux, les écrivent.

**Contrôle sur l'export de référence** : 116 prêts, 1 328 événements, 0 libellé inconnu,
0 incohérence, 0 orphelin. Encours 13 796,85 € ; intérêts bruts 3 210,81 €, prélèvements 943,64 €.
**TRI brut 14,19 %, TRI net 9,87 %** — la valeur terminale excluant l'intérêt couru, ces deux taux
sont légèrement prudents.

### 2.6 Les contrats disent ce que le relevé tait

Une **déduction** des termes à partir des seuls remboursements a d'abord été tentée, puis
écartée : sur le portefeuille réel elle ne convergeait — écart résiduel sous 2 % — que pour 27
prêts sur 102, et le modèle qui s'ajuste le mieux (intérêts sur le capital initial, taux annuel
÷ 12) laissait la moitié des prêts inexpliqués. Un taux faux gonfle silencieusement la valeur du
portefeuille ; l'absence, elle, se voit.

**Les contrats sont téléchargeables en archive depuis l'espace investisseur**, un PDF par prêt,
nommé par son numéro de contrat — donc directement rapprochable de l'export. Ils portent tout ce
qui manquait, écrit noir sur blanc : taux (art. 3 et 5.1), durée, **base de calcul** — « année
civile » sur les 113 contrats lus, soit ACT/365 — et, en annexe, **l'échéancier attendu daté**.

Vérification arithmétique du modèle : un prêt de 300 € à 15 % sur 15 mois annonce 56,25 €
d'intérêts totaux, soit `300 × 15 % × 15/12`. Les intérêts se calculent donc bien sur le capital
initial, au douzième du taux annuel — ce que la déduction avait trouvé, et que le contrat confirme.

**Lire un PDF sans dépendance.** `pdf.js` pèse plusieurs centaines de kilo-octets pour un usage
qui ne concerne qu'un producteur connu. Un lecteur minimal a donc été écrit sur le parti de
`import/xlsx` : `DecompressionStream` natif, balayage linéaire des objets, tables `ToUnicode`. Il
couvre le cas droit et **refuse en le nommant** ce qu'il ne couvre pas (document chiffré, objets
en `/ObjStm`). Éprouvé sur 113 contrats : 113 lus sans erreur, et les taux extraits recoupent
exactement ceux de poppler.

**Ce que cela débloque, mesuré** : les prêts sans intérêt couru calculable passent de 54 à 3, et
le retard cesse d'être hors de portée — il se déduit de la comparaison entre l'échéancier
contractuel et les encaissements, sans qu'aucun signalement soit nécessaire.

---

## 3. Ce que font les meilleurs

| Outil                     | Modèle                                                            | Métrique principale                                                      | Défaut                                                                                                 |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Portfolio Performance** | comptes + titres + transactions datées ; **pas de type « prêt »** | **TTWROR et IRR affichés côte à côte, délibérément** `[P1]`              | non documenté                                                                                          |
| **Ghostfolio**            | `Activity` typée `BUY/SELL/DIVIDEND/FEE/INTEREST/LIABILITY`       | —                                                                        | `INTEREST` et `LIABILITY` **exclus** des positions closes `[P2]`                                       |
| **Mintos**                | prêts agrégés par originateur / pays                              | **NAR** = XIRR retraité de la composition, cash non investi exclu `[P3]` | intégré **a posteriori** au NAR                                                                        |
| **Bondora**               | prêts à échéancier individuel                                     | **XIRR calculé quotidiennement** `[P4]`                                  | principal en retard **passé en perte immédiatement** ; « aucune provision pour pertes futures » `[P4]` |
| **Beancount / Ledger**    | comptes + écritures datées **append-only**                        | aucune imposée                                                           | à la main, via un compte de créances douteuses                                                         |
| **Finary**                | synchronisation crowdlending réclamée par la communauté           | non documenté publiquement `[P6]`                                        | non documenté                                                                                          |

### Trois enseignements

**1. Personne n'a d'objet « prêt » de première classe.** Ni Ghostfolio ni Finary n'exposent
publiquement un prêt avec échéancier, ventilation capital/intérêt et statut de retard. Ghostfolio
va jusqu'à **jeter** le type `LIABILITY` à l'import. C'est un espace vide dans le paysage, et donc
un argument pour construire un onglet dédié plutôt que de forcer un prêt dans un moule de titre
coté.

**2. Le secteur affiche du brut, ajusté après coup — pas de provision.** Bondora l'écrit
explicitement `[P4]`. Aucun acteur P2P examiné n'implémente un provisionnement prospectif à la
IFRS 9. C'est cohérent : une provision _expected credit loss_ suppose une probabilité de défaut et
une perte en cas de défaut par emprunteur, données qu'un particulier n'a pas. **Modéliser un ECL
ici produirait un chiffre arbitraire déguisé en rigueur comptable.**

**3. Beancount est le seul modèle qui sépare structurellement le contractuel du réel** — l'intérêt
couru est une écriture distincte du règlement, soldée à l'encaissement `[P5]`. C'est très
exactement le nœud d'un prêt de crowdlending, et c'est le patron à copier (§ 5.3).

---

## 4. Le point dur n'est pas le modèle, c'est la saisie

La proposition du 25/08 concluait, pour les actions et l'immobilier, que « le point dur n'est pas
le modèle, ce sont les prix » (§ 6.2). **Pour le crowdlending, ce verrou n'existe pas** : un prêt
n'a pas de cours. Sa valeur est le capital restant dû, qui est une **soustraction**, pas une
estimation. Aucun fournisseur de prix, aucune sonde CORS, aucune clé d'API.

Le verrou s'est déplacé d'un cran : **il est dans la saisie**. Sans export, chaque prêt doit être
saisi. Avec un ticket minimum de 20 € `[B3]`, un portefeuille diversifié se compte facilement en
dizaines, voire en centaines de lignes — et chaque ligne porte un échéancier.

C'est la seule variable qui décide si ce chantier vaut trois sessions ou s'il ne vaut rien :

- **Moins de ~40 prêts, ou un export existe** → la saisie assistée est acceptable, le chantier a
  du sens.
- **Plusieurs centaines de prêts sans export** → un formulaire manuel est une promesse
  intenable. Il faudrait alors traiter d'abord la question de l'extraction, et l'onglet
  n'arriverait qu'après.

Aucune recherche documentaire ne peut trancher cela : la réponse est dans l'espace personnel de
l'utilisateur. C'est le point 1 du § 11.

---

## 5. Une quatrième forme d'actif : le prêt amortissable

### 5.1 Le miroir du passif — et ce que ça change au ROI

La proposition du 25/08 pose trois formes (§ 6.1) : **fongible à lots** (crypto, actions),
**valorisé** (immobilier, AV, PER — `ValuationEvent`, lot P36), **passif** (crédit immobilier,
prêt conso — « capital restant dû daté, échéancier », lot P37).

Un prêt BienPrêter n'entre proprement dans aucune des trois. Ce n'est pas un fongible : pas de
quantité, pas de cours, pas de PRU. Ce n'est pas un « valorisé » : sa valeur ne se saisit pas à la
main, elle **se calcule**. Et c'est un actif, pas un passif.

**Mais regardez la ligne « passif » : « capital restant dû daté, échéancier ». C'est mot pour mot
la définition d'un prêt de crowdlending, au signe près.** Un crédit immobilier que l'on rembourse
et un prêt participatif que l'on encaisse sont **le même objet vu des deux côtés du contrat**.

Conséquence stratégique, et c'est l'argument le plus fort de cette proposition : **construire
`domain/lending/` livre P37 presque gratuitement.** P37 était chiffré à 1,5 session pour un ROI de
6,7 ; s'il se réduit à instancier le moteur des prêts avec un signe opposé et une entrée dans le
terme de passif de la décision n° 51, il tombe à une demi-session. Le chantier ne s'ajoute pas à
la feuille de route patrimoniale : **il en avale une partie.**

### 5.2 Modèle de données

**Champs du prêt** — statiques, décidés à la souscription :

| Champ          | Type                                              | Pourquoi                                                                         |
| -------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `id`           | identifiant opaque                                | clé stable ; le nom d'un projet peut changer                                     |
| `platform`     | énumération                                       | rattache à un IFU, à une convention de jours, à un risque de contrepartie propre |
| `borrower`     | chaîne                                            | base du calcul de concentration par emprunteur                                   |
| `principal`    | `DecimalString`                                   | flux négatif initial du TRI ; **jamais un `number`**                             |
| `rate`         | `DecimalString`                                   | reconstitue l'échéancier théorique si la plateforme ne le détaille pas           |
| `dayCount`     | `'act/365' \| 'act/360' \| '30/360' \| 'unknown'` | **`unknown` est une valeur, pas un défaut silencieux** (§ 6.4)                   |
| `subscribedAt` | `NaiveDateTime`                                   | départ des flux et du décompte de retard                                         |
| `maturity`     | `NaiveDateTime \| null`                           | référence pour distinguer un remboursement normal d'un retard                    |
| `amortisation` | `'in-fine' \| 'linear' \| 'constant' \| 'bullet'` | BienPrêter pratique les deux premiers `[B1]` — impossible de présupposer         |
| `currency`     | ISO 4217                                          | EUR chez BienPrêter, mais Mintos est multi-devises                               |

**Événements datés** — append-only, jamais modifiés :

| Événement              | Porte                                                   | Pourquoi                                                                                |
| ---------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `subscription`         | date, montant décaissé                                  | flux négatif réel du TRI                                                                |
| `scheduled` _(dérivé)_ | date, capital et intérêt attendus                       | **référence de comparaison, jamais un flux réel**                                       |
| `repayment`            | date réelle, montant, **ventilation capital / intérêt** | flux positif du TRI ; seule la part d'intérêt est un revenu de capitaux mobiliers (§ 7) |
| `late`                 | date de constat                                         | alimente un indicateur de risque, ne déplace aucun flux                                 |
| `default`              | date, capital restant                                   | signal de risque — **n'ouvre pas encore le droit fiscal**                               |
| `writeOff`             | date, **nature de la preuve**                           | **seul événement qui ouvre l'imputation** au sens de l'art. 125-00 A (§ 7)              |
| `recovery`             | date, montant                                           | flux positif postérieur au défaut, réduit la perte imputable                            |
| `secondarySale`        | date, montant                                           | réalise immédiatement le résultat, se substitue au remboursement                        |

### 5.3 Le statut se dérive, il ne se stocke pas

« En retard », « en défaut » ne sont **pas** des champs. Ce sont des conclusions tirées de la
comparaison entre `scheduled` et `repayment`. C'est le mécanisme de Beancount `[P5]` transposé, et
c'est la seule protection contre le piège n° 4 du § 6.5 : une vérité stockée qu'on oublie de
recalculer.

Le projet a déjà exactement ce réflexe ailleurs — le statut d'une opération non qualifiée se
dérive du grand livre, il ne se saisit pas.

---

## 6. Métriques : le TRI, et rien d'autre par défaut

### 6.1 Pourquoi pas le TWR

Le TWR exige une valorisation à chaque flux. Un prêt n'a pas de cours : il faudrait **inventer** un
prix de marché à J+15. Les GIPS du CFA Institute attendent au contraire un **rendement pondéré par
les flux (MWR)** pour les portefeuilles fermés, à durée fixe, ou dont les actifs illiquides sont
une part significative de la stratégie — précisément quand c'est l'investisseur qui contrôle les
dates `[P9]`. [VÉRIFIÉ] Le CFA Institute a même publié un argumentaire contre le TWR pour les
actifs alternatifs illiquides `[P9]`.

Mintos et Bondora font tous deux le même choix `[P3]` `[P4]`. **Le TRI est la métrique honnête ;
`twr.ts` reste hors de ce périmètre.**

### 6.2 `xirr.ts` convient déjà, sans modification

`xirrEur(flows, valuation)` ne connaît que `{ at, amountEur }` et une valeur terminale. Un
portefeuille de prêts, c'est exactement cela : versements négatifs, remboursements positifs,
capital restant dû en valeur terminale. **Aucune dépendance à la notion d'actif fongible.** C'est
la brique la plus mûre du projet qui se trouve être la bonne, et ce n'est pas un hasard : elle a
été écrite pour des flux, pas pour des cryptos.

Les échecs typés existants (`insufficient-flows`, `same-sign`, `too-recent`, `no-convergence`)
couvrent déjà les pièges de place : TRI non défini quand tous les flux sont de même signe, non
convergence quand les flux changent de signe plusieurs fois `[P1]`.

### 6.3 Trois chiffres, jamais fusionnés

Bondora définit l'encours comme « la totalité des investissements moins les remboursements de
principal perçus » `[P4]` — une soustraction, sans jugement de valeur. L'écran doit distinguer :

1. **Capital cumulé investi** — la référence historique ;
2. **Capital restant dû** — l'encours, dérivé des remboursements pointés ;
3. **Valorisation** — encours + intérêts courus non échus.

Les confondre est le piège n° 1 du § 6.5.

### 6.4 La convention de jours n'est pas une constante

ACT/365 et 30/360 coexistent `[P11]`, et une source secondaire rapporte que Lendix calculait ses
intérêts mensuels en taux annuel × 30/365 plutôt qu'en taux/12 `[P11]`. [INCERTAIN] La convention
**varie d'une plateforme française à l'autre** et ne doit jamais être supposée : sans elle,
l'intérêt couru affiché ne recollera pas à l'IFU reçu en fin d'année. D'où `dayCount: 'unknown'`
comme valeur explicite, affichée comme telle.

### 6.5 Les cinq pièges qui font qu'un tracker de crowdlending ment

1. **Confondre taux nominal et rendement encaissé.** Un prêt à 12 % avec des remboursements en
   retard, partiels, ou du cash non réinvesti, rend beaucoup moins. Mintos exclut explicitement le
   cash non investi de son NAR pour cette raison `[P3]`.
2. **Dater la perte fiscale au défaut** plutôt qu'à l'irrécouvrabilité définitive (§ 7).
3. **Appliquer une convention de jours non déclarée** (§ 6.4).
4. **Ne pas recalculer l'encours** après un remboursement anticipé ou partiel.
5. **Confondre risque emprunteur et risque plateforme.** Un défaut d'emprunteur et une défaillance
   de plateforme sont deux événements de nature juridique différente. Un indice de concentration
   qui ne mesure que l'exposition par emprunteur passe à côté d'un risque documenté par les
   faillites passées du secteur — d'où le calcul du HHI **à deux niveaux**, emprunteur et
   plateforme `[P8]`.

---

## 7. Fiscalité — un module distinct, et une date qui n'est pas celle qu'on croit

### 7.1 Ce n'est pas une extension de `tax-fr.ts`

`tax-fr.ts` est entièrement bâti sur l'art. 150 VH bis : méthode du portefeuille global, prix
total d'acquisition, sursis crypto↔crypto. Les intérêts de prêts participatifs relèvent des
**revenus de capitaux mobiliers**, un régime sans aucun point commun. Il faut un module distinct —
`tax-fr-lending.ts` — et non une variante. Seule la table `TAX_RATES` est partageable.

### 7.2 L'imputation des pertes : l'article, et sa condition

**Base légale, lue directement sur Légifrance** : article **125-00 A du CGI**, version en vigueur
**du 01/01/2023 au 01/01/2027** — donc **applicable en 2026** `[X1]`. [VÉRIFIÉ]

- **Champ** : prêts consentis dans le cadre du financement participatif (art. L.511-6 7° et 7° bis
  du CMF) et prêts à titre gratuit de l'art. L.548-1.
- **Déclencheur** : la perte n'est imputable qu'à partir de l'année où la créance devient
  **« définitivement irrécouvrable »**.
- **Assiette** : intérêts perçus sur des prêts **de même nature**, la même année ou **les cinq
  années suivantes**.
- **Plafond** : **8 000 € par an**.

**La condition, précisée par le BOFiP** `[X2]` [VÉRIFIÉ] : la notion renvoie à l'art. 272 du CGI,
et la preuve résulte de **l'échec de poursuites engagées** contre le débiteur. **Le simple impayé
à l'échéance ne suffit pas**, quelle qu'en soit la cause. Sont admises en pratique une
indemnisation d'assurance-crédit, la disparition du débiteur, un paiement par chèque volé.

**Voilà pourquoi le modèle du § 5.2 sépare `default` de `writeOff`.** Ce n'est pas de la
sur-modélisation : imputer à la date du défaut expose à un redressement, et ne jamais imputer
faute de suivre cet événement séparément coûte de l'argent à l'utilisateur. **Un tracker qui ne
porte qu'un seul statut « en défaut » se trompe forcément d'un côté ou de l'autre.**

### 7.3 Ce que le moteur doit calculer

- Intérêts bruts perçus par année civile, par nature de prêt.
- Acomptes de 12,8 % et prélèvements sociaux déjà retenus à la source.
- **Un stock de pertes en report** : les pertes nouvellement irrécouvrables de l'année, plafonnées
  à 8 000 €, avec report du solde sur cinq ans. **C'est un état persisté, pas une somme
  annuelle** — la seule vraie difficulté algorithmique du module.

### 7.4 Deux points à vérifier avant de coder

- **Le taux du PFU.** Les sources secondaires annoncent 31,4 % au 01/01/2026 (CSG de 9,2 % à
  10,6 %) `[X3]`. [INCERTAIN sur source primaire] Le projet porte **déjà** 31,4 % dans
  `TAX_RATES` : c'est cohérent, mais la valeur doit être reconfirmée sur BOFiP au moment du
  développement, conformément à la règle du § 9 de la proposition du 25/08.
- **Les numéros de cases** de la 2042 (2TT, 2CK, 2CG, 2OP) proviennent de guides spécialisés, pas
  du formulaire officiel `[X3]`. [INCERTAIN] À recouper sur le formulaire de l'année d'imposition
  avant tout affichage.

### 7.5 Un service rendu, presque gratuit

La dispense d'acompte de 12,8 % est ouverte si le revenu fiscal de référence N-2 est inférieur à
**25 000 € (seul) / 50 000 € (couple)**, sur attestation à remettre **avant le 30 novembre** de
l'année précédente, à renouveler chaque année `[X3]`. [VÉRIFIÉ]

Le mécanisme d'alertes existe déjà (`alerts.ts`). Une échéance annuelle au 30 novembre est un coût
marginal et une valeur réelle — c'est le genre de détail que ni Finary ni les plateformes ne
rendent.

---

## 8. Ce qu'on ne fait pas

- **Pas de scraping de l'espace connecté.** Les CGU concèdent un accès « personnel, gratuit, non
  exclusif et non transférable » et excluent tout autre usage sans accord écrit `[B2]` ; les
  mentions légales limitent la réutilisation à des fins personnelles non commerciales `[B1]`. Le
  `robots.txt` ne bloque pas le crawl public `[B7]`, mais l'espace investisseur n'a pas été
  exploré et ne doit pas l'être par un robot.
- **Pas de parsing des contrats PDF** en v1. Faisable, mais c'est un chantier à part entière pour
  un gain qui dépend entièrement de la réponse au § 11.
- **Pas de provisionnement IFRS 9.** Aucun acteur du secteur ne le fait `[P4]`, et un ECL sans PD
  ni LGD est un chiffre inventé (§ 3).
- **Pas de TWR sur les prêts** (§ 6.1).
- **Pas de passage par le format pivot.** `RawPivotRow` modélise un échange instantané entre deux
  quantités d'actifs fongibles ; `LedgerEvent` est une union fermée bâtie sur `Leg { asset, qty }`.
  Dégrader un prêt en `deposit` + `reward` + `withdrawal` perdrait l'échéancier, l'encours et le
  statut — c'est-à-dire tout ce qui fait la valeur du crowdlending. **Précédent parlant** :
  l'importeur Ghostfolio jette déjà le type `LIABILITY` comme « hors modèle ».
- **Pas d'affichage du taux de défaut de la plateforme** (§ 2.4).

---

## 9. Architecture d'intégration

**Un second moteur pur, pas une extension du premier.** `src/lib/domain/lending/` sur le patron
déjà éprouvé de `src/lib/domain/trading/` : types propres (`Loan`, `LoanEvent`, `LendingSnapshot`),
`compute.ts`, vocabulaire volontairement distinct — **jamais de PRU ici**, pas de `Leg`. Le projet
a déjà validé ce patron une fois ; c'est un précédent, pas un pari.

**Réutilisé tel quel** : `xirr.ts` (§ 6.2), `csv.ts`, le patron de dédoublonnage par empreinte,
`Money.svelte`, `Delta.svelte`, `Pct.svelte`, `Sheet.svelte`, `EvolutionChart.svelte` (agnostique
de la classe d'actif — l'encours dans le temps, et la bande « attendu vs réalisé » via `band`),
`AllocationDonut.svelte` pour la concentration.

**Persistance** : un conteneur `lending` à la racine de `StoredStateV1`. **Additif, donc sans bump
de schéma** — mais le test de complétude de `storage.test.ts` exigera une décision explicite dans
`mergeStates()` (données unifiées par clé, réglages conservés localement). Étape obligatoire.

**Navigation — le vrai arbitrage.** Deux options :

|             | Sous-espace d'Investissement (`#/invest/loans`) | 5ᵉ espace « Prêts »                                                                                          |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Coût        | routes + écrans                                 | + `spaces.ts`, `BottomNav` (grille `repeat(4,1fr)` en dur), `ARCHITECTURE.md`, `nav.spec.ts`, `a11y.spec.ts` |
| Vocabulaire | mélangé avec le PRU crypto sous le même accent  | distinct, comme Trading                                                                                      |
| Coût caché  | aucun                                           | **consomme le dernier emplacement** : une barre d'onglets tient 5 entrées, « Plus » en occupe déjà une       |

**Recommandation : commencer en sous-espace d'Investissement.** C'est réversible, ça ne casse
aucune liste vérifiée, et ça n'engage pas le dernier emplacement de navigation pour une classe
d'actif dont on ne sait pas encore le volume (§ 4). La promotion en espace propre se décide quand
une deuxième classe non-crypto arrive — et à ce moment-là, l'espace s'appelle « Patrimoine », pas
« Prêts ».

**Auto-vérification à ajouter** : `Σ capital restant dû = Σ versé − Σ capital remboursé`, sur le
patron du bloc `invariant` de `self-check.ts`, avec inscription dans la liste vérifiée
d'`ARCHITECTURE.md` (sans quoi la CI échoue). Contre-épreuve obligatoire, décision n° 75.

---

## 10. Propositions classées par ROI

Barème identique à `docs/ROADMAP.md`. Les lots P96 à P99 sont libres.

| #       | Proposition                                                                     | Valeur | Fiab. | Satisf. | Sessions |   ROI   |
| ------- | ------------------------------------------------------------------------------- | :----: | :---: | :-----: | :------: | :-----: |
| **P37** | **Passif et valeur nette — révisé** : réutilise le moteur de P96, au signe près |   4    |   2   |    4    | **0,5**  | **20**  |
| P99     | Concentration à deux niveaux (HHI emprunteur **et** plateforme)                 |   3    |   2   |    3    |   0,5    | **16**  |
| P98     | Import CSV BienPrêter _best-effort_ — **conditionné au § 11**                   |   4    |   2   |    4    |   1,5    | **6,7** |
| P97     | Fiscalité des prêts : 125-00 A, stock de pertes en report, alerte dispense      |   4    |   4   |    3    |    2     | **5,5** |
| P96     | **Moteur `domain/lending/` + onglet Prêts + saisie assistée**                   |   5    |   3   |    4    |    3     | **4,0** |

**L'ordre d'exécution n'est pas l'ordre du ROI** : P96 est le socle, tout le reste en dépend. La
lecture juste du tableau est que **P96 rend trois autres lots presque gratuits**, dont un (P37) qui
était déjà planifié à 1,5 session. Coût net réel du chantier complet : environ **6 sessions**,
dont une déjà provisionnée ailleurs.

---

## 11. Ce que vous devez décider

1. **Combien de prêts détenez-vous, et votre espace personnel propose-t-il un export ?**
   C'est la question qui commande tout (§ 4). Aucune recherche ne peut y répondre : il faut
   ouvrir « Opérations » et regarder. Si un export existe, ramenez-en l'en-tête — pas le contenu,
   qui ne doit jamais entrer dans git.
2. **Trancher la contradiction du dépôt.** La proposition du 25/08 prépare l'accueil des actifs
   non-crypto (décision n° 51, « dépense d'avance » assumée) ; le réaudit du 01/09, plus récent,
   recommande la retenue — « ne pas ajouter actions et immobilier » — au nom du mainteneur unique.
   **Aucune décision numérotée n'a arbitré.** Le crowdlending n'est nommé nulle part. Mon avis :
   le verdict de retenue visait des classes bloquées sur un fournisseur de prix externe ; le
   crowdlending n'a pas ce défaut (§ 4), et il rend P37 quasi gratuit (§ 5.1). L'argument de
   retenue s'applique mal ici — mais c'est un arbitrage produit, pas technique.
3. **Navigation** : sous-espace d'Investissement (recommandé) ou 5ᵉ espace.
4. **Périmètre v1** : BienPrêter seul, ou modèle multi-plateformes dès le départ ? Le modèle du
   § 5.2 est déjà générique ; ne coder qu'une plateforme ne ferait rien gagner.

---

## Sources

Toutes consultées le 06/09/2026.

**BienPrêter et plateformes françaises**
`[B1]` bienpreter.com/mentions-legales ; bienpreter.com/tarifs ; pied de page de bienpreter.com
(agrément PSFP AMF n° FP-2023-38, ULENDS SAS) — `[B2]` bienpreter.com/cgu (art. 1 définitions,
art. 7 défaillance, art. 8 IFU, art. 15 propriété intellectuelle, art. 16 ; version du 29/10/2025)
— `[B3]` bienpreter.com ; bienpreter.com/crowdfactoring-le-modele-bienpreter — `[B4]`
help.bienpreter.com (contrats PDF unitaires, section Échéances, IFU dans « Banque et fiscalité »)
— `[B5]` argent-et-salaire.com/forum (fil sur les exports CSV/XLSX des plateformes de
crowdlending — témoignages d'utilisateurs, **pas de source officielle**) — `[B6]`
bienpreter.com/statistiques — `[B7]` bienpreter.com/robots.txt

**Outils, métriques et pratiques de place**
`[P1]` help.portfolio-performance.info/en/concepts/performance (TTWROR et IRR côte à côte) —
`[P2]` github.com/ghostfolio/ghostfolio ; discussion #2607 (exclusion de `INTEREST`/`LIABILITY`) —
`[P3]` help.mintos.com (Net Annualized Return) ; mintos.com/en/security/diversification-returns —
`[P4]` help.bondora.com (XIRR ; « no provisions are made for future losses » ; définition de
l'_outstanding principal_) — `[P5]` beancount.io (guide des charges à payer) ;
github.com/beancount/beancount (exemple `basic.beancount`) — `[P6]` community.finary.com ;
help.finary.com (synchronisation crowdlending) — `[P7]` francefintech.org/barometre-2025-du-
crowdfunding-en-france (baromètre France FinTech × Forvis Mazars ; **méthodologie du taux de
défaut à relire dans le PDF source**) — `[P8]` bankunderground.co.uk (HHI et risque de
concentration, rapport BCBS 2019 cité) — `[P9]` cfainstitute.org (aperçu des GIPS) ; CFA Digest,
« The Case against Time-Weighted Return for Alternative Investments » — `[P10]`
spec.edmcouncil.org/fibo (modules LOAN — retenu comme **inspiration de nommage**, pas comme format)
— `[P11]` fr.wikipedia.org/wiki/Convention_de_base ; crowdlending.fr/forums (convention 30/365
rapportée pour Lendix — **forum, à recouper**)

**Fiscalité**
`[X1]` legifrance.gouv.fr — CGI art. 125-00 A, version en vigueur du 01/01/2023 au 01/01/2027
(LEGIARTI000044564425) — `[X2]` bofip.impots.gouv.fr — BOI-RPPM-RCM-20-10-20-30 (créance
définitivement irrécouvrable, renvoi à l'art. 272 du CGI) — `[X3]`
impots.gouv.fr et service-public.gouv.fr (dispense de prélèvement forfaitaire non libératoire,
seuils de RFR, échéance du 30 novembre) ; legifiscal.fr ; comparateur-crowdlending.fr et
indexp2p.fr (**sources secondaires** pour le taux de 31,4 % et les numéros de cases —
non confirmés sur source primaire)
