/**
 * La garde anti-formule, et surtout **là où elle ne s'applique pas**.
 *
 * Le cas le plus facile à casser par bonne intention n'est pas la garde elle-même : c'est la
 * frontière. Un jour, quelqu'un verra que l'export portable ne désarme rien et voudra « corriger »
 * l'oubli — ce qui corromprait un fichier destiné à Koinly. Le dernier bloc de ce fichier existe
 * pour que ce jour-là, la CI parle.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FORMULA_STARTERS, textCell } from './csv-cell';

/** Le contenu réel de la cellule, guillemets extérieurs retirés et doublons rétablis. */
const contentOf = (cell: string): string => cell.slice(1, -1).replaceAll('""', '"');

describe('cellule d’un export tableur', () => {
  it('laisse une valeur ordinaire intacte', () => {
    expect(textCell('Compte principal')).toBe('"Compte principal"');
    expect(textCell('BTC')).toBe('"BTC"');
    expect(textCell('')).toBe('""');
  });

  it('échappe toujours les guillemets, garde ou pas', () => {
    expect(textCell('dit « oui » et "non"')).toBe('"dit « oui » et ""non"""');
    expect(textCell('="cité"')).toBe('"\'=""cité"""');
  });

  for (const starter of FORMULA_STARTERS) {
    const label = JSON.stringify(starter);
    it(`désarme une valeur commençant par ${label}`, () => {
      const cell = textCell(`${starter}1+1`);
      expect(cell.startsWith(`"'`), `${label} n’a pas été désarmé`).toBe(true);
      // Rien n'est perdu : la valeur d'origine est intégralement conservée après l'apostrophe.
      expect(contentOf(cell).slice(1)).toBe(`${starter}1+1`);
    });
  }

  it('ne désarme que la première position — « a=b » n’est pas une formule', () => {
    expect(textCell('a=b')).toBe('"a=b"');
    expect(textCell('taux +3 %')).toBe('"taux +3 %"');
  });

  /**
   * L'invariant, qui vaut mieux que les cas choisis ci-dessus : quelle que soit la chaîne, le
   * tableur ne verra jamais une amorce de formule en tête de cellule.
   */
  it('propriété : aucune cellule ne commence jamais par une amorce de formule', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const first = contentOf(textCell(value)).slice(0, 1);
        expect((FORMULA_STARTERS as readonly string[]).includes(first)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('propriété : la valeur d’origine est toujours récupérable', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const content = contentOf(textCell(value));
        // Soit la cellule est la valeur, soit c'est l'apostrophe suivie de la valeur : jamais autre
        // chose. Rien n'est tronqué, rien n'est réécrit.
        expect(content === value || content === `'${value}`).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
