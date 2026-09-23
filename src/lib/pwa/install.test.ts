import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BeforeInstallPromptEvent,
  installPromptCapture,
  isInstallable,
  isStandalone,
  onInstallableChange,
  promptInstall,
  resetInstallPromptForTests,
} from './install';

interface Scope {
  addEventListener(type: string, listener: (event: Event) => void): void;
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
}

/** Une portée factice : on n'emballe pas le `globalThis` de Vitest, partagé entre fichiers. */
function makeScope(): { scope: Scope; fire: (type: string, event: Event) => void } {
  const handlers = new Map<string, (event: Event) => void>();
  return {
    scope: {
      addEventListener(type, listener) {
        handlers.set(type, listener);
      },
    },
    fire: (type, event) => handlers.get(type)?.(event),
  };
}

function fakePromptEvent(
  outcome: 'accepted' | 'dismissed',
): BeforeInstallPromptEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return {
    type: 'beforeinstallprompt',
    preventDefault: vi.fn(),
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  } as unknown as BeforeInstallPromptEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

beforeEach(() => resetInstallPromptForTests());
afterEach(() => resetInstallPromptForTests());

describe('capture de beforeinstallprompt', () => {
  it("n'est pas installable avant que l'événement n'arrive", () => {
    expect(isInstallable()).toBe(false);
  });

  it('devient installable à la capture, empêche la mini-infobar, et prévient les abonnés', () => {
    const { scope, fire } = makeScope();
    installPromptCapture(scope);
    const seen: boolean[] = [];
    onInstallableChange((v) => seen.push(v));

    const event = fakePromptEvent('accepted');
    fire('beforeinstallprompt', event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(isInstallable()).toBe(true);
    expect(seen).toEqual([true]);
  });

  it('ne capture qu’une fois : un second appel ne repose pas les écouteurs', () => {
    const { scope, fire } = makeScope();
    installPromptCapture(scope);
    installPromptCapture(scope);
    fire('beforeinstallprompt', fakePromptEvent('accepted'));
    expect(isInstallable()).toBe(true);
  });

  it('appinstalled efface une invite en attente', () => {
    const { scope, fire } = makeScope();
    installPromptCapture(scope);
    fire('beforeinstallprompt', fakePromptEvent('accepted'));
    expect(isInstallable()).toBe(true);

    fire('appinstalled', new Event('appinstalled'));
    expect(isInstallable()).toBe(false);
  });
});

describe('promptInstall', () => {
  it('rend null sans invite captée', async () => {
    await expect(promptInstall()).resolves.toBeNull();
  });

  it("rejoue l'invite, consomme l'état, et rend le choix de l'utilisateur", async () => {
    const { scope, fire } = makeScope();
    installPromptCapture(scope);
    const event = fakePromptEvent('accepted');
    fire('beforeinstallprompt', event);

    const seen: boolean[] = [];
    onInstallableChange((v) => seen.push(v));
    const outcome = await promptInstall();

    expect(outcome).toBe('accepted');
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(isInstallable()).toBe(false);
    expect(seen).toEqual([false]);
  });

  it('une invite refusée redonne aussi le choix « dismissed »', async () => {
    const { scope, fire } = makeScope();
    installPromptCapture(scope);
    fire('beforeinstallprompt', fakePromptEvent('dismissed'));
    await expect(promptInstall()).resolves.toBe('dismissed');
  });
});

describe('isStandalone', () => {
  it('lit display-mode: standalone', () => {
    expect(isStandalone({ addEventListener() {}, matchMedia: () => ({ matches: true }) })).toBe(
      true,
    );
    expect(isStandalone({ addEventListener() {}, matchMedia: () => ({ matches: false }) })).toBe(
      false,
    );
  });

  it('lit navigator.standalone (iOS) quand matchMedia ne dit rien', () => {
    expect(isStandalone({ addEventListener() {}, navigator: { standalone: true } })).toBe(true);
  });

  it('ne suppose rien sans aucun signal', () => {
    expect(isStandalone({ addEventListener() {} })).toBe(false);
  });
});

describe('onInstallableChange', () => {
  it('se désabonne', () => {
    const { scope, fire } = makeScope();
    installPromptCapture(scope);
    const seen: boolean[] = [];
    const unsubscribe = onInstallableChange((v) => seen.push(v));
    unsubscribe();
    fire('beforeinstallprompt', fakePromptEvent('accepted'));
    expect(seen).toEqual([]);
  });
});
