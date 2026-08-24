/**
 * `parseMoneyText` : symboles/codes devise collés ou espacés, signe en tête (avant ou après le
 * symbole), virgules de milliers valides vs. illisibles, espaces insécables, devise de repli.
 */
import { describe, expect, it } from 'vitest';
import { parseMoneyText } from './money-text';

describe('parseMoneyText', () => {
  it('symbole euro collé, sans signe', () => {
    expect(parseMoneyText('€10.77')).toEqual({ amount: '10.77', currency: 'eur', negative: false });
  });

  it('symbole euro collé avec milliers valides', () => {
    expect(parseMoneyText('€58,204.10')).toEqual({
      amount: '58204.10',
      currency: 'eur',
      negative: false,
    });
  });

  it('signe négatif avant le symbole', () => {
    expect(parseMoneyText('-€597.49')).toEqual({
      amount: '597.49',
      currency: 'eur',
      negative: true,
    });
  });

  it('signe négatif après le symbole (Coinbase)', () => {
    expect(parseMoneyText('€-597.49')).toEqual({
      amount: '597.49',
      currency: 'eur',
      negative: true,
    });
  });

  it('signe moins unicode (U+2212)', () => {
    expect(parseMoneyText('−€12.00')).toEqual({
      amount: '12.00',
      currency: 'eur',
      negative: true,
    });
  });

  it('code 3 lettres espacé en queue', () => {
    expect(parseMoneyText('40.60 EUR')).toEqual({
      amount: '40.60',
      currency: 'eur',
      negative: false,
    });
  });

  it('code 3 lettres espacé en queue avec milliers valides', () => {
    expect(parseMoneyText('1,234.56 SEK')).toEqual({
      amount: '1234.56',
      currency: 'sek',
      negative: false,
    });
  });

  it('code 3 lettres collé en tête', () => {
    expect(parseMoneyText('EUR40.60')).toEqual({
      amount: '40.60',
      currency: 'eur',
      negative: false,
    });
  });

  it('code 3 lettres collé en queue', () => {
    expect(parseMoneyText('40.60EUR')).toEqual({
      amount: '40.60',
      currency: 'eur',
      negative: false,
    });
  });

  it('sans devise ni code, repli sur fallbackCurrency', () => {
    expect(parseMoneyText('12', 'usd')).toEqual({ amount: '12', currency: 'usd', negative: false });
  });

  it('sans devise ni fallback : currency null', () => {
    expect(parseMoneyText('12')).toEqual({ amount: '12', currency: null, negative: false });
  });

  it('garbage (aucun chiffre exploitable) : null', () => {
    expect(parseMoneyText('garbage')).toBeNull();
  });

  it('virgule qui ne correspond pas à un groupement de milliers valide : null', () => {
    expect(parseMoneyText('1,23.4')).toBeNull();
    expect(parseMoneyText('12,3456')).toBeNull();
  });

  it('chaîne vide ou uniquement blanche : null', () => {
    expect(parseMoneyText('')).toBeNull();
    expect(parseMoneyText('   ')).toBeNull();
  });

  it('espace insécable fine (U+202F) entre le montant et un code devise', () => {
    expect(parseMoneyText('40.60 EUR')).toEqual({
      amount: '40.60',
      currency: 'eur',
      negative: false,
    });
  });

  it('espace insécable classique (U+00A0) entre le montant et un code devise', () => {
    expect(parseMoneyText('40.60 EUR')).toEqual({
      amount: '40.60',
      currency: 'eur',
      negative: false,
    });
  });

  it('symboles dollar et livre', () => {
    expect(parseMoneyText('$99.99')).toEqual({ amount: '99.99', currency: 'usd', negative: false });
    expect(parseMoneyText('£5.00')).toEqual({ amount: '5.00', currency: 'gbp', negative: false });
  });
});
