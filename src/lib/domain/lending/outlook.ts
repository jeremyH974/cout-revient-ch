/**
 * Ce que les contrats annoncent pour la suite : les échéances à venir, agrégées par mois.
 *
 * **Ce module ne prédit rien.** Il additionne les lignes d'échéancier que les contrats portent
 * déjà, et rien d'autre. Un emprunteur peut rembourser par anticipation, prendre du retard ou
 * faire défaut : aucune de ces trois choses ne se devine, et l'écran le dit au lieu de laisser
 * croire à une prévision.
 *
 * **Trois exclusions, toutes délibérées :**
 *
 * 1. **Les prêts soldés** — remboursés, cédés, passés en perte — n'ont plus d'avenir contractuel,
 *    même si leur échéancier d'origine court encore. Un remboursement anticipé laisse justement
 *    derrière lui des lignes qui n'arriveront jamais.
 * 2. **Les échéances déjà dues** (`due <= asOf`) : ce sont des faits, pas des perspectives. Une
 *    échéance en retard appartient au bloc « retard », pas au calendrier de ce qui vient.
 * 3. **Les prêts sans échéancier** ne comptent pas pour zéro (décision n° 9) : ils sont
 *    dénombrés dans `unscheduled`, pour que le graphique dise de combien de prêts il ne parle pas.
 *
 * **Le mois est celui de l'échéance, en date naïve.** Aucune conversion de fuseau : `due` est un
 * `NaiveDateTime`, et son mois se lit sur ses sept premiers caractères. C'est la règle du projet
 * pour toutes les dates de contrat, et elle vaut ici comme ailleurs.
 */
import { D, ZERO, toDecimalString, type Big } from '../money';
import type { DecimalString } from '../types';
import type { LendingReport, LoanStatus } from './types';

/** Un mois de l'échéancier, `YYYY-MM`. */
export type MonthString = string;

export interface OutlookMonth {
  /** `YYYY-MM`. */
  month: MonthString;
  /** Capital annoncé pour ce mois. */
  principal: DecimalString;
  /** Intérêts annoncés pour ce mois, **bruts** : le prélèvement dépend de l'année, pas du contrat. */
  interest: DecimalString;
  /** `principal + interest` — ce que l'échéancier fait tomber sur le compte ce mois-là. */
  total: DecimalString;
}

export interface LendingOutlook {
  /** Mois **consécutifs** de `from` inclus à `from + months`, y compris les mois vides. */
  months: OutlookMonth[];
  /** Σ du capital à venir, tous mois confondus — y compris au-delà de la fenêtre affichée. */
  expectedPrincipal: DecimalString;
  /** Σ des intérêts bruts à venir, au-delà de la fenêtre comprise. */
  expectedInterest: DecimalString;
  /** Prêts vivants dont aucun échéancier n'est connu : l'absence, chiffrée. */
  unscheduled: number;
  /** Prêts vivants dont l'échéancier est connu. `unscheduled + scheduled` = prêts vivants. */
  scheduled: number;
  /** Plus haut total mensuel de la fenêtre, pour cadrer un graphique sans le recalculer. */
  peak: DecimalString;
}

export interface OutlookInput {
  report: LendingReport;
  /** Premier mois affiché, `YYYY-MM`. Par défaut : le mois d'observation du rapport. */
  from?: MonthString;
  /** Nombre de mois affichés, au moins 1. */
  months?: number;
}

/** Un prêt dont il reste quelque chose à attendre. Les autres n'ont plus d'échéancier valide. */
const LIVE: readonly LoanStatus[] = ['pending', 'performing', 'late', 'defaulted'];

/** Mois suivant, sur la seule arithmétique de `YYYY-MM` — aucun `Date`, aucun fuseau. */
export function nextMonth(month: MonthString): MonthString {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`;
}

/**
 * Échéances à venir, agrégées par mois. La fenêtre est **dense** : un mois sans échéance y figure
 * à zéro, parce qu'un graphique dont les colonnes sautent des mois ment sur le rythme.
 */
export function lendingOutlook({ report, from, months = 12 }: OutlookInput): LendingOutlook {
  const asOf = report.asOf;
  const first = from ?? asOf.slice(0, 7);
  const span = Math.max(1, Math.trunc(months));

  const principalBy = new Map<MonthString, Big>();
  const interestBy = new Map<MonthString, Big>();
  let expectedPrincipal = ZERO;
  let expectedInterest = ZERO;
  let unscheduled = 0;
  let scheduled = 0;

  for (const row of report.loans) {
    if (!LIVE.includes(row.status)) continue;
    const schedule = row.loan.schedule;
    if (!schedule || schedule.length === 0) {
      unscheduled += 1;
      continue;
    }
    scheduled += 1;
    for (const instalment of schedule) {
      // Une échéance déjà due est un fait — encaissé ou en retard — jamais une perspective.
      if (instalment.due.slice(0, 10) <= asOf) continue;
      const month = instalment.due.slice(0, 7);
      const principal = D(instalment.principal);
      const interest = D(instalment.interest);
      expectedPrincipal = expectedPrincipal.plus(principal);
      expectedInterest = expectedInterest.plus(interest);
      principalBy.set(month, (principalBy.get(month) ?? ZERO).plus(principal));
      interestBy.set(month, (interestBy.get(month) ?? ZERO).plus(interest));
    }
  }

  const out: OutlookMonth[] = [];
  let peak = ZERO;
  let month = first;
  for (let i = 0; i < span; i++) {
    const principal = principalBy.get(month) ?? ZERO;
    const interest = interestBy.get(month) ?? ZERO;
    const total = principal.plus(interest);
    if (total.gt(peak)) peak = total;
    out.push({
      month,
      principal: toDecimalString(principal),
      interest: toDecimalString(interest),
      total: toDecimalString(total),
    });
    month = nextMonth(month);
  }

  return {
    months: out,
    expectedPrincipal: toDecimalString(expectedPrincipal),
    expectedInterest: toDecimalString(expectedInterest),
    unscheduled,
    scheduled,
    peak: toDecimalString(peak),
  };
}
