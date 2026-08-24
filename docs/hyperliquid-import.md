# Import Hyperliquid — format et sémantique (sondé le 23/08/2026, lecture seule)

Contrairement à l'export Coinhouse (un fichier), l'import Hyperliquid interroge directement l'API
**`info`** à partir d'une **adresse publique** (`0x` + 40 hexadécimaux) collée par l'utilisateur :
aucun fichier, aucune clé, aucune signature. Les exemples de ce document utilisent l'adresse fictive
`0x000000000000000000000000000000000000d3a0` de la fixture 100 % synthétique
`tests/fixtures/hyperliquid/demo.json` (générée par `npm run fixture:hl`) ; aucune adresse ni aucun
montant réel n'apparaît ici (docs/DECISIONS.md n° 17).

## Endpoint et CORS

- `POST https://api.hyperliquid.xyz/info`, corps JSON `{"type": "…", …}`, mainnet uniquement (l'URL
  est fixe dans le client, `HL_INFO_ENDPOINT`).
- CORS ouvert : `access-control-allow-origin: *` sur toutes les réponses sondées le 23/08/2026.
- Débit documenté : 1 200 de poids par minute et par IP. Sur les types utilisés par l'app,
  `clearinghouseState` et `spotClearinghouseState` pèsent 2 ; les autres pèsent 20, + 1 par tranche de
  20 éléments pour `userFills*`. Aucun en-tête `retry-after` observé en sonde ; le client applique
  quand même un nouvel essai avec délai exponentiel et jitter sur 429/5xx (`client.ts`).

## Types de requêtes

| Type utilisé par l'app        | Rôle                                                         | Poids             |
| ----------------------------- | ------------------------------------------------------------ | ----------------- |
| `spotMeta`                    | Résout `@<index>` → jetons base/quote ; mémoïsé 24 h         | 20                |
| `userFillsByTime`             | Fills spot et perps, tri **ascendant**, page par `startTime` | 20 + 1 / 20 fills |
| `userFunding`                 | Paiements de funding (perps)                                 | 20                |
| `userNonFundingLedgerUpdates` | Dépôts, retraits, transferts, mouvements hors funding        | 20                |
| `clearinghouseState`          | Instantané du compte perps (équité, positions ouvertes)      | 2                 |
| `spotClearinghouseState`      | Instantané des soldes spot                                   | 2                 |

Sondés le 23/08/2026 (deux adresses publiques du classement, 16 requêtes) mais **non utilisés par
l'app** : `userFills` (même forme que `userFillsByTime`, tri **descendant** — inutilisable pour une
pagination par curseur croissant) ; `portfolio` (8 périodes ; `vlm` est un **nombre**, seul champ qui
ne soit pas une chaîne observé sur toute l'API) ; `subAccounts` (renvoie `null` en l'absence de
sous-compte).

## Sémantique des champs

### Fill (`userFillsByTime`, `userFills`)

| Champ                                           | Type observé       | Traitement par l'app                                                                                                                           |
| ----------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `coin`                                          | chaîne             | perp (`BTC`…) ou spot : `PURR/USDC` (seule paire canonique) ou `@<index>`                                                                      |
| `px`, `sz`, `fee`, `closedPnl`, `startPosition` | chaînes décimales  | conservées telles quelles (`Big`), jamais `number`                                                                                             |
| `side`                                          | `'A'` \| `'B'`     | vente / achat                                                                                                                                  |
| `time`                                          | nombre (ms UTC)    | curseur de pagination, tri, conversion `at` (heure de Paris)                                                                                   |
| `tid`                                           | nombre             | converti en chaîne, **seule clé de dédoublonnage**                                                                                             |
| `oid`, `hash`                                   | nombre / chaîne    | conservés, jamais utilisés comme clé                                                                                                           |
| `dir`                                           | chaîne             | libellé d'affichage ; observés : `Open Long`, `Close Long`, `Open Short`, `Close Short`, `Long > Short`, `Buy`, `Sell`, `Spot Dust Conversion` |
| `crossed`                                       | booléen            | `true` = taker                                                                                                                                 |
| `feeToken`                                      | chaîne             | `USDC` et aussi `USDH` observés                                                                                                                |
| `builderFee`                                    | chaîne, jamais vu  | conservé si présent (déjà inclus dans `fee`)                                                                                                   |
| `twapId`                                        | chaîne \| `null`   | présent mais toujours `null` hors TWAP en sonde                                                                                                |
| `liquidation`                                   | objet \| absent    | absent sauf liquidation : `{liquidatedUser, markPx, method}`                                                                                   |
| `cloid`                                         | jamais vu en sonde | —                                                                                                                                              |

### Funding (`userFunding`)

`delta` de type `funding` : `{coin, usdc, szi, fundingRate, nSamples}`. `usdc` est **signé** : négatif
quand le compte paie (position longue quand le taux de funding est positif). `nSamples` n'est pas
conservé par l'app.

### Grand livre (`userNonFundingLedgerUpdates`)

Types de `delta` **vus en sonde** : `deposit{usdc}` ; `withdraw{usdc, nonce, fee}` (frais observé :
1 USDC) ; `spotGenesis{token, amount}` (airdrop, coût nul) ; `accountClassTransfer{usdc, toPerp}` ;
`spotTransfer{token, amount, usdcValue, user, destination, fee, …}` ;
`send{user, destination, sourceDex, destinationDex, token, amount, …}` (transfert inter-DEX). Le
normaliseur (`normalize.ts`) gère aussi, par prudence, `internalTransfer`, `subAccountTransfer`,
`vaultDeposit`/`vaultCreate`, `vaultWithdraw`/`vaultDistribution`, `liquidation` et `rewardsClaim` —
**aucun n'a été vu en sonde**.

### Instantanés (`clearinghouseState`, `spotClearinghouseState`, `spotMeta`)

- `marginSummary` : `accountValue`, `totalNtlPos`, `totalRawUsd`, `totalMarginUsed` (lus) ;
  `crossMarginSummary` et `crossMaintenanceMarginUsed` existent dans la réponse mais ne sont **pas**
  lus par l'app. `withdrawable`, `time` lus directement. `assetPositions[].position` (`type: 'oneWay'`
  sur tous les éléments sondés) : `coin`, `szi`, `entryPx`, `positionValue`, `unrealizedPnl`,
  `returnOnEquity`, `liquidationPx` (peut être `null`), `marginUsed`, `leverage.{type, value}`,
  `maxLeverage`, `cumFunding.{allTime, sinceOpen, sinceChange}` — tous lus.
- `spotClearinghouseState.balances[]` : `{coin, token, total, hold, entryNtl}`, tous lus.
- `spotMeta` : `tokens[]` (493 jetons le 23/08/2026) et `universe[]` (326 paires), résolues en
  `{name, index, base, quote, isCanonical}`.

## Règles d'or

1. **`closedPnl` est BRUT de frais.** Vérifié par reconstruction de 4 aller-retours : l'écart entre
   `closedPnl` et (prix de sortie − prix d'entrée moyen) × quantité est de l'ordre de 1e-12 (bruit
   d'arrondi), très inférieur aux frais réels. P&L net = Σ `closedPnl` − Σ frais + Σ funding
   (`domain/trading/compute.ts`).
2. **`startPosition` est la position signée avant le fill** (négative = short), exacte fill après fill
   y compris à travers un retournement (`dir: 'Long > Short'`).
3. **`tid` est le seul identifiant unique.** `hash`, `oid` et `time` peuvent se répéter sur plusieurs
   fills d'un même ordre agressif exécuté en plusieurs tranches : jamais utilisés comme clé.
4. **Les bornes `startTime`/`endTime` sont inclusives** : l'élément à la frontière revient dans la
   page suivante ; l'app ne fait donc jamais confiance à la seule pagination et dédoublonne toujours
   par clé (`tid`, ou clé composite pour funding/ledger).
5. **Résolution spot** : `coin` vaut `PURR/USDC` (seule paire canonique observée) ou `@<index>`,
   résolu via `spotMeta.universe[].index` ; à défaut, le nom brut sert de repli (`resolveSpotPair`).

## Flux de synchronisation

`syncAccount(client, previous, address, options)` (`sync.ts`) :

1. `spotMeta` (mémoïsé 24 h côté client) pour résoudre les paires spot.
2. `userFillsByTime` par pages de 2 000 (`FILLS_PAGE`), en repartant du `time` du dernier fill connu
   (`cursor.fills`) ; la page suivante démarre à ce même instant (borne inclusive) et les doublons
   sont écartés par `tid`.
3. `userFunding` puis `userNonFundingLedgerUpdates` par pages de 100 (`LEDGER_PAGE`), même logique de
   curseur, dédoublonnage par clé composite (`fundingKey`, `ledgerKey` — un même `hash` peut porter
   plusieurs mouvements).
4. Instantanés `clearinghouseState` et `spotClearinghouseState` (non paginés : toujours le dernier
   état).

Bornes : 50 pages par appel (`MAX_PAGES`, soit 100 000 fills — bien au-delà de ce que l'API conserve) ;
au-delà, `truncated: true` invite à relancer. Une erreur en cours de route conserve les données déjà
reçues (`error` renseigné) ; la synchronisation suivante reprend aux curseurs, jamais depuis zéro :
rejouer une synchronisation est **idempotente** (sync × 2 = sync × 1).

L'API ne conserve qu'un historique glissant — « only the 10 000 most recent fills are available »
selon la documentation officielle — d'où la persistance des bruts (fills, funding, mouvements) dans
l'état plutôt que d'un simple dérivé : l'application est la **mémoire longue** (docs/DECISIONS.md
n° 22).

## Ce que l'app fait de chaque donnée

| Donnée Hyperliquid                                                | Par défaut                                                                        | Option `spotAsInvestment`                                                                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Fill **spot**                                                     | `Execution` du moteur Trading → « Avoirs spot » (quantité, valeur, jamais de PRU) | `TradeEvent` de l'Investissement (PRU) ; contrepartie USDC convertie en euros au taux BCE du jour |
| Fill **perp**                                                     | `Execution` du moteur Trading                                                     | inchangé — les perps ne routent jamais vers l'Investissement                                      |
| Funding                                                           | `FundingPayment`, entre dans le P&L net du compte de trading                      | —                                                                                                 |
| `deposit` / `withdraw`                                            | `CashFlow` `deposit` / `withdrawal` : trésorerie, jamais un achat de stablecoin   | —                                                                                                 |
| `accountClassTransfer`                                            | `CashFlow` `spot-to-perp` / `perp-to-spot`                                        | —                                                                                                 |
| `internalTransfer`, `subAccountTransfer`                          | `CashFlow` `transfer-in` / `transfer-out`                                         | —                                                                                                 |
| `vaultDeposit`/`vaultCreate`, `vaultWithdraw`/`vaultDistribution` | `CashFlow` `vault-deposit` / `vault-withdraw`                                     | —                                                                                                 |
| `spotTransfer`                                                    | `CashFlow` de montant 0 (mouvement en jeton, pas en USDC), libellé informatif     | —                                                                                                 |
| `send` (inter-DEX), `spotGenesis`, `rewardsClaim`, `liquidation`  | `CashFlow` `other`, montant 0, listés pour mémoire (voir Limites v1)              | —                                                                                                 |

Achat spot routé vers l'Investissement : les frais sont prélevés sur le jeton reçu (quantité nette
= `sz` − frais), un frais payé dans un jeton tiers (ex. HYPE) n'est **pas valorisé** (avertissement à
l'écran plutôt qu'un montant faux), et un fill sans aucun taux EUR→USD connu ce jour-là est **omis**
plutôt que converti au mauvais taux.

## Réconciliation

Auto-vérification affichée en permanence sur le tableau de bord Trading, par compte
(`computeTradingAccount`) :

```
accountValue ≈ Σ flux de trésorerie + Σ closedPnl − Σ frais perps + Σ funding + Σ P&L latent
```

Tolérance 0,01 USDC (`Trading.svelte`). Un écart signale des mouvements non interprétés ou un
historique incomplet (relancer une synchronisation). C'est cette réconciliation qui a permis de
trancher empiriquement que `closedPnl` est brut de frais.

## Pièges connus

- Frais dans un jeton tiers (`feeToken` ≠ devise de cotation, ex. HYPE) : conservés en quantité
  (`feeNative`) mais jamais valorisés par le moteur.
- `oid` et `hash` peuvent être partagés par plusieurs fills d'un même ordre exécuté en plusieurs
  tranches : ne jamais les utiliser comme clé, seul `tid` l'est.
- `liquidationPx` peut être `null` (spot, ou marge largement suffisante) : jamais traité comme 0.
- L'adresse est toujours normalisée en minuscules avant comparaison ou clé de compte (`hl:<adresse>`),
  y compris pour reconnaître les mouvements sortants (`user` du grand livre).
- `Spot Dust Conversion` est traité comme un fill spot ordinaire, sans cas particulier.

## Limites v1

- `send` (transfert inter-DEX) et `spotGenesis` (airdrop) sont **listés sans effet** sur les totaux
  (montant 0) : leur sens comptable exact reste à trancher si un compte les utilise réellement.
- `USDH` n'est pas valorisé : seul `USDC` est traité comme équivalent USD (docs/DECISIONS.md n° 18).
- Vaults et sous-comptes ne sont **pas suivis automatiquement** : ce sont des adresses distinctes, à
  déclarer une par une.
- Frais payés dans un jeton tiers (hors devise de cotation) non valorisés (voir Pièges connus).

## Vie privée

L'adresse publique est envoyée **uniquement** à `api.hyperliquid.xyz` (jamais à un autre service) et
n'est stockée que localement, dans le navigateur — jamais de clé privée ni de signature, l'API `info`
est intégralement en lecture seule (docs/DECISIONS.md n° 1, n° 22).

## Sources (consultées le 23/08/2026)

- Hyperliquid docs, endpoint `info` —
  https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- Hyperliquid docs, `info` perpetuals —
  https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
- Hyperliquid docs, `info` spot —
  https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot
- Hyperliquid docs, débit et limites —
  https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits
- Sonde empirique du 23/08/2026 (deux adresses publiques du classement Hyperliquid, 16 requêtes :
  CORS, formes de réponses, `closedPnl` brut de frais par reconstruction d'aller-retours).
