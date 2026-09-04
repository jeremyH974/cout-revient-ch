# Coût de revient CH — consignes projet

Web app statique locale-first (Vite 8 + Svelte 5 + TypeScript strict) qui calcule le PRU et les
plus/moins-values par crypto à partir de l'export CSV Coinhouse. Publiée sur GitHub Pages
(`base: /cout-revient-ch/`). Aucun backend, aucun compte : les données restent dans le navigateur.

## Commandes

- `npm run dev` — serveur de dev (http://localhost:5173/cout-revient-ch/)
- `npm run check` — lint + typecheck (svelte-check) + tests ; **doit être vert avant tout commit**.
  Attention : il ne lance **pas** la couverture, alors que la CI si (`npm test -- --coverage`) — un
  seuil franchi ne se voit donc qu'en CI. Lancez `npm run test:coverage` avant de pousser du code
  dans une zone à seuil (`src/lib/domain`, `src/lib/derive`, `src/state`).
- `npm test` / `npm run test:watch` / `npm run test:coverage`
- `npm run audit:prod` — `npm audit` des dépendances de production, **avec la distinction qui
  manque à npm** : un verdict de vulnérabilité échoue tout de suite, une panne du registre se
  réessaie puis se nomme (décision n° 99). C'est cette commande que la CI exécute.
- `npm run bench` — mesure le coût du moteur (`tests/perf/*.bench.ts`), **hors CI** : Vitest ne
  ramasse que `*.test.ts`. Le garde-fou qui tourne, lui, ne chronomètre rien — il compte des
  grandeurs déterministes (décisions n° 85 et 87).
- `npm run build` / `npm run preview`
- `npm run fixture` — régénère le jeu de démonstration synthétique (`tests/fixtures/coinhouse/export-demo.csv`)
- `node scripts/generate-tickers.mjs [top]` — régénère `src/lib/pricing/tickers.generated.ts` (top N
  CoinGecko, 500 par défaut). **`src/lib/pricing/tickers.ts` est la table CURÉE et reste prioritaire** :
  `TICKERS = { ...GENERATED, ...CURATED }`. Un symbole partagé par deux projets ne reçoit **aucun**
  identifiant — un prix faux est pire qu'un prix absent ; l'utilisateur le désigne alors depuis la
  fiche actif (`AssetSettings.coingeckoId`).
- `npm run calendar` — régénère `src/lib/calendar/events.generated.ts` (calendrier macro américain)
  depuis la Fed et le BEA. **Le BLS n'est pas relu** : son CDN refuse les clients non-navigateurs,
  y compris sur son propre flux `.ics` ; sa table est tenue à la main dans
  `src/lib/calendar/bls-schedule.ts`, et une barrière du générateur réclame sa relecture avant
  qu'elle ne s'épuise. Le script **refuse d'écrire** un calendrier appauvri, et ne réécrit rien si
  seuls les horodatages changent.
- `npm run macro` — régénère `src/lib/macro/snapshot.generated.ts` (taux du Trésor, réserves
  bancaires de la Fed, pétrole si `EIA_API_KEY` est fournie). **Les colonnes de la Fed sont
  choisies par identifiant stable** (`RESH4R_N.WW`), jamais par libellé. Mêmes barrières que le
  calendrier. Règle de fond (décision n° 59) : **la licence d'une source choisit son mode de
  transport** — instantané committé si la redistribution est autorisée, appel navigateur si seul
  l'usage personnel l'est, abandon sinon (c'est le cas du VIX de Cboe).
- Le cron `.github/workflows/market-data.yml` (lundi et vendredi) lance les deux générateurs,
  valide par `npm run check` **avant** de committer, puis appelle `ci.yml` — un push du robot ne
  déclenche aucun workflow, et c'est la CI qui publie sur Pages.
- `node scripts/generate-icons.mjs` — écrit les logos manquants de `public/icons/` et réécrit
  `KNOWN_ICONS`. Exige `npm install --no-save @web3icons/core@4.0.55` avant, puis `npm uninstall`
  après : le paquet pèse 49 Mo et **n'est pas une dépendance**. Le script **n'écrase jamais** un
  fichier existant (sept portent des retouches à la main, voir `public/icons/LICENSE.md`).
  Ces logos sont **exclus du précache** du service worker (`globIgnores`) et servis par un cache
  d'exécution : sans cela, chaque installation téléchargerait des mégaoctets de logos inutilisés.
- `npm run e2e` — build puis tests Playwright (`tests/e2e/*.spec.ts`, Chromium desktop + mobile,
  WebKit sur les parcours visuels) ; `npm run e2e:ui` pour l'explorateur ; `npm run lhci` — build
  puis Lighthouse CI (seuils dans `lighthouserc.json`). Les deux tournent en CI avant tout déploiement.
  `npm run monitor` — surveillance du site en ligne (`tests/monitor/`) + contrat des API tierces
  (`scripts/api-contract.mjs`), exécutée toutes les 6 h par `.github/workflows/monitor.yml`.
  Première fois : `npx playwright install chromium webkit`. Sous Windows, `vite preview` n'écoute
  que sur `::1` (d'où `--host 127.0.0.1` dans les configs) et Lighthouse peut échouer au nettoyage
  de son profil Chrome (`EPERM`) : la CI Linux fait foi pour Lighthouse.

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

## Tests

- Unitaires et propriétés (Vitest + fast-check) : `*.test.ts` colocalisés, jeu de démonstration
  synthétique dans `tests/fixtures/`. Les tests E2E s'appellent `*.spec.ts` (Vitest ne ramasse que `*.test.ts`) et
  comparent l'écran au moteur (`tests/e2e/helpers/expected.ts`), jamais à des chiffres en dur ;
  `coherence.spec.ts` vérifie que les écrans se recoupent entre eux (rejouable sur un export réel
  local : `COHERENCE_CSV="<export.csv>" npx playwright test coherence --project=chromium`) ;
  toute requête externe est stubée (`tests/e2e/helpers/network.ts`), aucun test ne sort sur Internet.
- Accessibilité : axe (WCAG 2.2 AA) sur chaque route dans `tests/e2e/a11y.spec.ts` ; une violation
  est un échec de CI, corrigez le balisage plutôt que d'exclure la règle.

## Données sensibles

- **Jamais de CSV réel dans git.** `.gitignore` exclut `*.csv` sauf `tests/fixtures/**`, et
  `scripts/check-no-personal-csv.js` fait échouer `lint` sinon. L'export personnel de l'utilisateur
  reste à la racine (ignoré) et sert aux tests locaux optionnels (`it.skipIf`).
- **Les fixtures sont 100 % synthétiques** (`scripts/generate-fixture.ts`) : jamais dérivées d'un export
  réel, même « anonymisé » (une transformation homothétique est réversible — voir `docs/DECISIONS.md` n° 17).

## Vérification

Un changement du moteur n'est terminé que si : exemple canonique OK, invariant
`total = valeur + Σ produits − Σ achats` OK, 0 `unqualified` et 0 écart de solde sur la fixture,
et **oracle indépendant concordant** (`tests/integration/independent-oracle.test.ts`, recalcul
from scratch à 1e-9 près sur la fixture et sur l'export réel). Tout chiffre affiché doit rester
cohérent avec les auto-vérifications (`src/lib/support/self-check.ts`).

**Une contre-épreuve par garde-fou** (décision n° 75) : un test vert ne prouve rien tant qu'on ne
l'a pas vu rougir. Faussez la chose qu'il surveille, vérifiez qu'il échoue en la nommant, puis
restaurez. Cette règle a attrapé, en deux sessions, un contrôle de contrat qui validait un document
que le générateur ne lit jamais, et un garde-fou de couverture qui n'existait qu'en CI.
