/**
 * Branchement des flux du moteur sur le TWR. Le point à protéger : un virement interne apparié
 * n'est PAS un flux externe — le compter ferait apparaître un retrait puis un apport que la
 * courbe de valeur, elle, ne voit pas (cf. `holdingOpsOf`), et le rendement s'en trouverait faussé.
 */
import { describe, expect, it } from 'vitest';
import type { CashFlow } from '../domain/engine';
import { D } from '../domain/money';
import { computePerformance, externalFlows } from './performance';
import type { MetricPoint } from './metrics';

const flow = (eventId: string, at: string, amount: string): CashFlow => ({
  eventId,
  at,
  amountEur: D(amount),
});
const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

describe('externalFlows', () => {
  it('inverse le signe du moteur : un achat devient un apport', () => {
    const flows = externalFlows([flow('a', '2026-01-02T10:00:00', '-1000')], {});
    expect(flows).toHaveLength(1);
    expect(flows[0]!.amountEur.toString()).toBe('1000');
  });

  it('écarte les deux jambes d’un virement interne apparié', () => {
    const cash = [
      flow('achat', '2026-01-02T10:00:00', '-1000'),
      flow('retrait', '2026-01-10T23:30:00', '1000'), // sortie au coût
      flow('depot', '2026-01-12T01:00:00', '-1000'), // entrée au coût sur l'autre compte
      flow('vente', '2026-02-01T10:00:00', '1500'),
    ];
    const flows = externalFlows(cash, { retrait: 'out', depot: 'in' });
    expect(flows.map((f) => f.amountEur.toString())).toEqual(['1000', '-1500']);
  });

  it('laisse passer un retrait NON apparié (c’est une vraie sortie)', () => {
    const flows = externalFlows([flow('retrait', '2026-01-10T12:00:00', '800')], {});
    expect(flows).toHaveLength(1);
    expect(flows[0]!.amountEur.toString()).toBe('-800');
  });
});

describe('computePerformance', () => {
  const days = Array.from({ length: 61 }, (_, i) => addDays('2026-01-01', i));
  const series: MetricPoint[] = days.map((day, i) => ({
    day,
    // 0 le premier jour, puis 1 000 € qui montent régulièrement jusqu'à 1 200 €.
    value: i === 0 ? D('0') : D('1000').plus(D(String(i)).times('200').div('60')),
    cost: D('1000'),
    qty: null,
    price: null,
    estimated: false,
  }));
  const cashFlows = [flow('achat', `${days[1]!}T00:00:00`, '-1000')];

  it('rend un TWR annualisé et un repère alimenté par les mêmes flux', () => {
    const result = computePerformance({
      series,
      cashFlows,
      internalTransferLegs: {},
      benchmark: { asset: 'btc', prices: days.map((day) => ({ day, priceEur: D('100') })) },
      partialAssets: 0,
    });
    expect(result.twr.ok).toBe(true);
    if (!result.twr.ok) return;
    // Le portefeuille gagne 20 % ; le repère est à prix constant, donc il ne gagne rien.
    expect(Number(result.twr.cumulative.toString())).toBeCloseTo(0.2, 2);
    expect(result.twr.annualized).not.toBeNull();
    expect(result.benchmark).not.toBeNull();
    expect(Number(result.benchmark!.investedEur.toString())).toBe(1000);
    expect(Number(result.benchmark!.valueEur.toString())).toBeCloseTo(1000, 6);
  });

  it('sans cotation du repère, le TWR reste rendu', () => {
    const result = computePerformance({
      series,
      cashFlows,
      internalTransferLegs: {},
      benchmark: null,
      partialAssets: 2,
    });
    expect(result.benchmark).toBeNull();
    expect(result.twr.ok).toBe(true);
    expect(result.partialAssets).toBe(2);
  });
});
