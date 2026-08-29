import { describe, expect, it } from 'vitest';
import { parseHash, toHash, type Route } from './router.svelte';

/**
 * `parseHash`/`toHash` sont des fonctions pures (aucune dépendance à `window`) : le routeur
 * lui-même (`createRouter`) utilise `$state` derrière une garde `typeof window`, mais ces deux
 * fonctions s'exécutent sans problème dans l'environnement Vitest `node` (`vite.config.ts`,
 * `test.environment: 'node'`) — aucun `jsdom`/`happy-dom` n'est installé dans ce dépôt.
 * `@sveltejs/vite-plugin-svelte` compile `router.svelte.ts` (runes) avant exécution ; l'import
 * direct de `./router.svelte` fonctionne donc ici sans configuration supplémentaire.
 */

describe('parseHash — hashes canoniques (v2)', () => {
  it.each<[string, Route]>([
    ['#/', { name: 'overview' }],
    ['#/overview', { name: 'overview' }],
    ['#/invest', { name: 'portfolio' }],
    ['#/invest/', { name: 'portfolio' }],
    ['#/invest/asset/btc', { name: 'asset', asset: 'btc' }],
    ['#/invest/asset', { name: 'portfolio' }],
    ['#/invest/asset/', { name: 'portfolio' }],
    ['#/invest/import', { name: 'import' }],
    ['#/invest/add', { name: 'add' }],
    ['#/invest/report', { name: 'report' }],
    ['#/invest/second-opinion', { name: 'secondOpinion' }],
    ['#/invest/nimportequoi', { name: 'portfolio' }],
    ['#/trading', { name: 'trading' }],
    ['#/trading/', { name: 'trading' }],
    ['#/more', { name: 'more' }],
    ['#/welcome', { name: 'welcome' }],
    ['#/settings', { name: 'settings' }],
    ['#/privacy', { name: 'privacy' }],
    ['#/help', { name: 'help' }],
    ['#/news', { name: 'news' }],
  ])('%s → %o', (hash, expected) => {
    expect(parseHash(hash)).toEqual(expected);
  });

  it("minuscule le code d'actif et le décode (URL-encodé)", () => {
    expect(parseHash('#/invest/asset/BTC')).toEqual({ name: 'asset', asset: 'btc' });
    // %45 = 'E' → 'ETH' une fois décodé, puis mis en minuscules.
    expect(parseHash('#/invest/asset/%45TH')).toEqual({ name: 'asset', asset: 'eth' });
  });
});

describe('parseHash — alias v1 (liens partagés, favoris, écrans d’accueil déjà installés)', () => {
  it.each<[string, Route]>([
    ['#/portfolio', { name: 'portfolio' }],
    ['#/portfolio/', { name: 'portfolio' }],
    ['#/asset/btc', { name: 'asset', asset: 'btc' }],
    ['#/asset', { name: 'portfolio' }],
    ['#/asset/', { name: 'portfolio' }],
    ['#/import', { name: 'import' }],
    ['#/add', { name: 'add' }],
    ['#/report', { name: 'report' }],
  ])('%s → %o', (hash, expected) => {
    expect(parseHash(hash)).toEqual(expected);
  });

  it("minuscule et décode le code d'actif de l'alias v1 comme le hash canonique", () => {
    expect(parseHash('#/asset/BTC')).toEqual({ name: 'asset', asset: 'btc' });
    expect(parseHash('#/asset/%45TH')).toEqual({ name: 'asset', asset: 'eth' });
  });
});

describe('parseHash — hash vide ou inconnu → Vue d’ensemble', () => {
  it.each<[string, Route]>([
    ['', { name: 'overview' }],
    ['#', { name: 'overview' }],
    ['#/', { name: 'overview' }],
    ['#/xyz', { name: 'overview' }],
    ['#/inexistant/quelque-chose', { name: 'overview' }],
  ])('%s → %o', (hash, expected) => {
    expect(parseHash(hash)).toEqual(expected);
  });
});

describe('toHash — hash canonique par route', () => {
  it.each<[Route, string]>([
    [{ name: 'overview' }, '#/'],
    [{ name: 'portfolio' }, '#/invest'],
    [{ name: 'asset', asset: 'btc' }, '#/invest/asset/btc'],
    [{ name: 'asset', asset: 'ab c' }, '#/invest/asset/ab%20c'],
    [{ name: 'import' }, '#/invest/import'],
    [{ name: 'add' }, '#/invest/add'],
    [{ name: 'report' }, '#/invest/report'],
    [{ name: 'secondOpinion' }, '#/invest/second-opinion'],
    [{ name: 'trading' }, '#/trading'],
    [{ name: 'more' }, '#/more'],
    [{ name: 'welcome' }, '#/welcome'],
    [{ name: 'settings' }, '#/settings'],
    [{ name: 'privacy' }, '#/privacy'],
    [{ name: 'help' }, '#/help'],
    [{ name: 'news' }, '#/news'],
  ])('%o → %s', (route, expected) => {
    expect(toHash(route)).toBe(expected);
  });
});

describe('toHash / parseHash — aller-retour', () => {
  const routes: Route[] = [
    { name: 'welcome' },
    { name: 'overview' },
    { name: 'portfolio' },
    { name: 'asset', asset: 'btc' },
    { name: 'asset', asset: 'matic' },
    { name: 'asset', asset: 'ab c' },
    { name: 'import' },
    { name: 'add' },
    { name: 'report' },
    { name: 'secondOpinion' },
    { name: 'trading' },
    { name: 'more' },
    { name: 'settings' },
    { name: 'privacy' },
    { name: 'help' },
    { name: 'news' },
  ];

  it.each(routes)('parseHash(toHash(%o)) redonne la route de départ', (route) => {
    expect(parseHash(toHash(route))).toEqual(route);
  });
});
