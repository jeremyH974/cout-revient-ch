/**
 * Les routes que le passage axe visite, SANS données puis AVEC la démo.
 *
 * Elles vivaient dans deux littéraux de `a11y.spec.ts`, que rien ne croisait avec les routes
 * déclarées : une route neuve pouvait échapper à l'accessibilité sans que la CI le voie — la
 * décision n° 175 l'avait relevé sans le corriger. Sorties ici, elles se lisent aussi depuis
 * `tests/integration/a11y-routes.test.ts`, qui exige que chaque route déclarée y figure
 * (décision n° 178).
 */
export const EMPTY_ROUTES: readonly string[] = [
  '#/welcome',
  '#/import',
  '#/add',
  '#/accounts',
  '#/reconciliation',
  '#/invest/second-opinion',
  '#/help',
  '#/privacy',
  '#/settings',
  '#/trading',
  '#/trading/add',
  '#/trading/seuil',
  '#/more',
  '#/market',
  '#/watch',
  '#/declaration',
  '#/impots',
  '#/news',
  '#/invest/alerts',
  '#/wealth/loans',
  '#/invest/titles',
  '#/wealth',
  '#/patrimoine',
  '#/trading/report',
  '#/wealth/report',
];

export const DEMO_ROUTES: readonly string[] = [
  '#/',
  '#/asset/btc',
  '#/settings',
  '#/report',
  '#/invest',
  '#/trading',
  '#/trading/trades',
  '#/trading/stats',
  '#/trading/seuil',
  '#/trading/fills',
  '#/more',
  '#/accounts',
  '#/reconciliation',
  '#/invest/second-opinion',
  '#/invest/asset/btc',
  '#/invest/alerts',
  '#/declaration',
  '#/impots',
  '#/wealth',
  '#/patrimoine',
  '#/trading/report',
  '#/wealth/report',
];
