import { describe, expect, it } from 'vitest';
import { mergeStates, parseBackup, serializeBackup } from './json-io';
import { STORAGE_KEY, clearState, loadState, saveState } from './local-storage';
import { migrateState } from './migrations';
import { emptyState } from './schema';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

const row = (key: string) => ({
  key,
  importId: 'imp',
  lineNo: 2,
  id: key,
  at: '2026-01-01T10:00:00',
  type: 'Echange',
  qty: '1',
  asset: 'btc',
  marketPrice: null,
  valueEur: '1',
  feeAsset: null,
  feeEur: null,
  feeRebate: null,
  balance: '1',
  account: 'Portefeuille',
  extra: {},
});

describe('stockage', () => {
  it('aller-retour localStorage et vide/corrompu', () => {
    const storage = memoryStorage();
    expect(loadState(storage).status).toBe('empty');
    const state = emptyState();
    state.rawRows['a'] = row('a');
    expect(saveState(state, storage).ok).toBe(true);
    const loaded = loadState(storage);
    expect(loaded.status).toBe('ok');
    expect(loaded.state).toEqual(state);
    storage.setItem(STORAGE_KEY, '{not json');
    expect(loadState(storage).status).toBe('corrupt');
    clearState(storage);
    expect(loadState(storage).status).toBe('empty');
  });

  it('sauvegarde JSON : sérialisation, relecture, fusion', () => {
    const a = emptyState();
    a.rawRows['a'] = row('a');
    a.manualEvents['m1'] = {
      id: 'm1',
      at: '2026-01-01T10:00:00',
      kind: 'buy',
      asset: 'eth',
      qty: '1',
      amountEur: '2000',
      scope: 'coinhouse',
      note: '',
    };
    const text = serializeBackup(a, '2026-08-22T10:00:00Z');
    const parsed = parseBackup(text);
    expect(parsed.ok && parsed.exportedAt).toBe('2026-08-22T10:00:00Z');
    expect(parsed.ok && parsed.state).toEqual(a);
    const b = emptyState();
    b.rawRows['b'] = row('b');
    b.ui.theme = 'light';
    const merged = mergeStates(a, b);
    expect(Object.keys(merged.rawRows).sort()).toEqual(['a', 'b']);
    expect(merged.manualEvents['m1']).toBeDefined();
    expect(merged.ui.theme).toBe('auto');
    expect(parseBackup('{"schemaVersion": 99}').ok).toBe(false);
    expect(parseBackup('nope').ok).toBe(false);
  });

  it('migration : complète les clés manquantes, refuse une version inconnue', () => {
    const partial = {
      schemaVersion: 1,
      imports: [],
      rawRows: {},
      manualEvents: {},
      qualifications: {},
      engineSettings: { migrationMode: 'realize' },
    };
    const result = migrateState(partial);
    expect(result.ok && result.state.engineSettings).toEqual({
      migrationMode: 'realize',
      rewardValuation: 'zero',
      includeSubscriptionsInPnl: false,
    });
    expect(result.ok && result.state.ui.theme).toBe('auto');
    expect(migrateState({ schemaVersion: 2 }).ok).toBe(false);
  });
});
