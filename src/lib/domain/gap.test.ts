import { describe, expect, it } from 'vitest';
import { buildValueGap, type GapSource } from './gap';
import { D } from './money';

const SOURCE: GapSource = { kind: 'platform-balance', accountId: 'hl:0xabc' };
const TRACE = { metric: 'value', scope: { kind: 'portfolio' } } as const;

describe('buildValueGap', () => {
  it('concorde exactement : null', () => {
    expect(buildValueGap('qty', 'btc', D('1.5'), D('1.5'), SOURCE, null, D('0'))).toBeNull();
  });

  it('concorde à la tolérance près (écart strictement inférieur) : null', () => {
    expect(
      buildValueGap('value-eur', 'btc', D('100.004'), D('100'), SOURCE, null, D('0.01')),
    ).toBeNull();
  });

  it('concorde exactement à la tolérance (limite incluse) : null', () => {
    expect(
      buildValueGap('value-eur', 'btc', D('100.01'), D('100'), SOURCE, null, D('0.01')),
    ).toBeNull();
  });

  it('dépasse la tolérance : porte le delta signé ours − theirs', () => {
    const gap = buildValueGap('value-eur', 'btc', D('105'), D('100'), SOURCE, TRACE, D('0.01'));
    expect(gap).toEqual({
      metric: 'value-eur',
      asset: 'btc',
      ours: '105',
      theirs: '100',
      delta: '5',
      source: SOURCE,
      ourTrace: TRACE,
    });
  });

  it('un écart négatif garde son signe', () => {
    const gap = buildValueGap('cost-basis-eur', 'btc', D('90'), D('100'), SOURCE, null, D('0.01'));
    expect(gap?.delta).toBe('-10');
  });

  it('manque chez eux : theirs et delta null, ours renseigné', () => {
    const gap = buildValueGap('qty', 'eth', D('2'), null, SOURCE, TRACE, D('0'));
    expect(gap).toEqual({
      metric: 'qty',
      asset: 'eth',
      ours: '2',
      theirs: null,
      delta: null,
      source: SOURCE,
      ourTrace: TRACE,
    });
  });

  it('manque chez nous : ours et delta null, theirs renseigné', () => {
    const gap = buildValueGap('qty', 'eth', null, D('2'), SOURCE, null, D('0'));
    expect(gap).toEqual({
      metric: 'qty',
      asset: 'eth',
      ours: null,
      theirs: '2',
      delta: null,
      source: SOURCE,
      ourTrace: null,
    });
  });

  it('les deux manquent : rien à comparer, null', () => {
    expect(buildValueGap('qty', 'eth', null, null, SOURCE, null, D('0'))).toBeNull();
  });

  it('asset null (métrique de portefeuille entier) est conservé tel quel', () => {
    const gap = buildValueGap('value-eur', null, D('10'), D('0'), SOURCE, null, D('0'));
    expect(gap?.asset).toBeNull();
  });

  it('la tolérance ne concerne que le delta, pas la trichotomie manquante', () => {
    // Une tolérance large ne doit jamais transformer un côté manquant en concordance : il n'y a
    // rien à soustraire, donc rien à comparer à la tolérance.
    const gap = buildValueGap('qty', 'btc', D('1'), null, SOURCE, null, D('1000'));
    expect(gap).not.toBeNull();
    expect(gap?.delta).toBeNull();
  });
});
