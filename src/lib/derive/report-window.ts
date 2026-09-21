/**
 * Ce que la synthèse du Rapport lit sur une plage d'analyse (P118, décision n° 179).
 *
 * **Une règle, donc une fonction pure.** Elle vivait dans l'état (`history.reportWindow`), où rien ne
 * l'exécute sous test — c'est la CI qui l'a rappelé : le seuil de couverture de `src/state` a fléchi
 * sous ses trente lignes, de 2,6 % à 2,58 %. Plutôt que de baisser le seuil, la règle rejoint les
 * dérivations testables (décision n° 94) ; l'état ne garde que le câblage.
 *
 * Elle n'ajoute aucun calcul au cœur (`history/window.ts`) : elle l'assemble. Deux choix seulement
 * lui appartiennent, et ils sont ce que les tests surveillent :
 *
 * - **la valeur finale** : quand la plage finit le jour de génération, c'est celle du moteur
 *   (`closingValue`), pour que le résultat de la plage se recoupe avec la valeur affichée en tête
 *   du rapport ; sinon, la clôture de `to` lue sur la série ;
 * - **le coût de revient de fin de plage** : celui du dernier point de la série à la date de fin ou
 *   avant, base du latent quand la plage s'arrête dans le passé.
 */
import { ZERO, type Big } from '../domain/money';
import type { ReportWindow } from '../export/report-model';
import type { DayWindow } from '../history/series';
import {
  windowFlows,
  windowGain,
  windowMwr,
  type WindowFlowsInput,
  type WindowInput,
} from '../history/window';
import { presentMoneyWeighted } from './presented-return';

export interface ReportWindowInput {
  /** Série quotidienne du portefeuille, triée : valeur ET coût de revient de clôture par jour. */
  series: readonly { day: string; value: Big; cost: Big; estimated: boolean }[];
  /** Flux externes au signe du portefeuille, virements internes écartés (`externalFlows`). */
  flows: WindowInput['flows'];
  /** Positions du périmètre des totaux : `[...holdings(report), ...report.closed]`. */
  positions: WindowFlowsInput['positions'];
  /** Le grand livre dont le rapport est issu. */
  events: WindowFlowsInput['events'];
}

export interface ReportWindowOptions {
  /** Libellé de la plage, tel que la page de garde l'écrit. */
  label: string;
  /** Vrai quand la plage finit le jour de génération du rapport. */
  endsToday: boolean;
  /** Valeur du portefeuille selon le moteur : la valeur finale quand la plage finit aujourd'hui. */
  closingValue: Big;
}

/**
 * Coût de revient à la clôture d'un jour : celui du dernier point dont le jour le précède ou
 * l'égale. Avant le premier point, zéro — le portefeuille n'existait pas encore.
 */
export function costAt(series: ReportWindowInput['series'], day: string): Big {
  let cost = ZERO;
  for (const point of series) {
    if (point.day > day) break;
    cost = point.cost;
  }
  return cost;
}

export function reportWindowFigures(
  input: ReportWindowInput,
  window: DayWindow,
  opts: ReportWindowOptions,
): ReportWindow {
  const core: WindowInput = {
    series: input.series,
    flows: input.flows,
    ...(opts.endsToday ? { closingValue: opts.closingValue } : {}),
  };
  const gain = windowGain(core, window);
  const flows = windowFlows({ positions: input.positions, events: input.events }, window);
  return {
    from: window.from,
    to: window.to,
    label: opts.label,
    endsToday: opts.endsToday,
    startValue: gain.startValue,
    endValue: gain.endValue,
    endCost: costAt(input.series, window.to),
    netFlows: gain.netFlows,
    gain: gain.gain,
    realized: flows.realized,
    mwr: presentMoneyWeighted(windowMwr(core, window)),
  };
}
