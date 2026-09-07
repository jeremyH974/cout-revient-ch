/**
 * Lecture d'un contrat de prêt BienPrêter : ce que l'export CSV ne dit pas.
 *
 * L'export « transactions » donne les mouvements, jamais les termes du contrat — ni taux, ni
 * durée, ni convention de jours. Le moteur les portait donc en `unknown`, ce qui privait le
 * portefeuille de ses intérêts courus et de toute détection de retard. **Le contrat, lui, les
 * écrit noir sur blanc**, et il porte en annexe l'échéancier attendu, daté.
 *
 * **Ce module ne lit que des lignes de texte**, produites par `../pdf`. Il n'a aucune idée de ce
 * qu'est un PDF : cela le rend testable sans en fabriquer un, et réutilisable si la plateforme
 * publiait un jour ses contrats dans un autre format.
 *
 * **Rien n'est deviné.** Une déduction du taux à partir des seuls remboursements avait été tentée
 * puis écartée : sur un portefeuille réel elle ne convergeait que pour un prêt sur quatre, et un
 * taux faux gonfle silencieusement la valeur du portefeuille. Ici chaque champ est LU ; ce qui ne
 * se lit pas reste absent.
 */
import type { Amortisation, DayCount, ScheduledInstalment } from '../../domain/lending/types';
import { D, toDecimalString } from '../../domain/money';
import type { DecimalString, NaiveDateTime } from '../../domain/types';
import { parseNaiveDateTime } from '../coinhouse/rows';

export interface BienPreterContract {
  /** Taux nominal annuel en fraction (`0.15` pour 15 %). */
  rate: DecimalString;
  /** Durée contractuelle en mois. */
  months: number | null;
  dayCount: DayCount;
  amortisation: Amortisation;
  /** Dernière échéance de l'annexe ; `null` si l'échéancier n'a pas été lu. */
  maturity: NaiveDateTime | null;
  schedule: ScheduledInstalment[];
}

/** `dd/MM/yyyy` → date-heure naïve à minuit, comme le reste des imports du projet. */
function day(raw: string): NaiveDateTime | null {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(raw) ? parseNaiveDateTime(`${raw} 00:00:00`) : null;
}

/** `1 234,56` ou `1234.56` → décimal canonique ; `null` si la forme est inconnue. */
function amount(raw: string): DecimalString | null {
  const clean = raw.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(clean) ? toDecimalString(D(clean)) : null;
}

const RATE =
  /taux (?:d[’']intérêts conventionnel applicable au prêt est de|fixe annuel de|annuel de)\s*([\d.,]+)\s*%/i;
const MONTHS = /durée de\s*(\d+)\s*mois/i;
const BASIS = /calculés sur la base d[’']une\s+([^.]{0,40})\./i;

/**
 * Convention de jours, telle que le contrat la nomme. « Année civile » est une base de 365 jours
 * réels ; toute autre formulation reste `unknown` plutôt que d'être rapprochée d'une convention
 * voisine — un intérêt couru calculé sous une convention supposée ne recolle jamais à l'IFU.
 */
function dayCountOf(basis: string | null): DayCount {
  if (basis === null) return 'unknown';
  const text = basis.toLowerCase();
  if (text.includes('année civile') || text.includes('365')) return 'act/365';
  if (text.includes('360')) return '30/360';
  return 'unknown';
}

/** Une ligne d'échéancier : trois dates puis trois montants (capital, intérêts, restant dû). */
const ROW =
  /(\d{2}\/\d{2}\/\d{4})\D*?(\d{2}\/\d{2}\/\d{4})\D*?(\d{2}\/\d{2}\/\d{4})[^\d]*([\d\s\u00a0\u202f.,]+?)\s*€[^\d]*([\d\s\u00a0\u202f.,]+?)\s*€[^\d]*([\d\s\u00a0\u202f.,]+?)\s*€/;

function scheduleOf(rows: readonly string[]): ScheduledInstalment[] {
  const out: ScheduledInstalment[] = [];
  for (const row of rows) {
    const m = ROW.exec(row);
    if (!m) continue;
    // La date d'échéance est la troisième : la première est la date de facture, la deuxième
    // celle du prélèvement. Se tromper de colonne décalerait tout l'échéancier.
    const due = day(m[3]!);
    const principal = amount(m[4]!);
    const interest = amount(m[5]!);
    const outstanding = amount(m[6]!);
    if (!due || principal === null || interest === null || outstanding === null) continue;
    out.push({ due, principal, interest, outstanding });
  }
  out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return out;
}

/** Deux montants proches à un centime près : les annexes arrondissent chaque ligne. */
const near = (a: DecimalString, b: DecimalString): boolean => D(a).minus(D(b)).abs().lte('0.01');

/**
 * Mode d'amortissement, déduit de la FORME de l'échéancier — pas d'une phrase du contrat, qui
 * emploie « amortissable ou in fine » sans trancher.
 */
function amortisationOf(schedule: readonly ScheduledInstalment[]): Amortisation {
  if (schedule.length < 2) return 'unknown';
  const body = schedule.slice(0, -1);
  if (body.every((row) => D(row.principal).eq('0'))) return 'in-fine';
  const first = schedule[0]!;
  if (schedule.every((row) => near(row.principal, first.principal))) return 'linear';
  const total = (row: ScheduledInstalment): DecimalString =>
    toDecimalString(D(row.principal).plus(D(row.interest)));
  const reference = total(first);
  if (schedule.every((row) => near(total(row), reference))) return 'constant';
  return 'unknown';
}

/**
 * Termes d'un contrat, lus dans ses lignes de texte. `null` quand le document ne porte pas même
 * un taux : ce n'est alors pas un contrat de prêt, et le dire vaut mieux que rendre un objet vide.
 */
export function parseBienPreterContract(rows: readonly string[]): BienPreterContract | null {
  const flat = rows.join(' ').replace(/\s+/g, ' ');
  const rate = RATE.exec(flat);
  if (!rate) return null;
  const percent = amount(rate[1]!);
  if (percent === null) return null;
  const months = MONTHS.exec(flat);
  const schedule = scheduleOf(rows);
  return {
    rate: toDecimalString(D(percent).div(D('100'))),
    months: months ? Number(months[1]) : null,
    dayCount: dayCountOf(BASIS.exec(flat)?.[1] ?? null),
    amortisation: amortisationOf(schedule),
    maturity: schedule.length > 0 ? schedule[schedule.length - 1]!.due : null,
    schedule,
  };
}
