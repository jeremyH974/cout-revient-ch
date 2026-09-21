/**
 * Le registre des espaces décide de trois choses à la fois : l'onglet allumé dans la barre du bas,
 * la cible du lien de retour, et l'accent visuel. Une route rangée dans le mauvais espace ne
 * provoque aucune erreur — elle envoie simplement l'utilisateur ailleurs (décision n° 122).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ProducerSpace } from './history/net-worth';
import { SPACES, spaceById, spaceOf, type SpaceId } from './spaces';
import type { RouteName } from './router.svelte';

describe('registre des espaces', () => {
  it('range les actifs cotés dans l’Investissement, les prêts dans leur propre espace', () => {
    // Crypto et titres partagent le moteur et le prix de revient moyen pondéré ; ce qui les sépare
    // est leur régime fiscal, pas leur nature de placement. Un prêt, lui, n'a pas de cours.
    expect(spaceOf('portfolio').id).toBe('invest');
    expect(spaceOf('titles').id).toBe('invest');
    expect(spaceOf('asset').id).toBe('invest');
    expect(spaceOf('loans').id).toBe('wealth');
  });

  it('l’accueil de chaque espace est une de ses propres routes', () => {
    // Un accueil pointant hors de son espace ferait basculer la barre du bas au premier retour.
    for (const space of SPACES) expect(space.routes).toContain(space.home.name);
  });

  it('aucune route n’appartient à deux espaces', () => {
    const seen = new Set<RouteName>();
    for (const space of SPACES) {
      for (const name of space.routes) {
        expect(seen.has(name), `route « ${name} » rangée dans deux espaces`).toBe(false);
        seen.add(name);
      }
    }
  });

  /**
   * **L'espace d'un producteur est porté par le producteur, jamais deviné** (décision n° 178).
   * Deux tables le devinaient à la lecture d'un identifiant — la couleur d'un côté, la destination
   * de l'autre —, avec un repli sur « trading » pour tout identifiant inconnu : un quatrième
   * producteur y serait tombé sans que rien ne le dise. Ce qui reste à garder, c'est qu'un
   * producteur ne puisse déclarer qu'un espace qui existe.
   */
  it('un producteur ne peut déclarer qu’un espace du registre', () => {
    expectTypeOf<ProducerSpace>().toMatchTypeOf<SpaceId>();
    const ids = SPACES.map((s) => s.id);
    for (const space of ['invest', 'trading', 'wealth'] satisfies ProducerSpace[])
      expect(ids, space).toContain(space);
  });

  it('retrouve un espace par son identifiant, et refuse d’en inventer un', () => {
    expect(spaceById('wealth').home).toEqual({ name: 'loans' });
    expect(spaceById('trading').home).toEqual({ name: 'trading' });
    expect(() => spaceById('inconnu' as SpaceId)).toThrow('Espace inconnu : inconnu');
  });
});
