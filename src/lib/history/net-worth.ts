/**
 * Courbe de **valeur nette** consolidée (P38, décision n° 51).
 *
 * La série est définie dès l'origine comme
 *
 * ```
 * valeurNette(jour) = Σ contributions(jour) − Σ passifs(jour)
 * ```
 *
 * où une **contribution** est une interface générique et où un actif crypto valorisé par son cours
 * n'en est qu'un cas particulier. C'est délibéré : P36 (immobilier, assurance-vie, PER, objets) et
 * P41 (actions et ETF) s'y brancheront en ajoutant un producteur, et P37 remplira le terme de
 * passif — aujourd'hui constant à zéro. Aucun des trois ne demandera de réécrire cette courbe.
 *
 * **Deux natures de séries, et c'est là toute la difficulté.** Le côté Investissement est
 * *calculé* du grand livre, au pas strictement quotidien. Le côté Trading est *servi* par la
 * plateforme, à des horodatages irréguliers, sous-échantillonnés (une quarantaine de points pour
 * six mois), commençant à l'ouverture du compte et non à la première opération du grand livre —
 * et impossibles à aligner entre deux comptes. Les additionner point à point serait faux.
 *
 * La contribution du trading est donc **ramenée au pas quotidien** par report du dernier point
 * connu, exactement comme `valueSeries` reporte le dernier cours connu. Conséquence assumée : la
 * courbe consolidée **ne se superpose pas** à celle de l'écran Trading, qui reste volontairement
 * non amincie parce qu'un point par jour écraserait les épisodes violents. Deux objets, deux
 * questions. L'exactitude se prouve ailleurs : `computeTrading` réconcilie déjà
 * `accountValue ≈ Σ flux + Σ closedPnl − Σ frais + Σ funding + latent` et expose l'écart.
 *
 * **Trois états d'un point, jamais confondus** — c'est ce qui sépare un chiffre approché d'un
 * chiffre faux :
 *
 * - normal : tout est valorisé ;
 * - `estimated` : une contribution est portée à son coût faute de cotation. Le total reste
 *   comparable aux apports, il est seulement approché ;
 * - `unavailable` : une contribution n'a **pas pu** être valorisée. Le total est alors
 *   **incomplet, donc trop bas** — pas approché. Il doit se signaler, jamais se fondre dans la
 *   courbe.
 */
import { Big, D, ZERO } from '../domain/money';
import type { DecimalString } from '../domain/types';
import type { ValuePoint } from './series';
import type { DayString } from './types';

/** Valeur d'une contribution un jour donné. */
export interface ContributionValue {
  /** Valeur en euros. */
  value: Big;
  /** Apports nets cumulés en euros à ce jour (versé − retiré), pour la courbe de référence. */
  contributed: Big;
  /** Portée à son coût faute de cotation : comparable aux apports, mais approchée. */
  estimated: boolean;
}

/**
 * Un producteur de valeur pour la courbe de patrimoine. Les avoirs crypto, un compte de trading,
 * demain un bien immobilier ou un contrat d'assurance-vie : tous se présentent ainsi.
 */
export interface Contribution {
  id: string;
  label: string;
  /**
   * Premier jour d'existence. Avant lui la contribution vaut **zéro** — le compte n'existait pas,
   * ce n'est pas une valeur manquante, et la distinction change la courbe.
   */
  firstDay: DayString | null;
  /** `null` = impossible à valoriser en euros ce jour-là : la valeur nette serait incomplète. */
  valueAt(day: DayString): ContributionValue | null;
}

/** Dette. Le terme existe dès maintenant pour que P37 s'y branche sans refonte. */
export interface Liability {
  id: string;
  label: string;
  /** Capital restant dû en euros, ce jour-là. */
  amountAt(day: DayString): Big;
}

export interface NetWorthPoint {
  day: DayString;
  /** Σ contributions valorisées. */
  gross: Big;
  /** Σ passifs. */
  liabilities: Big;
  /** `gross − liabilities`. */
  net: Big;
  /** Σ apports nets cumulés : l'écart avec `net` est le gain. */
  contributed: Big;
  /** Contributions portées à leur coût ce jour-là (identifiants). */
  estimated: readonly string[];
  /** Contributions non valorisables : `net` est INCOMPLET ce jour-là, pas approché. */
  unavailable: readonly string[];
}

export interface NetWorthSeriesInput {
  contributions: readonly Contribution[];
  /** Vide aujourd'hui : P37 le remplira. */
  liabilities?: readonly Liability[];
  days: readonly DayString[];
}

export function netWorthSeries({
  contributions,
  liabilities = [],
  days,
}: NetWorthSeriesInput): NetWorthPoint[] {
  return days.map((day) => {
    let gross = ZERO;
    let contributed = ZERO;
    const estimated: string[] = [];
    const unavailable: string[] = [];

    for (const contribution of contributions) {
      if (contribution.firstDay !== null && day < contribution.firstDay) continue;
      const at = contribution.valueAt(day);
      if (at === null) {
        unavailable.push(contribution.id);
        continue;
      }
      gross = gross.plus(at.value);
      contributed = contributed.plus(at.contributed);
      if (at.estimated) estimated.push(contribution.id);
    }

    let owed = ZERO;
    for (const liability of liabilities) owed = owed.plus(liability.amountAt(day));

    return {
      day,
      gross,
      liabilities: owed,
      net: gross.minus(owed),
      contributed,
      estimated,
      unavailable,
    };
  });
}

/** Dernier élément dont le jour est ≤ `day` (série triée croissante), ou `null`. */
function lastAtOrBefore<T extends { day: DayString }>(
  points: readonly T[],
  day: DayString,
): T | null {
  let low = 0;
  let high = points.length - 1;
  let found: T | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const point = points[mid]!;
    if (point.day <= day) {
      found = point;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/**
 * Contribution des avoirs valorisés au cours du jour, à partir d'une série déjà calculée par
 * `valueSeries`. `missing` non vide signifie « porté au coût » : c'est exactement `estimated`.
 */
export function valueSeriesContribution(
  id: string,
  label: string,
  points: readonly ValuePoint[],
): Contribution {
  const byDay = new Map<DayString, ValuePoint>(points.map((p) => [p.day, p]));
  const sorted = [...points].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return {
    id,
    label,
    firstDay: sorted[0]?.day ?? null,
    valueAt(day) {
      const point = byDay.get(day) ?? lastAtOrBefore(sorted, day);
      if (point === null) return null;
      return { value: point.value, contributed: point.cost, estimated: point.missing.length > 0 };
    },
  };
}

export interface TradingEquityInput {
  id: string;
  label: string;
  /** `accountValueHistory` de la plateforme : `[ms époque, valeur en dollars]`. */
  history: readonly (readonly [number, DecimalString])[];
  /** Jour civil (Paris) d'un instant — même convention que les taux BCE. */
  dayOfMs: (ms: number) => string;
  /**
   * Diviseur ramenant la valeur en dollars vers **la devise d'affichage** — et non vers l'euro par
   * principe. C'est essentiel : `pricesFor` convertit déjà les cours du côté Investissement, si
   * bien qu'un affichage en dollars attend ici `1` et un affichage en euros le taux BCE du jour.
   * Les deux moitiés de la courbe doivent être dans la même unité, sans quoi on additionne des
   * pommes et des poires. `rateLookup` reporte déjà au dernier jour ouvré : week-ends et fériés
   * sont résolus en amont, et `null` ne survient que si aucun taux n'est chargé — la contribution
   * est alors déclarée non valorisable plutôt que convertie au hasard.
   */
  usdPerDisplay: (day: DayString) => DecimalString | null;
  /** Apports nets cumulés en euros (dépôts − retraits) ; absent → zéro. */
  contributedAt?: (day: DayString) => Big;
  /**
   * Équité de l'instantané, plus fraîche que la dernière clôture servie par `portfolio` — les deux
   * viennent de points d'entrée différents et ne sont pas synchronisés. Elle remplace le point du
   * jour, exactement comme `mergeLivePoint` remplace la clôture provisoire d'un cours. Sans cela le
   * dernier point de la courbe ne pourrait pas égaler le total de la Vue d'ensemble.
   */
  live?: { day: DayString; usd: DecimalString } | null;
}

/**
 * Contribution d'un compte de trading, **rééchantillonnée au pas quotidien** : pour chaque jour
 * civil, la dernière équité connue de ce jour ; à défaut, celle du dernier jour connu. Avant le
 * premier point, la contribution est absente (`firstDay`), pas nulle par accident.
 */
export function tradingEquityContribution({
  id,
  label,
  history,
  dayOfMs,
  usdPerDisplay,
  contributedAt,
  live,
}: TradingEquityInput): Contribution {
  // Un point par jour civil : le DERNIER de la journée, c'est-à-dire sa clôture.
  const closes = new Map<DayString, DecimalString>();
  for (const [ms, value] of [...history].sort((a, b) => a[0] - b[0])) {
    closes.set(dayOfMs(ms), value);
  }
  if (live) closes.set(live.day, live.usd);
  const daily = [...closes.entries()]
    .map(([day, usd]) => ({ day, usd }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  return {
    id,
    label,
    firstDay: daily[0]?.day ?? null,
    valueAt(day) {
      const point = lastAtOrBefore(daily, day);
      if (point === null) return null;
      const rate = usdPerDisplay(day);
      if (rate === null) return null;
      const divisor = D(rate);
      if (!divisor.gt(ZERO)) return null;
      return {
        value: D(point.usd).div(divisor),
        contributed: contributedAt?.(day) ?? ZERO,
        estimated: false,
      };
    },
  };
}

/** Dernier point de la série, ou `null` : le total que la Vue d'ensemble doit égaler au centime. */
export function latestNetWorth(points: readonly NetWorthPoint[]): NetWorthPoint | null {
  return points.length === 0 ? null : (points[points.length - 1] ?? null);
}

/** Vrai si au moins un jour de la fenêtre est incomplet — à signaler, jamais à taire. */
export function hasUnavailable(points: readonly NetWorthPoint[]): boolean {
  return points.some((p) => p.unavailable.length > 0);
}
