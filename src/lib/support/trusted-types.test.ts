/**
 * L'épinglage de l'URL du service worker, éprouvé sans navigateur.
 *
 * `tests/e2e/trusted-types.spec.ts` vérifie la même chose sous une vraie CSP, et c'est la preuve qui
 * compte. Mais elle ne tourne que dans la suite de bout en bout : ces cas-ci donnent le même signal
 * dans `npm run check`, et surtout ils exercent la **décision** — accepter ou refuser une URL — plutôt
 * que l'intégration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SERVICE_WORKER_POLICY, installServiceWorkerUrlPolicy } from './trusted-types';

const SW = '/cout-revient-ch/sw.js';

type Rules = { createScriptURL: (input: string) => string };

/** Pose de faux `trustedTypes` et `navigator.serviceWorker`, et rend de quoi les inspecter. */
function stubEnvironment() {
  const registered: string[] = [];
  const created: string[] = [];
  const register = vi.fn((url: string) => {
    registered.push(String(url));
    return Promise.resolve({} as ServiceWorkerRegistration);
  });

  vi.stubGlobal('navigator', { serviceWorker: { register } });
  vi.stubGlobal('trustedTypes', {
    createPolicy: (name: string, rules: Rules) => {
      created.push(name);
      return rules;
    },
  });
  return { registered, created, register };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('politique d’URL du service worker', () => {
  it('crée la politique sous le nom que la CSP autorise', () => {
    const { created } = stubEnvironment();
    installServiceWorkerUrlPolicy(SW);
    expect(created).toEqual([SERVICE_WORKER_POLICY]);
  });

  it('laisse passer l’URL attendue', async () => {
    const { registered } = stubEnvironment();
    installServiceWorkerUrlPolicy(SW);
    await navigator.serviceWorker.register(SW);
    expect(registered).toEqual([SW]);
  });

  it('refuse toute autre URL — c’est sa raison d’être', () => {
    const { registered } = stubEnvironment();
    installServiceWorkerUrlPolicy(SW);
    // Le refus est synchrone : la politique lève avant que `register` ne rende sa promesse.
    expect(() => void navigator.serviceWorker.register('/cout-revient-ch/hostile.js')).toThrow(
      /refusé/,
    );
    expect(registered, 'une URL étrangère a atteint `register`').toEqual([]);
  });

  it('ne fait rien sans support de Trusted Types : ces navigateurs ignorent la directive', () => {
    const register = vi.fn();
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    vi.stubGlobal('trustedTypes', undefined);
    installServiceWorkerUrlPolicy(SW);
    // La méthode n'a pas été enveloppée : elle reste exactement celle qu'on avait posée.
    expect(navigator.serviceWorker.register).toBe(register);
  });

  it('ne fait rien sans service worker du tout', () => {
    vi.stubGlobal('navigator', {});
    const createPolicy = vi.fn();
    vi.stubGlobal('trustedTypes', { createPolicy });
    expect(() => installServiceWorkerUrlPolicy(SW)).not.toThrow();
    expect(createPolicy).not.toHaveBeenCalled();
  });
});
