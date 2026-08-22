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
- `src/lib/format/fr.ts` — le seul endroit qui arrondit (Intl fr-FR).
- `src/state/app.svelte.ts` — store runes : état persisté + dérivés (`events`, `quotes`, `report`).
- `src/routes`, `src/components` — présentation uniquement.

## Invariants testés

- Exemple canonique (1@100, 1@200, vente 1@300, 1@150, cours 250 → PRU 150, réalisé +150,
  latent +200, total +350).
- `total = valeur + Σ produits − Σ acquisitions`, par actif et globalement, quel que soit le mode
  de migration ou de valorisation des récompenses.
- Sur la fixture anonymisée et sur l'export réel (local) : 0 bloqué, 0 à qualifier, 27 soldes
  cohérents, ré-import idempotent.
