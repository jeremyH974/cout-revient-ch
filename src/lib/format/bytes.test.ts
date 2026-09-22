import { describe, expect, it } from 'vitest';
import { fmtBytes } from './bytes';

/** Espace fine insécable (U+202F) : le séparateur de milliers que rend Intl fr-FR. */
const NNBSP = ' ';

describe('fmtBytes', () => {
  it('formate en octets sous 1024, sans décimale', () => {
    expect(fmtBytes(0)).toBe('0 octets');
    expect(fmtBytes(512)).toBe('512 octets');
    expect(fmtBytes(1023)).toBe(`1${NNBSP}023 octets`);
  });

  it('bascule de Ko à To à chaque puissance de 1024', () => {
    expect(fmtBytes(1024)).toBe('1 Ko');
    expect(fmtBytes(1024 * 1024)).toBe('1 Mo');
    expect(fmtBytes(1024 * 1024 * 1024)).toBe('1 Go');
    expect(fmtBytes(1024 ** 4)).toBe('1 To');
  });

  it('ne dépasse jamais To, même au-delà', () => {
    expect(fmtBytes(1024 ** 5)).toBe(`1${NNBSP}024 To`);
  });

  it('deux décimales sous 100 unités', () => {
    expect(fmtBytes(1.5 * 1024)).toBe('1,5 Ko');
    expect(fmtBytes(1.5 * 1024 * 1024)).toBe('1,5 Mo');
  });

  it('aucune décimale à 100 unités ou au-delà', () => {
    expect(fmtBytes(150 * 1024 * 1024)).toBe('150 Mo');
  });

  it('rejette une valeur négative ou non finie', () => {
    expect(fmtBytes(-1)).toBe('—');
    expect(fmtBytes(Number.NaN)).toBe('—');
    expect(fmtBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
