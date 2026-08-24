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
        prix (pricing/service.ts : manuel > cache > CoinGecko > Coinbase > Kraken > Hyperliquid >
                                          DefiLlama ; prix USD/USDC convertis en EUR au taux BCE)
                                                                              ▼
                                    domain/engine (compute → position → aggregate) ─▶ PortfolioReport
                                                                              │
                                        state/app.svelte.ts ($derived) ─▶ router.svelte.ts (#/…) ─▶ routes/*.svelte
```

## Couches

- `src/lib/domain` — moteur pur TypeScript (aucun import Svelte/DOM, seule dépendance big.js).
  `money.ts` (arithmétique décimale, mode strict), `types.ts` (événements du grand livre, tout
  événement porte un `accountId` — comptes de première classe, docs/DECISIONS.md n° 20),
  `engine/position.ts` (CUMP invariant à la vente, lots au prorata), `engine/compute.ts`
  (boucle chronologique), `engine/aggregate.ts` (`computePortfolio` : rapport consolidé sur tout le
  grand livre ; `computePortfolioByAccount` : le même grand livre groupé par `accountId`, un rapport
  — donc un PRU — par compte, le contrôle de solde n'étant transmis qu'au compte Coinhouse),
  `engine/integrity.ts` (colonne Solde), `transfers.ts` (virements internes appariés entre comptes,
  coût transporté vers le dépôt, jamais persisté, docs/DECISIONS.md n° 25), `xirr.ts` (rendement
  personnel annualisé money-weighted : Newton pour semer, bissection pour trancher, taux en float64
  seulement à la frontière du solveur, docs/DECISIONS.md n° 27) et `date.ts` (arithmétique de dates
  civiles en entiers purs, algorithme de Hinnant, base des jours écoulés du XIRR).
- `src/lib/domain/trading` — second moteur pur (même contrainte : aucun import Svelte/DOM, seule
  dépendance big.js), vocabulaire volontairement distinct de l'Investissement (jamais de PRU ici).
  `types.ts` (`Execution` : fill spot ou perp ; `FundingPayment` ; `CashFlow` ; `OpenPosition` ;
  `SpotHolding` ; `TradingSnapshot`), `compute.ts` (`computeTradingAccount` : totaux réalisé brut,
  frais, funding, net = réalisé − frais perps + funding, dépôts nets, P&L latent, équité, et
  réconciliation `accountValue ≈ Σ flux + Σ closedPnl − Σ frais perps + Σ funding + latent` —
  auto-vérification permanente affichée sur `routes/Trading.svelte` ; `computeTrading` consolide
  plusieurs comptes, docs/DECISIONS.md n° 22), `calendar.ts` (`realizedEvents` : un montant par
  événement daté — `closedPnl − frais` au jour du fill, funding au jour du paiement — puis grille
  mensuelle, carte « Calendrier de P&L » de `routes/trading/TradeStats.svelte`. La somme de la
  grille sur tout l'historique **est** `totals.net`, docs/DECISIONS.md n° 35).
- `src/lib/import` — parseur tolérant, détection de format par alias d'en-têtes, construction des
  opérations à deux jambes (`trade.ts`), normalisation, dédoublonnage idempotent (`index.ts`).
- `src/lib/import/hyperliquid` — client `info` minimal sans clé (`client.ts` : une requête à la fois,
  120 ms d'espacement, nouvel essai avec délai exponentiel et jitter sur 429/5xx, `Retry-After`
  respecté), synchronisation incrémentale par curseur (`sync.ts` : fills par pages de 2 000, funding
  et grand livre par pages de 100, borne inclusive et dédoublonnage par clé — idempotente), gardes
  runtime champ par champ sur chaque réponse (`api-types.ts`), normalisation vers `domain/trading` et,
  en option (`spotAsInvestment`), vers des `TradeEvent` de l'Investissement (`normalize.ts`). Détail
  complet : docs/hyperliquid-import.md, docs/DECISIONS.md n° 22.
- `src/lib/import/pivot` — import CSV « pivot » (CSV Universal Koinly, ou export interne Koinly lu
  par Waltio) dans des comptes `kind: 'csv'` de l'espace Investissement : détection de format
  (`detect.ts`), lignes brutes dédoublonnées par hachage de contenu (`rows.ts`), normalisation vers
  `LedgerEvent[]` avec les mêmes règles de valeur EUR que le reste de l'app (`events.ts`). Détail
  complet : docs/pivot-import.md, docs/DECISIONS.md n° 24.
- `src/lib/import/platforms` — convertisseurs natifs purs, un module par plateforme (`kraken.ts`,
  `coinbase.ts`, `bitvavo.ts`, `ledgerlive.ts`, `revolut.ts`) traduisant chacun son export propre en
  brouillons pivot (`types.ts` : `PlatformDraft`) ; `drafts.ts` (`draftsToPivotRows`) les transforme
  en `RawPivotRow` — clé de dédoublonnage = hachage du **contenu natif**, jamais du résultat calculé
  — et `index.ts` (`importAnyCsv`, `PLATFORM_CONVERTERS`, `FORMAT_LABELS`) orchestre la détection en
  essayant le format pivot puis chaque convertisseur. `src/lib/import/ghostfolio` (import JSON
  d'activités Ghostfolio) et `src/lib/import/onchain` (ci-dessous) réutilisent la même
  `draftsToPivotRows` et le même `ingestPivotRows` du pipeline pivot. Détail complet :
  docs/pivot-import.md, docs/DECISIONS.md n° 26.
- `src/lib/import/onchain` — suivi en lecture seule d'une adresse publique BTC (`btc.ts`,
  mempool.space, mouvement net par transaction) ou EVM (`evm.ts`, Blockscout v2 sur Ethereum,
  Arbitrum One et Base ; ERC-20 filtrés par liste blanche d'adresses de contrats, jamais par
  symbole) ; `normalize.ts` transforme les mouvements en brouillons pivot **sans valeur EUR**
  (candidats à l'appariement de virement ou lignes à qualifier). Détail complet :
  docs/onchain-import.md, docs/DECISIONS.md n° 28.
- `src/lib/export` — CSV tableur pour tableur FR (`csv-export.ts`) et CSV pivot Koinly/Waltio
  réimportable ailleurs, valeurs EUR de l'app (`koinly-csv.ts`, docs/pivot-import.md).
- `src/lib/pricing` — table curée des tickers, fournisseurs CoinGecko (groupé), Coinbase (par
  actif), Kraken (groupé), Hyperliquid (mids USDC : HYPE, PURR et tokens spot Hyperliquid) et
  DefiLlama (filet de sécurité, par identifiant CoinGecko) ; cascade avec cache et prix manuels.
  Les trois derniers cotent en USD/USDC, convertis en EUR au taux BCE du jour (`src/lib/fx`,
  docs/DECISIONS.md n° 18). `live.ts` (`createLiveMids`) : prix « live » Hyperliquid par WebSocket
  (`allMids`), strictement opt-in (interrupteur « Prix en direct » de `routes/Trading.svelte`,
  réglage `ui.liveMids`), jamais écrit dans le cache de prix persisté ci-dessus — un canal
  d'affichage à part, docs/DECISIONS.md n° 29. Hôtes autorisés par la CSP (`vite.config.ts`) :
  api.coingecko.com, api.coinbase.com, api.exchange.coinbase.com, api.kraken.com,
  api.hyperliquid.xyz, wss://api.hyperliquid.xyz, coins.llama.fi, api.frankfurter.dev/.app,
  mempool.space, eth/arbitrum/base.blockscout.com (ces deux derniers pour `import/onchain`).
- `src/lib/storage` — schéma versionné (`StoredStateV1`), migrations, sauvegarde JSON et fusion.
  Persistance à deux étages (docs/DECISIONS.md n° 21) : `idb-state-store.ts` (IndexedDB, base
  `crch-state`, source principale, sans le plafond ~5 Mo de localStorage) et `local-storage.ts`
  (clé `crch:v1:state`, miroir synchrone) ; `state-store.ts` les orchestre — au chargement,
  l'instantané le plus récent gagne (`savedAt`), à égalité le miroir l'emporte ; à l'enregistrement,
  IndexedDB puis miroir, `ok` dès que l'un des deux réussit. `encryption.ts` chiffre en option la
  sauvegarde téléchargeable par phrase secrète (PBKDF2-HMAC-SHA-256 → AES-GCM-256, `crypto.subtle`,
  zéro dépendance). `accounts: Record<AccountId, Account>` ne contient que les comptes
  **déclarés** par l'utilisateur (id `man:<aléatoire>`, assaini par motif
  `^[a-z]{2,3}:[A-Za-z0-9._-]{1,80}$`) ; les comptes **implicites** (Coinhouse `ch:main`, saisies
  « hors Coinhouse » `man:default`) ne sont jamais persistés, ils existent dès qu'un événement les
  référence (`AppState.accounts`, dérivé). `hyperliquid: HlState` (conteneur additif,
  docs/DECISIONS.md n° 22) porte les bruts par compte Hyperliquid ; assaini champ par champ
  (`sanitize.ts`) et fusionné par union de clés (`tid`, clés composites funding/ledger) dans
  `json-io.ts`, jamais remplacé en bloc.
- `src/lib/support` — diagnostic copiable (`diagnostic.ts`, pur : compteurs, statuts, colonnes —
  jamais de montant) et collecte navigateur (`environment.ts`), liens publics (`links.ts`).
- `src/lib/format/fr.ts` — le seul endroit qui arrondit (Intl fr-FR).
- `src/state/app.svelte.ts` — store runes : état persisté + dérivés (`events`, `quotes`, `report`).
- `src/routes`, `src/components` — présentation uniquement. Navigation en quatre espaces
  (`src/lib/spaces.ts`, registre `SPACES`), chacun avec son libellé, sa couleur d'accent et sa cible
  de retour de barre d'application : `routes/Overview.svelte` (Vue d'ensemble, `#/`, aussi le
  `start_url` de la PWA — additionne des soldes, jamais des résultats de nature différente),
  `routes/invest/*.svelte` (Investissement, `#/invest…` : portefeuille, fiche actif, import, saisie
  manuelle, rapport), `routes/Trading.svelte` (Trading, `#/trading` : état vide tant qu'aucun compte
  Hyperliquid n'est déclaré, puis tableau de bord — équité, P&L par période, positions ouvertes,
  avoirs spot, derniers fills, réconciliation permanente, interrupteur « Prix en direct » opt-in,
  `pricing/live.ts`) et `routes/More.svelte` (Plus, `#/more` :
  import, saisie, rapport, **comptes**
  (`routes/Accounts.svelte`, `#/accounts` : liste des comptes implicites et déclarés,
  ajout/suppression d'un compte déclaré ou d'une adresse on-chain BTC/EVM suivie en lecture seule,
  bouton « Synchroniser »), réglages, aide, nouveautés, confidentialité).
  `src/lib/router.svelte.ts` traduit le hash en route (`parseHash`/`toHash`) ; les hashes v1
  (`#/portfolio`, `#/asset/btc`, `#/import`, `#/add`, `#/report`) restent pris en charge comme alias
  pour ne pas casser liens partagés, favoris et écrans d'accueil déjà installés.

## Invariants testés

- Exemple canonique (1@100, 1@200, vente 1@300, 1@150, cours 250 → PRU 150, réalisé +150,
  latent +200, total +350).
- `total = valeur + Σ produits − Σ acquisitions`, par actif et globalement, quel que soit le mode
  de migration ou de valorisation des récompenses.
- Sur le jeu de démonstration synthétique (`npm run fixture`, 21 actifs) et sur un export réel
  (local, ignoré par git) : 0 bloqué, 0 à qualifier, tous les soldes cohérents, ré-import idempotent.
- Trading (par compte Hyperliquid synchronisé) : réconciliation permanente de l'équité (tolérance
  0,01 USDC, formule complète dans docs/hyperliquid-import.md) — c'est elle qui a permis de trancher
  empiriquement que `closedPnl` est brut de frais.

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
