import { describe, expect, it } from 'vitest';
import type { Account, AccountId } from '../domain/types';
import { mergeStates, parseBackup, serializeBackup } from './json-io';
import { STORAGE_KEY, clearState, loadState, saveState } from './local-storage';
import { migrateState } from './migrations';
import { emptyState, sanitizeState, type StoredStateV1 } from './schema';

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

describe('assainissement', () => {
  it('écarte les entrées invalides sans planter', () => {
    const raw = {
      schemaVersion: 1,
      imports: [],
      rawRows: { ok: row('ok'), bad: null, bad2: { ...row('bad2'), qty: '1,5' } },
      manualEvents: {
        m1: {
          id: 'm1',
          at: '2026-01-01T10:00:00',
          kind: 'buy',
          asset: 'eth',
          qty: '1',
          amountEur: 5,
          scope: 'coinhouse',
          note: '',
        },
      },
      qualifications: { q1: { kind: 'purchase', costEur: 'abc' } },
      engineSettings: {},
      priceCache: { btc: { priceEur: 'abc', at: 'x' } },
    };
    const result = migrateState(raw);
    expect(result.ok && Object.keys(result.state.rawRows)).toEqual(['ok']);
    expect(result.ok && result.dropped).toBe(5);
  });
});

describe('clé CoinGecko Demo', () => {
  it('conserve un jeton valide et écarte le reste', () => {
    const base = emptyState();
    const ok = sanitizeState({
      ...base,
      ui: { ...base.ui, coingeckoDemoKey: ' CG-abc123XYZ_-456 ' },
    });
    expect(ok.state.ui.coingeckoDemoKey).toBe('CG-abc123XYZ_-456');
    for (const bad of ['short', 'has space here', 'x'.repeat(65), 42, null, undefined]) {
      const res = sanitizeState({
        ...base,
        ui: { ...base.ui, coingeckoDemoKey: bad as unknown as string | null },
      });
      expect(res.state.ui.coingeckoDemoKey).toBeNull();
    }
  });
});

describe('comptes', () => {
  it('sanitizeState : id/genre/espace/libellé valides conservés, invalides écartés, libellé tronqué à 60', () => {
    const accounts = {
      'man:ok': {
        kind: 'manual',
        label: '  Ledger  ',
        space: 'invest',
        createdAt: '2026-08-23T10:00:00Z',
      },
      'man:badid!': {
        kind: 'manual',
        label: 'Identifiant invalide (caractère « ! »)',
        space: 'invest',
        createdAt: '',
      },
      'man:badkind': { kind: 'bogus', label: 'Genre invalide', space: 'invest', createdAt: '' },
      'man:badspace': {
        kind: 'manual',
        label: 'Espace invalide',
        space: 'savings',
        createdAt: '',
      },
      'man:emptylabel': { kind: 'manual', label: '   ', space: 'invest', createdAt: '' },
      'man:longlabel': { kind: 'manual', label: 'x'.repeat(65), space: 'trading', createdAt: '' },
    };
    const state: StoredStateV1 = {
      ...emptyState(),
      accounts: accounts as unknown as Record<AccountId, Account>,
    };
    const result = sanitizeState(state);
    expect(Object.keys(result.state.accounts).sort()).toEqual(['man:longlabel', 'man:ok']);
    expect(result.state.accounts['man:ok']!.label).toBe('Ledger');
    expect(result.state.accounts['man:longlabel']!.label).toHaveLength(60);
    expect(result.dropped).toBe(4);
  });

  it("sanitizeState : ManualEvent.accountId conservé seulement s'il respecte le format id de compte", () => {
    const manual = (accountId?: unknown) => ({
      kind: 'buy',
      at: '2026-01-01T10:00:00',
      asset: 'btc',
      qty: '1',
      amountEur: '100',
      scope: 'coinhouse',
      note: '',
      ...(accountId === undefined ? {} : { accountId }),
    });
    const state: StoredStateV1 = {
      ...emptyState(),
      manualEvents: {
        ok: manual('man:x1'),
        badFormat: manual('not a valid id'),
        notString: manual(42),
        absent: manual(),
      } as unknown as StoredStateV1['manualEvents'],
    };
    const result = sanitizeState(state);
    expect(Object.keys(result.state.manualEvents).sort()).toEqual([
      'absent',
      'badFormat',
      'notString',
      'ok',
    ]);
    expect(result.state.manualEvents['ok']!.accountId).toBe('man:x1');
    expect(result.state.manualEvents['badFormat']!.accountId).toBeUndefined();
    expect(result.state.manualEvents['notString']!.accountId).toBeUndefined();
    expect(result.state.manualEvents['absent']!.accountId).toBeUndefined();
    expect(result.dropped).toBe(0);
  });

  it("mergeStates : union des comptes, le compte courant l'emporte sur un conflit d'id", () => {
    const current = emptyState();
    current.accounts['man:x1'] = {
      id: 'man:x1',
      kind: 'manual',
      label: 'Courant',
      space: 'invest',
      createdAt: '2026-01-01T00:00:00Z',
    };
    current.accounts['man:x2'] = {
      id: 'man:x2',
      kind: 'manual',
      label: 'Seulement courant',
      space: 'invest',
      createdAt: '2026-01-01T00:00:00Z',
    };
    const incoming = emptyState();
    incoming.accounts['man:x1'] = {
      id: 'man:x1',
      kind: 'manual',
      label: 'Entrant',
      space: 'trading',
      createdAt: '2026-01-02T00:00:00Z',
    };
    incoming.accounts['man:x3'] = {
      id: 'man:x3',
      kind: 'manual',
      label: 'Seulement entrant',
      space: 'invest',
      createdAt: '2026-01-02T00:00:00Z',
    };
    const merged = mergeStates(current, incoming);
    expect(Object.keys(merged.accounts).sort()).toEqual(['man:x1', 'man:x2', 'man:x3']);
    expect(merged.accounts['man:x1']!.label).toBe('Courant');
    expect(merged.accounts['man:x2']!.label).toBe('Seulement courant');
    expect(merged.accounts['man:x3']!.label).toBe('Seulement entrant');
  });
});

/**
 * Le piège documenté du schéma : ajouter un conteneur à `StoredStateV1` sans le répercuter dans
 * `withDefaults`, `sanitizeState` et `mergeStates` = perte SILENCIEUSE à la restauration. Rien ne
 * le vérifiait. Ces tests énumèrent les clés de l'état : un conteneur oublié fait rougir la CI, et
 * un nouveau conteneur oblige à décider explicitement de son sort à la fusion.
 */
describe('complétude du schéma (aucun conteneur ne doit être oublié)', () => {
  /** Un état dont CHAQUE conteneur porte une donnée reconnaissable et valide. */
  function populated(): StoredStateV1 {
    const s = emptyState();
    s.imports.push({
      id: 'imp',
      at: '2026-01-01T10:00:00',
      fileName: 'x.csv',
      rows: 1,
      newRows: 1,
    });
    s.rawRows['r1'] = row('r1');
    s.pivotRows['p1'] = {
      key: 'p1',
      importId: 'imp',
      lineNo: 2,
      accountId: 'man:invest',
      date: '2026-01-01 09:00:00',
      at: '2026-01-01T10:00:00',
      sent: { amount: '1000', currency: 'eur' },
      received: { amount: '0.02', currency: 'btc' },
      fee: null,
      netWorth: null,
      label: null,
      description: null,
      txHash: null,
    };
    s.manualEvents['m1'] = {
      id: 'm1',
      at: '2026-01-01T10:00:00',
      kind: 'buy',
      asset: 'eth',
      qty: '1',
      amountEur: '2000',
      scope: 'coinhouse',
      note: '',
    };
    s.qualifications['ch:r1:0'] = { kind: 'reward', fairValueEur: null };
    s.transferOverrides['ch:r1:0'] = 'none';
    s.taxAnnotations['ch:r1:0'] = { portfolioValueEur: '1000' };
    s.assetSettings['btc'] = {
      manualPriceEur: '50000',
      manualPriceAt: '2026-01-01',
      coingeckoId: 'bitcoin',
    };
    s.accounts['man:trading'] = {
      id: 'man:trading',
      kind: 'manual',
      space: 'trading',
      label: 'Manuel',
      createdAt: '2026-01-01T10:00:00',
    };
    s.hyperliquid.spotPairs['@107'] = { base: 'HYPE', quote: 'USDC' };
    s.journal['man:t1'] = {
      tradeId: 'man:t1',
      thesis: 'cassure',
      review: '',
      setup: 'Cassure',
      tags: [],
      mistakes: [],
      rating: null,
      plan: null,
    };
    s.manualTrades['t1'] = {
      id: 't1',
      accountId: 'man:trading',
      symbol: 'ETH',
      direction: 'long',
      qty: '1',
      entryPrice: '100',
      exitPrice: '110',
      openedAt: '2026-01-01T10:00:00',
      closedAt: '2026-01-02T10:00:00',
      fees: '1',
      quote: 'EUR',
    };
    s.engineSettings.rewardValuation = 'fair-value';
    // `stale: true` : un cours relu d'une sauvegarde est périmé par définition — l'assainissement
    // le marque, et l'égalité stricte plus bas le prouve.
    s.priceCache['btc'] = {
      asset: 'btc',
      priceEur: '50000',
      at: '2026-01-01',
      source: 'test',
      stale: true,
    };
    s.fx.rates.USD = { '2026-01-01': '1.1' };
    s.alerts.rules['al:1'] = {
      id: 'al:1',
      asset: 'btc',
      direction: 'below',
      threshold: { kind: 'pru-pct', percent: '10' },
      repeat: 'recurring',
      enabled: true,
      note: 'seuil de renfort',
      createdAt: '2026-01-01T10:00:00Z',
    };
    s.alerts.states['al:1'] = {
      armed: false,
      lastTriggeredAtMs: 1_700_000_000_000,
      triggerCount: 1,
    };
    s.alerts.events.push({
      id: 'al:e1',
      ruleId: 'al:1',
      asset: 'btc',
      direction: 'below',
      thresholdEur: '45000',
      priceEur: '44900',
      pruEur: '50000',
      at: '2026-01-02T10:00:00Z',
      read: false,
    });
    s.alerts.settings.watch = true;
    s.ui.theme = 'light';
    return s;
  }

  /** Chaque conteneur doit être non vide dans `populated()`, sinon le test ne prouve rien. */
  const filled = (state: StoredStateV1, key: keyof StoredStateV1): boolean => {
    const value = state[key];
    if (key === 'schemaVersion') return true;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== null && value !== undefined;
  };

  it('sauvegarde → relecture → assainissement : aucun conteneur ne se vide en route', () => {
    const before = populated();
    const keys = Object.keys(before) as (keyof StoredStateV1)[];
    // Garde-fou du test lui-même : si un conteneur ajouté demain n'est pas rempli ici, on le sait.
    expect(keys.filter((k) => !filled(before, k))).toEqual([]);

    const parsed = parseBackup(serializeBackup(before, '2026-08-24T10:00:00Z'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { state: after, dropped } = sanitizeState(parsed.state);
    expect(dropped, 'aucune donnée valide ne doit être écartée').toBe(0);
    expect(
      keys.filter((k) => !filled(after, k)),
      'conteneurs perdus',
    ).toEqual([]);
    expect(after).toEqual(before);
  });

  it('fusion : chaque conteneur a un sort explicite — union des données, réglages locaux gardés', () => {
    // Conteneurs de DONNÉES : l'entrant doit survivre à la fusion (union par identifiant).
    const UNIONED = [
      'imports',
      'rawRows',
      'pivotRows',
      'manualEvents',
      'qualifications',
      'transferOverrides',
      'taxAnnotations',
      'assetSettings',
      'accounts',
      'hyperliquid',
      'journal',
      'manualTrades',
      'alerts',
    ] as const;
    // Conteneurs LOCAUX : l'état courant l'emporte (docstring de `mergeStates`).
    const KEPT = ['schemaVersion', 'engineSettings', 'priceCache', 'fx', 'ui'] as const;

    const keys = Object.keys(emptyState()) as string[];
    const decided = [...UNIONED, ...KEPT] as readonly string[];
    // Un conteneur ajouté sans décision de fusion tombe ici, plutôt que de se perdre en silence.
    expect(
      keys.filter((k) => !decided.includes(k)),
      'conteneurs sans règle de fusion',
    ).toEqual([]);
    expect(
      decided.filter((k) => !keys.includes(k)),
      'règles orphelines',
    ).toEqual([]);

    const merged = mergeStates(emptyState(), populated());
    for (const key of UNIONED) expect(filled(merged, key), `${key} perdu à la fusion`).toBe(true);
    for (const key of KEPT)
      expect(merged[key], `${key} aurait dû rester celui de l'état courant`).toEqual(
        emptyState()[key],
      );
  });
});
