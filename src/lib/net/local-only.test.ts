import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_ONLY_ERROR,
  installNetworkGuard,
  isLocalOnly,
  isSameOrigin,
  resetNetworkGuardForTests,
  setLocalOnly,
} from './local-only';

const ORIGIN = 'http://crch.localhost:7331';
const BASE = `${ORIGIN}/`;

/**
 * Une portée factice : on n'emballe pas le `globalThis` de Vitest, qui servirait ensuite aux autres
 * fichiers de test du même processus.
 */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface Scope {
  fetch: FetchLike;
  WebSocket: new (url: string | URL, protocols?: string | string[]) => object;
  location: { origin: string };
  document: { baseURI: string };
}

/**
 * Une portée factice : on n'emballe pas le `globalThis` de Vitest, qui servirait ensuite aux
 * autres fichiers de test du même processus.
 *
 * `natif` et `ouverts` sont rendus à part parce que l'emballage **remplace** `scope.fetch` et
 * `scope.WebSocket` — c'est justement ce qu'on veut vérifier, donc on garde les originaux.
 */
function makeScope(): { scope: Scope; natif: ReturnType<typeof vi.fn>; ouverts: string[] } {
  const ouverts: string[] = [];
  const natif = vi.fn(() => Promise.resolve(new Response('ok')));
  class FakeWebSocket {
    constructor(url: string | URL) {
      ouverts.push(String(url));
    }
  }
  return {
    scope: {
      fetch: natif as unknown as FetchLike,
      WebSocket: FakeWebSocket,
      location: { origin: ORIGIN },
      document: { baseURI: BASE },
    },
    natif,
    ouverts,
  };
}

beforeEach(() => resetNetworkGuardForTests());
afterEach(() => resetNetworkGuardForTests());

describe('même origine', () => {
  it('reconnaît les formes absolues, relatives et Request', () => {
    expect(isSameOrigin(`${ORIGIN}/icons/btc.svg`, BASE, ORIGIN)).toBe(true);
    expect(isSameOrigin('/icons/btc.svg', BASE, ORIGIN)).toBe(true);
    expect(isSameOrigin('sw.js', BASE, ORIGIN)).toBe(true);
    expect(isSameOrigin(new URL(`${ORIGIN}/a`), BASE, ORIGIN)).toBe(true);
    expect(isSameOrigin(new Request(`${ORIGIN}/a`), BASE, ORIGIN)).toBe(true);
  });

  it('rejette une autre origine, y compris un autre port du même hôte', () => {
    expect(isSameOrigin('https://api.coingecko.com/v3/ping', BASE, ORIGIN)).toBe(false);
    expect(isSameOrigin('http://crch.localhost:5173/a', BASE, ORIGIN)).toBe(false);
    expect(isSameOrigin('http://localhost:7331/a', BASE, ORIGIN)).toBe(false);
  });

  it("traite ce qu'il ne comprend pas comme externe, jamais comme interne", () => {
    expect(isSameOrigin('http://[pas une url', BASE, ORIGIN)).toBe(false);
    expect(isSameOrigin(null, BASE, ORIGIN)).toBe(false);
    expect(isSameOrigin(42, BASE, ORIGIN)).toBe(false);
    expect(isSameOrigin(undefined, BASE, ORIGIN)).toBe(false);
  });
});

describe('verrou levé (comportement du site public)', () => {
  it('laisse tout passer', async () => {
    const { scope, natif, ouverts } = makeScope();
    installNetworkGuard(scope as never);
    expect(isLocalOnly()).toBe(false);

    await scope.fetch('https://api.coingecko.com/api/v3/ping');
    expect(natif).toHaveBeenCalledOnce();

    new scope.WebSocket('wss://api.hyperliquid.xyz/ws');
    expect(ouverts).toEqual(['wss://api.hyperliquid.xyz/ws']);
  });
});

describe('verrou posé (mode local)', () => {
  it('refuse toute origine externe, sans appeler le fetch natif', async () => {
    const { scope, natif } = makeScope();
    installNetworkGuard(scope as never);
    setLocalOnly(true);

    for (const url of [
      'https://api.coingecko.com/api/v3/ping',
      'https://api.anthropic.com/v1/messages',
      'https://mempool.space/api/address/bc1q',
      'https://api.etherscan.io/v2/api?address=0xabc',
    ]) {
      await expect(scope.fetch(url)).rejects.toThrow(LOCAL_ONLY_ERROR);
    }
    expect(natif, 'aucun appel natif ne doit partir').not.toHaveBeenCalled();
  });

  it('refuse aussi un WebSocket, qui ne passe pas par fetch', () => {
    const { scope, ouverts } = makeScope();
    installNetworkGuard(scope as never);
    setLocalOnly(true);

    expect(() => new scope.WebSocket('wss://api.hyperliquid.xyz/ws')).toThrow(LOCAL_ONLY_ERROR);
    expect(ouverts).toEqual([]);
  });

  it("laisse passer l'origine de l'application : ses fichiers ne sortent de nulle part", async () => {
    const { scope, natif } = makeScope();
    installNetworkGuard(scope as never);
    setLocalOnly(true);

    await scope.fetch('/icons/btc.svg');
    await scope.fetch(`${ORIGIN}/manifest.webmanifest`);
    expect(natif).toHaveBeenCalledTimes(2);
  });

  it('se lève et se repose sans réinstaller quoi que ce soit', async () => {
    const { scope } = makeScope();
    installNetworkGuard(scope as never);

    setLocalOnly(true);
    await expect(scope.fetch('https://api.coingecko.com/ping')).rejects.toThrow(LOCAL_ONLY_ERROR);
    setLocalOnly(false);
    await expect(scope.fetch('https://api.coingecko.com/ping')).resolves.toBeDefined();
  });
});

describe('installation', () => {
  it("n'emballe qu'une fois, même appelée plusieurs fois", async () => {
    const { scope } = makeScope();
    installNetworkGuard(scope as never);
    const premier = scope.fetch;
    installNetworkGuard(scope as never);
    expect(scope.fetch).toBe(premier);
  });

  it('emballe même verrou levé, pour que la pose ultérieure prenne effet', async () => {
    const { scope } = makeScope();
    // Ordre réel du démarrage : on emballe d'abord, on décide ensuite.
    installNetworkGuard(scope as never);
    const capturee = scope.fetch; // un module qui garderait sa propre référence
    setLocalOnly(true);
    await expect(capturee('https://api.coingecko.com/ping')).rejects.toThrow(LOCAL_ONLY_ERROR);
  });
});
