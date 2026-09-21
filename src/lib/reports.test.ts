/**
 * Le registre des rapports (décision n° 178). Il décide de trois choses : quels rapports existent,
 * à quel espace chacun appartient, et dans quel ordre les liens croisés se présentent. Une erreur
 * ici ne lève rien — elle envoie vers un rapport vide, ou en cache un.
 */
import { describe, expect, it } from 'vitest';
import { REPORTS, reportAt, reportOf } from './reports';
import { SPACES, spaceOf } from './spaces';

describe('registre des rapports', () => {
  it('range chaque rapport dans l’espace qui porte sa route', () => {
    // Sinon le lien de retour et l'onglet allumé désigneraient un autre espace que le rapport.
    for (const report of REPORTS)
      expect(spaceOf(report.route.name).id, report.id).toBe(report.space);
  });

  it('donne un rapport, et un seul, à chaque espace qui produit de la valeur', () => {
    // « Plus » ne produit rien : il n'a pas de rapport, et c'est voulu.
    const producing = SPACES.filter((s) => s.id !== 'more').map((s) => s.id);
    expect(REPORTS.map((r) => r.space).sort()).toEqual([...producing].sort());
  });

  it('suit l’ordre de la barre de navigation', () => {
    // WCAG 2.2 § 3.2.3 : les mêmes liens, dans le même ordre, sur chaque rapport.
    const navOrder = SPACES.map((s) => s.id);
    const order = REPORTS.map((r) => navOrder.indexOf(r.space));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('n’a ni identifiant, ni titre, ni route en double', () => {
    for (const pick of [
      (r: (typeof REPORTS)[number]) => r.id,
      (r: (typeof REPORTS)[number]) => r.title,
      (r: (typeof REPORTS)[number]) => r.route.name,
    ]) {
      const values = REPORTS.map(pick);
      expect(new Set(values).size, values.join(', ')).toBe(values.length);
    }
  });

  it('retrouve un rapport par son espace et par sa route', () => {
    expect(reportOf('trading')?.route).toEqual({ name: 'tradingReport' });
    expect(reportOf('wealth')?.route).toEqual({ name: 'loansReport' });
    expect(reportOf('more')).toBeNull();
    expect(reportAt('report')?.id).toBe('invest');
    expect(reportAt('settings')).toBeNull();
  });
});
