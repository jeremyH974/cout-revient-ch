/**
 * Écart chiffré entre NOTRE calcul et celui d'une autre source (P68) — un type PARTAGÉ, pas un
 * outil interne à la réconciliation : P62 (second avis sur un export concurrent) le réutilise tel
 * quel pour comparer les chiffres d'un outil tiers aux nôtres. `gap.ts` n'a donc aucune idée de LA
 * RAISON de l'écart (solde de plateforme, futur solde on-chain, export externe) : elle vit
 * uniquement dans `GapSource`, jamais dans le calcul lui-même.
 *
 * Module pur (décision n° 40) : aucune horloge, aucun `number` porteur d'un montant ou d'une
 * quantité — chaînes décimales et `Big`, comme partout dans `src/lib/domain`.
 */
import { toDecimalString, type Big, type DecimalString } from './money';
import type { TraceTarget } from './engine/trace';
import type { AccountId, AssetCode } from './types';

/** Nature du chiffre comparé : quantité détenue, valeur au marché, coût d'acquisition ou PRU. */
export type GapMetric = 'qty' | 'value-eur' | 'cost-basis-eur' | 'pru-eur';

/**
 * D'où vient LEUR chiffre. `onchain-balance` est RÉSERVÉ : la forme existe pour que ce module et un
 * futur chantier de solde on-chain partagent le même vocabulaire, mais aucune règle de P68 ne le
 * peuple encore — l'app ne lit aujourd'hui que des MOUVEMENTS on-chain, jamais un solde courant
 * (voir `docs/reconciliation.md`). `external-export` est la source qu'utilisera P62.
 */
export type GapSource =
  | { kind: 'platform-balance'; accountId: AccountId }
  | { kind: 'onchain-balance'; accountId: AccountId; address: string }
  | { kind: 'external-export'; label: string; importId: string };

export interface ValueGap {
  metric: GapMetric;
  asset: AssetCode | null;
  ours: DecimalString | null;
  theirs: DecimalString | null;
  /** `ours − theirs` ; `null` si un des deux côtés manque (rien de chiffré à soustraire). */
  delta: DecimalString | null;
  source: GapSource;
  /** « Pourquoi ce chiffre ? » sur NOTRE côté, jamais sur le leur : nous ignorons d'où il vient. */
  ourTrace: TraceTarget | null;
}

/**
 * Construit un écart, ou `null` quand les deux côtés concordent (à `tolerance` près — comparaison
 * en valeur absolue, jamais un simple `!eq`). Trichotomie sur ce qui manque :
 *
 * - un seul côté est renseigné → `delta: null` (rien à soustraire, l'autre côté est muet) ;
 * - les deux sont renseignés et divergent → `delta` porte l'écart SIGNÉ `ours − theirs` ;
 * - les deux manquent → rien à comparer, `null` comme une concordance.
 */
export function buildValueGap(
  metric: GapMetric,
  asset: AssetCode | null,
  ours: Big | null,
  theirs: Big | null,
  source: GapSource,
  ourTrace: TraceTarget | null,
  tolerance: Big,
): ValueGap | null {
  if (ours === null && theirs === null) return null;
  if (ours !== null && theirs !== null) {
    const delta = ours.minus(theirs);
    if (delta.abs().lte(tolerance)) return null;
    return {
      metric,
      asset,
      ours: toDecimalString(ours),
      theirs: toDecimalString(theirs),
      delta: toDecimalString(delta),
      source,
      ourTrace,
    };
  }
  return {
    metric,
    asset,
    ours: ours === null ? null : toDecimalString(ours),
    theirs: theirs === null ? null : toDecimalString(theirs),
    delta: null,
    source,
    ourTrace,
  };
}
