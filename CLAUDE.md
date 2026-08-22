# Coût de revient CH — consignes projet

Web app statique locale-first (Vite 8 + Svelte 5 + TypeScript strict) qui calcule le PRU et les
plus/moins-values par crypto à partir de l'export CSV Coinhouse. Publiée sur GitHub Pages
(`base: /cout-revient-ch/`). Aucun backend, aucun compte : les données restent dans le navigateur.

## Commandes

- `npm run dev` — serveur de dev (http://localhost:5173/cout-revient-ch/)
- `npm run check` — lint + typecheck (svelte-check) + tests ; **doit être vert avant tout commit**
- `npm test` / `npm run test:watch` / `npm run test:coverage`
- `npm run build` / `npm run preview`
- `npm run anonymize -- <export.csv>` — génère la fixture anonymisée

## Règles de code

- **Svelte 5 en mode runes uniquement** (`compilerOptions.runes: true`) : `$state`, `$derived`,
  `$effect`, `$props`, `onclick={...}`. Jamais `export let`, `$:`, `on:click`, stores `writable`.
- **Moteur pur** dans `src/lib/domain` : TypeScript sans import Svelte/DOM, seule dépendance
  `big.js`. **Aucun `number` ne porte un montant ou une quantité** : chaînes décimales + `Big`.
  L'arrondi n'existe que dans `src/lib/format/`.
- Dates Coinhouse (`dd/MM/yyyy HH:mm:ss`) → `NaiveDateTime` (`YYYY-MM-DDTHH:mm:ss`), jamais
  converties en fuseau horaire (`new Date()` interdit sur ces valeurs).
- Règle d'or de l'export Coinhouse : **le coût/produit EUR d'une opération est la
  `Contre-valeur (EUR)` de la jambe contrepartie (eur/usdc)**, jamais celle de la jambe crypto
  (libellée « EUR » mais exprimée en USDC quand on paie en USDC). Voir `docs/coinhouse-export.md`.
- Texte d'interface en français ; code, identifiants et commits en anglais (Conventional Commits :
  `feat|fix|docs|test|chore|ci|refactor(scope): …`, scopes `domain|import|pricing|storage|ui|pwa`).
- `erasableSyntaxOnly` : pas d'`enum`, de `namespace` ni de paramètres de constructeur `public`.

## Données sensibles

- **Jamais de CSV réel dans git.** `.gitignore` exclut `*.csv` sauf `tests/fixtures/**`, et
  `scripts/check-no-personal-csv.js` fait échouer `lint` sinon. L'export personnel de l'utilisateur
  reste à la racine (ignoré) et sert aux tests locaux optionnels (`it.skipIf`).
- Les fixtures sont anonymisées (IDs régénérés, dates décalées, montants rescalés, soldes recalculés).

## Vérification

Un changement du moteur n'est terminé que si : exemple canonique OK, invariant
`total = valeur + Σ produits − Σ achats` OK, 0 `unqualified` et 0 écart de solde sur la fixture.
