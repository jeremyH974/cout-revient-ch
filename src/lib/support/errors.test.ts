import { describe, expect, it } from 'vitest';
import { formatErrors, recentErrors, recordError } from './errors';

describe('capture des erreurs', () => {
  it('garde message et première ligne de pile, déduplique, plafonne à 20', () => {
    recentErrors.splice(0);
    const error = new TypeError('x is not a function');
    error.stack =
      'TypeError: x is not a function\n    at run (app.js:10:5)\n    at main (app.js:1:1)';
    recordError(error, 'ui', '2026-08-23T10:00:00.000Z');
    recordError(error, 'ui', '2026-08-23T10:00:01.000Z');
    expect(recentErrors).toHaveLength(1);
    expect(recentErrors[0]).toEqual({
      at: '2026-08-23T10:00:00.000Z',
      source: 'ui',
      message: 'TypeError: x is not a function',
      stack: 'at run (app.js:10:5)',
    });
    for (let i = 0; i < 30; i++) recordError(`erreur ${i}`, 'promise', '2026-08-23T11:00:00.000Z');
    expect(recentErrors).toHaveLength(20);
    expect(recentErrors[recentErrors.length - 1]?.message).toBe('erreur 29');
  });

  it('formate un bloc lisible pour le diagnostic', () => {
    expect(formatErrors([])).toBe('Erreurs récentes : aucune');
    const text = formatErrors([
      {
        at: '2026-08-23T10:00:00.000Z',
        source: 'window',
        message: 'Boom',
        stack: 'at f (a.js:1:1)',
      },
    ]);
    expect(text).toContain('Erreurs récentes : 1');
    expect(text).toContain('[window] Boom (at f (a.js:1:1))');
  });
});
