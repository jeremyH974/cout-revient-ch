# Consolidation patrimoniale — état de l'art et trajectoire

> Proposition du 25 août 2026. Question traitée : « Qu'est-ce que Finary et les meilleurs acteurs
> font en matière de consolidation d'actifs et d'investissements, et que pouvons-nous en faire —
> en visant l'excellence, l'état de l'art et une architecture prête pour le futur ? »
>
> Méthode : quatre recherches documentaires **parallèles** menées le 25/08/2026 — acteurs
> France/Europe `[F…]`, acteurs internationaux et open source `[I…]`, architecture local-first
> `[T…]`, fiscalité et mesure de performance `[X…]` — plus un audit du code existant. Chaque
> affirmation porte sa source ; ce qui n'a pas pu être vérifié est marqué **[INCERTAIN]** ou
> **[PROBABLE]** et **ne doit pas être codé sans contrôle sur source primaire**.
>
> Ce document ne modifie aucun code. Il propose des décisions.

---

## 1. La question, reformulée

« Consolider », dans ce marché, recouvre deux choses très différentes qu'il faut cesser de
confondre :

1. **La collecte** — brancher automatiquement des comptes pour récupérer les positions.
2. **Le modèle et le calcul** — savoir quoi faire des positions une fois qu'on les a : coût de
   revient, performance, fiscalité, allocation, valeur nette.

Le marché vend la première et facture la seconde. La recherche montre que la première est
**verrouillée par la réglementation, pas par la technique** (§ 3), et que c'est la seconde qui
justifie les abonnements (§ 2). C'est une bonne nouvelle pour une app sans backend.

---

## 2. Ce que font les meilleurs

### 2.1 France — Finary et son écosystème

**Couverture.** Comptes courants et d'épargne, PEA, comptes-titres, assurance-vie et PER,
immobilier avec valorisation automatique, crédits, private equity non coté, crypto (plateformes
centralisées et lecture de soldes sur 45 blockchains depuis une adresse publique collée), métaux
précieux, SCPI/SCI, objets de collection. Tableau de bord : actif brut, actif net après crédits,
actifs liquides, allocation `[F1]`. [VÉRIFIÉ]

**Ce qui n'est pas automatique, même chez eux.** Les positions DeFi, le staking et les pools de
liquidité **ne sont pas décodés** : saisie manuelle obligatoire, exactement comme l'immobilier
`[F1]`. [VÉRIFIÉ]

**Tarifs 2026.** Gratuit limité, Lite 59,99 €/an, Plus 149,99 €/an, Pro jusqu'à 499,99 €/an
`[F2]`. [VÉRIFIÉ]

**Ce que paie le palier Plus** — et c'est le point important : un **détecteur de frais cachés**
(assurance-vie, PEA, SCPI, ETF) et un **simulateur Monte Carlo** rendant des scénarios pessimiste
/ médian / optimiste plutôt qu'un chiffre unique `[F1]`. [PROBABLE] Ce sont deux fonctions de
**calcul pur**, sans agrégation, sans backend nécessaire.

**Ce qu'on leur reproche.** Trois griefs dominent les avis Trustpilot : des **bugs de
synchronisation qui faussent les calculs** (Trade Republic, banques privées, néobanques ; des cas
où Yomoni, Fortuneo ou Malakoff cessent de se synchroniser après quelques mois), le prix du palier
Plus, et une couverture faible de l'immobilier locatif. Finary répond en invoquant l'absence d'API
hors comptes courants `[F3]`. [VÉRIFIÉ] **Cette défense est exacte** — voir § 3.

**Statut.** PSAN AMF n° E2022-057 (2022) → courtier en assurance (2024) → requalification PSCA
sous MiCA au 30/12/2024 → **agrément d'entreprise d'investissement délivré par l'ACPR le
27/03/2026**, programme d'activité validé par l'AMF, pour lancer un PEA en direct sans courtier
tiers `[F4]`. [VÉRIFIÉ] Trajectoire claire : l'agrégateur devient distributeur. Le suivi n'est pas
le produit, c'est le canal d'acquisition.

### 2.2 France — le reste du marché

- **Robo-advisors** : Ramify ≈ 1,50 %/an, Yomoni ≈ 1,60 %, Nalo ≈ 1,65 %. Seul Ramify propose un
  PEA piloté automatiquement et intègre SCPI et private equity dans l'allocation pilotée `[F5]`.
  [VÉRIFIÉ]
- **Agrégateurs** : Bankin' revendique le leadership (5 M+ utilisateurs, 350+ établissements) mais
  sa vision épargne/AV est sommaire — **soldes seuls, ni performance ni allocation**. Linxo Lab
  agrège 1 700+ connecteurs incluant AV, PEA, PER, épargne salariale et crypto avec un vrai suivi
  patrimonial ; gratuit aujourd'hui, version payante annoncée en septembre 2026 `[F6]`. [VÉRIFIÉ]
- **Outils CGP** (Harvest O2S, Kwiper, Manymore/Prisme) : agrégation **contractuelle** directe
  auprès des assureurs et dépositaires — pas du scraping —, conformité DDA/MIF2/LCB-FT packagée,
  et surtout des **moteurs successoraux, de démembrement et de donation avec impact fiscal
  intégré** `[F7]` `[F8]`. [VÉRIFIÉ / PROBABLE] C'est là que va la valeur perçue une fois
  l'agrégation résolue, et personne ne l'apporte au grand public.

### 2.3 International — la profondeur plutôt que la largeur

| Acteur           | Ce qui le distingue                                                                                       | Tarif 2026                         | Faiblesse                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| Quicken Simplifi | 401(k)/IRA/courtage/crypto unifiés, calcule **TWR et IRR**, retraite à 15 variables                       | 47,88 $/an                         | moins profond que Sharesight côté fiscal                        |
| Empower          | Analyseur de frais, allocation contre indices, planificateur retraite — jugé « class-leading » en gratuit | gratuit                            | [PROBABLE] gratuité financée par la génération de leads conseil |
| Monarch Money    | Positions, allocation, contributions, performance dans le temps                                           | 99,99 $/an (Core), 199 $/an (Plus) | pas de TWR/IRR documenté publiquement                           |
| Sharesight       | **Référence fiscale** actions/ETF cotés, dividendes automatiques, rapports par juridiction                | —                                  | actions cotées seulement                                        |
| Kubera           | Couverture d'actifs quasi illimitée, outils de succession                                                 | 150 $/an, 225 $/an famille         | **affiche des soldes, pas de performance**                      |
| Getquin          | TWR réel + comparaison à un indice en Premium                                                             | ≈ 49,99 €/an                       | modèle publicitaire en gratuit                                  |

`[I1]` `[I2]` `[I3]`. [VÉRIFIÉ, sauf mentions]

**L'enseignement.** Kubera est le seul à vendre l'**exhaustivité** — et c'est précisément celui qui
n'affiche pas de performance. Tous les autres vendent la **profondeur de calcul** : TWR réel,
fiscalité par juridiction, analyse de frais, projection. Largeur et profondeur sont un arbitrage,
pas un cumul.

### 2.4 Open source — les patrons directement réutilisables

- **Portfolio Performance** (Java, bureau) : calcule TWR **et** IRR sur plusieurs comptes, importe
  les cours depuis Yahoo/AlphaVantage/CoinGecko/Quandl/HTML/JSON, et convertit les devises via les
  **taux historiques BCE** `[I4]`. [VÉRIFIÉ] — exactement notre choix (décision n° 18).
- **Ghostfolio** : le reproche n° 1 de sa communauté est un **import CSV rigide sans mapping libre
  des colonnes**, plus une conversion de devises seulement quotidienne `[I5]`. [VÉRIFIÉ] Notre
  import tolérant par alias d'en-têtes et nos convertisseurs natifs par plateforme sont donc un
  avantage concurrentiel réel, pas un détail d'implémentation.
- **Actual Budget** : un fichier SQLite par budget, hors-ligne complet, chiffrement de bout en bout
  optionnel rendant les copies synchronisées illisibles **même par le serveur auto-hébergé de
  l'utilisateur** `[T1]`. [VÉRIFIÉ]
- **Bitwarden** : publie un livre blanc d'architecture zero-knowledge et une FAQ de sécurité
  publics `[T2]`. [VÉRIFIÉ] La **transparence documentaire est en soi un standard de confiance**,
  au même titre que l'implémentation.
- **Export-To-Ghostfolio** : le patron gagnant pour l'import multi-courtiers est une
  **bibliothèque de convertisseurs par courtier maintenue par la communauté**, pas un parseur
  générique unique `[T3]`. [PROBABLE] — c'est déjà l'architecture de `src/lib/import/platforms`.

### 2.5 Institutionnel — ce que ça préfigure

Addepar, Masttro, Canoe, Arch : structure de données unifiée, calculs à la demande, look-through
des fonds, agrégation des appels de capital et distributions, réconciliation multi-dépositaire vers
une position canonique unique `[I6]`. [VÉRIFIÉ / PROBABLE] Canoe et Arch ne sont d'ailleurs pas des
plateformes de reporting mais des **couches d'extraction documentaire** — la donnée patrimoniale
non bancaire se récupère encore, en 2026 et au niveau family office, en lisant des documents.

---

## 3. Le verrou est réglementaire, pas technique

C'est la conclusion la plus structurante de cette recherche.

- **DSP2 ne couvre que les comptes de paiement.** L'assurance-vie et l'épargne qui n'est pas un
  compte de paiement sont **hors du périmètre légal** : l'accès se fait par accord privé ou
  scraping, jamais par un droit garanti `[F9]`. [VÉRIFIÉ] La ré-authentification forte tous les
  90 jours est par ailleurs un frein documenté.
- **FiDA change cela — et c'est le texte à surveiller.** Accord politique provisoire
  Parlement/Conseil le **27/11/2025**, texte final attendu au JOUE au premier semestre 2026,
  application après une transition de 21 mois, soit **réalistement mi à fin 2027**. FiDA couvre
  explicitement l'épargne, l'assurance, **les investissements et les crypto-actifs** `[F10]`.
  [VÉRIFIÉ] PSD3 seul, adoption formelle attendue en 2026, application ≈ 2028.
- **Aux États-Unis, c'est pire.** La règle CFPB § 1033 est **suspendue par injonction judiciaire**,
  non abrogée : le CFPB a rouvert une procédure réglementaire (ANPR du 22/08/2025), le juge Reeves
  lui a enjoint de ne pas appliquer la règle de 2024, et l'échéance de conformité du 1ᵉʳ avril 2026
  est passée sans effet `[I7]`. [VÉRIFIÉ]

**Conséquence directe et contre-intuitive.** Sur les classes d'actifs les plus difficiles —
assurance-vie, PEA, immobilier, private equity — **l'import manuel n'est pas notre handicap, c'est
la parité**. Finary, avec ses financements et ses agréments, en est réduit aux mêmes saisies
manuelles pour la DeFi et l'immobilier `[F1]`, et casse régulièrement sur ce qu'il automatise
`[F3]`. Un import volontaire et documenté est **plus fiable** qu'une synchronisation sans droit
d'accès.

Nous ne devons donc pas courir après l'agrégation. Nous devons courir après le **modèle** et le
**calcul**.

---

## 4. Trois découvertes qui changent la trajectoire

### 4.1 La fiscalité française rend la consolidation obligatoire

L'article 150 VH bis du CGI calcule la plus-value ainsi :

```
PV = prix de cession − (prix total d'acquisition du portefeuille × prix de cession ÷ valeur
                        globale du portefeuille au moment de la cession)
```

Le calcul porte sur le **portefeuille global, toutes cryptos et toutes plateformes confondues** —
pas actif par actif `[X1]`. [VÉRIFIÉ]

La décision n° 10 avait déjà identifié que « le PRU par actif n'est pas la plus-value de
l'art. 150 VH bis ». La recherche en tire la conséquence qui manquait :

> **Le mode fiscal n'est pas une fonctionnalité parallèle à la consolidation. Il en est le
> débouché, et il est impossible à calculer correctement sans elle.** Tant que l'app ignore ce que
> l'utilisateur détient hors Coinhouse, elle ne peut pas produire la valeur globale du portefeuille
> au moment de chaque cession, donc pas une seule ligne juste du formulaire 2086.

Cela réordonne la feuille de route : P13 (mode fiscal, phase 3) dépend d'un socle de consolidation
qui n'existe pas encore.

**Différenciateur possible.** Koinly, CoinTracker et CryptoTaxCalculator sont bâtis sur des
méthodes par actif (FIFO, HIFO, ACB, pooling britannique) `[X2]`. [PROBABLE] — le rapport affirme
qu'aucun n'implémente nativement la méthode française du portefeuille global ; **cette affirmation
est très douteuse pour Waltio**, éditeur français dont le produit vise explicitement le 2086, et
elle doit être vérifiée avant tout usage en communication.

### 4.2 Le foyer fiscal est l'angle mort de tout le monde

- Chez Finary, un compte joint connecté ne montre pas les produits propres du conjoint, et un
  « mode famille » est une demande récurrente de la communauté `[F11]`. [PROBABLE]
- Or la fiscalité française **impose** le raisonnement par foyer et par assuré :
  - l'abattement annuel d'assurance-vie de 4 600 € / 9 200 € s'apprécie **au niveau du foyer, tous
    contrats cumulés**, et n'est pas multipliable par contrat ;
  - le seuil de 150 000 € de primes s'évalue **par assuré, tous contrats et tous assureurs
    confondus**, net des capitaux déjà retirés `[X3]`. [PROBABLE]

Autrement dit : **sans notion de titulaire, tout calcul consolidé d'assurance-vie est faux.** Et
c'est un endroit où une app locale, sur un appareil de foyer, sans compte ni serveur, est
structurellement mieux placée que n'importe quel service cloud — qui doit, lui, résoudre un
problème de partage de données personnelles entre deux personnes.

Coût pour nous : un champ sur `Account`. Nous avons déjà les comptes de première classe
(décision n° 20).

### 4.3 La synchronisation sans serveur a une troisième voie

La feuille de route écarte aujourd'hui la synchronisation multi-appareils au motif que
« WebRTC/CRDT nécessite un serveur de signalisation » (`docs/ROADMAP.md` § 5). **Ce motif reste
exact**, et la recherche le confirme durement : ElectricSQL, PowerSync, Triplit (racheté par
Supabase en octobre 2025) et Zero répliquent tous un Postgres ou un MongoDB **serveur** vers du
SQLite local — les adopter serait une trahison silencieuse du « zéro serveur » `[T4]`. [VÉRIFIÉ]

Mais une troisième famille n'avait pas été évaluée : le **stockage tiers possédé par
l'utilisateur**, chiffré côté client avant envoi. Le patron `remotely-save`, éprouvé sur Obsidian,
écrit vers S3/R2/B2/WebDAV/OneDrive/Drive/Box/pCloud, chiffrement de bout en bout appliqué avant
l'upload `[T5]`. [VÉRIFIÉ] Nous n'hébergeons rien ; c'est l'espace de stockage de l'utilisateur.

À évaluer honnêtement : le CORS des serveurs WebDAV et S3 est souvent fermé, et Drive/Dropbox
imposent un enregistrement d'application (OAuth PKCE, sans secret, mais avec un `client_id` qui
nous désigne). Ce n'est donc pas gratuit — voir P38, délibérément classé en dernier.

---

## 5. Analyse d'écart

| Dimension                           | État de l'art                                                            | Notre app aujourd'hui                                                                                   | Écart                       |
| ----------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| Coût de revient, lots, frais all-in | Sharesight, Koinly (payant) ; désactivé par défaut chez SnapTrade `[I8]` | **PRU CUMP invariant, lots au prorata, frais all-in, oracle indépendant**                               | **Nous sommes devant**      |
| Import multi-sources                | Reproche n° 1 contre Ghostfolio `[I5]`                                   | Coinhouse, pivot Koinly/Waltio, 5 convertisseurs natifs, Ghostfolio JSON, on-chain BTC/EVM, Hyperliquid | **Nous sommes devant**      |
| Confidentialité                     | Tous supposent un compte cloud `[T6]` ; fuite Waltio janvier 2026        | Rien ne sort du navigateur                                                                              | **Nous sommes seuls**       |
| TWR **et** MWR                      | Simplifi, Portfolio Performance, Getquin Premium `[X4]`                  | XIRR + TWR Dietz modifié + repère sur flux réels                                                        | **À parité, voire devant**  |
| Classes d'actifs                    | Finary : 12+ classes `[F1]`                                              | Crypto, stablecoins, cash                                                                               | **Écart majeur**            |
| Valeur nette et passif              | Écran central de Finary et Kubera                                        | Absent (P28 livré « hors courbe de valeur nette »)                                                      | **Écart majeur**            |
| Fiscalité                           | Waltio, Koinly ; rien chez Coinhouse                                     | Absent, et **impossible sans consolidation** (§ 4.1)                                                    | **Écart majeur, dépendant** |
| Foyer / titulaire                   | Mal résolu **partout** `[F11]`                                           | Absent                                                                                                  | **Écart, et opportunité**   |
| Projection / Monte Carlo            | Différenciant payant de Finary Plus `[F1]`                               | `simulate.ts` limité au simulateur d'alertes                                                            | **Écart, peu coûteux**      |
| Multi-appareils                     | Cloud chez tous                                                          | Sauvegarde chiffrée manuelle                                                                            | Écart assumé                |
| Agrégation bancaire                 | Verrouillée jusqu'à FiDA ≈ 2027 `[F10]`                                  | Hors de portée                                                                                          | **Non pertinent** (§ 3)     |

---

## 6. Architecture proposée

### 6.1 Deux formes d'actif, un seul rapport

Le moteur actuel est **déjà générique sur les actifs fongibles** : `AssetCode` est une chaîne
libre, les quantités sont des décimales `Big`, les opérations ont deux jambes
(`src/lib/domain/types.ts`). **Une action ou un ETF a exactement la même forme qu'une crypto.**
Ce n'est pas le moteur qui bloque la consolidation.

Ce qui manque est une **seconde forme d'actif** :

| Forme               | Exemples                                                           | Modèle                                                     | Moteur                    |
| ------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------- |
| **Fongible à lots** | crypto, actions, ETF, parts de SCPI, métaux                        | quantité × cours, lots, PRU                                | existant, **inchangé**    |
| **Valorisé**        | immobilier, assurance-vie vue globale, PER, private equity, objets | suite de **valorisations datées** + flux entrants/sortants | nouveau `ValuationEvent`  |
| **Passif**          | crédit immobilier, prêt conso                                      | capital restant dû daté, échéancier                        | valorisé, de signe opposé |

C'est très exactement la modélisation de Finary et de Kubera. Et c'est une extension **chirurgicale**
de `types.ts`, pas une réécriture : le rapport de portefeuille s'exprime déjà en (coût, valeur,
réalisé, latent), qui est le dénominateur commun des trois formes. `xirr.ts` fonctionne déjà sur des
flux datés ; `twr.ts` fonctionne déjà sur des valorisations.

### 6.2 Le point dur n'est pas le modèle, ce sont les prix

Pour la crypto, c'est réglé (cascade CoinGecko / Coinbase / Kraken / Hyperliquid / DefiLlama, change
BCE via Frankfurter). Hors crypto, la situation est nettement moins bonne depuis un site statique :

- **Yahoo Finance non officiel est à écarter** : CORS bloqué en appel direct navigateur, et
  conditions d'utilisation fragiles `[I9]`. [VÉRIFIÉ]
- **Frankfurter reste le meilleur choix de change** : gratuit, sans clé, conçu pour l'appel client
  `[I10]`. [VÉRIFIÉ] — déjà en place.
- Les fournisseurs d'actions/ETF gratuits (Alpha Vantage, Twelve Data, Financial Modeling Prep,
  Stooq) sont soit limités, soit à clé, soit de CORS **non vérifié** `[I11]`. [INCERTAIN]

**Précédent applicable.** La décision n° 32 accepte déjà une clé d'explorateur de blocs facultative
tout en refusant les clés d'exchange. Une clé de **données de marché** est de la même nature :
lecture seule, données publiques, aucun pouvoir sur des fonds. Le précédent couvre le besoin.

**Méthode recommandée, et non négociable :** ne rien promettre avant d'avoir **sondé le CORS
réellement**, comme l'a fait la proposition v2. `scripts/api-contract.mjs` est déjà l'outil.
Une demi-session de sondes tranche P35 ; l'intuition ne tranche rien.

Enfin : pour l'immobilier et l'assurance-vie, la valorisation manuelle est de toute façon la norme
du marché `[F1]`. L'absence de fournisseur de prix n'est pas bloquante pour ces classes.

### 6.3 Prêt pour le futur, concrètement

« Prêt pour le futur » ne veut pas dire « générique à l'excès ». Trois échéances datées et connues
suffisent à orienter le modèle :

1. **FiDA, ≈ mi-2027** `[F10]` — ouvrira un accès programmatique à l'AV, au PEA et à la crypto.
   Rien à construire aujourd'hui : il faut seulement que le schéma canonique
   (`Account` + `LedgerEvent`) reste indépendant de la source, ce qui est déjà le cas. Un futur
   adaptateur FiDA se branchera comme s'est branché l'import pivot.
2. **DAC8/CARF** — collecte par les plateformes dès le 01/01/2026, premier échange automatique
   entre administrations **au plus tard le 30/09/2027** sur les opérations 2026 `[X5]`. [PROBABLE]
   L'administration recevra donc les données de Coinhouse. Un état « voici ce que la plateforme
   déclarera, voici ce que je déclare » a une vraie valeur, et il est déjà esquissé dans P13.
3. **Valorisation au 31 décembre** — nécessaire pour l'impôt suisse sur la fortune `[X6]`, et
   réutilisable tel quel si la taxe sur le « patrimoine improductif » revient. Cet amendement,
   voté en première lecture à l'Assemblée le 31/10/2025, a été **écarté du texte définitif adopté
   par 49.3 le 02/02/2026** `[X7]`. [PROBABLE] Il ne faut donc **pas** l'implémenter — mais une
   photo annuelle du patrimoine est peu coûteuse et se réutilisera.

### 6.4 Ce que ça ne casse pas

Aucune des propositions ci-dessous ne remet en cause : l'absence de backend, l'absence de compte,
l'arithmétique décimale stricte, la pureté du moteur, la séparation Investissement / Trading,
les invariants testés, ni le refus des clés d'exchange.

---

## 7. Propositions classées par ROI

Barème identique à `docs/ROADMAP.md` : Valeur, Fiabilité, Satisfaction sur 5 ; effort en sessions
de 2–3 h ; ROI = (V + F + S) ÷ sessions.

| #   | Proposition                                                                       | Valeur | Fiab. | Satisf. | Sessions |   ROI   | Lot |
| --- | --------------------------------------------------------------------------------- | :----: | :---: | :-----: | :------: | :-----: | :-: |
| P33 | **Titulaire sur les comptes** (`ownerId`), filtres par personne et vue foyer      |   4    |   3   |    3    |    1     | **10**  |  1  |
| P39 | **Photo du patrimoine au 31/12** (valorisation annuelle figée, exportable)        |   3    |   3   |    2    |    1     |  **8**  |  2  |
| P36 | **Allocation multi-classes + alerte de concentration** (généralise P11)           |   3    |   1   |    4    |    1     |  **8**  |  2  |
| P31 | **Passif et valeur nette** (crédits, capital restant dû, actif net)               |   4    |   2   |    4    |   1,5    | **6,7** |  1  |
| P32 | **Courbe de valeur nette dans le temps** (le seul écran que tous ont et pas nous) |   4    |   1   |    5    |   1,5    | **6,7** |  2  |
| P37 | **Projection Monte Carlo** (scénarios pessimiste / médian / optimiste)            |   4    |   1   |    5    |    2     |  **5**  |  3  |
| P30 | **Actif valorisé** : `ValuationEvent`, immobilier, AV, PER, PE, objets            |   5    |   3   |    5    |    3     | **4,3** |  1  |
| P35 | **Actions et ETF** : classe fongible, ISIN, sondes de fournisseurs de prix        |   4    |   2   |    4    |   2,5    |  **4**  |  4  |
| P40 | **Convertisseurs courtiers** (Degiro, Trade Republic, Boursorama, Saxo)           |   3    |   2   |    3    |    2     |  **4**  |  4  |
| P38 | **Sauvegarde chiffrée vers un stockage possédé par l'utilisateur**                |   3    |   4   |    3    |    3     | **3,3** |  4  |
| P34 | **Mode fiscal FR consolidé 150 VH bis** (remplace et élargit P13)                 |   5    |   4   |    4    |    5     | **2,6** |  3  |

### Ordre d'exécution recommandé

Le ROI brut ne fait pas tout. L'ordre suit la thèse du § 2.3 — **la profondeur avant la largeur** —
et les dépendances réelles.

**Lot 1 — le modèle (5,5 sessions).** P33 → P30 → P31.
Rien de spectaculaire à l'écran, mais tout le reste en dépend. P33 en premier parce qu'il coûte une
session et qu'il conditionne la justesse de P34.

**Lot 2 — ce qui se voit (3,5 sessions).** P32 → P36 → P39.
Le premier lot devient visible. C'est ici que l'app cesse d'être un calculateur crypto pour
devenir un outil patrimonial. `src/lib/history/` fournit déjà l'essentiel de P32.

**Lot 3 — la profondeur, ce que les autres facturent (7 sessions).** P34 → P37.
P34 est le débouché de tout le reste (§ 4.1) et porte un **risque juridique** : étiquette
« estimation », relecture par un professionnel avant publication, et **vérification sur BOFiP des
taux** (§ 9). P37 est du calcul pur, sans backend, et c'est le différenciant payant de Finary Plus.

**Lot 4 — la largeur, si la demande existe (7,5 sessions).** P35 → P40 → P38.
À ne lancer que sur demande réelle. P35 commence par **une demi-session de sondes CORS** qui décide
s'il est faisable ; s'il ne l'est pas, la saisie manuelle de cours reste acceptable et P35 se réduit.

---

## 8. Ce qui reste non recommandé

Le § 5 de `docs/ROADMAP.md` reste valable dans son intégralité. La recherche le **renforce** sur
deux points et le **nuance** sur un seul.

**Renforcé :**

- **Agrégation bancaire.** Un accès TPP légal exige un agrément AISP, donc un serveur enregistré
  `[T7]`. [VÉRIFIÉ] Les alternatives libres n'en sont pas : Kresus est une application
  auto-hébergée et Woob un scraper Python serveur `[T8]`. [VÉRIFIÉ] Et le besoin lui-même est
  largement illusoire avant FiDA (§ 3).
- **Moteurs de synchronisation « clés en main ».** ElectricSQL, PowerSync, Zero, Triplit exigent
  tous un backend `[T4]`. [VÉRIFIÉ] Les adopter pour une future fonction de synchronisation serait
  une trahison silencieuse de la promesse.

**Nuancé :**

- **Synchronisation multi-appareils.** Le refus visait la piste WebRTC/CRDT avec serveur de
  signalisation ; il reste justifié. Mais la voie « stockage possédé par l'utilisateur, chiffré
  avant envoi » (§ 4.3) n'avait pas été évaluée et mérite de l'être — en dernier, et sans illusion
  sur son coût (CORS WebDAV/S3, enregistrement OAuth).

**Ajouté :**

- **Ne pas transposer FIFO/LIFO/HIFO « à l'américaine ».** La France impose la méthode du
  portefeuille global, sans option de méthode pour le particulier `[X1]`. Offrir un sélecteur de
  méthode serait une régression de justesse déguisée en fonctionnalité.
- **Ne pas implémenter la taxe sur le patrimoine improductif** : écartée du texte définitif
  `[X7]`.
- **Ne pas viser l'exhaustivité façon Kubera.** C'est le seul acteur qui vend la largeur, et le
  seul qui n'affiche pas de performance `[I2]`.

---

## 9. Ce que vous devez décider

1. **Valider la thèse** « profondeur avant largeur » (§ 2.3) — ou l'infirmer, auquel cas l'ordre
   des lots 3 et 4 s'inverse.
2. **Périmètre du lot 1** : les trois formes d'actif d'un coup, ou l'actif valorisé seul en
   commençant par l'immobilier (la classe la plus demandée et la plus simple : une valorisation,
   un crédit) ?
3. **Mode fiscal (P34)** : le publier ou non. S'il est publié, faire relire la méthode par un
   professionnel, et **faire vérifier sur BOFiP avant codage** les trois points que la recherche
   n'a pas tranchés :
   - le PFU 2026 à **31,4 %** (12,8 IR + 18,6 PS) `[X8]` est [PROBABLE], pas vérifié sur source
     primaire ;
   - le **taux de prélèvements sociaux du PEA** est contradictoire entre deux sources (17,2 % ou
     18,6 %) `[X9]` — [INCERTAIN] ;
   - la portée de la **réintégration des amortissements LMNP** (LF 2025, art. 84, cessions à
     compter du 15/02/2025) est encore débattue au Parlement `[X10]` — [PROBABLE].
4. **Clé de données de marché** (P35) : acceptez-vous une clé facultative de fournisseur de cours,
   par extension de la décision n° 32 ? Sinon, P35 se limite à la saisie manuelle de cours.
5. **Synchronisation (P38)** : sujet à instruire, ou refus définitif à graver dans les décisions
   pour clore la question ?
6. **Vérification à faire avant toute communication** : l'affirmation selon laquelle aucun moteur
   du marché n'implémente la méthode française du portefeuille global (§ 4.1) est douteuse pour
   Waltio et ne doit pas être reprise telle quelle.

---

## 10. Sources

Consultées le 25/08/2026. Les quatre flux de recherche sont notés `[F]` France/Europe,
`[I]` international et open source, `[T]` architecture, `[X]` fiscalité et performance.

**France / Europe**
`[F1]` signal-alpha.fr/avis-finary — `[F2]` parrainduweb.fr/blog/abonnement-finary ;
lemediadelinvestisseur.fr — `[F3]` fr.trustpilot.com/review/finary.com —
`[F4]` finary.com/en/product-updates/finary-gets-its-dsan-registration ;
mind.eu.com/fintech (agrément ACPR du 27/03/2026) — `[F5]` ramify.fr/comparatif/vs-yomoni ;
ramify.fr/gestion-de-patrimoine/meilleurs-robo-advisors — `[F6]` parrainduweb.fr/blog/bankin-ou-linxo ;
leboninvestisseur.com/avis-linxo-agregateur-bancaire — `[F7]` harvest.fr ;
harvestfidroitacademy.fr — `[F8]` manymore.fr/prisme ; kwiper.fr/blog —
`[F9]` xpollens.com/blog (DSP2) ; legiscope.com/blog/dsp2-donnees-bancaires-rgpd —
`[F10]` securities.cib.bnpparibas/fida-regulation-open-finance-eu ;
deloitte.com/fr (FiDA) ; crassula.io/guides/licenses/psd3-psr —
`[F11]` community.finary.com (fils « mode famille » et « agrégation de 2 comptes »)

**International / open source**
`[I1]` quicken.com/blog ; thecollegeinvestor.com — `[I2]` 8figures.com ; allinvestview.com (Kubera) —
`[I3]` mycapitally.com (Sharesight) ; getquin — `[I4]` portfolio-performance.info —
`[I5]` github.com/ghostfolio/ghostfolio/discussions/3666 ; findmymoat.com —
`[I6]` aleta.io ; masttro.com ; x1wealth.com — `[I7]` consumerfinancialserviceslawmonitor.com ;
cozen.com ; openbankingtracker.com (CFPB § 1033) — `[I8]` docs.snaptrade.com (tax lots désactivés
par défaut) — `[I9]` scrapfly.io ; github.com/gadicc/yahoo-finance2 — `[I10]` frankfurter.dev —
`[I11]` alphavantage.co/documentation ; coingecko.com/learn

**Architecture**
`[T1]` github.com/Actual-Budget — `[T2]` bitwarden.com/resources/zero-knowledge-encryption-white-paper —
`[T3]` github.com/dickwolff/Export-To-Ghostfolio ; pocketportfolio.app/import/degiro —
`[T4]` powersync.com/blog/electricsql-electric-next-vs-powersync ; trybuildpilot.com —
`[T5]` github.com/remotely-save/remotely-save ; remotestorage.io/rs.js/docs —
`[T6]` synthèse des sources F et I — `[T7]` berlin-group.org/psd2-access-to-bank-accounts —
`[T8]` kresus.org/en/faq
Compléments non cités dans le corps mais utiles au lot 4 : MDN (OPFS, quotas et éviction),
webkit.org/blog/14403 (purge Safari à 7 jours), developer.chrome.com (SQLite WASM sur OPFS),
corbado.com/blog/passkeys-prf-webauthn (extension PRF WebAuthn), secvant.com (Argon2id vs PBKDF2),
testmuai.com (File System Access API : Chromium bureau seulement).

**Fiscalité et performance**
`[X1]` legifrance.gouv.fr — CGI art. 150 VH bis — `[X2]` koinly.io/blog/calculate-cost-basis-crypto-bitcoin ;
support.koinly.io — `[X3]` linxea.com (assurance-vie après 8 ans) ; clubpatrimoine.com/contenus/plfss-csg —
`[X4]` kitces.com (TWR/DWR/IRR et GIPS) ; en.wikipedia.org/wiki/Modified_Dietz_method ;
portfoliooptimizer.io — `[X5]` bmfiduciaire.fr/cryptoactifs-dac8-carf-2026 ; bensaid-avocats.fr —
`[X6]` ge.ch (imposition des cryptomonnaies, particuliers) ; rsm.global/switzerland —
`[X7]` assemblee-nationale.fr/dyn/17/amendements/1906A/AN/3379 ; 2ndmarket.fr —
`[X8]` hagnere-patrimoine.fr ; banquetransatlantique.com (CSG et LFSS 2026) —
`[X9]` blog.nalo.fr vs placement.meilleurtaux.com — contradiction non tranchée —
`[X10]` lmnp-facile.fr/guides/reintegration-amortissement-lmnp ;
questions.assemblee-nationale.fr/q17/17-10097QE.htm
Également : village-justice.com et declarisons.com (formulaires 2086 / 3916-bis et sanctions),
coinhouse.com/fr/blog/communique-de-presse (agrément MiCA, mai 2026),
chainwisecpa.com et cointracking.info (méthodes US, UK, Allemagne).
