# Traçabilité — « Pourquoi ce chiffre ? »

> P61, livré le 29/08/2026 — décision de conception : [`docs/DECISIONS.md`](DECISIONS.md) n° 61.
> Issu de l'étude [`proposals/2026-08-29-data-ia-et-agentique.md`](proposals/2026-08-29-data-ia-et-agentique.md)
> (§ P61). **Zéro IA, zéro réseau** : le moteur conservait déjà tout ce qu'il faut.

## Ce que ça fait

Sur la fiche actif, **le montant lui-même est cliquable**. Il ouvre une feuille qui déroule la
chaîne complète du chiffre : la formule, les lots encore détenus, les opérations qui les ont
ouverts, **la jambe contrepartie retenue**, et enfin les **lignes brutes du fichier importé**, avec
leur numéro de ligne, leur type verbatim et la contre-valeur telle qu'elle y figure.

Métriques traçables : PRU, coût des unités détenues, somme des achats, somme des ventes, réalisé,
latent, frais, valeur, total.

## La forme de chaque calcul

| Métrique | Forme                                                       |
| -------- | ----------------------------------------------------------- |
| PRU      | `coût des lots restants ÷ quantité détenue`                 |
| Coût     | `Σ lots restants`                                           |
| Réalisé  | `Σ cessions`, chaque cession = `produit − Σ lots consommés` |
| Valeur   | `quantité × cours retenu`                                   |
| Latent   | `valeur − coût des unités détenues`                         |
| Frais    | `Σ frais bruts − Σ remises`                                 |
| Achats   | `Σ acquisitions valorisées` (migration sortante en négatif) |
| Total    | `réalisé + latent + récompenses valorisées`                 |

## Les trois règles

### 1. Ça boucle, ou ça se voit

Sous un opérateur additif (`sum`, `difference`), **la somme des montants des enfants est celle du
parent**. Une branche soustraite voit tout son sous-arbre changer de signe : « A − B » reste ainsi
une somme de contributions signées, et le bouclage tient à **tous** les niveaux, pas seulement à la
racine.

`Trace.residual` porte la somme des écarts de bouclage de l'arbre entier. `'0'` signifie
« explication complète » — et c'est ce que la feuille affiche en clair, même en mode discret :
c'est un **contrôle**, pas un montant patrimonial. En deçà de `TRACE_EPSILON` (1 × 10⁻⁹), l'écart
vient des divisions à 30 décimales de `big.js` et non d'un trou : il est ramené à `'0'` plutôt que
de crier au loup.

Deux tests de propriétés (fast-check, `engine/trace.property.test.ts`) tiennent cette règle sur des
séquences aléatoires d'achats, de ventes partielles et de récompenses — comparaisons en `Big`,
jamais en flottant.

### 2. Un trou est nommé, jamais comblé

| Trou                          | Ce qu'il dit                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `external-quote`              | Le cours vient d'un fournisseur extérieur — la seule donnée non issue de vos lignes  |
| `unqualified-row`             | Des opérations ne sont pas interprétées : elles n'entrent dans aucun chiffre         |
| `missing-history`             | L'historique d'acquisition manque (position bloquée, événement introuvable)          |
| `carried-cost`                | Coût reporté par une migration : le prix payé est celui de l'actif précédent         |
| `transfer-from-other-account` | Virement interne : le coût vient du retrait apparié, sur un autre compte             |
| `row-unavailable`             | La ligne d'origine n'est plus dans les données importées                             |
| `truncated`                   | Au-delà de 200 contributions, les suivantes sont **regroupées à leur montant exact** |

Un nœud de trou porte une **contribution nulle** : il qualifie le chiffre sans le déplacer. Le
plafond de 200, lui, remplace les contributions omises par un nœud unique portant leur somme
exacte — le compte des omises est publié (`Trace.omitted`), et le résidu **reste juste**.

### 3. Le moteur ne parle aucune langue

`src/lib/domain/engine/trace.ts` produit des **codes** (rôles, opérateurs, trous, provenances).
`src/lib/format/trace.ts` — et lui seul — les transforme en phrases françaises, avec un `switch`
exhaustif : ajouter un code sans écrire sa phrase est une **erreur de compilation**. Traduire
l'application ne touchera donc jamais au calcul.

## Les décisions d'écran

- **Le déclencheur est le montant lui-même** (un `<button>` qui l'enveloppe, cible ≥ 24 px pour
  WCAG 2.2 `target-size`). Pas d'icône « ? » semée à côté de chaque chiffre : 22 px de cible
  supplémentaire par montant feraient échouer le critère sur les écrans denses.
- **Une trace est toujours en euros**, même quand l'application affiche des dollars, et une note le
  dit. Convertir chaque étape ajouterait un arrondi par niveau et le bouclage cesserait de tenir —
  même choix que les montants fiscaux (décision n° 43).
- **Une seule lecture du PRU** : celle des lots encore détenus. Le PRU est invariant à la vente
  (décision n° 5) ; en afficher un second « au moment de la cession » contredirait le socle. Une
  phrase l'explique dans la feuille.
- **Le compte n'est annoncé que si plusieurs contribuent** : sinon c'est du bruit sur chaque ligne.
- **Mode discret** : les montants sont masqués, **la structure reste entière** — dates, numéros de
  ligne, type brut, jambe retenue, source et fraîcheur du cours, trous et résidu. Un prix unitaire
  (PRU, cours) reste lisible, comme partout ailleurs dans l'application.
- Arbre en `<ul>`/`<li>` avec `<details>`/`<summary>` **natifs** : pliage, clavier et annonce
  « développé / réduit » viennent du navigateur, donc aucun attribut ARIA ne peut être oublié. Une
  ligne brute se rend en `<dl>` (terme / valeur) et non en tableau large — un tableau à cinq
  colonnes déborderait sur téléphone (WCAG 1.4.10 Reflow).

## Ce que ça a fallu enregistrer

Trois maillons manquaient au moteur, tous consistant à **conserver** une information déjà calculée :

1. `TradeEvent.counterRowKey` / `assetRowKey` (`import/coinhouse/trade.ts`) — `pickCounterLeg`
   choisissait déjà la jambe contrepartie, mais ne le disait à personne. La **règle d'or** de
   l'export (décision n° 4) devient auditable au lieu d'être crue sur parole : la feuille montre
   que le coût vient de la ligne **USDC**, jamais de la jambe crypto dont la colonne
   « Contre-valeur (EUR) » est en réalité exprimée en USDC.
2. `HistoryEntry.rowKeys` — le pont entre un mouvement et ses lignes de fichier.
3. `HistoryEntry.lotsConsumed` (`engine/position.ts`) — la proratisation des lots calculait déjà la
   part prise à chacun, puis la jetait. La consigner ne coûte rien et c'est la seule façon de
   répondre à « quels achats ont payé cette vente ? ».

## Formats couverts

`TraceRowSnapshot` est le **dénominateur commun** des lignes brutes : une jambe pour une ligne
Coinhouse, une ou deux pour une ligne du format pivot (Koinly/Waltio et tous les convertisseurs de
plateformes qui en dérivent, décisions n° 24 et 26). Sans ce dénominateur, la moitié des
utilisateurs n'auraient vu que des trous `row-unavailable`.

Les événements sans lignes brutes (saisies manuelles, API Hyperliquid) n'ont pas de jambe
contrepartie à citer : leurs feuilles portent alors le trou correspondant plutôt qu'une provenance
inventée.

## Où c'est branché

- `src/lib/domain/engine/trace.ts` — types et `traceMetric` (moteur pur).
- `src/lib/format/trace.ts` — `renderTrace`, `traceToText` (rendu français, texte copiable).
- `src/state/app.svelte.ts` — `app.trace(target)` injecte l'accesseur de lignes (les **deux**
  magasins) et le grand livre ; `app.eurReport` fournit le rapport en euros.
- `src/components/shared/WhySheet.svelte` et `TraceTree.svelte` — la feuille et l'arbre.
- `src/components/asset/CalcTab.svelte`, `src/routes/invest/AssetDetail.svelte` — les déclencheurs.

## Tests

- `engine/trace.test.ts` — l'achat payé en USDC, le PRU, le réalisé et ses lots consommés, le cours
  externe, les lignes à qualifier, le coût reporté, le dépôt apparié, la ligne indisponible, le
  plafond.
- `engine/trace.property.test.ts` — bouclage, provenance non fantôme, « rien d'inventé »
  (une feuille n'affiche jamais plus que ce que sa ligne contient), déterminisme.
- `format/trace.test.ts` — mode discret, note « en euros », texte copiable.
- `tests/e2e/why.spec.ts` — l'écran comparé au moteur ; `tests/e2e/a11y.spec.ts` passe axe sur la
  feuille entièrement dépliée.
