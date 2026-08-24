/**
 * Repère BTC : rejeu des flux réels sur un actif unique. Le risque de ce module n'est pas
 * l'arithmétique, c'est de comparer deux choses différentes — d'où les tests sur la fenêtre
 * commune, les flux écartés et les retraits impossibles.
 */
import { describe, expect, it } from 'vitest';
import { replayBenchmark, toBenchmarkPrices, type BenchmarkPrice } from './benchmark';
import { D, ZERO } from './money';
import type { TwrFlow } from './twr';

const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const grid = (from: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => addDays(from, i));
/** Cotations linéaires de `from` à `to` sur la grille. */
const ramp = (days: readonly string[], from: string, to: string): BenchmarkPrice[] => {
  const start = D(from);
  const step = D(to)
    .minus(start)
    .div(String(days.length - 1));
  return days.map((day, i) => ({ day, priceEur: start.plus(step.times(String(i))) }));
};

describe('replayBenchmark', () => {
  it('même argent, prix doublé : la valeur du repère double', () => {
    const days = grid('2026-01-01', 61);
    const prices = ramp(days, '100', '200');
    const flows: TwrFlow[] = [{ at: `${days[1]!}T12:00:00`, amountEur: D('1000') }];
    const result = replayBenchmark({ asset: 'btc', flows, prices, days });
    expect(result).not.toBeNull();
    if (!result) return;
    // 1 000 € au prix du 2ᵉ jour (101,666…), revendus au prix final (200).
    expect(Number(result.investedEur.toString())).toBe(1000);
    expect(Number(result.valueEur.toString())).toBeCloseTo(
      (1000 / Number(prices[1]!.priceEur.toString())) * 200,
      6,
    );
    expect(result.skippedFlows).toBe(0);
    expect(Number(result.clampedEur.toString())).toBe(0);
  });

  it('un retrait ne peut pas vendre plus que la position : l’excédent est rogné et signalé', () => {
    const days = grid('2026-01-01', 40);
    const prices = days.map((day) => ({ day, priceEur: D('100') }));
    const flows: TwrFlow[] = [
      { at: `${days[1]!}T10:00:00`, amountEur: D('500') },
      { at: `${days[20]!}T10:00:00`, amountEur: D('-800') },
    ];
    const result = replayBenchmark({ asset: 'btc', flows, prices, days });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(Number(result.qty.toString())).toBe(0);
    expect(Number(result.withdrawnEur.toString())).toBe(500);
    expect(Number(result.clampedEur.toString())).toBe(300);
    expect(result.qty.gte(ZERO)).toBe(true);
  });

  it('démarre à la première cotation connue et compte les flux antérieurs comme écartés', () => {
    const days = grid('2026-01-01', 60);
    // L'actif repère n'est coté qu'à partir du 11ᵉ jour.
    const prices = days.slice(10).map((day) => ({ day, priceEur: D('50') }));
    const flows: TwrFlow[] = [
      { at: `${days[2]!}T10:00:00`, amountEur: D('300') },
      { at: `${days[20]!}T10:00:00`, amountEur: D('700') },
    ];
    const result = replayBenchmark({ asset: 'btc', flows, prices, days });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.since).toBe(days[10]);
    expect(result.skippedFlows).toBe(1);
    expect(Number(result.investedEur.toString())).toBe(700);
  });

  it('sans aucune cotation, pas de repère (plutôt qu’un zéro trompeur)', () => {
    const days = grid('2026-01-01', 40);
    expect(replayBenchmark({ asset: 'btc', flows: [], prices: [], days })).toBeNull();
  });

  it('un apport unique au départ : TWR et XIRR du repère suivent le prix', () => {
    const days = grid('2025-01-01', 366);
    const prices = ramp(days, '100', '110');
    const flows: TwrFlow[] = [{ at: `${days[1]!}T00:00:00`, amountEur: D('1000') }];
    const result = replayBenchmark({ asset: 'btc', flows, prices, days });
    expect(result).not.toBeNull();
    if (!result || !result.twr.ok || !result.xirr.ok) throw new Error('repère non calculable');
    // Le prix passe de 100,0273… (jour 1) à 110 : ~+9,97 % sur 365 jours.
    const expected = 110 / Number(prices[1]!.priceEur.toString()) - 1;
    expect(Number(result.twr.cumulative.toString())).toBeCloseTo(expected, 3);
    expect(Number(result.xirr.rate.toString())).toBeCloseTo(expected, 2);
  });

  it('toBenchmarkPrices : trie, convertit et écarte les prix nuls', () => {
    const points = toBenchmarkPrices([
      { day: '2026-01-03', priceEur: '30' },
      { day: '2026-01-01', priceEur: '10' },
      { day: '2026-01-02', priceEur: '0' },
    ]);
    expect(points.map((p) => p.day)).toEqual(['2026-01-01', '2026-01-03']);
    expect(points[0]!.priceEur.toString()).toBe('10');
  });
});
