/**
 * Propriétés du tableau comparatif (fast-check, décision n° 170).
 *
 * Elles portent sur ce qu'un lecteur croira en regardant l'écran, et qu'un exemple ne dit que
 * pour un couple de chiffres :
 *
 * 1. **Les prélèvements sociaux ne bougent jamais.** C'est l'affirmation que l'écran répète à
 *    chaque carte ; si un jour quelqu'un « améliorait » la colonne barème en y imputant la CSG
 *    déductible, cette propriété rougirait avant l'utilisateur.
 * 2. **Chaque total est la somme de ses deux parts**, pour les deux colonnes.
 * 3. **L'échelle est monotone** : le barème coûte d'autant plus que la tranche est haute. Sans
 *    cela, « jusqu'à telle tranche incluse » ne voudrait rien dire.
 * 4. **La bascule est un préfixe** : toutes les tranches jusqu'à elle sont favorables au barème,
 *    toutes celles d'après lui sont défavorables. C'est la phrase même de l'écran.
 * 5. **Le verdict et l'écart disent la même chose** : l'un est nul si et seulement si l'autre
 *    annonce l'égalité.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DeclarationReport } from '../domain/declarations-fr';
import type { DividendTaxLedger } from '../domain/equity-income-fr';
import type { EquityTaxLedger } from '../domain/equity-tax-fr';
import { MARGINAL_RATES } from '../domain/income-tax-fr';
import type { InterestTaxLedger } from '../domain/interest-income-fr';
import type { LendingTaxLedger } from '../domain/lending/tax-fr';
import { D, ZERO } from '../domain/money';
import { rateFor, type TaxLedger } from '../domain/tax-fr';
import { arbitrate } from './pfu-vs-bareme';
import { taxChoice, type TaxChoice } from './tax-choice';

const YEAR = 2025;
const SOCIAL = D(rateFor(YEAR).social);

function ledger(netEur: string): TaxLedger {
  return {
    cessions: [],
    years: [
      {
        year: YEAR,
        proceedsEur: '500000',
        cessionCount: 1,
        gainsEur: netEur,
        lossesEur: '0',
        netEur,
        exempt: false,
        rate: rateFor(YEAR).pfu,
        rateLabel: rateFor(YEAR).label,
        taxEur: '0',
        unknownGlobalValue: 0,
      },
    ],
    ptaAfter: '0',
    unknownGlobalValue: 0,
    externalInflows: 0,
    externalOutflows: 0,
    rewards: 0,
  };
}

function choiceFor(netEur: string, rate: string): TaxChoice {
  const arbitrage = arbitrate(
    {
      year: YEAR,
      crypto: ledger(netEur),
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
    },
    '3CN',
  );
  return taxChoice(arbitrage, { kind: 'bracket', rate })!;
}

/** Une plus-value nette au centime, d'un centime à un million. */
const net = fc.integer({ min: 1, max: 100_000_000 }).map((c) => D(String(c)).div(D('100')));
const rate = fc.constantFrom(...MARGINAL_RATES);

describe('propriétés du tableau comparatif', () => {
  it('les prélèvements sociaux sont les mêmes des deux côtés, et valent le taux social de l’année', () => {
    fc.assert(
      fc.property(net, rate, (amount, r) => {
        const choice = choiceFor(amount.toString(), r);
        expect(choice.flat.socialTaxEur).toBe(choice.scale.socialTaxEur);
        expect(D(choice.flat.socialTaxEur).eq(amount.times(SOCIAL))).toBe(true);
      }),
    );
  });

  it('chaque total est la somme de son impôt et de ses prélèvements sociaux', () => {
    fc.assert(
      fc.property(net, rate, (amount, r) => {
        for (const side of [
          choiceFor(amount.toString(), r).flat,
          choiceFor(amount.toString(), r).scale,
        ]) {
          expect(D(side.totalEur).eq(D(side.incomeTaxEur).plus(D(side.socialTaxEur)))).toBe(true);
        }
      }),
    );
  });

  it('le barème coûte d’autant plus que la tranche est haute', () => {
    fc.assert(
      fc.property(net, (amount) => {
        const { ladder } = choiceFor(amount.toString(), '0');
        for (let i = 1; i < ladder.length; i += 1) {
          expect(D(ladder[i]!.baremeEur).gte(D(ladder[i - 1]!.baremeEur))).toBe(true);
          expect(D(ladder[i]!.deltaEur).gte(D(ladder[i - 1]!.deltaEur))).toBe(true);
        }
      }),
    );
  });

  it('la bascule est un préfixe : avant elle le barème gagne, après il perd', () => {
    fc.assert(
      fc.property(net, (amount) => {
        const { ladder } = choiceFor(amount.toString(), '0');
        const pivot = ladder.findIndex((step) => step.isBreakEven);
        expect(pivot).toBeGreaterThanOrEqual(0);
        ladder.forEach((step, i) => {
          expect(D(step.deltaEur).lte(ZERO)).toBe(i <= pivot);
        });
      }),
    );
  });

  it('le verdict d’égalité et l’écart nul vont toujours ensemble', () => {
    fc.assert(
      fc.property(net, rate, (amount, r) => {
        const choice = choiceFor(amount.toString(), r);
        expect(choice.cheaper === 'equal').toBe(D(choice.gapEur).eq(ZERO));
      }),
    );
  });
});
