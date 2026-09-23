/**
 * Installation Android (Chrome) : capture de `beforeinstallprompt` (P124).
 *
 * Le navigateur peut déclencher cet événement à tout moment après le chargement — souvent avant
 * qu'aucun composant Svelte ne s'y intéresse. La capture se fait donc à l'INSTALLATION de ce
 * module (`installPromptCapture`, appelée une fois par `main.ts`, comme `installNetworkGuard`),
 * jamais dans un `onMount` qui la manquerait. `preventDefault()` supprime la mini-infobar native
 * de Chrome ; l'événement capté est gardé pour être rejoué depuis le bouton « Installer
 * l'application » des réglages.
 *
 * Module framework-agnostic, sur le patron de `$lib/net/local-only.ts` (`scope` injectable, état
 * de module, `resetInstallPromptForTests`) : les composants Svelte portent l'état réactif
 * eux-mêmes (`$state`), abonnés par `onInstallableChange`. `beforeinstallprompt` n'est pas encore
 * dans les types DOM standards (propriétaire Chromium) : `InstallScope` déclare donc sa propre
 * signature d'`addEventListener`, plus large que celle, contrainte à `WindowEventMap`, de
 * `window.addEventListener`.
 */

/** Sous-ensemble de `BeforeInstallPromptEvent` utilisé ici (Chrome for Developers, S15/S16). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface InstallScope {
  addEventListener(type: string, listener: (event: Event) => void): void;
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
}

const defaultScope = (): InstallScope => globalThis as unknown as InstallScope;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<(installable: boolean) => void>();

function notify(value: boolean): void {
  for (const listener of listeners) listener(value);
}

/** À appeler une seule fois, le plus tôt possible — sans effet si déjà posé. */
export function installPromptCapture(scope: InstallScope = defaultScope()): void {
  if (installed) return;
  installed = true;

  scope.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify(true);
  });
  // Un onglet qui installe (ou retrouve l'app déjà installée) voit `appinstalled` : l'invite n'a
  // alors plus rien à proposer.
  scope.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify(false);
  });
}

/** Vrai si `beforeinstallprompt` a déjà été capté et n'a pas encore été consommé. */
export function isInstallable(): boolean {
  return deferredPrompt !== null;
}

/** S'abonne aux changements d'installabilité ; rend la fonction de désabonnement. */
export function onInstallableChange(listener: (installable: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Vrai si cet onglet tourne déjà en PWA installée : le bouton d'installation n'a alors rien à
 * proposer. `navigator.standalone` (iOS Safari) est hors périmètre Android, gardé pour ne jamais
 * afficher le bouton dessus non plus si ce module y tournait un jour.
 */
export function isStandalone(scope: InstallScope = defaultScope()): boolean {
  const standaloneMedia = scope.matchMedia?.('(display-mode: standalone)').matches === true;
  const iosStandalone = scope.navigator?.standalone === true;
  return standaloneMedia || iosStandalone;
}

/**
 * Rejoue l'invite native. `null` si aucune invite n'a jamais été captée (le bouton qui l'appelle
 * ne devrait de toute façon pas être visible). L'événement ne se rejoue qu'une fois — Chrome ne le
 * répète pas — donc l'état « installable » retombe à faux dès l'appel, accepté ou refusé.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | null> {
  if (!deferredPrompt) return null;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  notify(false);
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome;
}

/** Tests : oublie l'installation et l'invite captée (le module survit d'un test à l'autre). */
export function resetInstallPromptForTests(): void {
  installed = false;
  deferredPrompt = null;
  listeners.clear();
}
