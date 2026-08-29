/** Routeur par fragment (#/…) : zéro dépendance, compatible hébergement statique. */
export type Route =
  | { name: 'welcome' }
  | { name: 'overview' }
  | { name: 'portfolio' }
  | { name: 'asset'; asset: string }
  | { name: 'import' }
  | { name: 'add' }
  | { name: 'report' }
  | { name: 'alerts' }
  | { name: 'trading' }
  | { name: 'trades' }
  | { name: 'trade'; id: string }
  | { name: 'tradeAdd' }
  | { name: 'tradeStats' }
  | { name: 'fills' }
  | { name: 'more' }
  | { name: 'market' }
  | { name: 'watch' }
  | { name: 'accounts' }
  | { name: 'settings' }
  | { name: 'privacy' }
  | { name: 'help' }
  | { name: 'news' };

export type RouteName = Route['name'];

const assetRoute = (code: string | undefined): Route =>
  code ? { name: 'asset', asset: decodeURIComponent(code).toLowerCase() } : { name: 'portfolio' };

/** Sous-chemins de l'espace Trading : `#/trading`, `#/trading/trades`, `#/trading/trade/<id>`… */
function parseTrading(sub: string | undefined, arg: string | undefined): Route {
  switch (sub) {
    case undefined:
    case '':
      return { name: 'trading' };
    case 'trades':
      return { name: 'trades' };
    case 'trade':
      return arg ? { name: 'trade', id: decodeURIComponent(arg) } : { name: 'trades' };
    case 'add':
      return { name: 'tradeAdd' };
    case 'stats':
      return { name: 'tradeStats' };
    case 'fills':
      return { name: 'fills' };
    default:
      return { name: 'trading' };
  }
}

/** Sous-chemins de l'espace Investissement : `#/invest`, `#/invest/asset/btc`, `#/invest/import`… */
function parseInvest(sub: string | undefined, arg: string | undefined): Route {
  switch (sub) {
    case undefined:
    case '':
      return { name: 'portfolio' };
    case 'asset':
      return assetRoute(arg);
    case 'import':
      return { name: 'import' };
    case 'add':
      return { name: 'add' };
    case 'report':
      return { name: 'report' };
    case 'alerts':
      return { name: 'alerts' };
    default:
      return { name: 'portfolio' };
  }
}

/**
 * Hashes canoniques (v2) : `#/` = Vue d'ensemble (aussi le `start_url` de la PWA, sans hash) ;
 * `#/invest…` = espace Investissement ; `#/trading…` = espace Trading ; `#/more` = écrans
 * secondaires. Les hashes v1 (`#/asset/btc`, `#/import`, `#/add`, `#/report`, `#/portfolio`)
 * restent compris : liens partagés sur Discord, favoris et écrans d'accueil installés ne cassent pas.
 */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  const [head = '', second, third] = path.split('/');
  switch (head) {
    case '':
    case 'overview':
      return { name: 'overview' };
    case 'invest':
      return parseInvest(second, third);
    case 'trading':
      return parseTrading(second, third);
    case 'more':
      return { name: 'more' };
    case 'market':
      return { name: 'market' };
    case 'watch':
      return { name: 'watch' };
    case 'accounts':
      return { name: 'accounts' };
    case 'welcome':
      return { name: 'welcome' };
    case 'settings':
      return { name: 'settings' };
    case 'privacy':
      return { name: 'privacy' };
    case 'help':
      return { name: 'help' };
    case 'news':
      return { name: 'news' };
    // Alias v1 (conservés tant que des liens circulent).
    case 'portfolio':
      return { name: 'portfolio' };
    case 'asset':
      return assetRoute(second);
    case 'import':
      return { name: 'import' };
    case 'add':
      return { name: 'add' };
    case 'report':
      return { name: 'report' };
    default:
      return { name: 'overview' };
  }
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'overview':
      return '#/';
    case 'portfolio':
      return '#/invest';
    case 'asset':
      return `#/invest/asset/${encodeURIComponent(route.asset)}`;
    case 'import':
      return '#/invest/import';
    case 'add':
      return '#/invest/add';
    case 'report':
      return '#/invest/report';
    case 'alerts':
      return '#/invest/alerts';
    case 'trades':
      return '#/trading/trades';
    case 'trade':
      return `#/trading/trade/${encodeURIComponent(route.id)}`;
    case 'tradeAdd':
      return '#/trading/add';
    case 'tradeStats':
      return '#/trading/stats';
    case 'fills':
      return '#/trading/fills';
    default:
      return `#/${route.name}`;
  }
}

function createRouter() {
  const hasWindow = typeof window !== 'undefined';
  let route = $state<Route>(hasWindow ? parseHash(window.location.hash) : { name: 'overview' });
  if (hasWindow) {
    window.addEventListener('hashchange', () => {
      route = parseHash(window.location.hash);
      window.scrollTo({ top: 0 });
    });
  }
  return {
    get route(): Route {
      return route;
    },
    navigate(to: Route): void {
      if (hasWindow) window.location.hash = toHash(to);
      else route = to;
    },
    href: toHash,
  };
}

export const router = createRouter();
