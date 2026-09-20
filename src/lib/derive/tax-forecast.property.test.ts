/**
 * Propriétés du prévisionnel (fast-check, décision n° 171).
 *
 * Elles portent sur ce qu'un utilisateur fera nécessairement : **changer le montant et regarder
 * bouger le résultat**. Un exemple ne dit rien de ce geste-là ; une propriété si.
 *
 * 1. **Les cessions de l'année s'additionnent exactement** : le total d'après est celui d'avant
 *    plus la vente, au centime. C'est ce que le seuil de 305 € regarde.
 * 2. **Le résultat de l'année est monotone en le montant vendu** — croissant quand le portefeuille
 *    est en plus-value, décroissant quand il est en moins-value. Sans cela, faire varier le montant
 *    donnerait des allers-retours incompréhensibles, et « vendre plus » ne voudrait rien dire.
 * 3. **La poche d'imputation n'est jamais négative**, et c'est exactement l'opposé du net quand
 *    celui-ci l'est.
 * 4. **Le franchissement du seuil ne s'annonce que lorsqu'il a lieu** : il faut être passé de
 *    dessous à dessus, pas déjà dessus.
 * 5. **La part de capital initial ne dépasse jamais le prix total d'acquisition** : le PTA restant
 *    ne devient donc jamais négatif.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DeclarationReport } from '../domain/declarations-fr';
import type { DividendTaxLedger } from '../domain/equity-income-fr';
import type { EquityTaxLedger } from '../domain/equity-tax-fr';
import type { InterestTaxLedger } from '../domain/interest-income-fr';
import type { LendingTaxLedger } from '../domain/lending/tax-fr';
import { D, ZERO, type Big } from '../domain/money';
import { EXEMPTION_THRESHOLD, rateFor, type TaxLedger, type TaxYear } from '../domain/tax-fr';
import { forecastCession, type Forecast } from './tax-forecast';
import type { TaxReturnInput } from './tax-return';

const YEAR = 2026;
const THRESHOLD = D(EXEMPTION_THRESHOLD);

function taxYear(proceedsEur: string, netEur: string): TaxYear {
  return {
    year: YEAR,
    proceedsEur,
    cessionCount: 1,
    gainsEur: '0',
    lossesEur: '0',
    netEur,
    exempt: D(proceedsEur).lte(THRESHOLD),
    rate: rateFor(YEAR).pfu,
    rateLabel: rateFor(YEAR).label,
    taxEur: '0',
    unknownGlobalValue: 0,
  };
}

function run(
  ptaAfter: string,
  globalValueEur: string,
  proceedsEur: string,
  yearProceedsEur: string,
  yearNetEur: string,
): Forecast | null {
  const crypto: TaxLedger = {
    cessions: [],
    years: [taxYear(yearProceedsEur, yearNetEur)],
    ptaAfter,
    unknownGlobalValue: 0,
    externalInflows: 0,
    externalOutflows: 0,
    rewards: 0,
  };
  const input: TaxReturnInput = {
    year: YEAR,
    crypto,
    equity: { years: [], assumptions: [], hasLosses: false } satisfies EquityTaxLedger,
    dividends: { years: [], assumptions: [], hasUndesignated: false } satisfies DividendTaxLedger,
    interest: { years: [], assumptions: [], hasWithholding: false } satisfies InterestTaxLedger,
    lending: { years: [], assumptions: [], hasLosses: false } satisfies LendingTaxLedger,
    declarations: {
      year: YEAR,
      accounts: [],
      includedCount: 0,
      uncertainCount: 0,
    } satisfies DeclarationReport,
  };
  return forecastCession(input, { kind: 'crypto', proceedsEur, feesEur: '0', globalValueEur });
}

/** Un montant au centime, d'un centime à un million. */
const cents = (max: number) => fc.integer({ min: 1, max }).map((c) => D(String(c)).div(D('100')));
const amount = cents(100_000_000);
/** Une vente qui ne dépasse pas la valeur globale de 20 000 € employée ci-dessous. */
const sellable = cents(2_000_000);
/** Le résultat déjà constaté de l'année : gain ou perte. */
const net = fc.integer({ min: -1_000_000, max: 1_000_000 }).map((c) => D(String(c)).div(D('100')));

describe('propriétés du prévisionnel', () => {
  it('les cessions de l’année s’additionnent au centime', () => {
    fc.assert(
      fc.property(amount, amount, net, (sale, already, n) => {
        const f = run('5000', '20000', sale.toString(), already.toString(), n.toString())!;
        expect(D(f.preview.yearProceedsEur).eq(already.plus(sale))).toBe(true);
      }),
    );
  });

  /**
   * **Le domaine est borné, et c'est la propriété elle-même qui l'a montré.** Au-delà de la valeur
   * globale, la monotonie tombe : le moteur borne la part de capital initial au PTA
   * (`share = min(raw, PTA)`, garde-fou contre un PTA négatif), si bien qu'une vente de plus de
   * 100 % du portefeuille repart à la hausse même sur un portefeuille en moins-value. Ce n'est pas
   * un défaut — on ne vend pas plus que ce que l'on détient, la valeur globale étant par définition
   * celle de TOUT le portefeuille. L'écran, lui, doit refuser d'aller au-delà.
   */
  it('vendre plus fait varier le résultat de l’année toujours dans le même sens', () => {
    fc.assert(
      fc.property(sellable, sellable, fc.boolean(), (a, b, portfolioInGain) => {
        // PTA sous la valeur globale : portefeuille en plus-value. Au-dessus : en moins-value.
        const pta = portfolioInGain ? '5000' : '40000';
        const [small, big]: [Big, Big] = a.lte(b) ? [a, b] : [b, a];
        const low = run(pta, '20000', small.toString(), '0', '0')!;
        const high = run(pta, '20000', big.toString(), '0', '0')!;
        const moved = D(high.preview.yearNetEur).minus(D(low.preview.yearNetEur));
        expect(portfolioInGain ? moved.gte(ZERO) : moved.lte(ZERO)).toBe(true);
      }),
    );
  });

  it('la poche d’imputation n’est jamais négative, et vaut l’opposé du net quand il l’est', () => {
    fc.assert(
      fc.property(amount, net, (sale, n) => {
        const f = run('5000', '20000', sale.toString(), '10000', n.toString())!;
        const left = D(f.pocketLeftEur);
        expect(left.gte(ZERO)).toBe(true);
        expect(D(f.pocketUsedEur).gte(ZERO)).toBe(true);
        const after = D(f.preview.yearNetEur);
        expect(left.eq(after.lt(ZERO) ? after.times(D('-1')) : ZERO)).toBe(true);
      }),
    );
  });

  it('le franchissement du seuil ne s’annonce que lorsqu’il a lieu', () => {
    fc.assert(
      fc.property(cents(60_000), cents(60_000), (sale, already) => {
        const f = run('5000', '20000', sale.toString(), already.toString(), '0')!;
        const crossed = already.lte(THRESHOLD) && already.plus(sale).gt(THRESHOLD);
        expect(f.crossesThreshold).toBe(crossed);
      }),
    );
  });

  it('la part de capital initial ne dépasse jamais le prix total d’acquisition', () => {
    fc.assert(
      fc.property(amount, amount, (sale, pta) => {
        const f = run(pta.toString(), '20000', sale.toString(), '0', '0')!;
        expect(D(f.preview.acquisitionShareEur).lte(pta)).toBe(true);
        expect(D(f.preview.ptaAfterEur).gte(ZERO)).toBe(true);
      }),
    );
  });
});
