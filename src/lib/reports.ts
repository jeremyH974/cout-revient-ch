/**
 * Registre des rapports : un par espace, et le consolidé (P116, décision n° 178).
 *
 * **Un seul squelette, quatre périmètres.** Chaque rapport a son constructeur de modèle et son
 * écran, mais tous se rendent par le même corps (`ReportBody.svelte`), la même coquille
 * (`ReportShell.svelte`) et le même générateur de PDF — c'est ce que la décision n° 174 a rendu
 * possible, et ce que la norme ISO 24896:2026 demande : la même signification reçoit la même
 * apparence. Ce registre dit **quels** rapports existent ; il ne dit rien de leur contenu.
 *
 * **Les périmètres sont les espaces**, pas une taxonomie inventée pour le lecteur — l'approche par
 * la direction d'IFRS 8 : on publie les segments que l'on regarde. Le consolidé appartient à la
 * Vue d'ensemble, qui est elle-même la consolidation.
 *
 * Les titres viennent des constructeurs de modèle, pas d'ici : le titre imprimé en tête du PDF, le
 * titre de l'écran et celui de l'onglet du navigateur sont le MÊME texte, et un test le vérifie.
 */
import { GLOBAL_REPORT_TITLE } from './export/global-report-model';
import { LENDING_REPORT_TITLE } from './export/lending-report-model';
import { REPORT_TITLE } from './export/report-model';
import { TRADING_REPORT_TITLE } from './export/trading-report-model';
import type { Route, RouteName } from './router.svelte';
import type { SpaceId } from './spaces';

export type ReportId = 'patrimoine' | 'invest' | 'trading' | 'loans';

export interface ReportEntry {
  id: ReportId;
  /** L'espace qui porte le rapport, et dont il emprunte l'accent. */
  space: SpaceId;
  route: Route & { name: RouteName };
  /** Titre du document, de l'écran et de l'onglet. */
  title: string;
  /** Libellé court des liens croisés : le nom de l'espace, pour qu'on s'y reconnaisse. */
  label: string;
}

/**
 * L'ordre est celui des liens croisés en tête de chaque rapport, et il ne varie pas d'un rapport à
 * l'autre : WCAG 2.2 § 3.2.3 veut que les mêmes mécanismes de navigation se présentent dans le même
 * ordre relatif. Le consolidé d'abord, puis les espaces dans l'ordre de la barre de navigation.
 */
export const REPORTS: readonly ReportEntry[] = [
  {
    id: 'patrimoine',
    space: 'overview',
    route: { name: 'netWorthReport' },
    title: GLOBAL_REPORT_TITLE,
    label: 'Patrimoine',
  },
  {
    id: 'invest',
    space: 'invest',
    route: { name: 'report' },
    title: REPORT_TITLE,
    label: 'Investissement',
  },
  {
    id: 'loans',
    space: 'wealth',
    route: { name: 'loansReport' },
    title: LENDING_REPORT_TITLE,
    label: 'Prêts',
  },
  {
    id: 'trading',
    space: 'trading',
    route: { name: 'tradingReport' },
    title: TRADING_REPORT_TITLE,
    label: 'Trading',
  },
];

/** Le rapport d'un espace, ou `null` pour un espace qui n'en produit pas (le menu « Plus »). */
export function reportOf(space: SpaceId): ReportEntry | null {
  return REPORTS.find((r) => r.space === space) ?? null;
}

/** Le rapport servi par une route, ou `null` pour une route qui n'en est pas un. */
export function reportAt(name: RouteName): ReportEntry | null {
  return REPORTS.find((r) => r.route.name === name) ?? null;
}
