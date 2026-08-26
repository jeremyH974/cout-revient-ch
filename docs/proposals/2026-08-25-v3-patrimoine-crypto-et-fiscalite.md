# V3 — Le patrimoine crypto complet et sa fiscalité

> Proposition du 25 août 2026. Elle resserre le périmètre esquissé dans
> [`2026-08-25-consolidation-patrimoniale.md`](2026-08-25-consolidation-patrimoniale.md) : plutôt
> qu'un « Finary local » qui diluerait l'app, une V3 qui va au bout d'**une** chose que personne
> ne fait.
>
> Méthode : trois recherches documentaires parallèles du 25/08/2026 — `[R…]` rotki et moteurs
> fiscaux open source, `[L…]` mécanique du 150 VH bis **sur sources primaires** (Légifrance,
> BOFiP, impots.gouv.fr), `[D…]` réconciliation multi-plateformes et DAC8/CARF — plus un audit du
> code. La recherche marché du 25/08 (acteurs, architecture local-first, normes de performance)
> reste valide et n'a pas été refaite.
>
> **Révision du 26/08/2026.** Les deux vérifications que la recherche automatique n'avait pas
> abouties ont été menées directement : le **CERFA 16043\*07 a été téléchargé et lu intégralement**,
> notice comprise, et l'**art. L. 136-8 du code de la sécurité sociale a été lu sur Légifrance**.
> Elles ont corrigé deux points de fond de la première version — l'asymétrie des frais dans la
> formule (§ 4.1) et la maille du foyer fiscal (§ 4.2) — et certifié le taux (§ 4.5). Les sections
> concernées portent la mention de ce qui a changé.
>
> **Seconde révision du 26/08/2026.** Trois recherches parallèles supplémentaires ont fermé les
> zones d'ombre restantes : `[R5…R10]` le traitement des actifs reçus sans achat et le sort des NFT
> après MiCA (§ 4.7), `[U…]` l'expérience d'un parcours de revue guidée (§ 6.1), `[P…]` les cours
> historiques profonds, **avec sondes CORS réelles** (§ Pilier 3). Le risque technique n° 1 est levé
> et l'effort passe de 14 à 16 sessions.
>
> **Avertissement de rigueur.** Ce document contient du droit fiscal. Chaque règle porte son
> niveau de vérification. Rien de marqué [PROBABLE] ou [INCERTAIN] ne doit être codé comme une
> constante silencieuse. Un moteur fiscal qui affiche un chiffre faux est pire qu'un moteur qui
> n'affiche rien.

---

## 1. Le périmètre, en une phrase

> **Tout ce que l'utilisateur détient en crypto, où que ce soit, et l'impôt français qui en
> découle.**

Ce que la V3 **est** : la consolidation de tous les crypto-actifs du **foyer fiscal**, quelle que
soit la plateforme, et le calcul de l'article 150 VH bis avec ses annexes déclaratives.

Ce que la V3 **n'est pas** : des actions, des ETF, de l'assurance-vie, de l'immobilier, un passif,
une synchronisation multi-appareils. Tout cela reste dans l'espace de possibles du document
précédent, en V4 conditionnelle.

**Conséquence heureuse de ce resserrage** : l'« actif valorisé » (`ValuationEvent`), qui était la
brique la plus lourde et la plus risquée du plan large, **n'est plus nécessaire**. Tout ce qui est
crypto est fongible, et le moteur actuel gère déjà les actifs fongibles. Trois sessions économisées
et le changement de modèle le plus risqué reporté.

---

## 2. Le vide concurrentiel est vérifié, plus supposé

C'est le fait qui justifie la V3.

- **rotki**, le concurrent le plus proche par le positionnement (local, chiffré, open source),
  propose **FIFO, LIFO, HIFO et ACB** `[R1]`. [VÉRIFIÉ] Aucune de ces méthodes n'est la méthode
  française. rotki ne peut pas produire un 2086 correct.
- **rotki est devenu cher en octobre 2025** : offre Basic à **25 €/mois TTC**, gratuit limité à
  **deux semaines d'historique** `[R2]`. [VÉRIFIÉ] Plus une installation Electron + backend Python
  à maintenir, et des tickets ouverts de double comptage de soldes et d'erreurs de synchronisation
  `[R3]`. [VÉRIFIÉ]
- **RP2 / DaLI**, le moteur fiscal crypto open source de référence, a des plugins dédiés pour
  **quatre pays** : États-Unis, Irlande, Japon, Espagne. Le reste passe par un plugin générique à
  deux variables (devise, seuil court/long terme) qui ne produit aucun formulaire officiel `[R4]`.
  [VÉRIFIÉ] **La France n'est couverte nulle part en open source.**
- Les moteurs commerciaux (Koinly, CoinTracker, CoinTracking, Summ ex-CryptoTaxCalculator) sont
  bâtis sur des méthodes par actif ou par wallet `[D1]`. Waltio, éditeur français, vise
  explicitement le 2086 — **c'est le seul concurrent sérieux sur ce terrain**, et il est payant.

Le créneau n'est donc pas « un tracker crypto de plus ». C'est **le seul moteur 150 VH bis gratuit,
local, et vérifiable**.

---

## 3. Ce que font les meilleurs — les mécaniques, pas les plaquettes

La recherche `[D]` a visé la documentation d'aide des produits, là où les mécaniques réelles sont
décrites. Trois constats transversaux, tous exploitables.

### 3.1 Personne ne bloque

**Aucun des cinq outils étudiés n'empêche la génération du rapport fiscal** quand des anomalies
subsistent `[D2]`. Concrètement :

- **rotki** liste les acquisitions manquantes dans une boîte de dialogue, puis **exclut
  silencieusement** l'événement non résolu du calcul `[D3]`. [VÉRIFIÉ]
- **Summ** met un prix manquant **à zéro** avec une pastille jaune — indistinguable d'une valeur
  nulle légitime `[D4]`. [VÉRIFIÉ]
- **CoinTracking** propose un processus en 14 étapes mais précise que « le support ne corrige
  jamais directement vos données » `[D5]`. [VÉRIFIÉ]
- **Waltio** réserve ses sept états d'audit au forfait le plus cher `[D6]`. [VÉRIFIÉ]

Un coût d'acquisition manquant traité en zéro produit un **gain fantôme** : c'est la plainte n° 1
documentée contre ces outils, et elle coûte de l'impôt réel à l'utilisateur.

### 3.2 Les virements internes non appariés sont la première cause d'erreur

CoinTracking la désigne explicitement comme « la cause la plus fréquente de gains gonflés » `[D5]`.
[VÉRIFIÉ] Les causes d'échec documentées : montants divergents à cause des frais réseau,
horodatages éloignés, un côté en CSV et l'autre en API, et les **swaps via agrégateurs DEX**
(Cowswap, Jupiter, 1inch) qui ne remontent souvent qu'une seule jambe `[D5]` `[D7]`.

Notre fenêtre actuelle (`transfers.ts` : −2 h/+72 h, tolérance 2 % avec plancher 1e-6) est déjà
dans la bonne plage. Rien à changer, mais tout à **exposer** : l'utilisateur doit voir ce qui n'a
pas été apparié.

### 3.3 Personne ne trace la source du cours

Aucun des cinq outils n'expose, ligne par ligne, **la source et l'horodatage exacts du cours
retenu** `[D8]`. [VÉRIFIÉ] C'est un angle mort général — et chez nous c'est presque gratuit :
`PriceQuoteInput` porte déjà `{ source, at, stale }`.

### 3.4 À reprendre, à éviter

**À reprendre** de rotki : le réglage de la méthode comptable **par juridiction**, comme modèle de
configuration `[R1]`. De RP2/DaLI : la séparation stricte ingestion / calcul pur, qui valide notre
`src/lib/domain` sans DOM `[R4]`. De Koinly : une **migration de méthode versionnée** plutôt qu'un
interrupteur qui réécrirait silencieusement les années passées `[D9]`.

**À éviter** : le modèle de rotki (25 €/mois, installation lourde), et le zéro silencieux de Summ.

---

## 4. La mécanique légale — ce que dit la source primaire

Recherche `[L]`, menée sur Légifrance et BOFiP.

### 4.1 La formule, et le piège qu'elle contient

```
PV = prix de cession − (prix total d'acquisition × prix de cession ÷ valeur globale du portefeuille)
```

[VÉRIFIÉ] Art. 150 VH bis, III `[L1]`, corroboré par BOI-RPPM-PVBMC-30-20 `[L2]` et par la notice
officielle du formulaire 2086 `[L5]`.

**Les deux « prix de cession » de cette formule ne sont pas le même nombre.** La notice du 2086 est
explicite, et c'est la phrase la plus importante de tout ce dossier :

> « Les frais déductibles, quels qu'ils soient, **ne viennent pas en diminution du prix de cession
> pour la détermination du quotient** du prix de cession sur la valeur globale du portefeuille (ils
> doivent seulement être déduits du prix de cession qui constitue le premier terme de la différence
> prévue dans la formule de calcul mentionnée ci-dessus). » `[L5]` [VÉRIFIÉ]

Traduit en lignes du CERFA (déclarant 1) :

```
PV = l.218 − [ l.223 × ( l.217 ÷ l.212 ) ]

  l.212  valeur globale du portefeuille au moment de la cession
  l.217  prix de cession net des SOULTES seulement          ← numérateur du quotient
  l.218  prix de cession net des FRAIS ET des soultes       ← premier terme
  l.223  prix total d'acquisition net (l.220 − l.221 − l.222)
```

Les frais de cession réduisent donc l'assiette **une seule fois**, et n'allègent pas la fraction de
coût d'acquisition imputée. Une implémentation naïve qui soustrait les frais partout surestime la
quote-part imputée et **sous-estime la plus-value** — une erreur silencieuse, en défaveur de
l'administration, donc exactement le genre qui se paie lors d'un contrôle.

**C'est aussi la démonstration que la lecture du CERFA n'était pas une formalité** : ni l'article
ni la page BOFiP consultée ne rendaient cette asymétrie évidente.

**Exemple chiffré du BOFiP (§ 110)** : portefeuille acquis 1 000 €, valorisé 1 200 €, cession de
450 € → fraction de capital imputée = 1 000 × 450 ÷ 1 200 = **375 €**, qui réduit d'autant le prix
total d'acquisition pour la cession suivante. [VÉRIFIÉ]

> Ce paragraphe du BOFiP nous offre gratuitement notre **exemple canonique de test**, au même titre
> que le « 1@100, 1@200, vente 1@300 » du moteur actuel. Une source officielle qui fournit son
> propre jeu d'essai est une aubaine : elle doit devenir un test unitaire.

### 4.2 Le foyer fiscal : où il compte, et où il ne compte pas

La lecture du CERFA a corrigé une erreur d'interprétation. Le foyer fiscal structure bel et bien le
calcul, mais **pas au niveau du dénominateur**.

**Le portefeuille est celui du cédant, personne par personne.** La notice des lignes 212, 252 et
312 est sans ambiguïté : la valeur globale est « la somme des valeurs, évaluées au moment de la
cession imposable, des différents actifs numériques et droits s'y rapportant, **détenus par le
cédant** avant de procéder à la cession, quel que soit leur support de conservation (plateformes
d'échanges, y compris étrangères, serveurs personnels, dispositif de stockage hors ligne, etc.) »
`[L5]`. [VÉRIFIÉ]

Le formulaire matérialise cette lecture : il ouvre **trois blocs de calcul séparés et complets** —
§ 21 Déclarant 1 (lignes 210 à 224), § 25 Déclarant 2 (250 à 264), § 30 Personne à charge (310 à 324) — chacun avec sa propre valeur globale de portefeuille, son propre prix total d'acquisition et
sa propre plus-value globale. `[L5]` [VÉRIFIÉ]

Le « quel que soit le support » du BOFiP § 140 porte donc sur les **supports de conservation**
— plateformes étrangères, wallets, stockage hors ligne — et non sur une mise en commun des
patrimoines des membres du foyer. Ma lecture précédente était fausse sur ce point.

**Ce qui est bien au niveau du foyer**, en revanche, et que le § 5 du formulaire regroupe :

| Ligne   | Contenu                                                                                                                                              | Portée |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **51**  | Total des prix de cession = l.218 + l.258 + l.318 + l.413 + l.423 + l.433                                                                            | Foyer  |
| —       | Seuil des 305 € : « Si le total des prix de cession réalisés au niveau du foyer fiscal est inférieur ou égal à 305 €, vos cessions sont exonérées. » | Foyer  |
| **52**  | Total des plus et moins-values = l.224 + l.264 + l.324 + l.415 + l.425 + l.435, à reporter en **3AN** (gain) ou **3BN** (perte) de la 2042-C         | Foyer  |
| **3CN** | Option pour le barème progressif — « globale », portant sur le total des plus-values d'actifs numériques du foyer                                    | Foyer  |

Conséquence pour le moteur : **un portefeuille et un prix total d'acquisition par personne, une
agrégation et un seuil par foyer.** C'est plus simple que ce que j'avais décrit, et différent.

Note complémentaire : l'option pour le barème est **indépendante** de celle exerçable pour les
revenus de capitaux mobiliers et les plus-values sur droits sociaux — « le cas échéant, vous devrez
donc exercer deux options » `[L5]`. [VÉRIFIÉ] Contrairement à ce qu'indiquait une source secondaire,
cocher 3CN n'engage donc pas l'ensemble des revenus mobiliers de l'année.

### 4.3 Les autres règles, avec leur niveau de vérification

| Règle                                      | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                            | Vérification                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Sursis crypto↔crypto                       | Échange **sans soulte** entre crypto-actifs : hors champ l'année de l'échange. Aucun recalcul du prix total d'acquisition, l'actif reste dans la valeur globale.                                                                                                                                                                                                                                                                   | [VÉRIFIÉ] `[L1]` II.A         |
| Prix de cession                            | Prix réel perçu, **majoré** de la soulte reçue, **diminué** de la soulte versée et des frais de cession justifiés (frais de plateforme, de minage).                                                                                                                                                                                                                                                                                | [VÉRIFIÉ] `[L2]` §20-60       |
| Prix total d'acquisition                   | Somme des prix payés en monnaie légale + valeur des contreparties reçues sous sursis, **diminuée** des fractions déjà imputées et des soultes reçues.                                                                                                                                                                                                                                                                              | [VÉRIFIÉ] `[L1]` III.B        |
| Moins-values                               | Imputables **uniquement** sur les plus-values de même nature de **la même année**. Aucun report, aucune imputation ailleurs.                                                                                                                                                                                                                                                                                                       | [VÉRIFIÉ] `[L1]` IV           |
| Seuil de 305 €                             | Porte sur la **somme des prix de cession de l'année** (hors sursis). Effet de seuil **intégral** : au-delà, tout est imposable dès le premier euro. Le 2086 reste dû sous le seuil.                                                                                                                                                                                                                                                | [VÉRIFIÉ] `[L1]` II.B, `[L3]` |
| Achat de biens/services en crypto          | Cession imposable ; prix de cession = valeur vénale en euros du bien reçu.                                                                                                                                                                                                                                                                                                                                                         | [VÉRIFIÉ] `[L2]` §10          |
| Absence de justificatif de prix et de date | Prix d'acquisition retenu = **zéro**. Base entièrement taxable.                                                                                                                                                                                                                                                                                                                                                                    | [VÉRIFIÉ] `[L2]` §90          |
| Frais payés en crypto                      | Payer des frais en crypto est en principe une opération imposable. Mais « à titre de mesure de simplification, il est toutefois admis que la cession en tant que telle et les différentes prestations de services rendues en contrepartie des frais perçus par les plateformes et les mineurs soient assimilées à une seule et même opération de cession », avec une seule plus-value, ces frais étant déduits du prix de cession. | [VÉRIFIÉ] `[L5]`              |
| Retrait vers son propre wallet             | Pas de fait générateur ; aucun impact sur la valeur globale, qui couvre déjà tout support.                                                                                                                                                                                                                                                                                                                                         | **[PROBABLE]**                |
| Report 2042-C                              | Total de l'année en case **3AN** (gain) ou **3BN** (perte).                                                                                                                                                                                                                                                                                                                                                                        | [VÉRIFIÉ] `[L3]`              |

### 4.4 Ce que la recherche n'a pas pu trancher

Ces points **doivent** être validés par un professionnel avant codage. Tant qu'ils ne le sont pas,
le moteur affiche « non calculable » ou expose un réglage explicite — jamais une règle inventée.

1. **Le traitement des actifs reçus sans achat** (staking, airdrops, forks) reste officiellement
   ouvert. La recherche du 26/08 a établi ce qui est fondé et ce qui ne l'est pas : voir § 4.7, qui
   remplace ce point par une position moteur assumée cas par cas.
2. **Les actifs stakés, bloqués ou prêtés** entrent-ils dans la valeur globale du portefeuille ? La
   notice dit « quel que soit leur support de conservation », ce qui plaide pour oui, sans le dire.
   [PROBABLE]
3. **Le vocabulaire de l'article a changé au 01/07/2026** (ordonnance n° 2024-936 du 15/10/2024,
   transposition MiCA) : le texte renvoie désormais aux _crypto-actifs_ au sens du règlement UE
   2023/1114 `[L1]`. **Ce n'est peut-être pas qu'un changement de vocabulaire** — voir § 4.7 sur les
   NFT. Aucune mise à jour de doctrine BOFiP reflétant ce périmètre n'a été trouvée `[R5]`, ce qui
   ne prouve pas qu'il n'y en ait pas. **Point de veille n° 1**, à rouvrir au printemps 2027 avec la
   notice des revenus 2026.
4. **Les stablecoins restent dans le périmètre.** Deux indices convergents : la définition de la
   notice couvre « toute représentation numérique d'une valeur […] acceptée […] comme un moyen
   d'échange » `[L5]`, et les dispositions de l'ordonnance relatives aux jetons de monnaie
   électronique et aux jetons référencés à des actifs sont entrées en vigueur dès le 30/10/2024
   `[R5]`. [VÉRIFIÉ]
5. **Périmètre du 3916-bis** : les wallets auto-hébergés sont-ils des « comptes » ? [INCERTAIN]
6. **Frontière chiffrée BIC/BNC** : aucun seuil, faisceau d'indices seulement `[L6]`. [PROBABLE]

### 4.5 Le taux, désormais certifié sur source primaire

La vérification a abouti. **Art. L. 136-8 du code de la sécurité sociale, version en vigueur depuis
le 27 juin 2026** `[L7]` :

> « Le taux des contributions sociales est fixé : […] **2° À 10,6 %** pour les contributions
> sociales mentionnées aux articles L. 136-6 et L. 136-7 »

Et le IV du même article énumère limitativement ce qui reste à 9,2 % : les revenus du **a du I de
l'art. L. 136-6** (les revenus fonciers `[L8]`), les plus-values du 2° du I de l'art. L. 136-7,
et divers intérêts, primes, produits et rentes. **Les plus-values sur actifs numériques n'y figurent
pas** : elles relèvent des revenus du patrimoine de l'art. L. 136-6 sans être visées par la
dérogation, donc du taux de droit commun.

| Composante                |       Taux | Base                                    |
| ------------------------- | ---------: | --------------------------------------- |
| Impôt sur le revenu (PFU) |     12,8 % | CGI art. 200 C                          |
| CSG                       | **10,6 %** | CSS art. L. 136-8 I 2° `[L7]` [VÉRIFIÉ] |
| CRDS                      |      0,5 % | inchangé                                |
| Prélèvement de solidarité |      7,5 % | inchangé                                |
| **Prélèvements sociaux**  | **18,6 %** | 10,6 + 0,5 + 7,5                        |
| **Total**                 | **31,4 %** |                                         |

**Date d'application** : pour les revenus du patrimoine, « à compter de l'imposition des revenus de
l'année **2025** » `[L4]` — donc **dès les cessions 2025 déclarées en 2026**, et non à partir des
cessions 2026. [PROBABLE, source professionnelle ; l'article d'entrée en vigueur de la LFSS 2026
n'a pas été lu directement.]

Conséquence de conception : les taux vivent dans une **table datée et sourcée**, une ligne par année
de cession, avec son niveau de vérification et son lien — affichée dans l'app, jamais enfouie dans
une constante.

### 4.6 Correspondance moteur → CERFA 2086

Le formulaire fixe la structure de l'export. Blocs par personne : § 21 déclarant 1 (2xx), § 25
déclarant 2 (25x/26x), § 30 personne à charge (3xx). Colonnes : **cinq cessions par bloc**.

| Ligne (décl. 1) | Contenu                                                      | Source dans le moteur                                             |
| --------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| 211             | Date de la cession                                           | `HistoryEntry.at`                                                 |
| **212**         | Valeur globale du portefeuille au moment de la cession       | `valeurGlobaleAt(date, personne)`                                 |
| 213             | Prix de cession                                              | produit brut de la cession                                        |
| 214             | Frais de cession                                             | `feeEur` (frais plateforme et mineurs, y compris payés en crypto) |
| 215             | Prix de cession net des frais = 213 − 214                    | dérivé                                                            |
| 216             | Soulte reçue ou versée                                       | saisie ou détectée sur échange avec soulte                        |
| **217**         | Prix de cession net des soultes = 213 ∓ 216                  | **numérateur du quotient**                                        |
| **218**         | Prix de cession net des frais et soultes = 213 − 214 ∓ 216   | **premier terme**                                                 |
| 220             | Prix total d'acquisition                                     | cumul des acquisitions en monnaie légale, hors sursis             |
| 221             | Fractions de capital initial déjà imputées                   | cumul des quote-parts des cessions antérieures                    |
| 222             | Soultes reçues lors de cessions antérieures                  | cumul                                                             |
| **223**         | Prix total d'acquisition net = 220 − 221 − 222               | état courant du moteur                                            |
| 224             | Plus ou moins-value globale du déclarant                     | somme des cessions du bloc                                        |
| 51              | Total des prix de cession du foyer (218 + 258 + 318 + …)     | seuil des 305 €                                                   |
| 52              | Total des plus et moins-values du foyer → **3AN** ou **3BN** | résultat annuel                                                   |

Le § 4 du formulaire (lignes 41x/42x/43x) traite des cessions **par personne interposée**
(quotes-parts de prix de cession et de plus-values, avec désignation du dépositaire). Hors périmètre
V3 : à afficher comme non pris en charge plutôt qu'à ignorer silencieusement.

### 4.7 Les actifs reçus sans achat : une position par cas

Recherche du 26/08. Le constat central : **un seul de ces cas est solidement établi.** Une V3
sérieuse ne peut donc pas appliquer une règle unique, ni prétendre que le droit est clair.

| Cas                                                                             | Position retenue                                                                                   | Fondement                                                                                      | Décision moteur                                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Minage**                                                                      | BNC à la valeur de réception ; ce montant devient le prix d'acquisition pour la cession ultérieure | **Conseil d'État, 8e-3e ch. réunies, 26/04/2018, n° 417809, publié au Lebon** `[R6]` [VÉRIFIÉ] | **Règle codée**                                                                            |
| **Staking**                                                                     | BNC à la valeur de réception, ce montant devenant le prix d'acquisition                            | Aucun texte. Extension par analogie du minage ; consensus doctrinal `[R7]`. [QUESTION OUVERTE] | **Réglage**, défaut BNC-à-réception, bascule possible vers « prix nul, taxation différée » |
| **Airdrop non sollicité**                                                       | Pas de fait générateur à la réception ; imposition à la cession                                    | Aucun texte ; doctrine convergente `[R8]` et pratique Waltio `[R9]`. [PROBABLE]                | **Réglage**, défaut (cas majoritaire réel)                                                 |
| **Airdrop sollicité** (test de protocole, apport de liquidité, tâche rémunérée) | BNC à la réception, ou prix nul et tout en plus-value à la cession                                 | Idem. [QUESTION OUVERTE]                                                                       | **Sous-choix explicite**, sur le modèle Waltio                                             |
| **Fork**                                                                        | Aucune position défendable trouvée                                                                 | Aucune source de niveau exploitable `[R7]`. [INCERTAIN]                                        | **Refus de calcul** : signaler l'événement, exiger une saisie manuelle                     |
| **NFT**                                                                         | Voir ci-dessous                                                                                    | [QUESTION OUVERTE] depuis 2022                                                                 | **Réglage à deux branches**, aucun calcul automatique                                      |

**Le précédent Waltio est instructif** : le seul éditeur français du marché **ne tranche pas non
plus** sur les airdrops. Il expose trois scénarios et laisse l'utilisateur choisir, avec le prix
d'acquisition à 0 € comme conséquence assumée du cas ambigu `[R9]`. [VÉRIFIÉ] Autrement dit : quand
le droit est ouvert, la valeur d'un outil n'est pas de simuler la certitude, mais de rendre le choix
**explicite, motivé et traçable**. C'est exactement ce que notre culture de projet sait faire.

Koinly, à l'inverse, n'offre qu'un interrupteur global « traiter récompenses / airdrops / minage
comme un revenu », en tout-ou-rien, sans distinction sollicité/non sollicité `[R9]`. [PROBABLE]

**La trouvaille NFT, et pourquoi elle compte.** Le règlement MiCA exclut de son périmètre les
crypto-actifs **uniques et non fongibles**. Or l'art. 150 VH bis renvoie désormais intégralement à
ce périmètre depuis le 01/07/2026 `[L1]`. Conséquence mécanique : **un NFT « pur » sortirait du
150 VH bis à cette date** et basculerait vers le régime des biens meubles (art. 150 UA : 19 % + PS,
abattement par année de détention au-delà de deux ans, exonération sous 5 000 €) — un régime
distinct, et souvent plus favorable. Les collections fractionnées ou assimilables à du fongible
resteraient, elles, au 150 VH bis. [PROBABLE, raisonnement croisé, aucune source dédiée trouvée]
`[R5]` `[R10]`

Waltio continue pourtant de présenter les NFT comme des actifs numériques taxés à 31,4 % `[R9]`.
Si le raisonnement tient, c'est une divergence de fond avec le seul concurrent français, apparue il
y a huit semaines. **À faire vérifier en priorité par le professionnel qui relira la méthode** — et
à ne surtout pas coder en dur d'ici là.

### 4.8 La granularité : le cours quotidien est explicitement admis

C'est le déblocage le plus important de la journée, et il vient d'une source primaire.

L'article exige une valeur « au moment de la cession », ce qui laissait craindre une exigence
intraday impossible à satisfaire sur dix ans d'historique. **Le BOFiP tranche l'inverse**
(BOI-RPPM-PVBMC-30-20, § 150) :

> « Il est admis […] que le contribuable use de dispositifs communément utilisés de valorisation
> tels que des sites internet proposant des historiques de cotation **moyenne journalière**. »
> `[L2]` [VÉRIFIÉ]

Le cours quotidien n'est donc pas un pis-aller technique toléré faute de mieux : **c'est la méthode
sanctionnée par la doctrine.** Notre module `src/lib/history/` travaille déjà en points
journaliers — il est, sans modification, à la bonne maille légale.

---

## 5. Les quatre piliers de la V3

### Pilier 1 — Le foyer fiscal, à la bonne maille

Le § 4.2 en fixe la géométrie exacte : **un portefeuille par personne, une agrégation par foyer.**

- `Account` reçoit un **titulaire** — déclarant 1, déclarant 2, ou une personne à charge, les trois
  rôles du CERFA.
- Un réglage « Foyer fiscal » liste les personnes et leur rôle.
- Le moteur calcule un `valeurGlobaleAt` et un `prixTotalAcquisition` **par personne**, jamais mis
  en commun.
- Il agrège **au niveau du foyer** le total des prix de cession (seuil des 305 €), le total des
  plus et moins-values (3AN/3BN) et l'option pour le barème (3CN).
- Un compte sans titulaire est un bloqueur : on ne devine pas à qui appartient une cession.

### Pilier 2 — Le patrimoine crypto complet

La formule exige la valeur globale du portefeuille. Il faut donc savoir ce qui est détenu
**ailleurs**.

- **Aucun modèle nouveau n'est nécessaire** : `OpeningBalanceEvent` porte déjà quantité, coût et
  date. Déclarer « j'ai 1 BTC sur un Ledger depuis le 12/03/2021, acheté 42 000 € » est un
  événement existant dans un compte `man:`.
- Ce qui est nouveau, c'est l'**écran de déclaration** et, surtout, l'**affirmation de
  couverture** : une case que l'utilisateur coche pour dire « ceci est l'intégralité des
  crypto-actifs de mon foyer ». Le calcul n'est valide que sous cette affirmation, elle doit donc
  être explicite, datée, et rappelée sur le rapport.

### Pilier 3 — Le moteur 150 VH bis

Un module pur de plus dans `src/lib/domain/tax/`, aucune dépendance DOM, `Big` partout.

```
Pour une année N :

  1. Collecter les opérations, PAR PERSONNE du foyer (tous comptes, toutes plateformes).
  2. Classer chaque opération :
       échange crypto↔crypto SANS soulte  → SURSIS (ni cession, ni recalcul, reste au portefeuille)
       cession contre monnaie légale      → CESSION
       achat de bien ou service en crypto → CESSION (prix = valeur vénale du bien reçu)
       frais payés en crypto              → fusionnés dans la cession qu'ils accompagnent (l.214)
       virement interne apparié           → NON IMPOSABLE
       retrait non apparié                → À RÉCONCILIER (bloquant)

  3. Pour chaque personne, dans l'ordre chronologique, pour chaque cession :
       l212 = Σ (quantité détenue par CETTE personne × cours au moment de la cession)
              → si un seul cours manque : NON_CALCULABLE, jamais zéro
       l217 = brut ∓ soulte                        (frais NON déduits)
       l218 = brut − frais ∓ soulte                (frais déduits)
       l223 = prix_total_acquisition − fractions_déjà_imputées − soultes_reçues_antérieures
       quote_part = l223 × (l217 ÷ l212)           ← le quotient utilise l217, pas l218
       PV         = l218 − quote_part
       fractions_déjà_imputées += quote_part

  4. Au niveau du FOYER : l51 = Σ l218 de toutes les personnes.
       Si l51 ≤ 305 € → année exonérée. Le 2086 reste produit, avec les seuls prix de cession.

  5. Sinon : l52 = Σ PV − Σ MV du foyer → 3AN si positif, 3BN si négatif.
       Une moins-value nette n'est ni reportable, ni imputable ailleurs.
       Impôt = l52 × taux de l'année de cession (table datée du § 4.5), sauf option 3CN.
```

**Le calcul est annuel, jamais incrémental.** C'est ce qui résout proprement l'effet de seuil des
305 € : on connaît le cumul de l'année avant de décider de l'exonération, il n'y a donc aucun
franchissement rétroactif à gérer.

**Vérification, au niveau de rigueur du reste du projet :**

- l'exemple du BOFiP § 110 (1 000 / 1 200 / 450 → 375) devient un test unitaire ;
- **un test dédié à l'asymétrie des frais** (§ 4.1) : une cession avec frais non nuls doit donner un
  résultat _différent_ selon qu'on utilise l217 ou l218 au numérateur du quotient, et le moteur doit
  retenir l217. C'est le test qui attrape la faute la plus probable de toute la V3 ;
- un **oracle indépendant** réimplémente le calcul naïvement et se compare à 1e-9, comme
  `tests/integration/independent-oracle.test.ts` le fait déjà pour le moteur PRU ;
- des tests de propriétés fast-check : le prix total d'acquisition reste positif ou nul, la somme
  des quote-parts imputées n'excède jamais le prix total d'acquisition initial, un sursis ne
  modifie jamais l'état fiscal.

À notre connaissance, aucun moteur fiscal crypto — commercial ou libre — ne se vérifie contre une
réimplémentation indépendante. Ce serait la revendication de qualité la plus forte du produit, et
elle est vraie.

**La cascade de cours.** `valeurGlobaleAt` exige un cours par actif détenu et par date de cession.
La recherche du 26/08 a **sondé le CORS réellement** plutôt que de croire les documentations `[P1]`.
Ordre retenu :

|   # | Source                                                                  | Profondeur                                                                    | Clé | CORS                                                         | Rôle                                                                                        |
| --: | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
|   1 | **Cours observé dans une opération réelle de l'utilisateur** ce jour-là | —                                                                             | —   | —                                                            | Zéro appel réseau. C'est déjà la règle d'or du projet, étendue aux actifs dormants          |
|   2 | **DefiLlama** `coins.llama.fi`                                          | **très profonde** — LUNC retrouvé en 2020 _et_ au jour du crash du 19/05/2022 | non | **✅ vérifié**                                               | Socle. Couvre la longue traîne et les jetons morts (identifiants CoinGecko + prix on-chain) |
|   3 | CoinGecko                                                               | 365 jours, **et une clé Demo n'en débloque pas davantage**                    | non | ✅ vérifié                                                   | Croisement sur l'année glissante                                                            |
|   4 | Coinbase Exchange / Kraken / Bitstamp                                   | tout l'historique (300/req) / **721 points, plafond dur** / 1 000/req         | non | ✅ vérifiés                                                  | Complément et validation sur les actifs majeurs, cotation EUR native                        |
|   5 | Blockchain.com Charts                                                   | plusieurs années, **Bitcoin seulement**                                       | non | ✅ mais **`&cors=true` obligatoire**, sinon échec silencieux | Dernier recours BTC                                                                         |

**Écartés, avec la raison** : Binance (conditions d'utilisation et HTTP 451), CoinDesk Data
ex-CryptoCompare (palier gratuit supprimé le 21/05/2026), Messari (clé obligatoire), Bitfinex
(échecs empiriques), CoinPaprika (OHLCV gratuit limité au jour même). `[P1]` [VÉRIFIÉ]

**DefiLlama est déjà autorisé par notre CSP** (`coins.llama.fi`, utilisé comme filet de sécurité de
prix courants). L'ajouter comme fournisseur d'historique profond, c'est un fichier dans
`src/lib/history/providers/`, une ligne dans `defaultHistoryProviders()` et `maxDays: null` — le
point d'extension existe déjà et il est bien dessiné.

**Règle en cas d'échec de la cascade**, et elle diffère de la pratique du marché :

- On retient le **dernier cours disponible avant** la date visée, jamais après — l'esprit du texte
  est la valeur au moment des faits. L'export documente la source **et** l'écart en jours.
- Si aucun cours n'existe nulle part, on **ne met pas 0 par défaut**. Un actif valorisé à zéro
  réduit la valeur globale du portefeuille, donc gonfle la quote-part imputée, donc **diminue la
  plus-value déclarée** : l'erreur va dans la direction que l'administration conteste. On distingue
  donc, exactement comme pour le coût d'acquisition, **« jeton mort, valeur nulle confirmée par
  l'utilisateur »** — qui vaut 0 et se calcule — de **« cours introuvable »** — qui bloque et
  appelle une saisie manuelle.

### Pilier 4 — L'état de recoupement DAC8

Daté et concret : les plateformes collectent depuis le **01/01/2026**, déclarent à l'administration
française le **31 janvier 2027**, et le premier échange entre administrations a lieu au plus tard
le **30/09/2027** sur les opérations 2026 `[D10]`. [VÉRIFIÉ] Il n'y a **pas** de pré-remplissage
annoncé : le recoupement sera _a posteriori_, et « toute discordance constituera un indice
d'anomalie susceptible de déclencher un contrôle » `[D10]`. [VÉRIFIÉ] Une fenêtre de régularisation
à pénalité réduite se fermerait à cette même date du 30/09/2027 `[D11]`. [PROBABLE]

Le schéma CARF déclare, par utilisateur et par plateforme, des **agrégats par catégorie** `[D12]` :
acquisitions et cessions crypto↔crypto, acquisitions et cessions contre monnaie légale, transferts
entrants et sortants, et le nombre d'unités par actif (jusqu'à 6 décimales). [PROBABLE]

D'où l'écran : **par plateforme déclarante et par année**, les mêmes agrégats, calculés depuis nos
données. Un total « tous comptes confondus » ne permettrait pas de localiser l'écart signalé.
Nous avons déjà toute la donnée nécessaire.

---

## 6. Le différenciateur : refuser de produire un chiffre faux

C'est la traduction produit du § 3.1, et c'est la position que personne n'occupe.

Le rapport fiscal porte un **feu** :

| État      | Signification                                                                                                    | Export                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 🟢 Vert   | Aucun bloqueur. Toutes les cessions calculées, tous les cours tracés.                                            | Autorisé                                   |
| 🟠 Orange | Le calcul aboutit mais repose sur au moins un réglage non tranché en droit (§ 4.4) ou une valorisation manuelle. | Autorisé, mentions portées sur le document |
| 🔴 Rouge  | Au moins un bloqueur.                                                                                            | **Impossible**                             |

Bloqueurs rouges, chacun cliquable vers l'écran qui le corrige :

1. un solde négatif sur un actif ;
2. une opération non qualifiée (`unqualified`) dans l'année ;
3. un dépôt sans coût d'acquisition sur une position non nulle ;
4. un retrait non apparié qui serait sinon traité comme une cession ;
5. **un cours historique manquant à la date d'une cession** — la valeur globale n'est pas
   calculable ;
6. le foyer fiscal non renseigné, ou l'affirmation de couverture non cochée.

Deux règles qui découlent directement des erreurs observées chez les concurrents :

- **Un coût d'acquisition manquant n'est jamais transformé en zéro silencieux.** « Valeur nulle
  confirmée par l'utilisateur » et « prix introuvable » sont deux états distincts. Le premier
  applique la règle du BOFiP § 90 en connaissance de cause ; le second bloque.
- **Chaque cours utilisé est tracé** : actif, date, valeur, source, horodatage de récupération.
  Le rapport est auditable ligne à ligne. rotki est le seul du marché à le faire, via une page
  montrant quel oracle a fourni chaque prix `[P2]`. [VÉRIFIÉ]

### 6.1 Rendre le blocage utile, pas punitif

Bloquer est une position défendable ; mal exécutée, elle devient « ton outil refuse de me servir ».
La recherche du 26/08 sur les parcours de mise en conformité donne les mécaniques qui font qu'un
utilisateur **accepte** le travail `[U1]`.

**L'ordre de la file n'est pas neutre — il est prescrit par la mécanique des données.** Koinly
recommande explicitement de rapprocher les virements **en premier** : un rapprochement réussi
supprime d'un seul geste un faux achat _et_ une fausse vente `[U2]`. CoinTracker conseille ensuite
de reprendre les coûts manquants **du plus ancien au plus récent**, parce qu'une correction ancienne
se propage en cascade sur toutes les suivantes `[U3]`. D'où notre file :

1. virements internes non appariés (effet de levier maximal, une correction en annule deux) ;
2. opérations non qualifiées, par ordre chronologique ;
3. coûts d'acquisition manquants, du plus ancien au plus récent ;
4. cours introuvables ;
5. foyer et couverture.

**Sept règles de conception**, chacune tirée d'une pratique observée :

- **Une anomalie ne s'affiche jamais nue** : toujours avec son **effet chiffré** sur le résultat si
  elle reste non résolue. C'est le principe TurboTax — le chiffre final bouge visiblement à chaque
  réponse, donc l'effort a une contrepartie immédiate `[U4]`.
- **Grouper par type avec compteur décroissant**, jamais par ordre d'apparition dans l'import : les
  cinq outils du marché convergent sur ce point `[U1]`.
- **Résolution en lot par défaut** pour les anomalies similaires ; le ligne à ligne est le mode
  dégradé, pas le mode normal (patron Summ, détection de transactions similaires) `[U5]`.
- **Tout montant est un lien vers sa décomposition** — transactions sources, formule, date et
  origine du cours. La traçabilité _remplace_ le texte explicatif, elle ne s'y ajoute pas.
- **Corriger et justifier sont le même geste** : le bouton d'édition sur une ligne signalée ouvre
  directement le prix et la date utilisés dans le calcul, pas un écran séparé (patron CoinTracker).
- **Aucune impasse muette** : chaque bloqueur nomme le geste qui le lève (« importer ce compte »,
  « saisir ce cours »). Et, à l'exemple honnête de CoinTracking, l'outil sait dire qu'un cas dépasse
  l'auto-résolution et qu'il faut un professionnel `[U6]`.
- **Ne jamais redemander ce qui est déjà déduit ailleurs** — c'est aussi le critère WCAG 3.3.7
  _Redundant Entry_.

**Deux garde-fous d'accessibilité**, puisqu'une violation axe casse notre CI :

- WCAG **2.4.11 Focus Not Obscured** : un bandeau collant « N anomalies restantes » ne doit jamais
  masquer l'élément qui a le focus clavier. C'est précisément le composant que ce parcours appelle.
- WCAG **2.5.8 Target Size** : 24 × 24 px minimum — ce qui contraint la densité des boutons de
  correction en ligne sur mobile `[U7]`.

**Et une décision existante à réexaminer.** Le projet convertit les tableaux en cartes sur mobile
(`docs/ROADMAP.md` § 2.3). Pour un grand-livre fiscal à en-têtes multi-niveaux, la recommandation
d'accessibilité est inverse : préserver la matrice avec un défilement horizontal **visible**, parce
que le passage en cartes casse les relations ligne/colonne, et utiliser `headers`/`id` plutôt que
`scope` seul `[U7]`. À arbitrer pour le seul écran Fiscalité, sans toucher au reste.

---

## 7. Ce qui existe déjà, ce qui reste à construire

**Déjà là** — c'est ce qui rend la V3 réaliste :

| Brique                                                                                          | Où                                             |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Flux des cessions, événement par événement (date, quantité, valeur, frais, réalisé, PRU après)  | `HistoryEntry` dans `domain/engine/report.ts`  |
| Avoirs détenus ailleurs                                                                         | `OpeningBalanceEvent` (quantité + coût + date) |
| Cours historiques journaliers, 3 fournisseurs, comblement de trous, parité € des stables, cache | `src/lib/history/`                             |
| Cours manuel                                                                                    | `pricing/service.ts` (`manualQuote`)           |
| Comptes de première classe                                                                      | décision n° 20                                 |
| Appariement des virements internes (−2 h/+72 h, 2 %)                                            | `domain/transfers.ts`                          |
| Détection d'anomalies                                                                           | `support/self-check.ts`                        |
| Arithmétique décimale stricte, oracle indépendant, tests de propriétés                          | déjà la culture du projet                      |

**À construire :**

| Élément                                                                                           | Sessions |
| ------------------------------------------------------------------------------------------------- | -------: |
| Titulaire sur les comptes + réglage du foyer fiscal                                               |      1,5 |
| Écran de déclaration des avoirs externes + affirmation de couverture                              |        2 |
| Fournisseur d'historique profond DefiLlama (`maxDays: null`) + traçabilité de la source par point |      0,5 |
| Valorisation du portefeuille **à une date passée** (`valeurGlobaleAt`) + cascade de repli         |        2 |
| Moteur `domain/tax/` : classification, calcul annuel, tests, oracle indépendant                   |        4 |
| Réglages fiscaux du § 4.7 (staking, airdrops, NFT) avec défauts motivés et traçables              |        1 |
| Écran Fiscalité + feu tricolore + file de résolution ordonnée (§ 6.1)                             |      2,5 |
| État de recoupement DAC8 par plateforme et par année                                              |      1,5 |
| Exports : lignes prêtes pour le 2086, CSV, traçabilité des cours                                  |        1 |
| **Total**                                                                                         |   **16** |

Soit l'ordre de grandeur de la v2 (17 sessions). Ordre recommandé : le tableau se lit de haut en
bas, chaque étape étant utilisable seule. Le moteur avant l'écran ; le feu avant l'export.

---

## 8. Les points durs, sans les habiller

1. ~~La couverture des cours historiques~~ — **largement levé le 26/08.** Le BOFiP admet
   explicitement le cours moyen journalier (§ 4.8), et DefiLlama fournit une profondeur très large
   avec CORS vérifié et sans clé (§ Pilier 3). Il reste un risque résiduel, borné et nommé : un
   jeton jamais listé chez CoinGecko et sans pool on-chain peut n'avoir **aucun** historique public.
   Le moteur dit alors lequel et à quelle date, et n'estime jamais.
2. **Le droit n'est pas tranché sur les actifs reçus sans achat** (§ 4.7). Un seul cas est établi
   par la jurisprudence — le minage. Le staking et les airdrops reposent sur un consensus
   doctrinal ; les forks sur rien ; les NFT sont ouverts depuis 2022 et **peut-être sortis du
   périmètre depuis le 01/07/2026**. La V3 ne peut pas les inventer : elle les expose en réglages
   motivés, ou refuse de calculer.
3. **Le taux est certifié (§ 4.5), sa date d'application ne l'est qu'à moitié.** Le 10,6 % est lu
   sur Légifrance ; l'application « à compter de l'imposition des revenus 2025 » repose encore sur
   une source professionnelle. Les taux vivent donc dans une **table datée et sourcée**, une ligne
   par année de cession, affichée dans l'app avec son niveau de vérification — pas dans une
   constante enfouie. La faiblesse devient une fonction d'auditabilité.
4. **MiCA a modifié le vocabulaire de l'article au 01/07/2026**, alors que la notice consultée est
   celle des revenus 2025 et que la doctrine BOFiP date de 2019. Point de veille n° 1.
5. **Risque juridique.** Étiquette « estimation » permanente, relecture par un professionnel avant
   publication, aucun conseil fiscal, et le rapport rappelle l'affirmation de couverture sur
   laquelle il repose.

---

## 9. Ce que je ne peux pas trancher

1. **Publier ou non le mode fiscal.** C'est la seule décision qui engage juridiquement.
2. **Faire trancher en priorité la question NFT** (§ 4.7). Si le renvoi de l'art. 150 VH bis au
   périmètre MiCA fait bien sortir les NFT uniques au 01/07/2026, c'est un changement de régime
   entier, et le seul concurrent français ne l'a pas répercuté. C'est la question à poser en premier
   au professionnel, avant même le staking.
3. **Faire relire les positions du § 4.7** — staking, airdrops sollicités, forks — et valider les
   défauts proposés. Le minage est le seul cas où la jurisprudence dispense d'un arbitrage.
4. **Faire confirmer la date d'application du taux 2026** : l'article d'entrée en vigueur de la
   LFSS 2026 n'a pas été lu directement (§ 4.5). Applique-t-il bien 18,6 % aux cessions **2025** ?
5. **Arbitrer l'affichage mobile de l'écran Fiscalité** (§ 6.1) : conserver la matrice avec
   défilement horizontal, contre la convention « tableaux → cartes » du reste de l'app.
6. **Sonder le Discord avant de s'engager**, avec les deux questions qui discriminent : « détenez-vous
   de la crypto ailleurs que sur Coinhouse ? » et « avez-vous déclaré des plus-values crypto cette
   année, et avec quoi ? ». Coût : zéro session.

---

## 10. Sources

Consultées le 25/08/2026.

**Légal — sources primaires**
`[L1]` legifrance.gouv.fr, CGI art. 150 VH bis (version en vigueur au 01/07/2026, ordonnance
n° 2024-936 du 15/10/2024) — `[L2]` bofip.impots.gouv.fr, BOI-RPPM-PVBMC-30-20 (§ 10 à 170 ;
exemple chiffré § 110 ; périmètre foyer § 140 ; absence de justificatif § 90) —
`[L3]` impots.gouv.fr, « Comment déclarer les plus ou moins-values sur cessions d'actifs
numériques » — `[L5]` **impots.gouv.fr, formulaire 2086 édition 2026 (revenus 2025), CERFA
16043\*07 — formulaire et notice, téléchargés et lus intégralement le 26/08/2026** (structure en
blocs par déclarant, formule l.218 − [l.223 × (l.217 ÷ l.212)], asymétrie des frais, récapitulatif
foyer l.51/l.52, cases 3AN/3BN/3CN, définition des actifs numériques) —
`[L6]` bofip.impots.gouv.fr, ACTU-2023-00099 (BIC/BNC) —
`[L7]` **legifrance.gouv.fr, CSS art. L. 136-8, version en vigueur au 27/06/2026** (I 2° : 10,6 % ;
IV : liste dérogatoire à 9,2 %) — `[L8]` legifrance.gouv.fr, CSS art. L. 136-6, version au
16/02/2025 (le a du I vise les revenus fonciers ; les plus-values relèvent du e)
**Légal — sources secondaires, non certifiées**
`[L4]` aurep.com (date d'application : imposition des revenus 2025) ; dlapiper.com ;
hagnere-patrimoine.fr

**rotki et moteurs open source**
`[R1]` docs.rotki.com/usage-guides/history/pnl ; docs.rotki.com/usage-guides/customization —
`[R2]` docs.rotki.com/premium/plans-and-pricing ; cryptoadventure.com (revue 2026) —
`[R3]` github.com/rotki/rotki issues 6999, 2714, 1818, 1456, 566, 1793 —
`[R4]` github.com/eprbell/rp2 (+ docs/supported_countries.md) ; github.com/eprbell/dali-rp2
Également consultés : github.com/hodgerpodger/staketaxcsv (CSV pivot), blog.elest.io (Ghostfolio),
deepwiki.com/rotki/rotki (architecture backend, SQLCipher)

**Actifs reçus sans achat, NFT et bascule MiCA** (recherche du 26/08/2026)
`[R5]` legifrance.gouv.fr, art. 150 VH bis version 01/07/2026 et rapport au Président de la
République sur l'ordonnance n° 2024-936 (adaptation terminologique et régime PSCA ; entrée en
vigueur des dispositions stablecoins dès le 30/10/2024) — `[R6]` **legifrance.gouv.fr, Conseil
d'État, 8e-3e ch. réunies, 26/04/2018, n° 417809 et 418030 à 418033, publié au recueil Lebon**
(minage en BNC) — `[R7]` nbe-avocats.fr (fiscalité du staking, 2026 ; reconnaît l'absence de tout
article visant nommément le staking) — `[R8]` journoud-avocats.fr (fiscalité des airdrops ;
distinction sollicité / non sollicité présentée comme une interprétation) —
`[R9]` help.waltio.com (trois scénarios d'airdrop, choix laissé à l'utilisateur ; NFT présentés
comme actifs numériques) ; support.koinly.io (réglage global tout-ou-rien) —
`[R10]` lmdavocats.fr (régime fiscal des NFT ; critère de fongibilité ; deux questions
ministérielles restées sans réponse)

**Expérience utilisateur** (recherche du 26/08/2026)
`[U1]` synthèse des documentations d'aide des cinq outils — `[U2]` support.koinly.io (ordre de
résolution : virements d'abord) — `[U3]` support.cointracker.io (résolution du plus ancien au plus
récent, correction en ligne) — `[U4]` appcues.com (parcours TurboTax : estimation recalculée en
direct) ; impots.gouv.fr et economie.gouv.fr (déclaration préremplie, rubriques filtrées) —
`[U5]` help.summ.com/en/articles/5279619 (catégorisation en lot par similarité) —
`[U6]` cointracking.freshdesk.com (limite assumée de l'auto-résolution) —
`[U7]` **w3.org/TR/WCAG22** (2.5.8 Target Size, 2.4.11 Focus Not Obscured, 3.3.7 Redundant Entry ;
`headers`/`id` pour les en-têtes multi-niveaux)
Également : nngroup.com/articles/progress-indicators (retour visuel : attente perçue 11 à 15 % plus
courte) ; lawsofux.com/zeigarnik-effect ; help.pennylane.com (l'IA propose, l'humain valide) ;
bitwarden.com/blog (audit ETH Zurich) — la confiance se prouve par une méthode publiée et vérifiable

**Cours historiques** (recherche du 26/08/2026, **avec sondes CORS réelles**)
`[P1]` tests directs des points d'entrée : coins.llama.fi (`prices/historical`, `chart`),
api.coingecko.com (erreur `10012` au-delà de 365 jours, capturée), api.exchange.coinbase.com
(plafond de 300 bougies), docs.kraken.com (721 points, plafond dur), Bitstamp, Bitfinex (échec),
CoinPaprika (402 applicatif), data.coindesk.com (fin du palier gratuit le 21/05/2026),
developers.binance.com (HTTP 451 et conditions d'utilisation), Blockchain.com Charts
(`&cors=true` obligatoire) — `[P2]` docs.rotki.com (ordre d'oracles configurable, provenance du
prix affichée) ; support.koinly.io/9489964 (préférence pour la contre-valeur fournie par la
plateforme) ; waltio.com (agrégation CoinGecko + Kaiko + CryptoCompare, arbitrage non publié)

**Réconciliation et DAC8**
`[D1]` support.koinly.io/9489991 (wallet-based cost tracking) ;
support.cointracker.io/4413071343889 — `[D2]` synthèse des cinq sources ci-dessous —
`[D3]` docs.rotki.com/usage-guides/history/pnl — `[D4]` help.summ.com/5411667 (prix manquant à
zéro) — `[D5]` cointracking.freshdesk.com/29000018817 (déséquilibres de compte, swaps DEX à une
jambe) — `[D6]` help.waltio.com/9054467 (guide contrôle fiscal) —
`[D7]` support.koinly.io/9490037 (historique d'achat manquant) — `[D8]` constat transversal des
sources D3 à D6 — `[D9]` support.koinly.io/10289123 (migration de méthode de coût) —
`[D10]` bmfiduciaire.fr/cryptoactifs-dac8-carf-2026 — `[D11]` hagnere-patrimoine.fr (fenêtre de
régularisation) — `[D12]` oecd.org, « Crypto-Asset Reporting Framework XML Schema », juillet 2025
(métadonnées ; le XSD brut n'a pas pu être extrait) ; grantthornton.ie (éléments clés du schéma
CARF/DAC8)
