# Actions et ETF — un onglet eToro, et le symbole qui ne dit pas sa classe

> Proposition du 6 septembre 2026. Question traitée : « Peut-on créer un nouvel onglet pour
> intégrer mes actifs du site eToro ? Comment font les meilleurs ? Que donne l'état de l'art, avec
> une architecture prête pour le futur ? »
>
> Méthode : trois recherches **parallèles** menées le 06/09/2026 — ce qu'eToro laisse réellement
> sortir `[E…]`, pratiques des moteurs de portefeuille et modèle de données canonique `[P…]`,
> fournisseurs de cours sondés en requêtes réelles `[M…]` — plus un audit des points d'extension du
> code et une relecture des propositions antérieures. Chaque affirmation porte sa source ; ce qui
> n'a pas pu être vérifié sur source primaire est marqué **[NON VÉRIFIÉ]**, **[PROBABLE]** ou
> **[INCERTAIN]** et **ne doit pas être codé sans contrôle**.
>
> Ce document ne modifie aucun code. Il propose des décisions.

---

## 1. La question, reformulée

Comme pour le crowdlending (proposition du même jour), la demande recouvre plusieurs choses qu'il
faut cesser de confondre. Ici elles sont **trois**, et non deux :

1. **La collecte** — sortir les opérations d'eToro.
2. **Le modèle** — savoir quoi en faire : classe d'actif, PRU, régime fiscal.
3. **La valorisation** — connaître le cours d'une action ou d'un ETF, ce qu'aucune source interne
   ne sait faire aujourd'hui.

Sur la crypto, la collecte était réglée et le modèle était le travail. Sur le crowdlending, c'était
l'inverse. **Ici, la collecte est réglée, la valorisation vient d'être débloquée, et le modèle
cache un défaut latent qui existe déjà dans le code** (§ 5). C'est le résultat le plus important de
cette étude, et il ne concerne pas eToro.

---

## 2. Ce que le dépôt dit déjà — et la contradiction à trancher

### 2.1 P41 existe, et son déclencheur vient d'arriver

La proposition du 25/08 a déjà instruit le sujet sous le nom **P41 — « Actions et ETF : classe
fongible, ISIN, sondes de fournisseurs de prix »**, coté 2,5 sessions, placé en lot 4, avec une
mention explicite : « À ne lancer que sur demande réelle. P41 commence par **une demi-session de
sondes CORS** qui décide s'il est faisable ; s'il ne l'est pas, la saisie manuelle de cours reste
acceptable et P41 se réduit »
([`2026-08-25-consolidation-patrimoniale.md:354`](2026-08-25-consolidation-patrimoniale.md)).

Deux faits nouveaux : **la demande réelle est arrivée**, et **les sondes ont été faites** (§ 6, quinze
fournisseurs testés en requêtes réelles). Le verdict est positif. P41 n'a pas à se réduire.

La question ouverte n° 4 de cette même proposition — « acceptez-vous une clé facultative de
fournisseur de cours, par extension de la décision n° 32 ? » — devient donc tranchable (§ 6.3).

### 2.2 Le réaudit du 01/09 dit l'inverse, et il faut le regarder en face

Le réaudit contre la 2.15.0 range « ne pas ajouter actions et immobilier » parmi les recommandations
qui « restent valables, sans changement »
([`2026-09-01-etat-de-lart-reaudit.md`](2026-09-01-etat-de-lart-reaudit.md), § 3.4). **Aucune
décision numérotée n'a arbitré**, mais c'est l'avis le plus récent du dépôt sur exactement ce sujet,
et il est défavorable.

La proposition crowdlending du même jour lui oppose que « le verdict de retenue visait des classes
bloquées sur un fournisseur de prix externe ». L'argument la sauve, elle. **Il ne me sauve pas** :
les actions et les ETF sont précisément la classe bloquée sur un fournisseur externe. L'honnêteté
oblige à dire que l'objection porte ici de plein fouet.

Ce qui l'affaiblit tout de même, point par point :

| Ce que craignait la retenue                               | État après les sondes du 06/09                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Dépendance à un fournisseur de cours que rien ne garantit | Réelle, mais **le repli existe déjà** : `manualQuote` / `AssetSettings.manualPriceEur`, et il dégrade au lieu de casser |
| Charge de maintenance d'un mainteneur unique              | Le convertisseur est un fichier de plus dans un patron à huit exemplaires ; le coût est ailleurs (§ 7)                  |
| Élargissement spéculatif du périmètre                     | Ce n'est plus spéculatif : le compte existe et contient des actifs                                                      |

Ce qui tient, et qu'il ne faut pas balayer : **la fiscalité des valeurs mobilières est un second
module fiscal complet**, que P41 ne chiffrait pas. C'est la partie que je recommande de laisser hors
périmètre de la première version (§ 7.5).

### 2.3 La valeur nette attend déjà ce producteur

La décision n° 51 pose la valeur nette comme `Σ contributions − Σ passifs` et nomme P41 (« actions
et ETF ») parmi les trois producteurs qui doivent s'y brancher sans réécriture
([`DECISIONS.md:863`](../DECISIONS.md), [`ROADMAP.md:53`](../ROADMAP.md)). L'emplacement est réservé
depuis le 25/08 ; il n'y a rien à négocier de ce côté.

---

## 3. Ce qu'eToro laisse réellement sortir

### 3.1 L'export « Account Statement » est la voie, et la seule

Un compte retail génère depuis son historique un **relevé au format XLSX** — pas de CSV natif `[E4]`.
Trois feuilles sont attestées sur source secondaire vérifiable : _Account Summary_ (dépôts, retraits,
capitaux propres réalisés et latents), _Financial Summary_ (P&L, dividendes, frais, par catégorie) et
_Closed Positions_ `[E3][E4]`. Les feuilles _Open Positions_, _Dividends_ et _Account Activity_ sont
citées par plusieurs guides tiers mais **[NON VÉRIFIÉ]** : les pages d'aide d'eToro sont une
application monopage protégée contre les clients non-navigateurs, et n'ont pas pu être lues.

Restent **[NON VÉRIFIÉ]**, et c'est ce qui commande le § 11 : la liste exacte des colonnes de
_Closed Positions_, le format des dates, le séparateur décimal, la présence d'un ISIN ou d'un
identifiant d'instrument, et la devise de compte (l'USD est probable, non confirmé sur source
primaire).

Un fait vérifié et désagréable : **les libellés de colonnes sont instables**. Un parseur tiers
open source doit tester plusieurs formes du même en-tête dans _Financial Summary_ — « Amount in
(USD) », « Amount (USD) », et des variantes contenant un saut de ligne `[E3]`. Toute détection devra
donc se faire par alias, jamais par position, exactement comme
[`detect.ts`](../../src/lib/import/coinhouse/detect.ts) le fait déjà pour Coinhouse.

### 3.2 L'API publique de février 2026 : ouverte techniquement, fermée par la décision n° 32

eToro a ouvert une **API publique en bêta** (« Builders' Economy », conditions du 17/02/2026)
`[E1][E2]`. L'usage permis couvre explicitement l'accès à son propre compte pour un usage personnel :

> « "Permitted Use" means using the API […] to access and manage your own eToro trading account,
> develop and test tools for personal use […] but excluding any commercial redistribution of eToro
> data » `[E1]` (Part I, § 1.2) — [VÉRIFIÉ]

C'est tentant, et il faut y renoncer. **Une clé d'API eToro est une clé de compte**, qui donne accès
aux ordres et aux positions. La décision n° 32 tranche seule : « une clé d'explorateur de blocs est
acceptée (facultative) ; une clé d'exchange reste refusée » ([`DECISIONS.md:446`](../DECISIONS.md)).
La voie est donc fermée par une règle du projet, pas seulement par une difficulté technique — ce qui
est une meilleure raison, et une raison stable. S'y ajoutent deux fragilités : produit en bêta dont
l'accès est « accordé, refusé ou révoqué à tout moment » `[E1]`, et présence d'en-têtes CORS **[NON
VÉRIFIÉ]** pour un appel depuis un navigateur.

### 3.3 Ce que le scraping n'a pas le droit d'être

> « You agree not to […] scrape, bulk-download, cache, redistribute, sell, sublicence, or create
> separate databases from Licensed Content […] beyond the Permitted Use » `[E1]` (Part V, § 1.8) —
> [VÉRIFIÉ]

Télécharger soi-même son propre relevé est une fonctionnalité native du produit et n'entre pas dans
cette clause. Automatiser une session de navigateur pour aller le chercher, si. **Le fichier est
apporté par l'utilisateur, comme le CSV Coinhouse. Rien d'autre n'est envisagé.**

### 3.4 Les pièges déjà documentés

- **Pas d'export incrémental** : il faut retélécharger l'historique complet à chaque recalcul `[E5]`.
  Le dédoublonnage par empreinte du contenu natif (décisions n° 24 et 26) absorbe cela sans rien
  changer — c'est exactement le cas d'usage pour lequel il a été écrit.
- **Les plus-values calculées par eToro ne suivent aucune règle fiscale locale** et diffèrent de
  celles d'un outil fiscal `[E5]`. Le relevé fournit des faits, jamais un résultat à recopier.
- **Ouvrir puis réenregistrer le XLSX dans un tableur casse le parsing** des outils tiers `[E5]`.
  L'interface devra le dire au moment de l'import.
- Dividendes manquants, arrondis, CFD mal isolés des actions réelles, frais overnight non détaillés :
  récurrents dans la littérature des outils fiscaux, mais **[NON VÉRIFIÉ]** — aucun fil daté et
  précis n'a pu être localisé.

---

## 4. Ce que font les meilleurs

| Outil                           | Ce qu'il ingère                                     | Ce qu'il en dit                                                                            |
| ------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Portfolio Performance** (OSS) | Aucun extracteur eToro ; CSV générique configurable | Exige **ISIN, ticker ou WKN** — le ticker seul est jugé insuffisant `[P2]`                 |
| **Ghostfolio** (OSS)            | Aucun connecteur eToro ; import JSON/CSV générique  | **Six types d'opération seulement** : BUY, SELL, DIVIDEND, FEE, INTEREST, LIABILITY `[P1]` |
| **Divly**                       | XLSX du relevé                                      | CFD imposable **à la clôture seulement** `[P6]`                                            |
| **Snowball Analytics**          | XLS du relevé                                       | Un fichier par année civile, ordre chronologique `[P8]`                                    |
| **Koinly**, **CoinTracking**    | CSV/relevé                                          | Contrôles post-import : base de coût manquante, doublons, trous de prix `[P4][P5]`         |
| **Sharesight**                  | Reformatage manuel requis                           | Absence de format eToro natif assumée `[P7]`                                               |
| **Parqet**                      | Script tiers PDF → 2 CSV                            | Aucun import natif `[P9]`                                                                  |
| **Finary**                      | API eToro (clés en lecture seule)                   | « Ne peut pas encore garantir une synchronisation totalement fiable » `[P10]`              |

### Trois enseignements

1. **Aucun moteur open source ne modélise un CFD comme une quantité détenue.** Ni Ghostfolio ni
   Portfolio Performance n'ont de type pour cela `[P1][P2]` ; Divly et Delta le traitent comme un
   résultat de trésorerie à la clôture `[P6][P11]`. Ce n'est pas un raccourci d'implémentation, c'est
   le consensus du terrain — et il rejoint la décision n° 35 (dater le P&L à la réalisation).
2. **On ne stocke jamais un montant déjà converti.** Portfolio Performance garde quatre champs
   distincts : valeur nette, montant brut, devise d'origine et taux de change `[P2]`. Le Conseil
   d'État impose la même chose en droit : conversion au taux du jour de **chaque** opération, l'écart
   de change étant intégré à la plus-value `[X4]`.
3. **Un ticker n'identifie rien.** `SOL` désigne Solana et une société cotée au NYSE ; `UNI` désigne
   Uniswap et une action. Le dépôt connaît déjà ce problème pour la crypto (décision n° 54 : un
   symbole ambigu ne reçoit aucun identifiant plutôt qu'un prix faux) et
   [`2026-08-27-couverture-actifs.md:161`](2026-08-27-couverture-actifs.md) annonçait déjà que « le
   même problème se pose avec les ISIN ».

---

## 5. Le point dur : le symbole ne dit pas sa classe

C'est le cœur de cette proposition, et il concerne le code actuel bien plus qu'eToro.

```ts
// src/lib/domain/assets.ts:41 — aujourd'hui
export function assetClass(code: AssetCode): AssetClass {
  if (FIAT.has(code)) return 'fiat';
  if (STABLECOINS.has(code)) return 'stablecoin';
  return 'crypto';
}
```

**Tout ce qui n'est ni une des quatre devises ni un stablecoin est déclaré crypto par défaut.**
[VÉRIFIÉ] Une ligne `AAPL` importée demain deviendrait une crypto sans un mot d'avertissement, et
entrerait dans l'assiette du 150 VH bis. Pire : une position Solana et une position Emeren Group
partageraient la même clé `SOL`, donc le même PRU, donc le même lot.

**Conséquence directe et non cosmétique : la classe d'actif doit être une donnée portée par
l'événement, jamais une déduction faite à partir du symbole.** Elle est connue au moment de
l'import — c'est la feuille du relevé, ou la colonne, qui la donne — et il n'y a aucune raison de la
perdre pour tenter de la deviner ensuite. La clé d'une position devient alors un couple
`(classe, code)` : `equity:XNAS:AAPL` face à `crypto:SOL`.

Ce que cela ne change pas, et c'est une bonne nouvelle : le calcul lui-même.

```ts
// src/lib/domain/engine/position.ts:83 — inchangé
get pru(): Big | null {
  return isPositive(this.qty) ? this.costBasis.div(this.qty) : null;
}
```

Le coût moyen pondéré de la décision n° 5 **est déjà** la méthode légale française pour les valeurs
mobilières (§ 7.1). C'est la crypto qui est l'exception dans ce moteur, pas les actions. Le moteur
n'a pas à changer ; c'est sa clé d'entrée qui doit devenir honnête.

Le reste du modèle est déjà prêt : `accountId` est porté par chaque `LedgerEvent`
([`types.ts:174`](../../src/lib/domain/types.ts)), le format pivot est multi-source par construction
(décision n° 24), et huit convertisseurs de plateformes cohabitent déjà. **La plomberie d'import
n'est pas le sujet.**

Deux limites à relever franchement : le contrôle de solde ne s'applique qu'au `scope: 'coinhouse'`
([`engine/compute.ts:121`](../../src/lib/domain/engine/compute.ts)) — un solde eToro ne serait vérifié
par aucun garde-fou existant ; et l'oracle indépendant réimplémente un parseur **spécifique au CSV
Coinhouse**, donc un import eToro ne le fait pas rougir mais n'est pas non plus couvert par lui.

---

## 6. La valorisation : les sondes que P41 réclamait

Quinze fournisseurs testés le 06/09/2026 par requête réelle avec en-tête `Origin`. **Le CORS a été
mesuré, pas supposé** — c'est le critère éliminatoire n° 1 pour une application sans serveur.

### 6.1 Ce qui élimine qui

| Motif d'élimination                          | Fournisseurs                                                   |
| -------------------------------------------- | -------------------------------------------------------------- |
| **Aucun en-tête CORS** [VÉRIFIÉ]             | Yahoo Finance, EODHD, Tiingo, OpenFIGI                         |
| CGU interdisant l'accès automatisé           | Yahoo Finance (API officielle arrêtée en 2017) `[M4]`          |
| Quota sous les ~50 requêtes/jour nécessaires | Alpha Vantage (25/jour), MarketStack (100/**mois**) `[M7][M8]` |
| Couverture hors-États-Unis en payant         | Finnhub, Polygon.io                                            |
| Pas d'API stable, anti-bot ou scraping seul  | Stooq, justETF, Euronext, Boursorama                           |
| Jeu de données abandonné                     | Nasdaq Data Link / Quandl (WIKI, depuis 2018)                  |

### 6.2 Ce qui reste

**Twelve Data** `[M2]` : CORS ouvert [VÉRIFIÉ], 800 requêtes/jour, clé gratuite, et couverture
confirmée sur un ISIN UCITS réel (IE00B4L5Y983 résolu sur Amsterdam, Xetra et Londres) — le cas le
plus difficile, et celui qui élimine la moitié du marché. Repli en second rang : Financial Modeling
Prep (CORS ouvert, 250 requêtes/jour, fin de journée seulement, couverture ETF non confirmée) `[M6]`.

Ghostfolio résout le problème autrement : son backend appelle Yahoo côté serveur, où aucun mur CORS
ne s'oppose — au prix de pannes récurrentes `[M5]`. **Voie fermée ici, et c'est structurel.**

### 6.3 La clé : extension de la décision n° 32, pas exception

Une clé Twelve Data est une clé de **données de marché en lecture seule**, qui n'ouvre aucun compte
et n'expose aucun avoir. C'est la même famille que la clé d'explorateur de blocs acceptée par la
décision n° 32, et l'opposé de la clé d'exchange qu'elle refuse — et l'opposé, aussi, de la clé
d'API eToro du § 3.2. Le schéma BYOK existe déjà dans le produit (décision n° 69). Aucune clé dans
le bundle, aucune origine ajoutée pour un utilisateur qui n'en veut pas — ce dernier point mérite
attention, car le réaudit du 01/09 a montré que la CSP étant injectée au build, **une origine
inscrite l'est pour tout le monde** (§ 3.1 du réaudit).

### 6.4 ISIN → ticker : en script, jamais dans le navigateur

OpenFIGI (Bloomberg) résout un ISIN en ticker et en code de place, et ses conditions autorisent
explicitement le stockage et la redistribution — seule la marque « FIGI » est protégée `[M3]`. Mais
**il n'envoie aucun en-tête CORS, ni au préflight ni sur la réponse** [VÉRIFIÉ], contrairement à une
croyance répandue.

La conclusion s'écrit d'elle-même dans la doctrine du dépôt (décision n° 59 : la licence choisit le
mode de transport) : **table générée par script et committée**, sur le patron exact de
`generate-tickers.mjs`, avec la table curée prioritaire sur la table générée. Jamais d'appel à
l'exécution. Aucun instantané de **cours** en revanche : aucune licence sondée ne l'autorise, l'appel
navigateur reste le mode par défaut.

---

## 7. Fiscalité — deux assiettes, et une seule est déjà écrite

### 7.1 Deux régimes qui ne peuvent pas partager un calcul

- **Valeurs mobilières**, art. 150-0 D du CGI : **prix moyen pondéré d'acquisition, par ligne
  fongible** `[X1]`. Exemple du BOFiP : 100 à 95 €, 200 à 105 €, 100 à 107 € donnent un PMP de
  103 € ; une vente de 150 à 110 € dégage 1 050 € et le reliquat garde son PMP.
- **Actifs numériques**, art. 150 VH bis : `plus-value = prix de cession − (prix total d'acquisition
× prix de cession / valeur globale du portefeuille)` `[X2]`, avec revalorisation du portefeuille
  **entier à chaque cession**.

[VÉRIFIÉ] Le premier est une moyenne glissante par ligne ; le second un agrégat de portefeuille sans
notion de lot. **Ils sont incompatibles dans un même calcul, et doivent être deux dérivations
parallèles des mêmes événements bruts.** Le moteur actuel produit déjà le premier sans le savoir.

### 7.2 Le piège : la crypto eToro appartient à l'assiette existante

Le formulaire 3916-bis liste eToro **en dur, sous le code `013 ETORO`**, dans son cadre des comptes
d'actifs numériques ouverts à l'étranger `[X3]`. [VÉRIFIÉ] Conséquence en deux temps :

1. `declarations-fr.ts` peut le remplir — un service rendu, presque gratuit, par le mécanisme qui
   traite déjà Coinhouse.
2. **La crypto détenue chez eToro entre dans la valeur globale du portefeuille du 150 VH bis**, aux
   côtés de celle de Coinhouse. Le filtre est donc **par classe d'actif, jamais par compte**. Écrire
   « les événements eToro sont hors de l'assiette crypto » produirait un chiffre faux.

À l'inverse, les CFD versés dans l'espace Trading en sortent de fait, puisque `frenchTax()` ne lit
que les événements d'investissement — mais **rien ne le documente**, faiblesse déjà relevée par le
réaudit du 01/09 (§ 3.3).

### 7.3 Les dividendes ne sont pas des plus-values

Revenus de capitaux mobiliers, imposés séparément, avec une retenue à la source américaine à
imputer en crédit d'impôt. Les mélanger à la plus-value fausserait les deux. **Modèle distinct dès
le départ**, même si l'écran ne les affiche pas en v1.

### 7.4 Ce qu'il faut vérifier avant de coder

- Le taux du prélèvement forfaitaire unique applicable en 2026 — le dépôt le porte à 31,4 %
  **[PROBABLE]**, non confirmé sur source primaire (déjà signalé le 25/08, § 9) ;
- les numéros de cases de la déclaration (plus-values sur titres, dividendes, crédit d'impôt
  conventionnel) — **[NON VÉRIFIÉ]**, à relever sur le formulaire de l'année ;
- **le régime des CFD** — **[NON VÉRIFIÉ]**, aucune source primaire consultée ; ne rien afficher tant
  qu'il n'est pas tranché sur le BOFiP ;
- la source de taux de change admise : le taux du jour de l'opération est acquis `[X4]`, mais la
  source de référence reste **[INCERTAIN]** — Frankfurter/BCE est déjà en place et défendable.

### 7.5 Recommandation : hors périmètre de la première version

C'est la concession qui répond à l'objection du § 2.2, et elle est sincère. Un second module fiscal
complet, avec son risque juridique propre, ne doit pas être le prix d'entrée d'un écran de suivi. La
décision n° 10 avait mis le 150 VH bis hors périmètre v1 en son temps ; il a été construit plus tard,
proprement, quand le socle le portait. **Même chemin ici** : les positions, le PRU et les plus-values
latentes d'abord, avec une étiquette d'interface qui dit franchement que le calcul fiscal des titres
n'est pas fourni.

---

## 8. Ce qu'on ne fait pas

- **Aucun appel à l'API eToro** (§ 3.2), et aucune automatisation de session : le fichier est apporté.
- **Aucun instantané de cours committé** : aucune licence sondée ne l'autorise (§ 6.4).
- **Aucun appel à OpenFIGI depuis le navigateur** : pas de CORS, et une table committée fait mieux.
- **Aucune clé dans le bundle** : BYOK ou rien (décision n° 32).
- **Aucun chiffre fiscal sur les titres en v1** (§ 7.5).
- **Aucun ETF synthétique, aucune option, aucun produit à barrière** : hors sujet et hors compétence
  du moteur.
- **Aucun `number`** : la règle du moteur pur ne connaît pas d'exception, une quantité fractionnaire
  d'action pas plus qu'une quantité de satoshis.

---

## 9. Architecture d'intégration

**Convertisseur, pas moteur.** Contrairement au crowdlending qui réclame `domain/lending/`, les
titres se calculent avec le moteur existant (§ 5). Un fichier `src/lib/import/platforms/etoro.ts`
enregistré dans `PLATFORM_CONVERTERS`, et le relevé se répartit sur **trois destinations selon la
classe, jamais selon la source** : titres vers l'écran Titres, crypto vers l'Investissement et
l'assiette 150 VH bis, CFD vers le Trading en résultat de trésorerie à la clôture.

**Lecture du XLSX en chargement différé.** `read-excel-file` (MIT, publié le 10/08/2026, aucune
vulnérabilité connue) via un `import()` dynamique, pour que la bibliothèque ne pèse sur le bundle que
le jour où l'on importe un classeur. Le paquet npm `xlsx` est **écarté** : figé à la 0.18.5 de mars
2022, avec deux avis de sécurité dont le texte indique qu'aucune version corrigée n'est disponible
sur npm `[M9]`. [VÉRIFIÉ]

**Navigation — le vrai arbitrage, et il a changé aujourd'hui.** La proposition crowdlending du même
jour recommande de ne pas consommer le dernier emplacement de la barre (cinq entrées, dont « Plus »),
et prévoit qu'« à ce moment-là, l'espace s'appelle **Patrimoine**, pas Prêts ». Deux classes
non-crypto arrivent le même jour. La synthèse s'impose :

|                         | Sous-espace d'Investissement | 5ᵉ espace « Bourse »            | **5ᵉ espace « Patrimoine »**  |
| ----------------------- | ---------------------------- | ------------------------------- | ----------------------------- |
| Vocabulaire             | mélangé au PRU crypto        | distinct                        | distinct                      |
| Dernier emplacement     | préservé                     | **brûlé pour une seule classe** | dépensé une fois, pour toutes |
| Accueil du crowdlending | —                            | impossible                      | sous-espace « Prêts »         |

**Recommandation : un cinquième espace nommé « Patrimoine »**, avec « Titres » et « Prêts » en
sous-espaces. Il satisfait les deux propositions du jour, respecte la demande d'un onglet dédié, et
survit à l'arrivée d'un Degiro ou d'un Trade Republic (P46) sans nouvelle entrée de navigation. Un
onglet nommé d'après un courtier ne survivrait pas au deuxième courtier.

**Persistance** : réutilisation de `pivotRows` et `accounts`, chemin déjà pris par les huit
plateformes. **Additif, donc sans bump de `SCHEMA_VERSION`** (décision n° 66) — mais `mergeStates()`
et le test de complétude de `storage.test.ts` exigeront une décision explicite.

**Listes vérifiées à mettre à jour, sous peine d'échec de CI** : `KNOWN_ORIGINS`
([`csp.ts:44`](../../src/lib/support/csp.ts)) pour Twelve Data, `ARCHITECTURE.md` pour le convertisseur
et l'origine, `KIND_LABELS` d'`Accounts.svelte` par exhaustivité TypeScript, `nav.spec.ts` et
`a11y.spec.ts` pour le nouvel espace, `sources.ts` pour l'attribution.

**Auto-vérification à ajouter** : l'invariant `total = valeur + Σ produits − Σ achats` doit tenir par
classe d'actif et non plus globalement, et un contrôle de cohérence doit comparer le solde de chaque
compte au relevé, en levant l'actuelle restriction au `scope: 'coinhouse'`. **Contre-épreuve
obligatoire** (décision n° 75) : fausser la classe d'un actif doit faire rougir un test qui la nomme.

**Fixture** : un classeur XLSX **100 % synthétique** généré par script, jamais dérivé du relevé réel,
même transformé (décision n° 17).

---

## 10. Propositions classées par ROI

Barème identique à `docs/ROADMAP.md`. Les numéros P100 et suivants sont libres — P96 à P99 ont été
pris le même jour par la proposition crowdlending.

| #        | Proposition                                                                                                  | Valeur | Fiab. | Satisf. | Sessions |   ROI   |
| -------- | ------------------------------------------------------------------------------------------------------------ | :----: | :---: | :-----: | :------: | :-----: |
| **P102** | **Cours des titres** : fournisseur Twelve Data en BYOK, table ISIN→ticker générée par OpenFIGI, repli manuel |   4    |   2   |    4    |  **1**   | **10**  |
| P103     | Convertisseur eToro : XLSX → pivot, trois destinations, dédoublonnage par empreinte                          |   5    |   2   |    4    |   1,5    | **7,3** |
| **P100** | **Classe d'actif portée par la donnée** : `AssetKind` + `InstrumentRef`, clé de position `(classe, code)`    |   4    |   4   |    2    |   1,5    | **6,7** |
| P101     | Espace « Patrimoine » + écran Titres : positions, PRU, plus-values latentes                                  |   4    |   2   |    4    |    2     |  **5**  |
| P104     | Fiscalité des valeurs mobilières : 150-0 D, dividendes, crédit d'impôt — **conditionné au § 7.5**            |   4    |   4   |    3    |   2,5    | **4,4** |

**L'ordre d'exécution n'est pas l'ordre du ROI.** P100 est le socle et rien ne doit être importé
avant lui : ouvrir l'import des titres sur un `assetClass()` qui répond « crypto » par défaut
écrirait des données fausses dans le stockage des utilisateurs, et une donnée fausse persistée coûte
beaucoup plus cher qu'une session.

Ordre : **P100 → P102 → P101 → P103 → (P104)**. P102 avant P101 parce qu'un écran sans cours ne se
teste pas. P103 dépend du fichier témoin (§ 11).

Coût net : **6 sessions** pour un produit utilisable, 8,5 avec le module fiscal. P41 chiffrait
2,5 sessions ; l'écart s'explique et ne se cache pas — P41 ne prévoyait ni la lecture d'un classeur,
ni le convertisseur courtier (compté à part en P46), ni la moindre fiscalité des titres. **P100 et
P102 rendent P46 largement gratuit**, et P100 corrige au passage un défaut de justesse qui existe
déjà aujourd'hui, sans aucune action.

---

## 11. Ce que vous devez décider

1. **Trancher l'avis de retenue du 01/09** (§ 2.2). C'est un arbitrage produit, pas technique.
   Mon avis : la retenue visait un élargissement spéculatif ; P41 prévoyait lui-même son
   déclencheur — « à ne lancer que sur demande réelle » — et cette demande est arrivée. La partie
   de l'objection qui reste debout est la fiscalité, que le § 7.5 met hors périmètre pour cette
   raison précise. Si vous suivez, cela mérite une décision numérotée : le dépôt se contredit
   aujourd'hui sans arbitre.
2. **Navigation** : cinquième espace « Patrimoine » avec sous-espaces Titres et Prêts (recommandé),
   ou espace « Bourse » seul, qui consomme le dernier emplacement pour une classe et laisse le
   crowdlending sans place.
3. **La clé de données de marché** : oui ou non, par extension de la décision n° 32 (§ 6.3). Sans
   elle, P102 se réduit à la saisie manuelle des cours et P101 reste utile mais terne.
4. **Le fichier témoin** (§ 3.1). Plusieurs colonnes sont **[NON VÉRIFIÉ]** et les libellés d'eToro
   sont instables. Exportez un _Account Statement_ et laissez-le à la racine, où `.gitignore` le
   retient ; **son contenu ne doit jamais entrer dans git**, et la fixture qui en sera tirée sera
   synthétique. Tant qu'il manque, P103 attend : écrire un parseur sur des noms de colonnes supposés
   produirait un import qui échoue chez vous et nulle part ailleurs.
5. **Périmètre du relevé** : les quatre volets (titres, dividendes et frais, crypto eToro, CFD) ou
   un sous-ensemble. Le modèle du § 9 les porte tous ; ne coder que les titres ne ferait rien gagner
   au-delà de P103.

---

## Sources

Toutes consultées le 06/09/2026.

**eToro**
`[E1]` etoro.com — _Builders' Economy: Public API & App Store Terms of Use_, 17/02/2026 (PDF ;
Part I § 1.2, Part V § 1.8) — `[E2]` api-portal.etoro.com ; builders.etoro.com — `[E3]`
github.com/weirdapps/etoro_statement (parseur tiers ; variantes de libellés de colonnes) — `[E4]`
docs.antsignals.com/import-trades/export-trades-from-broker/etoro — `[E5]`
help.waltio.com/en/articles/3748833-etoro-file — `[E6]` help.etoro.com, _What is the eToro Account
Statement?_ — **page non chargeable** (application monopage protégée), non vérifiée directement

**Moteurs et pratiques**
`[P1]` github.com/ghostfolio/ghostfolio — `schema.prisma`, enum `Type` — `[P2]`
github.com/portfolio-performance/portfolio — `CSVAccountTransactionExtractor.java`, enums
`AccountTransaction.Type` et `PortfolioTransaction.Type` — `[P3]`
forum.portfolio-performance.info/t/pdf-import-von-etoro/14108 — `[P4]` koinly.io/integrations/etoro —
`[P5]` cointracking.info/import/etoro — `[P6]` divly.com/en/wallets-and-exchanges/eToro — `[P7]`
sharesight.com/us/partners/etoro — `[P8]` help.snowball-analytics.com/import-etoro — `[P9]`
github.com/sirindudler/parqet-etoro-import — `[P10]` help.finary.com/en/articles/6525257 — `[P11]`
support.delta.app/en/articles/9788147

**Fournisseurs de cours** (CORS mesuré par requête directe avec en-tête `Origin`)
`[M1]` vérification directe des quinze origines du § 6 — `[M2]` twelvedata.com/pricing ;
twelvedata.com/exchanges/XAMS — `[M3]` openfigi.com/docs/terms-of-service — `[M4]` statut de l'API
Yahoo Finance et CGU (synthèse tierce ; API officielle arrêtée en 2017) — `[M5]`
github.com/ghostfolio/ghostfolio issue #2640 (pannes Yahoo) — `[M6]`
site.financialmodelingprep.com/developer/docs/euronext-prices-api — `[M7]` marketstack.com/pricing —
`[M8]` limites documentées d'Alpha Vantage (source secondaire) — `[M9]` registry.npmjs.org (xlsx,
exceljs, read-excel-file) ; api.osv.dev — GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9 ;
github.com/SheetJS/sheetjs

**Fiscalité**
`[X1]` bofip.impots.gouv.fr — BOI-RPPM-PVBMI-20-10-20-40 (art. 150-0 D du CGI, prix moyen pondéré) —
`[X2]` impots.gouv.fr — formulaire 2086 et sa notice (art. 150 VH bis) — `[X3]` impots.gouv.fr —
formulaire 3916-bis, cadre des comptes d'actifs numériques (**code `013 ETORO`**) — `[X4]` Conseil
d'État, 13/09/2021, n° 443914 (conversion au taux du jour de l'opération ; source secondaire)
