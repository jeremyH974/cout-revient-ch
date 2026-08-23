# Architecture

Application statique locale-first : **aucun backend**. Tout est calculé dans le navigateur à
partir des lignes brutes de l'export Coinhouse, conservées telles quelles.

```
texte CSV ─▶ import/csv.ts ─▶ coinhouse/detect.ts ─▶ coinhouse/rows.ts ─▶ RawCoinhouseRow[] (persistées)
                                                                              │
      saisies manuelles + qualifications + réglages (persistés) ──────────────┤
                                                                              ▼
                             coinhouse/normalize.ts + import/manual.ts ─▶ LedgerEvent[] (dérivés)
                                                                              │
                               prix (pricing/service.ts : manuel > cache > CoinGecko > Coinbase)
                                                                              ▼
                                    domain/engine (compute → position → aggregate) ─▶ PortfolioReport
                                                                              │
                                                    state/app.svelte.ts ($derived) ─▶ routes/*.svelte
```

## Couches

- `src/lib/domain` — moteur pur TypeScript (aucun import Svelte/DOM, seule dépendance big.js).
  `money.ts` (arithmétique décimale, mode strict), `types.ts` (événements du grand livre),
  `engine/position.ts` (CUMP invariant à la vente, lots au prorata), `engine/compute.ts`
  (boucle chronologique), `engine/aggregate.ts` (rapport), `engine/integrity.ts` (colonne Solde).
- `src/lib/import` — parseur tolérant, détection de format par alias d'en-têtes, construction des
  opérations à deux jambes (`trade.ts`), normalisation, dédoublonnage idempotent (`index.ts`).
- `src/lib/pricing` — table curée des tickers, fournisseurs CoinGecko (groupé) et Coinbase
  (par actif), cascade avec cache et prix manuels.
- `src/lib/storage` — schéma versionné (`StoredStateV1`), migrations, localStorage (clé
  `crch:v1:state`), sauvegarde JSON et fusion.
- `src/lib/support` — diagnostic copiable (`diagnostic.ts`, pur : compteurs, statuts, colonnes —
  jamais de montant) et collecte navigateur (`environment.ts`), liens publics (`links.ts`).
- `src/lib/format/fr.ts` — le seul endroit qui arrondit (Intl fr-FR).
- `src/state/app.svelte.ts` — store runes : état persisté + dérivés (`events`, `quotes`, `report`).
- `src/routes`, `src/components` — présentation uniquement.

## Invariants testés

- Exemple canonique (1@100, 1@200, vente 1@300, 1@150, cours 250 → PRU 150, réalisé +150,
  latent +200, total +350).
- `total = valeur + Σ produits − Σ acquisitions`, par actif et globalement, quel que soit le mode
  de migration ou de valorisation des récompenses.
- Sur le jeu de démonstration synthétique (`npm run fixture`, 21 actifs) et sur un export réel
  (local, ignoré par git) : 0 bloqué, 0 à qualifier, tous les soldes cohérents, ré-import idempotent.

## Tests

- **Unitaires** (Vitest, `*.test.ts` colocalisés) : moteur, import, stockage, prix, change,
  historique, exports, diagnostic. **Propriétés** (fast-check, `engine.property.test.ts`) :
  séquences aléatoires d'achats/ventes/récompenses → `total = valeur + Σ produits − Σ achats`,
  PRU invariant à la vente, lots réconciliés, survente bloquée.
- **Bout en bout** (Playwright, `tests/e2e/*.spec.ts`, sur le build servi par `vite preview`) :
  projets Chromium desktop, Chromium mobile (Pixel 7) et WebKit (parcours visuels). Les valeurs
  attendues sont calculées par le moteur à partir de la fixture (`helpers/expected.ts`) ; toutes les
  requêtes externes reçoivent des réponses déterministes (`helpers/network.ts`). Accessibilité axe
  (WCAG 2.2 AA) sur chaque route, PWA (manifeste, service worker, CSP, aucune erreur console).
  **Cohérence transversale** (`coherence.spec.ts`) : les chiffres affichés se recoupent d'un écran à
  l'autre (synthèse = Σ lignes + clôturées, fiche actif et onglet Calcul = ligne, rapport et export
  CSV = synthèse, graphique = synthèse), à l'arrondi près ; rejouable localement sur un export réel
  avec `COHERENCE_CSV=<fichier.csv>` (jamais en CI).
- **Lighthouse CI** (`lighthouserc.json`) : accessibilité, bonnes pratiques, SEO ≥ 0,95 (erreur),
  performance ≥ 0,9 (avertissement). Rapports en artefacts de CI ; `deploy` attend `check` et `e2e`.

## Amélioration continue

- **Auto-vérifications** (`src/lib/support/self-check.ts`, section Réglages + rappel en pied de
  portefeuille) : invariant comptable par actif, lots ↔ position, soldes Coinhouse, opérations à
  qualifier, prix (manquants/périmés/anciens), sauvegarde. Compteurs et tickers seulement.
- **Oracle indépendant** (`tests/integration/independent-oracle.test.ts`) : parseur minimal +
  boucle naïve, comparé au moteur à 1e-9 (fixture et export réel local).
- **Retours** : diagnostic copiable (`diagnostic.ts`, jamais de montant) + formulaire GitHub
  pré-rempli par identifiants de champs (`links.ts`) ; erreurs capturées (`errors.ts`,
  `<svelte:boundary>` dans `App.svelte`, `error`/`unhandledrejection`).
- **Surveillance** (`.github/workflows/monitor.yml`, `tests/monitor/`, `scripts/api-contract.mjs`) :
  site en ligne + forme des réponses des fournisseurs ; issue unique ouverte/refermée
  automatiquement ; réactivation du planning à chaque exécution.
- **Nouveautés** (`src/lib/support/changelog.ts`, `src/routes/News.svelte`) : `CHANGELOG.md`
  rendu dans l'app ; `ui.lastSeenVersion` déclenche un bandeau à chaque mise à jour.
- **Garde-fous** : seuils de couverture Vitest (`vite.config.ts`), propriétés fast-check, E2E, axe,
  Lighthouse CI, Dependabot (délai), CodeQL, Scorecard.
