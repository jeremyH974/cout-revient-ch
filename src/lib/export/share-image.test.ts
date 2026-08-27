import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D } from '../domain/money';
import type { AssetCode } from '../domain/types';
import { shareCardModel, type ShareCard, type ShareCardInput } from './share-card';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SHARE_PALETTES,
  estimateWidth,
  shareCardLayout,
  truncateTo,
  type LayoutText,
} from './share-image';

const input: ShareCardInput = {
  periodLabel: '1 mois',
  twr: D('0.124'),
  xirr: D('0.31'),
  benchmark: { label: 'BTC', twr: D('0.08') },
  allocation: [
    { asset: 'btc' as AssetCode, share: D('0.5') },
    { asset: 'eth' as AssetCode, share: D('0.3') },
    { asset: 'sol' as AssetCode, share: D('0.15') },
  ],
  positions: 6,
  amounts: null,
  currency: 'EUR',
};

const texts = (card: ShareCard): LayoutText[] =>
  shareCardLayout(card).items.filter((i): i is LayoutText => i.kind === 'text');

/** Bord gauche et bord droit occupés par un élément, selon son alignement. */
function span(item: LayoutText): { from: number; to: number } {
  const w = estimateWidth(item.text, item.size);
  return item.align === 'left'
    ? { from: item.x, to: item.x + w }
    : { from: item.x - w, to: item.x };
}

describe('géométrie de la carte — rien ne sort du cadre', () => {
  it('rend exactement 1200 × 630, le format d’aperçu attendu', () => {
    const layout = shareCardLayout(shareCardModel(input));
    expect(layout.width).toBe(CARD_WIDTH);
    expect(layout.height).toBe(CARD_HEIGHT);
  });

  it('garde chaque texte dans le cadre, horizontalement et verticalement', () => {
    for (const item of texts(shareCardModel(input))) {
      const { from, to } = span(item);
      expect(from, item.text).toBeGreaterThanOrEqual(0);
      expect(to, item.text).toBeLessThanOrEqual(CARD_WIDTH);
      expect(item.y, item.text).toBeGreaterThan(0);
      expect(item.y, item.text).toBeLessThanOrEqual(CARD_HEIGHT);
    }
  });

  it('tient aussi avec des libellés longs et des pourcentages à quatre chiffres', () => {
    // Le débordement silencieux est le défaut classique d'une carte générée : il ne se voit
    // qu'une fois l'image postée. On le rend impossible plutôt que de l'inspecter à l'œil.
    const card = shareCardModel({
      ...input,
      periodLabel: 'depuis la toute première opération du grand livre',
      twr: D('123.4567'),
      benchmark: { label: 'BITCOIN CASH ABC SV', twr: D('-99.9999') },
      allocation: [
        { asset: 'btc' as AssetCode, share: D('0.4') },
        { asset: 'eth' as AssetCode, share: D('0.35') },
        { asset: 'sol' as AssetCode, share: D('0.25') },
      ],
      positions: 999,
    });
    for (const item of texts(card)) {
      const { from, to } = span(item);
      expect(from, item.text).toBeGreaterThanOrEqual(0);
      expect(to, item.text).toBeLessThanOrEqual(CARD_WIDTH);
    }
  });

  it('ne fait jamais chevaucher un libellé et sa valeur, même sur les pires libellés', () => {
    // Le cas court ne prouve rien : sans troncature, deux textes brefs ne se touchent jamais. La
    // garantie ne vaut que sur les libellés qui débordent — c'est eux qu'on teste.
    const cards = [
      shareCardModel(input),
      shareCardModel({
        ...input,
        periodLabel: 'depuis la toute première opération enregistrée dans le grand livre complet',
        benchmark: { label: 'BITCOIN CASH ABC SV NODE EDITION', twr: D('-0.42') },
      }),
    ];
    for (const card of cards) {
      const items = texts(card);
      const labels = items.filter((i) => i.role === 'label');
      const values = items.filter((i) => i.role === 'value');
      expect(labels.length).toBe(values.length);
      labels.forEach((label, i) => {
        const value = values[i]!;
        expect(label.y).toBe(value.y);
        expect(span(label).to, `« ${label.text} » touche « ${value.text} »`).toBeLessThanOrEqual(
          span(value).from,
        );
      });
    }
  });

  it('reste dans le cadre quel que soit le nombre de lignes', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 12 }), (extra) => {
        const card: ShareCard = {
          ...shareCardModel(input),
          rows: [
            ...shareCardModel(input).rows,
            ...Array.from({ length: extra }, (_, i) => ({
              label: `Ligne ${i}`,
              value: `${i} %`,
              tone: 'neutral' as const,
            })),
          ],
        };
        return texts(card).every((item) => item.y > 0 && item.y <= CARD_HEIGHT);
      }),
      { numRuns: 30 },
    );
  });
});

describe('troncature', () => {
  it('laisse intact ce qui tient', () => {
    expect(truncateTo('court', 30, 1000)).toBe('court');
  });

  it('coupe et pose une ellipse quand ça déborde', () => {
    const cut = truncateTo('un libellé beaucoup trop long pour la place disponible', 30, 200);
    expect(cut.endsWith('…')).toBe(true);
    expect(estimateWidth(cut, 30)).toBeLessThanOrEqual(200 + 30);
  });

  it('rend au moins un caractère même sur une largeur absurde', () => {
    expect(truncateTo('quelque chose', 30, 1).length).toBeGreaterThan(0);
  });
});

describe('palettes', () => {
  it('donne à chaque thème une couleur pour chaque rôle', () => {
    for (const [name, palette] of Object.entries(SHARE_PALETTES)) {
      for (const [key, value] of Object.entries(palette)) {
        expect(value, `${name}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('distingue gain et perte dans les deux thèmes', () => {
    expect(SHARE_PALETTES.dark.gain).not.toBe(SHARE_PALETTES.dark.loss);
    expect(SHARE_PALETTES.light.gain).not.toBe(SHARE_PALETTES.light.loss);
  });
});
