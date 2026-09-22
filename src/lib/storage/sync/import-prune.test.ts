import { describe, expect, it } from 'vitest';
import { pruneRowsForImports } from './import-prune';

const raw = (importId: string) => ({ importId, qty: '1' });
const pivot = (importId: string) => ({ importId, amount: '1' });

describe('pruneRowsForImports', () => {
  it('retire les lignes brutes ET pivot du lot, ainsi que leur qualification', () => {
    const rawRows = { r1: raw('imp-a'), r2: raw('imp-b') };
    const pivotRows = { p1: pivot('imp-a'), p2: pivot('imp-b') };
    const qualifications = { r1: 'q', p1: 'q', r2: 'q', p2: 'q' };
    const result = pruneRowsForImports(rawRows, pivotRows, qualifications, ['imp-a']);
    expect(result.rawRows).toEqual({ r2: raw('imp-b') });
    expect(result.pivotRows).toEqual({ p2: pivot('imp-b') });
    expect(result.qualifications).toEqual({ r2: 'q', p2: 'q' });
    expect(result.removed).toBe(2);
  });

  it('un ensemble vide ne retire rien et renvoie les mêmes références', () => {
    const rawRows = { r1: raw('imp-a') };
    const pivotRows = { p1: pivot('imp-a') };
    const qualifications = { r1: 'q' };
    const result = pruneRowsForImports(rawRows, pivotRows, qualifications, []);
    expect(result).toEqual({ rawRows, pivotRows, qualifications, removed: 0 });
    expect(result.rawRows).toBe(rawRows); // court-circuit : mêmes références, pas de copie inutile
  });

  it("une ligne sans import connu (`importId: ''`) n’est jamais concernée", () => {
    const rawRows = { r1: raw('') };
    const result = pruneRowsForImports(rawRows, {}, {}, ['imp-a']);
    expect(result.rawRows).toEqual(rawRows);
    expect(result.removed).toBe(0);
  });

  it('plusieurs lots à la fois (le cas de la fusion, où N pierres tombales peuvent coexister)', () => {
    const rawRows = { r1: raw('imp-a'), r2: raw('imp-b'), r3: raw('imp-c') };
    const result = pruneRowsForImports(rawRows, {}, {}, ['imp-a', 'imp-c']);
    expect(Object.keys(result.rawRows)).toEqual(['r2']);
    expect(result.removed).toBe(2);
  });

  it('accepte n’importe quel itérable (tableau ou Set) — jamais de `Set` mutable construit au point d’appel côté `src/state`', () => {
    const rawRows = { r1: raw('imp-a') };
    const byArray = pruneRowsForImports(rawRows, {}, {}, ['imp-a']);
    const bySet = pruneRowsForImports(rawRows, {}, {}, new Set(['imp-a']));
    expect(byArray).toEqual(bySet);
  });

  it('ne mute aucune des entrées reçues', () => {
    const rawRows = { r1: raw('imp-a'), r2: raw('imp-b') };
    const qualifications = { r1: 'q', r2: 'q' };
    pruneRowsForImports(rawRows, {}, qualifications, ['imp-a']);
    expect(rawRows).toEqual({ r1: raw('imp-a'), r2: raw('imp-b') });
    expect(qualifications).toEqual({ r1: 'q', r2: 'q' });
  });
});
