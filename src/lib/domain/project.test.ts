import { describe, expect, it } from 'vitest';
import { ZERO_FEE, COINHOUSE_FEES } from './fees';
import { D, ZERO } from './money';
import { MAX_PLAN_MONTHS, monthlyToReach, projectDca, requiredAnnualRate } from './project';

const empty = { qty: ZERO, costBasis: ZERO };

describe('projectDca', () => {
  it('à prix constant et sans frais, le PRU projeté vaut le prix', () => {
    const plan = projectDca({
      position: empty,
      monthlyEur: D('100'),
      months: 12,
      priceEur: D('50'),
      fee: ZERO_FEE,
      priceChange: ZERO,
    })!;
    expect(plan.investedEur.toString()).toBe('1200');
    expect(plan.feesEur.toString()).toBe('0');
    // 1 200 € à 50 € l'unité = 24 unités ; le PRU est donc le prix lui-même.
    expect(plan.qtyAcquired.toString()).toBe('24');
    expect(plan.pruAfter!.toString()).toBe('50');
    expect(plan.finalPriceEur.toString()).toBe('50');
    expect(plan.unrealizedAfter.toString()).toBe('0');
  });

  it('les frais sortent de la poche et réduisent la quantité, pas l’investi', () => {
    const plan = projectDca({
      position: empty,
      monthlyEur: D('100'),
      months: 1,
      priceEur: D('100'),
      fee: COINHOUSE_FEES['buy-sepa'],
      priceChange: ZERO,
    })!;
    // 0,99 % + 0,12 € sur 100 € = 1,11 € ; il reste 98,89 € pour acheter.
    expect(plan.feesEur.toString()).toBe('1.11');
    expect(plan.investedEur.toString()).toBe('100');
    expect(plan.qtyAcquired.toString()).toBe('0.9889');
    // Le PRU inclut les frais : c'est la règle all-in du moteur (décision n° 4).
    expect(plan.pruAfter!.round(4).toString()).toBe('101.1225');
  });

  it('un prix qui baisse fait baisser le PRU projeté sous le prix de départ', () => {
    const base = {
      position: empty,
      monthlyEur: D('100'),
      months: 12,
      priceEur: D('100'),
      fee: ZERO_FEE,
    };
    const down = projectDca({ ...base, priceChange: D('-0.5') })!;
    const flat = projectDca({ ...base, priceChange: ZERO })!;
    const up = projectDca({ ...base, priceChange: D('0.5') })!;
    expect(down.pruAfter!.lt(flat.pruAfter!)).toBe(true);
    expect(up.pruAfter!.gt(flat.pruAfter!)).toBe(true);
    // Acheter en baisse achète plus d'unités pour le même argent.
    expect(down.qtyAcquired.gt(up.qtyAcquired)).toBe(true);
    expect(down.finalPriceEur.toString()).toBe('50');
    expect(up.finalPriceEur.toString()).toBe('150');
  });

  it('part de la position existante et la complète', () => {
    const plan = projectDca({
      position: { qty: D('2'), costBasis: D('300') },
      monthlyEur: D('100'),
      months: 2,
      priceEur: D('100'),
      fee: ZERO_FEE,
      priceChange: ZERO,
    })!;
    expect(plan.qtyAfter.toString()).toBe('4');
    expect(plan.costAfter.toString()).toBe('500');
    expect(plan.pruAfter!.toString()).toBe('125');
    expect(plan.valueAfter.toString()).toBe('400');
    expect(plan.unrealizedAfter.toString()).toBe('-100');
  });

  it('borne une chute à −100 % : un prix négatif n’existe pas', () => {
    const plan = projectDca({
      position: empty,
      monthlyEur: D('100'),
      months: 3,
      priceEur: D('100'),
      fee: ZERO_FEE,
      priceChange: D('-3'),
    })!;
    expect(plan.finalPriceEur.toString()).toBe('0');
    // Le dernier versement ne peut rien acheter à prix nul : il n'invente pas de quantité infinie.
    expect(plan.qtyAcquired.gt(ZERO)).toBe(true);
    expect(Number.isFinite(Number(plan.qtyAcquired.toString()))).toBe(true);
  });

  it('refuse les entrées qui n’ont pas de sens', () => {
    const base = {
      position: empty,
      monthlyEur: D('100'),
      months: 12,
      priceEur: D('100'),
      fee: ZERO_FEE,
      priceChange: ZERO,
    };
    expect(projectDca({ ...base, monthlyEur: ZERO })).toBeNull();
    expect(projectDca({ ...base, priceEur: ZERO })).toBeNull();
    expect(projectDca({ ...base, months: 0 })).toBeNull();
    expect(projectDca({ ...base, months: 2.5 })).toBeNull();
    expect(projectDca({ ...base, months: MAX_PLAN_MONTHS + 1 })).toBeNull();
    expect(projectDca({ ...base, months: MAX_PLAN_MONTHS })).not.toBeNull();
  });
});

describe('requiredAnnualRate', () => {
  it('donne le taux qu’il faudrait tenir pour atteindre la cible', () => {
    // Doubler en 3 ans : 2^(1/3) − 1 ≈ 25,99 %.
    const rate = requiredAnnualRate(D('1000'), D('2000'), 3)!;
    expect(rate.round(4).toString()).toBe('0.2599');
    // Une cible déjà atteinte demande un taux négatif ou nul, pas une erreur.
    expect(requiredAnnualRate(D('2000'), D('1000'), 1)!.round(4).toString()).toBe('-0.5');
  });

  it('refuse une question vide de sens', () => {
    expect(requiredAnnualRate(ZERO, D('1000'), 3)).toBeNull();
    expect(requiredAnnualRate(D('1000'), ZERO, 3)).toBeNull();
    expect(requiredAnnualRate(D('1000'), D('2000'), 0)).toBeNull();
    expect(requiredAnnualRate(D('1000'), D('2000'), Number.NaN)).toBeNull();
  });
});

describe('monthlyToReach', () => {
  it('répartit l’écart sur les mois, à rendement supposé nul', () => {
    expect(monthlyToReach(D('1000'), D('4000'), 12)!.toString()).toBe('250');
    // Cible déjà atteinte : rien à verser, donc pas de réponse à donner.
    expect(monthlyToReach(D('5000'), D('4000'), 12)).toBeNull();
    expect(monthlyToReach(D('1000'), D('4000'), 0)).toBeNull();
  });
});
