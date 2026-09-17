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

/** Les réclamations d'une date, grandeur par grandeur. */
const claimsOn = (read: ReturnType<typeof readFixture>, at: string) =>
  Object.fromEntries(read.claims.filter((c) => c.at === at).map((c) => [c.metric, c.value]));

describe('lecture d’une annexe 2086', () => {
  it('produit quatre réclamations par cession, datées', () => {
    const read = readFixture('2086-concordant.csv');
    expect(read.claims).toHaveLength(8);
    expect(read.declaredMethod).toBe('fr-global');
    expect(read.period).toEqual({ from: '2026-03-15T00:00:00', to: '2026-07-20T00:00:00' });
    expect(claimsOn(read, '2026-03-15T00:00:00')).toEqual({
      'tax-global-value': '12000.00',
      'tax-proceeds': '2990.00',
      'tax-acquisition': '8000.00',
      'tax-gain': '990.00',
    });
  });

  it('compare les lignes qui désignent nos montants : le prix net (218) et le prix d’acquisition net (223)', () => {
    // Deuxième cession : 2 000 € de prix d'acquisition ont déjà été imputés. Le brut (l. 220) reste
    // à 8 000 € ; le net (l. 223), qui est notre `ptaBefore`, est à 6 000 €.
    const read = readFixture('2086-concordant.csv');
    expect(claimsOn(read, '2026-07-20T00:00:00')).toEqual({
      'tax-global-value': '9500.00',
      'tax-proceeds': '1495.00',
      'tax-acquisition': '6000.00',
      'tax-gain': '547.63',
    });
  });

  it('les libellés du formulaire se lisent comme ses numéros', () => {
    expect(claimsOn(readFixture('2086-libelles.csv'), '2026-03-15T00:00:00')).toEqual(
      claimsOn(readFixture('2086-concordant.csv'), '2026-03-15T00:00:00'),
    );
  });

  it('une ligne brute ne sert qu’à défaut, dans un fichier qui ne distingue pas le brut du net', () => {
    const metrics = (csv: string) => {
      const table = parseCsvText(csv);
      return readSecondOpinionClaims(table, detectSecondOpinion(table.header)).claims.map(
        (c) => `${c.metric}=${c.value}`,
      );
    };
    // Sans colonne de frais ni de fractions imputées, le prix et le prix d'acquisition se lisent tels
    // quels : c'est la forme de notre propre export.
    expect(metrics('211,213,220\n15/03/2026,2990,8000\n')).toEqual([
      'tax-proceeds=2990',
      'tax-acquisition=8000',
    ]);
    // Une colonne de frais dit que le 213 est brut ; une colonne de fractions, que le 220 l'est.
    // Aucun des deux n'est alors comparé à notre net.
    expect(metrics('211,213,214\n15/03/2026,3000,10\n')).toEqual([]);
    expect(metrics('211,220,221,224\n20/07/2026,8000,2000,547.63\n')).toEqual(['tax-gain=547.63']);
    // Et une cellule nette vide ne rouvre pas le repli : c'est l'en-tête qui décide, pas la ligne.
    expect(metrics('211,213,215\n15/03/2026,3000,\n')).toEqual([]);
  });

  it('conserve le verbatim de la ligne comme preuve', () => {
    const read = readFixture('2086-concordant.csv');
    expect(read.claims[0]!.verbatim).toContain('15/03/2026');
    expect(read.claims[0]!.line).toBe(2);
  });

  it('lit aussi le fichier en libellés du formulaire, séparateur point-virgule', () => {
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
