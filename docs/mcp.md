# Serveur MCP local — interroger son portefeuille en langage naturel

> Livré le 26/08/2026 — décision de conception : [`docs/DECISIONS.md`](DECISIONS.md) n° 48.
> Chiffré dans [`proposals/2026-08-push-et-mcp.md`](proposals/2026-08-push-et-mcp.md) (option B).

## Ce que ça fait

Un petit serveur, lancé sur votre machine, qui permet à Claude (Code ou Desktop) — ou à tout
client compatible MCP — de **lire** votre portefeuille et de répondre à des questions du genre
« quel est mon PRU sur BTC ? », « combien de frais ai-je payés cette année ? », « que donnerait la
vente de la moitié de ma position à 90 000 € ? ».

**Rien ne quitte votre machine** : le serveur lit un fichier de sauvegarde de l'app, calcule avec
le même moteur, et répond. Il n'ouvre aucune connexion réseau — ni pour les cours, ni pour quoi que
ce soit d'autre.

## Mise en route

```bash
npm run mcp:build
```

Puis déclarez le serveur dans votre client. Pour Claude Code :

```bash
claude mcp add cout-revient -- node /chemin/vers/cout-revient-ch/mcp/dist/server.js /chemin/vers/sauvegarde.json
```

La sauvegarde est celle que produit l'app : **Réglages → Télécharger une sauvegarde**, ou mieux, le
dossier de **sauvegarde automatique** (Chrome et Edge sur ordinateur), réécrit à chaque
modification — le serveur relit le fichier à chaque question, vos réponses suivent donc l'app sans
rien relancer.

Le chemin peut aussi passer par la variable d'environnement `CRCH_BACKUP`.

## Les outils

| Outil              | Ce qu'il rend                                                            |
| ------------------ | ------------------------------------------------------------------------ |
| `get_portfolio`    | Valeur, investi, réalisé, latent, ROI, et une ligne par position         |
| `get_position`     | Détail d'un actif : quantité, PRU, valeur, plus-values                   |
| `get_insights`     | Les [constats](insights.md) : frais, concentration, rendement…           |
| `get_subscription` | Offre Coinhouse déduite de l'export et sa rentabilité réelle             |
| `list_alerts`      | Règles d'alerte, seuils en euros, état d'armement, expiration            |
| `simulate_sell`    | Produit net, résultat réalisé, PRU restant — **aucun ordre n'est passé** |
| `simulate_buy`     | Quantité acquise, frais, nouveau PRU — **aucun ordre n'est passé**       |

Tous sont annotés `readOnlyHint` et `destructiveHint: false` dans le protocole : un client qui
respecte ces annotations sait qu'aucun appel ne peut rien modifier.

## Trois garde-fous

**Lecture seule, par construction.** Il n'existe aucun chemin d'écriture dans le serveur : pas de
fonction qui modifie l'état, pas de fonction qui passe un ordre. Un test échoue si un outil dont le
nom évoque une écriture apparaît.

**Provenance dans chaque réponse.** Chaque appel renvoie la date de la sauvegarde lue et celle des
cours utilisés, avec la mention « ce serveur ne consulte aucune source en ligne ». Un chiffre juste
hier, présenté comme actuel, est un chiffre faux — c'est le principal risque de ce genre d'outil, et
la réponse le désamorce d'elle-même.

**Ni conseil, ni fiscalité déguisée.** Les constats sont rendus tels quels avec leur avertissement,
et `simulate_sell` rappelle que la plus-value imposable en France suit la méthode globale de
l'article 150 VH bis, différente du résultat réalisé qu'il affiche.

## Comment c'est construit

```
mcp/state.ts    lecture + validation de la sauvegarde, rejoue le pipeline de l'app
mcp/tools.ts    registre d'outils PURS (une fonction par outil, testable sans processus)
mcp/server.ts   transport stdio : JSON-RPC 2.0, une ligne par message
```

**Aucune dépendance.** Le transport est écrit à la main : la surface utile du protocole tient en
trois méthodes (`initialize`, `tools/list`, `tools/call`, plus `ping`), et ce projet paie assez cher
sa vigilance sur la chaîne d'approvisionnement npm pour ne pas y ajouter un arbre de dépendances au
profit d'un outil annexe. C'est le même arbitrage que l'anneau SVG écrit à la main plutôt qu'une
bibliothèque de graphiques.

**Mêmes fonctions que l'app**, pas une réimplémentation : `mcp/state.ts` rejoue l'assemblage du
grand livre, l'appariement des virements et `computePortfolio`. Il n'existe donc pas de « calcul du
MCP » susceptible de diverger de l'écran.

**Pourquoi un build** alors que Node 24 exécute TypeScript nativement : `src/lib` importe sans
extension de fichier (`./money`), ce que le résolveur ESM de Node refuse. Plutôt que d'imposer des
extensions à toute l'app pour le confort d'un outil annexe, `npm run mcp:build` regroupe le tout en
un fichier autonome avec Vite — déjà une dépendance du projet.

**Version du protocole** : le serveur annonce `2025-06-18` et sait aussi parler `2025-03-26` et
`2024-11-05`. Si un client demande une version inconnue, le serveur répond la sienne et laisse le
client décider — c'est la règle de négociation de la spécification.

## Ce que ça ne fait pas

Pas de cours frais (aucun réseau), pas de repère « mêmes apports en BTC » ni de mesures de risque
(elles exigent l'historique quotidien des prix, que seul l'écran Rapport charge), pas d'estimation
fiscale (même raison), et aucune écriture. Pour tout cela, l'app reste la référence.

## Ce qui est vérifié

- `mcp/tools.test.ts` — chaque outil est en lecture seule et publie un schéma exploitable ; chaque
  réponse porte sa provenance ; les totaux sont ceux du moteur ; un actif inconnu, une quantité hors
  position et un barème de frais inventé produisent une erreur d'outil explicite plutôt qu'un
  résultat approximatif.
- Épreuve de bout en bout (poignée de main réelle sur stdio) : négociation de version, `tools/list`,
  `tools/call` avec contenu structuré, outil inconnu en erreur de protocole, repli sur version
  inconnue, et `stdout` ne contenant que des messages MCP.
