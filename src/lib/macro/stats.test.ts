import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  annualisedVolatility,
  asOf,
  changeOver,
  daysBetween,
  fromCompact,
  logReturns,
  percentileRank,
  relativeChangeOver,
  rollingVolatility,
  shiftDay,
  since,
  toCompact,
  transformSeries,
  type DayValue,
} from './stats';

/** Série quotidienne continue à partir d'un jour donné. */
const daily = (from: string, values: readonly number[]): DayValue[] =>
  values.map((value, index) => ({ day: shiftDay(from, index), value }));

describe('rang percentile', () => {
  it('place le minimum et le maximum sans jamais toucher les bornes', () => {
    const values = [1, 2, 3, 4, 5];
    expect(percentileRank(values, 1)).toBe(10);
    expect(percentileRank(values, 5)).toBe(90);
    expect(percentileRank(values, 3)).toBe(50);
  });

  it('partage les ex æquo de part et d’autre', () => {
    // Quatre valeurs identiques : le rang moyen est 50, pas 0 ni 100.
    expect(percentileRank([7, 7, 7, 7], 7)).toBe(50);
    // Deux en dessous, deux ex æquo : 2/5 + (2/2)/5 = 60 %.
    expect(percentileRank([1, 2, 7, 7, 9], 7)).toBe(60);
  });

  it('situe une valeur hors de l’échantillon', () => {
    expect(percentileRank([1, 2, 3], 0)).toBe(0);
    expect(percentileRank([1, 2, 3], 99)).toBe(100);
  });

  it('reste défensif', () => {
    expect(Number.isNaN(percentileRank([], 1))).toBe(true);
    expect(Number.isNaN(percentileRank([1, 2], Number.NaN))).toBe(true);
    expect(percentileRank([1, Number.NaN, 3], 3)).toBe(75);
  });

  it('rend toujours un rang entre 0 et 100, et croissant avec la valeur', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 200 }),
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.double({ min: 0.01, max: 1e5, noNaN: true }),
        (values, x, gap) => {
          const rank = percentileRank(values, x);
          expect(rank).toBeGreaterThanOrEqual(0);
          expect(rank).toBeLessThanOrEqual(100);
          expect(percentileRank(values, x + gap)).toBeGreaterThanOrEqual(rank);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('lecture « à la date »', () => {
  const series = daily('2026-01-01', [10, 11, 12, 13, 14]);

  it('trouve la valeur du jour', () => {
    expect(asOf(series, '2026-01-03', 5)?.value).toBe(12);
  });

  it('remonte au dernier jour connu', () => {
    expect(asOf(series, '2026-01-06', 5)).toEqual({ day: '2026-01-05', value: 14 });
  });

  it('refuse de reporter au-delà du plafond de péremption', () => {
    // Le dernier point date du 5 ; au 20, le report aurait 15 jours.
    expect(asOf(series, '2026-01-20', 10)).toBeNull();
    expect(asOf(series, '2026-01-20', 20)?.value).toBe(14);
  });

  it('rend null avant le début de la série, et sur une série vide', () => {
    expect(asOf(series, '2025-12-31', 999)).toBeNull();
    expect(asOf([], '2026-01-01', 999)).toBeNull();
  });

  it('retrouve n’importe quel point d’une longue série', () => {
    const long = daily(
      '2020-01-01',
      Array.from({ length: 900 }, (_, i) => i),
    );
    for (const index of [0, 1, 123, 456, 899]) {
      const day = shiftDay('2020-01-01', index);
      expect(asOf(long, day, 0)?.value, day).toBe(index);
    }
  });
});

describe('variations', () => {
  const series = daily('2026-01-01', [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);

  it('mesure une variation absolue', () => {
    expect(changeOver(series, 10)).toBe(10);
  });

  it('mesure une variation relative en pourcentage', () => {
    expect(relativeChangeOver(series, 10)).toBeCloseTo(10, 10);
  });

  it('rend null quand le passé manque plutôt qu’une base fantôme', () => {
    expect(changeOver(series, 400)).toBeNull();
    expect(relativeChangeOver(series, 400)).toBeNull();
    expect(changeOver([], 30)).toBeNull();
  });

  it('refuse une base nulle', () => {
    const withZero = daily('2026-01-01', [0, 1, 2]);
    expect(relativeChangeOver(withZero, 2)).toBeNull();
  });

  it('tolère un trou dans la série sans le combler', () => {
    // Série hebdomadaire, et un décalage de 90 jours qui ne retombe pas sur un mercredi : sans
    // tolérance, il n'y a rien à cette date exacte. (91 jours ferait 13 semaines pile.)
    const weekly: DayValue[] = Array.from({ length: 20 }, (_, i) => ({
      day: shiftDay('2026-01-07', i * 7),
      value: 100 + i,
    }));
    expect(changeOver(weekly, 90, 10)).not.toBeNull();
    expect(changeOver(weekly, 90, 0)).toBeNull();
  });
});

describe('transformation de série', () => {
  it('laisse un niveau intact', () => {
    const series = daily('2026-01-01', [1, 2, 3]);
    expect(transformSeries(series, 'level')).toEqual(series);
  });

  it('ne calcule un point que si son propre passé existe', () => {
    const series = daily(
      '2025-01-01',
      Array.from({ length: 400 }, (_, i) => 100 + i),
    );
    const yoy = transformSeries(series, 'yoy');
    // Aucun point avant que 365 jours d'historique ne soient disponibles.
    expect(yoy[0]?.day).toBe(shiftDay('2025-01-01', 365));
    expect(yoy).toHaveLength(400 - 365);
  });

  it('ne regarde jamais vers l’avenir : tronquer la fin ne change pas le passé', () => {
    const series = daily(
      '2025-01-01',
      Array.from({ length: 500 }, (_, i) => 100 + Math.sin(i) * 10),
    );
    const full = transformSeries(series, 'change3m');
    const truncated = transformSeries(series.slice(0, 450), 'change3m');
    expect(full.slice(0, truncated.length)).toEqual(truncated);
  });

  it('calcule une variation annuelle en pourcentage', () => {
    const series = [
      { day: '2025-01-01', value: 100 },
      { day: '2026-01-01', value: 120 },
    ];
    const yoy = transformSeries(series, 'yoy');
    expect(yoy).toEqual([{ day: '2026-01-01', value: 20 }]);
  });
});

describe('volatilité', () => {
  it('rend les rendements logarithmiques d’une série de prix', () => {
    const returns = logReturns(daily('2026-01-01', [100, 110, 121]));
    expect(returns).toHaveLength(2);
    expect(returns[0]?.value).toBeCloseTo(Math.log(1.1), 12);
    expect(returns[1]?.value).toBeCloseTo(Math.log(1.1), 12);
  });

  it('ignore les prix nuls ou négatifs plutôt que de rendre un infini', () => {
    expect(logReturns(daily('2026-01-01', [100, 0, 50]))).toEqual([]);
  });

  it('annualise l’écart-type d’échantillon des rendements', () => {
    // Rendements alternant +1 % et −1 %, moyenne nulle. L'écart-type d'**échantillon** divise par
    // n−1 : 0,01 × √(100/99). C'est le bon choix ici — on estime la volatilité d'un processus à
    // partir d'un échantillon, on ne décrit pas une population close.
    const returns = daily(
      '2026-01-01',
      Array.from({ length: 100 }, (_, i) => (i % 2 ? 0.01 : -0.01)),
    );
    const vol = annualisedVolatility(returns, 365);
    expect(vol).toBeCloseTo(0.01 * Math.sqrt(100 / 99) * Math.sqrt(365) * 100, 6);
  });

  it('exige au moins deux observations', () => {
    expect(annualisedVolatility([], 365)).toBeNull();
    expect(annualisedVolatility(daily('2026-01-01', [0.01]), 365)).toBeNull();
  });

  it('glisse sur une fenêtre et date chaque point du dernier jour de sa fenêtre', () => {
    const returns = daily(
      '2026-01-01',
      Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.01 : -0.01)),
    );
    const rolling = rollingVolatility(returns, 30, 365);
    expect(rolling).toHaveLength(11);
    expect(rolling[0]?.day).toBe(shiftDay('2026-01-01', 29));
    expect(rolling[10]?.day).toBe(shiftDay('2026-01-01', 39));
  });
});

describe('forme compacte', () => {
  it('remplit les jours manquants avec null plutôt que de les combler', () => {
    const series: DayValue[] = [
      { day: '2026-01-01', value: 1 },
      { day: '2026-01-04', value: 4 },
    ];
    expect(toCompact(series)).toEqual({ from: '2026-01-01', values: [1, null, null, 4] });
  });

  it('gère la série vide', () => {
    expect(toCompact([])).toEqual({ from: '1970-01-01', values: [] });
    expect(fromCompact({ from: '2026-01-01', values: [] })).toEqual([]);
  });

  it('fait l’aller-retour sans rien perdre ni rien inventer', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.integer({ min: 0, max: 900 }), { minLength: 1, maxLength: 120 })
          .map((offsets) => [...offsets].sort((a, b) => a - b)),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        (offsets, seed) => {
          const series = offsets.map((offset) => ({
            day: shiftDay('2024-01-01', offset),
            value: seed + offset,
          }));
          expect(fromCompact(toCompact(series))).toEqual(series);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('utilitaires de dates', () => {
  it('compte les jours et traverse les changements d’heure sans dériver', () => {
    // Le passage à l'heure d'été européenne tombe le 29 mars 2026 : ces jours sont en UTC, donc
    // rien ne doit bouger.
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
    expect(shiftDay('2026-03-28', 3)).toBe('2026-03-31');
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('filtre depuis une date', () => {
    const series = daily('2026-01-01', [1, 2, 3, 4]);
    expect(since(series, '2026-01-03').map((p) => p.value)).toEqual([3, 4]);
  });
});
