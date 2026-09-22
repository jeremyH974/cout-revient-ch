/**
 * Distance à la liquidation d'une position ouverte (P123) : deux formules écrites SÉPARÉMENT —
 * long `(mark − liq) / mark`, short `(liq − mark) / mark` — pour qu'une erreur de signe sur l'une
 * ne puisse jamais se cacher derrière l'autre (chacune a son propre exemple calculé à la main en
 * test). Le prix de marque est celui de L'INSTANTANÉ lui-même (`|value| / size`, cohérent avec le
 * `liquidationPrice` du MÊME instant), jamais un milieu de carnet recalculé — documentation
 * Hyperliquid, page « Robust price indices » [S47]. Formule de référence de l'exchange :
 * documentation Hyperliquid, page « Liquidations » [S48], consultées le 22/09/2026 (liens complets
 * dans docs/proposals/2026-09-22-coherence-trading-mobile.md).
 * Pur, `big.js` seulement.
 */
import { D, ZERO, parseDecimal, type Big } from '../money';
import type { OpenPosition } from './types';

export interface LiquidationInfo {
  kind: 'value';
  mark: Big;
  liquidationPrice: Big;
  /**
   * Fraction signée de baisse (long) ou de hausse (short) du prix avant liquidation, sur le mark
   * de l'instantané. Positive tant que le seuil n'est pas atteint ; ≤ 0 sinon (`breached`).
   */
  fraction: Big;
  /**
   * Écart de prix signé jusqu'à liquidation, `liquidationPrice − mark` : négatif pour un long (le
   * prix doit baisser pour l'atteindre), positif pour un short (il doit monter).
   */
  priceGap: Big;
  /** `leverageType === 'cross'` : le seuil réel dépend alors du reste du compte, pas seulement de
   * cette position (une bulle d'avertissement à l'affichage, pas un calcul différent ici). */
  crossMargin: boolean;
  /** Fraction ≤ 0 : le seuil est déjà atteint ou dépassé dans cet instantané — signe qu'il est
   * PÉRIMÉ (une position réellement liquidée disparaît du compte), jamais une position saine. */
  breached: boolean;
}

/** `liquidationPrice` absent de l'instantané : état VALIDE — aucun seuil au collatéral actuel,
 * jamais une erreur ni une absence de risque. */
export interface LiquidationNone {
  kind: 'none';
}

/** Taille nulle (ou négative) ou un prix de l'instantané illisible : rien de fiable à calculer. */
export interface LiquidationUnknown {
  kind: 'unknown';
}

export type LiquidationDistance = LiquidationInfo | LiquidationNone | LiquidationUnknown;

/**
 * Heuristique d'AFFICHAGE (badge « proche de la liquidation »), jamais une règle de l'exchange :
 * la marge réelle dépend du reste du compte en marge croisée, et l'instantané peut être périmé de
 * quelques secondes à quelques minutes selon la dernière synchronisation.
 */
export const LIQUIDATION_NEAR: Big = D('0.10');

export function liquidationDistance(p: OpenPosition): LiquidationDistance {
  if (p.liquidationPrice === null) return { kind: 'none' };

  const size = parseDecimal(p.size);
  const value = parseDecimal(p.value);
  const liq = parseDecimal(p.liquidationPrice);
  if (size === null || value === null || liq === null || size.lte(ZERO)) {
    return { kind: 'unknown' };
  }

  // Prix de marque de L'INSTANTANÉ (jamais un milieu de carnet) : valeur notionnelle absolue ÷
  // taille — même recette que `PositionRow.svelte`, réécrite ici indépendamment (moteur pur, qui
  // ne peut rien importer d'un composant).
  const mark = value.abs().div(size);
  if (mark.lte(ZERO)) return { kind: 'unknown' };

  // Formules SÉPARÉES à dessein (voir l'en-tête du fichier) : ne jamais les factoriser en une
  // seule expression signée, même si l'algèbre le permettrait.
  const fraction = p.side === 'long' ? mark.minus(liq).div(mark) : liq.minus(mark).div(mark);

  return {
    kind: 'value',
    mark,
    liquidationPrice: liq,
    fraction,
    priceGap: liq.minus(mark),
    crossMargin: p.leverageType === 'cross',
    breached: fraction.lte(ZERO),
  };
}

export function isNearLiquidation(d: LiquidationDistance): boolean {
  return d.kind === 'value' && d.fraction.lte(LIQUIDATION_NEAR);
}
