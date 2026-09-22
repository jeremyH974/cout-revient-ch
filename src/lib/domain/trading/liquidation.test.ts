import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D } from '../money';
import {
  LIQUIDATION_NEAR,
  isNearLiquidation,
  liquidationDistance,
  type LiquidationDistance,
} from './liquidation';
import type { OpenPosition } from './types';

const pos = (over: Partial<OpenPosition> = {}): OpenPosition => ({
  symbol: 'BTC',
  side: 'long',
  size: '2',
  entryPrice: '9500',
  value: '20000',
  unrealizedPnl: '0',
  leverage: 10,
  leverageType: 'cross',
  liquidationPrice: '9000',
  marginUsed: '2000',
  fundingSinceOpen: null,
  ...over,
});

const asValue = (d: LiquidationDistance) => {
  if (d.kind !== 'value') throw new Error(`attendu 'value', reçu '${d.kind}'`);
  return d;
};

describe('liquidationDistance — long', () => {
  it('exemple calculé à la main : mark 10 000 (20 000 / 2), liq 9 000 → 10 %, écart −1 000', () => {
    const d = asValue(
      liquidationDistance(
        pos({ side: 'long', size: '2', value: '20000', liquidationPrice: '9000' }),
      ),
    );
    expect(d.mark.toString()).toBe('10000');
    expect(d.fraction.toString()).toBe('0.1');
    expect(d.priceGap.toString()).toBe('-1000');
    expect(d.crossMargin).toBe(true);
    expect(d.breached).toBe(false);
  });

  it('isolated : crossMargin = false', () => {
    const d = asValue(liquidationDistance(pos({ leverageType: 'isolated' })));
    expect(d.crossMargin).toBe(false);
  });

  it('déjà atteinte (instantané périmé) : mark sous liq → fraction ≤ 0, breached', () => {
    // mark 10 000, liq 10 500 : un long dont le prix est déjà tombé sous son seuil de liquidation.
    const d = asValue(liquidationDistance(pos({ liquidationPrice: '10500' })));
    expect(d.fraction.toString()).toBe('-0.05');
    expect(d.breached).toBe(true);
  });

  it('pile au seuil (fraction = 0) : breached vrai, borne incluse', () => {
    const d = asValue(
      liquidationDistance(pos({ size: '1', value: '10000', liquidationPrice: '10000' })),
    );
    expect(d.fraction.toString()).toBe('0');
    expect(d.breached).toBe(true);
  });

  it('propriété : la distance croît avec le mark (liq et taille fixes)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 5_000 }),
        fc.integer({ min: 1, max: 5_000 }),
        (markLo, delta) => {
          const markHi = markLo + delta;
          const build = (mark: number) =>
            asValue(
              liquidationDistance(
                pos({ side: 'long', size: '1', value: String(mark), liquidationPrice: '5' }),
              ),
            );
          expect(build(markHi).fraction.gt(build(markLo).fraction)).toBe(true);
        },
      ),
    );
  });
});

describe('liquidationDistance — short', () => {
  it('exemple calculé à la main : mark 5 000 (5 000 / 1), liq 5 500 → 10 %, écart +500', () => {
    const d = asValue(
      liquidationDistance(
        pos({ side: 'short', size: '1', value: '5000', liquidationPrice: '5500' }),
      ),
    );
    expect(d.mark.toString()).toBe('5000');
    expect(d.fraction.toString()).toBe('0.1');
    expect(d.priceGap.toString()).toBe('500');
    expect(d.breached).toBe(false);
  });

  it('déjà atteinte (instantané périmé) : mark au-dessus de liq → fraction ≤ 0, breached', () => {
    // mark 6 000, liq 5 000 : un short dont le prix est déjà monté au-delà de son seuil.
    const d = asValue(
      liquidationDistance(
        pos({ side: 'short', size: '1', value: '6000', liquidationPrice: '5000' }),
      ),
    );
    expect(d.fraction.toString()).toBe(D('-1000').div('6000').toString());
    expect(d.breached).toBe(true);
  });

  /*
   * CONTRE-ÉPREUVE (décision n° 75, règle du dépôt) : la formule du short a été inversée en
   * `mark.minus(liq).div(mark)` (celle du long) le temps de la vérifier. Le test « exemple calculé
   * à la main » ci-dessus est passé au ROUGE en nommant la faute :
   *   expected: '0.1', received: '-0.1'
   * (5000 − 5500 = −500, / 5000 = −0,1 — le signe inversé). La formule séparée a ensuite été
   * restaurée ; ce commentaire consigne la contre-épreuve sans la laisser rouge dans le dépôt.
   */

  it('propriété : la distance décroît avec le mark (liq et taille fixes)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 5_000 }),
        fc.integer({ min: 1, max: 5_000 }),
        (markLo, delta) => {
          const markHi = markLo + delta;
          const build = (mark: number) =>
            asValue(
              liquidationDistance(
                pos({
                  side: 'short',
                  size: '1',
                  value: String(mark),
                  liquidationPrice: String(10_000),
                }),
              ),
            );
          expect(build(markHi).fraction.lt(build(markLo).fraction)).toBe(true);
        },
      ),
    );
  });
});

describe('liquidationDistance — états dégénérés', () => {
  it("liquidationPrice null : état VALIDE 'none', pas une erreur", () => {
    expect(liquidationDistance(pos({ liquidationPrice: null }))).toEqual({ kind: 'none' });
  });

  it("taille nulle : 'unknown'", () => {
    expect(liquidationDistance(pos({ size: '0' }))).toEqual({ kind: 'unknown' });
  });

  it("taille négative : 'unknown' (viole le contrat « taille absolue »)", () => {
    expect(liquidationDistance(pos({ size: '-2' }))).toEqual({ kind: 'unknown' });
  });

  it("value illisible : 'unknown', pas d'exception levée", () => {
    expect(liquidationDistance(pos({ value: 'nan' }))).toEqual({ kind: 'unknown' });
  });

  it("size illisible : 'unknown', pas d'exception levée", () => {
    expect(liquidationDistance(pos({ size: 'nan' }))).toEqual({ kind: 'unknown' });
  });

  it("liquidationPrice illisible (mais non null) : 'unknown'", () => {
    expect(liquidationDistance(pos({ liquidationPrice: 'nan' }))).toEqual({ kind: 'unknown' });
  });

  it("value nulle (mark = 0) : 'unknown' plutôt qu'une division par zéro", () => {
    expect(liquidationDistance(pos({ value: '0' }))).toEqual({ kind: 'unknown' });
  });
});

describe('LIQUIDATION_NEAR / isNearLiquidation', () => {
  it('vaut 0,10 (heuristique d’affichage, documentée comme telle)', () => {
    expect(LIQUIDATION_NEAR.toString()).toBe('0.1');
  });

  it('pile à 10 % : proche (borne incluse)', () => {
    const d = liquidationDistance(pos({ size: '1', value: '10000', liquidationPrice: '9000' }));
    expect(asValue(d).fraction.toString()).toBe('0.1');
    expect(isNearLiquidation(d)).toBe(true);
  });

  it('à 11 % : pas encore proche', () => {
    const d = liquidationDistance(pos({ size: '1', value: '10000', liquidationPrice: '8900' }));
    expect(asValue(d).fraction.toString()).toBe('0.11');
    expect(isNearLiquidation(d)).toBe(false);
  });

  it("'none' et 'unknown' ne sont jamais « proches »", () => {
    expect(isNearLiquidation({ kind: 'none' })).toBe(false);
    expect(isNearLiquidation({ kind: 'unknown' })).toBe(false);
  });
});
