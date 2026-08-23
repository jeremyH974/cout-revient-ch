import { describe, expect, it } from 'vitest';
import { emptyState, sanitizeState, type ImportBatchMeta } from './schema';

describe('assainissement des métadonnées d’import', () => {
  it('conserve les champs de diagnostic valides et écarte les entrées cassées', () => {
    const valid: ImportBatchMeta = {
      id: 'imp:1',
      at: '2026-08-23T09:00:00.000Z',
      fileName: 'export.csv',
      rows: 201,
      newRows: 201,
      format: 'coinhouse-2026-08',
      header: ['ID Coinhouse', 'Date'],
      unknownColumns: [],
    };
    const legacy: ImportBatchMeta = {
      id: 'imp:0',
      at: '2026-07-01T09:00:00.000Z',
      fileName: 'ancien.csv',
      rows: 10,
      newRows: 10,
    };
    const state = emptyState();
    state.imports = [
      valid,
      legacy,
      { id: 'imp:2', at: 42, fileName: 'x', rows: 'non', newRows: 1 } as unknown as ImportBatchMeta,
      'pas un objet' as unknown as ImportBatchMeta,
    ];
    const { state: clean, dropped } = sanitizeState(state);
    expect(dropped).toBe(2);
    expect(clean.imports).toEqual([valid, legacy]);
    expect('header' in clean.imports[1]!).toBe(false);
  });

  it('plafonne les listes et ignore les entrées non textuelles', () => {
    const state = emptyState();
    state.imports = [
      {
        id: 'imp:1',
        at: '2026-08-23T09:00:00.000Z',
        fileName: 'export.csv',
        rows: 1,
        newRows: 1,
        header: [...Array.from({ length: 60 }, (_, i) => `c${i}`), 7 as unknown as string],
        unknownColumns: ['x'.repeat(500)],
      },
    ];
    const { state: clean } = sanitizeState(state);
    const batch = clean.imports[0]!;
    expect(batch.header).toHaveLength(40);
    expect(batch.unknownColumns?.[0]).toHaveLength(120);
  });
});
