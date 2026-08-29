import { describe, expect, it } from 'vitest';
import { firstCommonDay, overlayGeometry, rebase } from './overlay';
import { shiftDay, type DayValue } from './stats';

const daily = (from: string, values: readonly number[]): DayValue[] =>
  values.map((value, index) => ({ day: shiftDay(from, index), value }));

describe('rebasage', () => {
  it('ramène la série à 100 à son premier point utile', () => {
    const rebased = rebase(daily('2026-01-01', [50, 55, 45]), '2026-01-01');
    // Comparaison approchée : 55 / 50 × 100 vaut 110,00000000000001 en flottant, et arrondir dans
    // le module masquerait cette réalité au lieu de la laisser au formatage de l'écran.
    expect(rebased.map((p) => p.value)).toEqual([
      expect.closeTo(100, 10),
      expect.closeTo(110, 10),
      expect.closeTo(90, 10),
    ]);
  });

  it('rebase au premier jour disponible à partir de la date demandée', () => {
    const rebased = rebase(daily('2026-01-01', [50, 55, 45]), '2026-01-02');
    expect(rebased.map((p) => p.day)).toEqual(['2026-01-02', '2026-01-03']);
    expect(rebased[0]?.value).toBe(100);
  });

  it('refuse une base nulle ou négative plutôt que de produire des valeurs sans sens', () => {
    expect(rebase(daily('2026-01-01', [0, 5]), '2026-01-01')).toEqual([]);
    expect(rebase(daily('2026-01-01', [-3, 5]), '2026-01-01')).toEqual([]);
    expect(rebase([], '2026-01-01')).toEqual([]);
  });
});

describe('premier jour commun', () => {
  it('trouve la première date que les deux séries partagent', () => {
    const a = daily('2026-01-01', [1, 2, 3, 4]);
    const b: DayValue[] = [
      { day: '2026-01-03', value: 9 },
      { day: '2026-01-04', value: 9 },
    ];
    expect(firstCommonDay(a, b)).toBe('2026-01-03');
  });

  it('rend null sans recouvrement', () => {
    expect(firstCommonDay(daily('2026-01-01', [1]), daily('2027-01-01', [1]))).toBeNull();
  });
});

describe('géométrie de superposition', () => {
  const a = daily('2026-01-01', [100, 110, 120]);
  const b = daily('2026-01-01', [100, 90, 80]);

  it('trace les deux séries sur une seule échelle', () => {
    const geometry = overlayGeometry(a, b, 100, 40)!;
    expect(geometry.min).toBe(80);
    expect(geometry.max).toBe(120);
    // Les deux courbes partent du même point : c'est tout l'intérêt du rebasage.
    expect(geometry.paths[0].startsWith('M0.0 20.0')).toBe(true);
    expect(geometry.paths[1].startsWith('M0.0 20.0')).toBe(true);
  });

  it('place la base 100 au bon endroit', () => {
    const geometry = overlayGeometry(a, b, 100, 40)!;
    expect(geometry.baseY).toBeCloseTo(20, 6);
  });

  it('projette l’abscisse sur le temps, pas sur l’index', () => {
    // La seconde série n'a que deux points, aux extrémités : ils doivent tomber en 0 et en 100,
    // pas en 0 et 50 comme le ferait une projection par index.
    const sparse: DayValue[] = [
      { day: '2026-01-01', value: 100 },
      { day: '2026-01-03', value: 100 },
    ];
    const geometry = overlayGeometry(a, sparse, 100, 40)!;
    expect(geometry.paths[1]).toContain('M0.0');
    expect(geometry.paths[1]).toContain('L100.0');
  });

  it('annonce l’intervalle réellement tracé', () => {
    const geometry = overlayGeometry(a, b, 100, 40)!;
    expect(geometry.from).toBe('2026-01-01');
    expect(geometry.to).toBe('2026-01-03');
  });

  it('ne trace rien quand une série est trop courte', () => {
    expect(overlayGeometry(a, [{ day: '2026-01-01', value: 1 }], 100, 40)).toBeNull();
    expect(overlayGeometry([], b, 100, 40)).toBeNull();
  });

  it('ne s’effondre pas sur deux séries parfaitement plates', () => {
    const flat = daily('2026-01-01', [100, 100, 100]);
    const geometry = overlayGeometry(flat, flat, 100, 40)!;
    expect(Number.isFinite(geometry.baseY)).toBe(true);
    expect(geometry.paths[0]).toContain('M');
  });

  it('inclut toujours la base dans l’échelle, même si les deux courbes montent', () => {
    const up1 = daily('2026-01-01', [100, 150, 200]);
    const up2 = daily('2026-01-01', [100, 120, 140]);
    const geometry = overlayGeometry(up1, up2, 100, 40)!;
    expect(geometry.min).toBe(100);
    expect(geometry.baseY).toBeCloseTo(40, 6);
  });
});
