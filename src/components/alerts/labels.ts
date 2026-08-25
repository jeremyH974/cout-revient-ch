/** Libellés français des règles d'alerte (affichage seulement, jamais interprétés). */
import type { AlertRule } from '$lib/domain/alerts';
import { fmtPrice } from '$lib/format/fr';

const NBSP = String.fromCharCode(0xa0);

/** '12.5' → « 12,5 % » (le pourcentage d'une règle est une magnitude saisie, pas un ratio). */
export function pctText(percent: string): string {
  return `${percent.replace('.', ',')}${NBSP}%`;
}

/** Description courte d'une règle : « Sous le PRU de 10 % », « Prix ≥ 50 000 € »… */
export function ruleLabel(rule: AlertRule): string {
  const t = rule.threshold;
  if (t.kind === 'price')
    return `Prix ${rule.direction === 'below' ? '≤' : '≥'} ${fmtPrice(t.priceEur)}`;
  if (t.kind === 'pru-net-pct')
    return t.percent === '0'
      ? 'Équilibre net de frais de vente'
      : `Objectif net de frais${NBSP}: +${pctText(t.percent)}`;
  if (rule.direction === 'below')
    return t.percent === '0' ? 'Passage sous le PRU' : `Sous le PRU de ${pctText(t.percent)}`;
  return t.percent === '0' ? 'Retour au PRU' : `PRU +${pctText(t.percent)}`;
}

/** Sens lisible du déclenchement (liste et historique). */
export function directionLabel(direction: AlertRule['direction']): string {
  return direction === 'below' ? 'passe sous' : 'atteint';
}
