/**
 * La fenêtre d'analyse du Rapport (P118) : flux, gain et rendements d'une plage de jours.
 *
 * Le Rapport calculait tout depuis l'origine ; il honore désormais la plage choisie (`ui.period`
 * et `ui.customRange`, traduits par `resolveWindow` — le seul endroit qui le fasse, décision
 * n° 157). Ce module en est le cœur pur, et il ne rejoue **aucun** grand livre : les flux d'une
 * fenêtre sont un filtre de dates sur UN résultat du moteur, les stocks à une date se lisent sur la
 * série quotidienne (`valueSeries`, dont chaque point vaut la position après la dernière opération
 * du jour).
 *
 * **Une seule convention, pour toutes les mesures.**
 * - Une fenêtre `{ from, to }` couvre les jours `from` à `to`, **bornes incluses** : la lecture
 *   d'une plage libre (`CustomRange`) et celle des trades clos (`tripsClosedIn`).
 * - Le jour d'un horodatage naïf est son préfixe `YYYY-MM-DD` (`dayOfNaive`), jamais converti de
 *   fuseau — la lecture de `holdingStep`, de `twrEur` et de `xirrEur`.
 * - L'état de départ est la **clôture de la veille de `from`**, l'état d'arrivée la clôture de
 *   `to`. Un flux du jour `from` est donc DANS la fenêtre (postérieur à la clôture de la veille),
 *   un flux du jour `to` aussi (antérieur à sa clôture). IAS 1 § 10 : la position « as at the end
 *   of the period », le résultat « for the period ».
 * - `from: null` = depuis l'origine : départ à zéro, rien d'écarté à gauche.
 *
 * **Réalisé d'une fenêtre** : la somme, sur les cessions DATÉES dans la fenêtre, de ce que le
 * moteur a déjà inscrit sur leur ligne (produit − coût moyen × quantité). Une cession hors fenêtre
 * n'est jamais recalculée — la pratique que rapportent Fidelity, Schwab et T. Rowe Price.
 *
 * **Rendement pondéré par le temps** : GIPS 2020, 2.A.24.f, les rendements de sous-périodes se
 * chaînent géométriquement. Valorisé chaque jour, le portefeuille n'a besoin d'aucun retraitement
 * depuis l'origine : la valeur d'ouverture est le point de départ du premier sous-intervalle, et
 * l'on garde la veille de `from` dans la série (2.A.24.d ne vise que les rendements non quotidiens).
 *
 * **Rendement pondéré par les flux** : couper les flux à la fenêtre ferait disparaître tout le
 * capital investi avant `from`. La valeur de marché d'ouverture entre donc comme un premier flux,
 * au signe d'un achat — l'investisseur « rachète » son portefeuille à sa valeur de la veille —, et
 * la valeur de clôture comme valeur finale. C'est l'extension logique de la définition du
 * rendement pondéré par les flux (CFA Institute, « Rates and Returns ») ; aucune source primaire
 * ne l'énonce mot pour mot pour une sous-fenêtre, et on le dit plutôt que de lui prêter une
 * citation.
 */
import type { HistoryEntry } from '../domain/engine';
import { ZERO, type Big } from '../domain/money';
import { twrEur, type TwrDay, type TwrFlow, type TwrResult } from '../domain/twr';
import type { AssetCode, LedgerEvent } from '../domain/types';
import { xirrEur, type XirrFlow, type XirrResult } from '../domain/xirr';
import { addDays, dayOfNaive } from './days';
import { sliceSeries, type DayWindow } from './series';
import type { DayString } from './types';

/** Vrai si l'horodatage (naïf ou jour) tombe dans la fenêtre, bornes incluses. */
export function inWindow(at: string, window: DayWindow): boolean {
  const day = dayOfNaive(at);
  return (window.from === null || day >= window.from) && day <= window.to;
}

/** Jour dont la clôture sert de départ : la veille de `from` ; `null` depuis l'origine. */
export function openingDay(window: DayWindow): DayString | null {
  return window.from === null ? null : addDays(window.from, -1);
}

/**
 * Valeur à la clôture d'un jour : celle du dernier point dont le jour le précède ou l'égale, dans
 * une série triée. Avant le premier point, **zéro** — la série doit donc commencer au plus tard la
 * veille de la première opération, ce que rendent `history.dailySeries` et `history.metricPoints`.
 */
export function valueAt(series: readonly { day: DayString; value: Big }[], day: DayString): Big {
  let value = ZERO;
  for (const point of series) {
    if (point.day > day) break;
    value = point.value;
  }
  return value;
}

export interface WindowInput {
  /** Valeur de clôture par jour, triée, contiguë (`history.metricPoints`, comme le TWR du Rapport). */
  series: readonly TwrDay[];
  /**
   * Flux EXTERNES au signe du portefeuille, + apport et − retrait, virements internes appariés
   * écartés : `externalFlows(report.cashFlows, internalTransferLegs)`, ceux du TWR du Rapport.
   * Un virement interne à cheval sur une borne ferait sinon apparaître un apport que la valeur
   * d'ouverture contient déjà (la série garde l'actif détenu pendant le transit, `holdingOpsOf`).
   */
  flows: readonly TwrFlow[];
  /**
   * Valeur imposée à la clôture de `to`, pour le gain et le rendement pondéré par les flux ; par
   * défaut, le point de la série. Sert la continuité avec la valorisation du Rapport (cotations du
   * jour, actifs sans cours exclus), que le XIRR depuis l'origine emploie déjà.
   */
  closingValue?: Big;
}

function closingOf(input: WindowInput, window: DayWindow): Big {
  return input.closingValue ?? valueAt(input.series, window.to);
}

export interface WindowGain {
  /** Veille de `from`, dont la clôture sert de départ ; `null` depuis l'origine. */
  startDay: DayString | null;
  /** Valeur à la clôture de `startDay` ; zéro depuis l'origine. */
  startValue: Big;
  /** Valeur à la clôture de `to`. */
  endValue: Big;
  /** Apports nets (+) ou retraits nets (−) datés dans la fenêtre. */
  netFlows: Big;
  /** `endValue − startValue − netFlows` : ce que le portefeuille a produit sur la fenêtre. */
  gain: Big;
}

/**
 * Gain de la fenêtre, apports neutralisés. Exactement additif : le gain de deux fenêtres
 * contiguës est celui de leur réunion, parce que la clôture de l'une est l'ouverture de l'autre.
 */
export function windowGain(input: WindowInput, window: DayWindow): WindowGain {
  const startDay = openingDay(window);
  const startValue = startDay === null ? ZERO : valueAt(input.series, startDay);
  const endValue = closingOf(input, window);
  let netFlows = ZERO;
  for (const flow of input.flows)
    if (inWindow(flow.at, window)) netFlows = netFlows.plus(flow.amountEur);
  return {
    startDay,
    startValue,
    endValue,
    netFlows,
    gain: endValue.minus(startValue).minus(netFlows),
  };
}

/**
 * TWR de la fenêtre : la série de la veille de `from` jusqu'à `to`, les mêmes flux, et `twrEur`
 * inchangé — il ignore déjà les flux du premier jour (contenus dans la valeur de départ) et ceux
 * d'après le dernier. Depuis l'origine, c'est le TWR du Rapport tel quel.
 */
export function windowTwr(input: WindowInput, window: DayWindow): TwrResult {
  return twrEur(
    sliceSeries(input.series, { from: openingDay(window), to: window.to }),
    input.flows,
  );
}

/**
 * Rendement pondéré par les flux de la fenêtre, au signe de `xirrEur` (décision n° 27) : ce que
 * l'investisseur verse est négatif, ce qu'il reçoit et la valeur finale positifs. La valeur
 * d'ouverture est datée de la veille de `from`, comme le départ du TWR : les deux mesures couvrent
 * les mêmes jours. Un portefeuille vide à l'ouverture donne un flux nul, que `xirrEur` écarte —
 * d'où la continuité avec le rendement depuis l'origine. Avec `from: null`, c'est exactement
 * `xirrEur` sur les mêmes flux et la même valeur finale.
 */
export function windowMwr(input: WindowInput, window: DayWindow): XirrResult {
  const start = openingDay(window);
  const investor: XirrFlow[] = [];
  if (start !== null) investor.push({ at: start, amountEur: valueAt(input.series, start).neg() });
  for (const flow of input.flows)
    if (inWindow(flow.at, window)) investor.push({ at: flow.at, amountEur: flow.amountEur.neg() });
  return xirrEur(investor, { day: window.to, valueEur: closingOf(input, window) });
}

/** Une ligne d'historique du moteur, réduite à ce que la fenêtre lit. */
export type WindowEntry = Pick<
  HistoryEntry,
  'at' | 'kind' | 'realized' | 'feeEur' | 'rebateEur' | 'valueEur'
>;

export interface WindowFlowsInput {
  /**
   * Positions du périmètre des totaux : ouvertes et clôturées, **jamais bloquées** —
   * `[...holdings(report), ...report.closed]`, comme `aggregate.ts`.
   */
  positions: readonly { asset: AssetCode; history: readonly WindowEntry[] }[];
  /** Grand livre : seuls les revenus (`income`) et les frais hors opération (`fee`) y sont lus. */
  events: readonly LedgerEvent[];
}

/** Les flux de résultat d'une fenêtre, sous les noms de `PortfolioTotals`. */
export interface WindowFlows {
  realized: Big;
  feesEur: Big;
  rebatesEur: Big;
  /** Récompenses valorisées et revenus rattachés à une ligne (dividendes…). */
  otherIncome: Big;
  /** Revenus et frais du compte (intérêts de trésorerie, frais de conversion), décision n° 132. */
  accountIncomeEur: Big;
  subscriptionsEur: Big;
}

/**
 * Flux de résultat datés dans la fenêtre. Avec `from: null` et `to` au-delà de la dernière
 * opération, ce sont les totaux du moteur (`PortfolioTotals`), au centime près et sans tolérance :
 * mêmes lignes, même périmètre. Les revenus et abonnements n'ont pas de ligne d'historique ; ils
 * sont lus sur leurs événements, et un revenu rattaché à une ligne hors périmètre est écarté comme
 * le moteur l'écarte.
 */
export function windowFlows(input: WindowFlowsInput, window: DayWindow): WindowFlows {
  let realized = ZERO;
  let feesEur = ZERO;
  let rebatesEur = ZERO;
  let otherIncome = ZERO;
  let accountIncomeEur = ZERO;
  let subscriptionsEur = ZERO;
  for (const position of input.positions)
    for (const entry of position.history) {
      if (!inWindow(entry.at, window)) continue;
      if (entry.realized !== null) realized = realized.plus(entry.realized);
      feesEur = feesEur.plus(entry.feeEur);
      rebatesEur = rebatesEur.plus(entry.rebateEur);
      // Une récompense entre au coût de sa valeur retenue (zéro par défaut, décision n° 9) :
      // c'est ce montant que le moteur ajoute aux revenus de la ligne.
      if (entry.kind === 'reward') otherIncome = otherIncome.plus(entry.valueEur ?? ZERO);
    }
  const held = new Set(input.positions.map((position) => position.asset));
  for (const event of input.events) {
    if (!inWindow(event.at, window)) continue;
    if (event.kind === 'fee') subscriptionsEur = subscriptionsEur.plus(event.amountEur);
    if (event.kind !== 'income') continue;
    if (event.asset === null) accountIncomeEur = accountIncomeEur.plus(event.grossEur);
    else if (held.has(event.asset)) otherIncome = otherIncome.plus(event.grossEur);
  }
  return { realized, feesEur, rebatesEur, otherIncome, accountIncomeEur, subscriptionsEur };
}
