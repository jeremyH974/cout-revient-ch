# Réconciliation — écarts, trous et doublons, en liste d'actions

> P68, livré le 29/08/2026. Reprend le modèle de la décision n° 40 (moteur muet, texte français
> séparé, comme `insights.ts`) et la traçabilité paresseuse de la décision n° 61 : un item ne porte
> qu'une `TraceTarget`, jamais un `Trace` précalculé.

## Ce que ça fait

Un écran dédié (`#/reconciliation`, menu « Plus ») rassemble en **une seule liste, groupée par
sévérité**, tout ce qui rend les chiffres de l'app incertains ou incomplets : opérations non
qualifiées, actifs sans cours, écarts de solde (Coinhouse et Hyperliquid), virements sans
contrepartie, entrées ou sorties externes dont la fiscalité ne peut pas s'estimer, comptes sans
pays déclaré, et doublons candidats.

Chaque carte porte jusqu'à trois choses : le **constat**, sa **preuve** (le nombre de lignes/
événements cités, et un bouton « Pourquoi ce chiffre ? » quand une métrique du moteur s'y prête),
et un **bouton d'action** qui renvoie vers l'écran qui sait déjà régler le problème (Import,
Comptes, la fiche actif, Ajouter une opération) — cet écran n'en duplique aucun.

`Settings.svelte` / `SelfChecks.svelte` restent la vue **technique** (sauvegarde, PWA, fraîcheur
des prix) : celui-ci ne montre que ce qui est **actionnable sur les données**. C'est cette
séparation, pas une troncature arbitraire, qui évite de noyer l'utilisateur.

## Ce module ne recalcule rien

`src/lib/domain/reconciliation.ts` ne fait que PARCOURIR des rapports déjà calculés :

| Anomalie                         | Source                                              | Sévérité (typique) |
| -------------------------------- | --------------------------------------------------- | ------------------ |
| `unqualified-rows`               | `PortfolioReport.unqualified`                       | `fail`             |
| `balance-mismatch` (Coinhouse)   | `PositionReport.integrity`                          | `fail` / `warn`    |
| `balance-mismatch` (Hyperliquid) | `TradingAccountReport.reconciliation.gap`           | `fail`             |
| `unpriced-asset`                 | `PortfolioReport.totals.unpricedAssets`             | `warn`             |
| `external-inflow-no-cost`        | `TransferPairing.unpairedDeposits`                  | `warn`             |
| `price-gap-at-cession`           | `TaxLedger.cessions[].globalValueEur === null`      | `info`             |
| `unpaired-withdrawal`            | `TransferPairing.unpairedWithdrawals`               | `warn`             |
| `unpaired-deposit`               | `TransferPairing.unpairedDeposits`                  | `warn`             |
| `external-outflow-unqualified`   | `TransferPairing.unpairedWithdrawals`               | `warn`             |
| `duplicate-candidate`            | construit (voir plus bas)                           | `warn`             |
| `account-missing-country`        | `DeclarationReport.accounts[].status === 'unknown'` | `info`             |
| `onchain-balance-gap`            | réservé, **jamais peuplé** (voir plus bas)          | —                  |

`unpaired-withdrawal`/`unpaired-deposit` (un item par virement, action « Apparier ou valoriser »)
et `external-inflow-no-cost`/`external-outflow-unqualified` (un item AGRÉGÉ, cadrage fiscal) lisent
les MÊMES listes : ce sont deux LECTURES différentes du même fait — la mécanique de l'appariement
d'un côté, le risque fiscal direct de l'autre — pas un doublon d'écran.

`unpairedDeposits`/`unpairedWithdrawals` sont **plus précis** que `TaxLedger.externalInflows` /
`externalOutflows` : ces derniers comptent tout dépôt/retrait sans valeur, y compris ceux qu'un
virement interne appariera ensuite ; les premiers excluent déjà les paires trouvées.

## Priorité et regroupement

Trois groupes, dans cet ordre — `PRIORITY`, déclarée une seule fois en tête de
`reconciliation.ts` (même modèle que `PRIORITY` dans `insights.ts`) :

1. **`fail`** — qualité des données : `unqualified-rows`, `balance-mismatch`. Tout le reste est
   faux tant que ce n'est pas réglé.
2. **`warn`** — risque fiscal direct (`external-inflow-no-cost`), puis prix (`unpriced-asset`),
   puis virements et doublons.
3. **`info`** — `price-gap-at-cession`, `account-missing-country` : rien d'urgent.

Deux items du même CODE peuvent porter des sévérités différentes selon la situation (un solde
Coinhouse `opening-balance-missing` reste `warn` quand un vrai `balance-mismatch` est `fail`) : la
sévérité groupe l'écran, `PRIORITY` ne fait que départager l'ordre à l'intérieur d'un groupe.

## Les doublons candidats

Le dédoublonnage du moteur est **exact** : deux lignes au contenu strictement identique partagent
la même clé et ne sont jamais comptées deux fois. Il ne rapproche jamais deux lignes
**équivalentes mais non identiques** — la même opération, entrée deux fois par deux chemins
différents (un import CSV et une saisie manuelle, deux comptes qui suivent en réalité le même
portefeuille…).

`duplicate-candidate` regroupe les mouvements qui portent un actif et une quantité sans ambiguïté
(achats/ventes contre une devise cash-like, récompenses, dépôts, retraits — les migrations, frais,
soldes d'ouverture et lignes à qualifier restent hors de cette règle) par **jour + actif +
quantité arrondie** (poussière d'arrondi entre plateformes tolérée).

**Un doublon n'est signalé QUE si les deux lignes viennent de comptes différents ou de sources
d'import différentes** (`EventBase.source`). Deux achats identiques le même jour, sur le même
compte, importés de la même façon, sont un achat programmé légitime — c'est ce qui élimine la
classe entière de faux positifs.

**Jamais de suppression automatique.** L'action est toujours `review-duplicate` : l'utilisateur
confirme ou écarte depuis l'écran, ce qui écrit dans `app.state.duplicateOverrides` (même forme
que `transferOverrides`, décision n° 25) — une paire déjà tranchée n'est plus reproposée, mais
**aucune ligne n'est jamais retirée des données**.

## Le type partagé avec P62

`src/lib/domain/gap.ts` (`ValueGap`, `buildValueGap`) est un module à part, réutilisable tel quel
par un futur second avis sur un export concurrent (P62) : il compare NOTRE chiffre à un autre,
sans savoir d'où vient l'autre (`GapSource`), et sans savoir pourquoi comparer (ça, c'est
`reconciliation.ts`). `buildValueGap` renvoie `null` quand les deux côtés concordent (à une
tolérance près), porte l'écart signé `ours − theirs` quand les deux divergent, et laisse `delta`
à `null` quand un seul des deux côtés est renseigné.

## Trois arbitrages explicites

1. **`price-gap-at-cession` est livré en `info`, action `none`.** Il n'existe aucun écran pour
   annoter la valeur globale du portefeuille à une date passée, et cette limite est nommée ici
   plutôt que comblée par un écran ad hoc pour cette seule anomalie.
2. **`onchain-balance-gap` n'apparaît nulle part à l'écran.** Le code, sa `GapSource` réservée
   (`kind: 'onchain-balance'`) restent déclarés pour que le type soit prêt, mais aucune règle ne
   le peuple : l'import on-chain ne lit que des **mouvements**, jamais un **solde courant** à
   comparer. Une fonctionnalité qui fait semblant d'exister est pire qu'une absente.
3. **Le déclencheur « Pourquoi ce chiffre ? » n'enveloppe pas un montant.** Sur la fiche actif
   (P61), le déclencheur EST le chiffre déjà affiché. Ici, un item existe souvent PARCE QUE le
   chiffre manque (pas de cours, pas de coût) : il n'y a rien à envelopper. Le bouton porte donc
   son intitulé en clair (« Pourquoi ce chiffre ? »), avec une cible ≥ 24 px par le remplissage du
   bouton plutôt que par un montant cliquable — même but (WCAG 2.2 `target-size`), forme différente
   parce que le contexte diffère.

## Comment c'est construit

```
src/lib/domain/gap.ts             ValueGap, buildValueGap — type partagé avec P62
src/lib/domain/reconciliation.ts  règles pures → ReconciliationItem[] (codes, valeurs typées)
src/lib/format/reconciliation.ts  rendu français — deux `switch` exhaustifs (code, action.code)
src/state/checks.svelte.ts        assemble le contexte (`dataReconciliation`, EN EUROS)
src/routes/Reconciliation.svelte  écran : cartes groupées par sévérité, WhySheet, actions
```

**Le moteur ne parle aucune langue.** `values: Record<string, InsightValue>` réutilise le
vocabulaire d'`insights.ts` (`money`, `ratio`, `count`, `assets`, `day`, `tier`, `year`) : aucun
nouveau type n'a été ajouté. Ajouter une anomalie = une règle dans `reconciliation.ts`, son code
dans `ReconciliationCode`, son rang dans `PRIORITY`, sa phrase dans `format/reconciliation.ts` — le
compilateur exige les trois.

**Toujours en euros.** `dataReconciliation` lit `app.eurReport` / `app.events`, pas la devise
d'affichage : une `TraceTarget` posée ici est résolue plus tard par `app.trace()`, qui travaille
aussi en euros (décision n° 61) — les deux world-views ne peuvent pas diverger.

**Nommage** : `ChecksState.dataReconciliation` (P68) et `ChecksState.reconciliation` (décision
n° 55, le pont apports nets ↔ patrimoine) sont deux choses différentes, toutes deux appelées
« réconciliation » ailleurs dans le projet — d'où le préfixe `data`.

## Tests

- `domain/gap.test.ts` — tolérance, trichotomie (manque chez nous / chez eux / les deux
  divergent), `null` quand ça concorde.
- `domain/reconciliation.test.ts` — une entrée par code, cas présent et cas absent ; deux achats
  identiques le même jour sur le même compte ne produisent aucun doublon, deux comptes différents
  en produisent un ; ordre déterministe ; `summarizeReconciliation`.
- `domain/reconciliation.property.test.ts` (fast-check) — pas de preuve fantôme (toute `rowKeys`/
  `eventIds` citée existe dans l'entrée), toute `TraceTarget` produite se résout sans lever via le
  vrai moteur, déterminisme, ordre.
- `format/reconciliation.test.ts` — chaque code produit une phrase complète, chaque action un
  intitulé (sauf `none`), le mode discret masque montants ET quantités sans effacer les compteurs
  (un prix comparé, lui, reste lisible).
- `tests/e2e/reconciliation.spec.ts` — l'écran comparé au moteur ; route ajoutée à
  `tests/e2e/a11y.spec.ts`.

## Ce que ça ne fait pas

Pas de suppression automatique de ligne, pas de correction silencieuse d'un montant, pas de solde
on-chain (voir l'arbitrage 2), pas d'écran pour annoter une valeur globale de portefeuille passée
(voir l'arbitrage 1). Un item **constate**, il ne corrige jamais vos données à votre place — même
principe que les constats de la décision n° 40.
