# Banc d'essai d'exactitude

Un jeu de cas **figé**, **versionné**, dont chaque résultat attendu **se refait à la calculatrice**,
et que n'importe qui peut rejouer — y compris quelqu'un qui utilise un autre outil, y compris un
concurrent. Il ne dit pas « ce logiciel est juste » : il dit précisément sur quoi il l'est, comment
le vérifier sans lui faire confiance, et ce qu'il ne couvre pas.

## Pourquoi il existe

**Aucun banc d'essai public et rejouable d'exactitude fiscale n'a été trouvé**, ni en France, ni en
Allemagne, ni au Royaume-Uni, ni aux États-Unis (recherche du 16/09/2026). Ce qui s'en approche
valide autre chose : OpenFisca est un moteur de référence auquel contribuer, les procédures de
qualification des administrations valident un _format_ de transmission, et les comparatifs de la
presse ne publient ni leurs cas ni leur méthode.

Un éditeur qui **vend** le calcul ne peut pas en être l'arbitre. Cette application est gratuite,
sans compte, et ses données ne quittent pas le navigateur : c'est ce qui lui permet de publier ses
cas et d'inviter la contradiction.

## Ce qu'il a trouvé avant même d'être publié

Préparer ce banc a obligé à relire le formulaire 2086 et la doctrine plutôt que la description que
le dépôt en donnait — et **le moteur s'est révélé faux** sur un point. Le formulaire calcule la
plus-value en ligne 224 par `l. 218 − [l. 223 × (l. 217 / l. 212)]` : le quotient prend le prix de
cession **avant** frais (ligne 217), la différence le prix **après** frais (ligne 218). Le BOFiP le
dit en toutes lettres (BOI-RPPM-PVBMC-30-20, § 50) : les frais « ne viennent pas en diminution du
prix de cession pour la détermination du quotient ». Le moteur prenait le prix net aux deux
endroits, et surestimait chaque plus-value de `prix d'acquisition × frais ÷ valeur globale`.

C'est corrigé (décision n° 159), et **le cas vh-02 échoue sur l'ancienne formule**. Aucun des tests
existants ne pouvait le voir — tous leurs échanges étaient sans frais — et le test de mutation non
plus : il vérifie le code qui existe, pas un terme que ce code n'a jamais eu.

## Ce que la version 1 couvre, et ce qu'elle ne couvre pas

**Couvert** : la méthode globale de l'article 150 VH bis du CGI, sur les seules grandeurs que la loi
impose à tout le monde de la même façon — pour chaque cession, les lignes 212 à 224 de l'annexe
2086 ; pour chaque année, le total de la ligne 51, l'exonération sous 305 €, le résultat net et
l'impôt au taux de l'année.

**Délibérément non couvert** :

- **Les grandeurs sensibles à la méthode** — PRU, coût des unités détenues, réalisé, latent. Deux
  méthodes légitimes y donnent deux chiffres, et publier leur écart serait appeler « erreur » une
  différence de méthode.
- **Les récompenses et les dépôts au coût inconnu.** Leur traitement relève d'un choix de méthode
  (ici : coût nul par défaut, décision n° 9), pas d'une règle que la loi impose.
- **Les soultes** (lignes 216 et 222) : le moteur ne les modélise pas encore. Tous les cas sont sans
  soulte, donc ligne 213 = ligne 217 et ligne 222 = 0.
- **La valeur globale du portefeuille** (ligne 212) est une **donnée d'entrée**, comme sur le
  formulaire. Un outil qui valorise le portefeuille autrement n'a pas pour autant une autre formule.
- **Les titres, les dividendes, le financement participatif** : d'autres régimes, d'autres
  formulaires.
- **Les quantités détenues sur un relevé réel** : prévues pour une version suivante.

## Le rejouer

```bash
npm run exactitude
```

Chaque cas y subit **trois** épreuves, et un seul échec suffit à faire rougir le banc :

1. **Le jeu est bien celui qui a été publié** : l'empreinte SHA-256 de `cas.json` correspond à celle
   de `manifest.json`. Un tiers peut la vérifier sans notre code (`sha256sum`).
2. **Les attendus se redérivent** : l'implémentation de référence (`tests/exactitude/reference.ts`),
   écrite à part du moteur — fractions exactes, aucune dépendance — retrouve chaque montant publié.
3. **Le moteur de l'application les produit**, au centime et au-delà : l'arithmétique est exacte,
   aucune tolérance n'est accordée.

Le banc tourne à chaque commit, en intégration continue : **tout commit de `main` l'a passé.**

## Le comparer à un autre outil

Saisissez dans votre outil les quelques opérations d'un cas, indiquez-lui la valeur globale du
portefeuille, et lisez les lignes 217, 218, 223 et 224. Les montants de ce document sont écrits
exactement comme dans `cas.json`, pour se comparer par simple copier-coller. À opérations et valeur
globale identiques, un écart en ligne 224 est un écart de **formule**.

**Aucun résultat d'un autre outil n'est publié ici**, et aucun ne le sera. La comparaison appartient
à celui qui la fait.

## Ses limites, dites en face

- **Il est indépendant du moteur par son code, pas par son auteur.** La même personne a écrit le
  moteur et l'implémentation de référence. Ce qui compense en partie : chaque ligne 224 est écrite
  en toutes lettres, et se refait à la main.
- **Aucune relecture par un tiers n'a encore eu lieu.** C'est la pièce qui manque : tous les bancs
  d'essai qui ont gardé leur autorité ont été vérifiés par quelqu'un qui n'avait aucun intérêt au
  résultat. Une relecture signée d'un professionnel du chiffre est la bienvenue.
- **Huit cas ne sont pas une preuve d'exactitude générale.** Ils éprouvent la formule et ses cas
  limites ; ils ne remplacent pas le recalcul indépendant qui tourne sur un relevé réaliste
  (`tests/integration/independent-oracle.test.ts`).

## Contester un résultat

Ouvrez une issue sur le dépôt avec l'identifiant du cas, la ligne, votre montant, et le texte qui le
fonde — article, paragraphe du BOFiP, ligne du formulaire. **Si le banc se trompe, la version en
cours n'est pas réécrite** : une version suivante le corrige, et cette page dit pourquoi.

## Versions

| Version | Gelée le   | Cas | État   |
| ------- | ---------- | --: | ------ |
| v1      | 17/09/2026 |   8 | active |

Une version publiée ne change jamais : son empreinte est dans `manifest.json`, et le générateur
refuse de la réécrire. Une version retirée reste listée ici, avec la raison de son retrait.

## Les cas de la version 1

Colonnes : **212** valeur globale du portefeuille · **213** prix de cession · **214** frais ·
**217** prix net des soultes, avant frais · **218** prix net des frais et des soultes · **220** prix
total d'acquisition · **221** fractions de capital déjà imputées · **223** prix total d'acquisition
net · **224** plus ou moins-value. Le taux est le prélèvement forfaitaire unique de l'année
(impôt sur le revenu et prélèvements sociaux).

<!-- exactitude:v1:debut — section générée par npm run exactitude:generer, ne pas éditer -->

### vh-01 — Une cession, sans frais

Le cas de base de la méthode globale : la fraction du prix d'acquisition imputée est le prix total d'acquisition multiplié par la part du portefeuille cédée.

Sources : [cgi-150-vh-bis](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050366751), [formulaire-2086](https://www.impots.gouv.fr/sites/default/files/formulaires/2086/2026/2086_5515.pdf).

| Cession    | l. 212 | l. 213 | l. 214 | l. 217 | l. 218 | l. 220 | l. 221 | l. 223 | Fraction | l. 224 | PTA après |
| ---------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -------: | -----: | --------: |
| 2026-03-15 |  12000 |   3000 |      0 |   3000 |   3000 |  10000 |      0 |  10000 |     2500 |    500 |      7500 |

- 2026-03-15 : `3000 − 10000 × (3000 ÷ 12000) = 500`

| Année | l. 51 | Exonérée | Plus-values | Moins-values | Net |  Taux | Impôt |
| ----- | ----: | :------: | ----------: | -----------: | --: | ----: | ----: |
| 2026  |  3000 |   non    |         500 |            0 | 500 | 0.314 |   157 |

### vh-02 — Des frais : le quotient avant, la différence après

Le prix de cession du quotient est pris AVANT frais (ligne 217), celui de la différence APRÈS frais (ligne 218). Les confondre surestime la plus-value de prix d'acquisition × frais ÷ valeur globale — ici 25 €.

Sources : [bofip-pvbmc-30-20](https://bofip.impots.gouv.fr/bofip/11968-PGP.html/identifiant=BOI-RPPM-PVBMC-30-20-20190902), [formulaire-2086](https://www.impots.gouv.fr/sites/default/files/formulaires/2086/2026/2086_5515.pdf).

| Cession    | l. 212 | l. 213 | l. 214 | l. 217 | l. 218 | l. 220 | l. 221 | l. 223 | Fraction | l. 224 | PTA après |
| ---------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -------: | -----: | --------: |
| 2026-03-15 |  12000 |   3000 |     30 |   3000 |   2970 |  10000 |      0 |  10000 |     2500 |    470 |      7500 |

- 2026-03-15 : `2970 − 10000 × (3000 ÷ 12000) = 470`

| Année | l. 51 | Exonérée | Plus-values | Moins-values | Net |  Taux |  Impôt |
| ----- | ----: | :------: | ----------: | -----------: | --: | ----: | -----: |
| 2026  |  2970 |   non    |         470 |            0 | 470 | 0.314 | 147.58 |

### vh-03 — Une remise sur les frais

Seuls les frais supportés par le cédant réduisent le prix : 40 € de frais bruts et 10 € de remise sont 30 € de frais. Le résultat doit être celui de vh-02, au centime.

Sources : [cgi-150-vh-bis](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050366751), [formulaire-2086](https://www.impots.gouv.fr/sites/default/files/formulaires/2086/2026/2086_5515.pdf).

| Cession    | l. 212 | l. 213 | l. 214 | l. 217 | l. 218 | l. 220 | l. 221 | l. 223 | Fraction | l. 224 | PTA après |
| ---------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -------: | -----: | --------: |
| 2026-03-15 |  12000 |   3000 |     30 |   3000 |   2970 |  10000 |      0 |  10000 |     2500 |    470 |      7500 |

- 2026-03-15 : `2970 − 10000 × (3000 ÷ 12000) = 470`

| Année | l. 51 | Exonérée | Plus-values | Moins-values | Net |  Taux |  Impôt |
| ----- | ----: | :------: | ----------: | -----------: | --: | ----: | -----: |
| 2026  |  2970 |   non    |         470 |            0 | 470 | 0.314 | 147.58 |

### vh-04 — Deux cessions, listées dans le désordre

Le prix d'acquisition se consomme cession après cession : la seconde part de ce que la première a laissé (ligne 221). Les opérations sont données exprès dans l'ordre inverse — l'ordre du calcul est celui des dates, jamais celui du fichier.

Sources : [cgi-150-vh-bis](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050366751), [formulaire-2086](https://www.impots.gouv.fr/sites/default/files/formulaires/2086/2026/2086_5515.pdf).

| Cession    | l. 212 | l. 213 | l. 214 | l. 217 | l. 218 | l. 220 | l. 221 | l. 223 | Fraction | l. 224 | PTA après |
| ---------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -------: | -----: | --------: |
| 2026-03-15 |  12000 |   3000 |      0 |   3000 |   3000 |  10000 |      0 |  10000 |     2500 |    500 |      7500 |
| 2026-06-20 |   8000 |   2000 |      0 |   2000 |   2000 |  10000 |   2500 |   7500 |     1875 |    125 |      5625 |

- 2026-03-15 : `3000 − 10000 × (3000 ÷ 12000) = 500`
- 2026-06-20 : `2000 − 7500 × (2000 ÷ 8000) = 125`

| Année | l. 51 | Exonérée | Plus-values | Moins-values | Net |  Taux |  Impôt |
| ----- | ----: | :------: | ----------: | -----------: | --: | ----: | -----: |
| 2026  |  5000 |   non    |         625 |            0 | 625 | 0.314 | 196.25 |

### vh-05 — Céder tout le portefeuille

Quand le prix avant frais égale la valeur globale, la fraction imputée est le prix d'acquisition restant tout entier : il ne reste rien pour la suite.

Sources : [cgi-150-vh-bis](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050366751), [formulaire-2086](https://www.impots.gouv.fr/sites/default/files/formulaires/2086/2026/2086_5515.pdf).

| Cession    | l. 212 | l. 213 | l. 214 | l. 217 | l. 218 | l. 220 | l. 221 | l. 223 | Fraction | l. 224 | PTA après |
| ---------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -------: | -----: | --------: |
| 2026-05-02 |  12000 |  12000 |     60 |  12000 |  11940 |  10000 |      0 |  10000 |    10000 |   1940 |         0 |

- 2026-05-02 : `11940 − 10000 × (12000 ÷ 12000) = 1940`

| Année | l. 51 | Exonérée | Plus-values | Moins-values |  Net |  Taux |  Impôt |
| ----- | ----: | :------: | ----------: | -----------: | ---: | ----: | -----: |
| 2026  | 11940 |   non    |        1940 |            0 | 1940 | 0.314 | 609.16 |

### vh-06 — Des échanges entre actifs numériques, stablecoin compris

Un échange sans soulte entre actifs numériques est en sursis d'imposition, y compris contre un stablecoin : il ne crée aucune cession et ne touche pas au prix d'acquisition. Le résultat doit être celui de vh-01.

Sources : [cgi-150-vh-bis](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050366751).

| Cession    | l. 212 | l. 213 | l. 214 | l. 217 | l. 218 | l. 220 | l. 221 | l. 223 | Fraction | l. 224 | PTA après |
| ---------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -------: | -----: | --------: |
| 2026-03-15 |  12000 |   3000 |      0 |   3000 |   3000 |  10000 |      0 |  10000 |     2500 |    500 |      7500 |

- 2026-03-15 : `3000 − 10000 × (3000 ÷ 12000) = 500`

| Année | l. 51 | Exonérée | Plus-values | Moins-values | Net |  Taux | Impôt |
| ----- | ----: | :------: | ----------: | -----------: | --: | ----: | ----: |
| 2026  |  3000 |   non    |         500 |            0 | 500 | 0.314 |   157 |

### vh-07 — Le seuil de 305 €, pris au mot

La loi exonère les cessions dont la somme « n'excède pas 305 € » : 305 € tout rond est exonéré malgré une plus-value, 305,01 € ne l'est plus. La notice du formulaire écrit « inférieur à 305 € » ; c'est le texte de loi qui tranche le cas limite.

Sources : [cgi-150-vh-bis](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050366751), [lfss-2026-art-12](https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000053226452).

| Cession    | l. 212 | l. 213 | l. 214 | l. 217 | l. 218 | l. 220 | l. 221 | l. 223 | Fraction | l. 224 | PTA après |
| ---------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -------: | -----: | --------: |
| 2024-06-01 |    610 |    305 |      0 |    305 |    305 |    100 |      0 |    100 |       50 |    255 |        50 |
| 2025-06-01 | 610.02 | 305.01 |      0 | 305.01 | 305.01 |    100 |     50 |     50 |       25 | 280.01 |        25 |

- 2024-06-01 : `305 − 100 × (305 ÷ 610) = 255`
- 2025-06-01 : `305.01 − 50 × (305.01 ÷ 610.02) = 280.01`

| Année |  l. 51 | Exonérée | Plus-values | Moins-values |    Net |  Taux |    Impôt |
| ----- | -----: | :------: | ----------: | -----------: | -----: | ----: | -------: |
| 2024  |    305 |   oui    |         255 |            0 |    255 |  0.30 |        0 |
| 2025  | 305.01 |   non    |      280.01 |            0 | 280.01 | 0.314 | 87.92314 |

### vh-08 — Une moins-value dans la même année

Plus-values et moins-values de l'année se compensent ; un solde négatif n'est pas imposé.

Sources : [cgi-150-vh-bis](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050366751), [formulaire-2086](https://www.impots.gouv.fr/sites/default/files/formulaires/2086/2026/2086_5515.pdf).

| Cession    | l. 212 | l. 213 | l. 214 | l. 217 | l. 218 | l. 220 | l. 221 | l. 223 | Fraction | l. 224 | PTA après |
| ---------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -------: | -----: | --------: |
| 2026-03-15 |  12000 |   3000 |      0 |   3000 |   3000 |  10000 |      0 |  10000 |     2500 |    500 |      7500 |
| 2026-09-01 |   3000 |   1000 |      0 |   1000 |   1000 |  10000 |   2500 |   7500 |     2500 |  -1500 |      5000 |

- 2026-03-15 : `3000 − 10000 × (3000 ÷ 12000) = 500`
- 2026-09-01 : `1000 − 7500 × (1000 ÷ 3000) = -1500`

| Année | l. 51 | Exonérée | Plus-values | Moins-values |   Net |  Taux | Impôt |
| ----- | ----: | :------: | ----------: | -----------: | ----: | ----: | ----: |
| 2026  |  4000 |   non    |         500 |         1500 | -1000 | 0.314 |     0 |

<!-- exactitude:v1:fin -->
