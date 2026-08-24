/**
 * TWR — rendement pondéré par le TEMPS (*time-weighted*), c'est-à-dire hors effet du calendrier
 * des apports : il répond à « mes choix étaient-ils bons ? » là où le XIRR répond à « mon argent
 * a-t-il rapporté ? ». Méthode : Dietz modifié **à l'intérieur** de chaque jour, puis chaînage
 * multiplicatif des jours (approche recommandée quand on valorise quotidiennement sans valoriser
 * à l'instant exact de chaque flux) :
 *
 *   base_t = V_{t−1} + Σ_i w_i · F_i          w_i = fraction du jour RESTANT après le flux i
 *   R_t    = (V_t − V_{t−1} − F_t) / base_t   (base_t ≤ 0 → jour neutralisé, R_t = 0)
 *   TWR    = Π (1 + R_t) − 1
 *
 * `w_i` traduit un fait simple : un achat passé à 23 h n'a pas pu produire de rendement ce jour-là,
 * un achat de 0 h 30 a travaillé presque toute la journée. Sans heure connue, 0,5 (hypothèse
 * classique de milieu de période).
 *
 * Montants en `Big` de bout en bout ; le seul flottant est l'exposant d'annualisation — un taux
 * n'est pas un montant (décision n° 27), il ne repart jamais dans un calcul monétaire.
 */
import { epochDayOf } from './date';
import { Big, D, ONE, ZERO } from './money';
import type { NaiveDateTime } from './types';

/** Valeur de marché du portefeuille à la clôture d'un jour. */
export interface TwrDay {
  day: string;
  value: Big;
  /** Vrai si au moins une position détenue ce jour-là n'avait aucune cotation (valorisée au coût). */
  estimated?: boolean;
}

/** Flux EXTERNE : positif = apport vers le portefeuille, négatif = retrait. */
export interface TwrFlow {
  at: NaiveDateTime;
  amountEur: Big;
}

export type TwrFailure = 'insufficient-series' | 'no-base';

export type TwrResult =
  | {
      ok: true;
      /** Rendement cumulé sur la fenêtre (0.12 = +12 %). */
      cumulative: Big;
      /** Annualisé en base 365 ; `null` en dessous de `TWR_MIN_SPAN_DAYS`. */
      annualized: Big | null;
      since: string;
      until: string;
      /** Nombre de jours calendaires entre le premier et le dernier point. */
      days: number;
      /** Jours dont la valeur reposait au moins en partie sur des positions sans cotation. */
      estimatedDays: number;
      /** Jours écartés du chaînage faute de base positive (portefeuille vide au départ du jour). */
      neutralizedDays: number;
    }
  | { ok: false; reason: TwrFailure };

/** En dessous, annualiser amplifierait le bruit : on montre le cumulé, pas un taux annuel. */
export const TWR_MIN_SPAN_DAYS = 30;

const DAY_SECONDS = 86_400;
const SECONDS = D(String(DAY_SECONDS));
const HALF = D('0.5');
/** Décimales conservées par le produit chaîné (voir la note dans `twrEur`). */
const CHAIN_DP = 18;

/**
 * Fraction du jour restant après l'instant `at` : 1 à minuit pile, 0 à la toute fin de journée.
 * Sans partie horaire exploitable, 0,5.
 */
export function remainingDayFraction(at: NaiveDateTime): Big {
  const match = /T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(at);
  if (!match) return HALF;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? '0');
  if (hours > 23 || minutes > 59 || seconds > 59) return HALF;
  const elapsed = hours * 3600 + minutes * 60 + seconds;
  return SECONDS.minus(D(String(elapsed))).div(SECONDS);
}

interface DayFlows {
  net: Big;
  weighted: Big;
}

/**
 * TWR d'une série quotidienne (jours contigus, triés) et de ses flux externes. Les flux datés au
 * premier jour de la série ou avant sont considérés déjà contenus dans sa valeur de départ ; ceux
 * postérieurs au dernier jour sont ignorés.
 */
export function twrEur(days: readonly TwrDay[], flows: readonly TwrFlow[]): TwrResult {
  if (days.length < 2) return { ok: false, reason: 'insufficient-series' };
  const first = days[0]!;
  const last = days[days.length - 1]!;

  const byDay = new Map<string, DayFlows>();
  for (const flow of flows) {
    const day = flow.at.slice(0, 10);
    if (day <= first.day || day > last.day) continue;
    const entry = byDay.get(day) ?? { net: ZERO, weighted: ZERO };
    entry.net = entry.net.plus(flow.amountEur);
    entry.weighted = entry.weighted.plus(flow.amountEur.times(remainingDayFraction(flow.at)));
    byDay.set(day, entry);
  }

  let chained = ONE;
  let estimatedDays = 0;
  let neutralizedDays = 0;
  let chainedAny = false;
  for (let i = 1; i < days.length; i++) {
    const today = days[i]!;
    const yesterday = days[i - 1]!;
    if (today.estimated === true) estimatedDays++;
    const { net, weighted } = byDay.get(today.day) ?? { net: ZERO, weighted: ZERO };
    const base = yesterday.value.plus(weighted);
    if (base.lte(ZERO)) {
      // Portefeuille vide au départ du jour (ou apport en toute fin de journée) : aucun capital
      // n'a travaillé, le jour ne peut pas porter de rendement. Neutralisé plutôt que divisé.
      if (!net.eq(ZERO) || !today.value.eq(yesterday.value)) neutralizedDays++;
      continue;
    }
    const factor = ONE.plus(today.value.minus(yesterday.value).minus(net).div(base));
    if (factor.lte(ZERO)) {
      // Perte de plus de 100 % en un jour : impossible sur un portefeuille détenu, donc une
      // donnée aberrante. On neutralise au lieu d'annuler tout le chaînage.
      neutralizedDays++;
      continue;
    }
    // Arrondi à chaque pas : sans lui, le produit chaîné garde TOUTE la précision de chacun de ses
    // facteurs et gagne des dizaines de décimales par journée — sur cinq ans d'historique le calcul
    // devient quadratique et se traîne. 18 décimales sont dix ordres de grandeur au-delà de ce qui
    // est affiché ; l'erreur accumulée reste négligeable devant le bruit des cotations.
    chained = chained.times(factor).round(CHAIN_DP, Big.roundHalfUp);
    chainedAny = true;
  }
  if (!chainedAny) return { ok: false, reason: 'no-base' };

  const fromEpoch = epochDayOf(first.day);
  const toEpoch = epochDayOf(last.day);
  if (fromEpoch === null || toEpoch === null) return { ok: false, reason: 'insufficient-series' };
  const span = toEpoch - fromEpoch;
  const cumulative = chained.minus(ONE);
  return {
    ok: true,
    cumulative,
    annualized: span >= TWR_MIN_SPAN_DAYS ? annualize(chained, span) : null,
    since: first.day,
    until: last.day,
    days: span,
    estimatedDays,
    neutralizedDays,
  };
}

/** `(1 + TWR)^(365/jours) − 1`. Seule frontière flottante du module (exposant non entier). */
function annualize(growth: Big, days: number): Big {
  const value = Math.pow(Number(growth.toString()), 365 / days) - 1;
  if (!Number.isFinite(value)) return ZERO;
  return D(value.toFixed(12));
}
