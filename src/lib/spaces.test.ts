/**
 * Le registre des espaces décide de trois choses à la fois : l'onglet allumé dans la barre du bas,
 * la cible du lien de retour, et l'accent visuel. Une route rangée dans le mauvais espace ne
 * provoque aucune erreur — elle envoie simplement l'utilisateur ailleurs (décision n° 122).
 */
import { describe, expect, it } from 'vitest';
import { SPACES, spaceOf, spaceOfProducer } from './spaces';
import type { RouteName } from './router.svelte';

describe('registre des espaces', () => {
  it('range les actifs cotés dans l’Investissement, le non-coté dans le Patrimoine', () => {
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
   * **La barre de répartition et sa légende doivent nommer le MÊME espace.** Elles ne le faisaient
   * pas : les Prêts sortaient « trading » dans la barre et retombaient sur la bordure de
   * l'investissement dans la légende, faute de règle dédiée. Les deux lisent désormais cette
   * fonction, et ce test dit ce qu'elle doit rendre.
   */
  it('range chaque producteur de la courbe dans son espace', () => {
    expect(spaceOfProducer('invest')).toBe('invest');
    expect(spaceOfProducer('lending')).toBe('wealth');
    // Un compte de trading porte son propre identifiant : le repli existe pour lui seul.
    expect(spaceOfProducer('0xabc123')).toBe('trading');
  });

  it('ne range jamais un producteur dans un espace absent du registre', () => {
    const ids = SPACES.map((s) => s.id);
    for (const producer of ['invest', 'lending', '0xabc123', 'inconnu'])
      expect(ids).toContain(spaceOfProducer(producer));
  });
});
