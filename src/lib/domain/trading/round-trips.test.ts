import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, ZERO, sum } from '../money';
import { buildRoundTrips } from './round-trips';
import type { Execution, FundingPayment } from './types';

let tick = 0;
const T0 = Date.UTC(2026, 4, 1, 8);
const exec = (over: Partial<Execution>): Execution => ({
  id: `x${++tick}`,
  accountId: 'hl:a',
  at: '2026-05-01T10:00:00',
  time: T0 + tick * 60_000,
  market: 'perp',
  symbol: 'BTC',
  quote: 'USDC',
  side: 'buy',
  qty: '1',
  price: '100',
  notional: '100',
  fee: '0.1',
  feeNative: null,
  closedPnl: '0',
  startPosition: '0',
  direction: 'Open Long',
  liquidation: false,
  crossed: true,
  source: 'hyperliquid-api',
  ...over,
});

describe('buildRoundTrips', () => {
  it('long en deux tranches puis clôture : moyennes, frais, P&L net', () => {
    const trips = buildRoundTrips([
      exec({ id: 'a', qty: '1', price: '100', startPosition: '0' }),
      exec({ id: 'b', qty: '1', price: '110', startPosition: '1' }),
      exec({
        id: 'c',
        side: 'sell',
        qty: '2',
        price: '120',
        startPosition: '2',
        closedPnl: '30',
        fee: '0.2',
        direction: 'Close Long',
      }),
    ]);
    expect(trips).toHaveLength(1);
    const t = trips[0]!;
    expect(t.status).toBe('closed');
    expect(t.direction).toBe('long');
    expect(t.qtyOpened.toString()).toBe('2');
    expect(t.qtyClosed.toString()).toBe('2');
    expect(t.avgEntry?.toString()).toBe('105');
    expect(t.avgExit?.toString()).toBe('120');
    expect(t.grossPnl.toString()).toBe('30');
    expect(t.fees.toString()).toBe('0.4');
    expect(t.netPnl.toString()).toBe('29.6');
    expect(t.executionIds).toEqual(['a', 'b', 'c']);
    expect(t.incomplete).toBe(false);
    expect(t.holdSeconds).toBe(120);
  });

  it('retournement : clôture + réouverture dans la même exécution, frais au prorata', () => {
    const trips = buildRoundTrips([
      exec({ id: 'a', qty: '1', price: '100' }),
      exec({
        id: 'b',
        side: 'sell',
        qty: '3',
        price: '110',
        startPosition: '1',
        closedPnl: '10',
        fee: '0.3',
        direction: 'Long > Short',
      }),
      exec({
        id: 'c',
        qty: '2',
        price: '105',
        startPosition: '-2',
        closedPnl: '10',
        fee: '0.2',
        direction: 'Close Short',
      }),
    ]);
    expect(trips).toHaveLength(2);
    const short = trips.find((t) => t.direction === 'short')!;
    const long = trips.find((t) => t.direction === 'long')!;
    expect(long.status).toBe('closed');
    expect(long.grossPnl.toString()).toBe('10');
    expect(long.fees.toString()).toBe('0.2'); // 0.1 (ouverture) + 0.3 × 1/3 (part clôturante)
    expect(short.qtyOpened.toString()).toBe('2');
    expect(short.avgEntry?.toString()).toBe('110');
    expect(short.fees.toString()).toBe('0.4'); // 0.3 × 2/3 + 0.2
    expect(short.grossPnl.toString()).toBe('10');
    expect(short.status).toBe('closed');
    expect(short.id).not.toBe(long.id);
  });

  it('historique tronqué : startPosition ≠ 0 ouvre un aller-retour incomplet, sans moyenne d’entrée', () => {
    const trips = buildRoundTrips([
      exec({
        id: 'a',
        side: 'sell',
        qty: '3',
        price: '100',
        startPosition: '5',
        closedPnl: '12',
        direction: 'Close Long',
      }),
      exec({
        id: 'b',
        side: 'sell',
        qty: '2',
        price: '101',
        startPosition: '2',
        closedPnl: '9',
        direction: 'Close Long',
      }),
    ]);
    expect(trips).toHaveLength(1);
    const t = trips[0]!;
    expect(t.incomplete).toBe(true);
    expect(t.avgEntry).toBeNull();
    expect(t.avgExit?.toString()).toBe('100.4');
    expect(t.status).toBe('closed');
    expect(t.grossPnl.toString()).toBe('21');
  });

  it('liquidation marquée ; funding rattaché à la fenêtre de l’aller-retour', () => {
    const funding: FundingPayment[] = [
      {
        id: 'f1',
        accountId: 'hl:a',
        at: '2026-05-01T11:00:00',
        time: T0 + 90_000,
        symbol: 'BTC',
        amount: '-0.5',
        rate: '0.0001',
        positionSize: '1',
      },
      {
        id: 'f2',
        accountId: 'hl:a',
        at: '2026-06-01T00:00:00',
        time: T0 + 10 * 86_400_000,
        symbol: 'BTC',
        amount: '-9',
        rate: '0.0001',
        positionSize: '1',
      },
    ];
    tick = 0;
    const trips = buildRoundTrips(
      [
        exec({ id: 'a', qty: '1', price: '100' }),
        exec({
          id: 'b',
          side: 'sell',
          qty: '1',
          price: '80',
          startPosition: '1',
          closedPnl: '-20',
          liquidation: true,
          direction: 'Close Long',
        }),
      ],
      funding,
    );
    expect(trips).toHaveLength(1);
    expect(trips[0]!.liquidated).toBe(true);
    expect(trips[0]!.funding.toString()).toBe('-0.5');
    expect(trips[0]!.netPnl.toString()).toBe('-20.7');
  });

  it('propriété : quantités ouvertes = clôturées sur les clos complets ; Σ grossPnl = Σ closedPnl', () => {
    tick = 0;
    const arb = fc.array(
      fc.record({
        side: fc.constantFrom('buy', 'sell'),
        qty: fc.integer({ min: 1, max: 5 }),
        price: fc.integer({ min: 50, max: 150 }),
      }),
      { minLength: 1, maxLength: 40 },
    );
    fc.assert(
      fc.property(arb, (raw) => {
        // Chaîne cohérente : startPosition suit la position simulée, closedPnl sur les réductions.
        let position = ZERO;
        let n = 0;
        const executions = raw.map((r) => {
          const qty = D(String(r.qty));
          const signed = r.side === 'buy' ? qty : qty.neg();
          const closes = !position.eq(ZERO) && position.s !== signed.s;
          const x = exec({
            id: `p${++n}`,
            time: T0 + n * 1000,
            side: r.side as 'buy' | 'sell',
            qty: qty.toString(),
            price: String(r.price),
            startPosition: position.toString(),
            closedPnl: closes ? '1' : '0',
          });
          position = position.plus(signed);
          return x;
        });
        const trips = buildRoundTrips(executions);
        // Identifiants uniques, même quand plusieurs aller-retours naissent au même instant.
        expect(new Set(trips.map((t) => t.id)).size).toBe(trips.length);
        for (const t of trips) {
          if (t.status === 'closed' && !t.incomplete) {
            expect(t.qtyOpened.eq(t.qtyClosed)).toBe(true);
          }
          // La taille maximale ne dépasse jamais le cumul des ouvertures (scaling in/out compris).
          expect(t.qtyMax.lte(t.qtyOpened) || t.incomplete).toBe(true);
        }
        const gross = sum(trips.map((t) => t.grossPnl));
        const expected = sum(executions.map((x) => D(x.closedPnl)));
        expect(gross.eq(expected)).toBe(true);
        const fees = sum(trips.map((t) => t.fees));
        const feesExpected = sum(executions.map((x) => D(x.fee)));
        expect(fees.round(10).eq(feesExpected.round(10))).toBe(true);
      }),
    );
  });
});
