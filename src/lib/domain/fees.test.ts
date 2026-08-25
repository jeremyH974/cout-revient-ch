import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COINHOUSE_FEES, ZERO_FEE, breakEvenSellPrice, feeOnGross, netAfterFees } from './fees';
import { D, ZERO } from './money';
import { simulateSell } from './simulate';

describe('feeOnGross / netAfterFees', () => {
  it('pourcentage + fixe, jamais négatif, jamais plus que le brut', () => {
    expect(feeOnGross(D('100'), COINHOUSE_FEES['sell-eur']).toString()).toBe('1.41');
    expect(netAfterFees(D('100'), COINHOUSE_FEES['sell-eur']).toString()).toBe('98.59');
    expect(feeOnGross(D('100'), ZERO_FEE).toString()).toBe('0');
    // Micro-montant : le frais fixe est plafonné au brut (le net ne devient jamais négatif).
    expect(feeOnGross(D('0.05'), COINHOUSE_FEES['sell-eur']).toString()).toBe('0.05');
    expect(netAfterFees(D('0.05'), COINHOUSE_FEES['sell-eur']).toString()).toBe('0');
    expect(feeOnGross(ZERO, COINHOUSE_FEES['sell-eur']).toString()).toBe('0');
  });
});

describe('breakEvenSellPrice', () => {
  it('sans frais, l’équilibre est le PRU ; l’objectif s’ajoute au-dessus', () => {
    expect(breakEvenSellPrice(D('100'), D('2'), ZERO_FEE)?.toString()).toBe('100');
    expect(breakEvenSellPrice(D('100'), D('2'), ZERO_FEE, D('25'))?.toString()).toBe('125');
    expect(breakEvenSellPrice(D('100'), ZERO, ZERO_FEE)).toBeNull();
  });

  it('propriété : vendre toute la position au seuil dégage exactement l’objectif net', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 0, max: 200 }),
        fc.constantFrom(COINHOUSE_FEES['sell-eur'], COINHOUSE_FEES['crypto-crypto'], ZERO_FEE),
        (qtyMilli, pruCents, targetPct, fee) => {
          const qty = D(String(qtyMilli)).div('1000');
          const pru = D(String(pruCents)).div('100');
          const threshold = breakEvenSellPrice(pru, qty, fee, D(String(targetPct)));
          expect(threshold).not.toBeNull();
          const sale = simulateSell({ qty, costBasis: qty.times(pru) }, qty, threshold!, fee);
          expect(sale).not.toBeNull();
          const targetNet = qty.times(pru).times(String(targetPct)).div('100');
          const scale = targetNet.abs().gt('1') ? targetNet.abs() : D('1');
          expect(sale!.realizedEur.minus(targetNet).abs().div(scale).lte('0.000000001')).toBe(true);
        },
      ),
    );
  });
});
