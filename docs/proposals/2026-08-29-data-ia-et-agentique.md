# Data, IA et agentique — ce que font les meilleurs, et ce qu'il faut construire

> Étude du 29/08/2026. Veille en ligne sourcée (quatre sweeps parallèles : concurrents directs,
> concurrents indirects, état de l'art technique, douleurs terrain).
> **Aucune ligne de code n'est modifiée par ce document** : c'est une proposition, à arbitrer.
> Numérotation P61+ pour ne pas heurter la série existante (P1–P51).

## 0. La ligne directrice, avant toute proposition

Le premier actif de ce produit n'est pas une fonctionnalité, c'est **la crédibilité de ses
chiffres** — moteur `Big`, oracle indépendant, auto-vérifications visibles, 60 décisions écrites.
La douleur n° 1 du marché est précisément l'inverse : des utilisateurs de Koinly décrivent en
août 2026 des soldes aberrants et des historiques faux sur cinq ans
([Trustpilot, 11 et 15/08/2026](https://www.trustpilot.com/review/koinly.io)).

Le risque de cette étude est donc symétrique de son intérêt : **une IA mal placée détruirait
l'actif qu'elle prétend valoriser.** Le développeur de Firefly III a d'ailleurs renoncé
publiquement à l'IA sur des chiffres comptables, jugeant impossible d'en obtenir un résultat fiable
([docs Firefly III, accès direct 403 — à recouper](https://docs.firefly-iii.org/references/faq/firefly-iii/general/)).

D'où la règle qui commande tout ce qui suit, et qui prolonge la décision n° 40 (« les constats sont
produits par des règles pures et CODÉES ; le français est un rendu ») :

> **L'IA n'entre jamais dans le calcul. Elle entre dans la compréhension, la qualification et la
> distribution.** Trois usages, trois garde-fous : elle *rend* du JSON déjà calculé, elle *propose*
> un appariement qu'un vérificateur déterministe valide, elle *transporte* une réponse dont chaque
> nombre vient du moteur.

Corollaire architectural — et c'est le point stratégique de l'étude : **la structure actuelle du
projet est déjà celle qui rend l'IA sûre en finance.** Un moteur pur, des constats émis en JSON
typé (`insights.ts`), un registre d'outils purs pour le MCP (`mcp/tools.ts`), des auto-vérifications
qui savent dire qu'un chiffre est faux. Les concurrents ont bâti l'inverse (nuage, heuristiques
opaques, calcul vendu au forfait) : ils ne peuvent pas copier ce socle sans se renier.

---

## 1. Ce que fait le marché (constaté, daté, sourcé)

### 1.1 Concurrents directs — le mot « IA » couvre surtout des moteurs de règles

| Acteur | Livré | Annoncé |
| --- | --- | --- |
| **CoinTracker** | Recherche en langage naturel ; **serveur MCP en accès anticipé** (Claude/ChatGPT lisent holdings, performance, lots fiscaux) | Ouverture publique du MCP « bientôt » |
| **CryptoTaxCalculator** | Règles + IA sur l'« intention » d'une transaction (bridge, LP, staking, levier) ; [MetaMask Tax Hub](https://metamask.io/news/metamask-tax-hub-crypto-tax-calculator) (mars 2025) | Verrouillage d'exercices passés — statut incertain |
| **Blockpit** | Auto-classification par catégorie et pays, import auto du staking, **simulation de stratégies fiscales** ([blog, janv. 2025](https://blockpit.io/blog/product-update-01-2025)) | — |
| **Awaken Tax** | Étiqueter une transaction en catégorise automatiquement des dizaines de similaires ([CoinGecko Learn, 2025](https://www.coingecko.com/learn/awaken-tax-case-study)) | Réconciliation hybride règles + LLM **« en construction »** |
| **TokenTax** | Recoupement avec les explorateurs pour reconstituer un coût d'acquisition perdu ; renfort **humain** sur dossiers complexes | — |
| **Koinly** | Détection de transferts internes / coût manquant / anomalies — **allégation de tiers, non retrouvée sur koinly.io** | — |
| **Waltio** (FR) | Rien en IA : automatisation d'import (700+ sources), 2086 et 3916-bis | IA « envisagée » — **conditionnel, non confirmé par Waltio** |
| **Divly** | Rien en IA : différenciation par **revue humaine experte** (dès 499 €) et formulaires locaux officiels | — |
| **CoinTracking, Coinpanda, Kryptos, ZenLedger** | Aucune IA documentée au-delà du slogan | — |

Le tax-loss harvesting reste partout une **visualisation de moins-values latentes avec seuils**,
jamais une exécution. Prix repères : Koinly 49–199 $/an facturés **par exercice fiscal**,
CoinTracker dès 199 $/an, CoinTracking 49–899 $/an.

### 1.2 Concurrents indirects — l'agentique est arrivée, en « apportez votre IA »

- **Finary a ouvert son serveur MCP en bêta le 22 août 2026** — lecture seule, révocable, données
  sensibles volontairement exclues en v1, et l'équipe l'écrit noir sur blanc : l'assistant ne peut
  rien modifier ni supprimer
  ([community.finary.com, 22/08/2026](https://community.finary.com/t/beta-le-mcp-finary-est-disponible-construisons-le-ensemble/39216)).
- **Kubera** connecte les données à *votre* ChatGPT/Claude/Gemini plutôt que d'héberger un modèle,
  et importe relevés PDF/CSV/captures par IA.
- **CoinStats** a livré un « AI Agent » de recherche crypto profonde
  ([ambcrypto, avril 2026](https://ambcrypto.com/coinstats-ai-agent-outperforms-gemini-claude-and-chatgpt-in-open-source-crypto-deep-research-benchmark/)) ;
  **Delta** explique les mouvements de prix au tap, avec quota mensuel ; **Zerion** a un Copilot en bêta.
- **Copilot Money** n'applique une catégorisation automatique **que si le score de confiance est
  suffisant**, et apprend des corrections
  ([doc officielle](https://help.copilot.money/en/articles/8182433-copilot-intelligence-for-spending)).
- **Origin** a fait **enregistrer son conseiller IA auprès de la SEC**
  ([businesswire, 09/09/2025](https://www.businesswire.com/news/home/20250909759834/en/)) : quand on
  franchit la ligne du conseil, on l'assume et on se fait encadrer.
- Côté local-first : **Rotki, Ghostfolio, Portfolio Performance, Actual Budget — rien en IA.**
  Maybe Finance a livré la lecture IA de reçus puis **archivé son dépôt le 27/07/2025**.

### 1.3 Douleurs terrain — la confiance d'abord, la fiscalité ensuite

| Douleur | Ce qu'en disent les sources |
| --- | --- |
| **Soldes et PRU faux** | Koinly : 270 litecoins affichés pour 20 détenus ; historique décalé sur cinq ans ([Trustpilot, 08/2026](https://www.trustpilot.com/review/koinly.io)) |
| **Coût d'acquisition perdu** | CoinTracker perd le coût quand un virement entre wallets est classé « envoi » plutôt que « transfert interne » ([support CoinTracker](https://support.cointracker.io/hc/en-us/articles/12028451053713-Troubleshoot-missing-price-history-errors)) |
| **Support absent quand le calcul casse** | Chat « live » répondant sous 24 h ; erreurs bloquantes non résolues chez CoinTracking |
| **Abonnement au volume** | Jusqu'à 179 €/an chez Koinly ; un concurrent bâtit tout son marketing contre le « piège de l'abonnement » |
| **Export Coinhouse fragile** | Le support Coinhouse documente lui-même qu'ouvrir ou renommer le CSV peut le rendre illisible ; Waltio demande de **décaler manuellement d'une minute** les horodatages identiques ([support Coinhouse](https://support.coinhouse.com/hc/fr/articles/4410163290386-Comment-exporter-l-historique-de-ses-transactions), [aide Waltio](https://help.waltio.com/en/articles/5177093-coinhouse-file)) |
| **3916-bis** | Tout compte crypto à l'étranger se déclare **sans seuil**, même vide ou clos : **1 500 €/compte/an**, 10 000 € en juridiction non coopérative, prescription 10 ans ([socic.fr](https://www.socic.fr/ressources-comptabilite/articles/impots-2026-cochez-la-rubrique-comptes-a-letranger-crypto-formulaires-3916-3916-bis-pour-eviter-un-controle-fiscal)) |
| **DAC8** | Collecte obligatoire des PSCA **depuis le 01/01/2026**, premier échange automatique au plus tard le **30/09/2027** sur les opérations 2026 ; tout écart avec la déclaration devient un signal de contrôle ([bensaid-avocats.fr](https://www.bensaid-avocats.fr/dac8-et-carf-2026-fiscalite-crypto-reporting-et-fin-du-secret-fiscal/)) |
| **Staking et airdrops** | Doctrine non stabilisée : airdrop conditionné = BNC immédiat, airdrop aléatoire = à la cession |
| **« Patrimoine improductif »** | Amendement adopté en première lecture à l'Assemblée (163 c. 150) lors du PLF 2026 — impôt possible sur la **détention** ([amendement CF1520](https://www.assemblee-nationale.fr/dyn/17/amendements/1906A/CION_FIN/CF1520.pdf)). Sénat non tranché |

### 1.4 État de l'art technique — ce qui est réellement utilisable aujourd'hui

| Techno | Maturité au 29/08/2026 | Verdict pour ce projet |
| --- | --- | --- |
| **BYOK, appel navigateur direct** | L'API Anthropic accepte le CORS navigateur depuis le **23/08/2024** (`anthropic-dangerous-direct-browser-access`) | **Prêt.** Seule voie compatible « zéro backend » |
| **LLM narrateur + moteur déterministe** | Formalisé par Anthropic (*Building Effective Agents*, dépôt `anthropics/financial-services` : « l'IA rédige, l'humain valide ») | **Prêt.** C'est le pattern à suivre |
| **transformers.js v4** | Sortie le **09/02/2026**, runtime WebGPU réécrit, ~200 architectures | **Prêt pour tâches ciblées** (classification, similarité), pas pour du conversationnel |
| **Chrome Prompt API (Gemini Nano)** | Stable depuis Chrome 138, mais **desktop seulement**, ≥ 22 Go de disque libre, > 4 Go VRAM, ni Android ni iOS, ni Firefox ni Safari | **Amélioration progressive uniquement.** Jamais une dépendance |
| **WebLLM / MLC** | Techniquement prêt, ~80 % de la perf native | Téléchargement de centaines de Mo : consentement explicite obligatoire |
| **WebNN** | Candidate Recommendation W3C le **22/01/2026**, origin trial Chrome seul, production visée 2027 | **À ignorer** |
| **MCP Apps** (UI pilotée par le serveur) | Standard publié le **26/01/2026**, supporté ChatGPT, Claude, VS Code, Goose | Prêt — mais suppose un serveur MCP, donc la voie locale |
| **MCP distant / connecteur hébergé** | Suppose un processus serveur | **Impossible sans trahir la promesse.** Le MCP local est la bonne réponse |
| **DuckDB-WASM multi-thread** | Exige COOP/COEP, que **GitHub Pages ne permet pas** | Inutile ici : `Big` en mémoire suffit à ce volume |
| **AI Act, article 50** | Obligations de transparence **applicables depuis le 02/08/2026** ; marquage lisible par machine, délai de grâce jusqu'à déc. 2026 pour l'existant | Tout texte généré devra être **étiqueté visiblement** |

---

## 2. Les gaps — ce que personne ne fait

1. **Prouver l'exactitude.** Tout le monde l'affirme, personne ne la démontre. Aucun acteur ne
   publie de jeu d'épreuves vérifiable, ni de second avis sur ses propres chiffres.
2. **Expliquer une classification automatique.** Aucune source ne montre un score de confiance ni
   une justification lisible à côté d'une transaction classée par IA — y compris chez ceux dont
   l'IA de classification est la mieux documentée. Seul Copilot Money, hors crypto, le fait.
3. **Remonter d'un total jusqu'aux lignes brutes.** Le « pourquoi ce chiffre » n'existe nulle part,
   alors que c'est exactement la question que pose un utilisateur qui doute de son solde.
4. **Un rapport narratif.** « Votre année crypto en français » : cas d'usage évident, peu coûteux,
   **introuvable chez tous les acteurs du périmètre**.
5. **Combiner réconciliation intelligente et conformité fiscale locale.** Les Anglo-Saxons ont l'IA
   sans le 2086 ; les Français ont le 2086 sans l'IA. **Personne n'a les deux.**
6. **L'agentique sans compte.** Finary et CoinTracker exposent un MCP — mais adossé à *leur* nuage
   et à *leur* compte. Un MCP local, sans compte, sans réseau, n'existe que dans ce projet.
7. **Les angles fiscaux orphelins** : 3916-bis, régime propre des récompenses, option barème
   progressif, veille sur les textes en cours.
8. **Le local-first n'a pas d'IA du tout.** Rotki, Ghostfolio, Portfolio Performance : néant. Le
   créneau « local-first *et* IA » est vide.

## 3. Les moats — ce qui reste défendable après copie

| Moat | Pourquoi c'est défendable |
| --- | --- |
| **M1 — L'exactitude prouvable** | Un banc d'essai public et synthétique, que n'importe qui rejoue, y compris un concurrent. Celui qui le publie devient la référence citée. Un éditeur qui *vend* le calcul ne peut pas être l'arbitre neutre : **la gratuité et l'absence de compte sont ici un avantage structurel, pas un renoncement** |
| **M2 — L'agentique locale sans compte** | Finary et CoinTracker exposent leur nuage ; ce projet expose une machine. Le jour où un client MCP grand public s'installe partout, « mes chiffres sans jamais les envoyer » devient un argument que le modèle économique des concurrents leur interdit |
| **M3 — La conformité française fine et datée** | 150 VH bis, 2086, DAC8, 3916-bis, millésimes de taux, chaque hypothèse écrite et testée. Coûteux à constituer, facile à maintenir une fois là, invisible pour qui n'a pas déjà le moteur |
| **M4 — La traçabilité d'un chiffre** | Chaque montant renvoie aux lignes brutes qui l'ont produit, avec la source et la date du prix. C'est l'antidote exact à la douleur n° 1 — et le socle qui rend toute citation d'IA vérifiable |

**Les synergies déjà en place** (c'est ce qui rend le plan bon marché) : les constats émettent déjà
du **JSON typé** → le narrateur IA est un simple rendu de plus (n° 40). Le MCP a déjà un **registre
d'outils purs** → l'assistant intégré réutilise exactement les mêmes fonctions (n° 48). Le
générateur de calendrier a déjà son **motif « instantané compilé + barrière »** → la veille
réglementaire s'y coule (n° 58). Les **auto-vérifications** sont déjà le vérificateur qui rend sûre
une proposition d'appariement faite par un modèle.

---

## 4. Propositions classées par ROI

Même barème que la feuille de route : Valeur, Fiabilité, Satisfaction sur 5 ; effort en sessions
(≈ 2–3 h, tests et vérification navigateur compris) ; ROI = (V + F + S) ÷ sessions.

| #        | Proposition                                                                 | V   | F   | S   | Sess. | ROI      | Gap / moat |
| -------- | --------------------------------------------------------------------------- | :-: | :-: | :-: | :---: | :------: | ---------- |
| **P66**  | **3916-bis déduit des comptes déjà saisis**                                 |  4  |  4  |  4  |   1   | **12,0** | Gap 7 · M3 |
| **P63a** | **Le MCP livrable sans build** (binaire de release + une ligne de commande) |  3  |  2  |  5  |   1   | **10,0** | Gap 6 · M2 |
| **P67**  | **Veille réglementaire compilée** (millésimes + textes en cours)            |  3  |  3  |  3  |   1   | **9,0**  | Gap 7 · M3 |
| **P61**  | **« Pourquoi ce chiffre ? » — traçabilité jusqu'aux lignes brutes**         |  5  |  5  |  4  |   2   | **7,0**  | Gap 3 · M4 |
| **P72**  | **Anti-verrouillage : format de sauvegarde documenté et versionné**         |  2  |  3  |  2  |   1   | **7,0**  | Douleur 4  |
| **P68**  | **Réconciliation : écarts, trous et doublons, en liste d'actions**          |  4  |  5  |  3  |   2   | **6,0**  | Gap 1 · M4 |
| **P62**  | **Second avis sur un export concurrent** (Koinly/CoinTracker/Waltio)        |  5  |  4  |  5  |  2,5  | **5,6**  | Gap 1 · M1 |
| **P70**  | **Harnais d'évaluation des fonctions IA + garde-fous testés**               |  2  |  5  |  1  |  1,5  | **5,3**  | Prérequis  |
| **P65**  | **« Votre année crypto » — rapport narratif étiqueté IA, en BYOK**          |  3  |  2  |  5  |   2   | **5,0**  | Gap 4      |
| **P64**  | **Qualification assistée des lignes inconnues** (IA locale, jamais un montant) |  5  |  4  |  4  |   3   | **4,3**  | Gap 2 · M4 |
| **P63b** | **MCP v2 : parité fonctionnelle + MCP Apps + compétence de domaine**        |  4  |  3  |  5  |   3   | **4,0**  | Gap 6 · M2 |
| **P73**  | **Banc d'essai public d'exactitude** (jeu synthétique, MIT, rejouable)      |  3  |  4  |  2  |  2,5  | **3,6**  | Gap 1 · M1 |
| **P69**  | **Assistant intégré** (BYOK, outils = les fonctions du moteur)              |  3  |  2  |  4  |   3   | **3,0**  | Gap 8      |
| **P71**  | **Version anglaise**                                                        |  2  |  1  |  2  |   2   | **2,5**  | Portée     |

Total : ≈ 25,5 sessions.

### Le détail des cinq qui comptent

**P61 — « Pourquoi ce chiffre ? »** Cliquer un PRU, un latent, un réalisé ouvre la chaîne complète :
les lignes brutes dédoublonnées qui l'ont produit, la jambe contrepartie retenue (règle d'or de
l'export), les frais, le prix retenu avec sa source et sa date. Zéro IA, zéro réseau — le moteur
conserve déjà les lots et les lignes. **C'est la brique la plus rentable de l'étude** : elle répond
seule à la douleur n° 1, et elle devient la cible de citation obligatoire de toute réponse d'IA
ultérieure. À faire avant toute fonction IA.

**P62 — Le second avis.** L'app importe déjà le format pivot Koinly/Waltio (décision n° 24). Il
manque l'écran qui *compare* : voici ce que votre outil payant annonce, voici ce que ce moteur
recalcule, voici les lignes où ça diverge et pourquoi. Un utilisateur qui paie 179 €/an et voit
270 litecoins au lieu de 20 a un besoin brûlant et aucune réponse. Positionnement : **l'auditeur
indépendant**, rôle qu'aucun vendeur de calcul ne peut tenir.

**P63a puis P63b — Le MCP, industrialisé.** Aujourd'hui il faut cloner le dépôt et lancer
`npm run mcp:build` : la meilleure fonctionnalité agentique du produit est hors de portée de son
public. **P63a** publie le `server.js` déjà bâti comme actif de release GitHub — un téléchargement,
une ligne `claude mcp add`, aucun paquet npm publié, aucune surface de chaîne d'approvisionnement
ajoutée (décision n° 13 préservée). **P63b** comble ensuite les trous documentés (ni cours frais, ni
risque, ni fiscalité, ni repère), expose les écrans en **MCP Apps** (standard du 26/01/2026), et
livre une **compétence de domaine** qui enseigne au client la distinction PRU / 150 VH bis — sans
elle, l'assistant confondra les deux et inventera une méthode.

**P64 — La qualification assistée, et son garde-fou.** Le modèle ne voit **jamais un montant** : il
reçoit des *en-têtes de colonnes* et des *libellés de types d'opération* inconnus, et propose un
appariement vers le schéma pivot. Cette proposition est ensuite **vérifiable par construction** :
on rejoue le moteur, et l'écart de solde, l'invariant comptable et le compteur de lignes non
qualifiées disent s'il est bon. Score de confiance affiché, jamais appliqué sans confirmation sous
le seuil (motif Copilot Money). Repli intégral sur les heuristiques actuelles si aucun modèle n'est
disponible. Ordre de préférence : `transformers.js` local → Prompt API si présente → BYOK → rien.

**P65 — Le rapport narratif.** Le LLM ne reçoit **que le JSON des constats déjà calculés**, jamais
une transaction. Il rédige un texte français, étiqueté « généré par IA » comme l'exige l'article 50
de l'AI Act depuis le 02/08/2026, avec la même frontière que les constats : il décrit, il ne
recommande pas (doctrine AMF du 04/08/2026, déjà citée dans `docs/insights.md`). Un test échoue si
le texte contient un nombre absent du JSON d'entrée.

---

## 5. Ordre d'exécution recommandé

Le ROI brut ne fait pas l'ordre : l'urgence fiscale, les dépendances et le risque le corrigent.

**Vague 1 — avant la saison déclarative (3 sessions) : P66, P67, P63a.**
Les opérations 2026 sont les **premières recoupées par DAC8** (échange au plus tard le 30/09/2027) :
la fenêtre d'anxiété est le printemps 2027, il faut y arriver équipé. P66 et P67 sont courts et
purement déterministes. P63a débloque un actif déjà payé.

**Vague 2 — le moat de confiance (5,5 sessions) : P61, P68, P72.**
P61 d'abord : c'est la cible de citation de tout le reste. P68 transforme les auto-vérifications en
liste d'actions. P72 verrouille l'argument anti-abonnement.

**Vague 3 — l'IA, dans cet ordre strict (8,5 sessions) : P70, P65, P64, P63b.**
**P70 en premier, sans exception** : pas une ligne d'IA livrée sans son harnais d'évaluation
(jeu de questions de référence, assertion « aucun nombre hors du JSON source », cas de refus
contrôlé). Puis P65, le moins risqué et le plus visible. Puis P64, qui touche l'import — donc
seulement une fois le harnais éprouvé. Puis P63b.

**Vague 4 — le moat public (5 sessions) : P62, P73.**
P62 est un acte de positionnement autant qu'une fonctionnalité : à décider en connaissance de cause.
P73 le rend incontestable.

**Hors vagues** : P69 et P71 selon l'audience réelle du Discord.

---

## 6. Ce qui n'est pas recommandé

- **Un LLM à moins d'un pas d'un nombre calculé.** Pas de recalcul, pas d'arrondi, pas
  d'agrégation par un modèle. La leçon Firefly III est publique et coûte cher à réapprendre.
- **La Prompt API de Chrome comme brique requise** : desktop seulement, ≥ 22 Go de disque libre,
  ni Android ni iOS ni Firefox ni Safari. Amélioration progressive, ou rien.
- **WebLLM chargé par défaut** : des centaines de mégaoctets contre une promesse de PWA légère.
  Consentement explicite, écran dédié, ou rien.
- **WebNN** : production visée 2027, aucune portabilité aujourd'hui.
- **DuckDB-WASM multi-thread** : GitHub Pages ne pose pas d'en-tête COOP/COEP, et le contournement
  par service worker est fragile. Le volume réel ne le justifie pas.
- **Un connecteur MCP distant hébergé** : il faudrait un serveur. Le MCP local est la réponse, et
  elle est déjà écrite.
- **Le tax-loss harvesting automatisé, tout score « acheter / vendre », toute prédiction de prix.**
  Aucun acteur sérieux ne l'automatise, et la ligne MiFID II / doctrine AMF reste nette : décrire
  est libre, recommander est réglementé.
- **Envoyer des transactions brutes à un modèle tiers, même avec l'accord de l'utilisateur.** Le
  JSON des constats suffit à tout ce qui est proposé ici.
- **Un compte, une télémétrie, un nuage** — inchangé depuis la décision n° 1.

## 7. Ce que vous devez décider

1. **La question stratégique : le BYOK est-il acceptable ?** P65 et P69 supposent qu'un utilisateur
   *choisisse* d'envoyer ses **chiffres agrégés** (jamais ses lignes) à sa propre clé API. C'est une
   nuance réelle de la promesse « rien ne quitte le navigateur ». Trois options : le refuser (et
   renoncer à P65/P69), l'accepter avec un consentement par usage et un **aperçu exact de ce qui
   part**, ou le limiter au strict local (`transformers.js`, Prompt API) — auquel cas P65 devient
   pauvre et P64 reste faisable.
2. **Le positionnement « second avis » (P62)** est frontal envers Koinly, Waltio et CoinTracker.
   Assumé ou non ?
3. **Publier un banc d'essai (P73)** invite l'examen public — c'est l'objectif, mais c'est un
   engagement de maintenance.
4. **Le régime des récompenses et l'option barème progressif** (trous connus de `docs/tax-fr.md`) :
   les traiter, ou continuer à les signaler explicitement comme non traités.
5. **Faire relire P66 et P67 par un professionnel** avant publication, comme P13 en son temps.

## 8. Fiabilité de cette étude

Sources primaires et vérifiées : Finary MCP (22/08/2026), Copilot Money, Origin/SEC (09/09/2025),
Blockpit (janv. 2025), MetaMask × CryptoTaxCalculator (mars 2025), Sharesight (déc. 2025), Maybe
Finance (27/07/2025), Chrome Prompt API, transformers.js v4 (09/02/2026), WebNN (22/01/2026), MCP
Apps (26/01/2026), CORS Anthropic (23/08/2024), AI Act art. 50 (02/08/2026), Légifrance 150 VH bis,
amendement CF1520, supports Coinhouse et Waltio, Trustpilot Koinly (08/2026).

**À recouper avant d'en tirer une décision** : la page produit CoinTracker et la doc Firefly III
(403 à l'accès direct, contenu reconstitué par extraits) ; les allégations d'IA prêtées à Koinly,
DeBank, Monarch, Empower et ZenLedger (sources secondaires uniquement) ; la roadmap IA de Waltio
(conditionnel de tiers) ; la présomption de résidence fiscale au-delà de 250 000 € (une seule
source) ; le format exact d'un paquet MCP installable, à revérifier au moment d'implémenter P63a.
