import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Account, AccountId, ManualEvent, StoredColumnMapping } from '../domain/types';
import type { AlertEvent, AlertRule, AlertRuleState } from '../domain/alerts';
import type { JournalEntry, ManualTrade, TradePlan } from '../domain/trading/journal';
import { aiKey } from '../../state/ai-key.svelte';
import { mergeStates, parseBackup, serializeBackup } from './json-io';
import { STORAGE_KEY, clearState, loadState, saveState } from './local-storage';
import { migrateState } from './migrations';
import {
  APP_ID,
  SCHEMA_VERSION,
  emptyState,
  sanitizeState,
  type ImportBatchMeta,
  type StoredStateV1,
} from './schema';

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

/**
 * Fixture GELÉE (docs/backup-format.md) : 100 % synthétique, ne doit plus jamais changer. Elle
 * prouve la garantie du format — une sauvegarde ancienne se relit toujours plus tard — sur un
 * fichier réel plutôt que sur un état construit en mémoire par le test lui-même. L'« attendu » est
 * dérivé du JSON brut (jamais retapé à la main, pour ne pas doubler le risque de coquille) avec la
 * SEULE transformation documentée : un cours mis en cache redevient toujours périmé à la relecture.
 */
describe('fixture gelée v1 (backup-v1.json)', () => {
  const raw = readFileSync('tests/fixtures/storage/backup-v1.json', 'utf8');
  const envelope = JSON.parse(raw) as {
    app: string;
    schemaVersion: number;
    exportedAt: string;
    state: StoredStateV1;
  };

  it('enveloppe : app et schemaVersion attendus', () => {
    expect(envelope.app).toBe(APP_ID);
    expect(envelope.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('se relit aujourd’hui exactement comme prévu, sans rien écarter', () => {
    const migrated = migrateState(envelope.state);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.dropped, 'aucune entrée de la fixture v1 ne doit être écartée').toBe(0);
    const expected: StoredStateV1 = {
      ...envelope.state,
      // Conteneur ajouté APRÈS le gel de la fixture (P68, doublons candidats). C'est le chemin
      // additif que la politique de `docs/backup-format.md` autorise sans montée de schéma : le
      // fichier ancien se relit toujours, il gagne un conteneur vide. La fixture, elle, ne bouge
      // pas — seul l'attendu constate l'ajout, et c'est exactement ce que ce test doit exiger.
      duplicateOverrides: {},
      // Deux champs ajoutés APRÈS le gel (P65, récit narratif) — même chemin additif que le
      // conteneur ci-dessus. La fixture a rougi dès leur déclaration, et c'est très exactement son
      // rôle : elle constate qu'une sauvegarde de 2026 gagne deux préférences à valeur par défaut,
      // sans montée de `SCHEMA_VERSION` et sans qu'aucune donnée de l'utilisateur ne bouge. Le
      // fichier gelé, lui, n'est pas retouché.
      ui: { ...envelope.state.ui, aiEnabled: false, aiModelId: null },
      priceCache: {
        ...envelope.state.priceCache,
        btc: { ...envelope.state.priceCache['btc']!, stale: true },
      },
    };
    expect(migrated.state).toEqual(expected);

    // Même garantie par le chemin réellement emprunté à la restauration (enveloppe complète).
    const parsed = parseBackup(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state).toEqual(expected);
    expect(parsed.exportedAt).toBe(envelope.exportedAt);
  });

  it('point fixe : ré-assainir le résultat ne change plus rien (idempotence)', () => {
    const migrated = migrateState(envelope.state);
    if (!migrated.ok) throw new Error(migrated.error);
    const again = sanitizeState(migrated.state);
    expect(again.dropped).toBe(0);
    expect(again.state).toEqual(migrated.state);
  });
});

describe('appariement de colonnes mémorisé (P64)', () => {
  const account = (columnMapping: unknown) => ({
    id: 'csv:demo',
    kind: 'csv',
    label: 'Démo',
    space: 'invest',
    createdAt: '2026-08-30T09:00:00.000Z',
    columnMapping,
  });
  const stateWith = (columnMapping: unknown) => ({
    ...emptyState(),
    accounts: { 'csv:demo': account(columnMapping) as never },
  });

  it('relit un appariement valide, tel quel', () => {
    const mapping = {
      headerKey: 'abc123',
      columns: { date: 0, sentAmount: 2, sentCurrency: 3 },
      typeLabels: { récompense: 'reward' },
      impliedCurrencies: { netWorthCurrency: 'EUR' },
      confirmedAt: '2026-08-30T09:00:00.000Z',
    };
    const { state, dropped } = sanitizeState(stateWith(mapping));
    expect(dropped).toBe(0);
    expect(state.accounts['csv:demo']?.columnMapping).toEqual(mapping);
  });

  it('OUBLIE un appariement illisible sans emporter le compte avec lui', () => {
    // Un champ cible inventé, un index négatif, une empreinte absente : dans les trois cas le
    // compte survit, l'utilisateur réapparie. Perdre un compte pour une préférence serait le
    // contraire de la garantie du format (docs/backup-format.md).
    for (const broken of [
      { headerKey: 'abc', columns: { dateDeValeur: 0 }, typeLabels: {}, confirmedAt: 'x' },
      { headerKey: 'abc', columns: { date: -1 }, typeLabels: {}, confirmedAt: 'x' },
      { headerKey: '', columns: { date: 0 }, typeLabels: {}, confirmedAt: 'x' },
      { headerKey: 'abc', columns: { date: 0 }, typeLabels: {} },
      'pas un objet',
    ]) {
      const { state, dropped } = sanitizeState(stateWith(broken));
      expect(dropped, JSON.stringify(broken)).toBe(0);
      expect(state.accounts['csv:demo'], JSON.stringify(broken)).toBeDefined();
      expect(state.accounts['csv:demo']?.columnMapping, JSON.stringify(broken)).toBeUndefined();
    }
  });

  it('reste ABSENT d’un compte qui n’en a pas : le champ est additif, pas un conteneur', () => {
    // C'est ce qui explique que la fixture v1 gelée ne rougisse PAS : rien n'est ajouté à un
    // compte ancien, il n'y a donc aucun attendu à mettre à jour (docs/backup-format.md).
    const { state } = sanitizeState(stateWith(undefined));
    expect(state.accounts['csv:demo']).toBeDefined();
    expect('columnMapping' in (state.accounts['csv:demo'] ?? {})).toBe(false);
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

  it('sanitizeState : Account.country (P66) — code ISO valide conservé, invalide écarté, compte jamais perdu', () => {
    const accounts = {
      'csv:nl': { kind: 'csv', label: 'Bitvavo', space: 'invest', createdAt: '', country: 'NL' },
      'csv:bad': { kind: 'csv', label: 'Bogus', space: 'invest', createdAt: '', country: 'nl' },
      'csv:num': { kind: 'csv', label: 'Bogus 2', space: 'invest', createdAt: '', country: 42 },
    };
    const state: StoredStateV1 = {
      ...emptyState(),
      accounts: accounts as unknown as Record<AccountId, Account>,
    };
    const result = sanitizeState(state);
    // Un code ISO invalide n'invalide jamais le COMPTE entier : il retombe seulement à `unknown`.
    expect(Object.keys(result.state.accounts).sort()).toEqual(['csv:bad', 'csv:nl', 'csv:num']);
    expect(result.state.accounts['csv:nl']!.country).toBe('NL');
    expect(result.state.accounts['csv:bad']!.country).toBeUndefined();
    expect(result.state.accounts['csv:num']!.country).toBeUndefined();
  });

  it('sanitizeState : une sauvegarde écrite AVANT P66 (compte sans `country`) se recharge sans perte', () => {
    // Exactement la forme d'une sauvegarde antérieure : le champ `country` n'existe tout simplement
    // pas sur l'objet sérialisé (pas même `undefined`) — c'est la donnée réelle de l'utilisateur,
    // une régression ici est inacceptable.
    const legacyAccount = {
      kind: 'csv',
      label: 'Kraken',
      space: 'invest',
      createdAt: '2026-01-01T10:00:00Z',
    };
    expect('country' in legacyAccount).toBe(false);
    const state: StoredStateV1 = {
      ...emptyState(),
      accounts: { 'csv:legacy': legacyAccount } as unknown as Record<AccountId, Account>,
    };
    const result = sanitizeState(state);
    const restored = result.state.accounts['csv:legacy'];
    expect(restored).toBeDefined();
    expect(restored?.label).toBe('Kraken');
    expect(restored?.country).toBeUndefined();
    expect(result.dropped).toBe(0);
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
/**
 * La même surveillance, un cran plus bas : au niveau du CHAMP (décision n° 84).
 *
 * TypeScript attrape déjà un champ OBLIGATOIRE oublié par un assainisseur — l'objet reconstruit
 * serait incomplet. Le trou était celui des champs FACULTATIFS : `foo?: string` ajouté au type et
 * non recopié compile, passe la CI, et se perd à chaque rechargement.
 *
 * D'où les annotations `Required<T>` ci-dessous, qui ferment le piège des DEUX côtés :
 * — à la compilation, ajouter un facultatif au type rend ce littéral incomplet, et le typecheck
 *   échoue en nommant le champ ;
 * — à l'exécution, un champ présent ici mais absent de l'assainisseur fait échouer l'égalité
 *   stricte plus bas.
 *
 * Un test ne peut donc plus rester en retard sur le type qu'il surveille.
 */
describe('complétude du schéma (aucun conteneur ni champ ne doit être oublié)', () => {
  /** Un état dont CHAQUE conteneur porte une donnée valide, et CHAQUE champ facultatif une valeur. */
  function populated(): StoredStateV1 {
    const s = emptyState();
    const imported: Required<ImportBatchMeta> = {
      id: 'imp',
      at: '2026-01-01T10:00:00',
      fileName: 'x.csv',
      rows: 1,
      newRows: 1,
      format: 'coinhouse',
      accountId: 'man:invest',
      header: ['Date', 'Type'],
      unknownColumns: ['Colonne inconnue'],
    };
    s.imports.push(imported);
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
    const manual: Required<ManualEvent> = {
      id: 'm1',
      at: '2026-01-01T10:00:00',
      kind: 'buy',
      asset: 'eth',
      qty: '1',
      amountEur: '2000',
      scope: 'coinhouse',
      accountId: 'man:invest',
      note: 'saisie manuelle',
    };
    s.manualEvents[manual.id] = manual;
    s.qualifications['ch:r1:0'] = { kind: 'reward', fairValueEur: null };
    s.transferOverrides['ch:r1:0'] = 'none';
    s.duplicateOverrides['e1~e2'] = 'confirmed';
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
    // Un compte deliberement peu plausible — un compte on-chain n'a pas d'appariement de colonnes.
    // Il n'existe que pour porter TOUS les champs facultatifs a la fois : c'est la seule facon
    // d'exiger que l'assainisseur les recopie, et `Required<Account>` interdit d'en oublier un.
    const mapping: Required<StoredColumnMapping> = {
      headerKey: 'fnv1a',
      columns: { date: 0, sentAmount: 1 },
      typeLabels: { Echange: 'trade' },
      impliedCurrencies: { sentCurrency: 'EUR' },
      confirmedAt: '2026-01-01T10:00:00Z',
    };
    const complete: Required<Account> = {
      id: 'oc:complet',
      kind: 'onchain',
      space: 'invest',
      label: 'Tous champs',
      createdAt: '2026-01-01T10:00:00',
      country: 'CH',
      spotAsInvestment: true,
      address: '0xabc',
      chain: 'arbitrum',
      columnMapping: mapping,
    };
    s.accounts[complete.id] = complete;
    s.hyperliquid.spotPairs['@107'] = { base: 'HYPE', quote: 'USDC' };
    const plan: Required<TradePlan> = { entry: '100', stop: '90', target: '130', risk: '10' };
    const journal: Required<JournalEntry> = {
      tradeId: 'man:t1',
      thesis: 'cassure',
      review: 'tenue jusqu’à la cible',
      setup: 'Cassure',
      tags: ['momentum'],
      mistakes: ['stop trop serré'],
      rating: 4,
      plan,
    };
    s.journal[journal.tradeId] = journal;
    const trade: Required<ManualTrade> = {
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
    s.manualTrades[trade.id] = trade;
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
    const rule: Required<AlertRule> = {
      id: 'al:1',
      asset: 'btc',
      direction: 'below',
      threshold: { kind: 'pru-pct', percent: '10' },
      repeat: 'recurring',
      enabled: true,
      note: 'seuil de renfort',
      createdAt: '2026-01-01T10:00:00Z',
      expiresAt: '2026-12-31T23:59:59Z',
      gate: { kind: 'fear-greed', direction: 'below', value: 25 },
    };
    s.alerts.rules[rule.id] = rule;
    const ruleState: Required<AlertRuleState> = {
      armed: false,
      lastTriggeredAtMs: 1_700_000_000_000,
      triggerCount: 1,
    };
    s.alerts.states[rule.id] = ruleState;
    const event: Required<AlertEvent> = {
      id: 'al:e1',
      ruleId: 'al:1',
      asset: 'btc',
      direction: 'below',
      thresholdEur: '45000',
      priceEur: '44900',
      pruEur: '50000',
      at: '2026-01-02T10:00:00Z',
      read: false,
    };
    s.alerts.events.push(event);
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
      'duplicateOverrides',
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

/**
 * La clé Anthropic (P65) n'entre pas dans la sauvegarde — et c'est prouvé sur le **texte** du
 * fichier produit, pas sur la forme du type.
 *
 * Un test de forme (« `UiSettings` ne déclare pas ce champ ») serait tautologique : il relirait la
 * déclaration qu'on vient d'écrire. Celui-ci pose une sentinelle dans le store mémoire, sérialise
 * une sauvegarde issue d'un état RENSEIGNÉ, et cherche la sentinelle dans la chaîne obtenue. Il
 * échouerait aussi bien si quelqu'un ajoutait un jour le champ au schéma que s'il l'injectait à la
 * volée dans l'export.
 *
 * Le même test constate l'autre moitié de la règle, celle qu'une phrase fausse du schéma niait
 * jusqu'ici : les deux clés **gratuites** (CoinGecko, explorateur), elles, figurent bien dans la
 * sauvegarde. C'est un choix — s'épargner de les ressaisir —, pas un oubli.
 */
describe('clé Anthropic : hors de la sauvegarde, par construction', () => {
  const ANTHROPIC_SENTINEL = 'sk-ant-SENTINELLE-DE-TEST-ne-doit-jamais-etre-serialisee';
  const FREE_KEY_SENTINEL = 'CG-SENTINELLE-de-test-cle-gratuite';

  function richState(): StoredStateV1 {
    const s = emptyState();
    s.rawRows['a'] = row('a');
    s.ui.theme = 'light';
    s.ui.coingeckoDemoKey = FREE_KEY_SENTINEL;
    s.ui.explorerKey = 'jeton-explorateur-de-test';
    s.ui.aiEnabled = true;
    return s;
  }

  it('la sentinelle posée en mémoire n’apparaît pas dans le texte de la sauvegarde', () => {
    aiKey.set(ANTHROPIC_SENTINEL);
    expect(aiKey.present, 'la clé doit bien être en mémoire, sinon le test ne prouve rien').toBe(
      true,
    );
    const text = serializeBackup(richState(), '2026-08-30T10:00:00Z');
    expect(text).not.toContain(ANTHROPIC_SENTINEL);
    expect(text).not.toContain('sk-ant');
    aiKey.clear();
    expect(aiKey.present).toBe(false);
  });

  it('les deux clés gratuites, elles, y figurent — la différence est délibérée et documentée', () => {
    const text = serializeBackup(richState(), '2026-08-30T10:00:00Z');
    expect(text).toContain(FREE_KEY_SENTINEL);
    expect(text).toContain('jeton-explorateur-de-test');
  });

  it('le store de la clé n’écrit dans aucun stockage persistant (lu sur son texte)', () => {
    const source = readFileSync('src/state/ai-key.svelte.ts', 'utf8');
    for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'IDBDatabase'])
      expect(source.includes(forbidden), `ai-key.svelte.ts contient ${forbidden}`).toBe(false);
  });

  it('le consentement se mémorise par empreinte de requête, jamais « l’IA est autorisée »', () => {
    const a = { system: 'consigne', user: '{"a":1}' };
    const b = { system: 'consigne', user: '{"a":2}' };
    aiKey.clear();
    expect(aiKey.hasConsent(a, 'm')).toBe(false);
    aiKey.grantConsent(a, 'm');
    expect(aiKey.hasConsent(a, 'm')).toBe(true);
    // Une charge utile différente — un ré-import, un prix rafraîchi — redemande le consentement.
    expect(aiKey.hasConsent(b, 'm')).toBe(false);
    // Un modèle différent aussi : ce n'est pas le même destinataire.
    expect(aiKey.hasConsent(a, 'autre-modele')).toBe(false);
    aiKey.clear();
    expect(aiKey.consentCount).toBe(0);
  });
});
