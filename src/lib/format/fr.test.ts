import { describe, expect, it } from 'vitest';
import { D } from '../domain/money';
import { fmtDateTime, fmtEur, fmtPct, fmtPrice, fmtQty, fmtRelative } from './fr';

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('format fr-FR', () => {
  it('euros', () => {
    expect(nbsp(fmtEur(D('-803.21'), { sign: true }))).toBe('−803,21 €');
    expect(nbsp(fmtEur(D('6605.93')))).toBe('6 605,93 €');
    expect(nbsp(fmtEur(D('123456.78'), { compact: true }))).toBe('123 457 €');
    expect(fmtEur(null)).toBe('—');
  });
  it('pourcentages et prix', () => {
    expect(nbsp(fmtPct(D('-0.1084')))).toBe('−10,8 %');
    expect(nbsp(fmtPct(D('0.125')))).toBe('+12,5 %');
    expect(nbsp(fmtPrice(D('86234.02')))).toBe('86 234,02 €');
    expect(nbsp(fmtPrice(D('0.000003886')))).toBe('0,000003886 €');
    expect(nbsp(fmtPrice(D('0.8747')))).toBe('0,8747 €');
  });
  it('quantités', () => {
    expect(nbsp(fmtQty(D('0.100319')))).toBe('0,100319');
    expect(nbsp(fmtQty(D('110000000'), { abbreviate: true }))).toBe('110 M');
    expect(nbsp(fmtQty(D('7.999999667')))).toBe('7,999999667');
    expect(nbsp(fmtQty(D('-0.1'), { sign: true }))).toBe('−0,1');
  });
  it('dates', () => {
    expect(fmtDateTime('2026-06-24T18:55:00')).toBe('24/06/2026 · 18:55');
    expect(fmtRelative('2026-08-22T10:00:00Z', Date.parse('2026-08-22T10:02:30Z'))).toBe(
      'il y a 3 min',
    );
    expect(fmtRelative('2026-08-20T10:00:00Z', Date.parse('2026-08-22T10:02:30Z'))).toBe(
      'il y a 2 j',
    );
  });
});

describe('devise d’affichage', () => {
  it('formate en dollars avec le symbole étroit', async () => {
    const { fmtMoney, fmtPrice: price } = await import('./fr');
    expect(nbsp(fmtMoney(D('1234.5'), 'USD'))).toBe('1 234,50 $');
    expect(nbsp(fmtMoney(D('-5'), 'USD', { sign: true }))).toBe('−5,00 $');
    expect(nbsp(price(D('0.8747'), 'USD'))).toBe('0,8747 $');
    expect(nbsp(fmtMoney(D('12'), 'EUR'))).toBe('12,00 €');
  });
});
