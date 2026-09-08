/**
 * `report.allocation` couvre tout le portefeuille. Depuis que les titres y entrent (décision
 * n° 119), un camembert intitulé « Titres » bâti dessus calculerait des parts sur un dénominateur
 * crypto + titres : chaque part serait juste au regard du total général, et fausse au regard de ce
 * que son titre annonce. Personne ne verrait l'erreur — les parts sommeraient à moins de 100 %,
 * ce qu'un anneau ne montre pas.
 */
import { describe, expect, it } from 'vitest';
import { D } from '../money';
import { allocationOf } from './report';
import type { PositionReport } from './report';

const position = (asset: string, value: string | null): PositionReport =>
  ({ asset, value: value === null ? null : D(value) }) as PositionReport;

describe('répartition d’un sous-ensemble', () => {
  it('calcule les parts sur le total du sous-ensemble, pas du portefeuille', () => {
    const parts = allocationOf([position('eq:aapl', '300'), position('eq:mc.pa', '100')]);
    expect(parts.map((p) => p.share.toString())).toEqual(['0.75', '0.25']);
  });

  it('les parts somment à un : c’est ce qu’un anneau promet', () => {
    const parts = allocationOf([
      position('eq:aapl', '300'),
      position('eq:mc.pa', '100'),
      position('eq:ker', '100'),
    ]);
    const sum = parts.reduce((acc, p) => acc.plus(p.share), D('0'));
    expect(sum.toString()).toBe('1');
  });

  it('écarte les lignes sans cotation plutôt que de les compter à zéro', () => {
    // Une ligne sans cours n'a pas de valeur à répartir. La compter pour zéro la ferait figurer
    // dans la légende avec « 0 % », ce qui se lit « elle ne pèse rien » — c'est faux.
    const parts = allocationOf([position('eq:aapl', '300'), position('eq:etl.pa', null)]);
    expect(parts.map((p) => p.asset)).toEqual(['eq:aapl']);
    expect(parts[0]?.share.toString()).toBe('1');
  });

  it('rend une répartition vide plutôt que de diviser par zéro', () => {
    expect(allocationOf([])).toEqual([]);
    expect(allocationOf([position('eq:aapl', null)])).toEqual([]);
    expect(allocationOf([position('eq:aapl', '0')])).toEqual([]);
  });
});
