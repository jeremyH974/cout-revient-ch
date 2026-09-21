/**
 * Le titre de l'onglet (WCAG 2.2 § 2.4.2). Ce qui est surveillé : que chaque route en ait un qui
 * lui soit propre, et que le titre d'un rapport soit celui que son PDF imprime.
 */
import { describe, expect, it } from 'vitest';
import { APP_NAME, pageTitle, screenTitle } from './page-title';
import { REPORTS } from './reports';
import type { Route, RouteName } from './router.svelte';
import { SPACES } from './spaces';

/** Une route déclarée, avec un paramètre factice pour celles qui en portent un. */
const routeOf = (name: RouteName): Route =>
  name === 'asset'
    ? { name, asset: 'btc' }
    : name === 'trade'
      ? { name, id: 't1' }
      : ({ name } as Route);

const ALL: Route[] = SPACES.flatMap((s) => s.routes).map(routeOf);

describe('titre de page', () => {
  it('nomme le sujet d’abord, l’application ensuite', () => {
    expect(pageTitle({ name: 'taxes' })).toBe(`Impôts — ${APP_NAME}`);
  });

  it('donne à chaque route un titre qui n’appartient qu’à elle', () => {
    // Deux écrans au même titre, c'est deux onglets qu'un lecteur d'écran ne distingue pas.
    const titles = ALL.map(screenTitle);
    const duplicated = titles.filter((t, i) => titles.indexOf(t) !== i);
    expect(duplicated, 'titres en double').toEqual([]);
  });

  it('reprend le titre imprimé par le modèle de chaque rapport', () => {
    for (const report of REPORTS) expect(screenTitle(report.route), report.id).toBe(report.title);
  });

  it('nomme une fiche d’actif par son code', () => {
    expect(screenTitle({ name: 'asset', asset: 'eth' })).toBe('ETH');
  });
});
