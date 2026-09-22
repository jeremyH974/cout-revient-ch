# Cohérence, suivi de trading et téléphone — le plan des lots 1, 2, 3 et 5

> Demande traitée : « Améliore la cohérence de l'outil. Enrichis la partie suivi de trading. Et
> j'aimerais que ce soit consultable aussi sur mobile. Je vais l'utiliser que pour moi pour le
> moment. Rends-la pratique, facile à utiliser. Vise l'état de l'art. » Puis, lots choisis : « Pour
> chaque lot, partie et sous-partie, avant d'implémenter, explore le sujet, aide-toi de recherches
> sourcées à jour en ligne et fais un plan. Vise l'excellence, l'état de l'art et prêt pour le
> futur. »

_Établi le 22/09/2026 contre `origin/main` à `65fe946` (**2.17.0**, 179 décisions). Les faits sont
marqués **vérifié** (relu dans le dépôt ce jour, référence donnée) ou **sourcé** (renvoi `[S…]` à
la liste datée en fin de document). Propositions numérotées **P119-P126** — numéros provisoires,
recalés à la fusion si une autre session en prend entre-temps. Réponses du propriétaire, le même
jour : téléphone **Android** ; sur PC, **la variante privée et le site public** ; usage
**personnel** ; lien avec hlscope **après** les lots 1 à 3. Statut : **proposition**, deux lots en
cours d'implémentation (P119, P120)._

---

## 1. Ce que l'audit a établi

Six agents ont audité le dépôt et mesuré l'écran, puis chaque constat qui oriente une décision a été
relu à la source. Quatre défauts de fond en sortent.

### 1.1 Le téléphone affiche tout, mais rien n'y est fait pour le pouce

**Vérifié** par une mesure Playwright de 32 routes à 390×844 et 360×780 (données d'exemple,
réseau bouchonné) : **aucun débordement horizontal** sur les 64 mesures. L'écran tient. Ce qui ne
tient pas :

- `.card` n'a **aucune marge intérieure** ([`src/app.css:203-208`](../../src/app.css)) : sur
  Trading, Impôts, Comptes, Trades ou Statistiques, le texte touche le bord de l'écran ;
- **dix boutons** portent `class="primary"` ou `"secondary"` sans qu'aucun style ne les définisse,
  et s'affichent en texte nu (rapports Trading, Prêts et patrimoine, Portefeuille, Marché, feuille
  de partage, IA…) — chaque écran redéfinit ses boutons, 24 fois ;
- la barre d'onglets Trading passe sur **deux lignes** à 390 px, « Seuil » seul en dessous ;
- le bouton d'aide (i) mesure 22 px, les cases à cocher natives 13 px : sous le plancher de 24 px
  du critère WCAG 2.5.8 [S20] ;
- « Marché » fait 15 hauteurs d'écran, « Réglages » 8 (35 cibles de moins de 24 px), la fiche actif
  affiche toutes ses transactions sans pagination ;
- le conteneur racine est en `min-height: 100vh` ([`src/App.svelte:235-239`](../../src/App.svelte)),
  unité que la barre d'adresse mobile rend instable [S22].

### 1.2 Le journal de trading existe, mais ne sert pas encore au quotidien

**Vérifié** :

- la liste des trades n'a **ni recherche ni filtre** ([`Trades.svelte`](../../src/routes/trading/Trades.svelte)) ;
- le champ `tags` du journal est **mort** : il existe dans le modèle
  ([`journal.ts:28`](../../src/lib/domain/trading/journal.ts)), le schéma et l'export CSV, mais
  aucun écran ne permet de le saisir ;
- sur la fiche, le formulaire de journal arrive après les coûts, le graphique et **toutes les
  exécutions** ([`TradeDetail.svelte:378`](../../src/routes/trading/TradeDetail.svelte)) : environ
  2,5 écrans de défilement au téléphone ;
- chaque position ouverte affiche son prix de liquidation, jamais sa **distance** ;
- le même chiffre s'appelle « P&L total », « Résultat » et « P&L net » sur le seul écran Trading
  ([`Trading.svelte:491,641,646`](../../src/routes/Trading.svelte)).

**Rectificatif** d'un premier constat : le funding **est** rattaché à chaque trade
([`round-trips.ts:5,131`](../../src/lib/domain/trading/round-trips.ts),
`netPnl = brut − frais + funding`). Une sortie de recherche tronquée l'avait fait croire absent.

### 1.3 Trois navigateurs, et une fusion qui perd des données en silence

Le propriétaire utilise la variante privée **et** le site public sur son PC, plus un téléphone :
ses données vivent dans trois navigateurs. **Vérifié** :

- la restauration « en fusionnant » fait `{...incoming, ...current}` par collection
  ([`json-io.ts:101-127`](../../src/lib/storage/json-io.ts)) : **l'appareil courant gagne
  toujours**, quelle que soit la version la plus récente ;
- **aucun enregistrement ne porte de date de modification** (journal, trades manuels, opérations,
  comptes, règles d'alerte) ;
- les suppressions sont destructives (trois motifs dans `src/state/app.svelte.ts`) : **une
  suppression réapparaît** à la fusion suivante avec un appareil qui avait encore l'élément.

Une note de journal écrite au téléphone serait donc perdue au retour sur le PC. C'est le préalable
de tout usage à plusieurs appareils.

### 1.4 Le même motif, écrit vingt fois

**Vérifié** : boutons redéfinis dans 24 fichiers ; deux barres d'onglets d'espace quasi identiques
(`InvestTabs`, `TradingTabs`) ; huit grilles de chiffres `dt/dd` indépendantes ;
`.toFixed(dp).replace('.', ',')` réécrit dans `TradeStats`, `Trades` et `TradeDetail` alors que
`fmtRatio` existe ([`src/lib/format/fr.ts:131-138`](../../src/lib/format/fr.ts)) — contre la règle
« l'arrondi n'existe que dans `src/lib/format/` » de `CLAUDE.md` ; `eslint.config.js` n'a aucune
règle propre ; l'écran « Plus » aligne jusqu'à 14 liens à plat, dont quatre appartiennent à
d'autres espaces.

## 2. Ce que l'état de l'art impose — et ce qu'il n'impose pas

**Fusion entre appareils.** Pour un état échangé entre pairs sans serveur, le bon modèle est un
CRDT **à base d'état** : une fusion commutative, associative et idempotente [S1]. Une LWW-map
(« le plus récent gagne ») **par enregistrement** suffit à un seul utilisateur ; le par-champ se
justifie pour de l'édition concurrente en direct [S4] ou du texte riche, et le rejeu de mutateurs
suppose une autorité serveur [S5]. La date doit être une **horloge logique hybride** [S2] : proche
de l'heure murale, mais insensible au décalage d'horloge d'un téléphone. Les suppressions deviennent
des **pierres tombales**. Et un nouveau champ reste **additif** — ignoré sans être refusé par une
version plus ancienne —, discipline formalisée par Cambria [S3], qui laisse ouverte une adoption
future d'Automerge 3 [S6].

**Dossier synchronisé.** Les clients Drive, OneDrive et Dropbox créent des « copies de conflit »
[S7] [S8] : si chaque appareil n'écrit que **son** fichier et que la fusion est idempotente, ces
copies deviennent inoffensives. Un fichier OneDrive « à la demande » peut se lire vide tant qu'il
n'est pas hydraté [S9] : « vide » doit valoir « rien de nouveau ». File System Access n'existe que
sur Chromium **de bureau** [S12] ; sur Android, le sélecteur système (qui liste Drive) [S35] et la
feuille de partage suffisent — mais `navigator.share` **refuse les `.json`** [S14], et une
réception par Web Share Target passe par un POST intercepté par le service worker [S13].
`FileSystemObserver` n'a jamais quitté l'essai d'origine [S10]. Côté chiffrement, un nonce
aléatoire de 96 bits par message est correct [S11] ; lier l'en-tête en clair comme **AAD** est la
bonne pratique qui manque encore.

**Android.** La boîte d'installation enrichie demande `description` et `screenshots` au manifeste
[S15] ; `id`, `launch_handler` et `shortcuts` (raccourcis par appui long) sont utiles aujourd'hui ;
`handle_links` n'est pas livré, la Badging API n'existe pas sur Chrome Android [S18], et
`persist()` s'accorde selon l'engagement [S19]. Un sous-chemin GitHub Pages doit être propagé à
`id`/`start_url`/`scope` [S32].

**Écran.** 24 px minimum par cible, par la zone plutôt que par le glyphe [S20] ; **jamais deux
lignes d'onglets** — ils défilent [S21] ; `svh` pour le conteneur racine, `dvh` pour ce qui doit
suivre la barre d'adresse [S22] ; `interactive-widget=resizes-content` pour que le clavier Android
redimensionne au lieu de recouvrir [S23] ; `role="switch"` pour les interrupteurs [S25] ;
`<details>` natifs pour une longue page de réglages ; pagination plutôt que virtualisation, qui
casse la lecture d'écran ; divulgation progressive : une bulle, pas un paragraphe permanent [S26].

**Journal de trading.** Les meilleurs outils (TradeZella, Tradervue, TradesViz, Edgewonk,
TraderSync) combinent des facettes fermées et recalculent **la synthèse du sous-ensemble filtré**
au-dessus de la liste [S36] [S37] [S38] ; un « aucun résultat » nomme les filtres et propose leur
remise à zéro [S39]. Les tags se **normalisent à l'écriture** et s'autocomplètent par fréquence
[S40] ; le motif combobox de l'APG est mono-valeur, un champ à puces en est une composition [S41]
[S42]. Une feuille basse modale s'appuie sur `<dialog>` + `showModal()`, qui rend le reste inerte
[S43] ; deux fermetures au plus [S44] ; brouillon automatique **et** action explicite [S45] ; un
badge dit un fait, jamais une série [S46]. Hyperliquid liquide au **prix mark**, pas au milieu du
carnet [S47], et en marge croisée le seuil dépend de tout le compte [S48].

**Ce que l'état de l'art n'impose pas** : un moteur de synchronisation complet, un cloud, un
langage de requête pour les filtres, ni des « vues enregistrées » pour un seul utilisateur.

## 3. Les propositions

Chaque proposition se livre en une PR, avec ses tests, une contre-épreuve par garde-fou
(décision n° 75), et `CHANGELOG`, `DECISIONS` et `ARCHITECTURE` à jour.

### P119 — Le socle d'interface partagé (1 session, en cours)

**Quoi.** Une marge intérieure par défaut sur `.card` (modificateur `.flush` pour les listes
pleine largeur) ; des styles de bouton **globaux** `.primary` / `.secondary` (+ `.large`) qui
remplacent les 24 définitions locales et habillent les dix boutons nus ; une grille de chiffres
`dl.stat-grid` ; un composant `SpaceTabs` (une ligne qui défile, ombres de débordement en CSS pur,
onglet courant ramené en vue) pour Investissement et Trading ; un bouton d'aide à 24 px de zone
(44 px au doigt) ; `fmtRatio` étendu et une règle ESLint `no-restricted-syntax` qui interdit
`.toFixed(` et `.toLocaleString(` dans `src/routes` et `src/components` [S29].

**Pourquoi des classes globales plutôt qu'un composant `Button`.** Un bouton est souvent un lien
(`<a>`), porte des attributs variés, et vit dans 34 fichiers : une classe partagée donne la même
cohérence pour un diff dix fois plus petit. Les onglets, eux, ont un comportement (défilement,
ramener en vue) : ils méritent un composant.

**Sémantique.** Les onglets d'espace sont des **liens de navigation** entre pages : `nav` +
`aria-current`, pas le motif ARIA `tablist`, réservé aux panneaux d'une même page.

**Critères.** Toutes les cartes ont ≥ 12 px de marge sur leurs quatre côtés ; la barre d'onglets
tient sur une ligne à 320 et 390 px ; aucune cible < 24 px sur les boutons d'aide ; la contre-épreuve
ESLint échoue en nommant la règle ; avant/après visuel à 390 et 1 280 px sur toutes les routes.

### P120 — La fusion entre appareils (2 sessions, en cours)

**Quoi.** Un module pur `src/lib/storage/sync/` :

- `hlc.ts` — horloge logique hybride sérialisée en chaîne triable
  (`<ms>.<compteur>.<appareil>`) ;
- `stamp.ts` — **datation au moment de l'enregistrement**, par comparaison du nouvel état avec le
  dernier enregistré : ajout ou modification → nouvelle version, disparition → pierre tombale ;
- `merge.ts` — une LWW-map par collection suivie, départage déterministe, élagage (lignes d'un lot
  d'import supprimé, données Hyperliquid d'un compte supprimé, états d'une règle supprimée) et un
  **rapport** (ajoutés, mis à jour, supprimés, conflits hérités).

Collections **suivies** : opérations et trades manuels, qualifications, corrections, réglages
d'actifs, comptes, journal, lots d'import, règles et états d'alerte. Collections **d'union** (des
faits immuables, comme aujourd'hui) : lignes brutes, Hyperliquid, prêts, journal d'alertes.
Collections **locales à l'appareil** : réglages, caches, taux.

**Trois choix de conception.**

1. **Dater au diff d'enregistrement, pas dans chaque mutateur.** `src/state` n'a presque aucun test
   (2,6 % des lignes) et une vingtaine de mutateurs : un mutateur oublié ne daterait jamais. Le
   diff, lui, est un seul point de branchement dans un module pur, testé par propriétés.
2. **Un champ additif `sync`, sans monter `SCHEMA_VERSION`.** Un fichier sans `sync` est « hérité »
   ; une version plus ancienne l'ignore (Cambria [S3]). `sanitizeState` le valide, sans quoi une
   sauvegarde le perdrait.
3. **Un conflit hérité se tranche en faveur de l'appareil qui fusionne, et cette décision est
   datée.** Deux versions différentes sans date n'ont pas de « plus récente » ; garder la locale
   et la dater fait converger tous les appareils dès le tour suivant.

L'identifiant d'appareil vit dans le méta IndexedDB, **jamais** dans une sauvegarde. La démo et les
effacements réinitialisent la ligne de base **sans** créer de pierres tombales : effacer un appareil
ne doit jamais effacer les autres.

**Critères.** Propriétés fast-check : commutativité, associativité, idempotence ; « le plus récent
gagne » ; une pierre tombale ne ressuscite pas ; décalage d'horloge absorbé ; convergence des
conflits hérités en deux tours. E2E à deux contextes de navigateur (deux appareils). Stryker
étendu au dossier `sync/`.

### P121 — Des trades qu'on retrouve : filtres et synthèse du filtre (1 session)

**Quoi.** Sur la liste des trades : une recherche (symbole, compte, texte du journal) et des
facettes en puces — sens, issue (gagnant, perdant, ouvert, **à annoter**), setup, erreur, tag,
compte — dont quatre visibles et le reste dans une feuille « Filtres (n) ». Au-dessus de la liste,
**la synthèse du sous-ensemble** : nombre, résultat net, taux de réussite, espérance en R, profit
factor — calculée par `computeStats(tripsClosedIn(sous-ensemble, fenêtre))`, la même recette que
l'écran Statistiques ([`TradeStats.svelte:31-42`](../../src/routes/trading/TradeStats.svelte)),
donc les mêmes chiffres. Un état « aucun trade pour ces filtres » distinct de « aucun trade »,
avec remise à zéro.

**Où vit l'état du filtre.** Dans les réglages de l'appareil (`ui`), comme la plage d'analyse, et
**pas dans l'URL** : les décisions n° 156-157 l'ont tranché pour la période
([`schema.ts:88-96`](../../src/lib/storage/schema.ts)) — le partage de l'application est une image,
le routeur n'a pas de modèle de requête, et aucune donnée ne voyage dans l'URL. Le filtre survit à
l'aller-retour vers une fiche, ce qui était le vrai besoin du bouton retour.

**Pur.** Le prédicat de filtre vit dans `src/lib/domain/trading/filter.ts`, sous test de mutation.

### P122 — Annoter en trois gestes, et des tags enfin vivants (1,5 session)

**Quoi.**

- Une **feuille d'annotation** (sur `Sheet.svelte`, déjà bâtie sur `<dialog>`), ouverte depuis
  chaque ligne de la liste et depuis le haut de la fiche : setup, erreurs, **tags**, note sur 5,
  une ligne de revue. Le plan et la revue longue restent sur la fiche, dont le journal remonte
  au-dessus des exécutions.
- Un **champ à puces** unique pour la saisie (puces d'entrée) et le filtre (puces de filtre) :
  combobox + listbox, suppression au clavier avec un libellé accessible, Retour arrière sur champ
  vide pour retirer la dernière.
- **Normalisation à l'écriture** : espaces réduits, casse affichée conservée, comparaison
  insensible à la casse et aux accents. Autocomplétion par fréquence puis ordre alphabétique.
  Limites du schéma respectées (40 tags de 120 caractères,
  [`schema.ts:864-876`](../../src/lib/storage/schema.ts)).
- Un **écran de gestion des tags** (usage, renommer — ce qui fusionne si le nom existe déjà).
- **Brouillon** automatique en mémoire, restitué à la réouverture, **et** un bouton « Enregistrer »
  ; le retour Android ferme la feuille au lieu de quitter l'application. `interactive-widget=
resizes-content` pour que le clavier ne masque pas le champ actif.
- Une **pastille « à annoter »** factuelle (trades clos sans journal), jamais une série.

### P123 — La distance à la liquidation (0,5 session)

**Quoi.** Sur chaque position ouverte et sur la fiche d'un trade ouvert : « peut baisser de
12,4 % (−10,23 $) avant liquidation ». Deux formules écrites **séparément**, testées chacune :
`long : (mark − liq) / mark` ; `short : (liq − mark) / mark`. Le prix est le **mark** [S47] —
`positionValue / |taille|` de l'instantané Hyperliquid, cohérent avec le `liquidationPx` du même
instant —, **jamais** le milieu de `allMids`, même en mode direct. `liquidationPx` absent est un
**état valide** : « pas de seuil au collatéral actuel ». En marge croisée, une bulle précise que le
seuil suppose le reste du compte inchangé [S48].

### P124 — Le téléphone : écran et installation Android (1,5 session)

**Quoi.**

- **Racine en `svh`** ; `interactive-widget=resizes-content` si P122 ne l'a pas déjà posé.
- **Réglages** en sections `<details>` (la première ouverte), avec un sommaire d'ancres ; l'état
  de `persist()` et `storage.estimate()` affichés.
- **Marché** groupé par jour, en-têtes collants, filtré sur « à venir » par défaut, liens
  officiels à 24 px de zone.
- **Fiche actif** paginée (« Afficher plus »), comme les exécutions d'un trade.
- **Interrupteurs** `role="switch"` avec une ligne entière cliquable, pour le direct Trading et
  les réglages.
- **Trading d'un coup d'œil** : équité et résultat en tête, puis les positions (avec leur distance
  à la liquidation, P123) et le nombre de trades à annoter, avant la courbe ; les paragraphes
  d'explication passent dans des bulles (i).
- **Installation Android** : manifeste avec `id`, `description`, `screenshots` générées depuis les
  données d'exemple, `shortcuts` (Trading, trades à annoter, Vue d'ensemble, Importer),
  `launch_handler` ; un bouton « Installer l'application » branché sur `beforeinstallprompt`, dans
  le seul build public (la variante privée n'a pas de service worker).

### P125 — La boîte aux lettres chiffrée (2 sessions, après P120)

**Quoi.** Chaque navigateur dépose **son** fichier chiffré dans un dossier que le propriétaire
synchronise déjà (Google Drive ou OneDrive) et fusionne ceux des autres, avec P120. Ni OAuth, ni
serveur, ni réseau : c'est compatible avec la variante privée, dont le verrou n'emballe que
`fetch` et `WebSocket`.

- **PC (Chromium, les deux origines)** : un dossier choisi une fois (le module de sauvegarde sur
  disque, généralisé) ; écriture d'un **nouveau** fichier numéroté à chaque dépôt (jamais de
  réécriture d'un fichier que le client cloud est peut-être en train d'envoyer), les deux derniers
  gardés ; lecture des fichiers des pairs au démarrage, au retour au premier plan et à la demande.
- **Android** : un bouton « Synchroniser ». Recevoir par le sélecteur système (Drive y figure) ou
  par **Web Share Target** (le fichier partagé depuis Drive ou Quick Share arrive dans l'app) ;
  envoyer par la feuille de partage, en `.txt` puisque `.json` est refusé [S14], avec repli sur le
  téléchargement.
- **Enveloppe v3** : Argon2id et AES-GCM comme aujourd'hui, plus l'en-tête lié en **AAD** et une
  compression avant chiffrement ; clé dérivée une fois par sel et par session ; l'enveloppe v2 reste
  lisible. Coffre fermé ⇒ aucune écriture, comme aujourd'hui.
- **Robustesse** : fichier vide, fantôme ou copie de conflit = « rien de nouveau » ; l'ordre de
  découverte des fichiers ne change rien (idempotence de P120).

### P126 — Un seul vocabulaire, et « Plus » rangé (1 session, en dernier)

**Quoi.** Un lexique (`docs/lexique.md`) — Résultat, Réalisé, Latent, Frais, Funding ;
« plus-value » et « moins-value » réservés aux écrans fiscaux, au sens du BOFiP [S28] — appliqué à
toutes les chaînes, et gardé par un test qui refuse les synonymes bannis (avec contre-épreuve).
L'inventaire des variantes est mécanique, l'arbitrage du lexique ne l'est pas. « Plus » en groupes :
Actions (importer, ajouter) · Fiscal · Comptes et données · Contexte · Aide ; « Prêts » et
« Rapport PDF » en sortent, puisque chaque espace a désormais son rapport. Heuristique n° 4 de
Nielsen : un même mot, un même concept, partout [S27].

## 4. Ordre, parallélisme et modèles

| Vague | PR  | Contenu                    | Dépend de | Modèles                                        |
| :---: | --- | -------------------------- | --------- | ---------------------------------------------- |
|   1   | α   | P119 socle                 | —         | Sonnet implémente, Opus relit                  |
|   1   | β   | P120 fusion                | —         | Opus spécifie, Sonnet implémente, Opus relit   |
|   2   | γ   | P121 + P122 + P123 (lot 1) | α         | Sonnet implémente, Opus relit                  |
|   2   | δ   | P124 (lot 2)               | α         | Sonnet implémente, Opus relit                  |
|   2   | ε   | P125 (lot 3, suite)        | β         | Sonnet implémente, Opus relit la cryptographie |
|   3   | ζ   | P126 (lot 5, suite)        | γ, δ      | Haiku inventorie, Sonnet applique              |

Chaque implémentation travaille dans **son** worktree, parti d'`origin/main` ou de sa PR parente
(des agents parallèles dans un même worktree se faussent leurs contre-épreuves). Les PR empilées
sont reciblées sur `main` **avant** la fusion de leur parente. Rien n'est fusionné sans l'accord du
propriétaire.

## 5. Ce qui n'est pas recommandé

- **Filtres dans l'URL** : c'est la pratique courante [S39], mais les décisions n° 156-157
  l'excluent ici, pour de bonnes raisons (voir P121).
- **Un composant par bouton** : même cohérence qu'une classe globale pour un diff dix fois plus
  gros (voir P119).
- **Le motif ARIA `tablist` pour les onglets d'espace** : ce sont des liens vers des pages.
- **LWW par champ, ou OR-Set pour les tags, dès maintenant** : utiles pour de l'édition
  concurrente, que n'a pas un utilisateur seul. Le format additif laisse la porte ouverte.
- **Synchronisation par l'API Drive ou Dropbox** (OAuth PKCE) : elle reviendrait sur un refus
  documenté ([`ROADMAP.md:645`](../ROADMAP.md)) pour un gain de confort que la boîte aux lettres
  couvre déjà — voir la section 6.
- **Virtualiser les longues listes** ; **Badging API** et **`handle_links`** sur Android ;
  **`FileSystemObserver`** — non disponibles ou nuisibles (section 2).

## 6. Ce qui demande une décision du propriétaire

1. **Synchronisation automatique par un cloud (niveau 3)** — seulement si, à l'usage, la boîte aux
   lettres se révèle trop manuelle au téléphone.
2. **Une seule période par écran Trading** : revenir sur la décision n° 95, qui laisse la courbe
   suivre ses propres fenêtres Hyperliquid.
3. **Le lien avec hlscope** (ticket → plan du trade, R prévu contre R réalisé) : après les lots 1 à
   3, format à définir avec la session qui tient `code/trading`.
4. **Les lots non choisis** : revue guidée et constats comportementaux (disposition, renforcement
   de perdants, surtrading, part taker, SQN, Sortino), puis MAE/MFE.

## 7. Limites de cette étude

- La mesure mobile émule Chromium ; **rien ne remplace un vrai Android** pour le clavier sous une
  feuille, le partage à froid vers l'application installée et l'hydratation d'un fichier Drive.
- Plusieurs sources de la section 2 sont secondaires (guides d'outils, articles) ; elles sont
  signalées dans la liste et n'ont servi qu'à des choix d'interface, jamais à un calcul.
- Les preuves académiques sur le comportement des traders (surtrading, effet de disposition,
  gamification) ont été rassemblées pour les lots non choisis ; elles ne fondent aucune
  proposition de ce document.

## Sources

Toutes consultées le 22/09/2026.

- [S1] Shapiro, Preguiça, Baquero, Zawirski, « A comprehensive study of Convergent and Commutative
  Replicated Data Types », INRIA RR-7506, 2011 —
  https://www.researchgate.net/publication/50949847_A_comprehensive_study_of_Convergent_and_Commutative_Replicated_Data_Types
- [S2] Kulkarni, Demirbas et al., « Logical Physical Clocks » (horloges logiques hybrides), 2014 —
  http://muratbuffalo.blogspot.com/2014/07/hybrid-logical-clocks.html
- [S3] Ink & Switch, « Project Cambria » — https://www.inkandswitch.com/cambria/
- [S4] Figma, « How Figma's multiplayer technology works » —
  https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
- [S5] Rocicorp, « Ready Player Two » — https://rocicorp.dev/blog/ready-player-two
- [S6] Automerge, notes d'août 2026 — https://automerge.org/blog/2026-august/
- [S7] Aide Google Drive, copies en conflit — https://support.google.com/drive/answer/2565956
- [S8] Aide Dropbox, « conflicted copy » — https://help.dropbox.com/organize/conflicted-copy
- [S9] Microsoft Learn, fichiers espaces réservés —
  https://learn.microsoft.com/en-us/windows/compatibility/placeholder-files
- [S10] Chrome for Developers, `FileSystemObserver` —
  https://developer.chrome.com/blog/file-system-observer
- [S11] NIST, « Practical Challenges with AES-GCM », 2023 —
  https://csrc.nist.gov/csrc/media/Events/2023/third-workshop-on-block-cipher-modes-of-operation/documents/accepted-papers/Practical%20Challenges%20with%20AES-GCM.pdf
- [S12] Chrome for Developers, File System Access —
  https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
- [S13] web.dev, recevoir des fichiers partagés — https://web.dev/patterns/files/receive-shared-files
  ; Workbox et Share Target — https://web.dev/articles/workbox-share-targets
- [S14] MDN, `Navigator.share()` — https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
- [S15] web.dev, interface d'installation enrichie —
  https://web.dev/articles/web-apps/richer-install-ui
- [S16] Chrome for Developers, critères d'installation (05/12/2023) —
  https://developer.chrome.com/blog/update-install-criteria
- [S17] web.dev, WebAPK — https://web.dev/articles/webapks
- [S18] Chrome for Developers, Badging API —
  https://developer.chrome.com/docs/capabilities/web-apis/badging-api
- [S19] web.dev, stockage persistant — https://web.dev/articles/persistent-storage
- [S20] W3C, Understanding SC 2.5.8 Target Size (Minimum) —
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- [S21] Material Design 3, onglets — https://m3.material.io/components/tabs/guidelines
- [S22] web.dev, unités de viewport — https://web.dev/blog/viewport-units
- [S23] Chrome for Developers, redimensionnement au clavier —
  https://developer.chrome.com/blog/viewport-resize-behavior
- [S24] Chrome for Developers, bord à bord — https://developer.chrome.com/docs/css-ui/edge-to-edge
- [S25] MDN, rôle ARIA `switch` —
  https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/switch_role
- [S26] NN/g, « Progressive Disclosure » — https://www.nngroup.com/articles/progressive-disclosure/
- [S27] NN/g, « Consistency and Standards » —
  https://www.nngroup.com/articles/consistency-and-standards/
- [S28] BOFiP, BOI-RPPM-PVBMC-30-30 (23/04/2024) —
  https://bofip.impots.gouv.fr/bofip/11969-PGP.html/identifiant=BOI-RPPM-PVBMC-30-30-20240423
- [S29] ESLint, `no-restricted-syntax` — https://eslint.org/docs/latest/rules/no-restricted-syntax
- [S30] W3C Design Tokens CG, première version stable (28/10/2025) —
  https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/
- [S31] Svelte, `$props` et `{#snippet}` — https://svelte.dev/docs/svelte/$props ;
  https://svelte.dev/docs/svelte/snippet
- [S32] vite-plugin-pwa, sous-chemin — https://github.com/vite-pwa/vite-plugin-pwa/issues/263
- [S33] Supa.is, guide de l'interface Hyperliquid (source secondaire) —
  https://supa.is/article/hyperliquid-app-interface-guide-panels-explained-2026
- [S34] Kubera, suivi de patrimoine (source secondaire) — https://www.kubera.com/net-worth-tracker
- [S35] Android Developers, Storage Access Framework —
  https://developer.android.com/guide/topics/providers/document-provider
- [S36] TradeZella, filtres — https://help.tradezella.com/en/articles/12417670-using-filters-in-tradezella
- [S37] TradesViz, filtres et filtres rapides — https://www.tradesviz.com/blog/efficiently-filter-trades/ ;
  https://www.tradesviz.com/blog/quick-filters/
- [S38] Edgewonk, filtres — https://edgewonk.zendesk.com/hc/en-us/articles/360013435880-The-Filters-at-the-top
- [S39] NN/g, états vides — https://www.nngroup.com/articles/empty-state-interface-design/ ;
  LogRocket, état d'URL (source secondaire) — https://blog.logrocket.com/url-state-usesearchparams/
- [S40] TradesViz, guide des tags — https://www.tradesviz.com/blog/tags-complete-guide/
- [S41] W3C APG, motif combobox — https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- [S42] eBay Evo, puces et combobox —
  https://opensource.ebay.com/evo-web/components/chips-combobox/accessibility ; Material 3, puces —
  https://m3.material.io/components/chips/guidelines
- [S43] MDN, `HTMLDialogElement.showModal()` —
  https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal ; Material 3,
  feuilles basses — https://m3.material.io/components/bottom-sheets/guidelines
- [S44] NN/g, fermetures accidentelles de superpositions —
  https://www.nngroup.com/articles/accidental-overlay-dismissal/
- [S45] Damian Wajer, enregistrement automatique (source secondaire) —
  https://www.damianwajer.com/blog/autosave/
- [S46] Material 3, badges — https://m3.material.io/components/badges
- [S47] Hyperliquid, « Robust price indices » —
  https://hyperliquid.gitbook.io/hyperliquid-docs/trading/robust-price-indices
- [S48] Hyperliquid, liquidations — https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations
