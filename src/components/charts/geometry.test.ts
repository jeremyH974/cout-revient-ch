import { describe, expect, it } from 'vitest';
import { eachDay } from '$lib/history/days';
import { layoutX, markerIndex, nearestIndex, niceTicks, segmentsOf, tickIndices } from './geometry';

describe('abscisses proportionnelles au temps', () => {
  it('un jour omis devient un trou, l’écart reste proportionnel (92 jours = 92 px)', () => {
    // Position vendue le 28/02, rachetée le 31/05 : « Latent % » omet les 92 jours sans coût.
    const days = ['2026-02-27', '2026-02-28', '2026-05-31', '2026-06-01'];
    const { xs, holeBefore } = layoutX(days, 0, 94);
    expect(xs).toEqual([0, 1, 93, 94]);
    expect(holeBefore).toEqual([false, false, true, false]);
  });

  it('grille intraday régulière : aucun trou ; instants identiques : repli sur l’index', () => {
    const at = (m: number): string => new Date(Date.UTC(2026, 7, 22, 10, m)).toISOString();
    const regular = layoutX([at(0), at(15), at(30), at(45)], 10, 70);
    expect(regular.xs).toEqual([10, 30, 50, 70]);
    expect(regular.holeBefore.some(Boolean)).toBe(false);
    const gap = layoutX([at(0), at(15), at(45)], 0, 45);
    expect(gap.holeBefore).toEqual([false, false, true]);
    expect(layoutX(['2026-01-01', '2026-01-01'], 0, 10).xs).toEqual([0, 10]);
    expect(layoutX([], 0, 10)).toEqual({ xs: [], holeBefore: [] });
  });

  it('segments : contigus, avec référence, sans trou, au moins deux points', () => {
    const holes = [false, false, true, false, false, false];
    const ref = (i: number): boolean => i !== 4;
    expect(segmentsOf(6, holes, ref)).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ]);
    expect(segmentsOf(6, holes, () => true)).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 5 },
    ]);
    expect(segmentsOf(3, [false, false, false], (i) => i === 1)).toEqual([]);
  });
});

describe('graduations, survol et marqueurs', () => {
  const xs = eachDay('2026-08-01', '2026-08-31').map((_, i) => 10 + i * 10);

  it('tickIndices : positions équiréparties ramenées aux points, sans doublon', () => {
    expect(tickIndices(xs, 4)).toEqual([0, 10, 20, 30]);
    expect(tickIndices(xs, 2)).toEqual([0, 30]);
    expect(tickIndices([5], 3)).toEqual([0]);
    expect(tickIndices([], 3)).toEqual([]);
  });

  it('nearestIndex : point le plus proche, bornes incluses', () => {
    expect(nearestIndex(xs, -100)).toBe(0);
    expect(nearestIndex(xs, 1000)).toBe(30);
    expect(nearestIndex(xs, 24)).toBe(1);
    expect(nearestIndex(xs, 26)).toBe(2);
    expect(nearestIndex([], 3)).toBe(-1);
  });

  it('markerIndex : jour exact uniquement, −1 hors fenêtre ou jour omis', () => {
    const days = eachDay('2026-07-23', '2026-08-22');
    expect(markerIndex(days, '2026-08-10')).toBe(18);
    expect(markerIndex(days, '2025-03-01')).toBe(-1); // achat antérieur à la fenêtre
    expect(markerIndex(['2026-08-01', '2026-08-03'], '2026-08-02')).toBe(-1);
  });

  it('niceTicks : multiples ronds couvrant la plage', () => {
    expect(niceTicks(0, 100, 3)).toEqual([0, 50, 100]);
    expect(niceTicks(-12, 37, 3)).toEqual([0, 20]);
    expect(niceTicks(1234, 5678, 3)).toEqual([2000, 4000]);
    expect(niceTicks(5, 5, 3)).toEqual([]);
  });
});
