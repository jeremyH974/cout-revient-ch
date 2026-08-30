/**
 * Propriétés du vérificateur d'ancrage (fast-check) — la partie qui prouve qu'il vaut quelque
 * chose.
 *
 * **Le premier client du harnais est notre propre rendu français.** Un harnais dont le premier
 * client serait un modèle ne pourrait jamais être mis en défaut sans modèle ; celui-ci tourne sur
 * `format/insights.ts`, du code déterministe, à chaque `npm run check`. Si le vérificateur est
 * trop strict, la propriété tombe immédiatement, sur nos phrases, sans qu'aucune IA soit en jeu.
 *
 * Trois propriétés :
 * 1. **centrale** — aucun nombre du rendu français des constats n'échappe au JSON des constats ;
 * 2. **appui (a)** — un montant formaté par `fmtMoney` est ancré à sa chaîne décimale ;
 * 3. **appui (b)** — un montant DÉPLACÉ n'est PAS ancré. Sans elle, un vérificateur qui accepte
 *    tout passerait (a) sans qu'on s'en aperçoive.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Insight, InsightCode, InsightTone, InsightValue } from '../domain/insights';
import { D, type DecimalString } from '../domain/money';
import { fmtMoney } from '../format/fr';
import { insightsToText, renderInsights } from '../format/insights';
import { CURRENCIES } from '../fx/types';
import { auditText, type DeclaredLiteral } from './anchor';

/**
 * **Les trois constantes écrites en dur dans nos propres phrases.** La propriété centrale les a
 * trouvées seule, dès son premier passage : ce sont des nombres du GABARIT, pas de la source, et
 * le vérificateur avait parfaitement raison de les signaler.
 *
 * Elles sont déclarées ici, une par une, avec la phrase qui les porte — jamais absorbées en
 * élargissant la liste des dérivations, qui reste fermée. Un test voisin exige que chacune soit
 * encore NÉCESSAIRE : une exception qui ne sert plus doit disparaître, pas dormir.
 */
const TEMPLATE_LITERALS: readonly DeclaredLiteral[] = [
  {
    value: '305',
    why: 'seuil légal d’exonération de l’art. 150 VH bis, phrase « tax-year »',
    kind: 'money',
  },
  {
    value: '12',
    why: 'fenêtre de 12 mois glissants, phrases « subscription-net » et « fees-12m »',
    kind: 'plain',
  },
  {
    value: '1',
    why: 'repère « un placement 100 % BTC », phrase « benchmark-gap »',
    kind: 'percent',
  },
];

const ASSET_CODES = ['btc', 'eth', 'sol', 'usdc', 'bonk', '1inch'] as const;
const DAYS = ['2024-03-12', '2025-01-20', '2025-04-08', '2025-10-02', '2026-08-30'] as const;
const TIERS = ['classique', 'investisseur', 'gestion-privee'] as const;
const TONES: readonly InsightTone[] = ['positive', 'negative', 'neutral', 'attention'];

/** Chaîne décimale canonique : partie entière et jusqu'à 9 décimales, jamais un flottant. */
const decimalArb: fc.Arbitrary<DecimalString> = fc
  .tuple(
    fc.boolean(),
    fc.nat({ max: 9_999_999 }),
    fc.array(fc.integer({ min: 0, max: 9 }), { maxLength: 9 }),
  )
  .map(([negative, whole, digits]) => {
    const fraction = digits.length === 0 ? '' : `.${digits.join('')}`;
    return `${negative ? '-' : ''}${whole}${fraction}`;
  });

/** Ratio dans [-2, 2] au millionième : la forme réelle des parts et des rendements du moteur. */
const ratioArb: fc.Arbitrary<DecimalString> = fc
  .integer({ min: -2_000_000, max: 2_000_000 })
  .map((n) => D(String(n)).div('1000000').toString());

const money = (value: DecimalString): InsightValue => ({ kind: 'money', value });
const ratio = (value: DecimalString): InsightValue => ({ kind: 'ratio', value });

const assetsArb = fc.uniqueArray(fc.constantFrom(...ASSET_CODES), { minLength: 1, maxLength: 3 });
const dayArb = fc.constantFrom(...DAYS);
const countArb = fc.integer({ min: 1, max: 500 });

function valuesArb(code: InsightCode): fc.Arbitrary<Insight['values']> {
  switch (code) {
    case 'unqualified':
      return countArb.map((n) => ({ count: { kind: 'count', value: n } }));
    case 'unpriced':
      return fc.tuple(countArb, assetsArb).map(([n, list]) => ({
        count: { kind: 'count', value: n },
        assets: { kind: 'assets', value: list },
      }));
    case 'subscription-net':
      return fc
        .tuple(decimalArb, decimalArb, fc.constantFrom(...TIERS))
        .map(([amount, rebates, tier]) => ({
          amount: money(amount),
          rebates: money(rebates),
          tier: { kind: 'tier', value: tier },
        }));
    case 'fees-12m':
      return fc.tuple(decimalArb, fc.option(ratioArb, { nil: null })).map(([amount, rate]) => ({
        amount: money(amount),
        ...(rate === null ? {} : { rate: ratio(rate) }),
      }));
    case 'concentration':
      return fc.tuple(assetsArb, ratioArb, decimalArb).map(([list, share, amount]) => ({
        assets: { kind: 'assets', value: list },
        share: ratio(share),
        amount: money(amount),
      }));
    case 'top3-share':
      return fc.tuple(ratioArb, assetsArb).map(([share, list]) => ({
        share: ratio(share),
        assets: { kind: 'assets', value: list },
      }));
    case 'max-drawdown':
      return fc
        .tuple(ratioArb, dayArb, dayArb, fc.option(dayArb, { nil: null }))
        .map(([share, from, to, recovered]) => ({
          share: ratio(share),
          from: { kind: 'day', value: from },
          to: { kind: 'day', value: to },
          ...(recovered === null ? {} : { recovered: { kind: 'day', value: recovered } }),
        }));
    case 'tax-year':
      return fc
        .tuple(
          fc.integer({ min: 2019, max: 2035 }),
          decimalArb,
          decimalArb,
          decimalArb,
          countArb,
          fc.boolean(),
        )
        .map(([year, proceeds, net, tax, count, exempt]) => ({
          year: { kind: 'year', value: year },
          proceeds: money(proceeds),
          net: money(net),
          tax: money(tax),
          count: { kind: 'count', value: count },
          ...(exempt ? { exempt: { kind: 'count', value: 1 } } : {}),
        }));
    case 'xirr':
      return fc.tuple(ratioArb, dayArb).map(([rate, since]) => ({
        rate: ratio(rate),
        since: { kind: 'day', value: since },
      }));
    case 'benchmark-gap':
      return fc.tuple(decimalArb, assetsArb, dayArb).map(([amount, list, since]) => ({
        amount: money(amount),
        assets: { kind: 'assets', value: list },
        since: { kind: 'day', value: since },
      }));
    case 'realized':
      return decimalArb.map((amount) => ({ amount: money(amount) }));
    case 'contribution-top':
    case 'contribution-bottom':
      return fc.tuple(assetsArb, decimalArb).map(([list, amount]) => ({
        assets: { kind: 'assets', value: list },
        amount: money(amount),
      }));
    case 'capital-recovered':
      return fc.tuple(countArb, assetsArb).map(([n, list]) => ({
        count: { kind: 'count', value: n },
        assets: { kind: 'assets', value: list },
      }));
    case 'stablecoin-share':
      return fc.tuple(ratioArb, decimalArb).map(([share, amount]) => ({
        share: ratio(share),
        amount: money(amount),
      }));
    default: {
      const missing: never = code;
      throw new Error(`Constat sans générateur : ${String(missing)}`);
    }
  }
}

const CODES: readonly InsightCode[] = [
  'unqualified',
  'unpriced',
  'subscription-net',
  'fees-12m',
  'concentration',
  'top3-share',
  'max-drawdown',
  'tax-year',
  'xirr',
  'benchmark-gap',
  'realized',
  'contribution-top',
  'contribution-bottom',
  'capital-recovered',
  'stablecoin-share',
];

const insightArb: fc.Arbitrary<Insight> = fc
  .constantFrom(...CODES)
  .chain((code) =>
    fc
      .tuple(valuesArb(code), fc.constantFrom(...TONES))
      .map(([values, tone]) => ({ id: code, code, tone, priority: 50, values, link: null })),
  );

/** Ce que P65 enverra réellement au modèle : les constats, sans leur rang ni leur cible d'écran. */
const payloadOf = (list: readonly Insight[]): unknown =>
  list.map((insight) => ({ code: insight.code, tone: insight.tone, values: insight.values }));

describe('propriété centrale — notre propre rendu français est ancré', () => {
  it('n’écrit aucun nombre absent du JSON des constats', () => {
    fc.assert(
      fc.property(
        fc.array(insightArb, { minLength: 1, maxLength: 8 }),
        fc.boolean(),
        fc.constantFrom(...CURRENCIES),
        (list, discreet, currency) => {
          const text = insightsToText(renderInsights(list, { discreet, currency }));
          const report = auditText(text, payloadOf(list), { literals: TEMPLATE_LITERALS });
          expect(report.unanchored.map((u) => `${u.token.raw} (${u.reason})`)).toEqual([]);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('exige que chaque constante déclarée serve encore : sinon elle disparaît', () => {
    // Le pendant de l'exception nommée mot pour mot du lexique : une dérogation qui dort est une
    // dérogation que plus personne ne relit. Chacune est donc éprouvée sur la phrase MINIMALE qui
    // la porte — un contexte plus riche masquerait le besoin par une collision d'ancres.
    const carriers: readonly [string, Insight][] = [
      [
        '305',
        insightOf('tax-year', {
          year: { kind: 'year', value: 2026 },
          proceeds: money('120'),
          net: money('30'),
          tax: money('0'),
          count: { kind: 'count', value: 4 },
          exempt: { kind: 'count', value: 1 },
        }),
      ],
      ['12', insightOf('fees-12m', { amount: money('904.75') })],
      [
        '1',
        insightOf('benchmark-gap', {
          amount: money('-1234'),
          assets: { kind: 'assets', value: ['btc'] },
          since: { kind: 'day', value: '2024-03-12' },
        }),
      ],
    ];

    for (const [value, carrier] of carriers) {
      const list = [carrier];
      const text = insightsToText(renderInsights(list, { discreet: false, currency: 'EUR' }));
      const without = TEMPLATE_LITERALS.filter((l) => l.value !== value);
      expect(auditText(text, payloadOf(list), { literals: without }).unanchored, value).not.toEqual(
        [],
      );
      expect(
        auditText(text, payloadOf(list), { literals: TEMPLATE_LITERALS }).unanchored,
        value,
      ).toEqual([]);
    }
  });
});

function insightOf(code: InsightCode, values: Insight['values']): Insight {
  return { id: code, code, tone: 'neutral', priority: 50, values, link: null };
}

describe('propriété d’appui (a) — un montant formaté est ancré à sa source', () => {
  it('ancre fmtMoney à la chaîne décimale qui l’a produit', () => {
    fc.assert(
      fc.property(decimalArb, fc.constantFrom(...CURRENCIES), (value, currency) => {
        const text = `Le montant retenu est ${fmtMoney(D(value), currency, { sign: true })}.`;
        expect(auditText(text, { amount: value }).unanchored).toEqual([]);
      }),
      { numRuns: 500 },
    );
  });
});

describe('propriété d’appui (b) — la falsifiabilité', () => {
  /**
   * Un vérificateur qui accepterait tout passerait (a) sans broncher. Celui-ci doit REFUSER un
   * montant déplacé d'un centime.
   *
   * L'exclusion : on écarte les déplacements qui tombent sur un multiple de dix centimes. Ce n'est
   * pas un aménagement de confort — `roundHalfUp(s, 0)` et `roundHalfUp(s, 1)` sont des rendus
   * DÉCLARÉS, donc `99,99 € + 0,01 €` s'ancre légitimement à `99,99` : c'est la collision fortuite
   * nommée dans l'en-tête d'`anchor.ts`, et la propriété la nomme plutôt que de la cacher.
   */
  it('refuse un montant déplacé d’un centime', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: -50_000_000, max: 50_000_000 })
          .filter((cents) => (((cents + 1) % 10) + 10) % 10 !== 0),
        fc.constantFrom(...CURRENCIES),
        (cents, currency) => {
          const source = D(String(cents)).div('100');
          const moved = D(String(cents + 1)).div('100');
          const text = `Le montant retenu est ${fmtMoney(moved, currency)}.`;
          const report = auditText(text, { amount: source.toString() });
          expect(report.unanchored).toHaveLength(1);
        },
      ),
      { numRuns: 500 },
    );
  });
});
