/**
 * Performance d'un portefeuille de prêts : TRI (money-weighted), et rien d'autre par défaut.
 *
 * Pourquoi pas le TWR. Un prêt n'a pas de cours : un rendement pondéré par le temps obligerait à
 * INVENTER une valorisation entre deux flux. Les GIPS attendent un rendement pondéré par les flux
 * pour les portefeuilles fermés, à durée fixe ou largement illiquides — précisément quand c'est
 * l'investisseur qui choisit ses dates. Mintos et Bondora font le même choix. `twr.ts` reste
 * volontairement hors de ce périmètre.
 *
 * Deux TRI, jamais un seul. Le brut se compare au taux nominal affiché par la plateforme ; le net
 * est ce que l'investisseur a réellement encaissé, prélèvements à la source déduits. Les
 * confondre est le piège n° 1 de la proposition du 06/09/2026.
 *
 * Périmètre v1 : une seule devise, celle des prêts (EUR chez BienPrêter). Les flux sont exposés
 * pour qu'un convertisseur puisse s'intercaler plus tard sans toucher à ce module.
 */
import { D, ZERO, type Big } from '../money';
import { xirrEur, type XirrFlow, type XirrResult } from '../xirr';
import type { LendingInput, LendingReport } from './types';

export interface LendingFlows {
  /** Flux avant prélèvement à la source : comparable au taux nominal du contrat. */
  gross: XirrFlow[];
  /** Flux réellement encaissés, acompte et prélèvements sociaux déduits. */
  net: XirrFlow[];
}

/**
 * Flux datés du portefeuille. Signe : décaissements négatifs, encaissements positifs. La valeur
 * terminale n'est pas incluse ici — `lendingPerformance` l'ajoute depuis le rapport, pour que les
 * deux notions restent séparables.
 */
export function lendingFlows(input: LendingInput): LendingFlows {
  const gross: XirrFlow[] = [];
  const net: XirrFlow[] = [];
  const push = (at: string, grossAmount: Big, netAmount: Big): void => {
    if (!grossAmount.eq(ZERO)) gross.push({ at, amountEur: grossAmount });
    if (!netAmount.eq(ZERO)) net.push({ at, amountEur: netAmount });
  };

  for (const event of input.events) {
    switch (event.kind) {
      case 'subscription': {
        const out = D(event.amount).times(D('-1'));
        push(event.at, out, out);
        break;
      }
      case 'repayment':
      case 'recovery': {
        const cash = D(event.principal).plus(D(event.interest));
        push(event.at, cash, cash.minus(D(event.withheld)));
        break;
      }
      case 'secondary-sale': {
        const proceeds = D(event.proceeds);
        push(event.at, proceeds, proceeds);
        break;
      }
      default:
        // `late`, `default`, `write-off` ne déplacent aucun euro : ce sont des constats, pas des
        // flux. La perte se voit dans la valeur terminale, qui a fondu.
        break;
    }
  }
  return { gross, net };
}

export interface LendingPerformance {
  gross: XirrResult;
  net: XirrResult;
  /** Valeur terminale retenue : encours + intérêts courus calculables, au jour d'observation. */
  valuation: Big;
}

/**
 * TRI brut et net du portefeuille, valeur terminale prise dans le rapport. Les prêts dont la
 * convention de jours est inconnue entrent par leur encours seul : leur intérêt couru est absent
 * du total (`accrualUnavailable`), et la valeur terminale est donc légèrement SOUS-estimée —
 * ce qui rend le TRI prudent plutôt que flatteur.
 */
export function lendingPerformance(input: LendingInput, report: LendingReport): LendingPerformance {
  const flows = lendingFlows(input);
  const valuation = D(report.totals.value);
  const terminal = valuation.eq(ZERO) ? null : { day: report.asOf, valueEur: valuation };
  return {
    gross: xirrEur(flows.gross, terminal),
    net: xirrEur(flows.net, terminal),
    valuation,
  };
}
