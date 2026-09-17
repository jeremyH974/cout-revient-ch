import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D } from '../money';
import { curveWindow, type CurvePoint } from './curve';

const H = 3_600_000;

describe('curveWindow — gain ou perte sur une fenêtre de la courbe', () => {
  it('le résultat vient de la série de P&L ; le reste de la variation d’équité est nommé à part', () => {
    // Équité de 5 000 à 12 000 : 1 500 de gain et 5 500 déposés en cours de fenêtre.
    const equity: CurvePoint[] = [
      [0, '5000'],
      [H, '5800'],
      [2 * H, '11300'],
      [3 * H, '12000'],
    ];
    const pnl: CurvePoint[] = [
      [0, '0'],
      [H, '800'],
      [2 * H, '800'],
      [3 * H, '1500'],
    ];
    const w = curveWindow(equity, pnl)!;
    expect(w.pnl.toString()).toBe('1500');
    expect(w.flows.toString()).toBe('5500');
    expect([w.startValue.toString(), w.endValue.toString()]).toEqual(['5000', '12000']);
    expect([w.from, w.to]).toEqual([0, 3 * H]);
  });

  it('une perte masquée par un dépôt reste une perte', () => {
    const w = curveWindow(
      [
        [0, '10000'],
        [H, '14000'],
      ],
      [
        [0, '0'],
        [H, '-1000'],
      ],
    )!;
    // L'équité a monté de 4 000, mais le trading a perdu 1 000 : 5 000 ont été déposés.
    expect(w.pnl.toString()).toBe('-1000');
    expect(w.flows.toString()).toBe('5000');
  });

  it('une série de P&L qui ne part pas de zéro : la différence entre ses bornes, pas son dernier point', () => {
    const w = curveWindow(
      [
        [0, '100'],
        [H, '150'],
      ],
      [
        [0, '40'],
        [H, '90'],
      ],
    )!;
    expect(w.pnl.toString()).toBe('50');
    expect(w.flows.toString()).toBe('0');
  });

  it('tolère des points dans le désordre', () => {
    const w = curveWindow(
      [
        [2 * H, '130'],
        [0, '100'],
        [H, '90'],
      ],
      [
        [H, '-10'],
        [2 * H, '30'],
        [0, '0'],
      ],
    )!;
    expect([w.startValue.toString(), w.endValue.toString(), w.pnl.toString()]).toEqual([
      '100',
      '130',
      '30',
    ]);
  });

  it('pas de bilan sans série : null, jamais un « ni gain ni perte » inventé', () => {
    expect(curveWindow([], [[0, '0']])).toBeNull();
    expect(curveWindow([[0, '100']], [])).toBeNull();
  });

  it('propriété : départ + résultat + mouvements = fin, exactement', () => {
    const point = fc.tuple(
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.integer({ min: -10_000_000, max: 10_000_000 }),
    );
    fc.assert(
      fc.property(
        fc.array(point, { minLength: 1, maxLength: 20 }),
        fc.array(point, { minLength: 1, maxLength: 20 }),
        (equity, pnl) => {
          const toSeries = (raw: [number, number][]): CurvePoint[] =>
            raw.map(([t, v]) => [t, D(String(v)).div('100').toString()]);
          const w = curveWindow(toSeries(equity), toSeries(pnl))!;
          expect(w.startValue.plus(w.pnl).plus(w.flows).eq(w.endValue)).toBe(true);
        },
      ),
    );
  });
});
