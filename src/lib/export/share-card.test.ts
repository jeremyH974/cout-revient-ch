import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D } from '../domain/money';
import type { AssetCode } from '../domain/types';
import {
  SHARE_SIGNATURE,
  TOP_ASSETS,
  shareCardModel,
  shareOf,
  type ShareCardInput,
} from './share-card';

const base: ShareCardInput = {
  periodLabel: '1 mois',
  twr: D('0.124'),
  xirr: D('0.31'),
  benchmark: { label: 'BTC', twr: D('0.08') },
  allocation: [
    { asset: 'btc' as AssetCode, share: D('0.5') },
    { asset: 'eth' as AssetCode, share: D('0.3') },
    { asset: 'sol' as AssetCode, share: D('0.15') },
    { asset: 'ada' as AssetCode, share: D('0.05') },
  ],
  positions: 4,
  amounts: null,
  currency: 'EUR',
};

const all = (input: ShareCardInput): string =>
  [
    shareCardModel(input).text,
    ...shareCardModel(input).rows.map((r) => `${r.label} ${r.value}`),
  ].join('\n');

describe('carte de partage — la promesse de vie privée', () => {
  /**
   * La propriété qui fait foi. Chercher les chiffres d'un montant dans le texte serait fragile — un
   * pourcentage peut fortuitement les contenir. On vérifie plutôt que, **quel que soit** le montant,
   * activer les montants n'ajoute QUE les lignes de montants : tout le reste de la carte reste
   * rigoureusement identique. Autrement dit, aucune grandeur affichée par défaut n'est dérivée d'un
   * montant, ni ne peut en trahir un — et il suffit donc de ne pas les demander.
   */
  it('n’ajoute que les lignes de montants : rien d’autre ne dépend d’un montant', () => {
    const silent = shareCardModel(base);
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        (netCents, totalCents) => {
          const loud = shareCardModel({
            ...base,
            amounts: {
              netWorth: D(String(netCents)).div(D('100')),
              total: D(String(totalCents)).div(D('100')),
            },
          });
          const head = loud.rows.slice(0, silent.rows.length);
          return (
            JSON.stringify(head) === JSON.stringify(silent.rows) &&
            loud.title === silent.title &&
            loud.subtitle === silent.subtitle &&
            loud.footer === silent.footer &&
            loud.text.startsWith(silent.text.split('\n')[0]!)
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  it('n’émet aucun symbole monétaire en mode par défaut', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000_000, max: 100_000_000 }), (cents) => {
        const card = all({ ...base, amounts: null, twr: D(String(cents)).div(D('1000000')) });
        return !card.includes('€') && !card.includes('$');
      }),
      { numRuns: 50 },
    );
  });

  it('n’émet un montant QUE sur demande explicite, et le signale', () => {
    const silent = shareCardModel(base);
    expect(silent.hasAmounts).toBe(false);
    expect(all(base)).not.toContain('€');

    const loud = shareCardModel({
      ...base,
      amounts: { netWorth: D('21194.21'), total: D('3056.82') },
    });
    expect(loud.hasAmounts).toBe(true);
    expect(all({ ...base, amounts: { netWorth: D('21194.21'), total: D('3056.82') } })).toContain(
      '€',
    );
  });

  it('ne cite jamais une quantité détenue, seulement des parts', () => {
    // Les parts sont des ratios : aucun chemin du modèle ne reçoit de quantité.
    const card = shareCardModel(base);
    const lignes = card.rows.find((r) => r.label.includes('premières lignes'));
    expect(lignes?.value).toMatch(/%/);
    expect(lignes?.value).not.toMatch(/\d+[,.]\d{4,}/);
  });
});

describe('carte de partage — contenu', () => {
  it(`ne cite que les ${TOP_ASSETS} premières lignes, de la plus grosse à la plus petite`, () => {
    const value = shareCardModel(base).rows.find((r) =>
      r.label.includes('premières lignes'),
    )?.value;
    expect(value).toContain('Bitcoin');
    expect(value).toContain('Ethereum');
    expect(value).not.toContain('Cardano');
    expect(value?.indexOf('Bitcoin')).toBeLessThan(value?.indexOf('Ethereum') ?? 0);
  });

  it('écarte un actif à part nulle plutôt que de l’afficher à 0 %', () => {
    const card = shareCardModel({
      ...base,
      allocation: [
        { asset: 'btc' as AssetCode, share: D('1') },
        { asset: 'eth' as AssetCode, share: D('0') },
      ],
    });
    const value = card.rows.find((r) => r.label.includes('ligne'))?.value;
    expect(value).toContain('Bitcoin');
    expect(value).not.toContain('Ethereum');
  });

  it('nomme l’actif du repère : deux pourcentages nus se liraient comme le même portefeuille', () => {
    expect(shareCardModel(base).rows.map((r) => r.label)).toContain('Mêmes apports en BTC');
  });

  it('omet le rendement annualisé quand il n’est pas calculable, sans laisser de ligne vide', () => {
    const rows = shareCardModel({ ...base, xirr: null }).rows;
    expect(rows.some((r) => r.label === 'Rendement annualisé')).toBe(false);
    expect(rows.every((r) => r.value.length > 0)).toBe(true);
  });

  it('supporte un portefeuille vide sans produire de carte cassée', () => {
    const card = shareCardModel({
      ...base,
      twr: null,
      xirr: null,
      benchmark: null,
      allocation: [],
      positions: 0,
    });
    expect(card.rows.length).toBeGreaterThan(0);
    expect(card.rows.every((r) => r.value.length > 0)).toBe(true);
    expect(card.text).toContain(SHARE_SIGNATURE);
  });
});

describe('carte de partage — le résumé texte est l’équivalent accessible', () => {
  it('porte les mêmes nombres que les lignes, dans le même ordre', () => {
    const card = shareCardModel(base);
    let cursor = 0;
    for (const row of card.rows) {
      const at = card.text.indexOf(`${row.label} : ${row.value}`, cursor);
      expect(at, `« ${row.label} » absent ou déplacé dans le résumé`).toBeGreaterThanOrEqual(
        cursor,
      );
      cursor = at;
    }
  });

  it('dit que la performance est hors apports — sans quoi un pourcentage nu induit en erreur', () => {
    expect(shareCardModel(base).text).toContain('hors apports');
  });

  it('signe et porte le lien, pour qu’une carte postée ramène à l’outil', () => {
    const card = shareCardModel(base);
    expect(card.footer).toContain(SHARE_SIGNATURE);
    expect(card.text).toContain(card.footer);
  });
});

describe('shareOf', () => {
  it('rend la part relative, et zéro plutôt qu’une division par zéro', () => {
    expect(shareOf(D('25'), D('100')).toString()).toBe('0.25');
    expect(shareOf(D('25'), D('0')).toString()).toBe('0');
  });
});
