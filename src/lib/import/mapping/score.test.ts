import { describe, expect, it } from 'vitest';
import { normalizeHeader } from './normalize';
import {
  CANDIDATE_THRESHOLD,
  COMPETITOR_PENALTY,
  CONFIRM_THRESHOLD,
  FUZZY_THRESHOLD,
  MATCH_RULES,
  RULE_CAP,
  SHAPE_CONTRADICTION,
  assign,
  bestRule,
  damerauLevenshtein,
  scorePairs,
  shapeContradicts,
  similarity,
} from './score';
import { SYNONYM_INDEX } from './synonyms';
import type { ShapeInfo, ValueShape } from './shape';

const shape = (value: ValueShape, distinct = 5): ShapeInfo => ({
  shape: value,
  distinct,
  nonEmpty: 50,
  sampled: 50,
});

const scoreOf = (
  headers: readonly string[],
  shapes: readonly ShapeInfo[],
  field: string,
): number | undefined =>
  scorePairs(
    headers.map((h) => normalizeHeader(h)),
    shapes,
  ).find((p) => p.field === field)?.confidence;

describe('distance d’édition', () => {
  it('compte les trois opérations de base', () => {
    expect(damerauLevenshtein('', '')).toBe(0);
    expect(damerauLevenshtein('abc', 'abc')).toBe(0);
    expect(damerauLevenshtein('abc', 'ab')).toBe(1); // suppression
    expect(damerauLevenshtein('ab', 'abc')).toBe(1); // insertion
    expect(damerauLevenshtein('abc', 'abd')).toBe(1); // substitution
  });

  it('compte une transposition pour UNE opération, pas deux', () => {
    expect(damerauLevenshtein('recieved', 'received')).toBe(1);
    expect(damerauLevenshtein('ca', 'ac')).toBe(1);
    // Sans transposition, la faute de frappe la plus courante coûterait le double.
    expect(damerauLevenshtein('montnat', 'montant')).toBe(1);
  });

  it('est symétrique, et vaut la longueur face au vide', () => {
    expect(damerauLevenshtein('abcd', '')).toBe(4);
    expect(damerauLevenshtein('', 'abcd')).toBe(4);
    expect(damerauLevenshtein('sent', 'cent')).toBe(damerauLevenshtein('cent', 'sent'));
  });

  it('normalise la similarité dans [0, 1]', () => {
    expect(similarity('', '')).toBe(1);
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
    expect(similarity('received amount', 'recieved amount')).toBeGreaterThan(FUZZY_THRESHOLD);
  });
});

describe('les quatre règles et leurs plafonds', () => {
  it('rend 1,00 à un en-tête pivot déjà connu', () => {
    expect(bestRule(normalizeHeader('Sent Amount'), 'sentAmount')).toEqual({
      rule: 'exact-header',
      closeness: 1,
    });
    expect(RULE_CAP['exact-header']).toBe(1);
  });

  it('rend 0,90 à un synonyme normalisé', () => {
    expect(bestRule(normalizeHeader('Quantité vendue'), 'sentAmount')?.rule).toBe('synonym');
    expect(RULE_CAP.synonym).toBe(0.9);
  });

  it('rend 0,75 (modulé) à une distance d’édition au-dessus du seuil', () => {
    const hit = bestRule(normalizeHeader('Recieved Amount'), 'receivedAmount');
    expect(hit?.rule).toBe('fuzzy');
    expect(hit!.closeness).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
    expect(RULE_CAP.fuzzy).toBe(0.75);
  });

  it('ne rend rien en dessous du seuil de distance', () => {
    expect(bestRule(normalizeHeader('Zorglub'), 'sentAmount')).toBeNull();
  });

  it('rend 0,60 à une forme compatible dont la colonne est la SEULE candidate', () => {
    // Un en-tête opaque, mais des dates : rien d'autre ne peut être `date`.
    const score = scoreOf(['zorglub'], [shape('iso-datetime')], 'date');
    expect(score).toBe(RULE_CAP['shape-only']);
  });

  it('déclare ses quatre règles sans doublon, du plafond le plus haut au plus bas', () => {
    expect(new Set(MATCH_RULES).size).toBe(MATCH_RULES.length);
    const caps = MATCH_RULES.map((r) => RULE_CAP[r]);
    expect([...caps].sort((a, b) => b - a)).toEqual(caps);
  });
});

describe('les deux pénalités', () => {
  it('multiplie par 0,4 quand la forme contredit le champ', () => {
    expect(shapeContradicts('iso-datetime', 'sentAmount')).toBe(true);
    expect(shapeContradicts('decimal-dot', 'sentAmount')).toBe(false);
    // `free-text` et `empty` ne contredisent rien : elles se taisent.
    expect(shapeContradicts('free-text', 'sentAmount')).toBe(false);
    expect(shapeContradicts('empty', 'date')).toBe(false);
    const contradicted = scoreOf(['Sent Amount'], [shape('iso-datetime')], 'sentAmount');
    expect(contradicted).toBeCloseTo(RULE_CAP['exact-header'] * SHAPE_CONTRADICTION, 10);
  });

  it('retranche 0,15 par colonne concurrente, jusque sous le seuil de pré-cochage', () => {
    // Deux colonnes se disent « frais » : le doute doit descendre sous le pré-cochage.
    const alone = scoreOf(['Frais'], [shape('decimal-dot')], 'feeAmount');
    expect(alone).toBeGreaterThanOrEqual(CONFIRM_THRESHOLD);
    const rivals = scoreOf(
      ['Frais', 'Commission'],
      [shape('decimal-dot'), shape('decimal-dot')],
      'feeAmount',
    );
    expect(rivals).toBeCloseTo(RULE_CAP.synonym - COMPETITOR_PENALTY, 10);
    expect(rivals).toBeLessThan(CONFIRM_THRESHOLD);
  });
});

describe('affectation gloutonne', () => {
  it('n’affecte qu’un champ par colonne et qu’une colonne par champ', () => {
    const headers = ['Frais', 'Commission', 'Date'].map((h) => normalizeHeader(h));
    const shapes = [shape('decimal-dot'), shape('decimal-dot'), shape('iso-datetime')];
    const kept = assign(scorePairs(headers, shapes));
    expect(new Set(kept.map((k) => k.field)).size).toBe(kept.length);
    expect(new Set(kept.map((k) => k.column)).size).toBe(kept.length);
  });

  it('donne le champ disputé au meilleur score, et laisse l’autre colonne libre', () => {
    // « Fee Amount » est un en-tête pivot connu (1,00) ; « Commission » n'est qu'un synonyme.
    const headers = ['Commission', 'Fee Amount'].map((h) => normalizeHeader(h));
    const kept = assign(scorePairs(headers, [shape('decimal-dot'), shape('decimal-dot')]));
    const fee = kept.find((k) => k.field === 'feeAmount');
    expect(fee?.column).toBe(1);
    expect(kept.filter((k) => k.column === 0)).toHaveLength(0);
  });

  it('est stable : le même fichier donne toujours le même résultat', () => {
    const headers = ['Date', 'Sent Amount', 'Sent Currency', 'Frais'].map((h) =>
      normalizeHeader(h),
    );
    const shapes = [
      shape('iso-datetime'),
      shape('decimal-dot'),
      shape('asset-code'),
      shape('decimal-dot'),
    ];
    const once = assign(scorePairs(headers, shapes));
    const twice = assign(scorePairs(headers, shapes));
    expect(twice).toEqual(once);
  });

  it('écarte tout ce qui reste sous le seuil de candidature', () => {
    const kept = assign([
      { column: 0, field: 'date', rule: 'synonym', confidence: CANDIDATE_THRESHOLD - 0.01 },
    ]);
    expect(kept).toEqual([]);
  });
});

describe('la table des synonymes', () => {
  it('n’attribue jamais un même synonyme à deux champs', () => {
    for (const [normalized, fields] of SYNONYM_INDEX) {
      expect(fields.length, `« ${normalized} » désigne ${fields.join(' et ')}`).toBe(1);
    }
  });
});
