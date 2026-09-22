import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canon } from './canon';

describe('canon — JSON canonique', () => {
  it('un tableau reste un tableau JSON, jamais un objet à clés numériques', () => {
    // Distingue une régression qui traiterait un tableau comme n'importe quel objet
    // (`Object.keys([1,2,3])` produirait `{"0":1,"1":2,"2":3}`, une forme différente).
    expect(canon([1, 2, 3])).toBe('[1,2,3]');
    expect(canon({ a: [1, 2] })).toBe('{"a":[1,2]}');
  });

  it('deux objets aux clés dans un ordre différent ont le même canon', () => {
    expect(canon({ a: 1, b: 2 })).toBe(canon({ b: 2, a: 1 }));
  });

  it('récursif : les objets imbriqués sont aussi triés', () => {
    const x = canon({ z: { b: 1, a: 2 }, a: 1 });
    const y = canon({ a: 1, z: { a: 2, b: 1 } });
    expect(x).toBe(y);
  });

  it('les tableaux gardent leur ordre (ce ne sont pas des ensembles)', () => {
    expect(canon([1, 2, 3])).not.toBe(canon([3, 2, 1]));
    expect(canon([{ b: 1, a: 2 }])).toBe(canon([{ a: 2, b: 1 }]));
  });

  it('un contenu réellement différent produit un canon différent', () => {
    expect(canon({ a: 1 })).not.toBe(canon({ a: 2 }));
    expect(canon({ a: 1 })).not.toBe(canon({ a: 1, b: null }));
  });

  it('null, primitives : rendu tel quel par JSON.stringify', () => {
    expect(canon(null)).toBe('null');
    expect(canon('x')).toBe('"x"');
    expect(canon(42)).toBe('42');
    expect(canon(true)).toBe('true');
  });

  const jsonArb = fc.jsonValue();

  it('property : un objet plat est invariant par permutation de ses clés', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), jsonArb), (obj) => {
        const entries = Object.entries(obj);
        const shuffled = Object.fromEntries([...entries].reverse());
        expect(canon(obj)).toBe(canon(shuffled));
      }),
      { numRuns: 100 },
    );
  });

  it('property : le canon est déterministe (même valeur ⇒ même canon, appelé deux fois)', () => {
    fc.assert(
      fc.property(jsonArb, (value) => {
        expect(canon(value)).toBe(canon(structuredClone(value)));
      }),
      { numRuns: 100 },
    );
  });
});
