import { describe, expect, it } from 'vitest';
import type { HlFill, HlLedgerUpdate } from './api-types';
import { emptyHlAccountData, type HlAccountData } from './data';
import { equityAnchors, equityMoves, spotCandleCoin } from './equity-moves';

const ADDRESS = '0x00000000000000000000000000000000000000aa';
const OTHER = '0x00000000000000000000000000000000000000bb';
const T0 = Date.UTC(2026, 8, 1, 12);
const PAIRS = {
  '@107': { base: 'HYPE', quote: 'USDC' },
  'PURR/USDC': { base: 'PURR', quote: 'USDC' },
};

let tid = 0;
const fill = (over: Partial<HlFill>): HlFill => ({
  coin: 'BTC',
  px: '100',
  sz: '1',
  side: 'B',
  time: T0,
  startPosition: '0',
  dir: 'Open Long',
  closedPnl: '0',
  hash: '0x',
  oid: '1',
  crossed: true,
  fee: '0.05',
  tid: String(++tid),
  feeToken: 'USDC',
  builderFee: null,
  liquidation: null,
  twapId: null,
  ...over,
});
const ledger = (time: number, type: string, fields: HlLedgerUpdate['fields']): HlLedgerUpdate => ({
  time,
  hash: `0x${time}`,
  type,
  fields,
});

function account(over: Partial<HlAccountData>): HlAccountData {
  return { ...emptyHlAccountData(ADDRESS), ...over };
}

describe('equityMoves — les bruts, tels que la courbe détaillée les rejoue', () => {
  it('fills perps et spot, funding, dans l’ordre du temps', () => {
    const f1 = fill({ time: T0 + 2 });
    const f2 = fill({ coin: '@107', side: 'A', sz: '3', px: '30', fee: '0.063', time: T0 + 1 });
    const f3 = fill({ coin: 'ETH', fee: '0.2', feeToken: 'HYPE', time: T0 + 3 });
    const f4 = fill({ coin: '@999', time: T0 + 4 });
    const { moves } = equityMoves(
      account({
        fills: { [f1.tid]: f1, [f2.tid]: f2, [f3.tid]: f3, [f4.tid]: f4 },
        funding: {
          a: { time: T0, hash: '0x', coin: 'BTC', usdc: '-1.5', szi: '1', fundingRate: '0.0001' },
        },
      }),
      PAIRS,
    );
    expect(moves).toEqual([
      { kind: 'funding', time: T0, amount: '-1.5' },
      {
        kind: 'spot',
        time: T0 + 1,
        base: 'HYPE',
        quote: 'USDC',
        side: 'sell',
        qty: '3',
        price: '30',
        fee: '0.063',
        feeToken: 'USDC',
      },
      {
        kind: 'perp',
        time: T0 + 2,
        coin: 'BTC',
        side: 'buy',
        qty: '1',
        price: '100',
        startPosition: '0',
        closedPnl: '0',
        fee: '0.05',
      },
      // Frais payés dans un autre jeton : la trésorerie n'est pas entamée.
      expect.objectContaining({ kind: 'perp', coin: 'ETH', fee: '0' }),
    ]);
  });

  it('grand livre : l’interprétation du moteur, et la quantité des jetons transférés', () => {
    const entries = [
      ledger(T0, 'deposit', { usdc: '1000.0' }),
      ledger(T0 + 1, 'withdraw', { usdc: '200.0', fee: '1.0' }),
      ledger(T0 + 2, 'accountClassTransfer', { usdc: '50.0', toPerp: false }),
      ledger(T0 + 3, 'spotTransfer', {
        token: 'HYPE',
        amount: '20.0',
        usdcValue: '600.0',
        user: OTHER,
        destination: ADDRESS,
      }),
      ledger(T0 + 4, 'send', {
        token: 'PURR',
        amount: '100',
        usdcValue: '20',
        user: ADDRESS,
        destination: OTHER,
      }),
      ledger(T0 + 5, 'send', {
        token: 'USDC',
        amount: '5',
        usdcValue: '5',
        user: OTHER,
        destination: ADDRESS,
      }),
      ledger(T0 + 6, 'spotTransfer', {
        token: 'HYPE',
        usdcValue: '30',
        user: OTHER,
        destination: ADDRESS,
      }),
      ledger(T0 + 7, 'cStakingTransfer', { token: 'HYPE', amount: '1' }),
    ];
    const { moves } = equityMoves(
      account({ ledger: Object.fromEntries(entries.map((e, i) => [String(i), e])) }),
      PAIRS,
    );
    expect(moves).toEqual([
      { kind: 'flow', time: T0, token: 'USDC', qty: '1000', value: '1000' },
      { kind: 'flow', time: T0 + 1, token: 'USDC', qty: '-200', value: '-200' },
      { kind: 'flow', time: T0 + 3, token: 'HYPE', qty: '20.0', value: '600' },
      { kind: 'flow', time: T0 + 4, token: 'PURR', qty: '-100', value: '-20' },
      { kind: 'flow', time: T0 + 5, token: 'USDC', qty: '5', value: '5' },
    ]);
  });

  it('soldes spot de l’instantané, hors trésorerie, à l’instant de la plateforme', () => {
    const perps = {
      accountValue: '0',
      totalNtlPos: '0',
      totalRawUsd: '0',
      totalMarginUsed: '0',
      withdrawable: '0',
      positions: [],
      time: T0 + 99,
    };
    const spot = [
      { coin: 'USDC', token: 0, total: '12', hold: '0', entryNtl: '0' },
      { coin: 'HYPE', token: 150, total: '7.5', hold: '0', entryNtl: '200' },
    ];
    const read = equityMoves(
      account({ snapshot: { at: new Date(T0).toISOString(), perps, spot } }),
      PAIRS,
    );
    expect(read.spot).toEqual({ time: T0 + 99, balances: { HYPE: '7.5' } });
    const untimed = equityMoves(
      account({ snapshot: { at: new Date(T0).toISOString(), perps: { ...perps, time: 0 }, spot } }),
      PAIRS,
    );
    expect(untimed.spot?.time).toBe(T0);
    expect(equityMoves(account({}), PAIRS).spot).toBeNull();
  });
});

describe('spotCandleCoin et equityAnchors', () => {
  it('un jeton se cote par sa paire contre USDC, ou pas du tout', () => {
    expect(spotCandleCoin('HYPE', PAIRS)).toBe('@107');
    expect(spotCandleCoin('PURR', PAIRS)).toBe('PURR/USDC');
    expect(spotCandleCoin('USDT0', { '@166': { base: 'USDT0', quote: 'USDH' } })).toBeNull();
  });

  it('les points d’équité de toutes les fenêtres, dédoublonnés et triés, sans les séries perps', () => {
    const series = (points: [number, string][]) => ({
      accountValueHistory: points,
      pnlHistory: [],
    });
    const anchors = equityAnchors(
      account({
        portfolio: {
          day: series([
            [T0 + 2, '12'],
            [T0 + 3, '13'],
          ]),
          week: series([
            [T0, '10'],
            [T0 + 3, '13'],
          ]),
          allTime: series([[T0 - 5, '1']]),
          perpDay: series([[T0 + 1, '999']]),
        },
      }),
    );
    expect(anchors).toEqual([
      [T0 - 5, '1'],
      [T0, '10'],
      [T0 + 2, '12'],
      [T0 + 3, '13'],
    ]);
    expect(equityAnchors(account({}))).toEqual([]);
  });
});
