# État de l'art et cap 2027 — six axes sourcés, un audit adverse, vingt-deux briques

> Question traitée : « Un brainstorm complet, aidé de recherches sourcées et à jour en ligne, pour
> voir comment améliorer le produit et l'amener vers l'excellence, l'état de l'art, et prêt pour le
> futur. »

_Établie le 31/08/2026 à partir de six études parallèles menées ce jour (concurrence et état de
l'art produit, fiscalité française et conformité européenne, socle technique web, sources de données
et licences, interopérabilité IA et agentique, audit interne adverse du dépôt), complétées par cinq
vérifications personnelles dans le code et deux recherches de contrôle. Les faits sont marqués
**vérifié** (reproduit par moi dans le dépôt, ou page chargée par moi ce jour), **sourcé** (page
chargée pendant l'étude, source primaire citée quand elle existe) ou **à vérifier** (source primaire
inaccessible, ou point de droit non tranché). Statut : **dépassé** — voir le bandeau ci-dessus._

> **⚠ Document dépassé sur deux points, conservé pour sa recherche sourcée.** Il a été écrit contre
> une copie locale restée à la **2.12.0**, aveugle à 49 commits déjà fusionnés. Sont caducs : la
> **numérotation P52-P73** (entièrement occupée sur `main`, P74 compris) et sa **recommandation
> contre un copilote IA hébergé** (la promesse « rien ne quitte le navigateur » a été délibérément
> réécrite depuis — décision n° 69). Le reste — les six axes sourcés, les échéances datées, les deux
> failles, le verdict de la retenue — tient et a été remesuré.
>
> **Lire d'abord** [`2026-09-01-etat-de-lart-reaudit.md`](2026-09-01-etat-de-lart-reaudit.md), qui
> corrige ce document et porte les propositions survivantes, renumérotées P75-P94.
>
> Les `PXX` cités dans le corps du texte sont ceux **de ce document seul** et n'ont aucun rapport
> avec les numéros de `main` — son P64, par exemple, désigne ici la barrière du BLS, et là-bas la
> qualification assistée des fichiers inconnus.

---

## 1. Le constat qui commande tout le reste

Le produit n'a pas de problème de couverture fonctionnelle. Il a un problème de **là où il regarde**.

Le moteur est protégé comme un système comptable doit l'être : 5 081 lignes de tests pour 5 638
lignes de source dans `src/lib/domain`, propriétés `fast-check`, oracle indépendant recalculant
_from scratch_ à 1e-9 près, seuil de couverture à 90 % (**vérifié**). C'est excellent, c'est rare, et
c'est **la zone qui change le moins**.

Pendant ce temps :

| Zone              | Lignes de test | Lignes de source | Dans le périmètre de couverture ? |
| ----------------- | -------------: | ---------------: | --------------------------------- |
| `src/lib/domain`  |          5 081 |            5 638 | oui, seuil dédié à 90 %           |
| `src/lib/import`  |          4 141 |            7 450 | oui                               |
| `src/lib/history` |          2 132 |            2 800 | oui                               |
| `src/lib/storage` |          1 256 |            1 459 | oui                               |
| **`src/state`**   |          **0** |        **2 673** | **non**                           |
| **`src/routes`**  |          **0** |        **7 719** | **non**                           |
| `src/components`  |             85 |            7 085 | **non**                           |

`coverage.include` vaut `['src/lib/**/*.ts']` (`vite.config.ts:144`, **vérifié**) : **17 477 lignes
sont hors du périmètre de mesure**, dont `src/state/app.svelte.ts` — 2 051 lignes, 36 `$derived`, et
**le fichier le plus modifié du dépôt** avec 30 commits, devant `schema.ts` (21) et
`ARCHITECTURE.md` (19).

Le raisonnement tient en une phrase : **les 408 fichiers de tests protègent _le calcul_ ; ils ne
protègent pas _ce qui décide quoi calculer_.** Un chiffre faux sur la Vue d'ensemble par erreur
d'orchestration dans le store ne fait rougir aucun test, parce que le moteur, lui, aura toujours
raison sur les entrées qu'on lui donne. Les tests de bout en bout le couvrent par ricochet, mais sur
une fixture de **218 lignes** (**vérifié**) : ils n'exercent ni les chemins d'erreur, ni les
combinaisons de devise, de compte et d'espace, ni la reprise après état corrompu.

L'investissement de test a suivi la pente de la facilité — le moteur pur est le plus agréable à
tester, et le plus rassurant. Il faut maintenant le pointer là où le code bouge.

**Corollaire, qui structure les phases S et V.** Le risque dominant du produit a changé de nature.
« Le chiffre est-il juste ? » est réglé : c'est ce que garantissent le domaine pur, l'arithmétique
décimale stricte et l'oracle indépendant. Le risque de 2027 est ailleurs :

1. **la donnée sera-t-elle encore là dans six mois ?** (§ 4.6, durabilité du stockage local) ;
2. **les sources répondront-elles encore ?** (§ 4.4, licences et bridages).

---

## 2. Ce qui a une date

Cinq échéances réelles. Le reste de ce document n'a pas de calendrier imposé.

| Échéance       | Événement                                                        | Certitude        | Conséquence produit                                        |
| -------------- | ---------------------------------------------------------------- | ---------------- | ---------------------------------------------------------- |
| **18/09/2026** | Le cron `market-data.yml` cesse d'écrire                         | **vérifié**      | Ni calendrier ni instantané macro régénérés                |
| ~ juillet 2027 | Fin de la fenêtre de dépréciation MCP ouverte le 28/07/2026      | **sourcé** [E9]  | Dérive silencieuse du serveur écrit à la main              |
| sans préavis   | Bridage d'une source de prix (précédent Pyth Hermes, 26/08/2026) | **sourcé** [E15] | Prix indisponibles ; CoinGecko est le point le plus exposé |
| avril 2027     | Première campagne déclarative au PFU de 31,4 %                   | **vérifié**      | Tout taux affiché en dur devient faux                      |
| ~ 30/09/2027   | Premier échange automatique DAC8 sur les données 2026            | **sourcé** [E4]  | La réconciliation cesse d'être une anticipation            |

### 2.1 Le 18 septembre 2026 — vérifié au jour près

`BLS_MIN_MONTHS_AHEAD = 3` (`scripts/generate-calendar.ts:37`) et la table BLS tenue à la main
s'arrête au **15/12/2026** (`src/lib/calendar/bls-schedule.ts:116`). La barrière refuse d'écrire dès
que `blsEnd < addMonths(today, 3)` :

- run du lundi 14/09 → horizon 14/12, `2026-12-15` n'est pas antérieur → **passe** ;
- run du vendredi 18/09 → horizon 18/12, `2026-12-15` est antérieur → **échoue**.

Le cron tourne le lundi et le vendredi : **le run du vendredi 18 septembre 2026 est le premier à
échouer**. La barrière fait exactement ce pour quoi elle a été écrite (décision n° 58) — c'est un
rappel, pas un bug. Mais c'est aussi la dette récurrente que cette décision a acceptée, et elle
arrive à échéance pour la première fois. P64 la solde et transforme l'échec en **avertissement
anticipé**.

### 2.2 Le PFU à 31,4 % — et le décalage entre la loi et la doctrine

L'article 12 de la LFSS 2026 porte la CSG sur les revenus du capital de 9,2 % à 10,6 %, soit
**18,6 % de prélèvements sociaux et un PFU global à 31,4 %**, pour les cessions réalisées à compter
du **1er janvier 2026**. Les crypto-actifs ne figurent pas dans les cinq catégories protégées par le
nouveau IV de l'article L. 136-8 du code de la sécurité sociale (assurance-vie et capitalisation, PEL
et CEL post-2018, PEP, plus-values professionnelles à long terme, revenus fonciers et plus-values
immobilières) — ils supportent donc la CSG à 10,6 % (**vérifié** par recoupement de trois analyses
convergentes [E5] [E6] [E7]).

**Le point qui doit gouverner P67** : au 31/08/2026, la page mère du BOFiP applicable
(`BOI-RPPM-PVBMC-30`) n'a **aucune mise à jour depuis le 23/04/2024** (**sourcé** [E2]). Elle affiche
encore 30 %, ignore la loi du 25 juin 2026 qui recentre l'article 150 VH bis sur les crypto-actifs au
sens de MiCA au 1er juillet 2026, et ignore le nouvel article 150 VH ter sur les jetons non
fongibles. **L'écart entre la loi et la doctrine doit être porté par l'outil, pas subi** : un taux
affiché sans sa date de validité et sa source devient faux sans prévenir.

**À vérifier** : le texte intégral de la LFSS 2026 n'a pas été relu ligne à ligne ; les trois
analyses citées sont secondaires, quoique convergentes et professionnelles. À faire avant tout mode
fiscal assumé, idéalement avant la campagne d'avril 2027.

---

## 3. Deux failles trouvées en chemin

Aucune n'était cherchée. Les deux viennent du même angle mort, et c'est ce qui les rend
intéressantes : **le produit ingère des fichiers écrits par des tiers — format pivot Koinly/Waltio,
JSON Ghostfolio, convertisseurs natifs de sept plateformes — et les fait ressortir ailleurs sans les
traiter comme hostiles.**

Ce n'est pas un oubli de codage : c'est une hypothèse implicite jamais formulée. Le CSV Coinhouse
d'origine venait d'une source de confiance ; l'ouverture aux imports tiers, livrée avec P24, a changé
le modèle de menace **sans que le modèle de menace soit rediscuté**.

### 3.1 Le texte libre atteint l'assistant IA de l'utilisateur

Les libellés, mémos et noms de plateforme d'un fichier importé remontent tels quels dans les
ressources exposées par le serveur MCP. Un client LLM qui les lit reçoit donc du texte d'origine
inconnue : c'est le vecteur d'**injection indirecte** que l'OWASP classe dans six de ses dix
catégories « Agentic Applications » 2026 (**sourcé** [E12]).

La bonne nouvelle est structurelle : le produit rompt déjà **deux des trois branches** de la _lethal
trifecta_ (données sensibles + contenu non fiable + capacité de sortie externe) — le serveur est en
lecture seule, sans outil d'écriture, et sans accès réseau. La troisième branche, le contenu non
fiable, est la seule ouverte, et c'est la seule qui n'ait jamais été examinée. P58 la ferme, et
transforme les deux autres en **invariants testés** plutôt qu'en propriétés de fait.

### 3.2 L'export CSV ne se protège pas de l'injection de formule

`text()` (`src/lib/export/csv-export.ts:24`) vaut `` `"${value.replace(/"/g, '""')}"` `` : il
n'échappe que les guillemets, sans aucune garde sur `=`, `+`, `-`, `@`, la tabulation ou le retour
chariot (**vérifié**). Il reçoit notamment :

- `p.asset.toUpperCase()` — symboles d'actifs, **venus des imports tiers** ;
- `accountLabel(...)` — libellés de comptes, saisis par l'utilisateur ;
- `lot.origin` et `h.warnings.join(' | ')`.

Et le README dit explicitement aux utilisateurs d'ouvrir leurs fichiers dans Excel. La chaîne
complète existe.

**À vérifier** : qu'un symbole d'actif hostile survive à la normalisation d'import — je n'ai pas
tracé ce chemin. La gravité en dépend, mais pas la justification du correctif : les libellés de
comptes, eux, sont saisis librement et ne passent par aucune normalisation. P59 coûte trois lignes.

---

## 4. Axe par axe

### 4.1 Concurrence et état de l'art produit

**Le différenciateur MCP s'érode.** Rotki a livré son propre serveur MCP local le **21/08/2026**
(v1.44.0), permettant à un assistant d'interroger historique et soldes — soit exactement le motif
livré ici (**sourcé** [E17]). Huit jours avant cette étude. Ce n'est plus une singularité, et il faut
cesser de le présenter comme telle.

**Ce qui reste unique, en revanche, tient.** Aucun concurrent observé n'est un **simple bundle
statique** : Rotki, Ghostfolio et Firefly III font tourner un processus serveur, même en local
(**sourcé**). La promesse « zéro backend, même chez vous » n'a pas d'équivalent — c'est elle, et non
le MCP, qui est l'argument défendable.

**Table stakes non couverts** : le décodage on-chain « conscient du protocole » (positions de prêt,
LP, jetons de _staking_ liquide reconnus comme actifs plutôt que comme soldes de contrat opaques), et
l'aide à la compensation de moins-values de fin d'exercice, que proposent Koinly et Blockpit.

**Avertissement du terrain.** Maybe Finance — patrimoine multi-actifs open source, plus de 54 000
étoiles GitHub, environ un million de dollars levés — a été **archivé par son équipe fondatrice** le
27/07/2025 ; seul un fork communautaire poursuit (**sourcé** [E18]). Les étoiles ne sont pas un plan
de maintenance. Ce projet, porté par une personne, doit préférer le périmètre qu'il peut tenir à
celui qu'il pourrait afficher.

### 4.2 Fiscalité française et conformité européenne

**L'écart de fond, structurel et irréductible.** L'article 150 VH bis calcule la plus-value comme
`prix de cession − (prix total d'acquisition de l'ensemble du portefeuille × prix de cession ÷ valeur
globale du portefeuille)` : c'est une **méthode globale**, qui mobilise la valeur de _tous_ les
crypto-actifs détenus, pas seulement ceux cédés (**sourcé**, primaire [E1]). Le PRU par actif ne peut
pas y conduire. Aucun outil ne peut calculer ce chiffre juste sans connaître **100 % des avoirs de
l'utilisateur, y compris hors de l'application**. C'est la raison pour laquelle l'export en
copier-coller est la bonne frontière, et la télétransmission une ligne à ne pas franchir.

**Le droit a bougé deux fois en 2026** : la loi n° 2026-534 du 25 juin 2026 recentre l'article sur
les crypto-actifs au sens du règlement (UE) 2023/1114 (MiCA) au 1er juillet 2026 — même date que la
fin de la période transitoire PSAN à l'AMF (**sourcé** [E3]) — et crée un article 150 VH ter pour les
jetons non fongibles, dont le régime suit le sous-jacent représenté (**à vérifier** : établi sur
source secondaire spécialisée, non contredit par le texte primaire consulté).

**Le vrai danger produit est ailleurs, et il est propre à ce projet.** L'espace Trading agrège des
**perpetuals** Hyperliquid. Plusieurs sources concordantes situent les contrats à terme et CFD sous
l'**article 150 ter** du CGI — PFU sans abattement, pertes imputables uniquement sur des gains de
même nature, report sur dix ans — soit un régime **distinct** de celui des cessions d'actifs
numériques. Agréger les deux dans une même estimation mélangerait deux régimes juridiques.

**À vérifier, et important** : aucune source primaire trouvée ne qualifie un perpetual **DeFi non
régulé** au regard de l'article 150 ter. Le point n'est pas tranché. La conclusion produit n'est donc
pas « appliquer 150 ter », c'est **« isoler, et dire qu'on ne sait pas »** — ce que fait P66.

**Zones grises restantes** : le BOFiP ne mentionne ni le _staking_, ni les _airdrops_, ni les
stablecoins ; une publication dédiée au _staking_ est annoncée pour 2026 (**à vérifier**). Le régime
BNC intermédiaire pour les opérations « dans des conditions analogues à un professionnel » existe
depuis la loi de finances 2022, mais l'administration précise elle-même qu'il n'a vocation à
s'appliquer que dans des cas exceptionnels, sans critères objectifs codifiés (**sourcé**, primaire).

**Responsabilité de l'éditeur** : rien de solide et de spécifique n'a été trouvé pour un calculateur
de PRU crypto. Le régime voisin des logiciels de caisse certifiés (art. 286 CGI) ne s'applique pas —
il vise l'enregistrement de paiements clients, pas un calcul patrimonial personnel. Le droit commun
s'applique : obligation d'information, absence de conseil personnalisé. **Aucun statut ni
certification à revendiquer, donc.**

### 4.3 Socle technique web

Verdict de l'axe, inattendu et net : **la bonne décision technique est de ne presque rien migrer.**
Les arguments sont détaillés au § 5 ; voici les faits.

| Sujet                | État au 31/08/2026                                                                           | Décision      |
| -------------------- | -------------------------------------------------------------------------------------------- | ------------- |
| `Temporal`           | Stage 4, dans ECMAScript 2026 — mais **Safari sans support stable**, MDN « Limited » [E13]   | attendre      |
| TypeScript 7 (tsgo)  | Stable depuis le 08/07/2026, **sans API publique du compilateur** avant 7.1, sans date [E14] | attendre      |
| Rolldown             | **Déjà fait** : bundler unique par défaut de Vite 8, le projet est en 8.2                    | rien à faire  |
| SvelteKit            | Les _remote functions_ servent une communication client/serveur inexistante ici              | ne pas migrer |
| TC39 `Decimal`       | **Stage 1**, sans calendrier ; conçu pour se combiner à `Amount` (Stage 2)                   | garder big.js |
| Trusted Types        | **Baseline depuis février 2026** (Firefox ayant complété Chrome, Edge, Safari)               | **adopter**   |
| Popover + CSS anchor | Baseline (04/2025 et 01/2026)                                                                | à l'occasion  |

**Le cas `Temporal` mérite d'être argumenté**, parce que c'est le seul où la tentation est
légitime. `Temporal.PlainDateTime` correspond **exactement** à la sémantique du type date-naïf maison
imposé par la règle du projet (`dd/MM/yyyy HH:mm:ss` Coinhouse → `YYYY-MM-DDTHH:mm:ss`, jamais
converti en fuseau, `new Date()` interdit). C'est le remplacement conceptuellement juste. Mais pour
un outil public, sans contrôle sur le navigateur du visiteur, l'adopter aujourd'hui signifie
embarquer un polyfill pour tout l'écosystème Safari — du poids pour zéro gain sur iOS, alors que le
type maison est **déjà validé par l'oracle indépendant**. La recommandation est donc de préparer sans
migrer : isoler ce type derrière une interface calquée sur `PlainDateTime`, pour que la bascule, le
jour venu, soit un changement d'implémentation et non de conception.

**Stockage et PWA.** `navigator.storage.persist()` est **déjà appelé** (`local-storage.ts:60`,
**vérifié**) — l'axe technique le recommandait, l'audit interne a montré que c'était fait. Reste que
la purge d'inactivité de sept jours de Safari s'applique hors PWA installée : inciter à
« Ajouter à l'écran d'accueil » reste le seul levier réel côté iOS (**sourcé**).

**Accessibilité.** WCAG 3.0 est un _Working Draft_ (03/03/2026) et **ne déprécie pas** WCAG 2.x : la
cible actuelle du projet est la bonne. L'European Accessibility Act s'applique depuis le 28/06/2025
mais vise des « opérateurs économiques » plaçant produits ou services sur le marché à titre
commercial — un outil gratuit publié par un particulier en est vraisemblablement exclu
(**à vérifier** : la page officielle de la Commission n'a pas pu être chargée).

### 4.4 Sources de données et licences

C'est l'axe qui a produit le plus de matière exploitable, et le seul où une **opportunité franche**
apparaît.

**Le point le plus inconfortable** : CoinGecko, la source la plus utilisée du produit, **documente
elle-même que le CORS n'est pas garanti et recommande de proxifier via un backend** (**sourcé**
[E19]) — recommandation structurellement inapplicable ici. Et ses conditions parlent d'un usage
« personnel », la republication étant soumise à accord écrit (**sourcé** [E20]) ; DefiLlama porte des
clauses voisines (**sourcé** [E21]). La règle de la décision n° 59 — _la licence d'une source choisit
son mode de transport_ — impose donc de rester sur l'appel navigateur tant que la question n'est pas
tranchée, et c'est précisément l'objet de la décision 12 attendue du propriétaire (§ 8).

**Le risque n'est pas théorique et se réalise vite** : Pyth a basculé son point d'entrée public
Hermes en clé API obligatoire le **26/08/2026** — cinq jours avant cette étude (**sourcé** [E15]) ;
Etherscan V1 avait été coupée net le 15/08/2025 (**sourcé** [E16]) ; CoinCap a fermé son palier sans
clé en 2025. D'où P63 : la détection d'un bridage doit se compter en heures, pas en semaines.

**L'opportunité franche : la macro européenne.** Le produit ne suit que la macro américaine. Pour un
utilisateur français, les taux directeurs de la BCE, l'inflation de la zone euro et l'EUR/USD sont
l'angle mort le plus visible. Or **Eurostat autorise explicitement la réutilisation, commerciale et
non commerciale, sur simple mention de la source** (**sourcé**, primaire [E22]) — la licence la plus
permissive rencontrée dans toute l'étude, plus nette encore que celle du BLS [E23], qui autorise la
réutilisation mais impose la date d'accès et une clause de non-garantie. Le patron d'instantané
committé déjà en place pour la Fed s'y applique **tel quel**, sans invention.

**Continuité des sources publiques américaines** : le _lapse in appropriations_ fédéral d'octobre-
novembre 2025 a rendu la collecte du CPI d'octobre impossible et non rattrapable, fait sauter le
JOLTS de septembre et décalé le PIB du quatrième trimestre du 29/01 au 20/02/2026 (**sourcé**). Un
état « donnée gelée » vaut mieux qu'un silence — c'est une finition de P62.

**Conditions d'utilisation non localisées** — portées comme telles, jamais supposées permissives :
mempool.space, Routescan, Hyperliquid, alternative.me. Ce dernier est le plus fragile de tous : un
service non officiel, à mainteneur unique, sans engagement contractuel, qui alimente le sentiment de
marché.

### 4.5 Interopérabilité IA et agentique

**Une seule action a une échéance ; tout le reste est de la veille.**

La révision MCP `2026-07-28` est « la plus large depuis le lancement » : cœur rendu _stateless_
(suppression du handshake `initialize` et de `Mcp-Session-Id`), méthode `server/discover` désormais
obligatoire, `subscriptions/listen` en remplacement du flux SSE, transport HTTP+SSE déprécié, Roots,
Sampling et Logging dépréciés — avec une fenêtre de douze mois (**sourcé** [E9]).

Le choix `stdio` et la lecture seule épargnent au projet **tout** le chantier d'autorisation, qui
n'existe que sur les transports HTTP. Le risque réel n'est donc pas la coupure : c'est la **dérive
silencieuse** d'un serveur écrit à la main que rien ne mettra à jour quand les clients attendront
`server/discover`. P73 est petit, et il est daté.

**Ce qui n'est pas mûr, et qu'il faut nommer comme tel** :

- **WebMCP** — rapport en incubation au Web Machine Learning Community Group du W3C, coporté par des
  ingénieurs Google et Microsoft, **position Mozilla « neutre »** (**sourcé** [E10]). À prototyper
  derrière un drapeau si l'envie prend ; jamais en dépendance de production.
- **`llms.txt`** — convention communautaire depuis septembre 2024, **jamais un standard** IETF ou
  W3C, et aucune déclaration officielle d'un moteur confirmant son usage pour l'indexation
  (**sourcé** [E11]). Coût quasi nul, retour non prouvé : à traiter comme tel, pas comme une
  stratégie.
- **API Prompt de Chrome / Gemini Nano** — stable depuis Chrome 138, mais mono-navigateur (absente
  d'Android Chrome et d'iOS) et exigeant **22 Go de stockage libre** (**sourcé** [E24]). Disqualifiée
  comme dépendance pour une application qui tient en 86 Ko.

**Cadre réglementaire, à connaître avant d'y toucher** : l'article 50 de l'AI Act impose depuis le
**2 août 2026** qu'un système conçu pour interagir avec une personne l'en informe, et l'article 2(12)
exempte les IA libres et gratuites du règlement **sauf précisément pour l'article 50 et le haut
risque** (**sourcé** [E8]). Autrement dit : la gratuité et la petite taille n'exemptent de rien sur
ce point précis. Si un expliqueur apparaît un jour, il devra s'annoncer.

### 4.6 Audit interne adverse

Mesures brutes du 31/08/2026 : **47 271 lignes de source** hors tests (159 `.ts`, 58 `.svelte`), dont
**4 152 générées et committées** (8,8 %). Les plus gros fichiers : `snapshot.generated.ts` (3 025),
`app.svelte.ts` (2 051), `report-model.ts` (1 108), `SimulateSheet.svelte` (823), `Overview.svelte`
(796), `schema.ts` (794). Documentation : 303 696 caractères, dont `DECISIONS.md` 106 847 pour 60
décisions.

**Ce qui tient, et qu'il ne faut pas toucher.** La pureté du domaine est **réelle**, pas déclarative :
`grep` d'imports Svelte, de `document.`, `window.`, `localStorage`, `indexedDB` et `new Date(` dans
`src/lib/domain` hors tests → **zéro résultat** ; `{@html}` et `innerHTML` → **zéro résultat dans tout
`src`**. C'est rare, et c'est ce qui rend tout le reste réparable. De même, la discipline `$effect`
(deux au maximum par composant, aucune cascade) et les barrières des générateurs sont des réflexes
justes.

**Les trois risques les plus sous-estimés**, par ordre :

1. **Le centre de gravité du code est là où il n'y a ni test ni mesure** — c'est le § 1.
2. **La durabilité des données repose sur des silences délibérés.** Trois mécanismes anodins se
   composent en un risque qu'aucun ne porte seul : l'assainissement reconstruit chaque enregistrement
   par liste blanche (`schema.ts:334`) et **abandonne donc tout champ inconnu** ; le test de
   complétude s'arrête aux **conteneurs** (`storage.test.ts:429`) et n'attrape pas un champ oublié ;
   et l'échec du miroir `localStorage` est traité comme un non-événement — `savePersistedState`
   renvoie `ok: true` dès qu'IndexedDB a réussi (`state-store.ts:83-86`), et **un test exige
   explicitement ce silence** (`state-store.test.ts:149`). Ajoutez `SCHEMA_VERSION = 1` figé et un
   `migrations.ts` de 19 lignes sans aucune migration : rien ne permettrait de **détecter** une
   régression de format. C'est le seul scénario de perte de données réelle de toute l'étude.
   **Hypothèse non tracée** : qu'une version antérieure réactivée par le service worker puisse relire
   un état plus récent, l'élaguer des champs qu'elle ignore, et le réenregistrer.
3. **La documentation est déjà un passif mesurable.** Trois divergences vérifiées dans le fichier
   censé être la carte du système : `ARCHITECTURE.md` énumère cinq convertisseurs de plateformes et
   en oublie trois, dont `binance.ts` (572 lignes, le plus gros de la famille) ; il annonce 11 hôtes
   CSP situés dans `vite.config.ts` alors qu'ils sont 17 et vivent dans `src/lib/support/csp.ts` ; et
   `2026-08-push-et-mcp.md` porte encore « rien ici n'est construit ni décidé » alors que `mcp/`
   existe (816 lignes), documenté, avec la décision n° 48. Le mécanisme est identifiable et
   généralisable : **c'est la prose sans oracle qui dérive**, tandis que `csp.test.ts`, qui croise la
   table des origines avec la CSP réellement livrée, reste juste. Le passif n'est pas le volume de la
   documentation, c'est **la part qui n'est adossée à aucun test**.

**Coûts de calcul, déduits mais non mesurés.** `$state.snapshot(this.state)` est appelé **dans** le
`$effect` (`app.svelte.ts:1010-1014`), donc un clone profond de tout l'état à chaque mutation ; le
_debounce_ de 300 ms ne protège que l'écriture, pas le clonage. Et `sortEvents` trie avec
`localeCompare` (deux appels par comparaison) sur des clés qui sont des `YYYY-MM-DDTHH:mm:ss` et des
identifiants ASCII, où l'ordre lexicographique suffirait. **À vérifier** : ces deux coûts sont déduits
du code, pas mesurés — d'où P57, qui doit chiffrer le point de rupture avant qu'on optimise à
l'aveugle.

**Divers, vérifié** : le cache d'historique (`src/lib/history/cache.ts`) n'a ni `delete`, ni `prune`,
ni plafond — croissance monotone. `npm run check`, le portail avant commit selon `CLAUDE.md`, lance
`vitest run` **sans** `--coverage` : le seuil n'est jamais un signal local, seulement une surprise de
CI. Et un worktree complet avec ses `node_modules` vit dans l'arbre du dépôt sans être dans
`.gitignore` — protégé par son fichier `.git`, pas par une règle.

---

## 5. Le verdict de la retenue

C'est le résultat le plus utile de l'étude, et le plus contre-intuitif : **trois axes ont convergé,
sans se parler, sur « ne pas migrer ».** L'état de l'art 2026 pour ce produit n'est pas d'adopter,
c'est de choisir ce qu'on n'adopte pas.

La raison est structurelle. Ce projet a trois propriétés qui inversent le calcul habituel :

1. **Il n'a pas de serveur.** La moitié des nouveautés de l'écosystème (remote functions, MCP sur
   HTTP, Environment API, proxys d'API) résolvent des problèmes qu'il n'a pas.
2. **Il est public, sans contrôle sur le navigateur du visiteur.** Une fonctionnalité disponible
   partout sauf sur Safari n'est pas disponible : elle est un polyfill.
3. **Il est maintenu par une personne.** Chaque source ajoutée est une dépendance à vie ; chaque
   migration est une session qui ne va pas à la vérification.

La liste argumentée — Temporal, TypeScript 7, SvelteKit, `Decimal`, longue traîne DeFi, multi-actifs,
copilote IA hébergé, WebMCP en production, `llms.txt` comme stratégie, Gemini Nano, MCP en HTTP,
promesse d'exactitude fiscale, pérennité communautaire — est portée par
[`ROADMAP.md`](../ROADMAP.md) § 5, où elle rejoint les exclusions déjà actées. Elle n'est pas répétée
ici.

Une nuance, pour ne pas transformer la retenue en immobilisme : **P60 et P62 sont des adoptions**, et
elles sont recommandées. Trusted Types parce que c'est Baseline et que le coût de conformité est
quasi nul dans un code sans `{@html}` ; la macro européenne parce que la licence est propre et que le
patron existe déjà. La retenue est un critère, pas une doctrine.

---

## 6. Les briques proposées — remplacées

Les vingt-deux briques P52-P73 de ce document sont caduques : leur plage était déjà occupée sur
`main`. Vingt d'entre elles ont survécu au réaudit du 01/09/2026 et vivent désormais sous les
numéros **P75-P94**, dans
[`2026-09-01-etat-de-lart-reaudit.md`](2026-09-01-etat-de-lart-reaudit.md) et
[`ROADMAP.md`](../ROADMAP.md) § 3 quater. Deux ont été livrées entre-temps, quatre ont rétréci.

## 7. Ce qui reste exclu

Les exclusions du produit sont inchangées et cette étude les confirme : comptes utilisateurs, cloud,
analytics, bot Discord stockant les portefeuilles, clés API d'exchange dans le site, proxy pour
contourner une interdiction d'appel navigateur, push garanti application fermée. Le mouvement
local-first progresse (une conférence dédiée existe, portée par la défiance envers les agrégateurs
cloud après l'arrêt de Mint en janvier 2024 et le règlement Plaid de 2022) mais reste minoritaire
face au trio cloud dominant : **rien dans l'état de l'art 2026 ne justifie de rouvrir ces portes.**

S'y ajoutent, au titre de cette étude : le calcul d'un chiffre affiché par un LLM même local,
l'ouverture du serveur MCP en HTTP, et toute revendication de conformité ou de certification
fiscale. **Le copilote IA hébergé, que ce document excluait, ne l'est plus** : la décision n° 69 a
réécrit la promesse, sous consentement par usage et étiquetage de l'article 50.

---

## 8. Décisions attendues du propriétaire

Reprises dans [`ROADMAP.md`](../ROADMAP.md) § 6 sous les numéros 9 à 12.

9. **Le BOFiP est en retard sur la loi — vous affichez quoi ?** Taux légal 31,4 %, doctrine publiée
   30 %. Afficher le taux légal daté et sourcé est défendable, mais c'est un choix éditorial qui vous
   engage. Prérequis de P67.
10. **La macro européenne vaut-elle deux sessions ?** L'angle mort le plus net, la licence la plus
    propre — mais la seule brique du lot qui **élargit** le périmètre au lieu de consolider.
11. **Le mode fiscal : jusqu'où ?** P66, P67 et P69 restent de l'aide au report. P68 est la première
    brique qui ressemble à un conseil. Frontière à fixer **avant** de coder. Si vous la franchissez,
    faites relire la méthode par un professionnel : l'outil restera une estimation.
12. **Écrire à CoinGecko et DefiLlama ?** Leur usage « personnel » couvre-t-il une application
    publique et gratuite ? La réponse peut être non — mieux vaut la connaître avant d'avoir bâti P61
    dessus. Sans réponse, la décision n° 59 impose l'appel navigateur.

---

## 9. Méthode, coût et limites

**Dispositif.** Six agents lancés en parallèle, **aucun autorisé à en lancer d'autres**, avec
plafonds de recherche et de longueur imposés — contrainte de coût explicite du commanditaire. Cinq
agents sur un modèle intermédiaire pour la veille, dont le travail est majoritairement de la lecture
de pages ; **un seul agent sur le modèle le plus capable pour l'audit interne**, là où le jugement
architectural sur 47 271 lignes paye réellement. Synthèse, vérification et arbitrage faits par le
modèle principal. Environ 650 000 jetons d'agents au total.

**Ce que le croisement a produit, et qu'un axe seul n'aurait pas donné.** L'axe technique
recommandait d'appeler `navigator.storage.persist()` contre l'éviction iOS ; l'audit interne a
constaté qu'il l'était déjà. Un chantier évité. Symétriquement, aucun agent de veille ne pouvait
trouver le trou de couverture de `src/state`, et l'audit interne seul n'aurait pas su que Rotki
venait de livrer un serveur MCP.

**Vérifications personnelles**, non déléguées : la date d'expiration du calendrier BLS
(`BLS_MIN_MONTHS_AHEAD`, `blsCoverageEnd()`, et le calcul du premier run en échec), le périmètre de
`coverage.include`, l'absence de garde de formule dans `text()` et l'inventaire des champs qui y
transitent, l'absence de `.claude/worktrees/` dans `.gitignore`, et l'application effective de la
hausse de CSG aux crypto-actifs.

**Limites assumées, à revérifier — et quand :**

| Point                                                           | Pourquoi c'est ouvert                                 | Quand le rouvrir               |
| --------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| PFU à 31,4 % appliqué à l'art. 150 VH bis                       | Trois sources secondaires convergentes, pas le texte  | Avant P67, et avant avril 2027 |
| Qualification des perpetuals DeFi au regard de l'art. 150 ter   | Aucune source primaire ne tranche                     | Avant P66 ; suivre le BOFiP    |
| Sort de l'« impôt sur la fortune improductive »                 | Absent de la synthèse post-promulgation, non confirmé | Au dépôt du PLF 2027           |
| Symbole d'actif hostile survivant à la normalisation d'import   | Chemin non tracé                                      | Avec P59                       |
| Coût du clone profond et de `localeCompare` à 50 000 opérations | Déduit du code, non mesuré                            | C'est l'objet de P57           |
| Réactivation d'une version antérieure par le service worker     | Cycle de vie non tracé                                | Avec P56                       |
| CGU de mempool.space, Routescan, Hyperliquid, alternative.me    | Pages non localisées                                  | Avec P63                       |
| Champ d'application de l'EAA pour un éditeur particulier        | Page officielle inaccessible                          | Sans urgence                   |

**Signaux à surveiller, sans échéance connue** : support stable de `Temporal` dans Safari ;
compatibilité annoncée de `svelte-check` et `typescript-eslint` avec tsgo ; publication BOFiP sur le
_staking_ ; adoption du serveur MCP local par d'autres outils après Rotki — si elle se généralise, il
faudra cesser de le présenter comme un différenciateur.

---

## Sources (consultées le 31/08/2026)

Sources primaires signalées. Ce qui n'a pas pu être vérifié est marqué **à vérifier** dans le corps
du document, jamais présenté comme établi.

- [E1] Légifrance, art. 150 VH bis du CGI, version en vigueur au 01/07/2026 (primaire) —
  <https://www.legifrance.gouv.fr/codes/id/LEGISCTA000050366754/2026-07-01>
- [E2] BOFiP, `BOI-RPPM-PVBMC-30`, page mère — sans mise à jour depuis le 23/04/2024 (primaire) —
  <https://bofip.impots.gouv.fr/bofip/11966-PGP.html>
- [E3] AMF, fin de la période transitoire pour les PSAN au 01/07/2026 (primaire) —
  <https://www.amf-france.org/en/news-publications/news/amf-reminds-digital-asset-service-providers-transitional-period-allowing-them-continue-providing>
- [E4] EUR-Lex, directive (UE) 2023/2226 dite « DAC8 » (primaire) —
  <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32023L2226>
- [E5] DLA Piper, LFSS 2026 : hausse de la CSG sur les revenus du capital (secondaire) —
  <https://www.dlapiper.com/fr-fr/insights/publications/2026/01/loi-de-finance-de-la-securite-sociale-2026>
- [E6] CIC Banque Privée, principales mesures fiscales 2026 (secondaire) —
  <https://www.cic.fr/banqueprivee/fr/principales-mesures-fiscales-2026.html>
- [E7] Hagnéré Patrimoine, panorama de l'article 12 de la LFSS 2026 par catégorie de revenu
  (secondaire) —
  <https://www.hagnere-patrimoine.fr/guides-patrimoine/comment-payer-moins-impots/lfss-2026-article-12-prelevements-sociaux>
- [E8] AI Act, articles 50 et 2 — transparence, et exemption des IA libres et gratuites sauf pour
  l'article 50 — <https://artificialintelligenceact.eu/transparency-rules-article-50/> ;
  <https://artificialintelligenceact.eu/article/2/>
- [E9] Model Context Protocol, journal des changements de la révision 2026-07-28 —
  <https://modelcontextprotocol.io/specification/2026-07-28/changelog> ;
  <https://blog.modelcontextprotocol.io/posts/2026-07-28/>
- [E10] W3C Web Machine Learning CG, WebMCP (incubation), et position Mozilla « neutre » —
  <https://github.com/webmachinelearning/webmcp> ;
  <https://github.com/mozilla/standards-positions/issues/1412>
- [E11] llms.txt, convention communautaire — <https://llmstxt.org/>
- [E12] Help Net Security, OWASP et l'injection de prompt dans les applications agentiques
  (11/06/2026, secondaire) —
  <https://www.helpnetsecurity.com/2026/06/11/owasp-prompt-injection-ai-security-failures/>
- [E13] Can I use, `Temporal` — Safari sans support stable ; TC39, proposition passée Stage 4 —
  <https://caniuse.com/temporal> ; <https://github.com/tc39/proposal-temporal>
- [E14] Microsoft, annonce de TypeScript 7.0 — pas d'API publique du compilateur avant 7.1 —
  <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0>
- [E15] Pyth Network, documentation Hermes — clé API obligatoire depuis le 26/08/2026 —
  <https://docs.pyth.network>
- [E16] Etherscan, arrêt total de l'API V1 le 15/08/2025 —
  <https://info.etherscan.com/etherscan-api-v1-will-be-fully-deprecated-by-15th-august-2025/>
- [E17] Rotki, journal des changements v1.44.0 (21/08/2026) — serveur MCP local —
  <https://github.com/rotki/rotki/blob/develop/docs/changelog.rst>
- [E18] Maybe Finance, dépôt archivé par l'équipe fondatrice —
  <https://github.com/maybe-finance/maybe>
- [E19] CoinGecko, erreurs et limites de débit — le CORS n'est pas garanti, un proxy backend est
  recommandé — <https://docs.coingecko.com/docs/errors-and-rate-limits>
- [E20] CoinGecko, conditions d'utilisation — usage « personnel », republication soumise à accord
  écrit — <https://www.coingecko.com/en/terms>
- [E21] DefiLlama, conditions d'utilisation — <https://defillama.com/terms>
- [E22] Eurostat, avis de droits d'auteur — réutilisation commerciale et non commerciale autorisée
  sur mention de la source (primaire) —
  <https://ec.europa.eu/eurostat/web/main/help/copyright-notice>
- [E23] Bureau of Labor Statistics, conditions d'utilisation de l'API (primaire) —
  <https://www.bls.gov/developers/termsOfService.htm>
- [E24] Chrome, Prompt API — stable depuis Chrome 138, 22 Go de stockage libre requis —
  <https://developer.chrome.com/docs/ai/prompt-api>
