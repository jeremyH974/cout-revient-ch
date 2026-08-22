import { describe, expect, it } from 'vitest';
import {
  Big,
  D,
  ZERO,
  compare,
  divOrNull,
  isDecimalString,
  parseDecimal,
  sum,
  toDecimalString,
} from './money';

describe('money', () => {
  it('conserve 21 décimales sans perte ni exposant', () => {
    const raw = '-201.71080314913473332';
    expect(toDecimalString(D(raw))).toBe(raw);
    expect(toDecimalString(D('0.000003886'))).toBe('0.000003886');
    expect(toDecimalString(D('110000000.0'))).toBe('110000000');
    expect(toDecimalString(D('0.000003886').times('110000000'))).toBe('427.46');
  });

  it('refuse les nombres flottants en entrée (mode strict)', () => {
    expect(() => new Big(0.1 as unknown as string)).toThrow();
  });

  it('valide le format décimal canonique', () => {
    expect(isDecimalString('12.5')).toBe(true);
    expect(isDecimalString('-0.5')).toBe(true);
    expect(isDecimalString('1,5')).toBe(false);
    expect(isDecimalString('1e-7')).toBe(false);
    expect(isDecimalString('')).toBe(false);
    expect(parseDecimal(' 42.0 ')?.toString()).toBe('42');
    expect(parseDecimal('abc')).toBeNull();
  });

  it('somme et divise exactement', () => {
    expect(toDecimalString(sum([D('0.1'), D('0.2')]))).toBe('0.3');
    expect(divOrNull(D('1'), ZERO)).toBeNull();
    expect(compare(D('2'), D('10'))).toBe(-1);
  });

  it('ferme exactement une position (coût × q ÷ q)', () => {
    const costBasis = D('4383.608493286407');
    const qty = D('0.0827073');
    expect(toDecimalString(costBasis.times(qty).div(qty))).toBe('4383.608493286407');
  });
});
