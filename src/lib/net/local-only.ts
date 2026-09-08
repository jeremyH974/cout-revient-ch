/**
 * Le verrou de sortie réseau : quand il est posé, **rien** ne quitte cet appareil.
 *
 * ## Pourquoi un garde-fou global plutôt qu'un `if` dans chaque appelant
 *
 * L'application connaît une vingtaine d'origines (cours, taux de change, explorateurs de chaînes,
 * modèle de langage) réparties dans une dizaine de modules. Poser la condition dans chacun demande
 * qu'on n'en oublie aucun — aujourd'hui, et à chaque module ajouté demain. Ce genre de discipline
 * tient un mois.
 *
 * Ici, on emballe `fetch` et `WebSocket` une fois pour toutes, au démarrage, avant que le moindre
 * module ne s'exécute. Un appel oublié est refusé **par construction**, y compris dans du code que
 * personne n'a relu — une dépendance compromise comprise, qui est la menace la plus concrète de ce
 * projet (décision n° 13).
 *
 * ## Ce que ce verrou n'est pas
 *
 * Ce n'est pas un remplacement de la Content-Security-Policy, c'est son complément. La CSP est
 * appliquée par le navigateur et survivrait à ce module ; mais elle n'est injectée qu'**au build**
 * (GitHub Pages ne permet pas d'en-tête), donc absente en développement. Inversement, ce verrou
 * fonctionne partout mais vit dans le même contexte JavaScript que ce qu'il surveille. Les deux
 * ensemble couvrent ce que ni l'un ni l'autre ne couvre seul.
 *
 * ## Le cas de l'origine elle-même
 *
 * Les requêtes vers la propre origine de l'application restent permises : ce sont ses fichiers, ses
 * icônes, son jeu de démonstration. Rien n'en sort, au sens propre — le serveur, c'est la machine.
 */

/** Message unique, volontairement explicite : un refus silencieux serait pris pour une panne. */
export const LOCAL_ONLY_ERROR =
  'Sortie réseau coupée (mode local) : cette requête n’a pas été envoyée.';

let localOnly = false;
let installed = false;

export function isLocalOnly(): boolean {
  return localOnly;
}

/** Pose ou lève le verrou. Sans effet tant que `installNetworkGuard` n'a pas emballé les API. */
export function setLocalOnly(value: boolean): void {
  localOnly = value;
}

/**
 * Une URL désigne-t-elle la propre origine de l'application ?
 *
 * Les formes relatives (`/icons/btc.svg`, `sw.js`) sont résolues contre `document.baseURI` par
 * `new URL(..., base)` : elles sont donc same-origin par construction. Une URL illisible est
 * traitée comme **externe** — on refuse ce qu'on ne comprend pas, on ne l'autorise pas.
 */
export function isSameOrigin(input: unknown, base: string, origin: string): boolean {
  const href =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : null;
  if (href === null) return false;
  try {
    return new URL(href, base).origin === origin;
  } catch {
    return false;
  }
}

interface GuardScope {
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  location: { origin: string };
  document?: { baseURI: string };
}

/**
 * Emballe `fetch` et `WebSocket`. **À appeler une seule fois, le plus tôt possible.**
 *
 * L'emballage est posé même quand le verrou est levé : c'est ce qui permet de le poser ensuite
 * sans rien réinstaller, et surtout d'éviter qu'un module ayant capturé `fetch` au chargement ne
 * conserve une référence à la version d'origine.
 */
export function installNetworkGuard(scope: GuardScope = globalThis as unknown as GuardScope): void {
  if (installed) return;
  installed = true;

  const nativeFetch = scope.fetch.bind(scope);
  const NativeWebSocket = scope.WebSocket;
  const origin = scope.location.origin;
  const baseOf = (): string => scope.document?.baseURI ?? origin;

  scope.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (localOnly && !isSameOrigin(input, baseOf(), origin)) {
      return Promise.reject(new Error(LOCAL_ONLY_ERROR));
    }
    return nativeFetch(input, init);
  }) as typeof fetch;

  /*
   * `WebSocket` doit rester une classe : du code peut faire `instanceof`, et le constructeur est
   * appelé avec `new`. On étend donc plutôt que d'envelopper dans une fonction.
   */
  class GuardedWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      if (localOnly && !isSameOrigin(url, baseOf(), origin)) throw new Error(LOCAL_ONLY_ERROR);
      super(url, protocols);
    }
  }
  scope.WebSocket = GuardedWebSocket as unknown as typeof WebSocket;
}

/** Tests : oublie l'installation (le module survit d'un test à l'autre). */
export function resetNetworkGuardForTests(): void {
  installed = false;
  localOnly = false;
}
