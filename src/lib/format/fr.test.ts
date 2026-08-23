import { describe, expect, it } from 'vitest';
import { D, ZERO } from '../domain/money';
import {
  fmtDateTime,
  fmtEur,
  fmtMasked,
  fmtMoney,
  fmtPct,
  fmtPrice,
  fmtQty,
  fmtRelative,
  localDay,
  roundsToZero,
} from './fr';

/** Espaces insécables d'Intl (U+00A0, U+202F) → espace simple, sans caractère invisible dans la source. */
const SPACES = new RegExp('[' + String.fromCharCode(0xa0, 0x202f) + ']', 'g');
const nbsp = (s: string): string => s.replace(SPACES, ' ');

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
  it('formate en dollars avec le symbole étroit', () => {
    expect(nbsp(fmtMoney(D('1234.5'), 'USD'))).toBe('1 234,50 $');
    expect(nbsp(fmtMoney(D('-5'), 'USD', { sign: true }))).toBe('−5,00 $');
    expect(nbsp(fmtPrice(D('0.8747'), 'USD'))).toBe('0,8747 $');
    expect(nbsp(fmtMoney(D('12'), 'EUR'))).toBe('12,00 €');
  });
});

describe('un seul arrondi, à la précision affichée', () => {
  it('pourcentage : 3 décimales du ratio, pas 4 puis 3', () => {
    expect(nbsp(fmtPct(D('0.12345')))).toBe('+12,3 %');
    expect(nbsp(fmtPct(D('0.00049')))).toBe('0,0 %');
    expect(nbsp(fmtPct(D('0.0005')))).toBe('+0,1 %');
  });
  it('montant compact : 0 décimale directement, pas 2 puis 0', () => {
    expect(nbsp(fmtEur(D('123456.495'), { compact: true }))).toBe('123 456 €');
    expect(nbsp(fmtEur(D('123456.5'), { compact: true }))).toBe('123 457 €');
    expect(nbsp(fmtEur(D('99999.999'), { compact: true }))).toBe('100 000,00 €');
  });
});

describe('zéro affiché : ni signe ni couleur', () => {
  it('une valeur qui s’arrondit à zéro n’est ni négative ni positive', () => {
    expect(nbsp(fmtEur(D('-0.004'), { sign: true }))).toBe('0,00 €');
    expect(nbsp(fmtEur(ZERO, { sign: true }))).toBe('0,00 €');
    expect(nbsp(fmtEur(D('-0.005'), { sign: true }))).toBe('−0,01 €');
    expect(nbsp(fmtPct(D('-0.0004')))).toBe('0,0 %');
    expect(nbsp(fmtPct(ZERO))).toBe('0,0 %');
    expect(nbsp(fmtQty(D('-0.0000000004'), { sign: true }))).toBe('0');
  });
  it('roundsToZero suit la précision affichée', () => {
    expect(roundsToZero(D('-0.004'))).toBe(true);
    expect(roundsToZero(D('0.005'))).toBe(false);
    expect(roundsToZero(D('0.0004'), 3)).toBe(true);
    expect(roundsToZero(null)).toBe(true);
  });
});

describe('quantités exactes', () => {
  it('ne perd pas le 17e chiffre significatif', () => {
    expect(nbsp(fmtQty(D('123456789.123456789')))).toBe('123 456 789,123456789');
    expect(nbsp(fmtQty(D('1000')))).toBe('1 000');
    expect(nbsp(fmtQty(D('0.1234567894')))).toBe('0,123456789');
  });
});

describe('jour local et masque', () => {
  it('localDay suit le fuseau de la machine, pas UTC', () => {
    const ms = Date.UTC(2026, 7, 22, 23, 30);
    const d = new Date(ms);
    const pad = (n: number): string => String(n).padStart(2, '0');
    expect(localDay(ms)).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    expect(localDay(ms)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('fmtMasked', () => {
    expect(nbsp(fmtMasked('EUR'))).toBe('•••• €');
    expect(nbsp(fmtMasked('USD'))).toBe('•••• $');
    expect(fmtMasked()).toBe('••••');
  });
});
