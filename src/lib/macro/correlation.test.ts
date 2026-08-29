import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  WINDOWS,
  alignOnCommonDays,
  changesOf,
  correlate,
  correlationsOver,
  pearson,
  ranksOf,
  spanInDays,
  spearman,
} from './correlation';
import { shiftDay, type DayValue } from './stats';

const daily = (from: string, values: readonly number[]): DayValue[] =>
  values.map((value, index) => ({ day: shiftDay(from, index), value }));

describe('alignement', () => {
  it('ne garde que les jours communs et compte ceux qu’il écarte', () => {
    const asset = daily('2026-01-01', [1, 2, 3, 4, 5]); // cote tous les jours
    const macro: DayValue[] = [
      { day: '2026-01-01', value: 10 },
      { day: '2026-01-03', value: 30 },
      { day: '2026-01-05', value: 50 },
    ];
    const aligned = alignOnCommonDays(asset, macro);
    expect(aligned.days).toEqual(['2026-01-01', '2026-01-03', '2026-01-05']);
    expect(aligned.asset).toEqual([1, 3, 5]);
    expect(aligned.macro).toEqual([10, 30, 50]);
    // Les 2 et 4 janvier sont écartés : la crypto cotait, pas l'indicateur.
    expect(aligned.assetDaysDropped).toBe(2);
  });

  it('rend un alignement vide sans jour commun', () => {
    const aligned = alignOnCommonDays(daily('2026-01-01', [1, 2]), daily('2027-01-01', [1, 2]));
    expect(aligned.days).toEqual([]);
    expect(aligned.assetDaysDropped).toBe(2);
  });
});

describe('variations', () => {
  it('prend le rendement logarithmique de l’actif et la différence de l’indicateur', () => {
    const changes = changesOf(
      alignOnCommonDays(daily('2026-01-01', [100, 110]), daily('2026-01-01', [4.5, 4.6])),
    );
    expect(changes.asset[0]).toBeCloseTo(Math.log(1.1), 12);
    expect(changes.macro[0]).toBeCloseTo(0.1, 12);
  });

  it('enjambe un week-end des deux côtés à la fois', () => {
    // L'alignement précède la différenciation : le rendement du lundi couvre trois jours pour
    // l'actif comme pour l'indicateur, jamais un jour d'un côté et trois de l'autre.
    const asset = daily('2026-01-01', [100, 101, 102, 103, 104]);
    const macro: DayValue[] = [
      { day: '2026-01-01', value: 1 },
      { day: '2026-01-05', value: 5 },
    ];
    const changes = changesOf(alignOnCommonDays(asset, macro));
    expect(changes.days).toEqual(['2026-01-05']);
    expect(changes.macro[0]).toBe(4);
    expect(changes.asset[0]).toBeCloseTo(Math.log(104 / 100), 12);
  });

  it('ignore un prix nul plutôt que de rendre un infini', () => {
    const changes = changesOf(
      alignOnCommonDays(daily('2026-01-01', [100, 0, 50]), daily('2026-01-01', [1, 2, 3])),
    );
    expect(changes.asset.every(Number.isFinite)).toBe(true);
  });
});

describe('rangs', () => {
  it('donne aux ex æquo la moyenne de leurs rangs', () => {
    expect(ranksOf([10, 20, 30])).toEqual([1, 2, 3]);
    expect(ranksOf([10, 10, 30])).toEqual([1.5, 1.5, 3]);
    expect(ranksOf([5, 5, 5, 5])).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect(ranksOf([30, 10, 20])).toEqual([3, 1, 2]);
  });
});

describe('coefficients', () => {
  it('vaut 1 sur une relation croissante parfaite, −1 sur l’inverse', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(pearson(x, x)).toBeCloseTo(1, 12);
    expect(pearson(x, [...x].reverse())).toBeCloseTo(-1, 12);
    expect(spearman(x, [...x].reverse())).toBeCloseTo(-1, 12);
  });

  it('Spearman voit une relation monotone que Pearson sous-estime', () => {
    // Croissance exponentielle : monotone, mais loin d'être linéaire.
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    const y = x.map((v) => Math.exp(v));
    expect(spearman(x, y)).toBeCloseTo(1, 12);
    expect(pearson(x, y)!).toBeLessThan(0.9);
  });

  it('Spearman résiste à une valeur extrême, Pearson non', () => {
    // Sept points sans lien, plus un krach qui aligne les deux séries.
    const x = [0.1, -0.2, 0.3, -0.1, 0.2, -0.3, 0.1, -40];
    const y = [-0.2, 0.1, -0.3, 0.2, -0.1, 0.3, -0.2, -40];
    expect(Math.abs(pearson(x, y)!)).toBeGreaterThan(0.9);
    expect(Math.abs(spearman(x, y)!)).toBeLessThan(0.6);
  });

  it('refuse une série constante plutôt que de diviser par zéro', () => {
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
    expect(spearman([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });

  it('refuse un échantillon trop petit', () => {
    expect(pearson([1, 2], [2, 4])).toBeNull();
    expect(pearson([], [])).toBeNull();
  });

  it('reste dans [−1, 1] quoi qu’on lui donne', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1e5, max: 1e5, noNaN: true }), { minLength: 3, maxLength: 120 }),
        fc.array(fc.double({ min: -1e5, max: 1e5, noNaN: true }), { minLength: 3, maxLength: 120 }),
        (x, y) => {
          for (const value of [pearson(x, y), spearman(x, y)]) {
            if (value === null) continue;
            expect(value).toBeGreaterThanOrEqual(-1);
            expect(value).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('est symétrique', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -100, max: 100, noNaN: true }), { minLength: 5, maxLength: 60 }),
        fc.array(fc.double({ min: -100, max: 100, noNaN: true }), { minLength: 5, maxLength: 60 }),
        (x, y) => {
          const n = Math.min(x.length, y.length);
          expect(pearson(x.slice(0, n), y.slice(0, n))).toEqual(
            pearson(y.slice(0, n), x.slice(0, n)),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('fenêtres', () => {
  const days = 400;
  const asset = daily(
    '2025-01-01',
    Array.from({ length: days }, (_, i) => 100 * Math.exp(Math.sin(i / 9) / 20)),
  );
  const macro = daily(
    '2025-01-01',
    Array.from({ length: days }, (_, i) => 4 + Math.sin(i / 9) / 10),
  );

  it('rend une corrélation par fenêtre demandée, avec son effectif', () => {
    const { correlations } = correlate(asset, macro);
    expect(correlations.map((c) => c.windowDays)).toEqual([...WINDOWS]);
    for (const correlation of correlations) {
      expect(correlation.observations).toBeGreaterThanOrEqual(12);
      expect(correlation.coefficient).toBeGreaterThanOrEqual(-1);
      expect(correlation.coefficient).toBeLessThanOrEqual(1);
    }
    // Les deux séries suivent le même sinus : la corrélation doit être forte et positive.
    expect(correlations[0]!.coefficient).toBeGreaterThan(0.8);
  });

  it('omet une fenêtre trop pauvre plutôt que de rendre du bruit', () => {
    const short = correlate(asset.slice(-8), macro.slice(-8));
    expect(short.correlations).toEqual([]);
    expect(short.spread).toBeNull();
  });

  it('n’utilise que les jours de la fenêtre', () => {
    const { correlations } = correlate(asset, macro, [30]);
    // Trente jours calendaires de variations quotidiennes : trente couples, à un près.
    expect(correlations[0]!.observations).toBeLessThanOrEqual(31);
    expect(correlations[0]!.observations).toBeGreaterThanOrEqual(28);
  });

  it('mesure l’instabilité entre fenêtres, qui est l’information principale', () => {
    // Une série dont le lien s'inverse au milieu : les fenêtres doivent diverger.
    const flipping = daily(
      '2025-01-01',
      Array.from({ length: days }, (_, i) => 4 + (i < days - 60 ? 1 : -1) * (Math.sin(i / 9) / 10)),
    );
    const { spread } = correlate(asset, flipping);
    expect(spread).not.toBeNull();
    expect(spread!).toBeGreaterThan(0.5);
  });

  it('rend zéro corrélation sans jour commun', () => {
    expect(correlate(asset, daily('2020-01-01', [1, 2, 3])).correlations).toEqual([]);
  });
});

describe('couverture', () => {
  it('mesure l’étendue d’une série en jours', () => {
    expect(spanInDays(daily('2026-01-01', [1, 2, 3]))).toBe(2);
    expect(spanInDays([])).toBe(0);
  });

  it('borne l’effectif à l’historique disponible, sans le prétendre plus long', () => {
    const short = daily(
      '2026-06-01',
      Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3)),
    );
    const { correlations } = correlate(short, short, [365]);
    // Quarante jours d'historique ne peuvent pas porter une fenêtre d'un an : la fenêtre est
    // calculée sur ce qui existe, et l'effectif l'annonce plutôt que de laisser croire à un an.
    expect(correlations[0]!.observations).toBeLessThanOrEqual(40);
    expect(correlations[0]!.windowDays).toBe(365);
  });

  it('ne rend aucun coefficient quand une série ne varie pas', () => {
    // Une droite a des différences premières constantes : sa variance est nulle, et corréler
    // n'aurait aucun sens. Le module s'abstient plutôt que de diviser par zéro.
    const line = daily(
      '2026-01-01',
      Array.from({ length: 200 }, (_, i) => 100 + i),
    );
    expect(correlate(line, line).correlations).toEqual([]);
  });
});

describe('corrélations bornées', () => {
  it('ne dépasse jamais les fenêtres déclarées', () => {
    expect([...WINDOWS]).toEqual([30, 90, 180, 365]);
    const series = daily(
      '2025-01-01',
      Array.from({ length: 400 }, (_, i) => 100 + (i % 7)),
    );
    expect(
      correlationsOver(changesOf(alignOnCommonDays(series, series)), WINDOWS).length,
    ).toBeLessThanOrEqual(WINDOWS.length);
  });
});
