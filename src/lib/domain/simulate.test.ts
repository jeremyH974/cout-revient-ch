import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COINHOUSE_FEES, netAfterFees } from './fees';
import { D, ZERO, type Big } from './money';
import {
  qtyToRecoverStake,
  simulateBuy,
  simulateSell,
  spendToReachPru,
  type SimulatedPosition,
} from './simulate';

const position = (qty: string, costBasis: string): SimulatedPosition => ({
  qty: D(qty),
  costBasis: D(costBasis),
});

/** |a − b| ÷ max(|b|, 1) ≤ 1e-9 : même tolérance que l'oracle indépendant. */
const closeTo = (a: Big, b: Big): boolean => {
  const scale = b.abs().gt('1') ? b.abs() : D('1');
  return a.minus(b).abs().div(scale).lte('0.000000001');
};

describe('simulateBuy', () => {
  it('exemple canonique : racheter sous le PRU l’abaisse vers le prix payé', () => {
    const result = simulateBuy(position('1', '100'), D('50'), D('50'));
    expect(result).not.toBeNull();
    expect(result?.qtyBought.toString()).toBe('1');
    expect(result?.qtyAfter.toString()).toBe('2');
    expect(result?.costAfter.toString()).toBe('150');
    expect(result?.pruBefore?.toString()).toBe('100');
    expect(result?.pruAfter?.toString()).toBe('75');
    expect(result?.pruChange?.toString()).toBe('-0.25');
  });

  it('les frais réduisent la quantité reçue, jamais le coût (all-in comme le moteur)', () => {
    const result = simulateBuy(position('1', '100'), D('100'), D('100'), {
      pctFee: '1',
      fixedEur: '0',
    });
    expect(result?.qtyBought.toString()).toBe('0.99');
    expect(result?.feesEur.toString()).toBe('1');
    expect(result?.costAfter.toString()).toBe('200');
    expect(result?.pruAfter?.eq(D('200').div('1.99'))).toBe(true);
  });

  it('grille Coinhouse (achat par virement) : 0,99 % + 0,12 € fixes', () => {
    const result = simulateBuy(position('0', '0'), D('100'), D('100'), COINHOUSE_FEES['buy-sepa']);
    expect(result?.feesEur.toString()).toBe('1.11');
    expect(result?.qtyBought.toString()).toBe('0.9889');
    // Le coût all-in est bien le montant sorti de la poche : PRU > prix de marché.
    expect(result?.pruAfter?.gt('100')).toBe(true);
  });

  it('première position (quantité nulle) : le PRU naît au prix all-in', () => {
    const result = simulateBuy(position('0', '0'), D('90'), D('45'));
    expect(result?.pruBefore).toBeNull();
    expect(result?.pruAfter?.toString()).toBe('45');
    expect(result?.pruChange).toBeNull();
  });

  it('rejette les entrées sans sens', () => {
    expect(simulateBuy(position('1', '100'), D('50'), ZERO)).toBeNull();
    expect(simulateBuy(position('1', '100'), D('-1'), D('50'))).toBeNull();
    expect(
      simulateBuy(position('1', '100'), D('50'), D('50'), { pctFee: '100', fixedEur: '0' }),
    ).toBeNull();
    expect(
      simulateBuy(position('1', '100'), D('50'), D('50'), { pctFee: '-1', fixedEur: '0' }),
    ).toBeNull();
    // Montant trop faible pour couvrir le frais fixe : rien ne serait acheté.
    expect(
      simulateBuy(position('1', '100'), D('0.10'), D('50'), COINHOUSE_FEES['buy-sepa']),
    ).toBeNull();
  });

  it('propriété : le nouveau PRU est strictement entre le prix payé et l’ancien PRU', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        (qtyMilli, costCents, spendCents, priceCents) => {
          const pos = position(
            D(String(qtyMilli)).div('1000').toString(),
            D(String(costCents)).div('100').toString(),
          );
          const price = D(String(priceCents)).div('100');
          const result = simulateBuy(pos, D(String(spendCents)).div('100'), price);
          expect(result).not.toBeNull();
          const { pruBefore, pruAfter } = result!;
          expect(pruAfter).not.toBeNull();
          if (pruBefore === null) return;
          if (price.lt(pruBefore)) {
            expect(pruAfter!.lt(pruBefore)).toBe(true);
            expect(pruAfter!.gt(price)).toBe(true);
          } else if (price.gt(pruBefore)) {
            expect(pruAfter!.gt(pruBefore)).toBe(true);
            expect(pruAfter!.lt(price)).toBe(true);
          } else {
            expect(closeTo(pruAfter!, pruBefore)).toBe(true);
          }
        },
      ),
    );
  });

  it('propriété : deux rachats successifs équivalent au rachat cumulé', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (costCents, spend1, spend2, priceCents) => {
          const pos = position('1', D(String(costCents)).div('100').toString());
          const price = D(String(priceCents)).div('100');
          const s1 = D(String(spend1)).div('100');
          const s2 = D(String(spend2)).div('100');
          const step = simulateBuy(pos, s1, price)!;
          const twice = simulateBuy({ qty: step.qtyAfter, costBasis: step.costAfter }, s2, price)!;
          const once = simulateBuy(pos, s1.plus(s2), price)!;
          expect(closeTo(twice.pruAfter!, once.pruAfter!)).toBe(true);
          expect(twice.costAfter.eq(once.costAfter)).toBe(true);
        },
      ),
    );
  });
});

describe('simulateSell', () => {
  it('réalise quantité × (prix − PRU) et ne touche jamais au PRU', () => {
    const result = simulateSell(position('2', '150'), D('1'), D('100'));
    expect(result?.grossEur.toString()).toBe('100');
    expect(result?.netProceedsEur.toString()).toBe('100');
    expect(result?.realizedEur.toString()).toBe('25');
    expect(result?.qtyAfter.toString()).toBe('1');
    expect(result?.costAfter.toString()).toBe('75');
    expect(result?.pruAfter?.toString()).toBe('75');
  });

  it('applique le barème sur le produit : vente en euros vs conversion stablecoin', () => {
    // Brut 100 € ; vente EUR : 1,29 % + 0,12 € = 1,41 € ; conversion crypto : 0,79 % + 0,12 € = 0,91 €.
    const eur = simulateSell(position('2', '150'), D('1'), D('100'), COINHOUSE_FEES['sell-eur']);
    expect(eur?.feesEur.toString()).toBe('1.41');
    expect(eur?.netProceedsEur.toString()).toBe('98.59');
    expect(eur?.realizedEur.toString()).toBe('23.59');
    const stable = simulateSell(
      position('2', '150'),
      D('1'),
      D('100'),
      COINHOUSE_FEES['crypto-crypto'],
    );
    expect(stable?.feesEur.toString()).toBe('0.91');
    expect(stable?.realizedEur.toString()).toBe('24.09');
    // Le PRU restant est identique dans les deux cas : les frais de sortie ne le touchent pas.
    expect(eur?.pruAfter?.eq(stable!.pruAfter!)).toBe(true);
  });

  it('vendre tout clôt la position (PRU nul ensuite)', () => {
    const result = simulateSell(position('2', '150'), D('2'), D('60'));
    expect(result?.realizedEur.toString()).toBe('-30');
    expect(result?.qtyAfter.toString()).toBe('0');
    expect(result?.pruAfter).toBeNull();
  });

  it('rejette une quantité hors de ]0 ; détenu]', () => {
    expect(simulateSell(position('2', '150'), ZERO, D('100'))).toBeNull();
    expect(simulateSell(position('2', '150'), D('2.000000001'), D('100'))).toBeNull();
  });

  it('propriété : réalisé + latent restant = latent initial, au même prix', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 99 }),
        (qtyMilli, costCents, priceCents, pct) => {
          const pos = position(
            D(String(qtyMilli)).div('1000').toString(),
            D(String(costCents)).div('100').toString(),
          );
          const price = D(String(priceCents)).div('100');
          const qtySold = pos.qty.times(String(pct)).div('100');
          const result = simulateSell(pos, qtySold, price)!;
          const pru = pos.costBasis.div(pos.qty);
          const before = pos.qty.times(price.minus(pru));
          const after = result.qtyAfter.times(price.minus(pru));
          expect(result.realizedEur.plus(after).eq(before)).toBe(true);
        },
      ),
    );
  });
});

describe('spendToReachPru', () => {
  it('exemple canonique, vérifié en rejouant le rachat', () => {
    const pos = position('1', '100');
    const spend = spendToReachPru(pos, D('50'), D('80'));
    expect(spend?.round(9).toString()).toBe('33.333333333');
    const replay = simulateBuy(pos, spend!, D('50'));
    expect(closeTo(replay!.pruAfter!, D('80'))).toBe(true);
  });

  it('n’a de sens qu’entre le prix et le PRU actuel', () => {
    const pos = position('1', '100');
    expect(spendToReachPru(pos, D('50'), D('100'))).toBeNull();
    expect(spendToReachPru(pos, D('50'), D('50'))).toBeNull();
    expect(spendToReachPru(pos, D('50'), D('40'))).toBeNull();
    expect(spendToReachPru(pos, D('50'), D('120'))).toBeNull();
    expect(spendToReachPru(position('0', '0'), D('50'), D('80'))).toBeNull();
  });

  it('propriété : le montant rendu amène bien le PRU sur la cible (1e-9 près)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 2, max: 1_000_000 }),
        fc.integer({ min: 1, max: 998 }),
        (qtyMilli, pruCents, ratioMilli) => {
          const qty = D(String(qtyMilli)).div('1000');
          const pru = D(String(pruCents)).div('100');
          const pos = { qty, costBasis: qty.times(pru) };
          const price = pru.div('2');
          // Cible strictement entre prix et PRU : prix + (PRU − prix) × ratio, ratio ∈ ]0 ; 1[.
          const target = price.plus(pru.minus(price).times(String(ratioMilli)).div('1000'));
          const spend = spendToReachPru(pos, price, target);
          expect(spend).not.toBeNull();
          expect(spend!.gt(ZERO)).toBe(true);
          const replay = simulateBuy(pos, spend!, price)!;
          expect(closeTo(replay.pruAfter!, target)).toBe(true);
        },
      ),
    );
  });
});

describe('qtyToRecoverStake', () => {
  it('rend la quantité qui rembourse le net investi, sinon null', () => {
    expect(qtyToRecoverStake(D('100'), D('50'))?.toString()).toBe('2');
    expect(qtyToRecoverStake(ZERO, D('50'))).toBeNull();
    expect(qtyToRecoverStake(D('-5'), D('50'))).toBeNull();
    expect(qtyToRecoverStake(D('100'), ZERO)).toBeNull();
  });

  it('frais inclus : vendre cette quantité rend exactement la mise, net de frais', () => {
    const fee = COINHOUSE_FEES['sell-eur'];
    const qty = qtyToRecoverStake(D('100'), D('50'), fee);
    expect(qty).not.toBeNull();
    const net = netAfterFees(qty!.times('50'), fee);
    expect(net.minus('100').abs().lte('0.000000001')).toBe(true);
  });
});
