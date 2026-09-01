# Réaudit de l'étude d'état de l'art contre la 2.15.0

> Question traitée : « L'étude du 31/08/2026 a été écrite contre la 2.12.0, sans voir 49 commits
> déjà fusionnés. Que reste-t-il de ses constats et de ses propositions ? »

_Établi le 01/09/2026 contre `main` à la 2.15.0. Les faits sont marqués **vérifié** (remesuré par moi
dans le dépôt ce jour) ou **sourcé** (constaté pendant l'audit, preuve citée). Les propositions
survivantes sont renumérotées **P75-P94** : la plage P52-P73 de l'étude d'origine était entièrement
occupée, et P74 l'est aussi (décision n° 69). Statut : **proposition**._

---

## 1. Pourquoi ce réaudit

L'étude du 31/08 a été menée sur une copie locale restée à la 2.12.0, alors que `main` était déjà à
la 2.15.0. Quarante-neuf commits manquaient — et pas des moindres : traçabilité « pourquoi ce
chiffre », réconciliation en liste d'actions, format de sauvegarde versionné, second avis sur un
export concurrent, veille réglementaire compilée, 3916-bis, serveur MCP publié en actif de release,
harnais d'ancrage anti-hallucination, BYOK et récit narratif étiqueté IA, qualification assistée des
fichiers inconnus.

Conséquence directe : **la numérotation était caduque et une partie des constats périmée**. Ce
document remplace l'étude sur ces deux points ; ce qu'il ne contredit pas reste valable.

## 2. Le constat central tient — et il s'est aggravé

L'étude affirmait que la vérification vise à côté du centre de gravité du code. Remesuré ce jour :

| Zone             | Source | Tests | Dans le périmètre de couverture ? |
| ---------------- | -----: | ----: | --------------------------------- |
| `src/lib/domain` |  8 675 | 7 576 | oui, seuil dédié à 90 %           |
| **`src/state`**  |  3 070 | **0** | **non**                           |
| **`src/routes`** |  9 484 | **0** | **non**                           |
| `src/components` |  8 290 |    85 | **non**                           |

`coverage.include` vaut toujours `['src/lib/**/*.ts']` (`vite.config.ts`, **vérifié**). La zone hors
mesure est passée de **17 477 à 20 844 lignes** — elle a grossi de 3 367 lignes en 49 commits, sans
qu'aucun seuil ne s'en aperçoive. `app.svelte.ts` est passé de 2 051 à **2 315 lignes** et de 36 à
38 `$derived`.

Le diagnostic n'est donc pas seulement toujours vrai : **l'écart se creuse à la vitesse où le produit
avance**. C'est ce qui justifie de traiter P79 (périmètre de couverture) avant tout le reste — c'est
un instrument de mesure, pas une correction.

## 3. Ce que le réaudit change vraiment

### 3.1 Trusted Types passe de confort à nécessité

C'est le seul reclassement majeur, et il vient d'une livraison de l'étude qu'on ignorait.

La décision n° 69 (BYOK) a inscrit `https://api.anthropic.com` dans la table des origines avec
`use: 'connect'` (`src/lib/support/csp.ts:142`, **vérifié**). La CSP étant **statique et injectée au
build**, cette origine est autorisée pour **tous les utilisateurs**, y compris ceux qui ne colleront
jamais de clé : le consentement par usage vit dans le code applicatif, pas dans la politique.

Avant cette livraison, une faille XSS n'avait pratiquement nulle part où exfiltrer — les origines
autorisées étaient des API de prix qui n'acceptent pas de charge utile arbitraire. Elle dispose
désormais d'un **point d'entrée générique acceptant un POST de contenu libre**. La dernière classe de
XSS DOM devient donc une vraie surface, alors qu'elle était théorique le 31/08.

Le coût de conformité, lui, n'a pas bougé : `{@html}` et `innerHTML` restent absents de tout `src`,
et `require-trusted-types-for` est Baseline depuis février 2026. C'est cher payé de ne pas le faire.

### 3.2 Le vecteur MCP était mal nommé, et il est pire que décrit

L'étude parlait de « libellés, mémos et noms de plateforme ». Vérification : le vecteur exact est
`mcp/tools.ts:237`, où l'outil `list_alerts` renvoie `note: rule.note` — **du texte libre saisi par
l'utilisateur**, sans neutralisation. S'y ajoute `p.asset` (`tools.ts:63`), un code d'actif qui peut
provenir d'un import tiers.

Le premier est plus direct que ce que l'étude décrivait : il n'y a même pas besoin d'un fichier
hostile, une note d'alerte suffit. Le produit reste protégé par construction sur deux des trois
branches de la _lethal trifecta_ (serveur en lecture seule, sans réseau) ; la troisième est ouverte.

### 3.3 Deux propositions sont livrées, quatre le sont à moitié

- **Livrées** : la barrière du BLS (décision n° 72, livrée par cette même session) et le renvoi
  3916-bis avec la note DAC8 (décision n° 62, `docs/declarations-fr.md`).
- **À moitié** : l'extraction des dérivations d'`app.svelte.ts` (la plupart délèguent déjà à des
  fonctions pures, mais `assembledEvents` et le tri des comptes gardent une logique inline) ;
  l'extension de la surveillance (le mécanisme a été refait, la **liste** des sources ne l'a pas
  été : Treasury, Fed, BEA, EIA et BLS, dont dépendent les générateurs, ne sont surveillés par
  aucun contrat) ; l'isolement des perpetuals (isolé **de fait**, puisque `frenchTax()` ne lit que
  `app.events` qui exclut le trading — mais rien ne le documente) ; la datation des taux (la veille
  réglementaire porte la source du PFU, mais `report-model.ts` exclut les entrées `in-force` du
  rapport, si bien que la citation n'apparaît jamais à côté du chiffre affiché).

Ces quatre-là ne disparaissent pas : elles rétrécissent, et leur formulation change.

### 3.4 Ce que l'étude disait de la concurrence et de l'IA est en partie dépassé

L'étude recommandait de ne pas ajouter de copilote IA hébergé, au nom de la promesse « rien ne quitte
le navigateur ». Cette promesse a été **délibérément réécrite** entre-temps (décision n° 69 : « et
l'application cesse de dire qu'elle n'envoie rien »), avec consentement par usage, étiquetage au sens
de l'article 50 de l'AI Act, et un harnais qui refuse tout chiffre que le moteur n'a pas produit
(décision n° 70). Le débat est tranché, dans un sens que l'étude n'anticipait pas, et avec des
garde-fous qu'elle aurait approuvés. **Sa recommandation sur ce point est caduque.**

Restent valables, sans changement : ne pas adopter `Temporal`, ne pas migrer vers TypeScript 7 ni
SvelteKit, ne pas remplacer `big.js`, ne pas courir la longue traîne DeFi, ne pas ajouter actions et
immobilier, ne jamais laisser un modèle calculer un chiffre affiché.

## 4. Les propositions, renumérotées

Vingt survivantes, cotées dans le barème du projet. Le tableau complet est en
[`ROADMAP.md`](../ROADMAP.md) § 3 quater ; ce qui suit est l'arbitrage.

**Faire d'abord, et sans discuter** : P76 (garde CSV, 0,25 session), P78 (`.gitignore`, 0,1) et P79
(périmètre de couverture, 0,5). Moins d'une session à elles trois, et P79 conditionne la mesure de
tout le reste.

**Puis la sécurité, qui a changé de nature** : P75 (Trusted Types) et P77 (texte libre du MCP). Le
§ 3.1 explique pourquoi le premier ne peut plus attendre.

**Puis le renversement de la vérification** : P80 à P85, dont P84 (extraction) qui reste le seul
chantier vraiment lourd et doit se faire en une fois, entre deux vagues de fonctionnalités.

**Enfin la pérennité et le fiscal** : P86 à P94. P89 (macro européenne) reste la seule proposition
qui élargit le périmètre plutôt que de consolider — c'est une décision de produit, pas de technique.

## 5. Ce que le réaudit n'a pas refait

- **La veille externe n'a pas été rejouée.** Les constats du 31/08 sur la concurrence, la fiscalité,
  le socle web et les sources de données datent de ce jour-là et n'ont pas été re-sourcés ici. Ils
  restent valables à quelques jours près, sauf sur le point d'IA traité au § 3.4.
- **Les limites assumées de l'étude d'origine tiennent toutes** : le texte intégral de la LFSS 2026
  n'a toujours pas été relu ligne à ligne, la qualification des perpetuals DeFi au regard de
  l'article 150 ter n'est tranchée par aucune source primaire, et le coût du clone profond à 50 000
  opérations reste déduit du code plutôt que mesuré — c'est l'objet de P83.
- **Aucune des 20 propositions n'a été implémentée ici.** Ce document est une remise à jour, pas une
  livraison.
