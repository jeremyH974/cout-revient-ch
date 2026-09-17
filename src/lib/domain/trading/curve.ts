/**
 * Bilan d'une fenêtre de la courbe de la plateforme (décision n° 162) : la réponse à « suis-je en
 * gain ou en perte sur la période ? ».
 *
 * La courbe d'équité ne répond pas à cette question : elle monte aussi à chaque dépôt, et son plus
 * haut n'est qu'un instant de la fenêtre. Le résultat se lit sur la série de P&L de la plateforme —
 * dernier point moins premier, la plateforme repartant de zéro au début de chaque fenêtre — et ce
 * qui reste de la variation d'équité (dépôts, retraits, transferts) est nommé à part, pour que
 * personne ne le prenne pour un gain.
 *
 * Pur, big.js seulement.
 */
import { D, type Big, type DecimalString } from '../money';

/** Un point de série de la plateforme : instant (ms UTC) et valeur dans la devise de cotation. */
export type CurvePoint = readonly [number, DecimalString];

export interface CurveWindow {
  /** Instants du premier et du dernier point d'équité de la fenêtre. */
  from: number;
  to: number;
  startValue: Big;
  endValue: Big;
  /** Gain (positif) ou perte (négative) de la plateforme sur la fenêtre. */
  pnl: Big;
  /**
   * Variation d'équité qui n'est **pas** du résultat : `(fin − départ) − P&L`, soit les dépôts, les
   * retraits et les transferts de la fenêtre. Déduite, jamais lue : c'est ce qui garantit que
   * `départ + P&L + mouvements = fin` au centime près.
   */
  flows: Big;
}

const byTime = (points: readonly CurvePoint[]): CurvePoint[] =>
  [...points].sort((a, b) => a[0] - b[0]);

/**
 * Bilan d'une fenêtre, ou `null` si l'une des deux séries est vide : pas de résultat plutôt qu'un
 * résultat à zéro, qui se lirait « ni gain ni perte ».
 */
export function curveWindow(
  accountValue: readonly CurvePoint[],
  pnl: readonly CurvePoint[],
): CurveWindow | null {
  const values = byTime(accountValue);
  const results = byTime(pnl);
  const first = values[0];
  const last = values.at(-1);
  const pnlFirst = results[0];
  const pnlLast = results.at(-1);
  if (!first || !last || !pnlFirst || !pnlLast) return null;
  const startValue = D(first[1]);
  const endValue = D(last[1]);
  const result = D(pnlLast[1]).minus(pnlFirst[1]);
  return {
    from: first[0],
    to: last[0],
    startValue,
    endValue,
    pnl: result,
    flows: endValue.minus(startValue).minus(result),
  };
}
