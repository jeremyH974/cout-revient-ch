import { describe, expect, it } from 'vitest';
import { TAX_YEAR_LABEL, taxYearWording } from './tax-year';

const TODAY = '2026-09-20';

describe('le vocabulaire de l’année fiscale', () => {
  it('annonce l’année civile en cours comme provisoire', () => {
    const w = taxYearWording(2026, TODAY);
    expect(w.state).toBe('Année en cours — provisoire.');
    expect(w.detail).toBe('Tout peut encore bouger d’ici le 31 décembre.');
  });

  it('annonce une année passée comme close', () => {
    expect(taxYearWording(2025, TODAY).state).toBe('Année close.');
  });

  it('annonce une année future comme à venir', () => {
    expect(taxYearWording(2027, TODAY).state).toBe('Année à venir.');
  });

  /**
   * C'est LA question que l'étiquette « Année déclarée » laissait sans réponse : 2026 se déclare
   * au printemps 2027, jamais en 2026. Le décalage de un an vaut pour les trois états.
   */
  it('nomme le printemps de la déclaration, soit l’année suivante', () => {
    expect(taxYearWording(2026, TODAY).filing).toBe('Elle se déclare au printemps 2027.');
    expect(taxYearWording(2025, TODAY).filing).toBe('Elle se déclare au printemps 2026.');
    expect(taxYearWording(2027, TODAY).filing).toBe('Elle se déclare au printemps 2028.');
  });

  /**
   * Un fait de calendrier, pas une échéance : sur une année close depuis longtemps, l'ancien
   * « À déclarer au printemps 2025 » décrivait un printemps passé comme s'il restait à venir.
   */
  it('énonce le printemps au présent, même pour un printemps passé', () => {
    const w = taxYearWording(2024, TODAY);
    expect(w.filing).toBe('Elle se déclare au printemps 2025.');
    expect(w.filing).not.toContain('À déclarer');
  });

  it('la phrase entière est exactement ses trois morceaux', () => {
    const w = taxYearWording(2026, TODAY);
    expect(w.note).toBe(`${w.state} ${w.detail} ${w.filing}`);
  });

  /**
   * L'état se lit sur le seul calendrier : la même année bascule de « en cours » à « close » au
   * passage du 31 décembre, sans qu'aucune opération n'ait changé.
   */
  it('bascule de « en cours » à « close » au changement d’année civile', () => {
    expect(taxYearWording(2026, '2026-12-31').state).toBe('Année en cours — provisoire.');
    expect(taxYearWording(2026, '2027-01-01').state).toBe('Année close.');
  });

  /**
   * Le libellé du sélecteur ne porte aucun qualificatif : « déclarée », « fiscale » ou
   * « d'imposition » rouvriraient chacun l'ambiguïté « année décrite / année de dépôt ».
   */
  it('le libellé du sélecteur reste nu', () => {
    expect(TAX_YEAR_LABEL).toBe('Année');
  });
});
