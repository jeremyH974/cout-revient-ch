import { describe, expect, it } from 'vitest';
import {
  ENUM_MAX_DISTINCT,
  ENUM_MAX_RATIO,
  SHAPE_SAMPLE,
  SHAPE_THRESHOLD,
  VALUE_SHAPES,
  inferShape,
  readDecimalShape,
} from './shape';

const shapeOf = (values: readonly string[]): string => inferShape(values).shape;
const repeat = (values: readonly string[], times: number): string[] =>
  Array.from({ length: times }, (_, i) => values[i % values.length]!);

describe('lecture d’un décimal, et son séparateur', () => {
  it('distingue « 1 234,56 » de « 1,234.56 » — deux nombres différents', () => {
    expect(readDecimalShape('1 234,56')).toEqual({ ok: true, separator: ',', signed: false });
    expect(readDecimalShape('1,234.56')).toEqual({ ok: true, separator: '.', signed: false });
    expect(readDecimalShape('1.234,56')).toEqual({ ok: true, separator: ',', signed: false });
    expect(readDecimalShape('1234.56')).toEqual({ ok: true, separator: '.', signed: false });
  });

  it('rend un entier SANS séparateur : il sert les deux lectures', () => {
    expect(readDecimalShape('1234')).toEqual({ ok: true, separator: null, signed: false });
  });

  it('reconnaît le signe, en tête comme en parenthèses comptables', () => {
    expect(readDecimalShape('-12.5').signed).toBe(true);
    expect(readDecimalShape('+3.1').signed).toBe(true);
    expect(readDecimalShape('(12.5)').signed).toBe(true);
    expect(readDecimalShape('12.5').signed).toBe(false);
  });

  it('refuse ce qui n’est pas un nombre', () => {
    for (const text of ['', 'abc', '12abc', '1..2', '1,2,3.4', '--1'])
      expect(readDecimalShape(text).ok, text).toBe(false);
  });
});

describe('inférence de forme', () => {
  it('reconnaît les dates ISO, avec ou sans heure, fuseau ou millisecondes', () => {
    expect(shapeOf(['2026-03-02', '2026-04-10'])).toBe('iso-datetime');
    expect(shapeOf(['2026-03-02 09:00:00', '2026-04-10 14:30:00'])).toBe('iso-datetime');
    expect(shapeOf(['2026-03-02T09:00:00Z', '2026-04-10T14:30:00.500Z'])).toBe('iso-datetime');
  });

  it('reconnaît les dates jour/mois/année', () => {
    expect(shapeOf(['02/03/2026 09:00:00', '10/04/2026'])).toBe('dmy-datetime');
    expect(shapeOf(['02.03.2026', '10.04.2026'])).toBe('dmy-datetime');
  });

  it('sépare les époques en secondes et en millisecondes', () => {
    expect(shapeOf(['1772442000', '1775822400'])).toBe('epoch-s');
    expect(shapeOf(['1772442000000', '1775822400000'])).toBe('epoch-ms');
  });

  it('sépare les décimaux à point de ceux à virgule', () => {
    expect(shapeOf(['1234.56', '0.05', '12'])).toBe('decimal-dot');
    expect(shapeOf(['1234,56', '0,05', '12'])).toBe('decimal-comma');
    // Le groupement seul ne suffit pas à trancher : c'est le séparateur décimal qui décide.
    expect(shapeOf(['1,234.56', '9.10'])).toBe('decimal-dot');
    expect(shapeOf(['1.234,56', '9,10'])).toBe('decimal-comma');
  });

  it('classe `signed-decimal` dès qu’UNE cellule porte un signe : c’est la forme non gérée', () => {
    expect(shapeOf(['12.5', '-3.1', '4.0'])).toBe('signed-decimal');
    expect(shapeOf(['12,5', '-3,1'])).toBe('signed-decimal');
    expect(shapeOf(['(12.5)', '3.1'])).toBe('signed-decimal');
  });

  it('reconnaît un code d’actif, et refuse de prendre des types pour des tickers', () => {
    expect(shapeOf(repeat(['BTC', 'ETH', 'EUR', 'USDC'], 40))).toBe('asset-code');
    // `buy` / `sell` / `exchange` ont EXACTEMENT la forme d'un ticker : seule la table des actifs
    // connus les en distingue. Sans elle, la colonne de type d'un fichier passerait pour une
    // colonne de devise.
    expect(shapeOf(repeat(['buy', 'sell', 'exchange'], 40))).toBe('enum-small');
  });

  it('reconnaît une empreinte hexadécimale', () => {
    expect(
      shapeOf([
        '0xd3300000f1c7aa11223344556677889900aabbccddeeff00112233445566',
        'd3300000f1c7aa11223344556677889900aabbccddeeff0011223344556677',
      ]),
    ).toBe('hash-hex');
  });

  it('exige distincts ≤ 40 ET distincts/lignes ≤ 0,2 pour une énumération courte', () => {
    const few = repeat(['payé', 'en attente', 'annulé'], 40);
    expect(inferShape(few).distinct).toBe(3);
    expect(shapeOf(few)).toBe('enum-small');
    // Trop de valeurs distinctes rapportées au nombre de lignes : c'est du texte, pas une énum.
    const many = Array.from({ length: 10 }, (_, i) => `commentaire libre numéro ${i}`);
    expect(shapeOf(many)).toBe('free-text');
    // Le plafond absolu de valeurs distinctes est bien celui qui est déclaré.
    const wide = Array.from({ length: 500 }, (_, i) => `note ${i % (ENUM_MAX_DISTINCT + 1)}`);
    expect(inferShape(wide).distinct).toBeGreaterThan(ENUM_MAX_DISTINCT);
    expect(shapeOf(wide)).toBe('free-text');
  });

  it('rend `empty` pour une colonne entièrement vide', () => {
    expect(shapeOf(['', '  ', ''])).toBe('empty');
    expect(shapeOf([])).toBe('empty');
  });

  it('tolère jusqu’à 10 % de cellules aberrantes, et pas plus', () => {
    const almost = [...repeat(['2026-03-02'], 19), 'N/A'];
    expect(almost.filter((c) => c === 'N/A').length / almost.length).toBeLessThan(
      1 - SHAPE_THRESHOLD,
    );
    expect(shapeOf(almost)).toBe('iso-datetime');
    const tooMany = [...repeat(['2026-03-02'], 8), 'N/A', 'pending'];
    expect(shapeOf(tooMany)).not.toBe('iso-datetime');
  });

  it('n’examine que les cent premières lignes non vides', () => {
    const values = [...repeat(['2026-03-02'], SHAPE_SAMPLE), ...repeat(['zzz'], 500)];
    const info = inferShape(values);
    expect(info.sampled).toBe(SHAPE_SAMPLE);
    expect(info.shape).toBe('iso-datetime');
  });

  it('déclare toutes ses formes dans `VALUE_SHAPES`, sans doublon', () => {
    expect(new Set(VALUE_SHAPES).size).toBe(VALUE_SHAPES.length);
    expect(ENUM_MAX_RATIO).toBeGreaterThan(0);
  });
});
