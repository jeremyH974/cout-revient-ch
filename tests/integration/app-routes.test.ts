/**
 * **Chaque route déclarée a une branche dans `App.svelte`.**
 *
 * Le routeur est une union discriminée — solide — mais le choix du composant, lui, est une CHAÎNE
 * de `{#if route.name === …}` terminée par un `{:else}` vers la Vue d'ensemble. Rien, à la
 * compilation, ne dit qu'une route a bien sa branche : une route déclarée dans le type, comprise
 * par `parseHash`, rangée dans son espace, et oubliée là, retombe **en silence** sur la Vue
 * d'ensemble. L'utilisateur voit un écran qui n'est pas le sien, sans erreur ni message.
 *
 * Ce trou a été trouvé en inventoriant ce qu'une route neuve oblige à toucher : sept points de
 * couplage, dont deux que rien ne gardait. Celui-ci est le plus coûteux, parce que son symptôme
 * ressemble à un fonctionnement normal.
 *
 * `SPACES` fait foi, comme pour `architecture-doc.test.ts` : c'est le registre que la navigation
 * lit, et une route qui n'y figure pas n'est de toute façon joignable par aucun onglet.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPACES } from '../../src/lib/spaces';

const APP = 'src/App.svelte';
const source = readFileSync(APP, 'utf8');

/** La Vue d'ensemble est le `{:else}` de la chaîne : elle n'a pas de branche nommée, à dessein. */
const DEFAULT_ROUTE = 'overview';

describe('App.svelte rend chaque route déclarée', () => {
  it('une branche par route, la Vue d’ensemble étant le repli', () => {
    const declared = SPACES.flatMap((space) => space.routes);
    // Garde-fou du garde-fou : un registre vide passerait sans rien prouver.
    expect(declared.length).toBeGreaterThanOrEqual(25);
    const missing = declared
      .filter((name) => name !== DEFAULT_ROUTE)
      .filter((name) => !source.includes(`route.name === '${name}'`));
    expect(
      missing,
      `routes sans branche dans ${APP} : elles retomberaient en silence sur la Vue d’ensemble`,
    ).toEqual([]);
  });

  it('le repli existe, et c’est bien la Vue d’ensemble', () => {
    // Sans lui, une route inconnue — un vieux favori, un lien partagé — n'afficherait rien du tout.
    expect(source).toMatch(/\{:else\}\s*<Overview \/>/);
  });
});
