import { describe, expect, it } from 'vitest';
import { D } from '../domain/money';
import { fmtMoney, fmtPct, fmtPoints, fmtQty } from '../format/fr';
import {
  NARROW_NBSP,
  NBSP,
  THIN_SPACE,
  TYPOGRAPHIC_MINUS,
  extractNumbers,
  isChecked,
  type NumberToken,
} from './numbers';

const values = (text: string): string[] =>
  extractNumbers(text)
    .filter(isChecked)
    .map((t) => t.value?.toString() ?? 'null');

const only = (text: string): NumberToken => {
  const tokens = extractNumbers(text);
  expect(tokens, text).toHaveLength(1);
  const token = tokens[0];
  if (token === undefined) throw new Error('inatteignable');
  return token;
};

describe('le constat empirique sur Intl fr-FR', () => {
  // Ce test n'existe pas pour vérifier `numbers.ts` mais pour verrouiller l'HYPOTHÈSE sur
  // laquelle il est écrit : le jour où une version d'ICU changerait de séparateur, c'est ici que
  // ça doit casser, pas dans un ancrage devenu faux sans explication.
  it('groupe les milliers avec U+202F, jamais U+00A0', () => {
    const text = fmtMoney(D('1234567.89'), 'EUR');
    expect(text).toContain(NARROW_NBSP);
    expect(text.split(NARROW_NBSP)).toHaveLength(3);
  });

  it('n’emploie U+00A0 que devant le symbole monétaire et le pourcentage', () => {
    expect(fmtMoney(D('1234567.89'), 'EUR')).toContain(`${NBSP}€`);
    expect(fmtPct(D('0.123'), { sign: false })).toContain(`${NBSP}%`);
  });

  it('signe les négatifs avec le moins typographique U+2212', () => {
    expect(fmtMoney(D('-12.5'), 'EUR').startsWith(TYPOGRAPHIC_MINUS)).toBe(true);
  });

  it('groupe dès quatre chiffres — une année mise en forme ne peut pas se confondre avec 2026', () => {
    expect(fmtQty(D('2026'))).toBe(`2${NARROW_NBSP}026`);
  });
});

describe('extractNumbers — les quatre séparateurs', () => {
  it('lit les milliers en U+202F', () => {
    expect(values(`Total 1${NARROW_NBSP}234${NARROW_NBSP}567,89${NBSP}€.`)).toEqual(['1234567.89']);
  });

  it('lit les milliers en U+00A0', () => {
    expect(values(`Total 1${NBSP}234${NBSP}567,89${NBSP}€.`)).toEqual(['1234567.89']);
  });

  it('lit les milliers en U+2009 et en espace ordinaire', () => {
    expect(values(`Total 1${THIN_SPACE}234,50 €.`)).toEqual(['1234.5']);
    expect(values('Total 1 234,50 €.')).toEqual(['1234.5']);
  });

  it('ne retire un séparateur qu’entre deux chiffres', () => {
    expect(values('3 opérations et 12 lots.')).toEqual(['3', '12']);
  });
});

describe('extractNumbers — signes et parenthèses', () => {
  it('lit le moins typographique et le trait d’union', () => {
    expect(values(`Résultat ${TYPOGRAPHIC_MINUS}2${NARROW_NBSP}310,50${NBSP}€.`)).toEqual([
      '-2310.5',
    ]);
    expect(values('Résultat -2 310,50 €.')).toEqual(['-2310.5']);
  });

  it('lit la parenthèse comptable quand elle n’enferme QUE le nombre', () => {
    expect(values('Résultat (2 310,50).')).toEqual(['-2310.5']);
  });

  it('ne prend PAS pour un négatif un montant mis entre parenthèses en apposition', () => {
    // C'est exactement ce que fait `format/insights.ts` : « (18 452,90 €) ».
    expect(values(`BTC pèse 72,1${NBSP}% (18${NARROW_NBSP}452,90${NBSP}€).`)).toEqual([
      '0.721',
      '18452.9',
    ]);
  });

  it('ne prend pas un tiret de composition pour un signe', () => {
    expect(values('Période 2026-2027 hors périmètre.')).toEqual([]);
  });
});

describe('extractNumbers — unités et échelles', () => {
  it('divise un pourcentage par cent, en Big', () => {
    const token = only(`12,3${NBSP}%`);
    expect(token.kind).toBe('percent');
    expect(token.value?.toString()).toBe('0.123');
  });

  it('garde les points de pourcentage tels quels', () => {
    const token = only('+12,3 pts');
    expect(token.kind).toBe('points');
    expect(token.value?.toString()).toBe('12.3');
  });

  it('ramène les suffixes k, M et Md à l’unité, en conservant l’échelle lue', () => {
    expect(only('12,3 k€').value?.toString()).toBe('12300');
    expect(only('12,3 k€').scale).toBe('k');
    expect(only('110 M').value?.toString()).toBe('110000000');
    expect(only('1,2 Md€').value?.toString()).toBe('1200000000');
  });

  it('ne confond pas un mois avec un million ni un kilo avec un millier', () => {
    expect(only('Sur 12 mois').value?.toString()).toBe('12');
    expect(only('Sur 12 mois').scale).toBe('unit');
    expect(only('12 Mars').scale).toBe('unit');
  });

  it('classe une quantité suivie d’un code d’actif, mais une devise l’emporte', () => {
    expect(only('0,123456789 BTC').kind).toBe('quantity');
    expect(only('12 500,00 EUR').kind).toBe('money');
    expect(only('12 500,00 EUR').value?.toString()).toBe('12500');
  });
});

describe('extractNumbers — ce qui est exclu du contrôle', () => {
  it('exclut les dates, les heures et les rangs annoncés par leur mot', () => {
    const tokens = extractNumbers('Import du 24/06/2026 à 18:55, ligne 42 et ligne 118.');
    expect(tokens.map((t) => t.kind)).toEqual(['date', 'time', 'ordinal', 'ordinal']);
    for (const token of tokens) {
      expect(isChecked(token)).toBe(false);
      expect(token.value).toBeNull();
    }
  });

  it('exclut une année isolée de quatre chiffres, mais pas un montant', () => {
    expect(only('En 2026').kind).toBe('date');
    expect(only('En 1899').kind).toBe('plain');
    expect(only(`2026,00${NBSP}€`).kind).toBe('money');
    expect(only(`2${NARROW_NBSP}026`).kind).toBe('plain');
  });

  it('ignore les chiffres collés à un identifiant', () => {
    expect(values('1INCH et SHIB2 restent des tickers.')).toEqual([]);
  });
});

describe('extractNumbers — aller-retour avec le formateur du projet', () => {
  const cases: readonly [string, string][] = [
    ['0', '0'],
    ['12.5', '12.5'],
    ['-1234.56', '-1234.56'],
    ['1234567.89', '1234567.89'],
    ['123456.78', '123456.78'],
  ];

  for (const [input, expected] of cases) {
    it(`relit fmtMoney(${input})`, () => {
      expect(values(`Montant ${fmtMoney(D(input), 'EUR', { sign: true })}.`)).toEqual([expected]);
    });
  }

  it('relit fmtPct, fmtPoints et fmtQty', () => {
    expect(values(`Part ${fmtPct(D('0.7213'))}.`)).toEqual(['0.721']);
    expect(values(`Écart ${fmtPoints(D('0.123'))}.`)).toEqual(['12.3']);
    expect(values(`Quantité ${fmtQty(D('0.123456789'))} BTC.`)).toEqual(['0.123456789']);
  });
});
