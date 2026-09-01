# Estimation fiscale française — l'aperçu avant de vendre

> P30, livré le 26/08/2026 — décision de conception : [`docs/DECISIONS.md`](DECISIONS.md) n° 43.
> Issu de l'étude [`proposals/2026-08-26-aide-a-la-decision.md`](proposals/2026-08-26-aide-a-la-decision.md).
> **Ce document décrit une estimation. Ni déclaration, ni conseil fiscal.**

## Pourquoi ça existe

C'est le trou du marché relevé par l'étude : Betterment montre l'impôt estimé **avant** de
confirmer une vente, mais personne ne sait le faire avec la méthode française. Koinly désactive son
module d'optimisation en mode France, Blockpit calcule en FIFO non conforme, Waltio estime l'impôt
annuel mais pas « et si je vends maintenant ». Le moteur PRU de cette app conserve déjà toutes les
cessions : il ne manquait que la formule.

## La formule, et ce qu'elle implique

Article 150 VH bis du CGI, méthode dite globale :

```
plus-value = prix de cession − prix total d'acquisition × (prix de cession ÷ valeur globale
                                                            du portefeuille au jour de la cession)
```

Deux conséquences commandent tout le reste :

1. **Le prix total d'acquisition (PTA) est celui du portefeuille entier, pas d'un actif.** Il n'a
   rien à voir avec le PRU par actif affiché partout ailleurs dans l'app (décision n° 10). Il monte
   à chaque achat en euros et se consomme, cession après cession, au prorata de ce qui est vendu.
   Connaître le PTA d'aujourd'hui exige donc de **rejouer tout l'historique dans l'ordre**.
2. **Seule la sortie vers une monnaie ayant cours légal est imposable.** Les échanges entre actifs
   numériques — stablecoins compris, y compris un stablecoin euro comme EURCV — bénéficient du
   sursis : ils ne déclenchent rien et ne touchent pas au PTA.

S'y ajoutent : le **seuil de 305 €** (si le total des prix de cession de l'année ne le dépasse pas,
rien n'est imposable ; au-delà, tout l'est dès le premier euro — ce n'est pas un abattement), le
**PFU** de 31,4 % depuis les cessions 2025 (12,8 % d'impôt sur le revenu + 18,6 % de prélèvements
sociaux, la CSG patrimoine étant passée à 10,6 %), 30 % avant, et l'imputation des **moins-values
sur la seule année en cours** — un net annuel négatif est perdu, il ne se reporte pas.

## Ce que l'app affiche

- **Simulateur → mode « Vendre » → sortie « Vente en euros »** : un dépliant « Estimation fiscale
  française (avant de vendre) » donne la plus-value imposable estimée, le détail (prix de cession
  moins prix d'acquisition imputé) et l'effet sur l'impôt de l'année — supplément dû, réduction
  d'impôt si la vente dégage une moins-value, exonération sous le seuil, ou année nette perdante.
  Le dépliant ne charge l'historique des prix qu'à son ouverture : la feuille reste instantanée
  pour qui ne s'en sert pas.
- **Rapport → « Fiscalité française (estimation) »** (écran et PDF) : les trois derniers
  millésimes (cessions imposables, résultat net, impôt estimé) et le prix total d'acquisition
  restant, plus les avertissements qui s'appliquent à vos données.
- **Constats** : « Fiscalité de l'année » rejoint les règles de [`docs/insights.md`](insights.md).

Les montants restent **en euros** même quand l'app affiche en dollars : c'est une obligation
française.

## Les hypothèses, et où elles peuvent casser

| Hypothèse                                                                  | Effet si elle est fausse                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Ce portefeuille est votre portefeuille entier**                          | La méthode est globale : des avoirs ailleurs changent PTA _et_ valeur globale |
| Valeur globale du jour reconstituée = clôture + produits encaissés ce jour | La loi vise la valeur à l'instant de la cession ; c'est une approximation     |
| Historique de prix disponible à la date de chaque cession                  | Sans lui, la cession n'est pas chiffrée — et le dit, plutôt que d'inventer    |
| Récompenses entrées à coût nul (décision n° 9)                             | Leur régime propre n'est pas traité ; elles sont comptées et signalées        |
| Entrées venues de l'extérieur sans coût connu                              | PTA sous-estimé, donc plus-value surestimée — signalé                         |
| Sorties vers l'extérieur = transferts                                      | Un paiement en crypto est imposable ; un export ne permet pas de trancher     |

Chacune de ces situations produit un avertissement explicite dans la section du rapport quand elle
concerne vos données.

## Ce que ça ne fait pas

Pas de formulaire 2086 pré-rempli, pas de réconciliation DAC8, pas d'option pour le barème
progressif, pas de traitement du régime propre des récompenses ni du minage. Ces éléments restent
le périmètre de P13 dans la feuille de route.

**Faites vérifier votre situation par un professionnel avant toute déclaration.**

### Les perpetuals sont exclus, et ce n'est pas un oubli

L'estimation ne couvre que l'espace **Investissement**. Les perpetuals de l'espace Trading en sont
absents, pour une raison de droit et non de commodité : les contrats à terme et CFD relèvent
vraisemblablement de l'**article 150 ter du CGI** — prélèvement forfaitaire sans abattement, pertes
imputables sur les seuls gains de même nature, report sur dix ans — soit un régime **distinct** de
celui des cessions d'actifs numériques. Les agréger dans un même chiffre mélangerait deux régimes.

Et il faut dire le reste : **la qualification d'un perpetual DeFi non régulé au regard de ce texte
n'est tranchée par aucune source primaire trouvée**. Ce n'est pas une réserve de prudence, c'est
l'état du droit tel qu'il a pu être établi — voir la ligne « Régime fiscal des perpetuals » de
l'écran Veille réglementaire.

Sur un point que le droit ne tranche pas, produire un chiffre serait pire que n'en produire aucun.
L'exclusion est donc **verrouillée par un test** (`normalize.test.ts`) plutôt que laissée à la
construction : aucun perpetual ne devient un événement d'Investissement, quel que soit le réglage
« traiter le spot comme de l'investissement ». Le spot vendu contre euros, lui, est bien une cession
imposable et entre normalement dans le calcul.

## Ce qui est vérifié

- `src/lib/domain/tax-fr.test.ts` — classement des opérations (cession, acquisition, sursis), taux
  par millésime, application de la formule, enchaînement des cessions (chacune part du PTA laissé
  par la précédente), plafonnement de la fraction imputée, aveu quand la valeur globale manque,
  priorité de la valeur saisie à la main, seuil des 305 €, imputation des moins-values dans
  l'année, absence de report, et l'aperçu avant vente (supplément d'impôt, exonération, refus de
  deviner).
- `src/lib/export/report-model.test.ts` — la section du rapport, sa persistance en euros en mode
  dollars, ses avertissements.
- `tests/e2e/coherence.spec.ts` — le constat et le tableau annoncent le même total de cessions, et
  les deux hypothèses structurantes restent écrites à l'écran.
