/**
 * Filtre à facettes des trades journalisés (P121) : recherche libre + facettes en puces (sens,
 * issue, setup, erreur, tag, compte), plus la synthèse chiffrée du sous-ensemble filtré — la MÊME
 * recette que l'écran Statistiques (`TradeStats.svelte:31-42`), pour que les deux écrans donnent
 * toujours les mêmes chiffres sur les mêmes trades.
 *
 * Pur, sans accès à l'état de l'application : le libellé d'un compte est fourni par l'appelant
 * (`FilterContext.accountLabel`), comme `statsBuckets` reçoit son `labelOf`.
 *
 * Sémantique des facettes, standard : ET entre facettes, OU à l'intérieur d'une facette ; une
 * facette vide ne contraint rien. `win`/`loss` reprennent tels quels `outcomeOf` de `stats.ts`
 * (jamais redéfinis ici) ; `unannotated` = trade clos sans journal (`needsAnnotation`, réutilisée
 * par la pastille de l'écran). Les tags se comparent par leur clé normalisée (`tagKey`, `./tags`).
 */
import type { AccountId } from '../types';
import type { JournalEntry, JournaledTrip } from './journal';
import type { RoundTrip } from './round-trips';
import {
  computeStats,
  outcomeOf,
  tripsClosedIn,
  type DayWindow,
  type ToDisplay,
  type TradingStats,
} from './stats';
import { tagKey, tagUsage, type TagUsage } from './tags';

export type TradeSide = RoundTrip['direction'];
export type TradeOutcome = 'win' | 'loss' | 'open' | 'unannotated';

export interface TradeFilter {
  /** Texte libre, insensible à la casse et aux accents. */
  readonly query: string;
  readonly sides: readonly TradeSide[];
  readonly outcomes: readonly TradeOutcome[];
  readonly setups: readonly string[];
  readonly mistakes: readonly string[];
  /** Clés normalisées (`tagKey`), jamais des libellés bruts. */
  readonly tags: readonly string[];
  readonly accounts: readonly AccountId[];
}

export const EMPTY_FILTER: TradeFilter = {
  query: '',
  sides: [],
  outcomes: [],
  setups: [],
  mistakes: [],
  tags: [],
  accounts: [],
};

/** Ce que le domaine ne peut pas savoir seul : le libellé d'affichage d'un compte. */
export interface FilterContext {
  accountLabel: (id: AccountId) => string;
}

export function isFilterActive(filter: TradeFilter): boolean {
  return (
    filter.query.trim() !== '' ||
    filter.sides.length > 0 ||
    filter.outcomes.length > 0 ||
    filter.setups.length > 0 ||
    filter.mistakes.length > 0 ||
    filter.tags.length > 0 ||
    filter.accounts.length > 0
  );
}

const FACET_KEYS = ['sides', 'outcomes', 'setups', 'mistakes', 'tags', 'accounts'] as const;

/**
 * Nombre de facettes (hors recherche libre) qui portent au moins une valeur — pour le bouton
 * « Filtres (n) » de la feuille qui les regroupe.
 */
export function activeFacetCount(filter: TradeFilter): number {
  return FACET_KEYS.reduce((n, key) => n + (filter[key].length > 0 ? 1 : 0), 0);
}

/**
 * Trade clos sans entrée de journal (`journal === null` : `journaledTrip` fait déjà de « entrée
 * entièrement vide » un « pas de journal »). Exportée pour que la pastille de l'écran compte
 * exactement ce que la facette « à annoter » filtre — jamais deux définitions séparées.
 */
export function needsAnnotation(t: JournaledTrip): boolean {
  return t.trip.status === 'closed' && t.journal === null;
}

function foldDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('fr');
}

function matchesQuery(t: JournaledTrip, query: string, ctx: FilterContext): boolean {
  const needle = foldDiacritics(query.trim());
  if (needle === '') return true;
  const haystack: string[] = [t.trip.symbol, ctx.accountLabel(t.trip.accountId)];
  if (t.journal) {
    haystack.push(t.journal.thesis, t.journal.review, t.journal.setup ?? '');
    haystack.push(...t.journal.mistakes, ...t.journal.tags);
  }
  return haystack.some((h) => foldDiacritics(h).includes(needle));
}

function matchesOutcome(t: JournaledTrip, outcome: TradeOutcome): boolean {
  switch (outcome) {
    case 'open':
      return t.trip.status === 'open';
    case 'unannotated':
      return needsAnnotation(t);
    case 'win':
      return t.trip.status === 'closed' && outcomeOf(t.trip) === 'win';
    case 'loss':
      return t.trip.status === 'closed' && outcomeOf(t.trip) === 'loss';
  }
}

function matchesFilter(t: JournaledTrip, filter: TradeFilter, ctx: FilterContext): boolean {
  if (!matchesQuery(t, filter.query, ctx)) return false;
  if (filter.sides.length > 0 && !filter.sides.includes(t.trip.direction)) return false;
  // OU à l'intérieur de la facette : une seule issue sélectionnée suffit à faire matcher le trade.
  if (filter.outcomes.length > 0 && !filter.outcomes.some((o) => matchesOutcome(t, o))) {
    return false;
  }
  if (filter.setups.length > 0) {
    const setup = t.journal?.setup ?? null;
    if (setup === null || !filter.setups.includes(setup)) return false;
  }
  if (filter.mistakes.length > 0) {
    const own = t.journal?.mistakes ?? [];
    if (!filter.mistakes.some((m) => own.includes(m))) return false;
  }
  if (filter.tags.length > 0) {
    const ownKeys = (t.journal?.tags ?? []).map(tagKey);
    if (!filter.tags.some((k) => ownKeys.includes(k))) return false;
  }
  if (filter.accounts.length > 0 && !filter.accounts.includes(t.trip.accountId)) return false;
  return true;
}

/** Applique le filtre en conservant l'ordre d'entrée de `list`. */
export function applyFilter(
  list: readonly JournaledTrip[],
  filter: TradeFilter,
  ctx: FilterContext,
): JournaledTrip[] {
  return list.filter((t) => matchesFilter(t, filter, ctx));
}

export interface FacetValueCount<T> {
  readonly value: T;
  readonly count: number;
}

export interface TradeFacetOptions {
  readonly sides: readonly FacetValueCount<TradeSide>[];
  readonly outcomes: readonly FacetValueCount<TradeOutcome>[];
  readonly setups: readonly FacetValueCount<string>[];
  readonly mistakes: readonly FacetValueCount<string>[];
  /** Une entrée par CLÉ de tag ; `label` porte la casse la plus fréquente (`tagUsage`). */
  readonly tags: readonly TagUsage[];
  readonly accounts: readonly FacetValueCount<AccountId>[];
}

function tally<T extends string>(values: Iterable<T>): FacetValueCount<T>[] {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value), 'fr'));
}

function outcomesOf(t: JournaledTrip): TradeOutcome[] {
  // Un même trade peut peupler PLUSIEURS puces à la fois (clos, perdant ET pas encore annoté) :
  // ce ne sont pas des catégories exclusives, comme `matchesOutcome` le fait déjà pour le filtre.
  const out: TradeOutcome[] = [];
  if (t.trip.status === 'open') out.push('open');
  if (t.trip.status === 'closed') {
    const o = outcomeOf(t.trip);
    if (o === 'win') out.push('win');
    if (o === 'loss') out.push('loss');
  }
  if (needsAnnotation(t)) out.push('unannotated');
  return out;
}

/** Valeurs présentes dans `list`, avec leur compte — pour peupler les puces de chaque facette. */
export function facetOptions(list: readonly JournaledTrip[]): TradeFacetOptions {
  const journals: Record<string, JournalEntry> = {};
  for (const t of list) if (t.journal) journals[t.trip.id] = t.journal;
  return {
    sides: tally(list.map((t) => t.trip.direction)),
    outcomes: tally(list.flatMap(outcomesOf)),
    setups: tally(list.flatMap((t) => (t.journal?.setup ? [t.journal.setup] : []))),
    mistakes: tally(list.flatMap((t) => t.journal?.mistakes ?? [])),
    tags: tagUsage(journals),
    accounts: tally(list.map((t) => t.trip.accountId)),
  };
}

export interface FilteredSummary {
  /** Exactement `computeStats(tripsClosedIn(list, window), toDisplay)`. */
  readonly stats: TradingStats;
  /**
   * Trades ouverts de `list` — une position ouverte n'a pas de jour de clôture, `tripsClosedIn`
   * l'exclut donc toujours de `stats` (décision n° 95 : c'est voulu, pas un oubli à combler ici).
   */
  readonly open: number;
  /** Trades clos sans journal de `list`, avant fenêtrage — pour la pastille « à annoter ». */
  readonly needsAnnotation: number;
}

/**
 * Synthèse chiffrée d'un sous-ensemble déjà filtré (`applyFilter`) : la recette de
 * `TradeStats.svelte:31-42`, plus les deux compteurs que `tripsClosedIn` seul ne peut pas donner
 * (un trade ouvert, ou clos sans journal, n'entre dans aucune fenêtre bornée).
 */
export function summarizeFiltered(
  list: readonly JournaledTrip[],
  window: DayWindow,
  toDisplay?: ToDisplay,
): FilteredSummary {
  return {
    stats: computeStats(tripsClosedIn(list, window), toDisplay),
    open: list.filter((t) => t.trip.status === 'open').length,
    needsAnnotation: list.filter(needsAnnotation).length,
  };
}
