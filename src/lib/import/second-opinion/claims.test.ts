import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCsvText } from '../csv';
import { parseAmount, parseClaimDate, readSecondOpinionClaims } from './claims';
import { detectSecondOpinion } from './detect';

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../../tests/fixtures/second-opinion/${name}`, import.meta.url)),
    'utf8',
  );

const readFixture = (name: string) => {
  const table = parseCsvText(fixture(name));
  return readSecondOpinionClaims(table, detectSecondOpinion(table.header));
};

describe('parseAmount', () => {
  it('lit un montant à la française', () => {
    expect(parseAmount('1 234,56')).toBe('1234.56');
    expect(parseAmount('2 990,00 €')).toBe('2990.00');
    expect(parseAmount('-12,5')).toBe('-12.5');
  });

  it('lit un montant à l’anglaise', () => {
    expect(parseAmount('1,234.56')).toBe('1234.56');
    expect(parseAmount('1234.56')).toBe('1234.56');
  });

  it('quand les deux séparateurs sont présents, le DERNIER est le décimal', () => {
    expect(parseAmount('1.234,56')).toBe('1234.56');
    expect(parseAmount('1,234.56')).toBe('1234.56');
  });

  it('des séparateurs de milliers répétés ne sont pas des décimales', () => {
    expect(parseAmount('1,234,567')).toBe('1234567');
    expect(parseAmount('1.234.567')).toBe('1234567');
  });

  it('lit une parenthèse comptable comme un signe négatif', () => {
    expect(parseAmount('(1 234,56)')).toBe('-1234.56');
  });

  it('renonce plutôt que d’approcher', () => {
    expect(parseAmount('environ 1000')).toBeNull();
    expect(parseAmount('n/a')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('1,2,3.4.5')).toBeNull();
  });

  it('ne produit jamais un zéro signé', () => {
    expect(parseAmount('(0,00)')).toBe('0.00');
  });
});

describe('parseClaimDate', () => {
  it('lit une date française et une date ISO', () => {
    expect(parseClaimDate('15/03/2026')).toBe('2026-03-15T00:00:00');
    expect(parseClaimDate('2026-03-15')).toBe('2026-03-15T00:00:00');
    expect(parseClaimDate('15/03/2026 14:30')).toBe('2026-03-15T14:30:00');
  });

  it('renonce sur une forme inconnue plutôt que de deviner', () => {
    expect(parseClaimDate('mars 2026')).toBeNull();
    expect(parseClaimDate('15/13/2026')).toBeNull();
    expect(parseClaimDate('')).toBeNull();
  });
});

describe('lecture d’une annexe 2086', () => {
  it('produit quatre réclamations par cession, datées', () => {
    const read = readFixture('2086-concordant.csv');
    expect(read.claims).toHaveLength(8);
    expect(read.declaredMethod).toBe('fr-global');
    expect(read.period).toEqual({ from: '2026-03-15T00:00:00', to: '2026-07-20T00:00:00' });
    const first = read.claims.filter((c) => c.at === '2026-03-15T00:00:00');
    expect(Object.fromEntries(first.map((c) => [c.metric, c.value]))).toEqual({
      'tax-global-value': '12000.00',
      'tax-proceeds': '2990.00',
      'tax-acquisition': '8000.00',
      'tax-gain': '996.67',
    });
  });

  it('retient le prix de cession NET des frais (case 215), pas le brut (case 213)', () => {
    const read = readFixture('2086-concordant.csv');
    const proceeds = read.claims.find((c) => c.metric === 'tax-proceeds');
    expect(proceeds?.value).toBe('2990.00');
  });

  it('conserve le verbatim de la ligne comme preuve', () => {
    const read = readFixture('2086-concordant.csv');
    expect(read.claims[0]!.verbatim).toContain('15/03/2026');
    expect(read.claims[0]!.line).toBe(2);
  });

  it('lit aussi le fichier en libellés français, séparateur point-virgule', () => {
    const read = readFixture('2086-libelles.csv');
    expect(read.claims).toHaveLength(4);
    expect(read.claims.every((c) => c.at === '2026-03-15T00:00:00')).toBe(true);
  });

  it('n’invente AUCUNE conversion : une devise non gérée devient une réclamation non comparable', () => {
    const read = readFixture('2086-devise-etrangere.csv');
    expect(read.claims).toHaveLength(1);
    expect(read.claims[0]).toMatchObject({
      metric: 'tax-proceeds',
      value: null,
      currency: 'USD',
      issue: 'currency-not-eur',
    });
  });

  it('une case absente devient une réclamation absente, jamais un zéro', () => {
    const table = parseCsvText('211,215\n15/03/2026,"2 990,00"\n');
    const read = readSecondOpinionClaims(table, detectSecondOpinion(table.header));
    expect(read.claims.map((c) => c.metric)).toEqual(['tax-proceeds']);
  });

  it('une ligne sans date lisible est signalée et ne produit rien', () => {
    const table = parseCsvText('211,215\nTOTAL,"4 485,00"\n15/03/2026,"2 990,00"\n');
    const read = readSecondOpinionClaims(table, detectSecondOpinion(table.header));
    expect(read.unreadableDates).toEqual([2]);
    expect(read.claims).toHaveLength(1);
  });

  it('une détection en échec ne produit rien : pas de « lecture au mieux »', () => {
    const table = parseCsvText('Colonne A,Colonne B\n1,2\n');
    const read = readSecondOpinionClaims(table, detectSecondOpinion(table.header));
    expect(read).toEqual({
      claims: [],
      period: null,
      declaredMethod: 'unknown',
      unreadableDates: [],
    });
  });
});
