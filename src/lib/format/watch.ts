/**
 * Rendu français de la veille réglementaire (P67). Le moteur (`../watch/entries.ts`) porte des
 * codes et des dates ; c'est ici — et seulement ici — que `status` devient une phrase, comme
 * `format/insights.ts` le fait pour les constats (décision n° 40). `title` et `effect` restent en
 * revanche des phrases françaises DANS la donnée : ce sont des faits de droit, pas des valeurs
 * codées, et les reformuler ici coûterait plus cher en risque (paraphraser du droit) que ça ne
 * rendrait service.
 */
import type { WatchCertainty, WatchEntry, WatchStatus, WatchTopic } from '../watch/entries';
import { fmtDate } from './fr';

/**
 * Libellé français d'un statut. Le `switch` est exhaustif : ajouter un statut au moteur sans
 * écrire son libellé ici est une ERREUR DE COMPILATION (branche `default`), jamais une ligne
 * muette à l'écran.
 */
export function watchStatusLabel(status: WatchStatus): string {
  switch (status) {
    case 'in-force':
      return 'En vigueur';
    case 'adopted-final':
      return 'Adopté, définitif';
    case 'adopted-not-final':
      return 'Adopté, pas définitif';
    case 'in-discussion':
      return 'En discussion';
    case 'doctrine-unsettled':
      return 'Doctrine non stabilisée';
    case 'dropped':
      return 'Retiré, non retenu';
    default: {
      const missing: never = status;
      throw new Error(`Statut de veille sans libellé : ${String(missing)}`);
    }
  }
}

/** Note de fiabilité de la source, affichée à côté de la référence — jamais silencieuse sur une source non officielle. */
export function watchCertaintyLabel(certainty: WatchCertainty): string {
  switch (certainty) {
    case 'confirmed':
      return 'Confirmé par un texte officiel';
    case 'secondary-only':
      return 'Source non officielle : position de praticiens, non opposable';
    default: {
      const missing: never = certainty;
      throw new Error(`Certitude de veille sans libellé : ${String(missing)}`);
    }
  }
}

/** Libellé français d'un thème, pour le filtre de l'écran dédié. `switch` exhaustif. */
export function watchTopicLabel(topic: WatchTopic): string {
  switch (topic) {
    case 'cession':
      return 'Cessions';
    case 'detention':
      return 'Détention';
    case 'revenus':
      return 'Revenus (staking, airdrops…)';
    case 'declaratif':
      return 'Déclaratif (DAC8/CARF)';
    case 'nft':
      return 'Jetons uniques (NFT)';
    default: {
      const missing: never = topic;
      throw new Error(`Thème de veille sans libellé : ${String(missing)}`);
    }
  }
}

export interface RenderedWatchEntry {
  id: string;
  title: string;
  statusLabel: string;
  /** « 30/12/2025 ». */
  statusDate: string;
  effect: string;
  sourceLabel: string;
  sourceUrl: string | null;
  officialSource: boolean;
  certaintyLabel: string;
  secondaryOnly: boolean;
  /** « 29/08/2026 ». */
  reviewedOn: string;
  /** « 30/09/2027 », ou `null` si aucune échéance n'est annoncée. */
  deadline: string | null;
}

export function renderWatchEntry(entry: WatchEntry): RenderedWatchEntry {
  return {
    id: entry.id,
    title: entry.title,
    statusLabel: watchStatusLabel(entry.status),
    statusDate: fmtDate(entry.statusDate),
    effect: entry.effect,
    sourceLabel: entry.source.label,
    sourceUrl: entry.source.url,
    officialSource: entry.source.official,
    certaintyLabel: watchCertaintyLabel(entry.certainty),
    secondaryOnly: entry.certainty === 'secondary-only',
    reviewedOn: fmtDate(entry.reviewedOn),
    deadline: entry.deadline === undefined ? null : fmtDate(entry.deadline),
  };
}

export function renderWatchEntries(list: readonly WatchEntry[]): RenderedWatchEntry[] {
  return list.map(renderWatchEntry);
}

/**
 * Une ligne compacte, pour le bloc court du rapport : un fait par ligne, jamais un conseil. Le
 * rappel « source non officielle » n'est pas optionnel — un rapport lu hors ligne, sans lien vers
 * l'écran dédié, doit porter cette réserve lui-même.
 */
export function watchSummaryLine(entry: WatchEntry): string {
  const note = entry.certainty === 'secondary-only' ? ' (source non officielle)' : '';
  return `${watchStatusLabel(entry.status)} — ${entry.title} : ${entry.effect}${note}`;
}
