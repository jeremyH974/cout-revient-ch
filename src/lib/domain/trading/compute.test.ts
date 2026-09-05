import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D } from '../money';
import { computeTotals, computeTrading, computeTradingAccount, totalsSince } from './compute';
import type { CashFlow, Execution, FundingPayment, TradingSnapshot } from './types';

const exec = (over: Partial<Execution>): Execution => ({
  id: 'hl:1',
  accountId: 'hl:0xabc',
  at: '2026-05-01T10:00:00',
  time: Date.UTC(2026, 4, 1, 8),
  market: 'perp',
  symbol: 'BTC',
  quote: 'USDC',
  side: 'buy',
  qty: '0.1',
  price: '60000',
  notional: '6000',
  fee: '2.7',
  feeNative: null,
  closedPnl: '0',
  startPosition: '0',
  direction: 'Open Long',
  liquidation: false,
  crossed: true,
  source: 'hyperliquid-api',
  ...over,
});
const flow = (over: Partial<CashFlow>): CashFlow => ({
  id: 'hl:l:1',
  accountId: 'hl:0xabc',
  at: '2026-04-01T10:00:00',
  time: Date.UTC(2026, 3, 1, 8),
  kind: 'deposit',
  amount: '5000',
  asset: 'USDC',
  fee: '0',
  label: 'Dépôt',
  ...over,
});
const funding = (over: Partial<FundingPayment>): FundingPayment => ({
  id: 'hl:f:1',
  accountId: 'hl:0xabc',
  at: '2026-05-01T18:00:00',
  time: Date.UTC(2026, 4, 1, 16),
  symbol: 'BTC',
  amount: '-0.5',
  rate: '0.0001',
  positionSize: '0.1',
  ...over,
});

describe('computeTotals', () => {
  it('net = réalisé brut − frais perps + funding ; le spot ne touche ni réalisé ni frais perps', () => {
    const t = computeTotals(
      [
        exec({ id: 'a' }),
        exec({
          id: 'b',
          side: 'sell',
          closedPnl: '150',
          fee: '3',
          direction: 'Close Long',
          time: Date.UTC(2026, 4, 2),
        }),
        exec({
          id: 'c',
          market: 'spot',
          symbol: 'PURR',
          fee: '0',
          feeNative: { asset: 'PURR', qty: '1.4' },
          closedPnl: '0',
        }),
        exec({ id: 'd', market: 'spot', symbol: 'HYPE', side: 'sell', fee: '0.5' }),
      ],
      [funding({}), funding({ id: 'f2', amount: '0.2' })],
      [flow({}), flow({ id: 'w', kind: 'withdrawal', amount: '-1500' })],
    );
    expect(t.realized.toString()).toBe('150');
    expect(t.perpFees.toString()).toBe('5.7');
    expect(t.fees.toString()).toBe('6.2');
    expect(t.funding.toString()).toBe('-0.3');
    expect(t.net.toString()).toBe('144');
    expect(t.deposits.toString()).toBe('5000');
    expect(t.withdrawals.toString()).toBe('1500');
    expect(t.netFlows.toString()).toBe('3500');
    expect(t.fills).toBe(4);
    expect(t.closingFills).toBe(1);
    expect(t.feesNative['PURR']?.toString()).toBe('1.4');
  });

  it('filtre par période (time ≥ since)', () => {
    const early = exec({ id: 'a', closedPnl: '10', time: Date.UTC(2026, 0, 1) });
    const late = exec({ id: 'b', closedPnl: '20', time: Date.UTC(2026, 6, 1) });
    expect(computeTotals([early, late], [], [], Date.UTC(2026, 5, 1)).realized.toString()).toBe(
      '20',
    );
  });
});

describe('computeTradingAccount', () => {
  const snapshot: TradingSnapshot = {
    at: '2026-08-20T00:00:00.000Z',
    accountValue: '3660.3',
    withdrawable: '3000',
    marginUsed: '600',
    positions: [
      {
        symbol: 'SOL',
        side: 'long',
        size: '10',
        entryPrice: '100',
        value: '1100',
        unrealizedPnl: '100',
        leverage: 5,
        leverageType: 'cross',
        liquidationPrice: null,
        marginUsed: '220',
        fundingSinceOpen: null,
      },
    ],
    spot: [],
  };

  it('réconcilie équité = flux + réalisé − frais + funding + latent', () => {
    const report = computeTradingAccount({
      accountId: 'hl:0xabc',
      executions: [
        exec({ id: 'a', fee: '2' }),
        exec({ id: 'b', side: 'sell', closedPnl: '70', fee: '2.2', time: Date.UTC(2026, 4, 3) }),
      ],
      funding: [funding({})],
      cashFlows: [flow({ amount: '3500' })],
      snapshot,
    });
    // 3500 + 70 − 4.2 − 0.5 + 100 = 3665.3 ; lu 3660.3 → écart −5.
    expect(report.unrealized.toString()).toBe('100');
    expect(report.equity?.toString()).toBe('3660.3');
    expect(report.reconciliation?.expected.toString()).toBe('3665.3');
    expect(report.reconciliation?.gap.toString()).toBe('-5');
    expect(report.executions.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('sans instantané : ni équité ni réconciliation', () => {
    const report = computeTradingAccount({
      accountId: 'hl:0xabc',
      executions: [],
      funding: [],
      cashFlows: [],
      snapshot: null,
    });
    expect(report.equity).toBeNull();
    expect(report.reconciliation).toBeNull();
  });

  it('consolide : équités sommées, totaux additifs, et un compte muet rend le total inconnu', () => {
    const a = {
      accountId: 'hl:a',
      executions: [exec({ id: 'a', closedPnl: '10' })],
      funding: [],
      cashFlows: [],
      snapshot: { ...snapshot, accountValue: '100' },
    };
    const b = {
      accountId: 'hl:b',
      executions: [exec({ id: 'b', closedPnl: '5', time: Date.UTC(2026, 0, 1) })],
      funding: [],
      cashFlows: [],
      snapshot: null,
    };
    const report = computeTrading([a, b]);
    // Un compte sans instantané ne compte pas pour zéro : le total devient INCONNU, et se nomme.
    expect(report.equity).toBeNull();
    expect(report.unvalued).toEqual(['hl:b']);
    expect(report.totals.realized.toString()).toBe('15');
    expect(totalsSince(report, Date.UTC(2026, 3, 1)).realized.toString()).toBe('10');

    // Les deux instantanés présents, les équités s'additionnent comme des soldes.
    const valued = computeTrading([a, { ...b, snapshot: { ...snapshot, accountValue: '20' } }]);
    expect(valued.equity?.toString()).toBe('120');
    expect(valued.unvalued).toEqual([]);
  });

  it('propriété : net = réalisé − frais perps + funding, quelles que soient les exécutions', () => {
    const dec = fc
      .tuple(fc.integer({ min: -100_000, max: 100_000 }), fc.integer({ min: 0, max: 4 }))
      .map(([n, dp]) =>
        D(String(n))
          .div(String(10 ** dp))
          .toString(),
      );
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            market: fc.constantFrom('perp', 'spot'),
            fee: dec,
            closedPnl: dec,
          }),
          { maxLength: 30 },
        ),
        fc.array(dec, { maxLength: 10 }),
        (fills, fundings) => {
          const executions = fills.map((f, i) =>
            exec({
              id: `x${i}`,
              market: f.market as 'perp' | 'spot',
              fee: f.fee,
              closedPnl: f.market === 'perp' ? f.closedPnl : '0',
            }),
          );
          const payments = fundings.map((amount, i) => funding({ id: `f${i}`, amount }));
          const t = computeTotals(executions, payments, []);
          const expected = t.realized.minus(t.perpFees).plus(t.funding);
          return t.net.eq(expected);
        },
      ),
    );
  });
});

describe('compte à plat sur les perps : la valeur est du côté spot (décision n° 100)', () => {
  /**
   * Le cas réel qui a motivé la décision : aucune position ouverte, équité perps **nulle**, et
   * tout l'argent sur le portefeuille spot. C'est l'état le plus banal d'un compte Hyperliquid
   * entre deux trades — la version perps-seul y affichait zéro, donc une perte de 100 % des
   * apports.
   */
  const plat = (spot: string) => ({
    accountId: 'hl:a',
    executions: [exec({ closedPnl: '500', fee: '100', direction: 'Close Long' })],
    funding: [funding({ amount: '-50' })],
    cashFlows: [
      flow({ kind: 'deposit', amount: '10000' }),
      // Un `send` entrant : de l'argent qui arrive d'une autre adresse, longtemps compté zéro.
      flow({ id: 'hl:l:2', kind: 'transfer-in', amount: '1000', label: 'Réception de 1000 USDC' }),
      // Virement interne : il déplace sans rien produire, il ne compte donc plus (montant nul).
      flow({ id: 'hl:l:3', kind: 'perp-to-spot', amount: '0', label: 'Transfert interne' }),
    ],
    snapshot: {
      at: '2026-09-05T00:00:00.000Z',
      accountValue: '0',
      withdrawable: '0',
      marginUsed: '0',
      positions: [],
      spot: [{ asset: 'usdc', qty: spot, hold: '0', entryNotional: '0' }],
    } satisfies TradingSnapshot,
  });

  it('la valeur du compte est le solde spot, et l’identité se ferme au centime', () => {
    const report = computeTradingAccount(plat('11350'));
    expect(report.spotValue.toString()).toBe('11350');
    // 10 000 déposés + 1 000 reçus + 500 réalisés − 100 de frais − 50 de funding = 11 350.
    expect(report.equity?.toString()).toBe('11350');
    expect(report.reconciliation?.gap.toString()).toBe('0');
    expect(report.reconciliation?.spotSales).toBe(0);
  });

  it('un solde spot qui ne colle pas au grand livre laisse un écart, sans vente spot pour l’excuser', () => {
    const report = computeTradingAccount(plat('11000'));
    expect(report.reconciliation?.gap.toString()).toBe('-350');
    expect(report.reconciliation?.spotSales).toBe(0);
  });

  it('un jeton spot sans cotation est écarté et nommé, jamais deviné', () => {
    // 300 USDC de moins, un jeton acheté 300 en face : le compte n'a rien gagné à l'achat.
    const input = plat('11050');
    const report = computeTradingAccount({
      ...input,
      snapshot: {
        ...input.snapshot,
        spot: [
          ...input.snapshot.spot,
          { asset: 'hype', qty: '10', hold: '0', entryNotional: '300' },
        ],
      },
    });
    expect(report.spotValue.toString()).toBe('11050');
    expect(report.spotUnpriced).toEqual(['hype']);
    // Avec une cotation, le jeton entre dans la valeur et son latent dans l'attendu.
    const coté = computeTradingAccount(
      {
        ...input,
        snapshot: {
          ...input.snapshot,
          spot: [
            ...input.snapshot.spot,
            { asset: 'hype', qty: '10', hold: '0', entryNotional: '300' },
          ],
        },
      },
      (asset) => (asset === 'hype' ? D('33') : null),
    );
    expect(coté.spotValue.toString()).toBe('11380');
    expect(coté.spotUnrealized.toString()).toBe('30');
    expect(coté.reconciliation?.gap.toString()).toBe('0');
  });
});
