import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emptyState } from '../schema';
import { hlcCompare } from './hlc';
import { stampChanges } from './stamp';
import { emptySyncMeta } from './types';

const DEVICE = 'device-a';
const NOW = 1_758_000_000_000;

const withManual = (notes: Record<string, string>) => ({
  ...emptyState(),
  manualEvents: Object.fromEntries(Object.entries(notes).map(([id, note]) => [id, { note }])),
});

describe('stampChanges', () => {
  it('ajout : la nouvelle clé reçoit une version fraîche', () => {
    const prev = withManual({});
    const next = withManual({ m1: 'x' });
    const meta = stampChanges(prev, next, emptySyncMeta(), DEVICE, NOW);
    expect(meta.versions.manualEvents?.['m1']).toEqual({ t: expect.any(String) });
    expect(meta.versions.manualEvents?.['m1']?.del).toBeUndefined();
    expect(meta.clock).toBe(meta.versions.manualEvents?.['m1']?.t);
  });

  it('modification : contenu différent ⇒ nouvelle version (même clé)', () => {
    const prev = withManual({ m1: 'x' });
    const next = withManual({ m1: 'y' });
    const meta = stampChanges(prev, next, emptySyncMeta(), DEVICE, NOW);
    expect(meta.versions.manualEvents?.['m1']?.t).toBeTruthy();
    expect(meta.versions.manualEvents?.['m1']?.del).toBeUndefined();
  });

  it('suppression : pierre tombale datée (`del: true`)', () => {
    const prev = withManual({ m1: 'x' });
    const next = withManual({});
    const meta = stampChanges(prev, next, emptySyncMeta(), DEVICE, NOW);
    expect(meta.versions.manualEvents?.['m1']).toEqual({ t: expect.any(String), del: true });
  });

  it('inchangé : aucune version modifiée, même absente d’un enregistrement resté vierge', () => {
    const prev = withManual({ m1: 'x' });
    const next = withManual({ m1: 'x' }); // même contenu, nouvel objet (comme `$state.snapshot`)
    const meta = stampChanges(prev, next, emptySyncMeta(), DEVICE, NOW);
    expect(meta.versions.manualEvents).toBeUndefined(); // jamais daté : reste « hérité »
    expect(meta.clock).toBe(''); // aucun tick n'a eu lieu
  });

  it('inchangé mais déjà daté : la version existante est conservée TELLE QUELLE (jamais retamponnée)', () => {
    const prev = withManual({ m1: 'x' });
    const next = withManual({ m1: 'x' });
    const meta = {
      v: 1 as const,
      clock: '1700000000000.0000.d0',
      versions: { manualEvents: { m1: { t: '1700000000000.0000.d0' } } },
    };
    const result = stampChanges(prev, next, meta, DEVICE, NOW);
    expect(result.versions.manualEvents?.['m1']).toEqual({ t: '1700000000000.0000.d0' });
    expect(result.clock).toBe('1700000000000.0000.d0'); // pas de nouveau tick
  });

  it('un lot de plusieurs changements dans le même appel reçoit des ticks strictement croissants (ordre de clé déterministe)', () => {
    const prev = withManual({});
    const next = withManual({ m1: 'x', m2: 'y', m3: 'z' });
    const meta = stampChanges(prev, next, emptySyncMeta(), DEVICE, NOW);
    const ticks = ['m1', 'm2', 'm3'].map((id) => meta.versions.manualEvents?.[id]?.t as string);
    expect(ticks.every(Boolean)).toBe(true);
    expect(new Set(ticks).size).toBe(3); // trois ticks distincts
    expect([...ticks].sort(hlcCompare)).toEqual(ticks); // ordre alphabétique des clés = ordre des ticks
  });

  it('itération à clés TRIÉES, pas à l’ordre d’insertion : des clés insérées à l’envers reçoivent quand même des ticks dans l’ordre alphabétique', () => {
    const prev = withManual({});
    // Insertion délibérément inverse de l'ordre alphabétique.
    const next = withManual({ z: '1', m: '2', a: '3' });
    const meta = stampChanges(prev, next, emptySyncMeta(), DEVICE, NOW);
    const tickOf = (id: string) => meta.versions.manualEvents?.[id]?.t as string;
    // Si l'itération suivait l'ordre d'insertion plutôt que l'ordre trié, `z` recevrait le premier
    // tick (le plus petit) au lieu du dernier.
    expect(tickOf('a') < tickOf('m')).toBe(true);
    expect(tickOf('m') < tickOf('z')).toBe(true);
  });

  it('property : sur un état totalement inchangé, jamais aucune version ne bouge', () => {
    const stateArb = fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.string());
    fc.assert(
      fc.property(stateArb, (notes) => {
        const state = withManual(notes);
        const meta = emptySyncMeta();
        const stamped = stampChanges(state, structuredClone(state), meta, DEVICE, NOW);
        expect(stamped).toEqual(meta);
      }),
      { numRuns: 100 },
    );
  });

  it('property : chaque clé ajoutée ou modifiée obtient une version présente dans le résultat, chaque clé supprimée une pierre tombale', () => {
    const notesArb = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 4 }),
      fc.string({ maxLength: 8 }),
    );
    fc.assert(
      fc.property(notesArb, notesArb, (before, after) => {
        const prev = withManual(before);
        const next = withManual(after);
        const meta = stampChanges(prev, next, emptySyncMeta(), DEVICE, NOW);
        const versions = meta.versions.manualEvents ?? {};
        for (const key of Object.keys(after)) {
          if (!(key in before) || before[key] !== after[key])
            expect(versions[key]?.del).toBeUndefined();
        }
        for (const key of Object.keys(before)) {
          if (!(key in after)) expect(versions[key]?.del).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
