import { describe, expect, it } from 'vitest';
import { D, type Big } from '../domain/money';
import type { TradeCosts } from '../domain/trading/costs';
import type { RoundTrip } from '../domain/trading/round-trips';
import { breakevenSentence, rolesSentence, unavailableSentence } from './trade-costs';

/** Espaces insécables d'Intl → espace simple, sans caractère invisible dans la source. */
const SPACES = new RegExp('[' + String.fromCharCode(0xa0, 0x202f) + ']', 'g');
const plain = (s: string | null): string | null => (s === null ? null : s.replace(SPACES, ' '));

type Facts = Pick<RoundTrip, 'direction' | 'status' | 'symbol'>;
const trip = (direction: Facts['direction'], status: Facts['status'], symbol = 'BTC'): Facts => ({
  direction,
  status,
  symbol,
});

const costs = (over: {
  move: Big | null;
  distance: Big | null;
  price: Big | null;
  captured?: Big | null;
  exitRate?: Big | null;
}): TradeCosts => ({
  unavailable: null,
  feeShareOfGross: null,
  averageFeeRate: null,
  breakevenMove: over.move,
  breakevenDistance: over.distance,
  breakevenPrice: over.price,
  capturedMove: over.captured ?? null,
  assumedExitRate: over.exitRate ?? null,
  makerFills: 0,
  takerFills: 0,
});

describe('breakevenSentence — trade clos', () => {
  it('short gagnant : le prix devait BAISSER, et il a baissé', () => {
    const text = breakevenSentence(
      trip('short', 'closed'),
      costs({
        move: D('104.979').div('150060'),
        distance: D('34.993'),
        price: D('49985.007'),
        captured: D('180').div('150060'),
      }),
    );
    expect(plain(text)).toBe(
      'Le prix devait baisser de 0,070 % (34,993 $ par BTC, soit une sortie sous 49 985,01 $) ' +
        'pour couvrir les frais et le funding ; il a baissé de 0,120 %.',
    );
  });

  it('long perdant : le prix devait MONTER, et il a baissé', () => {
    const text = breakevenSentence(
      trip('long', 'closed', 'ETH'),
      costs({ move: D('0.001'), distance: D('0.1'), price: D('100.1'), captured: D('-0.05') }),
    );
    expect(plain(text)).toBe(
      'Le prix devait monter de 0,100 % (0,10 $ par ETH, soit une sortie au-dessus de 100,10 $) ' +
        'pour couvrir les frais et le funding ; il a baissé de 5,000 %.',
    );
  });

  it('short perdant : le prix est monté ; un mouvement nul se dit aussi', () => {
    const moved = breakevenSentence(
      trip('short', 'closed'),
      costs({ move: D('0.001'), distance: D('0.1'), price: D('99.9'), captured: D('-0.02') }),
    );
    expect(plain(moved)).toMatch(/; il est monté de 2,000 %\.$/);
    const still = breakevenSentence(
      trip('short', 'closed'),
      costs({ move: D('0.001'), distance: D('0.1'), price: D('99.9'), captured: D('0') }),
    );
    expect(plain(still)).toMatch(/; il n'a pas bougé\.$/);
  });

  it('seuil négatif : le funding reçu payait déjà les frais, sans « mouvement nécessaire » négatif', () => {
    const text = breakevenSentence(
      trip('long', 'closed'),
      costs({ move: D('-0.002'), distance: D('-0.2'), price: D('99.8'), captured: D('0') }),
    );
    expect(plain(text)).toBe(
      "Le funding reçu couvrait déjà les frais : toute sortie au-dessus de 99,80 $ était gagnante ; le prix n'a pas bougé.",
    );
  });
});

describe('breakevenSentence — position ouverte', () => {
  it('nomme le point mort ET l’hypothèse sur les frais de sortie', () => {
    const text = breakevenSentence(
      trip('long', 'open', 'SOL'),
      costs({
        move: D('0.0034'),
        distance: D('0.34'),
        price: D('100.34'),
        exitRate: D('0.00045'),
      }),
    );
    expect(plain(text)).toBe(
      "Pour sortir sans perte, frais et funding compris, le prix doit monter d'au moins 0,340 % depuis l'entrée moyenne " +
        "(0,34 $ par SOL) : point mort à 100,34 $, en supposant des frais de sortie au taux moyen du trade jusqu'ici (0,045 %).",
    );
  });

  it('short dont le réalisé couvre déjà les frais : toute sortie sous le point mort gagne', () => {
    const text = breakevenSentence(
      trip('short', 'open', 'SOL'),
      costs({
        move: D('-0.0154'),
        distance: D('-3.09'),
        price: D('203.09'),
        exitRate: D('0.00045'),
      }),
    );
    expect(plain(text)).toBe(
      "Le gain déjà réalisé et le funding couvrent les frais : toute sortie sous 203,09 $ reste gagnante, en supposant des frais de sortie au taux moyen du trade jusqu'ici (0,045 %).",
    );
  });

  it('rien à dire sans seuil', () => {
    expect(
      breakevenSentence(trip('long', 'open'), costs({ move: null, distance: null, price: null })),
    ).toBeNull();
  });
});

describe('rolesSentence', () => {
  it('accorde le nombre et dit les deux rôles seulement quand ils coexistent', () => {
    expect(rolesSentence({ makerFills: 0, takerFills: 0 })).toBeNull();
    expect(rolesSentence({ makerFills: 0, takerFills: 1 })).toBe('1 exécution, taker');
    expect(rolesSentence({ makerFills: 1, takerFills: 0 })).toBe('1 exécution, maker');
    expect(rolesSentence({ makerFills: 0, takerFills: 3 })).toBe('3 exécutions, toutes taker');
    expect(rolesSentence({ makerFills: 2, takerFills: 0 })).toBe('2 exécutions, toutes maker');
    expect(rolesSentence({ makerFills: 2, takerFills: 3 })).toBe('5 exécutions : 3 taker, 2 maker');
  });
});

describe('unavailableSentence', () => {
  it('dit pourquoi le seuil manque, dans les deux cas', () => {
    expect(unavailableSentence('incomplete')).toMatch(/Historique partiel/);
    expect(unavailableSentence('native-fees')).toMatch(/autre jeton/);
  });
});
