import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, ONE, ZERO, sum, type Big } from '../money';
import {
  executionLines,
  observedFeeRates,
  roleOf,
  sizeBreakeven,
  tradeCosts,
  type TradeCosts,
} from './costs';
import { manualTradeToRoundTrip } from './journal';
import { buildRoundTrips, type RoundTrip } from './round-trips';
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

const funding = (over: Partial<FundingPayment>): FundingPayment => ({
  id: `f${++tick}`,
  accountId: 'hl:a',
  at: '2026-05-01T12:00:00',
  time: T0,
  symbol: 'BTC',
  amount: '0',
  rate: '0.0001',
  positionSize: '1',
  ...over,
});

const only = (trips: RoundTrip[]): RoundTrip => {
  expect(trips).toHaveLength(1);
  return trips[0]!;
};

const costsOf = (trip: RoundTrip, executions: readonly Execution[]): TradeCosts =>
  tradeCosts(trip, executionLines(trip, executions));

/**
 * Net d'une position ouverte si le reste sortait à `price`, frais de sortie au taux supposé :
 * `réalisé ± (prix − entrée) × reste − frais − taux × prix × reste + funding`.
 */
function netIfExitAt(trip: RoundTrip, price: Big, rate: Big): Big {
  const remaining = trip.qtyOpened.minus(trip.qtyClosed);
  const sign = trip.direction === 'long' ? ONE : ONE.neg();
  return trip.grossPnl
    .plus(sign.times(price.minus(trip.avgEntry!)).times(remaining))
    .minus(trip.fees)
    .minus(rate.times(price).times(remaining))
    .plus(trip.funding);
}

describe('roleOf', () => {
  it('crossed = taker (a traversé le carnet), sinon maker', () => {
    expect(roleOf({ crossed: true })).toBe('taker');
    expect(roleOf({ crossed: false })).toBe('maker');
  });
});

describe('executionLines', () => {
  it('une ligne par exécution, dans l’ordre joué : quantité, notionnel, prix, frais et taux', () => {
    const executions = [
      exec({
        id: 'a',
        side: 'sell',
        qty: '1',
        price: '50000',
        fee: '17.5',
        direction: 'Open Short',
      }),
      exec({
        id: 'b',
        side: 'sell',
        qty: '2',
        price: '50030',
        fee: '35.021',
        startPosition: '-1',
        direction: 'Open Short',
        crossed: false,
      }),
    ];
    const lines = executionLines(only(buildRoundTrips(executions)), executions);
    expect(lines.map((l) => l.id)).toEqual(['a', 'b']);
    expect(lines.map((l) => l.role)).toEqual(['taker', 'maker']);
    const b = lines[1]!;
    expect(b.qty.toString()).toBe('2');
    expect(b.notional.toString()).toBe('100060');
    expect(b.price.toString()).toBe('50030');
    expect(b.fee.toString()).toBe('35.021');
    expect(b.feeRate?.toString()).toBe('0.00035');
    expect(b.fills).toBe(1);
    expect(b.shared).toBe(false);
  });

  it('regroupe les tranches consécutives d’un même instant, sens, libellé et rôle — pas au-delà', () => {
    const T = T0 + 3_600_000;
    const executions = [
      exec({ id: 'a', time: T, qty: '1', price: '100', fee: '0.045' }),
      exec({ id: 'b', time: T, qty: '2', price: '101', fee: '0.0909', startPosition: '1' }),
      // Même instant, mais maker : une autre ligne.
      exec({
        id: 'c',
        time: T,
        qty: '1',
        price: '102',
        fee: '0.0153',
        startPosition: '3',
        crossed: false,
      }),
      // Même rôle que a et b, mais un autre instant : une autre ligne.
      exec({ id: 'd', time: T + 1000, qty: '1', price: '103', fee: '0.04635', startPosition: '4' }),
    ];
    const lines = executionLines(only(buildRoundTrips(executions)), executions);
    expect(lines.map((l) => [l.id, l.fills, l.role])).toEqual([
      ['a', 2, 'taker'],
      ['c', 1, 'maker'],
      ['d', 1, 'taker'],
    ]);
    const first = lines[0]!;
    expect(first.qty.toString()).toBe('3');
    expect(first.notional.toString()).toBe('302');
    expect(first.price.eq(D('302').div('3'))).toBe(true);
    expect(first.fee.toString()).toBe('0.1359');
    expect(first.feeRate?.eq(D('0.1359').div('302'))).toBe(true);
  });

  it('retournement : chaque trade ne prend que SA part du fill, frais au prorata comme le moteur', () => {
    const executions = [
      exec({ id: 'a', qty: '1', price: '100', fee: '0.1' }),
      exec({
        id: 'b',
        side: 'sell',
        qty: '3',
        price: '110',
        fee: '0.3',
        startPosition: '1',
        closedPnl: '10',
        direction: 'Long > Short',
      }),
      exec({
        id: 'c',
        qty: '2',
        price: '105',
        fee: '0.2',
        startPosition: '-2',
        closedPnl: '10',
        direction: 'Close Short',
      }),
    ];
    const trips = buildRoundTrips(executions);
    const long = trips.find((t) => t.direction === 'long')!;
    const short = trips.find((t) => t.direction === 'short')!;

    const longLines = executionLines(long, executions);
    expect(longLines.map((l) => [l.id, l.qty.toString(), l.fee.toString(), l.shared])).toEqual([
      ['a', '1', '0.1', false],
      ['b', '1', '0.1', true],
    ]);
    const shortLines = executionLines(short, executions);
    expect(shortLines.map((l) => [l.id, l.qty.toString(), l.fee.toString(), l.shared])).toEqual([
      ['b', '2', '0.2', true],
      ['c', '2', '0.2', false],
    ]);
    expect(shortLines[0]!.notional.toString()).toBe('220');
    // Le taux d'une part est celui du fill entier.
    expect(shortLines[0]!.feeRate?.eq(D('0.3').div('330'))).toBe(true);
    // Les lignes retombent exactement sur les frais de chaque trade.
    expect(sum(longLines.map((l) => l.fee)).eq(long.fees)).toBe(true);
    expect(sum(shortLines.map((l) => l.fee)).eq(short.fees)).toBe(true);
  });

  it('frais payés dans un autre jeton : quantité au prorata, taux inconnu plutôt que faux', () => {
    const executions = [
      exec({
        id: 'a',
        qty: '1',
        price: '100',
        fee: '0',
        feeNative: { asset: 'HYPE', qty: '0.01' },
      }),
      exec({
        id: 'b',
        side: 'sell',
        qty: '4',
        price: '110',
        fee: '0',
        feeNative: { asset: 'HYPE', qty: '0.04' },
        startPosition: '1',
        closedPnl: '10',
        direction: 'Long > Short',
      }),
    ];
    const long = buildRoundTrips(executions).find((t) => t.direction === 'long')!;
    const lines = executionLines(long, executions);
    expect(lines.map((l) => l.feeNative['HYPE']?.toString())).toEqual(['0.01', '0.01']);
    expect(lines.every((l) => l.feeRate === null)).toBe(true);
  });

  it('ignore un identifiant introuvable, et ne rend rien pour un trade saisi à la main', () => {
    const executions = [
      exec({ id: 'a' }),
      exec({ id: 'b', side: 'sell', startPosition: '1', closedPnl: '0', direction: 'Close Long' }),
    ];
    const trip = only(buildRoundTrips(executions));
    expect(executionLines(trip, executions.slice(1)).map((l) => l.id)).toEqual(['b']);
    const manual = manualTradeToRoundTrip({
      id: 'm',
      accountId: 'manual',
      symbol: 'SOL',
      direction: 'long',
      qty: '1',
      entryPrice: '100',
      exitPrice: '110',
      openedAt: '2026-05-01T10:00:00',
      closedAt: '2026-05-02T10:00:00',
      fees: '1',
      quote: 'USD',
    });
    expect(executionLines(manual, executions)).toEqual([]);
  });
});

describe('tradeCosts — trade clos', () => {
  // Short synthétique : 1 @ 50 000 puis 2 @ 50 030, racheté 3 @ 49 960, tout en taker à 0,035 %.
  const shortTrade = () => {
    const executions = [
      exec({
        id: 'a',
        side: 'sell',
        qty: '1',
        price: '50000',
        fee: '17.5',
        direction: 'Open Short',
      }),
      exec({
        id: 'b',
        side: 'sell',
        qty: '2',
        price: '50030',
        fee: '35.021',
        startPosition: '-1',
        direction: 'Open Short',
      }),
      exec({
        id: 'c',
        qty: '3',
        price: '49960',
        fee: '52.458',
        startPosition: '-3',
        closedPnl: '180',
        direction: 'Close Short',
      }),
    ];
    return { executions, trip: only(buildRoundTrips(executions)) };
  };

  it('part du brut en frais, taux moyen, seuil, point mort et mouvement capté', () => {
    const { executions, trip } = shortTrade();
    expect(trip.netPnl.toString()).toBe('75.021');
    const costs = costsOf(trip, executions);
    expect(costs.unavailable).toBeNull();
    expect(costs.feeShareOfGross?.eq(D('104.979').div('180'))).toBe(true);
    expect(costs.averageFeeRate?.toString()).toBe('0.00035');
    // (frais − funding) ÷ notionnel d'entrée, et le même montant par unité.
    expect(costs.breakevenMove?.eq(D('104.979').div('150060'))).toBe(true);
    expect(costs.breakevenDistance?.toString()).toBe('34.993');
    // Short : le point mort est SOUS l'entrée moyenne (50 020).
    expect(costs.breakevenPrice?.toString()).toBe('49985.007');
    expect(costs.capturedMove?.eq(D('180').div('150060'))).toBe(true);
    expect(costs.assumedExitRate).toBeNull();
    expect([costs.takerFills, costs.makerFills]).toEqual([3, 0]);
  });

  it('long au brut négatif : pas de part du brut, mouvement capté négatif', () => {
    const executions = [
      exec({ id: 'a', qty: '1', price: '100', fee: '0.05' }),
      exec({
        id: 'b',
        side: 'sell',
        qty: '1',
        price: '95',
        fee: '0.05',
        startPosition: '1',
        closedPnl: '-5',
        direction: 'Close Long',
      }),
    ];
    const costs = costsOf(only(buildRoundTrips(executions)), executions);
    expect(costs.feeShareOfGross).toBeNull();
    expect(costs.capturedMove?.toString()).toBe('-0.05');
    expect(costs.breakevenMove?.toString()).toBe('0.001');
    // Long : le point mort est AU-DESSUS de l'entrée.
    expect(costs.breakevenPrice?.toString()).toBe('100.1');
  });

  it('rebates supérieurs aux frais : pas de part du brut', () => {
    const executions = [
      exec({ id: 'a', qty: '1', price: '100', fee: '-0.01', crossed: false }),
      exec({
        id: 'b',
        side: 'sell',
        qty: '1',
        price: '110',
        fee: '-0.01',
        crossed: false,
        startPosition: '1',
        closedPnl: '10',
        direction: 'Close Long',
      }),
    ];
    const costs = costsOf(only(buildRoundTrips(executions)), executions);
    expect(costs.feeShareOfGross).toBeNull();
    expect(costs.breakevenMove?.toString()).toBe('-0.0002');
    expect([costs.takerFills, costs.makerFills]).toEqual([0, 2]);
  });

  it('funding reçu supérieur aux frais : seuil négatif, point mort du côté défavorable', () => {
    const executions = [
      exec({ id: 'a', qty: '1', price: '100', fee: '0.05' }),
      exec({
        id: 'b',
        side: 'sell',
        qty: '1',
        price: '100',
        fee: '0.05',
        startPosition: '1',
        direction: 'Close Long',
      }),
    ];
    const trip = only(
      buildRoundTrips(executions, [funding({ time: executions[0]!.time + 1, amount: '0.3' })]),
    );
    expect(trip.funding.toString()).toBe('0.3');
    const costs = costsOf(trip, executions);
    expect(costs.breakevenMove?.toString()).toBe('-0.002');
    expect(costs.breakevenPrice?.toString()).toBe('99.8');
  });

  it('trade manuel clos : calculé depuis ses seuls totaux, sans exécution', () => {
    const trip = manualTradeToRoundTrip({
      id: 'm',
      accountId: 'manual',
      symbol: 'SOL',
      direction: 'short',
      qty: '10',
      entryPrice: '120',
      exitPrice: '110',
      openedAt: '2026-07-01T10:00:00',
      closedAt: '2026-07-02T16:30:00',
      fees: '4',
      quote: 'USD',
    });
    const costs = tradeCosts(trip, []);
    expect(costs.feeShareOfGross?.toString()).toBe('0.04');
    expect(costs.breakevenDistance?.toString()).toBe('0.4');
    expect(costs.breakevenPrice?.toString()).toBe('119.6');
    expect(costs.averageFeeRate?.eq(D('4').div('2300'))).toBe(true);
    expect([costs.takerFills, costs.makerFills]).toEqual([0, 0]);
  });
});

describe('tradeCosts — position ouverte', () => {
  it('long : point mort résolu avec une sortie au taux moyen, funding payé compris', () => {
    const executions = [exec({ id: 'a', qty: '2', price: '100', fee: '0.09', crossed: false })];
    const trip = only(
      buildRoundTrips(executions, [funding({ time: executions[0]!.time + 1, amount: '-0.5' })]),
    );
    const costs = costsOf(trip, executions);
    expect(costs.assumedExitRate?.toString()).toBe('0.00045');
    expect(costs.capturedMove).toBeNull();
    expect(costs.feeShareOfGross).toBeNull();
    expect(costs.breakevenPrice?.eq(D('200.59').div('1.9991'))).toBe(true);
    expect(costs.breakevenDistance?.eq(costs.breakevenPrice!.minus('100'))).toBe(true);
    expect(netIfExitAt(trip, costs.breakevenPrice!, costs.assumedExitRate!).abs().lt('1e-20')).toBe(
      true,
    );
  });

  it('short partiellement clos en gain : le réalisé couvre les frais, seuil négatif', () => {
    const executions = [
      exec({ id: 'a', side: 'sell', qty: '4', price: '200', fee: '0.36', direction: 'Open Short' }),
      exec({
        id: 'b',
        qty: '1',
        price: '190',
        fee: '0.0855',
        startPosition: '-4',
        closedPnl: '10',
        direction: 'Close Short',
      }),
    ];
    const trip = only(buildRoundTrips(executions));
    expect(trip.status).toBe('open');
    const costs = costsOf(trip, executions);
    expect(costs.assumedExitRate?.toString()).toBe('0.00045');
    // Short : X = (entrée × reste − (frais − funding − réalisé)) ÷ (reste × (1 + r)).
    expect(costs.breakevenPrice?.eq(D('609.5545').div('3.00135'))).toBe(true);
    expect(costs.breakevenMove?.lt(ZERO)).toBe(true);
    expect(netIfExitAt(trip, costs.breakevenPrice!, costs.assumedExitRate!).abs().lt('1e-20')).toBe(
      true,
    );
  });
});

describe('tradeCosts — seuil indisponible', () => {
  it('historique partiel : l’entrée est inconnue, rien n’est calculé', () => {
    const executions = [
      exec({
        id: 'a',
        side: 'sell',
        qty: '2',
        price: '100',
        startPosition: '2',
        closedPnl: '5',
        direction: 'Close Long',
      }),
    ];
    const trip = only(buildRoundTrips(executions));
    expect(trip.incomplete).toBe(true);
    const costs = costsOf(trip, executions);
    expect(costs.unavailable).toBe('incomplete');
    expect(costs.breakevenMove).toBeNull();
    expect(costs.feeShareOfGross).toBeNull();
    expect(costs.takerFills).toBe(1);
  });

  it('frais dans un autre jeton : ni part ni seuil, qui seraient sous-estimés', () => {
    const executions = [
      exec({
        id: 'a',
        qty: '1',
        price: '100',
        fee: '0',
        feeNative: { asset: 'HYPE', qty: '0.01' },
      }),
      exec({
        id: 'b',
        side: 'sell',
        qty: '1',
        price: '110',
        startPosition: '1',
        closedPnl: '10',
        direction: 'Close Long',
      }),
    ];
    const costs = costsOf(only(buildRoundTrips(executions)), executions);
    expect(costs.unavailable).toBe('native-fees');
    expect(costs.feeShareOfGross).toBeNull();
    expect(costs.breakevenPrice).toBeNull();
    expect(costs.averageFeeRate).toBeNull();
  });
});

describe('propriétés', () => {
  const arb = fc.record({
    fills: fc.array(
      fc.record({
        side: fc.constantFrom('buy', 'sell'),
        qty: fc.integer({ min: 1, max: 5 }),
        price: fc.integer({ min: 50, max: 150 }),
        fee: fc.integer({ min: -20, max: 200 }),
        pnl: fc.integer({ min: -900, max: 900 }),
        crossed: fc.boolean(),
        sameInstant: fc.boolean(),
      }),
      { minLength: 1, maxLength: 30 },
    ),
    funding: fc.array(fc.integer({ min: -50, max: 50 }), { maxLength: 10 }),
  });

  type Raw = typeof arb extends fc.Arbitrary<infer T> ? T : never;

  /** Chaîne cohérente : `startPosition` suit la position simulée, libellés de la plateforme. */
  function scenario(raw: Raw): {
    executions: Execution[];
    payments: FundingPayment[];
  } {
    let position = ZERO;
    let time = T0;
    const executions = raw.fills.map((r, n) => {
      if (!r.sameInstant) time += 1000;
      const qty = D(String(r.qty));
      const signed = r.side === 'buy' ? qty : qty.neg();
      const next = position.plus(signed);
      const closes = !position.eq(ZERO) && position.s !== signed.s;
      const flips = closes && !next.eq(ZERO) && next.s !== position.s;
      const long = (position.eq(ZERO) ? signed : position).s === 1;
      const direction = flips
        ? long
          ? 'Long > Short'
          : 'Short > Long'
        : `${closes ? 'Close' : 'Open'} ${long ? 'Long' : 'Short'}`;
      const x = exec({
        id: `p${n}`,
        time,
        side: r.side as 'buy' | 'sell',
        qty: qty.toString(),
        price: String(r.price),
        fee: D(String(r.fee)).div('1000').toString(),
        closedPnl: closes ? D(String(r.pnl)).div('100').toString() : '0',
        startPosition: position.toString(),
        direction,
        crossed: r.crossed,
      });
      position = next;
      return x;
    });
    const span = Math.max(1, time - T0);
    const payments = raw.funding.map((amount, i) =>
      funding({
        id: `pf${i}`,
        time: T0 + Math.floor(((i + 1) * span) / (raw.funding.length + 1)),
        amount: D(String(amount)).div('100').toString(),
      }),
    );
    return { executions, payments };
  }

  it('les lignes d’un trade retombent exactement sur ses frais et ses quantités', () => {
    fc.assert(
      fc.property(arb, (raw) => {
        const { executions, payments } = scenario(raw);
        for (const trip of buildRoundTrips(executions, payments)) {
          const lines = executionLines(trip, executions);
          expect(sum(lines.map((l) => l.fee)).eq(trip.fees)).toBe(true);
          expect(sum(lines.map((l) => l.qty)).eq(trip.qtyOpened.plus(trip.qtyClosed))).toBe(true);
          const costs = tradeCosts(trip, lines);
          expect(costs.makerFills + costs.takerFills).toBe(trip.executionIds.length);
        }
      }),
    );
  });

  it('trade clos : le net est positif si et seulement si le mouvement capté dépasse le seuil', () => {
    fc.assert(
      fc.property(arb, (raw) => {
        const { executions, payments } = scenario(raw);
        for (const trip of buildRoundTrips(executions, payments)) {
          if (trip.status !== 'closed' || trip.incomplete) continue;
          const costs = costsOf(trip, executions);
          const margin = costs.capturedMove!.minus(costs.breakevenMove!);
          expect(margin.cmp(ZERO)).toBe(trip.netPnl.cmp(ZERO));
          // Le point mort est l'entrée décalée du seuil, dans le sens du trade.
          const sign = trip.direction === 'long' ? ONE : ONE.neg();
          expect(
            costs.breakevenPrice!.minus(trip.avgEntry!).times(sign).eq(costs.breakevenDistance!),
          ).toBe(true);
        }
      }),
    );
  });

  it('position ouverte : sortir au point mort, au taux supposé, rend un net nul', () => {
    fc.assert(
      fc.property(arb, (raw) => {
        const { executions, payments } = scenario(raw);
        for (const trip of buildRoundTrips(executions, payments)) {
          if (trip.status !== 'open' || trip.incomplete) continue;
          const costs = costsOf(trip, executions);
          if (costs.breakevenPrice === null) continue;
          const net = netIfExitAt(trip, costs.breakevenPrice, costs.assumedExitRate!);
          expect(net.abs().lt('1e-18')).toBe(true);
        }
      }),
    );
  });
});

describe('observedFeeRates — les taux réellement payés', () => {
  const fill = (over: Partial<Execution>): Execution => exec({ qty: '1', price: '1000', ...over });

  it('médiane par rôle : impaire, paire, et un builder fee isolé ne déplace rien', () => {
    const executions = [
      fill({ id: 't1', fee: '0.45' }),
      fill({ id: 't2', fee: '0.45' }),
      // Builder fee : un fill plus cher que les autres, qui ne doit pas devenir « le » taux.
      fill({ id: 't3', fee: '0.65' }),
      fill({ id: 'm1', fee: '0.15', crossed: false }),
      fill({ id: 'm2', fee: '-0.03', crossed: false }),
    ];
    const rates = observedFeeRates(executions);
    expect(rates.taker?.toString()).toBe('0.00045');
    // Deux valeurs : la moyenne des deux du milieu, rebate compris.
    expect(rates.maker?.toString()).toBe('0.00006');
  });

  it('ne retient que les plus récentes, et écarte le spot et les frais payés dans un autre jeton', () => {
    const executions = [
      fill({ id: 'old', time: T0 + 1, fee: '0.9' }),
      fill({ id: 'new1', time: T0 + 3, fee: '0.35' }),
      fill({ id: 'new2', time: T0 + 2, fee: '0.35' }),
      fill({ id: 'spot', time: T0 + 9, fee: '5', market: 'spot' }),
      fill({ id: 'hype', time: T0 + 9, fee: '0', feeNative: { asset: 'HYPE', qty: '0.1' } }),
    ];
    expect(observedFeeRates(executions, 2).taker?.toString()).toBe('0.00035');
    expect(observedFeeRates(executions, 3).taker?.toString()).toBe('0.00035');
  });

  it('aucun taux inventé : null faute d’exécution du rôle', () => {
    const one = observedFeeRates([fill({ id: 't', fee: '0.45' })]);
    expect(one.taker?.toString()).toBe('0.00045');
    expect(one.maker).toBeNull();
    expect(observedFeeRates([])).toEqual({ taker: null, maker: null });
  });
});

describe('sizeBreakeven — le prix à atteindre, et ce qu’il rapporte tout juste', () => {
  const taker = D('0.00035');

  it('long : le prix doit monter à entrée × (1 + taux d’entrée) ÷ (1 − taux de sortie)', () => {
    const row = sizeBreakeven('long', D('50000'), D('10'), taker, taker)!;
    expect(row.exitPrice.eq(D('50017.5').div('0.99965'))).toBe(true);
    expect(row.distance.eq(row.exitPrice.minus('50000'))).toBe(true);
    expect(row.move.eq(row.distance.div('50000'))).toBe(true);
    expect(row.grossMin.eq(row.distance.times('10'))).toBe(true);
    expect(row.notional.toString()).toBe('500000');
    // Un peu plus de 35 $ par unité : les frais de sortie se paient au prix atteint, plus haut.
    expect(row.distance.gt('35.01') && row.distance.lt('35.02')).toBe(true);
  });

  it('short : le prix doit descendre à entrée × (1 − taux d’entrée) ÷ (1 + taux de sortie)', () => {
    const row = sizeBreakeven('short', D('50000'), D('10'), taker, taker)!;
    expect(row.exitPrice.eq(D('49982.5').div('1.00035'))).toBe(true);
    expect(row.distance.eq(D('50000').minus(row.exitPrice))).toBe(true);
    // Un peu moins de 35 $ : la sortie, plus basse, paie moins de frais.
    expect(row.distance.gt('34.98') && row.distance.lt('34.99')).toBe(true);
  });

  it('au point mort, le gain brut paie exactement les frais d’entrée et de sortie', () => {
    const maker = D('0.00008');
    for (const direction of ['long', 'short'] as const) {
      const row = sizeBreakeven(direction, D('50000'), D('30'), maker, taker)!;
      const fees = maker.times('50000').times('30').plus(taker.times(row.exitPrice).times('30'));
      expect(row.grossMin.minus(fees).abs().lt('1e-20')).toBe(true);
    }
  });

  it('taux absurdes ou prix nul : pas de point mort plutôt qu’un point mort faux', () => {
    expect(sizeBreakeven('long', D('100'), ONE, taker, ONE)).toBeNull();
    expect(sizeBreakeven('long', D('100'), ONE, taker, D('1.5'))).toBeNull();
    expect(sizeBreakeven('short', D('100'), ONE, ONE, taker)).toBeNull();
    expect(sizeBreakeven('long', ZERO, ONE, taker, taker)).toBeNull();
  });

  it('propriété : écart × taille = gain brut = frais au point mort, et ni le prix ni le % ne dépendent de la taille', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('long' as const, 'short' as const),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: -3, max: 100 }),
        fc.integer({ min: -3, max: 100 }),
        (direction, price, qty, entry, exit) => {
          const p = D(String(price)).div('100');
          const q = D(String(qty)).div('1000');
          const a = D(String(entry)).div('100000');
          const b = D(String(exit)).div('100000');
          const row = sizeBreakeven(direction, p, q, a, b)!;
          const unit = sizeBreakeven(direction, p, ONE, a, b)!;
          expect(row.grossMin.eq(row.distance.times(q))).toBe(true);
          expect(row.exitPrice.eq(unit.exitPrice)).toBe(true);
          expect(row.move.eq(unit.move)).toBe(true);
          const fees = a.times(p).times(q).plus(b.times(row.exitPrice).times(q));
          expect(row.grossMin.minus(fees).abs().lte(p.times(q).times('1e-25'))).toBe(true);
        },
      ),
    );
  });
});
