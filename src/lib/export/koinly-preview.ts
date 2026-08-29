/**
 * Ce que l'export portable Koinly/Waltio ne sait pas porter, chiffré sur les données réelles de
 * l'utilisateur avant le téléchargement (P72, docs/backup-format.md § « Export portable ») —
 * jamais un texte générique, des comptes tirés de l'état courant. Même doctrine que la
 * traçabilité (docs/DECISIONS.md n° 61) : **on nomme le trou, on ne le comble pas**.
 *
 * Fonction PURE : uniquement des codes typés, aucune phrase en français — le rendu est séparé
 * (`src/lib/format/koinly-preview.ts`). Les quatre pertes comptées ici sont établies et figées par
 * `tests/integration/koinly-roundtrip-gaps.test.ts` (et, pour ce qui survit, par la propriété
 * `tests/integration/koinly-roundtrip.property.test.ts`).
 */
import { isCashLike } from '../domain/assets';
import type { LedgerEvent } from '../domain/types';

export type PortabilityGapCode =
  'migration-as-trade' | 'accounts-merged' | 'opening-balance-cost-lost' | 'paired-transfers-lost';

export interface PortabilityGap {
  code: PortabilityGapCode;
  /** Toujours ≥ 1 ; `accounts-merged` est toujours ≥ 2 (fusionner UN compte ne perd rien). */
  count: number;
}

/**
 * Décompte des pertes de l'aller-retour Koinly, sur les événements qui seraient réellement
 * exportés (une ligne « à qualifier » n'entre jamais dans le CSV, `koinly-csv.ts`). Un code
 * n'apparaît que si son compte est strictement positif : une liste vide veut dire « rien à
 * signaler ».
 *
 * - `migration-as-trade` : une migration/delisting part en échange « swap » et se relit comme une
 *   VENTE RÉALISÉE (le sens change, pas seulement la donnée — pire qu'une perte silencieuse).
 * - `accounts-merged` : le format pivot ne porte pas de colonne « compte » ; un ré-import atterrit
 *   dans un seul compte de destination, quel que soit le nombre de comptes d'origine.
 * - `opening-balance-cost-lost` : le coût d'un solde d'ouverture crypto (non cash) n'est jamais
 *   relu par la réimportation d'une ligne « reçu seul » — il redevient `null` (0 € retenu).
 * - `paired-transfers-lost` : un virement interne apparié (jamais persisté, recalculé à chaque
 *   chargement) ne peut plus se reformer une fois les deux comptes fusionnés en un seul.
 */
export function koinlyPortabilityPreview(events: readonly LedgerEvent[]): PortabilityGap[] {
  const accounts = new Set<string>();
  let migrations = 0;
  let openingBalanceCostLost = 0;
  let pairedTransfers = 0;
  for (const event of events) {
    if (event.kind === 'unqualified') continue;
    accounts.add(event.accountId);
    if (event.kind === 'migration') migrations++;
    else if (event.kind === 'opening-balance' && !isCashLike(event.in.asset))
      openingBalanceCostLost++;
    else if (event.kind === 'withdrawal' && event.transferTo !== undefined) pairedTransfers++;
  }
  const gaps: PortabilityGap[] = [];
  if (migrations > 0) gaps.push({ code: 'migration-as-trade', count: migrations });
  if (accounts.size > 1) gaps.push({ code: 'accounts-merged', count: accounts.size });
  if (openingBalanceCostLost > 0)
    gaps.push({ code: 'opening-balance-cost-lost', count: openingBalanceCostLost });
  if (pairedTransfers > 0) gaps.push({ code: 'paired-transfers-lost', count: pairedTransfers });
  return gaps;
}
