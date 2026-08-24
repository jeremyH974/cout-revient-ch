import { describe, expect, it } from 'vitest';
import { mergeStates } from '../../storage/json-io';
import { emptyState, sanitizeState, withDefaults } from '../../storage/schema';
import { emptyHlAccountData, emptyHlState, type HlAccountData } from './data';
import { sanitizeHlAccount, sanitizeHlState } from './sanitize';

const ADDRESS = '0x000000000000000000000000000000000000d3a0';
const ID = `hl:${ADDRESS}`;

function account(): HlAccountData {
  const data = emptyHlAccountData(ADDRESS);
  data.fills['7'] = {
    coin: 'BTC',
    px: '60000',
    sz: '0.1',
    side: 'B',
    time: 1_750_000_000_000,
    startPosition: '0',
    dir: 'Open Long',
    closedPnl: '0',
    hash: '0xh',
    oid: '1',
    crossed: true,
    fee: '2.7',
    tid: '7',
    feeToken: 'USDC',
    builderFee: null,
    liquidation: null,
    twapId: null,
  };
  data.funding['f'] = {
    time: 1,
    hash: '0x',
    coin: 'BTC',
    usdc: '-0.5',
    szi: '0.1',
    fundingRate: '0.0001',
  };
  data.ledger['l'] = { time: 2, hash: '0x', type: 'deposit', fields: { usdc: '100' } };
  data.cursors = { fills: 1_750_000_000_000, funding: 1, ledger: 2 };
  data.snapshot = {
    at: '2026-08-20T00:00:00.000Z',
    perps: {
      accountValue: '97.3',
      totalNtlPos: '0',
      totalRawUsd: '97.3',
      totalMarginUsed: '0',
      withdrawable: '97.3',
      positions: [],
      time: 3,
    },
    spot: [{ coin: 'USDC', token: 0, total: '0', hold: '0', entryNtl: '0' }],
  };
  data.lastSyncAt = '2026-08-20T00:00:01.000Z';
  return data;
}

describe('sanitizeHlAccount', () => {
  it('conserve un compte valide à l’identique', () => {
    const data = account();
    expect(sanitizeHlAccount(JSON.parse(JSON.stringify(data)))).toEqual({ data, dropped: 0 });
  });

  it('écarte les bruts invalides et les adresses malformées', () => {
    const data = JSON.parse(JSON.stringify(account())) as Record<string, unknown>;
    (data['fills'] as Record<string, unknown>)['bad'] = { coin: 'BTC', px: 'abc' };
    (data['funding'] as Record<string, unknown>)['bad'] = { time: 'x' };
    const result = sanitizeHlAccount(data);
    expect(result?.dropped).toBe(2);
    expect(Object.keys(result?.data.fills ?? {})).toEqual(['7']);
    expect(sanitizeHlAccount({ ...data, address: '0x12' })).toBeNull();
  });

  it('sanitizeHlState : identifiant de compte cohérent avec l’adresse, paires filtrées', () => {
    const result = sanitizeHlState({
      accounts: { [ID]: account(), 'hl:0xautre': account() },
      spotPairs: { 'PURR/USDC': { base: 'PURR', quote: 'USDC' }, bad: { base: 1 } },
    });
    expect(Object.keys(result.state.accounts)).toEqual([ID]);
    expect(result.dropped).toBe(1);
    expect(result.state.spotPairs).toEqual({ 'PURR/USDC': { base: 'PURR', quote: 'USDC' } });
  });
});

describe('état persisté', () => {
  it('withDefaults ajoute le conteneur hyperliquid aux sauvegardes antérieures', () => {
    const legacy = emptyState() as Partial<ReturnType<typeof emptyState>>;
    delete legacy.hyperliquid;
    expect(withDefaults(legacy as ReturnType<typeof emptyState>).hyperliquid).toEqual(
      emptyHlState(),
    );
  });

  it('sanitizeState passe par sanitizeHlState', () => {
    const state = emptyState();
    state.hyperliquid.accounts[ID] = account();
    state.hyperliquid.accounts['hl:0xbad'] = { address: 'nope' } as unknown as HlAccountData;
    const result = sanitizeState(state);
    expect(Object.keys(result.state.hyperliquid.accounts)).toEqual([ID]);
    expect(result.dropped).toBe(1);
  });

  it('mergeStates : union des bruts par clé, curseurs au plus récent, instantané le plus neuf', () => {
    const current = emptyState();
    const mine = account();
    current.hyperliquid.accounts[ID] = mine;
    const incoming = emptyState();
    const theirs = account();
    theirs.fills['8'] = { ...theirs.fills['7']!, tid: '8', time: 1_750_000_001_000 };
    theirs.cursors.fills = 1_750_000_001_000;
    theirs.snapshot = { ...theirs.snapshot!, at: '2026-08-21T00:00:00.000Z' };
    theirs.lastSyncAt = '2026-08-21T00:00:01.000Z';
    incoming.hyperliquid.accounts[ID] = theirs;
    incoming.hyperliquid.spotPairs['@107'] = { base: 'HYPE', quote: 'USDC' };
    const merged = mergeStates(current, incoming).hyperliquid;
    expect(Object.keys(merged.accounts[ID]!.fills).sort()).toEqual(['7', '8']);
    expect(merged.accounts[ID]!.cursors.fills).toBe(1_750_000_001_000);
    expect(merged.accounts[ID]!.snapshot?.at).toBe('2026-08-21T00:00:00.000Z');
    expect(merged.accounts[ID]!.lastSyncAt).toBe('2026-08-21T00:00:01.000Z');
    expect(merged.spotPairs['@107']).toEqual({ base: 'HYPE', quote: 'USDC' });
  });
});
