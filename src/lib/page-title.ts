/**
 * Le titre de l'onglet, route par route (P116, décision n° 178).
 *
 * **Aucune route ne posait `document.title`** : les trente écrans de l'application portaient tous
 * le titre de `index.html`. WCAG 2.2 § 2.4.2 (« Page Titled ») demande qu'une page ait un titre
 * qui dise son sujet, et le W3C précise que dans une application à vues, ce titre doit changer avec
 * la vue. C'est le premier repère d'un lecteur d'écran à chaque navigation, et le seul qui
 * distingue deux onglets ouverts sur la même application.
 *
 * **La table est un `Record<RouteName, string>`** : le compilateur refuse une route sans titre. Une
 * route ajoutée demain ne pourra pas l'oublier — c'est le genre d'oubli qu'aucun test ne voit.
 *
 * Les libellés sont ceux de la barre d'application de chaque écran (WCAG 2.2 § 3.2.4, « Consistent
 * Identification ») ; ceux des rapports viennent du registre, qui les tient de leurs modèles.
 */
import { reportAt } from './reports';
import type { Route, RouteName } from './router.svelte';

export const APP_NAME = 'Coût de revient CH';

const ROUTE_TITLES: Readonly<Record<RouteName, string>> = {
  welcome: 'Bienvenue',
  overview: "Vue d'ensemble",
  portfolio: 'Portefeuille',
  asset: 'Actif',
  import: 'Importer',
  add: 'Ajouter une opération',
  report: 'Rapport de portefeuille',
  netWorthReport: 'Rapport de patrimoine',
  declaration: 'Déclaration',
  taxes: 'Impôts',
  secondOpinion: 'Second avis',
  alerts: 'Alertes',
  loans: 'Prêts',
  loansReport: 'Rapport de prêts',
  titles: 'Titres',
  trading: 'Trading',
  trades: 'Trades',
  trade: 'Trade',
  tradeAdd: 'Ajouter un trade',
  tradeStats: 'Statistiques',
  tradeBreakeven: 'Seuil',
  fills: 'Fills',
  tradingReport: 'Rapport de trading',
  more: 'Plus',
  market: 'Contexte de marché',
  watch: 'Veille réglementaire',
  accounts: 'Comptes',
  reconciliation: 'Réconciliation',
  settings: 'Réglages',
  privacy: 'Confidentialité',
  help: 'Aide',
  news: 'Nouveautés',
};

/** Le sujet de la page, sans le nom de l'application. */
export function screenTitle(route: Route): string {
  // Une fiche d'actif se nomme par son code, comme sa barre d'application.
  if (route.name === 'asset') return route.asset.toUpperCase();
  return reportAt(route.name)?.title ?? ROUTE_TITLES[route.name];
}

/** Le titre complet de l'onglet : le sujet d'abord, qui est ce qu'un lecteur d'écran annonce. */
export function pageTitle(route: Route): string {
  return `${screenTitle(route)} — ${APP_NAME}`;
}
