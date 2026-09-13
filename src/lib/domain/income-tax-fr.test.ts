/**
 * Le barème et les deux mécanismes propres à l'option (décision n° 150).
 *
 * Ce fichier ne teste pas un calcul — il n'y en a pas — mais une **table relevée sur le texte**.
 * Ce qui la protège est donc l'exactitude, chiffre par chiffre : une borne fausse ferait
 * reconnaître à quelqu'un une tranche qui n'est pas la sienne, et un taux faux chiffrerait un
 * arbitrage faux.
 */
import { describe, expect, it } from 'vitest';
import { D } from './money';
import {
  CSG_DEDUCTIBLE_RATE,
  CSG_DEDUCTIBLE_SOURCE_ID,
  DIVIDEND_ABATEMENT,
  INCOME_TAX_SCALES,
  MARGINAL_RATES,
  scaleFor,
} from './income-tax-fr';

describe('barème de l’impôt sur le revenu', () => {
  it('porte les bornes 2025 telles que l’article 197 les fixe après indexation', () => {
    expect(scaleFor(2025)?.brackets).toEqual([
      { upToEur: '11600', rate: '0' },
      { upToEur: '29579', rate: '0.11' },
      { upToEur: '84577', rate: '0.30' },
      { upToEur: '181917', rate: '0.41' },
      { upToEur: null, rate: '0.45' },
    ]);
  });

  it('garde les bornes 2024, qui ne sont pas celles de 2025', () => {
    // L'indexation de 0,9 % les sépare : servir les unes pour les autres ferait reconnaître
    // la mauvaise tranche à quelqu'un qui déclare une année ancienne.
    expect(scaleFor(2024)?.brackets[0]?.upToEur).toBe('11497');
    expect(scaleFor(2024)?.brackets[0]?.upToEur).not.toBe(scaleFor(2025)?.brackets[0]?.upToEur);
  });

  it('ne devine aucune année absente de la table', () => {
    expect(scaleFor(2023)).toBeNull();
    expect(scaleFor(2027)).toBeNull();
  });

  it('monte en taux et en bornes, et ne se termine que par une tranche ouverte', () => {
    for (const scale of INCOME_TAX_SCALES) {
      const last = scale.brackets[scale.brackets.length - 1];
      expect(last?.upToEur, `${scale.year} — dernière tranche`).toBeNull();
      for (let i = 1; i < scale.brackets.length; i++) {
        const previous = scale.brackets[i - 1]!;
        const current = scale.brackets[i]!;
        expect(D(current.rate).gt(D(previous.rate)), `${scale.year} — taux ${i}`).toBe(true);
        if (current.upToEur !== null)
          expect(D(current.upToEur).gt(D(previous.upToEur!)), `${scale.year} — borne ${i}`).toBe(
            true,
          );
      }
    }
  });

  it('expose exactement les taux marginaux du barème, sans doublon ni oubli', () => {
    // La liste sert de choix à l'écran : un taux de trop y ferait chiffrer une tranche inexistante.
    expect(MARGINAL_RATES).toEqual(['0', '0.11', '0.30', '0.41', '0.45']);
    for (const scale of INCOME_TAX_SCALES)
      expect(
        scale.brackets.map((b) => b.rate),
        `${scale.year}`,
      ).toEqual([...MARGINAL_RATES]);
  });
});

describe('ce qui n’existe que sous le barème', () => {
  it('déduit 6,8 points de CSG, et pas la CSG entière', () => {
    // Le piège : la CSG vaut 10,6 % sur les revenus du patrimoine depuis 2025, et seule une part
    // fixe de 6,8 points se déduit. Prendre le taux de la CSG surestimerait l'avantage du barème.
    expect(CSG_DEDUCTIBLE_RATE).toBe('0.068');
  });

  it('abat 40 % des revenus distribués, et rien d’autre', () => {
    expect(DIVIDEND_ABATEMENT).toBe('0.4');
  });

  /**
   * Le croisement avec la veille (`format/tax-source.test.ts`) écarte les identifiants vides avant
   * de chercher : une chaîne vide y passerait donc inaperçue, et le chiffre perdrait sa source sans
   * que rien ne rougisse. Les deux identifiants se vérifient donc ici, en toutes lettres.
   */
  it('rattache chaque chiffre à l’entrée de veille qui porte son texte', () => {
    expect(scaleFor(2025)?.sourceId).toBe('bareme-ir-2025');
    expect(CSG_DEDUCTIBLE_SOURCE_ID).toBe('csg-deductible');
  });
});
