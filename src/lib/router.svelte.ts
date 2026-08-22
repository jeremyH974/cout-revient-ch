/** Routeur par fragment (#/…) : zéro dépendance, compatible hébergement statique. */
export type Route =
  | { name: 'welcome' }
  | { name: 'portfolio' }
  | { name: 'asset'; asset: string }
  | { name: 'import' }
  | { name: 'add' }
  | { name: 'settings' }
  | { name: 'privacy' }
  | { name: 'help' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  const [head = '', tail] = path.split('/');
  switch (head) {
    case '':
    case 'portfolio':
      return { name: 'portfolio' };
    case 'welcome':
      return { name: 'welcome' };
    case 'asset':
      return tail
        ? { name: 'asset', asset: decodeURIComponent(tail).toLowerCase() }
        : { name: 'portfolio' };
    case 'import':
      return { name: 'import' };
    case 'add':
      return { name: 'add' };
    case 'settings':
      return { name: 'settings' };
    case 'privacy':
      return { name: 'privacy' };
    case 'help':
      return { name: 'help' };
    default:
      return { name: 'portfolio' };
  }
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'portfolio':
      return '#/';
    case 'asset':
      return `#/asset/${encodeURIComponent(route.asset)}`;
    default:
      return `#/${route.name}`;
  }
}

function createRouter() {
  const hasWindow = typeof window !== 'undefined';
  let route = $state<Route>(hasWindow ? parseHash(window.location.hash) : { name: 'portfolio' });
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
