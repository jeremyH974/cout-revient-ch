import { describe, expect, it } from 'vitest';
import type { Insight, InsightCode } from '../domain/insights';
import { MASK } from './fr';
import { insightsToText, renderInsight, renderInsights } from './insights';

/** Espaces insécables d'Intl → espace simple, pour comparer sans caractère invisible. */
const SPACES = new RegExp('[' + String.fromCharCode(0xa0, 0x202f) + ']', 'g');
const nbsp = (s: string): string => s.replace(SPACES, ' ');

const EUR = { discreet: false, currency: 'EUR' } as const;

function insight(code: InsightCode, over: Partial<Insight> = {}): Insight {
  const values: Record<InsightCode, Insight['values']> = {
    unqualified: { count: { kind: 'count', value: 3 } },
    unpriced: {
      count: { kind: 'count', value: 2 },
      assets: { kind: 'assets', value: ['bonk', 'wif'] },
    },
    'subscription-net': {
      amount: { kind: 'money', value: '159.97' },
      rebates: { kind: 'money', value: '278.77' },
      tier: { kind: 'tier', value: 'investisseur' },
    },
    'fees-12m': {
      amount: { kind: 'money', value: '904.75' },
      rate: { kind: 'ratio', value: '0.006' },
    },
    concentration: {
      assets: { kind: 'assets', value: ['btc'] },
      share: { kind: 'ratio', value: '0.72' },
      amount: { kind: 'money', value: '69415.83' },
    },
    xirr: { rate: { kind: 'ratio', value: '0.184' }, since: { kind: 'day', value: '2024-03-12' } },
    'benchmark-gap': {
      amount: { kind: 'money', value: '-1234' },
      assets: { kind: 'assets', value: ['btc'] },
      since: { kind: 'day', value: '2024-03-12' },
    },
    realized: { amount: { kind: 'money', value: '2500' } },
    'contribution-top': {
      assets: { kind: 'assets', value: ['eth'] },
      amount: { kind: 'money', value: '1200' },
    },
    'contribution-bottom': {
      assets: { kind: 'assets', value: ['sol'] },
      amount: { kind: 'money', value: '-300' },
    },
    'capital-recovered': {
      count: { kind: 'count', value: 2 },
      assets: { kind: 'assets', value: ['btc', 'eth'] },
    },
    'stablecoin-share': {
      share: { kind: 'ratio', value: '0.12' },
      amount: { kind: 'money', value: '5000' },
    },
  };
  return {
    id: code,
    code,
    tone: 'neutral',
    priority: 50,
    values: values[code],
    link: null,
    ...over,
  };
}

const ALL_CODES: InsightCode[] = [
  'unqualified',
  'unpriced',
  'subscription-net',
  'fees-12m',
  'concentration',
  'xirr',
  'benchmark-gap',
  'realized',
  'contribution-top',
  'contribution-bottom',
  'capital-recovered',
  'stablecoin-share',
];

describe('renderInsight', () => {
  it('donne à chaque code un intitulé et une phrase complète, sans trou de formatage', () => {
    for (const code of ALL_CODES) {
      const rendered = renderInsight(insight(code), EUR);
      expect(rendered.title.length, code).toBeGreaterThan(2);
      expect(rendered.detail.endsWith('.'), code).toBe(true);
      // Un « — » signalerait une valeur attendue par la phrase et absente du constat.
      expect(rendered.detail, code).not.toContain('—');
    }
  });

  it('écrit les phrases attendues, chiffres compris', () => {
    expect(nbsp(renderInsight(insight('concentration'), EUR).detail)).toBe(
      'BTC représente 72,0 % de la valeur de vos positions (69 415,83 €).',
    );
    expect(nbsp(renderInsight(insight('fees-12m'), EUR).detail)).toBe(
      'Vous avez payé 904,75 € de frais d’opérations sur 12 mois, soit 0,6 % du volume échangé.',
    );
    expect(nbsp(renderInsight(insight('subscription-net'), EUR).detail)).toBe(
      'Sur 12 mois : 278,77 € de remises obtenues, soit +159,97 € net après le coût de l’offre Investisseur.',
    );
    expect(nbsp(renderInsight(insight('xirr'), EUR).detail)).toBe(
      'Votre rendement personnel (XIRR) est de +18,4 % par an depuis le 12/03/2024.',
    );
  });

  it('dit « de moins » quand le repère devance le portefeuille, sans signe en double', () => {
    const behind = renderInsight(insight('benchmark-gap', { tone: 'negative' }), EUR).detail;
    expect(nbsp(behind)).toBe(
      'À apports identiques, votre portefeuille vaut 1 234,00 € de moins qu’un placement 100 % BTC depuis le 12/03/2024.',
    );
    expect(behind).not.toContain('−1');
    const ahead = renderInsight(
      insight('benchmark-gap', {
        tone: 'positive',
        values: {
          amount: { kind: 'money', value: '1234' },
          assets: { kind: 'assets', value: ['btc'] },
          since: { kind: 'day', value: '2024-03-12' },
        },
      }),
      EUR,
    ).detail;
    expect(ahead).toContain('de plus');
  });

  it('accorde les pluriels', () => {
    expect(renderInsight(insight('unqualified'), EUR).detail).toContain(
      '3 opérations ne sont pas encore interprétées',
    );
    expect(
      renderInsight(insight('unqualified', { values: { count: { kind: 'count', value: 1 } } }), EUR)
        .detail,
    ).toContain('1 opération n’est pas encore interprétée');
    expect(renderInsight(insight('capital-recovered'), EUR).detail).toContain('Sur 2 positions');
    expect(
      renderInsight(
        insight('capital-recovered', {
          values: {
            count: { kind: 'count', value: 1 },
            assets: { kind: 'assets', value: ['btc'] },
          },
        }),
        EUR,
      ).detail,
    ).toContain('Sur BTC, vos ventes');
  });

  it('masque les montants en mode discret, jamais les pourcentages ni les dates', () => {
    const discreet = nbsp(
      renderInsight(insight('fees-12m'), { discreet: true, currency: 'EUR' }).detail,
    );
    expect(discreet).toContain(MASK);
    expect(discreet).not.toContain('904');
    expect(discreet).toContain('0,6 %');
    const xirr = nbsp(renderInsight(insight('xirr'), { discreet: true, currency: 'EUR' }).detail);
    // Un rendement est un pourcentage : il reste lisible, comme le composant `Pct` de l'interface.
    expect(xirr).toContain('+18,4 %');
    expect(xirr).toContain('12/03/2024');
  });

  it('suit la devise d’affichage', () => {
    const usd = renderInsight(insight('realized'), { discreet: false, currency: 'USD' }).detail;
    expect(usd).toContain('$');
    expect(usd).not.toContain('€');
  });

  it('rend une liste et la met en texte collable', () => {
    const list = renderInsights([insight('realized'), insight('stablecoin-share')], EUR);
    expect(list).toHaveLength(2);
    const text = insightsToText(list);
    expect(text.split('\n')).toHaveLength(2);
    expect(text.startsWith('- Résultat encaissé : ')).toBe(true);
  });
});
