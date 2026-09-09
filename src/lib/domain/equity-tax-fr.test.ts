/**
 * Fiscalité des cessions de titres — art. 150-0 D.
 *
 * Le premier test de ce fichier est un **oracle indépendant** : l'exemple chiffré que
 * l'administration publie au BOFiP (BOI-RPPM-PVBMI-20-10-20-40), recalculé par le moteur. Aucune
 * ligne de production ne connaît ces nombres ; s'ils sortent, c'est que la méthode est la bonne.
 */
import { describe, expect, it } from 'vitest';
import { computePortfolio } from './engine/aggregate';
import type { PortfolioReport } from './engine/report';
import { equityTaxFr } from './equity-tax-fr';
import { toDecimalString } from './money';
import { DEFAULT_ENGINE_SETTINGS, type LedgerEvent, type TradeEvent } from './types';

let seq = 0;
const base = () => ({
  id: `e${++seq}`,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main' as const,
  rowKeys: [],
  warnings: [],
});
const trade = (
  at: string,
  out: [string, string],
  into: [string, string],
  eur: string,
): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset: out[0], qty: out[1] },
  in: { asset: into[0], qty: into[1] },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
/** Achat de titres : on paie des euros, on reçoit des titres. `eur` = coût all-in. */
const buy = (at: string, asset: string, qty: string, eur: string) =>
  trade(at, ['eur', eur], [asset, qty], eur);
/** Cession : on remet des titres, on reçoit des euros. `eur` = produit net de frais. */
const sell = (at: string, asset: string, qty: string, eur: string) =>
  trade(at, [asset, qty], ['eur', eur], eur);

const report = (events: LedgerEvent[]): PortfolioReport =>
  computePortfolio({ events, prices: {}, settings: DEFAULT_ENGINE_SETTINGS });
const tax = (events: LedgerEvent[], throughYear = 2026) =>
  equityTaxFr({ report: report(events), throughYear });
const yearOf = (events: LedgerEvent[], year: number, throughYear = 2026) =>
  tax(events, throughYear).years.find((y) => y.year === year);

describe('oracle du BOFiP : l’exemple officiel du prix moyen pondéré', () => {
  /**
   * BOI-RPPM-PVBMI-20-10-20-40, § 1 : 100 titres à 95 €, 200 à 105 €, 100 à 107 € — soit un prix
   * moyen pondéré de 103 € — puis cession de 150 titres à 110 €.
   */
  const OFFICIEL = [
    buy('2025-01-05T10:00:00', 'eq:soc', '100', '9500'),
    buy('2025-02-05T10:00:00', 'eq:soc', '200', '21000'),
    buy('2025-03-05T10:00:00', 'eq:soc', '100', '10700'),
    sell('2025-06-05T10:00:00', 'eq:soc', '150', '16500'),
  ];

  it('rend le prix moyen pondéré de 103 € que publie l’administration', () => {
    const avant = report(OFFICIEL.slice(0, 3)).equities.find((p) => p.asset === 'eq:soc');
    expect(toDecimalString(avant!.pru!)).toBe('103');
  });

  it('rend la plus-value de 1 050 € que publie l’administration', () => {
    // 16 500 − 150 × 103. Le chiffre vient du BOFiP, pas du code.
    expect(yearOf(OFFICIEL, 2025)!.gainsEur).toBe('1050');
    expect(yearOf(OFFICIEL, 2025)!.cessions.map((c) => c.costEur)).toEqual(['15450']);
  });

  it('laisse le PMP du reliquat INCHANGÉ — « n’est pas affectée par les ventes » (§ 50)', () => {
    // La propriété la plus facile à casser sans s'en apercevoir : une méthode qui recalculerait la
    // moyenne après la vente donnerait un autre prix de revient, donc une autre plus-value
    // ensuite. 250 titres restants, 25 750 € de coût, toujours 103 € l'unité.
    const apres = report(OFFICIEL).equities.find((p) => p.asset === 'eq:soc');
    expect(toDecimalString(apres!.qty)).toBe('250');
    expect(toDecimalString(apres!.costBasis)).toBe('25750');
    expect(toDecimalString(apres!.pru!)).toBe('103');
  });
});

describe('l’année, et ce qui va case 3VH', () => {
  it('compense d’abord DANS l’année : la case ne reçoit que le solde', () => {
    const y = yearOf(
      [
        buy('2025-01-05T10:00:00', 'eq:a', '10', '1000'),
        buy('2025-01-06T10:00:00', 'eq:b', '10', '1000'),
        sell('2025-05-05T10:00:00', 'eq:a', '10', '1300'),
        sell('2025-06-05T10:00:00', 'eq:b', '10', '500'),
      ],
      2025,
    )!;
    expect([y.gainsEur, y.lossesEur, y.netEur]).toEqual(['300', '500', '-200']);
    expect(y.lossOfYearEur).toBe('200');
    expect(y.taxableEur).toBe('0');
  });

  it('3VH ne CUMULE JAMAIS les moins-values antérieures', () => {
    // « Les moins-values des années antérieures ne doivent pas être cumulées avec la moins-value
    // de l'année ligne 3VH. » Le cumul, lui, vit sur la 2074.
    const events = [
      buy('2025-01-05T10:00:00', 'eq:a', '10', '1000'),
      sell('2025-05-05T10:00:00', 'eq:a', '10', '900'),
      buy('2026-01-05T10:00:00', 'eq:b', '10', '1000'),
      sell('2026-05-05T10:00:00', 'eq:b', '10', '950'),
    ];
    expect(yearOf(events, 2025)!.lossOfYearEur).toBe('100');
    const y26 = yearOf(events, 2026)!;
    expect(y26.lossOfYearEur).toBe('50');
    expect(y26.carryForward.map((c) => `${c.origin}:${c.amount}`)).toEqual(['2025:100', '2026:50']);
  });

  it('impute les moins-values antérieures sur un net positif, la plus ancienne d’abord', () => {
    const events = [
      buy('2024-01-05T10:00:00', 'eq:a', '10', '1000'),
      sell('2024-05-05T10:00:00', 'eq:a', '10', '900'),
      buy('2025-01-05T10:00:00', 'eq:b', '10', '1000'),
      sell('2025-05-05T10:00:00', 'eq:b', '10', '950'),
      buy('2026-01-05T10:00:00', 'eq:c', '10', '1000'),
      sell('2026-05-05T10:00:00', 'eq:c', '10', '1120'),
    ];
    const y = yearOf(events, 2026)!;
    // 120 de gain, 100 (2024) puis 20 (2025) imputés : il reste 30 de la cohorte 2025.
    expect([y.netEur, y.carryImputedEur, y.taxableEur]).toEqual(['120', '120', '0']);
    expect(y.carryForward.map((c) => `${c.origin}:${c.amount}`)).toEqual(['2025:30']);
  });

  it('une moins-value s’éteint après dix ans, et le dit', () => {
    const events = [
      buy('2015-01-05T10:00:00', 'eq:a', '10', '1000'),
      sell('2015-05-05T10:00:00', 'eq:a', '10', '900'),
      buy('2026-01-05T10:00:00', 'eq:b', '10', '1000'),
      sell('2026-05-05T10:00:00', 'eq:b', '10', '1500'),
    ];
    const y = yearOf(events, 2026)!;
    // Onzième année : la cohorte 2015 est perdue, elle ne s'impute plus sur les 500 de gain.
    expect(y.expiredEur).toBe('100');
    expect([y.carryImputedEur, y.taxableEur]).toEqual(['0', '500']);
    // Un an plus tôt, elle servait encore.
    expect(
      yearOf(
        events
          .slice(0, 2)
          .concat(
            buy('2025-01-05T10:00:00', 'eq:b', '10', '1000'),
            sell('2025-05-05T10:00:00', 'eq:b', '10', '1500'),
          ),
        2025,
        2025,
      )!.carryImputedEur,
    ).toBe('100');
  });
});

describe('le périmètre, et le taux', () => {
  it('ne prend QUE les titres : une cession de crypto n’entre pas dans l’assiette', () => {
    // Symétrique de `touchesEquity` côté 150 VH bis. Mélanger les deux assiettes fausserait les
    // deux : l'une raisonne par ligne, l'autre sur le portefeuille entier.
    const y = yearOf(
      [
        buy('2025-01-05T10:00:00', 'btc', '1', '30000'),
        sell('2025-05-05T10:00:00', 'btc', '1', '50000'),
        buy('2025-01-06T10:00:00', 'eq:a', '10', '1000'),
        sell('2025-06-05T10:00:00', 'eq:a', '10', '1100'),
      ],
      2025,
    )!;
    expect(y.gainsEur).toBe('100');
    expect(y.cessions.map((c) => c.asset)).toEqual(['eq:a']);
  });

  it('rattache la cession à l’année de la CESSION, pas de l’acquisition', () => {
    const events = [
      buy('2025-11-05T10:00:00', 'eq:a', '10', '1000'),
      sell('2026-01-05T10:00:00', 'eq:a', '10', '1200'),
    ];
    // Le millésime 2025 n'existe même pas : rien n'y a été cédé, donc rien n'y est à déclarer.
    expect(tax(events).years.map((y) => y.year)).toEqual([2026]);
    expect(yearOf(events, 2026)!.gainsEur).toBe('200');
  });

  it('applique le taux du millésime : 30 % avant 2025, 31,4 % ensuite', () => {
    const gain = (an: string) => [
      buy(`${an}-01-05T10:00:00`, 'eq:a', '10', '1000'),
      sell(`${an}-05-05T10:00:00`, 'eq:a', '10', '2000'),
    ];
    expect(yearOf(gain('2024'), 2024, 2024)!.taxEur).toBe('300');
    expect(yearOf(gain('2025'), 2025, 2025)!.taxEur).toBe('314');
  });

  it('les frais de cession réduisent la plus-value, et une seule fois', () => {
    // Le pivot rend déjà un produit NET de frais et un coût all-in (décision n° 126) : les
    // retrancher ici les compterait deux fois.
    const sansFrais = yearOf(
      [
        buy('2025-01-05T10:00:00', 'eq:a', '10', '1000'),
        sell('2025-05-05T10:00:00', 'eq:a', '10', '1200'),
      ],
      2025,
    )!;
    const avecFrais = yearOf(
      [
        buy('2025-01-05T10:00:00', 'eq:a', '10', '1000'),
        sell('2025-05-05T10:00:00', 'eq:a', '10', '1180'),
      ],
      2025,
    )!;
    expect([sansFrais.gainsEur, avecFrais.gainsEur]).toEqual(['200', '180']);
  });

  it('un portefeuille sans aucune cession de titre ne produit aucun millésime', () => {
    expect(tax([buy('2025-01-05T10:00:00', 'eq:a', '10', '1000')]).years).toEqual([]);
  });
});
