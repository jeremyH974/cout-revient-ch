# Changelog

Toutes les évolutions notables de ce projet sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions : [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

### Added

- **Le harnais qui rendra l'IA sûre, avant qu'il y ait la moindre IA.** Un vérificateur prend un
  texte français et la structure de données qui l'a produit, et rend la liste des nombres du texte
  **introuvables dans la source** : c'est ce qui permettra de garantir qu'une phrase générée ne
  contient aucun chiffre inventé. Un texte qui ne s'ancre pas sera rejeté **entier**, jamais
  affiché en partie.
- **Son premier client est notre propre rendu français**, et il y a déjà trouvé trois nombres écrits
  en dur dans nos phrases plutôt que tirés de vos données. Ils sont désormais déclarés et justifiés
  un par un.
- **Sa limite est écrite noir sur blanc** : un ancrage vert dit qu'aucun chiffre n'a été fabriqué, et
  rien de plus — pas qu'un chiffre juste est attribué au bon actif, ni qu'une phrase sans chiffre est
  vraie. Deux cas de référence figent cette limite dans les tests plutôt que dans un paragraphe
  (`docs/ia-harnais.md`, `docs/DECISIONS.md` n° 68).

### Fixed

- Un test de cohérence échouait au hasard selon la vitesse de la machine : il n'attendait pas le
  chargement de l'historique de prix, contrairement à son voisin immédiat.

## [2.13.0] - 2026-08-30

### Added

- **Réconciliation** : un écran qui ne dit plus « quelque chose ne va pas » mais **quoi corriger,
  dans quel ordre, et comment**. Lignes à qualifier, actifs sans cours, soldes qui ne tombent pas
  juste, virements sans contrepartie, entrées sans coût d'acquisition, doublons candidats, comptes
  sans pays : chaque anomalie porte sa preuve — les lignes brutes concernées — et un bouton d'action.
  Un doublon n'est signalé que s'il vient de deux sources ou de deux comptes différents : deux achats
  identiques le même jour sur le même compte sont un investissement programmé, pas une erreur
  (`docs/reconciliation.md`, `docs/DECISIONS.md` n° 65).
- **Second avis** : votre export Waltio se compare à ce moteur, ligne à ligne sur l'annexe 2086. Un
  écart n'est présenté comme « à examiner » que sur une grandeur qui **ne dépend d'aucune méthode de
  calcul** ; partout ailleurs, l'app énonce les deux nombres et dit que les deux peuvent être justes.
  Aucun classement d'outils, aucune comparaison de prix, et les mots « erreur » ou « se trompe »
  n'existent pas — un test le vérifie. Le fichier comparé n'entre jamais dans votre portefeuille
  (`docs/second-avis.md`, `docs/DECISIONS.md` n° 67).
- **Vos données restent les vôtres, et c'est vérifié** : le format de sauvegarde est documenté
  champ par champ, sa politique de version est écrite, et une sauvegarde ancienne se relit toujours.
  L'export portable est prouvé **sans aucune perte** par un test qui exporte puis réimporte des
  milliers d'historiques tirés au hasard. Ce qu'il ne sait pas porter est annoncé **avant** le
  téléchargement, compté sur vos propres données (`docs/backup-format.md`, `docs/DECISIONS.md` n° 66).

- **« Pourquoi ce chiffre ? »** : un PRU, un latent, un réalisé, des frais ou une valeur se
  cliquent, et l'app montre **d'où le montant vient** — les lignes brutes qui l'ont produit avec
  leur numéro, la jambe contrepartie réellement retenue, les lots consommés, le cours utilisé avec
  sa source et sa date. Ce qui manque est **nommé** plutôt que comblé : un chiffre qui dépend d'un
  cours externe, une ligne encore à qualifier, un coût reporté le disent. Les montants restent en
  euros même en affichage dollars, et le mode discret masque les montants sans effacer la structure
  (`docs/tracabilite.md`, `docs/DECISIONS.md` n° 61).
- **Comptes à déclarer (formulaire 3916-bis)** : l'app déduit de vos comptes déjà saisis ceux qui
  relèvent de l'obligation française, avec le pays de l'organisme, un export CSV et un bouton
  « Copier la liste ». Coinhouse en est exclu — c'est un prestataire français. Un portefeuille dont
  vous détenez seul la clé est signalé **incertain** : le texte ne tranche pas ce cas, et l'app ne
  tranche pas à votre place. Aide au report, ni déclaration ni conseil fiscal
  (`docs/declarations-fr.md`, `docs/DECISIONS.md` n° 62).
- **Veille réglementaire** : un écran dédié et un bloc court dans le rapport disent ce qui a changé,
  ou pourrait changer, dans le droit et la doctrine — chaque ligne avec son statut, sa date et sa
  source, et la mention explicite quand cette source n'est pas officielle. Un test **échoue** dès
  qu'une entrée n'a pas été relue à temps : le silence ne doit pas se confondre avec la stabilité
  (`docs/veille-reglementaire.md`, `docs/DECISIONS.md` n° 64).
- **Le serveur MCP s'installe en deux gestes**, sans rien compiler : un fichier à télécharger depuis
  la dernière version publiée, une ligne à coller. Il devine désormais votre fichier de sauvegarde
  et, s'il ne le trouve pas, nomme le chemin qu'il a essayé (`docs/mcp.md`,
  `docs/DECISIONS.md` n° 63).

- **« Vos chiffres face au décor »** : l'écran « Contexte de marché » mesure désormais si votre
  portefeuille bouge réellement avec les indicateurs qu'il affiche. La série comparée est votre
  **rendement, apports et retraits neutralisés** — comparer une valeur brute, qui monte parce qu'on
  y verse de l'argent, à un indice sans apports fabriquerait une performance qui n'existe pas.
- **Quatre fenêtres, jamais une.** 30, 90, 180 et 365 jours, fixées d'avance. Leur désaccord est
  l'information : l'écran dit « les quatre fenêtres concordent » ou « elles se contredisent — aucun
  chiffre unique ne décrit cette relation », et affiche l'écart.
- **Une superposition optionnelle** : votre courbe de rendement et un indicateur, ramenés à 100 au
  premier jour qu'ils ont en commun, sur **un seul axe**. Deux échelles indépendantes permettraient
  de faire coïncider n'importe quelles courbes ; les deux traits se distinguent par le style, jamais
  par la seule couleur.
- **Rien n'est calculé sans que vous le demandiez.** Cet écran promet de ne rien demander au réseau,
  et les corrélations exigent l'historique de vos cours : un bouton le propose, il ne se déclenche
  pas tout seul (`docs/DECISIONS.md` n° 60).

- **Des indicateurs macroéconomiques**, en tête de l'écran « Contexte de marché » : réserves des
  banques auprès de la Fed, taux réel et nominal à dix ans, pente de la courbe américaine — et le
  prix du pétrole dès qu'une clé sera fournie.
- **Aucun chiffre n'est affiché seul.** Chacun vient avec son **rang dans son propre passé**, sur
  deux fenêtres : « 2,42 % » ne dit rien, « 96ᵉ percentile sur un an, 99ᵉ sur dix ans » dit tout.
  Les deux fenêtres se contredisent parfois, et c'est justement ce qu'il faut voir : la pente de la
  courbe est au 11ᵉ percentile sur un an mais au 50ᵉ sur dix ans.
- **Les séries qui montent tendanciellement sont converties en variation avant d'être classées** —
  sinon leur rang vaudrait 100 % en permanence. L'écran le dit sous la valeur (« variation sur
  3 mois »), et chaque chiffre porte sa date d'observation.
- **Le VIX n'y figure pas**, et ce n'est pas un oubli : les conditions de Cboe interdisent d'en
  stocker l'historique, et son serveur refuse les appels directs depuis un navigateur. Aucune
  source libre n'existe pour cet indice. La liquidité affichée est, elle, le chiffre **publié par
  la Fed**, et non le calcul reconstitué à la main que l'on voit souvent — la différence est
  expliquée à côté (`docs/DECISIONS.md` n° 59, `docs/macro.md`).
- **Un écran « Contexte de marché »**, dans le menu « Plus » : le calendrier des publications
  américaines qui font bouger les marchés — décisions de la Fed, inflation CPI et PCE, emploi,
  PIB, prix à la production, postes vacants. Les heures sont converties dans votre fuseau, en
  tenant compte du décalage entre les changements d'heure américain et européen : la réunion de la
  Fed du 28 octobre s'affiche bien à 19 h, et non 20 h comme celle de septembre.
- **Il fonctionne hors ligne et ne demande rien au réseau** : les dates sont embarquées dans
  l'application, donc aucun service extérieur n'apprend ce que vous consultez. Elles sont
  rafraîchies une fois par semaine, à la publication du site.
- **L'écran dit ce qu'il ignore.** Il annonce jusqu'à quelle date il est complet — au-delà, seules
  les réunions de la Fed sont connues, les autres organismes n'ayant pas publié leurs dates. Il
  précise que le rang « majeure » est un choix de rédaction et non une mesure. Et il n'affiche ni
  prévision de marché ni valeur publiée : ces chiffres appartiennent à des fournisseurs
  commerciaux, seules les dates sont des faits publics (`docs/DECISIONS.md` n° 58,
  `docs/calendrier-macro.md`).

### Fixed

- **L'indice Fear & Greed ne fonctionnait pas sur le site publié**, et personne ne pouvait le voir.
  L'adresse de la source manquait à la politique de sécurité du site, laquelle n'est posée qu'à la
  publication : en développement tout marchait. La valeur restait donc vide, et comme une alerte ne
  se déclenche jamais tant qu'une de ses conditions est invérifiable, **toute alerte conditionnée
  au sentiment de marché restait muette** — sans message ni voyant. La surveillance automatique
  interrogeait pourtant bien cette source, mais depuis un serveur, où la politique ne s'applique
  pas : elle affichait vert pendant que le navigateur bloquait.
- **Un garde-fou empêche désormais que cela se reproduise** : les adresses extérieures que
  l'application connaît sont réunies dans une table unique, d'où la politique de sécurité est
  engendrée, et un test refuse toute adresse contactée sans y être inscrite — comme il refuse déjà
  une source utilisée sans être créditée (`docs/DECISIONS.md` n° 57).
- **Les « apports nets » n'en étaient pas.** La courbe de patrimoine traçait en référence le **coût
  des positions détenues**, et l'espace Trading n'y contribuait rien. L'écart annoncé comme « votre
  gain » valait en réalité `latent d'investissement + équité de trading entière` — un résultat
  additionné à un solde. Conséquence visible : une vente à perte faisait **baisser** la courbe de
  référence, et la moins-value réalisée disparaissait du tableau. Les apports sont désormais les
  **flux entrés dans le périmètre moins ceux qui en sont sortis**, cumulés jour par jour, des deux
  côtés ; un virement entre les deux espaces s'annule de lui-même. Côté Trading, tous les mouvements
  de trésorerie comptent — pas seulement les dépôts et retraits : ne compter que ceux-là
  transformait un virement perps → spot en une perte de plusieurs centaines d'euros
  (`docs/DECISIONS.md` n° 55).
- **Deux nouvelles auto-vérifications** tiennent cette définition : « le détail par espace refait le
  total », et « le résultat déduit des apports égale _réalisé + latent_ calculé lot par lot » — deux
  chemins de calcul entièrement distincts qui doivent tomber sur le même nombre.
- **Les contrôles automatiques étaient montés deux fois**, dans les réglages et sur la Vue
  d'ensemble, avec des entrées qui avaient déjà divergé. Une seule liste désormais.

### Changed

- **La Vue d'ensemble devient un tableau de bord d'aide à la décision.** Un chiffre domine —
  **le patrimoine** —, une **période choisie en haut gouverne tout l'écran** (variation, courbe,
  répartition), et une carte **« D'où vient ce chiffre »** pose l'addition `apports nets + résultat
= patrimoine`, **dépliable espace par espace** (repliée par défaut). Les doublons sont supprimés :
  la valeur d'investissement était affichée à trois endroits, l'équité de trading à deux. La couleur
  est réservée aux **variations** — un niveau reste neutre — et une variation ne s'écrit plus jamais
  par la seule couleur : triangle, signe et équivalent parlé l'accompagnent. Trois règles reprises
  de l'**ISO 24896:2026** (_Notation for business reporting_, publiée cette année) et de sa formule
  SUCCESS (`docs/DECISIONS.md` n° 56).
- **« Patrimoine » remplace « Valeur nette »** dans l'interface : le même écran affichait « Valeur
  nette » et « Valeur » à quelques centimètres l'une de l'autre.
- **Les montants d'une réconciliation s'additionnent à l'écran** : l'écart est calculé sur les
  montants _arrondis_, sans quoi trois nombres justes affichent une addition fausse d'un centime.

### Added

- **Bien plus de cryptos reconnues** : la table des prix passe de **70 à 479 actifs** (top 500
  CoinGecko, généré et daté), et les logos de **62 à 211**. Chacun détient des cryptos
  différentes — l'application en reconnaît désormais l'essentiel du marché.
- **Champ « Identifiant CoinGecko » sur la fiche actif** : quand un actif n'est pas reconnu, ou
  quand deux projets partagent son symbole, vous pouvez désigner vous-même le bon. Le réglage
  existait dans les données depuis longtemps sans qu'aucun écran ne permette de le saisir.

### Changed

- **Les logos ne sont plus téléchargés en bloc à l'installation.** Ils passent par un cache
  d'exécution : vous ne récupérez que ceux de vos propres actifs, une fois. Sans ce changement,
  élargir la couverture aurait imposé plusieurs mégaoctets à chaque installation. Hors ligne, un
  actif dont le logo n'a jamais été affiché montre ses initiales.
- **Un symbole ambigu ne reçoit aucun prix automatique** : quand deux projets partagent un ticker,
  l'application n'en choisit aucun plutôt que de risquer un prix faux — donc un PRU faux. Sept cas
  sur cinq cents, tous rattrapables par le champ ci-dessus (`docs/DECISIONS.md` n° 54).

### Fixed

- **Les huit logos manquants demandent tous un kit de marque officiel** : vérification faite dans
  le paquet installé, aucun n'y figure. Une note antérieure en annonçait quatre comme disponibles
  sous licence libre — elle envoyait chercher des fichiers inexistants.

### Added

- **Carte de partage (P9)** : un bouton « Partager » sur la Vue d'ensemble produit une image
  1200 × 630 — le format d'aperçu de Discord — portant votre performance **hors apports**, le
  repère « mêmes apports en BTC », votre rendement annualisé et vos trois premières lignes **en
  pourcentage**. Partage natif sur mobile, copie de l'image sur ordinateur, téléchargement partout,
  et un résumé texte toujours proposé.
  **Aucun montant par défaut**, et la bascule qui les affiche **n'est pas mémorisée** : rouvrir la
  feuille repart des pourcentages seuls. Ce n'est pas une intention mais une propriété vérifiée par
  les tests. Le résumé texte est l'équivalent accessible de l'image et lui sert d'`alt` : il porte
  les mêmes chiffres, dans le même ordre (`docs/DECISIONS.md` n° 53).

### Fixed

- **Analyse des alertes de sécurité Dependabot** : les quatre alertes ouvertes viennent toutes de
  `@lhci/cli`, l'outil de mesure Lighthouse, jamais du code servi aux utilisateurs
  (`npm audit --omit=dev` rend zéro). Aucune n'a de correctif disponible, et trois sur quatre sont
  inatteignables dans cet usage. Le raisonnement est consigné pour ne pas être refait
  (`docs/DECISIONS.md` n° 52).

### Added

- **Courbe « Évolution de la valeur nette » sur la Vue d'ensemble (P38)** : ce que vous possédez
  jour après jour, **investissement et trading réunis**, avec vos apports nets en second plan —
  l'écart entre les deux courbes est votre gain. Un virement déplace les deux ensemble et ne
  ressemble donc jamais à une performance, à la différence d'un solde de compte. Période
  sélectionnable, mode discret et devise d'affichage respectés, et une phrase sous le graphique en
  donne l'équivalent lisible à voix haute.
  L'équité de trading, servie par la plateforme à des instants irréguliers, est **ramenée à un
  point par jour** pour pouvoir s'additionner : la courbe de l'écran Trading, elle, reste non
  amincie et demeure la référence pour lire un épisode violent. Un jour dont un compte n'a pas pu
  être converti est signalé comme **incomplet** — le total y est trop bas, et non approché
  (`docs/DECISIONS.md` n° 51).

- **Section « Sources des données » dans les réglages (P8)** : les douze services que
  l'application interroge depuis votre navigateur, chacun avec son rôle et son lien. Trois d'entre
  eux imposent contractuellement une mention — CoinGecko, Etherscan et alternative.me — et elle est
  désormais affichée. Le catalogue est **déclaratif** et croisé par un test avec les fournisseurs
  réellement déclarés dans le code : brancher une source sans l'attribuer fait échouer la CI, tout
  comme créditer un service qu'on n'interroge plus (`docs/DECISIONS.md` n° 47).

### Fixed

- **L'obligation d'attribution d'Etherscan était invisible** : ses conditions exigent un lien
  retour ou la mention « Powered by Etherscan.io APIs » dès que l'usage n'est pas strictement
  personnel — ce qui est le cas d'un site public. Elle se serait découverte à la réclamation.

### Changed

- **Les logos manquants ne sont plus ambigus** : un ticker sans logo est désormais soit embarqué,
  soit inscrit avec son motif (licence à vérifier, ou logo à intégrer). Un test l'exige, et vérifie
  aussi que la liste déclarée correspond aux fichiers réellement livrés — dans les deux sens.
- **Historique long de EURCV et GMX** : les deux cas étaient déjà résolus (GMX par l'historique
  profond de la 2.5.1, EURCV par son ancrage à 1 €) mais rien ne les verrouillait. Un test le fait
  désormais pour les 70 actifs curés, pas seulement pour ces deux-là — une courbe qui redevient
  courte ne lève aucune erreur, elle raccourcit.
- Dependabot ne propose plus TypeScript 7 : `svelte-check`, qui **est** notre vérificateur de
  types, borne son pair à TypeScript 6 et `npm ci` échoue avant toute compilation. La majeure 6
  reste proposée ; l'exclusion tombe dès que `svelte-check` accepte la 7.

## [2.12.0] - 2026-08-26

### Added

- **Cessions au format 2086 (P13)** : un bouton du rapport exporte vos cessions imposables en CSV,
  dans l’ordre des colonnes du formulaire (date, prix de cession, valeur globale du portefeuille,
  prix total d’acquisition, plus-value). Une colonne dit **ligne par ligne** ce qui n’a pas pu être
  chiffré, pour qu’une case vide ne passe jamais pour un zéro. **Aide au report, pas une
  déclaration.**
- **Réconciliation DAC8** : le rapport récapitule vos cessions brutes et acquisitions de l’année
  par actif, dans la forme que les plateformes feront remonter à l’administration à partir des
  opérations 2026 — de quoi comparer avec ce que Coinhouse déclarera. Décision n° 50.

## [2.11.0] - 2026-08-26

### Added

- **Coût réel des opérations (P7)** : le rapport estime désormais le **spread implicite** — cet
  écart entre le prix affiché par Coinhouse et le cours du marché, absent de la grille tarifaire
  comme de votre relevé. Il est présenté à côté des commissions facturées, avec un coût total.
  Méthode assumée : la comparaison se fait sur des cours de clôture quotidiens, donc seule la
  **médiane sur un grand nombre d’opérations** est retenue — jamais un chiffre par opération, qui
  ne mesurerait que le mouvement du marché ce jour-là. Sous 20 opérations comparables,
  l’estimation se déclare fragile ; un spread favorable ne vient jamais en déduction des
  commissions payées. Décision n° 49.

## [2.10.0] - 2026-08-26

### Added

- **Serveur MCP local** : Claude (Code ou Desktop) peut désormais LIRE votre portefeuille et
  répondre à « quel est mon PRU sur BTC ? », « combien de frais cette année ? », « que donnerait la
  vente de la moitié à 90 000 € ? ». Rien ne quitte votre machine : le serveur lit une sauvegarde
  de l’app, calcule avec le même moteur et n’ouvre aucune connexion réseau. Sept outils, tous en
  **lecture seule** (aucun ordre, aucune écriture), et chaque réponse porte la date de la
  sauvegarde et celle des cours utilisés. Aucune dépendance ajoutée : le transport du protocole
  est écrit à la main. Détail : docs/mcp.md, décision n° 48.

## [2.9.0] - 2026-08-26

### Added

- **Mode « Plan mensuel » du simulateur (P32)** : « si je verse X par mois pendant N mois », avec
  une hypothèse de prix que VOUS choisissez (de −50 % à +100 %). L’app en tire le PRU projeté, la
  quantité acquise, les frais et le latent. **Un scénario, pas une prévision** : la variation est
  répartie linéairement, et le PRU obtenu dépend du chemin autant que du point d’arrivée — le repère
  Vanguard (2023) est cité pour que l’étalement ne passe pas pour une martingale. Décision n° 46.

## [2.8.0] - 2026-08-26

### Added

- **Alertes v2 (P35)** : une règle peut désormais **expirer** (sans limite, 1, 2, 3 ou 6 mois — une
  alerte oubliée finit par se déclencher pour une raison qui n’a plus rien à voir avec l’intention
  de départ) et porter une **condition supplémentaire** sur l’indice Fear & Greed : les deux termes
  doivent être vrais en même temps. Une condition non satisfaite bloque le déclenchement sans
  désarmer la règle ; sans contexte de marché disponible, la règle reste dormante et le dit. Ces
  règles sont évaluées **app ouverte seulement** : le service worker ne sait comparer qu’un prix à
  un seuil. Décision n° 45.

## [2.7.0] - 2026-08-26

### Added

- **Contexte de marché (P34), opt-in** : l’indice Fear & Greed du jour s’affiche sur la Vue
  d’ensemble quand vous cochez le réglage correspondant (décoché par défaut). Il décrit l’humeur du
  marché entier, pas votre portefeuille, et ne dit pas quoi en faire. La requête ne transporte
  aucune de vos données ; la source (alternative.me) est citée à l’écran comme ses conditions
  l’exigent. Décision n° 44.

## [2.6.0] - 2026-08-26

### Added

- **Estimation fiscale française (P30)** — la brique que personne n’offre en méthode française.
  Dans le **simulateur**, en mode « Vendre » avec sortie en euros, un dépliant donne la plus-value
  imposable estimée et l’effet de la vente sur l’impôt de l’année (supplément dû, réduction si la
  vente dégage une moins-value, exonération sous 305 €, ou année nette perdante). Dans le
  **rapport** (écran et PDF), une section « Fiscalité française (estimation) » récapitule les trois
  derniers millésimes et le prix total d’acquisition restant. Méthode GLOBALE de l’article 150 VH
  bis : la plus-value porte sur le portefeuille entier, pas sur le PRU d’un actif ; seules les
  sorties vers l’euro sont imposables, les échanges entre actifs numériques (stablecoins compris)
  restent en sursis ; taux par millésime (30 % jusqu’aux cessions 2024, 31,4 % ensuite) ;
  moins-values imputables sur la seule année, sans report. Quand une valeur manque, l’app le dit
  au lieu d’inventer une plus-value. **Estimation, ni déclaration ni conseil fiscal** — faites
  vérifier votre situation par un professionnel. Détail : `docs/tax-fr.md`, décision n° 43.
- **Nouveau constat « Fiscalité de l’année »**.

## [2.5.1] - 2026-08-26

### Added

- **Historique de prix profond** : les courbes ne s'arrêtent plus à un an. Un quatrième
  fournisseur (DefiLlama) complète Coinbase, Kraken et CoinGecko lorsque ceux-ci butent sur leur
  profondeur — 365 jours pour CoinGecko, 721 points pour Kraken. Le rendement pondéré par le temps,
  le repère, la section « Risque » et la fiche actif remontent désormais jusqu'à la première
  opération du grand livre, y compris pour les actifs peu courants et ceux qui ne sont plus cotés.
  Il est interrogé en dernier : les trois autres cotant nativement en euros, on leur laisse la
  priorité et la conversion au taux BCE du jour n'intervient que sur ce qu'eux seuls ne couvrent
  pas. Un jour sans taux de change laisse son point de côté plutôt que d'afficher une valeur
  approximative (docs/DECISIONS.md n° 42).

## [2.5.0] - 2026-08-26

### Added

- **Section « Risque » dans le rapport (P31)**, écran et PDF : repli maximal avec ses dates et la
  date de retour au niveau, repli en cours, volatilité annualisée, ratio de Sortino, jours gagnants
  et perdants. **Ces mesures portent sur l’indice de performance, apports et retraits neutralisés**
  — un virement ne compte pas comme une baisse, à la différence de ce que montre un solde de compte.
  Sortino plutôt que Sharpe (pas de taux sans risque à inventer) ; volatilité annoncée à partir de
  30 jours de recul seulement. Détail : `docs/risk.md`, décision n° 41.
- **Anneau de répartition** dans le rapport (SVG maison, aucune dépendance) et tableau « Répartition »
  trié de la plus grosse part à la plus petite. L’anneau est décoratif : le tableau reste la source
  lisible par un lecteur d’écran.
- **Deux nouveaux constats** : « Repli maximal » et « Vos trois premiers actifs »
  (`docs/insights.md`).

## [2.4.0] - 2026-08-26

### Added

- **Section « Constats » (P33)** : l'app tire de vos chiffres des observations en une phrase, avec
  le nombre qui les fonde — frais payés sur 12 mois et leur part du volume, rentabilité de l'offre
  Coinhouse, concentration du portefeuille, rendement personnel (XIRR), résultat encaissé, actifs
  qui pèsent le plus en bien et en mal, mise de départ déjà récupérée, part des stablecoins, lignes
  à qualifier, actifs sans cours. Visibles sur la **Vue d'ensemble** (les 6 principales, avec un
  bouton « Copier »), dans le **Rapport** (toutes, plus le repère « mêmes apports en BTC ») et dans
  le **PDF**. Un constat constate : il ne recommande jamais d'acheter, de vendre ni d'arbitrer
  (frontière information / conseil, doctrine AMF du 04/08/2026). Détail : `docs/insights.md`,
  décision n° 40.
- **Étude « aide à la décision »** (26/08/2026) : panorama sourcé des concurrents France et monde,
  des références hors crypto, du cadre AMF/MiCA et de la fiscalité 2026, avec six briques chiffrées
  P30-P35 — `docs/proposals/2026-08-26-aide-a-la-decision.md`.

## [2.3.0] - 2026-08-25

### Added

- **Section « Abonnement Coinhouse » dans le rapport** (écran et PDF) : l'offre est **déduite de
  votre export** (Classique, Investisseur ou Gestion Privée, d'après les lignes d'abonnement
  facturées) ; les **remises de frais** réellement obtenues, les abonnements payés et la
  **rentabilité de l'offre** (remises − abonnements, sur 12 mois glissants et depuis le début) ;
  l'estimation « qu'aurait coûté la grille Classique sur les mêmes opérations » ; et, pour un
  compte Classique, le **volume annuel à partir duquel l'offre Investisseur (118,80 €/an) se
  rembourserait** à votre taux de frais effectif observé. Tout est déduit des données — rien
  n'est demandé — et chaque estimation est annoncée comme telle. Décision n° 39.

### Changed

- **Feuille « Créer une alerte » repensée** : les quatre types d'alerte deviennent des cartes
  expliquées en une ligne chacune (le groupe de boutons radio, visuellement cassé, est remplacé) ;
  une **jauge** situe d'un coup d'œil le PRU, le seuil et le prix actuel avec la zone de
  déclenchement teintée ; unités (€, $, %) affichées dans les champs ; un dépliant « Comment
  fonctionne le déclenchement ? » explique franchissement, ré-armement à 1 % et délai d'une heure.
- **Simulateur plus lisible et plus sûr** : position résumée en trois repères (Détenu, PRU,
  Investi — avec l'équivalent en euros du PRU quand l'affichage est en dollars : le PRU en
  dollars bouge avec le taux BCE du jour, celui en euros non) ; **équivalent « ≈ x BTC » sous le
  montant saisi** (fini le 0,5 $ tapé en croyant saisir 0,5 BTC) ; unités dans tous les champs ;
  états vides qui annoncent ce que le calcul produira ; variation de PRU masquée quand elle
  arrondit à zéro ; exposition avant → après affichée avec le résultat d'achat ; prix d'équilibre
  mis en évidence côté vente. Aucun changement de calcul — moteur, seuils et règles inchangés.

## [2.2.0] - 2026-08-25

### Added

- **Alertes et simulateur en dollars, avec le toggle de devise** : quand l'affichage est en
  dollars, les feuilles saisissent et affichent en dollars (taux BCE du jour, comme le reste de
  l'app) — le moteur reste en euros. Un seuil « Prix exact » tapé en dollars est **ancré en
  dollars** (comme une alerte de paire chez un exchange) : le montant garde son sens quand
  l'euro-dollar bouge ; sans taux connu, la règle est « dormante » et le dit. Aperçu bi-devise
  (dollars + euros), historique converti au taux du jour de chaque événement. Décision n° 37,
  propriété vérifiée : évaluer un seuil `$` au taux r ≡ évaluer le seuil `€ = $ ÷ r`.
- **Vérification opportuniste des alertes app fermée** (Chrome/Edge, PWA installée) : quand la
  veille et les notifications système sont activées, le navigateur peut réveiller le service
  worker de temps en temps (Periodic Background Sync) pour comparer les seuils **précalculés en
  euros** aux prix CoinGecko et notifier — à sa fréquence, jamais garantie, et l'interface le dit
  avec ces mots. Le service worker compare en décimal exact (jamais de flottant sur un montant,
  équivalence avec le moteur prouvée par propriétés) et ne ré-arme jamais ; les déclenchements
  sont journalisés par l'app à l'ouverture. Rien de plus ne sort de l'appareil que la veille
  classique (identifiants d'actifs seuls) — page Confidentialité mise à jour. Décision n° 38.
- **Proposition chiffrée** pour la suite (`docs/proposals/2026-08-push-et-mcp.md`, sources
  vérifiées le 25/08/2026) : émetteur Web Push opt-in (Cloudflare Worker + VAPID, 0 €/mois en
  free tier, 3-5 j, seuils hors de l'appareil) contre serveur MCP local en lecture seule
  (0 €, 1,5-2,5 j, rien ne sort) — recommandation : MCP local d'abord.

## [2.1.0] - 2026-08-25

### Added

- **Alertes de prix relatives au PRU** (`#/invest/alerts`, aussi depuis la fiche de chaque actif) :
  « sous le PRU de X % », « objectif PRU +X % », « objectif **net de frais de vente** » (grille
  Coinhouse du 18/08/2026, modifiable) ou prix exact. Déclenchement au **franchissement** (jamais
  de rappel en boucle), « une fois » ou récurrente avec ré-armement à marge de 1 % et au plus un
  déclenchement par heure et par règle ; les seuils relatifs **suivent votre PRU** — un nouvel
  achat les déplace d'eux-mêmes. Centre d'alertes (déclenchements récents, historique), pastille
  d'application, notifications système **opt-in** (le clic ramène à l'app), veille des prix
  opt-in (cadence 1 à 15 min, app ouverte). 100 % local : aucun serveur ne connaît vos seuils —
  en contrepartie, pas de notification quand l'app est fermée, et l'interface le dit.
- **Simulateur « et si ? »** sur chaque actif et depuis chaque alerte : **rachat** (nouveau PRU,
  frais Coinhouse virement/carte ou personnalisés), **vente** (produit net, résultat réalisé net
  de frais, **prix d'équilibre frais inclus**, « récupérer ma mise », sortie en euros ou en
  stablecoin avec rappel du sursis fiscal de l'art. 150 VH bis), et **objectif de PRU** (montant à
  investir pour amener le PRU à une cible). Mêmes règles de calcul que le moteur, vérifié par
  tests de propriétés.
- Échelle de prise de profit en un geste : trois alertes PRU +25 % / +50 % / +100 %.

## [2.0.0] - 2026-08-24

### Added

- Rendement hors apports (TWR) dans la synthèse du Rapport (écran et PDF), à côté du XIRR : taux
  insensible à la date de vos versements, chaîné jour par jour ; leur écart mesure l'effet du
  « moment » de vos apports. Annualisé au-delà de 30 jours, cumulé en dessous.
- Repère « mêmes apports en BTC » : vos apports et retraits réels rejoués aux mêmes dates sur le
  bitcoin, avec la valeur obtenue et l'écart. Les retraits impossibles et les flux hors profondeur
  de cotation sont signalés, jamais avalés.
- Suivi d'un **portefeuille Bitcoin entier** à partir de sa clé publique étendue (zpub, ypub, xpub) :
  toutes les adresses sont dérivées **dans votre navigateur** (la clé n'est envoyée nulle part),
  balayage jusqu'à 20 adresses vides consécutives, mouvements nets sur l'ensemble du portefeuille —
  une dépense qui vous rend la monnaie compte pour une seule sortie. Une clé privée étendue est
  refusée à la saisie.
- Secours pour les comptes on-chain EVM : Routescan sans clé (Ethereum), et une clé d'explorateur
  facultative (Etherscan V2 ou Blockscout Pro) dans les Réglages — clé de lecture seule, sans accès
  aux fonds. L'API publique Blockscout, utilisée par défaut, a été basculée vers une offre à clé par
  son éditeur : l'application ne dépend plus d'un seul chemin, et la surveillance prévient si celui
  sans clé s'arrête.
- Fonds EVM reçus **via un contrat** (pont, DEX, vault) désormais visibles : ils n'apparaissaient
  dans aucun flux jusqu'ici.
- Interrupteur « Trades en direct » (opt-in) sur l'écran Trading : vos exécutions et votre funding
  arrivent par WebSocket dès qu'ils ont lieu, sans cliquer « Actualiser ».
- Convertisseurs natifs supplémentaires : **Binance** (les trois exports : Transaction History et
  les deux Trade History), **Bitpanda** (préambule et lignes actions/ETF écartées) et **SwissBorg**
  (colonnes dont le nom change avec la devise du compte). Binance ayant cessé ses services en France
  le 1ᵉʳ juillet 2026, récupérer cet historique avant qu'il ne devienne inaccessible est une
  urgence pratique.
- Convertisseurs natifs d'import pour Kraken, Coinbase, Bitvavo, Ledger Live et Revolut : même
  compte, mêmes règles de valorisation et de virements appariés que l'import pivot ; dédoublonnage
  par hachage du contenu natif de la ligne, une correction de convertisseur ne duplique jamais une
  ligne déjà importée.
- Import JSON d'activités Ghostfolio (BUY/SELL/DIVIDEND/INTEREST/FEE) dans le même compte que les
  CSV pivot et les convertisseurs natifs.
- Rendement personnel annualisé (XIRR) dans la synthèse du Rapport (écran et PDF) : taux pondéré par
  les flux réels du grand livre (méthode Excel, base 365), masqué sous 30 jours d'historique ou sur
  des flux non calculables plutôt qu'un chiffre trompeur.
- Suivi en lecture seule d'adresses publiques on-chain (Bitcoin via mempool.space, Ethereum/
  Arbitrum One/Base via Blockscout) depuis l'écran Comptes : mouvements sans valeur EUR, candidats à
  l'appariement de virement ou lignes à qualifier ; jetons ERC-20 reconnus par liste blanche
  d'adresses de contrats, jamais par symbole affiché.
- Interrupteur « Prix en direct » (opt-in) sur l'écran Trading : cotations Hyperliquid par WebSocket
  pour les actifs détenus, jamais activées par défaut, jamais écrites dans le cache de prix persisté.
- Espace Trading complet : tableau de bord (synthèse dépôts nets / équité / P&L total, courbe
  d'équité et de P&L fournie par la plateforme et conservée hors ligne, résultat par période,
  positions ouvertes en tableau — taille · entrée, marque · liquidation, valeur, latent et % sur
  marge — reliées à leur aller-retour, avoirs spot, auto-vérification de réconciliation), onglets
  Trades, Fills et Statistiques.
- Graphique du détail d'un trade : prix quotidien de l'actif sur la fenêtre du trade, marqueurs
  d'entrées/sorties et lignes de niveau comme sur la plateforme (entrée moyenne, prix de
  liquidation, stop et objectif du plan).
- Journal de trading : aller-retours reconstruits automatiquement depuis les fills (retournements,
  liquidations, historique partiel signalé), saisie manuelle d'un trade, thèse/revue, setups,
  erreurs, note, plan entrée / stop / objectif → résultat en R, export CSV des trades.
- Statistiques de performance : espérance (devise et R), taux de réussite, profit factor, payoff,
  drawdown maximal, séries, ventilations (setup, actif, sens, jour, heure, durée, compte),
  avertissement d'échantillon sous 30 trades clos, résumé anonymisé à coller dans une IA.
- Vue d'ensemble au format synthèse : valeur nette (investissement + équité de trading), colonnes
  par espace, répartition du capital et flux vers/depuis le trading.
- Rail de navigation à gauche sur grand écran (≥ 1024 px).

- Bouton « Actualiser » sur la synthèse avec fraîcheur et source des prix, badge « périmé ».
- Fournisseurs de prix Kraken, Hyperliquid (HYPE, PURR et tokens spot Hyperliquid) et DefiLlama,
  prix en USD convertis au taux BCE du jour.
- Clé CoinGecko Demo optionnelle dans les réglages.
- Navigation en espaces : Vue d'ensemble (accueil), Investissement, Trading (en préparation), Plus ;
  anciens liens (`#/asset/btc`, `#/import`…) toujours valables.
- Comptes : écran « Comptes » (Plus), rattachement des saisies manuelles à un compte, filtre
  « Plateforme » sur les positions avec PRU par plateforme, colonne « Compte » dans l'export des
  opérations.
- Sauvegarde robuste : état principal dans IndexedDB (plus de plafond de 5 Mo), miroir localStorage,
  sauvegarde automatique dans un dossier choisi (Chrome/Edge), chiffrement optionnel de la
  sauvegarde par phrase secrète, partage vers Fichiers et rappel « écran d'accueil » sur iPhone.
- Import Hyperliquid en lecture seule par adresse publique (jamais de clé) : synchronisation
  incrémentale des fills spot et perps, du funding et des mouvements du compte, bruts persistés pour
  dépasser la fenêtre d'historique conservée par l'API.
- Espace Trading : tableau de bord par compte Hyperliquid — équité, P&L net par période (réalisé
  brut − frais + funding), positions ouvertes, avoirs spot, derniers fills, réconciliation
  permanente de l'équité affichée à l'écran.
- Option « traiter le spot comme de l'investissement » sur un compte Hyperliquid : route ses fills
  spot vers le PRU de l'espace Investissement, contrepartie USDC convertie en euros au taux BCE du
  jour.
- Moteur Trading séparé du moteur d'investissement (`domain/trading`), jamais mêlé au PRU.
- Import CSV « pivot » (CSV Universal Koinly, ou export interne Koinly lu aussi par Waltio) dans des
  comptes dédiés de l'espace Investissement, multi-plateformes : dédoublonnage par hachage de
  contenu, ré-import idempotent, écran « À qualifier » partagé avec l'import Coinhouse.
- Virements internes appariés entre deux comptes (retrait sans produit et dépôt sans coût du même
  actif, fenêtre 72 h, écart ≤ frais réseau) : le coût d'acquisition voyage vers le dépôt, aucune
  plus-value fantôme ; correction manuelle et auto-vérification dans l'écran Comptes.
- Export « Format Koinly / Waltio (CSV) » (Réglages) : toutes les opérations de l'app au format CSV
  Universal, valeurs EUR déjà calculées, réimportable dans un autre outil.
- Calendrier de P&L dans Trading → Statistiques : P&L réalisé net par jour de clôture, navigation
  par mois, jour cliquable vers ses trades.

### Fixed

- **Calendrier de P&L : les gains et pertes tombaient au mauvais jour.** Tout le résultat d'un
  aller-retour était affiché le jour de sa clôture. Une position allégée sur plusieurs jours
  montrait donc 0 € les jours de prise de bénéfice puis tout d'un bloc le dernier jour, les frais et
  le funding d'une position encore ouverte n'apparaissaient nulle part, et le total du mois ne
  correspondait ni à votre plateforme ni au tableau de bord de l'application. Chaque montant est
  désormais daté du jour où il a été réalisé, et cliquer sur une journée détaille ce que chaque
  trade a réalisé **ce jour-là**.
- Un virement interne apparié à cheval sur deux jours (retrait le soir, dépôt le surlendemain)
  creusait un trou dans la courbe d'évolution : la valeur du portefeuille tombait à zéro puis
  revenait, alors que les coins n'avaient jamais quitté votre patrimoine.

### Changed

- **L'application est désormais organisée en deux espaces séparés** — « Investissement » (vos
  positions, votre PRU, vos plus-values) et « Trading » (vos aller-retours, votre P&L, votre
  journal) — reliés par une **Vue d'ensemble** qui additionne votre valeur nette. On additionne des
  soldes, jamais des résultats de nature différente : une plus-value spot et un P&L à levier ne se
  mélangent nulle part. Vos données de la version 1 sont reprises telles quelles, sans rien à
  refaire ; les anciens liens (`#/portfolio`, `#/report`…) continuent de fonctionner.

## [1.1.0] - 2026-08-23

### Added

- Écran « À qualifier » guidé : un choix cohérent avec les jambes de l'opération (récompense,
  dépôt, retrait, achat ou vente hors plateforme, échange, ou ignorer), un montant facultatif ou
  requis selon le choix, une qualification annulable à tout moment depuis le portefeuille.
- Table de libellés extensible (`row-types.ts`) avec des suggestions pré-sélectionnées pour les
  nouveaux types annoncés par Coinhouse en 2026 (staking, parrainage…), jamais appliquées sans
  confirmation.
- Section « Revenus (récompenses) » dans le portefeuille.
- Message dédié quand le fichier importé est l'« Export basique » Coinhouse (sans la contre-valeur
  en euros) plutôt que l'avancé, avec la marche à suivre.

### Changed

- Un libellé `Staking` seul n'est plus interprété automatiquement comme une récompense : Coinhouse
  ne l'a pas confirmé sur un export réel, il reste à qualifier (avec « Ignorer » suggéré).

## [1.0.0] - 2026-08-23

### Security

- Données d'exemple entièrement synthétiques : le jeu de démonstration (et fixture de tests) est
  désormais inventé par un générateur déterministe (`npm run fixture`) ; l'ancien export « anonymisé »,
  dérivé d'un export réel par une transformation réversible, est retiré du dépôt et de son historique.
- Chaîne d'approvisionnement : scripts d'installation npm désactivés et délai de 7 jours avant toute
  nouvelle version (`.npmrc`), même délai côté Dependabot, actions GitHub épinglées par empreinte de
  commit, ajout de CodeQL, de la revue des dépendances sur les pull requests et du Scorecard OpenSSF
  (badges dans le README).

### Changed

- ROI rapporté au capital maximal engagé (portefeuille : apports − retraits en euros à leur plus
  haut ; actif : achats − produits à leur plus haut) au lieu de « Σ achats », qui comptait plusieurs
  fois le même euro transitant par l'USDC et se diluait à chaque rachat (docs/DECISIONS.md n° 15).
- « Investi » ne couvre plus que les positions cotées (même périmètre que « Valeur », donc
  Latent = Valeur − Investi) ; le coût des actifs sans prix est annoncé à part.

### Fixed

- Moteur (audit + oracle indépendant) : une migration à coût reporté n'est plus comptée comme un
  achat et un produit ; les remises de frais sont converties au taux implicite des frais Coinhouse
  (plus de frais net négatif de quelques millièmes) ; à la même seconde, un échange qui produit du
  cash/stablecoin précède celui qui en consomme ; une migration depuis un actif à historique
  incomplet crée quand même l'actif reçu (coût 0, avertissement) ; les apports/retraits en euros
  d'une opération non appliquée ne sont plus comptés ; un actif entièrement « à qualifier » est
  signalé par le contrôle de solde ; une cotation sans date fiable est convertie au dernier taux
  BCE connu ; vendre une poussière d'un actif jamais détenu est un historique manquant, pas un
  arrondi.
- Exports CSV : arrondi au plus proche (demi vers le haut) comme à l'écran, quantités à 9
  décimales, prix et PRU à 10 (PEPE/BONK ne sont plus tronqués).
- Accessibilité : la liste des positions est une vraie liste de liens (plus de rôles de tableau
  incorrects sur des liens), avec des libellés lus par les lecteurs d'écran (quantité, prix, valeur,
  latent, réalisé, total) ; l'en-tête visuel de colonnes est décoratif.
- Logos des cryptos : chargement immédiat (plus de `loading="lazy"`, qui laissait les badges vides
  dans un onglet masqué) et un réessai automatique en contournant les caches avant de retomber sur
  les initiales ; les échecs restants sont listés dans le diagnostic copiable (URL et statut HTTP)
  pour identifier les blocages côté navigateur.

### Added

- Bouton « Rapport PDF » en tête de la carte Synthèse du portefeuille (il n'était proposé qu'en pied
  de page).
- Test de cohérence transversale (`tests/e2e/coherence.spec.ts`) : synthèse, lignes, positions
  clôturées, fiche actif, onglet Calcul, rapport, export CSV et graphique doivent donner les mêmes
  chiffres, à l'arrondi près ; rejouable localement sur un export réel.
- Amélioration continue : section « Vérifications automatiques » (cohérence comptable, lots,
  soldes, opérations à qualifier, prix, sauvegarde) avec rappel en pied de portefeuille ; oracle
  indépendant qui recalcule tout depuis le CSV ; signalement GitHub pré-rempli avec le diagnostic ;
  page « Nouveautés » (changelog dans l'application) et bandeau à chaque mise à jour ; page
  d'erreur avec « Réessayer » et diagnostic (erreurs récentes capturées) ; surveillance
  automatique toutes les 6 h du site en ligne et des API de prix avec issue ouverte/refermée
  automatiquement ; seuils de couverture bloquants.
- Qualité automatisée : tests de bout en bout Playwright (Chromium desktop et mobile, WebKit sur
  les parcours visuels) sur le build de production — démo, import par fichier, PRU comparés au
  moteur, fiche actif, exports CSV/PDF, sauvegarde → effacement → restauration, thème et mode
  discret, diagnostic, accessibilité axe (WCAG 2.2 AA) sur toutes les pages, manifeste/service
  worker/CSP sans erreur console, tout réseau externe stubé ; Lighthouse CI avec seuils ; tests de
  propriétés fast-check sur les invariants du moteur (total = valeur + produits − achats, PRU
  invariant à la vente, lots réconciliés, survente bloquée). La CI ne déploie que si tout est vert.
- Mode démo : « Essayer avec des données d'exemple » sur l'accueil charge l'export anonymisé du
  dépôt (chunk séparé, chargé à la demande) avec un bandeau « Données d'exemple (fictives) » et un
  bouton « Quitter la démo » ; importer un fichier, saisir une opération ou restaurer une sauvegarde
  efface d'abord les données fictives (préférences d'affichage conservées) ; sauvegardes préfixées
  `demo-`.
- Aide et retours : section dans les réglages (et sur la carte d'échec d'import) avec un diagnostic
  copiable qui ne contient ni montant ni quantité (version, commit déployé, navigateur, colonnes des
  fichiers importés, compteurs, statuts d'intégrité, libellés d'opérations inconnus) et un lien vers
  les gabarits de signalement GitHub (fichier non reconnu, bug, idée) ; `SECURITY.md`.
- Graphiques : couleur par zone — vert en gain, rouge en perte, avec bascule exacte au
  croisement de la référence (zéro pour le latent, capital investi pour la valeur, PRU pour le
  prix) ; PRU tracé en trait plein avec étiquette et zone gain/perte entre prix et PRU ; légende ;
  PRU et prix rappelés dans l'en-tête et l'infobulle ; « PRU vs prix » par défaut sur un actif.
- Bascule de thème clair / sombre / système dans la barre ; couleur de la barre du navigateur
  mobile suit le thème.
- Cartes « Évolution » (portefeuille et actif) : courbe reconstituée jour par jour à partir des
  quantités réellement détenues × prix historiques (Coinbase Exchange, Kraken, CoinGecko ; cache
  IndexedDB), périodes 1J · 1S · 1M · 3M · 1A · Tout, métriques valeur / latent € / latent % /
  PRU vs prix, performance de période hors apports, marqueurs d'achats/ventes, export CSV de la
  série.
- Exports CSV : positions, opérations normalisées avec PRU après chaque ligne, lots ouverts,
  historique d'un actif — dans la devise affichée (voir `docs/exports.md`).
- Devise d'affichage EUR/USD : chaque mouvement converti au taux de référence BCE de son jour
  (Frankfurter, sans clé, cache incrémental inclus dans la sauvegarde) ; prix actuels au dernier
  taux ; bascule dans la barre et les réglages.
- Vrais logos des cryptos (62 SVG, web3icons MIT / cryptocurrency-icons CC0), repli sur les
  initiales pour les tickers sans source libre.
- Import de l'export Coinhouse (CSV reçu par e-mail) : détection du format par en-têtes,
  opérations à deux jambes, migrations (delisting + migration), abonnements, ré-import idempotent.
- Moteur : PRU = coût moyen pondéré all-in invariant à la vente, lots au prorata,
  réalisé / latent / total par actif, ROI, net investi, contrôle de cohérence par la colonne
  « Solde », stablecoins en section à part.
- Écrans mobile-first façon eToro : portefeuille (investi / valeur / P&L total), détail par actif
  (historique avec PRU après chaque ligne, positions, « comment c'est calculé »), saisie manuelle,
  réglages, aide, confidentialité.
- Prix en direct (CoinGecko groupé, repli Coinbase), prix manuels, cache hors ligne.
- Sauvegarde / restauration JSON, export CSV pour Excel, mode discret, PWA installable avec
  invite de mise à jour, image Open Graph pour Discord.
- Rapport de portefeuille en PDF (page de garde, synthèse, répartition, positions ouvertes,
  stablecoins, positions clôturées, méthodologie), généré dans le navigateur avec jsPDF chargé à
  la demande ; vue imprimable `#/report` de repli (« Imprimer / Enregistrer en PDF »), mode discret
  respecté.
- Squelette : Vite 8 + Svelte 5 + TypeScript, lint/format/typecheck/tests, CI GitHub Actions avec
  déploiement sur GitHub Pages.
