/**
 * Ce qu'un rapport a le droit de PRÉSENTER d'un rendement : annualisé, cumulé sur sa période, ou
 * rien (P118).
 *
 * **La règle.** GIPS 2020 pour les sociétés de gestion, disposition 2.A.12 : « Returns for periods
 * of less than one year must not be annualized. » Sous un an, on présente le rendement de la
 * période elle-même, désigné par ses dates (Q&A GIPS n° 5014). Transposée au rendement pondéré par
 * les flux, c'est 5.A.1.b : un historique de moins d'un an se présente par son rendement depuis
 * l'origine **non annualisé**.
 *
 * **Deux seuils, qu'il ne faut pas confondre.** Les 30 jours de `twr.ts` et de `xirr.ts`
 * (`TWR_MIN_SPAN_DAYS`, `XIRR_MIN_SPAN_DAYS`) sont un PLANCHER DE BRUIT du moteur : en dessous, le
 * XIRR refuse de rendre un taux et le TWR n'annualise pas. Ils ne bougent pas. Les 365 jours d'ici
 * sont une règle de PRÉSENTATION, posée par-dessus : entre 30 et 365 jours le moteur sait
 * annualiser, et le rapport ne le montre pas. 1,5 % gagnés en trente jours deviendraient 19,9 %
 * « par an » — un chiffre que le portefeuille n'a jamais produit.
 *
 * **Les deux mesures n'ont pas la même forme native**, d'où `basis`. Le TWR est un rendement
 * CUMULÉ, Π(1 + R_t) − 1, qu'on annualise au-delà d'un an. Le XIRR est un taux ANNUEL par
 * construction (base 365 fixe, décision n° 27), qu'on ramène à sa période en deçà :
 * `(1 + r)^(jours/365) − 1` — le rendement que l'argent a réellement produit sur ces jours-là.
 *
 * **Un taux n'est pas un montant** (décision n° 27) : l'exposant non entier passe par le flottant,
 * comme `annualize` de `twr.ts` et le solveur de `xirr.ts`, et le résultat revient en décimal à
 * douze chiffres. Rien de ce qui sort d'ici ne repart dans un calcul monétaire.
 */
import { epochDayOf } from '../domain/date';
import { D, ONE, type Big } from '../domain/money';
import type { TwrFailure, TwrResult } from '../domain/twr';
import type { XirrFailure, XirrResult } from '../domain/xirr';

/**
 * GIPS 2020, 2.A.12 : sous un an, aucun rendement n'est annualisé. Compté en jours calendaires
 * entre la première et la dernière valorisation, comme le `days` du TWR ; une année civile
 * (clôture du 31 décembre à clôture du 31 décembre suivant) en compte 365 ou 366, et l'atteint.
 */
export const ANNUALIZE_MIN_DAYS = 365;

/** Jours d'une année pour convertir un taux : la base 365 fixe du XIRR (Excel) et du TWR. */
export const DAYS_PER_YEAR = 365;

/** Forme native de la mesure : cumulée sur la période (TWR) ou annuelle (XIRR). */
export type ReturnBasis = 'cumulative' | 'annual';

export interface ReturnFigure {
  basis: ReturnBasis;
  /** Ratio : 0.12 = +12 %. */
  value: Big;
  /** Premier et dernier jour valorisés (`YYYY-MM-DD`) : la période que le chiffre couvre. */
  since: string;
  until: string;
}

export type PresentedKind = 'annualized' | 'cumulative';

/**
 * Pourquoi rien n'est présenté : l'échec du moteur tel quel (`too-recent` est le plancher de bruit
 * du XIRR), une période illisible ou renversée, ou une croissance négative dont aucune puissance
 * réelle n'existe.
 */
export type NotPresented = TwrFailure | XirrFailure | 'invalid-period' | 'invalid-rate';

export type PresentedReturn =
  | {
      kind: PresentedKind;
      value: Big;
      /** Jours calendaires de `since` à `until` : c'est lui qui a décidé de `kind`. */
      spanDays: number;
      /** Bornes à afficher avec le chiffre : une période partielle se désigne par ses dates. */
      since: string;
      until: string;
    }
  | { kind: 'none'; reason: NotPresented };

/**
 * Le chiffre présentable : annualisé à partir d'un an, rendement de la période en deçà. Chaque
 * mesure n'est convertie que lorsque sa forme native ne convient pas.
 */
export function presentReturn(figure: ReturnFigure): PresentedReturn {
  const since = epochDayOf(figure.since);
  const until = epochDayOf(figure.until);
  if (since === null || until === null || until < since)
    return { kind: 'none', reason: 'invalid-period' };
  const spanDays = until - since;
  const annualized = spanDays >= ANNUALIZE_MIN_DAYS;
  const value = annualized
    ? figure.basis === 'annual'
      ? figure.value
      : annualizedRate(figure.value, spanDays)
    : figure.basis === 'cumulative'
      ? figure.value
      : periodRate(figure.value, spanDays);
  if (value === null) return { kind: 'none', reason: 'invalid-rate' };
  return {
    kind: annualized ? 'annualized' : 'cumulative',
    value,
    spanDays,
    since: figure.since,
    until: figure.until,
  };
}

/** Rendement pondéré par le temps (`twrEur`, depuis l'origine ou sur une fenêtre). */
export function presentTimeWeighted(twr: TwrResult): PresentedReturn {
  if (!twr.ok) return { kind: 'none', reason: twr.reason };
  return presentReturn({
    basis: 'cumulative',
    value: twr.cumulative,
    since: twr.since,
    until: twr.until,
  });
}

/**
 * Rendement pondéré par les flux (`xirrEur`, depuis l'origine ou sur une fenêtre). Sous trente
 * jours le moteur n'a rien rendu (`too-recent`) : il n'y a rien à présenter, et on ne le
 * remplace par rien d'autre.
 */
export function presentMoneyWeighted(xirr: XirrResult): PresentedReturn {
  if (!xirr.ok) return { kind: 'none', reason: xirr.reason };
  return presentReturn({ basis: 'annual', value: xirr.rate, since: xirr.since, until: xirr.until });
}

/**
 * Taux annuel → rendement de la période : `(1 + r)^(jours/365) − 1`. `null` si `1 + r < 0`,
 * croissance qu'aucune puissance réelle ne prolonge.
 */
export function periodRate(annualRate: Big, spanDays: number): Big | null {
  return compound(ONE.plus(annualRate), spanDays / DAYS_PER_YEAR);
}

/**
 * Rendement cumulé → taux annuel : `(1 + R)^(365/jours) − 1`, la formule d'`annualize` dans
 * `twr.ts`. `null` si `1 + R < 0`. `presentReturn` ne l'appelle qu'au-delà d'un an.
 */
export function annualizedRate(cumulative: Big, spanDays: number): Big | null {
  return compound(ONE.plus(cumulative), DAYS_PER_YEAR / spanDays);
}

/** `croissance^exposant − 1` : la seule frontière flottante du module (exposant non entier). */
function compound(growth: Big, exponent: number): Big | null {
  const value = Math.pow(Number(growth.toString()), exponent) - 1;
  return Number.isFinite(value) ? D(value.toFixed(12)) : null;
}
