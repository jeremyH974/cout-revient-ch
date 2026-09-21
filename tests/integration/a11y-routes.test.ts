/**
 * Chaque route déclarée passe sous axe (décision n° 178).
 *
 * Le passage d'accessibilité (`tests/e2e/a11y.spec.ts`) visite deux listes de hashes écrites à la
 * main. Rien ne les croisait avec les routes déclarées : la décision n° 175 constatait que ses deux
 * routes neuves y avaient été ajoutées « par soin », et qu'un oubli n'aurait rien fait rougir. Ce
 * test ferme la boucle : une route qui n'apparaît dans aucune des deux listes fait échouer la CI,
 * au lieu d'échapper en silence à la norme WCAG.
 */
import { describe, expect, it } from 'vitest';
import { parseHash, type RouteName } from '../../src/lib/router.svelte';
import { SPACES } from '../../src/lib/spaces';
import { DEMO_ROUTES, EMPTY_ROUTES } from '../e2e/a11y-routes';

/**
 * Routes passées sous axe par un test dédié, et non par les deux listes : leur paramètre dépend
 * des données (l'identifiant d'un trade n'existe qu'une fois la démo chargée).
 */
const DEDICATED: Readonly<Partial<Record<RouteName, string>>> = {
  trade: 'a11y.spec.ts — « le détail d’un trade (détail et journal) »',
};

describe('toutes les routes passent sous axe', () => {
  const visited = new Set<RouteName>(
    [...EMPTY_ROUTES, ...DEMO_ROUTES].map((h) => parseHash(h).name),
  );

  it('chaque route déclarée figure dans une liste du passage axe, ou dans un test dédié', () => {
    const missing = SPACES.flatMap((s) => s.routes).filter(
      (name) => !visited.has(name) && DEDICATED[name] === undefined,
    );
    expect(missing, 'routes jamais passées sous axe').toEqual([]);
  });

  it('ne visite aucun hash qui retomberait sur une autre route', () => {
    // Un hash mal orthographié retombe sur la Vue d'ensemble : la liste croirait couvrir une route
    // qu'elle ne visite pas. Seuls `#/` et `#/overview` ont le droit d'y mener.
    for (const hash of [...EMPTY_ROUTES, ...DEMO_ROUTES])
      if (parseHash(hash).name === 'overview') expect(['#/', '#/overview'], hash).toContain(hash);
  });
});
