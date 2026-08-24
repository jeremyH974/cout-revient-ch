import { describe, expect, it } from 'vitest';
import { emptyJournalEntry, type JournalEntry, type ManualTrade } from '../domain/trading/journal';
import { mergeStates } from './json-io';
import { emptyState, sanitizeState, withDefaults, type StoredStateV1 } from './schema';

const manualTrade = (id: string, over: Partial<ManualTrade> = {}): ManualTrade => ({
  id,
  accountId: 'man:trading',
  symbol: 'BTC',
  direction: 'long',
  qty: '1',
  entryPrice: '100',
  exitPrice: null,
  openedAt: '2026-08-01T10:00:00',
  closedAt: null,
  fees: '0',
  quote: 'USD',
  ...over,
});

describe('sanitizeState — journal de trading', () => {
  it('conserve une entrée valide, ramène un rating hors bornes à null (entrée conservée), écarte une entrée non-objet', () => {
    const valid: JournalEntry = {
      ...emptyJournalEntry('t1'),
      thesis: 'Cassure de range confirmée sur 4h',
      review: 'Bon timing, sortie un peu tôt',
      setup: 'Cassure',
      tags: ['breakout'],
      rating: 4,
      plan: { entry: '100', stop: '95', target: '120', risk: null },
    };
    const state = emptyState();
    state.journal = {
      t1: valid,
      t2: { ...valid, tradeId: 't2', rating: 7 } as unknown as JournalEntry,
      t3: 'pas un objet' as unknown as JournalEntry,
    };

    const { state: clean, dropped } = sanitizeState(state);

    expect(dropped).toBe(1);
    expect(clean.journal['t1']).toEqual(valid);
    expect(clean.journal['t2']).toEqual({ ...valid, tradeId: 't2', rating: null });
    expect(clean.journal['t3']).toBeUndefined();
  });
});

describe('sanitizeState — trades manuels', () => {
  it('conserve un trade valide, écarte celui sans symbole, ramène une devise inconnue à USD, invalide un closedAt cassé', () => {
    const valid = manualTrade('m1', {
      exitPrice: '110',
      closedAt: '2026-08-01T12:00:00',
      fees: '1',
    });
    const missingSymbol = {
      accountId: 'man:trading',
      direction: 'long',
      qty: '1',
      entryPrice: '100',
      exitPrice: null,
      openedAt: '2026-08-01T10:00:00',
      closedAt: null,
      fees: '0',
      quote: 'USD',
    } as unknown as ManualTrade;
    const gbpQuote = { ...valid, quote: 'GBP' } as unknown as ManualTrade;
    const badClosedAt = { ...valid, closedAt: 'pas-une-date' } as unknown as ManualTrade;
    const state = emptyState();
    state.manualTrades = { m1: valid, m2: missingSymbol, m3: gbpQuote, m4: badClosedAt };

    const { state: clean, dropped } = sanitizeState(state);

    expect(dropped).toBe(1);
    expect(clean.manualTrades['m1']).toEqual(valid);
    expect(clean.manualTrades['m2']).toBeUndefined();
    expect(clean.manualTrades['m3']?.quote).toBe('USD');
    expect(clean.manualTrades['m4']?.closedAt).toBeNull();
  });
});

describe('mergeStates — journal et trades manuels', () => {
  it('fusionne par union des id ; l’état courant gagne sur l’entrant à id égal', () => {
    const current = emptyState();
    current.journal = {
      shared: { ...emptyJournalEntry('shared'), thesis: 'version courante' },
      onlyCurrent: { ...emptyJournalEntry('onlyCurrent'), thesis: 'seulement côté courant' },
    };
    current.manualTrades = {
      shared: manualTrade('shared', { fees: '1' }),
      onlyCurrent: manualTrade('onlyCurrent'),
    };
    const incoming = emptyState();
    incoming.journal = {
      shared: { ...emptyJournalEntry('shared'), thesis: 'version entrante' },
      onlyIncoming: { ...emptyJournalEntry('onlyIncoming'), thesis: 'seulement côté entrant' },
    };
    incoming.manualTrades = {
      shared: manualTrade('shared', { fees: '99' }),
      onlyIncoming: manualTrade('onlyIncoming'),
    };

    const merged = mergeStates(current, incoming);

    expect(Object.keys(merged.journal).sort()).toEqual(['onlyCurrent', 'onlyIncoming', 'shared']);
    expect(merged.journal['shared']?.thesis).toBe('version courante');
    expect(Object.keys(merged.manualTrades).sort()).toEqual([
      'onlyCurrent',
      'onlyIncoming',
      'shared',
    ]);
    expect(merged.manualTrades['shared']?.fees).toBe('1');
  });
});

describe('withDefaults — compatibilité ascendante', () => {
  it('complète journal et manualTrades absents (sauvegarde antérieure à leur ajout) sans erreur', () => {
    const legacy: Partial<StoredStateV1> = { ...emptyState() };
    delete legacy.journal;
    delete legacy.manualTrades;

    let result: StoredStateV1 | undefined;
    expect(() => {
      result = withDefaults(legacy as StoredStateV1);
    }).not.toThrow();
    expect(result?.journal).toEqual({});
    expect(result?.manualTrades).toEqual({});
  });
});
