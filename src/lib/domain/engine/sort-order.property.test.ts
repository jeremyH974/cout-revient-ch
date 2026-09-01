/**
 * L'équivalence du comparateur d'instants (décision n° 81).
 *
 * `sortEvents` comparait les dates avec `localeCompare` ; elle utilise désormais les unités de code,
 * six fois plus rapides. Le remplacement n'est légitime que si l'ordre produit est **le même**, et
 * ce fichier existe pour l'exiger plutôt que de le croire.
 *
 * Ce n'est pas une équivalence générale : les deux ordres **divergent sur la casse**
 * (`'ch:a'.localeCompare('ch:A')` rend -1, `'ch:a' < 'ch:A'` est faux). Elle ne tient que parce
 * qu'un `NaiveDateTime` n'a pas de lettre variable — d'où une propriété sur ce format précis, et le
 * maintien de `localeCompare` sur les identifiants, qui en ont.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

/** Un `AAAA-MM-JJTHH:mm:ss` plausible : c'est exactement ce que le champ `at` contient. */
const naiveDateTime = fc
  .record({
    year: fc.integer({ min: 2009, max: 2099 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
  })
  .map(({ year, month, day, hour, minute, second }) => {
    const p = (n: number, w = 2): string => String(n).padStart(w, '0');
    return `${p(year, 4)}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:${p(second)}`;
  });

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

describe('comparateur d’instants', () => {
  it('propriété : même signe que `localeCompare`, sur n’importe quelle paire de dates', () => {
    fc.assert(
      fc.property(naiveDateTime, naiveDateTime, (a, b) => {
        expect(byCodeUnit(a, b)).toBe(Math.sign(a.localeCompare(b)));
      }),
      { numRuns: 2000 },
    );
  });

  it('propriété : trier une liste donne le même ordre par les deux voies', () => {
    fc.assert(
      fc.property(fc.array(naiveDateTime, { maxLength: 60 }), (dates) => {
        const parLocale = [...dates].sort((a, b) => a.localeCompare(b));
        const parCodeUnit = [...dates].sort(byCodeUnit);
        expect(parCodeUnit).toEqual(parLocale);
      }),
      { numRuns: 500 },
    );
  });

  /**
   * Le contre-exemple, gravé : il dit pourquoi l'équivalence s'arrête aux dates. Si quelqu'un
   * étend un jour la comparaison par unités de code aux identifiants, ce test lui rappellera ce
   * qu'il change — l'ordre de départage, donc la consommation des lots, donc le PRU.
   */
  it('la casse fait diverger les deux ordres : l’équivalence ne vaut PAS pour les identifiants', () => {
    expect(Math.sign('ch:a'.localeCompare('ch:A'))).toBe(-1);
    expect(byCodeUnit('ch:a', 'ch:A')).toBe(1);
  });
});
