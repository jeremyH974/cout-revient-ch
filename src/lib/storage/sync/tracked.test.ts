import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emptyState } from '../schema';
import { readTracked, recordToImports, TRACKED_COLLECTIONS, writeTracked } from './tracked';

describe('tracked — registre des collections suivies', () => {
  it('énumère exactement les douze collections attendues, `alerts.*` imbriquées comprises', () => {
    expect([...TRACKED_COLLECTIONS].sort()).toEqual(
      [
        'accounts',
        'alerts.rules',
        'alerts.states',
        'assetSettings',
        'duplicateOverrides',
        'imports',
        'journal',
        'manualEvents',
        'manualTrades',
        'qualifications',
        'taxAnnotations',
        'transferOverrides',
      ].sort(),
    );
  });

  it('lit un conteneur simple tel quel', () => {
    const state = { ...emptyState(), manualEvents: { m1: { note: 'x' } } };
    expect(readTracked(state, 'manualEvents')).toEqual({ m1: { note: 'x' } });
  });

  it('conteneur absent ou de mauvaise forme : Record vide, jamais une exception', () => {
    expect(readTracked({}, 'accounts')).toEqual({});
    expect(readTracked({ accounts: null }, 'accounts')).toEqual({});
    expect(readTracked({ accounts: 'nope' }, 'accounts')).toEqual({});
    expect(readTracked({}, 'alerts.rules')).toEqual({});
    expect(readTracked({ alerts: null }, 'alerts.states')).toEqual({});
  });

  it('writeTracked : remplace SANS muter l’état d’origine', () => {
    const state = { ...emptyState(), manualEvents: { m1: { note: 'x' } } };
    const next = writeTracked(state, 'manualEvents', { m2: { note: 'y' } });
    expect(next['manualEvents']).toEqual({ m2: { note: 'y' } });
    expect(state.manualEvents).toEqual({ m1: { note: 'x' } }); // inchangé
  });

  it('alerts.rules / alerts.states : lecture et écriture imbriquées, sans toucher au reste de `alerts`', () => {
    const state = {
      ...emptyState(),
      alerts: {
        ...emptyState().alerts,
        rules: { a: 1 },
        states: { a: 2 },
        settings: { watch: true },
      },
    };
    expect(readTracked(state, 'alerts.rules')).toEqual({ a: 1 });
    expect(readTracked(state, 'alerts.states')).toEqual({ a: 2 });
    const next = writeTracked(state, 'alerts.rules', { b: 9 });
    const alerts = (next as typeof state)['alerts'];
    expect(alerts.rules).toEqual({ b: 9 });
    expect(alerts.states).toEqual({ a: 2 }); // pas touché
    expect(alerts.settings).toEqual({ watch: true }); // pas touché
  });

  it('imports : le tableau devient un Record par id, et réciproquement', () => {
    const state = {
      ...emptyState(),
      imports: [
        { id: 'imp-1', at: '2026-01-01T10:00:00' },
        { id: 'imp-2', at: '2026-01-02T10:00:00' },
      ],
    };
    const record = readTracked(state, 'imports');
    expect(Object.keys(record).sort()).toEqual(['imp-1', 'imp-2']);
    expect(record['imp-1']).toEqual({ id: 'imp-1', at: '2026-01-01T10:00:00' });
  });

  it('imports : un élément sans id de chaîne est ignoré à la lecture, jamais une exception', () => {
    const state = { ...emptyState(), imports: [{ at: '2026-01-01T10:00:00' }, null, 'x'] };
    expect(readTracked(state, 'imports')).toEqual({});
  });

  it('imports : un id VIDE ("") est ignoré, comme un id absent', () => {
    const state = { ...emptyState(), imports: [{ id: '', at: '2026-01-01T10:00:00' }] };
    expect(readTracked(state, 'imports')).toEqual({});
  });

  it('imports : `state.imports` n’étant pas un tableau (sauvegarde altérée), le résultat est vide plutôt qu’une exception', () => {
    expect(readTracked({ imports: 'nope' }, 'imports')).toEqual({});
    expect(readTracked({ imports: undefined }, 'imports')).toEqual({});
    expect(readTracked({}, 'imports')).toEqual({});
  });

  it('recordToImports : une valeur `undefined` dans le Record (aucun champ) ne fait pas planter le tri', () => {
    expect(() => recordToImports({ a: undefined })).not.toThrow();
    // Sans `at` ni `id` exploitables, l'élément vaut « inconnu » — trié en premier, pas exclu :
    // un Record garde toutes ses clés, contrairement au filtrage fait à la lecture du tableau.
    const sorted = recordToImports({ a: undefined, b: { id: 'b', at: '2026-01-01T00:00:00' } });
    expect(sorted).toHaveLength(2);
  });

  it("recordToImports : un `at` qui n'est pas une chaîne (nombre, sauvegarde altérée) est traité comme « inconnu », jamais utilisé tel quel", () => {
    const withBadAt = { id: 'bad', at: 42 };
    const withGoodAt = { id: 'good', at: '2026-01-01T00:00:00' };
    // « inconnu » vaut '' : il doit se classer AVANT toute date lisible, jamais après.
    const sorted = recordToImports({ good: withGoodAt, bad: withBadAt }) as { id: string }[];
    expect(sorted.map((i) => i.id)).toEqual(['bad', 'good']);
  });

  it(
    'imports : la reconstruction en tableau respecte l’ordre CHRONOLOGIQUE (`at`), pas l’ordre du ' +
      'Record — Portfolio.svelte lit `imports[imports.length - 1]` comme « le plus récent »',
    () => {
      // Un Record n'a pas d'ordre garanti : on insère volontairement dans le désordre.
      const record = {
        'imp-c': { id: 'imp-c', at: '2026-03-01T00:00:00' },
        'imp-a': { id: 'imp-a', at: '2026-01-01T00:00:00' },
        'imp-b': { id: 'imp-b', at: '2026-02-01T00:00:00' },
      };
      const array = recordToImports(record) as { id: string; at: string }[];
      expect(array.map((i) => i.id)).toEqual(['imp-a', 'imp-b', 'imp-c']);
      expect(array[array.length - 1]?.id).toBe('imp-c');
    },
  );

  it('imports : à `at` égal, l’id départage de façon déterministe', () => {
    const record = {
      'imp-b': { id: 'imp-b', at: '2026-01-01T00:00:00' },
      'imp-a': { id: 'imp-a', at: '2026-01-01T00:00:00' },
    };
    expect((recordToImports(record) as { id: string }[]).map((i) => i.id)).toEqual([
      'imp-a',
      'imp-b',
    ]);
  });

  it('imports : à `at` égal, TROIS ids dans le désordre se trient tous (pas seulement une paire)', () => {
    // Trois éléments forcent le tri à comparer des paires dans les deux sens (id(a) < id(b) ET
    // id(a) > id(b)) : une seule paire ne le garantit pas selon l'algorithme de tri utilisé.
    const at = '2026-01-01T00:00:00';
    const record = {
      c: { id: 'c', at },
      a: { id: 'a', at },
      b: { id: 'b', at },
    };
    expect((recordToImports(record) as { id: string }[]).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('imports : `at` STRICTEMENT différent départage sans regarder l’id, même quand l’id irait dans l’autre sens', () => {
    // z < a alphabétiquement serait le mauvais ordre : la date doit décider en premier, toujours.
    const record = {
      z: { id: 'z', at: '2026-01-01T00:00:00' },
      a: { id: 'a', at: '2026-06-01T00:00:00' },
    };
    expect((recordToImports(record) as { id: string }[]).map((i) => i.id)).toEqual(['z', 'a']);
  });

  it('imports : aller-retour tableau → Record → tableau (même ensemble, ordre chronologique)', () => {
    const original = [
      { id: 'imp-1', at: '2026-01-05T00:00:00' },
      { id: 'imp-2', at: '2026-01-01T00:00:00' },
      { id: 'imp-3', at: '2026-01-10T00:00:00' },
    ];
    const state = { ...emptyState(), imports: original };
    const record = readTracked(state, 'imports');
    const back = writeTracked(state, 'imports', record)['imports'] as { id: string }[];
    expect(back.map((i) => i.id)).toEqual(['imp-2', 'imp-1', 'imp-3']); // trié par `at`
    expect(back).toHaveLength(original.length);
  });

  it('property : lire puis réécrire une collection suivie (identité) ne change pas son contenu', () => {
    const collectionArb = fc.constantFrom(
      ...TRACKED_COLLECTIONS.filter((c) => c !== 'imports'), // `imports` a sa propre forme, testée à part
    );
    const valueArb = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s !== '__proto__'),
      fc.record({ note: fc.string() }),
    );
    fc.assert(
      fc.property(collectionArb, valueArb, (name, value) => {
        const state = emptyState();
        const next = writeTracked(state, name, value);
        expect(readTracked(next, name)).toEqual(value);
      }),
      { numRuns: 100 },
    );
  });
});
