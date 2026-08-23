/** Formateurs ajoutés dans `src/lib/format/fr.ts` pour la carte « Évolution ». */
import { describe, expect, it } from 'vitest';
import { D } from '$lib/domain/money';
import { fmtPoints } from '$lib/format/fr';

describe('fmtPoints', () => {
  it('écart de pourcentage en points, une décimale, signe après arrondi', () => {
    expect(fmtPoints(D('0.123'))).toBe('+12,3 pts');
    expect(fmtPoints('-0.05')).toBe('−5,0 pts');
    expect(fmtPoints('0.00004')).toBe('0,0 pts');
    expect(fmtPoints(D('0.5'), { sign: false })).toBe('50,0 pts');
    expect(fmtPoints(null)).toBe('—');
  });
});
