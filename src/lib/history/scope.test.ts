import { describe, expect, it } from 'vitest';
import type { PositionReport } from '../domain/engine';
import { isAggregate, positionsInScope } from './scope';

/** Seuls le code et la classe comptent ici : le reste du rapport n'entre pas dans le filtre. */
const position = (asset: string, assetClass: PositionReport['assetClass']): PositionReport =>
  ({ asset, assetClass }) as PositionReport;

const held = [
  position('btc', 'crypto'),
  position('usdc', 'stablecoin'),
  position('eq:aapl', 'equity'),
  position('eq:mc.pa', 'equity'),
];

describe('périmètre d’une série', () => {
  it('« portefeuille » veut dire tout ce que l’application valorise', () => {
    expect(positionsInScope(held, 'portfolio').map((p) => p.asset)).toEqual([
      'btc',
      'usdc',
      'eq:aapl',
      'eq:mc.pa',
    ]);
  });

  it('« crypto » écarte les titres — c’est l’assiette de l’article 150 VH bis', () => {
    // Un dénominateur gonflé des titres minore la plus-value imposable : la formule divise par la
    // valeur globale du portefeuille d'ACTIFS NUMÉRIQUES (décision n° 123).
    expect(positionsInScope(held, 'crypto').map((p) => p.asset)).toEqual(['btc', 'usdc']);
  });

  it('« crypto » garde les stablecoins : ce sont des actifs numériques', () => {
    // L'erreur inverse serait tout aussi fausse — une assiette trop petite majorerait l'impôt.
    expect(positionsInScope(held, 'crypto').some((p) => p.assetClass === 'stablecoin')).toBe(true);
  });

  it('« titres » ne garde que les titres', () => {
    expect(positionsInScope(held, 'equities').map((p) => p.asset)).toEqual(['eq:aapl', 'eq:mc.pa']);
  });

  it('un code d’actif ne garde que cet actif', () => {
    expect(positionsInScope(held, 'eq:aapl').map((p) => p.asset)).toEqual(['eq:aapl']);
    expect(positionsInScope(held, 'btc').map((p) => p.asset)).toEqual(['btc']);
  });

  it('distingue un périmètre agrégé d’un actif seul', () => {
    // Un agrégat n'a ni quantité ni prix unitaire ; un actif seul en a. La série se bâtit
    // différemment selon le cas, et confondre les deux rendrait une quantité qui n'existe pas.
    expect(isAggregate('portfolio')).toBe(true);
    expect(isAggregate('crypto')).toBe(true);
    expect(isAggregate('equities')).toBe(true);
    expect(isAggregate('btc')).toBe(false);
    expect(isAggregate('eq:aapl')).toBe(false);
  });
});
