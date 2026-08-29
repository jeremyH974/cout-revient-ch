# Comptes à déclarer (formulaire 3916-bis) — l'aide au report

> P66, étude [`proposals/2026-08-29-data-ia-et-agentique.md`](proposals/2026-08-29-data-ia-et-agentique.md) § P66.
> **Ce document décrit une aide au report, déduite de vos comptes déjà saisis. Ni déclaration, ni
> conseil fiscal.**

## Pourquoi ça existe

L'app connaît déjà chaque compte que vous avez saisi (Coinhouse, comptes CSV importés, adresses
on-chain, Hyperliquid) : sa plateforme, son pays quand il est connu, s'il a servi dans l'année.
C'est exactement l'information qu'il faut pour savoir quels comptes appartiennent au formulaire
**3916-bis**, distinct de la déclaration de plus-values (2086). Aucun concurrent du périmètre étudié
ne combine réconciliation et conformité française : Waltio gère le 3916-bis mais sans IA ni
classement automatique, les acteurs anglo-saxons ont l'automatisation mais pas le formulaire
français. Le moteur PRU de cette app conserve déjà les comptes et leurs opérations : il ne manquait
que la règle de classement.

## Le droit applicable, et ses sources datées

**Texte** : article 1649 bis C du CGI
([Légifrance](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000037988279/), version en
vigueur depuis le 01/07/2026). Les personnes domiciliées ou établies en France déclarent, avec leur
déclaration de revenus, les références des comptes de crypto-actifs **ouverts, détenus, utilisés ou
clos auprès d'entreprises, personnes morales, institutions ou organismes établis à l'étranger**. Le
critère est l'établissement de l'ORGANISME — jamais sa licence, jamais la chaîne suivie par le
compte.

**Coinhouse est hors périmètre** : PSCA français (COINHOUSE SAS, Paris, agrément AMF n° A2026-013
du 11/05/2026).

**Les plateformes européennes SONT dans le périmètre.** Le passeport MiCA ne change rien au critère
légal de l'établissement : Bitpanda (Autriche), Bitvavo (Pays-Bas) et SwissBorg (Suisse) restent des
organismes étrangers → comptes déclarables, **même vides**.

**Le portefeuille auto-hébergé n'est PAS tranché par le texte.** La doctrine
[BOI-RPPM-PVBMC-30-30](https://bofip.impots.gouv.fr/bofip/11969-PGP.html/identifiant=BOI-RPPM-PVBMC-30-30-20240423)
reprend la formule légale (compte détenu _auprès d'un tiers_) sans viser nommément le cas d'un
portefeuille dont l'utilisateur détient seul la clé, et un amendement en discussion (CF1520, PLF 2026) viserait à le couvrir au-delà de 5 000 €. **L'app signale l'incertitude, elle ne tranche pas.**

**Sanctions — article 1736 X du CGI**
([Légifrance](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051215709)) : **750 € par
compte non déclaré**, **125 € par omission ou inexactitude**, **plafond 10 000 € par déclaration**.
Ces montants passent à **1 500 €** et **250 €** _seulement si_ la valeur cumulée des comptes dépasse
**50 000 €** à un moment quelconque de l'année — l'app ne dit jamais « 1 500 € sans seuil », qui est
une confusion répandue avec le régime bancaire de l'article 1649 A.

**Aucun délai de prescription n'est affiché** : le « 10 ans » qui circule sur le sujet n'a pas été
confirmé en source primaire pour les actifs numériques au moment de cette étude. Un chiffre non
vérifié serait pire qu'un chiffre absent.

**Portée non couverte** : le texte vise désormais aussi les actifs uniques et non fongibles (NFT),
que cette application ne suit pas. La liste produite n'est donc pas exhaustive si vous détenez des
NFT — l'app le rappelle dans ses avertissements plutôt que de le taire.

## Ce que l'app affiche

- **Écran Comptes** : un badge de statut sur chaque compte (`Hors périmètre (France)`,
  `À déclarer (3916-bis)`, `Incertain (clé détenue seul)`, `Pays à préciser`), et un sélecteur de
  pays pour tout compte au statut « à préciser » — jamais deviné.
- **Rapport → « Comptes à déclarer (formulaire 3916-bis) »** (écran et export) : une section voisine
  de la fiscalité 150 VH bis, avec un tableau (compte, statut, détail), les avertissements qui
  s'appliquent à vos données (sanctions, cas auto-hébergé, pays inconnu, portée NFT), et le même
  rappel « ni déclaration, ni conseil fiscal ». Absente si aucun compte n'est concerné.
- **Export CSV** (`accountDeclarationsToCsv`, calqué sur l'export des cessions 2086) et bouton
  « Copier la liste » (presse-papier), tous deux limités aux comptes CONCERNÉS — un compte hors
  périmètre France n'a rien à faire dans une liste « à déclarer ».

## Les hypothèses, et où elles peuvent casser

| Hypothèse                                                                    | Effet si elle est fausse                                                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Le pays d'un compte CSV/manuel est celui que vous avez renseigné             | Un pays non renseigné reste « à préciser », jamais deviné depuis la chaîne suivie                                               |
| Les défauts de pays (Bitvavo/NL, Bitpanda/AT, SwissBorg/CH) sont à jour      | Une plateforme peut changer d'entité ; corrigez le pays depuis l'écran Comptes                                                  |
| Un compte on-chain ou Hyperliquid est un portefeuille auto-hébergé           | Le texte ne le dit pas noir sur blanc : c'est une prudence, pas une certitude                                                   |
| « Détenu actuellement » = solde non nul sur le grand livre importé           | Une opération non importée fausse le solde reconstitué (dépôts/retraits signés)                                                 |
| « Peut-être clos dans l'année » = détenu puis vidé avant la fin de l'année   | Un signal, jamais une preuve — le grand livre peut s'arrêter avant la clôture réelle                                            |
| Kraken, Coinbase, Binance, Revolut, Ledger Live n'ont pas de pays par défaut | Structures multi-entités : deviner serait pire que demander — le compte reste « à préciser » tant que vous ne le renseignez pas |

Chacune de ces situations produit un avertissement explicite dans la section du rapport quand elle
concerne vos données.

## Ce que ça ne fait pas

Pas de formulaire 3916-bis pré-rempli au sens administratif, pas de tranchage du cas auto-hébergé,
pas de délai de prescription affiché, pas de suivi des NFT. Ces éléments restent hors périmètre de
P66 ; voir [`proposals/2026-08-29-data-ia-et-agentique.md`](proposals/2026-08-29-data-ia-et-agentique.md)
pour la suite envisagée (P67 — veille réglementaire compilée).

**Faites vérifier votre situation par un professionnel avant toute déclaration.**

## Ce qui est vérifié

- `src/lib/domain/declarations-fr.test.ts` — classement de chaque genre de compte (Coinhouse, pays
  `FR` explicite, CSV/manuel étranger, on-chain, Hyperliquid, pays inconnu), usage dans l'année,
  compte étranger vide compté quand même, détection d'une clôture possible dans l'année, et le
  refus de promouvoir un compte auto-hébergé quelle que soit son activité.
- `src/lib/format/declarations-fr.test.ts` — une phrase complète par statut, sans trou de
  formatage, et la formulation exacte des enjeux (sanctions, cas auto-hébergé).
- `src/lib/export/report-model.test.ts` — la section du rapport, sa présence conditionnée aux
  comptes réellement concernés, et ses avertissements.
- `src/lib/export/csv-export.test.ts` — l'export CSV, limité aux comptes concernés.
- `src/lib/storage/storage.test.ts` — une sauvegarde écrite avant P66 (compte sans `country`) se
  recharge sans perte ; un code pays invalide n'invalide jamais le compte, seulement le champ.
