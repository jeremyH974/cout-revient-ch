/**
 * Les indicateurs macroéconomiques affichés à côté du portefeuille — ce qu'ils sont, et les
 * précautions qui les rendent honnêtes.
 *
 * **Jamais une valeur brute seule.** Chaque chiffre est accompagné de son rang historique, parce
 * que « VIX à 18 » ou « taux réel à 1,9 % » ne veut rien dire sans savoir si c'est haut ou bas.
 * C'est la règle commune à Glassnode, Checkonchain et Koyfin.
 *
 * **Jamais le rang d'un niveau qui a une tendance.** Un percentile du niveau de la masse monétaire
 * ou du bilan de la Fed vaudrait 99 % en permanence : ces séries montent, point. Il faut d'abord
 * transformer — variation annuelle, variation sur trois mois, prix réel — puis classer la série
 * transformée. `transform` dit laquelle a été appliquée, et l'écran l'annonce.
 *
 * **Percentile, jamais z-score.** Le z-score suppose une loi normale que les marchés démentent :
 * sur une série à queues épaisses, il écrase l'information et rend des écarts absurdes. Le rang
 * percentile ne suppose rien de la distribution, et son échelle 0-100 se lit sans explication.
 *
 * **Deux fenêtres, jamais une.** Un percentile dépend entièrement de la fenêtre sur laquelle il est
 * calculé, et une fenêtre glissante « oublie » les extrêmes qu'elle dépasse. En afficher deux rend
 * cette dépendance visible au lieu de la cacher derrière un chiffre unique.
 *
 * Rien ici ne recommande quoi que ce soit : ce sont des mesures publiques, datées, avec leur rang.
 */

/** Institution qui publie. Voir `sources.ts` pour ce que chacune exige en retour. */
export type MacroSourceId = 'treasury' | 'fed' | 'eia';

/**
 * Ce qui a été fait à la série avant de la classer.
 *
 * - `level` — la série est stationnaire ou bornée (taux réel, spread de courbe) : son niveau se
 *   compare directement à son propre passé.
 * - `yoy` — variation sur douze mois, en pourcentage. Pour les séries de prix qui dérivent.
 * - `change3m` — variation sur trois mois, en unité d'origine. Pour les stocks dont le régime a
 *   changé récemment (les réserves bancaires n'ont pas de passé comparable avant 2021).
 * - `volatility` — écart-type annualisé des rendements logarithmiques.
 */
export type Transform = 'level' | 'yoy' | 'change3m' | 'volatility';

/** Unité d'affichage. `percent` couvre les taux comme les variations relatives. */
export type MacroUnit = 'percent' | 'percentPoints' | 'usd' | 'usdBillions';

/** Un rang, et la fenêtre sur laquelle il a été calculé — l'un ne va jamais sans l'autre. */
export interface Rank {
  /** Libellé de fenêtre : `1y`, `5y`, `10y`, `since-2021`. */
  window: string;
  /** 0 à 100. Rang moyen en cas d'ex æquo. */
  percentile: number;
  /** Nombre d'observations dans la fenêtre : un percentile sur 12 points ne vaut pas grand-chose. */
  observations: number;
}

/**
 * Série quotidienne compacte : une date de départ et un tableau indexé par **jours calendaires**.
 *
 * `null` marque un jour sans observation — week-end, jour férié, publication hebdomadaire. Il est
 * conservé tel quel plutôt que comblé : reporter la dernière valeur ferait croire que l'indicateur
 * n'a pas bougé alors qu'il n'a simplement pas été republié. Le comblement, quand il est
 * nécessaire, est explicite et plafonné (`asOf` dans `stats.ts`).
 */
export interface CompactSeries {
  /** Premier jour du tableau, `AAAA-MM-JJ`. */
  from: string;
  values: readonly (number | null)[];
}

export interface MacroIndicator {
  id: string;
  /** Libellé affiché, en français. */
  label: string;
  /** Ce que le chiffre mesure, en une phrase. */
  detail: string;
  unit: MacroUnit;
  transform: Transform;
  /** Valeur courante, après transformation. */
  value: number;
  /** Jour de la dernière observation, `AAAA-MM-JJ`. Toujours affiché avec la valeur. */
  asOf: string;
  /**
   * Au-delà de ce nombre de jours sans nouvelle observation, l'écran signale la donnée comme
   * périmée. Une série hebdomadaire tolère plus qu'une série quotidienne.
   */
  staleAfterDays: number;
  ranks: readonly Rank[];
  /** Deux ans de la série transformée : sparkline, et matière première des corrélations. */
  series: CompactSeries;
  source: MacroSourceId;
  url: string;
  /**
   * Réserve à énoncer avec le chiffre, quand il en faut une. Sert aux mesures qui ne sont pas des
   * statistiques officielles ou dont la portée est contestée.
   */
  caveat?: string;
}

/** Ce que chaque source a fourni, et quand. */
export interface MacroSourceStamp {
  source: MacroSourceId;
  checkedOn: string;
  /** Indicateurs qui en proviennent. */
  count: number;
  /**
   * Source déclarée mais absente de cette génération, avec la raison — une clé manquante, par
   * exemple. L'écran le dit plutôt que de faire disparaître l'indicateur en silence.
   */
  missing?: string;
}

export interface MacroSnapshot {
  generatedAt: string;
  sources: readonly MacroSourceStamp[];
  indicators: readonly MacroIndicator[];
}
