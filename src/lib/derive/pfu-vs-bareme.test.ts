/**
 * L'arbitrage forfait / barème (décision n° 150).
 *
 * Ce que ces tests surveillent est un **écart en euros** dont quelqu'un tirera une décision. Les
 * chiffres attendus sont donc posés à la main, à partir de la formule et de rien d'autre :
 * `barème = (assiette après abattement − CSG déductible) × taux`, `forfait = assiette × 12,8 %`.
 */
import { describe, expect, it } from 'vitest';
import type { DeclarationReport } from '../domain/declarations-fr';
import type { DividendTaxLedger, DividendTaxYear } from '../domain/equity-income-fr';
import type { EquityTaxLedger, EquityTaxYear } from '../domain/equity-tax-fr';
import type { InterestTaxLedger, InterestTaxYear } from '../domain/interest-income-fr';
import { rcmRateFor, type LendingTaxLedger, type LendingTaxYear } from '../domain/lending/tax-fr';
import { D } from '../domain/money';
import { rateFor, type TaxLedger, type TaxYear } from '../domain/tax-fr';
import { arbitrages, arbitrate } from './pfu-vs-bareme';
import type { TaxReturnInput } from './tax-return';

const YEAR = 2025;

const empty = {
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

const input = (over: Partial<TaxReturnInput> = {}): TaxReturnInput => ({
  year: YEAR,
  crypto: null,
  ...empty,
  ...over,
});

const crypto = (over: Partial<TaxYear> = {}): TaxLedger => ({
  cessions: [],
  years: [
    {
      year: YEAR,
      proceedsEur: '50000',
      cessionCount: 1,
      gainsEur: '10000',
      lossesEur: '0',
      netEur: '10000',
      exempt: false,
      rate: rateFor(YEAR).pfu,
      rateLabel: rateFor(YEAR).label,
      taxEur: '0',
      unknownGlobalValue: 0,
      ...over,
    },
  ],
  ptaAfter: '0',
  unknownGlobalValue: 0,
  externalInflows: 0,
  externalOutflows: 0,
  rewards: 0,
});

const dividends = (over: Partial<DividendTaxYear> = {}): DividendTaxLedger => ({
  years: [
    {
      year: YEAR,
      countries: [],
      grossEur: '10000',
      withheldEur: '0',
      declaredEur: '10000',
      creditEur: '0',
      netForeignEur: '0',
      excessEur: '0',
      undesignated: [],
      ...over,
    },
  ],
  assumptions: [],
  hasUndesignated: false,
});

const interest = (over: Partial<InterestTaxYear> = {}): InterestTaxLedger => ({
  years: [{ year: YEAR, grossEur: '1000', withheldEur: '0', count: 2, ...over }],
  assumptions: [],
  hasWithholding: false,
});

const lending = (over: Partial<LendingTaxYear> = {}): LendingTaxLedger => ({
  years: [
    {
      year: YEAR,
      rate: rcmRateFor(YEAR),
      withholding: 'full',
      interestGross: '1000',
      withheld: '300',
      incomeTaxCredit: '128',
      socialPaid: '172',
      socialisedInterest: '1000',
      lossRealised: '0',
      lossImputed: '0',
      taxableInterest: '1000',
      carryForward: [],
      expired: '0',
      ...over,
    },
  ],
  assumptions: [],
  hasLosses: false,
});

const equity = (over: Partial<EquityTaxYear> = {}): EquityTaxLedger => ({
  years: [
    {
      year: YEAR,
      rate: rateFor(YEAR),
      cessions: [],
      proceedsEur: '0',
      gainsEur: '5000',
      lossesEur: '0',
      netEur: '5000',
      lossOfYearEur: '0',
      carryImputedEur: '0',
      carryForward: [],
      expiredEur: '0',
      taxableEur: '5000',
      taxEur: '0',
      ...over,
    },
  ],
  assumptions: [],
  hasLosses: false,
});

const at = (result: ReturnType<typeof arbitrate>, rate: string): string =>
  result.scenarios.find((s) => s.rate === rate)!.deltaEur;

// --- Rien à arbitrer ----------------------------------------------------------------------------

describe('une année sans assiette', () => {
  it('ne rend ni scénario ni seuil', () => {
    for (const option of ['2OP', '3CN'] as const) {
      const result = arbitrate(input(), option);
      expect(result.bases, option).toEqual([]);
      expect(result.scenarios, option).toEqual([]);
      expect(result.breakEvenRate, option).toBeNull();
      expect(result.flatEur, option).toBe('0');
    }
  });

  it('n’arbitre pas une plus-value crypto exonérée par le seuil de 305 €', () => {
    const result = arbitrate(
      input({ crypto: crypto({ proceedsEur: '200', exempt: true }) }),
      '3CN',
    );
    expect(result.bases).toEqual([]);
  });

  it('n’arbitre pas une moins-value : il n’y a pas d’impôt à comparer', () => {
    const result = arbitrate(input({ crypto: crypto({ netEur: '-4000' }) }), '3CN');
    expect(result.bases).toEqual([]);
  });

  it('ignore l’année qui n’est pas celle demandée', () => {
    const other = crypto();
    other.years[0]!.year = YEAR - 1;
    expect(arbitrate(input({ crypto: other }), '3CN').bases).toEqual([]);
  });
});

// --- Le calcul, chiffre par chiffre -------------------------------------------------------------

describe('3CN — les plus-values de crypto-actifs', () => {
  const result = (): ReturnType<typeof arbitrate> => arbitrate(input({ crypto: crypto() }), '3CN');

  it('chiffre le forfait à 12,8 % de l’assiette, prélèvements sociaux exclus', () => {
    // 10 000 × 12,8 % = 1 280. Les 18,6 % de prélèvements sociaux sont dus dans les deux branches.
    expect(result().flatEur).toBe('1280');
    expect(result().totalTaxableEur).toBe('10000');
  });

  it('rend déductibles 6,8 points de CSG, que le forfait ne rend jamais', () => {
    expect(result().csgDeductibleEur).toBe('680');
  });

  it('chiffre le barème tranche par tranche, CSG déductible comprise', () => {
    // (10 000 − 680) × taux.
    expect(result().scenarios).toEqual([
      { rate: '0', baremeEur: '0', deltaEur: '-1280' },
      { rate: '0.11', baremeEur: '1025.2', deltaEur: '-254.8' },
      { rate: '0.30', baremeEur: '2796', deltaEur: '1516' },
      { rate: '0.41', baremeEur: '3821.2', deltaEur: '2541.2' },
      { rate: '0.45', baremeEur: '4194', deltaEur: '2914' },
    ]);
  });

  it('place le seuil de bascule à 11 %', () => {
    expect(result().breakEvenRate).toBe('0.11');
  });

  it('n’applique aucun abattement : les actifs numériques n’en ont pas', () => {
    expect(result().bases[0]?.abatement).toBe('0');
  });
});

describe('2OP — les revenus de capitaux mobiliers et les plus-values de titres', () => {
  it('abat 40 % des dividendes, et rien d’autre', () => {
    const result = arbitrate(input({ dividends: dividends() }), '2OP');
    expect(result.bases[0]?.abatement).toBe('0.4');
    // (10 000 × 60 % − 680) × 11 % = 5 320 × 11 % = 585,2 ; forfait = 1 280.
    expect(at(result, '0.11')).toBe('-694.8');
    expect(at(result, '0.30')).toBe('316');
  });

  it('n’abat rien sur les intérêts, dont le barème sort plus vite perdant', () => {
    const result = arbitrate(input({ interest: interest() }), '2OP');
    expect(result.bases[0]?.abatement).toBe('0');
    // (1 000 − 68) × 11 % = 102,52 ; forfait = 128.
    expect(at(result, '0.11')).toBe('-25.48');
  });

  /**
   * Le piège que ce module existe pour éviter : l'option est GLOBALE. Arbitrer sur les seuls
   * dividendes, dont l'abattement rend le barème attrayant, et découvrir ensuite qu'elle a fait
   * basculer des intérêts qui n'ont aucun abattement.
   */
  it('additionne toutes les assiettes de l’option, jamais une seule', () => {
    const both = arbitrate(input({ dividends: dividends(), interest: interest() }), '2OP');
    const alone = arbitrate(input({ dividends: dividends() }), '2OP');
    expect(both.bases.map((b) => b.family)).toEqual(['dividend', 'interest']);
    expect(both.totalTaxableEur).toBe('11000');
    // L'écart n'est pas celui des dividendes seuls : les intérêts s'y ajoutent, sans abattement.
    expect(at(both, '0.30')).not.toBe(at(alone, '0.30'));
    expect(D(at(both, '0.30')).gt(D(at(alone, '0.30')))).toBe(true);
  });

  it('ne mélange jamais les deux options : la crypto n’entre pas dans 2OP', () => {
    const result = arbitrate(input({ crypto: crypto(), dividends: dividends() }), '2OP');
    expect(result.bases.map((b) => b.family)).toEqual(['dividend']);
    expect(result.totalTaxableEur).toBe('10000');
  });

  it('prend les plus-values de titres après imputation des moins-values antérieures', () => {
    const result = arbitrate(
      input({ equity: equity({ gainsEur: '5000', carryImputedEur: '2000', taxableEur: '3000' }) }),
      '2OP',
    );
    expect(result.totalTaxableEur).toBe('3000');
  });

  /**
   * L'impôt ne frappe que les intérêts NETS de la perte imputée, mais « la totalité des intérêts
   * perçus reste soumise aux prélèvements sociaux » : les deux assiettes diffèrent, et la CSG
   * déductible suit la seconde.
   */
  it('calcule la CSG déductible des prêts sur les intérêts bruts, pas sur le net imposable', () => {
    const result = arbitrate(
      input({
        lending: lending({ interestGross: '1000', lossImputed: '400', taxableInterest: '600' }),
      }),
      '2OP',
    );
    expect(result.totalTaxableEur).toBe('600');
    expect(result.bases[0]?.csgBaseEur).toBe('1000');
    expect(result.csgDeductibleEur).toBe('68');
  });

  it('ne compte aucune CSG déductible quand la plateforme n’a rien prélevé', () => {
    const result = arbitrate(
      input({
        lending: lending({ withheld: '0', socialisedInterest: '0', withholding: 'none' }),
      }),
      '2OP',
    );
    expect(result.csgDeductibleEur).toBe('0');
  });
});

// --- Le seuil, et ce qu'il vaut ----------------------------------------------------------------

describe('le seuil de bascule', () => {
  /**
   * Constat robuste, et c'est le message de l'écran : aucun abattement de la loi actuelle
   * n'atteint 50,5 %, or il en faudrait autant pour que le barème résiste à la tranche à 30 %.
   * Le seuil est donc le même pour toutes les assiettes que cette application connaît.
   */
  it('vaut 11 % pour chaque assiette prise isolément, abattement ou non', () => {
    const cases = [
      arbitrate(input({ crypto: crypto() }), '3CN'),
      arbitrate(input({ dividends: dividends() }), '2OP'),
      arbitrate(input({ interest: interest() }), '2OP'),
      arbitrate(input({ lending: lending() }), '2OP'),
      arbitrate(input({ equity: equity() }), '2OP'),
    ];
    for (const result of cases) expect(result.breakEvenRate, result.bases[0]?.label).toBe('0.11');
  });

  it('reste le plus haut taux favorable, jamais le premier venu', () => {
    const result = arbitrate(input({ crypto: crypto() }), '3CN');
    const favourable = result.scenarios.filter((s) => D(s.deltaEur).lte(D('0'))).map((s) => s.rate);
    expect(favourable).toEqual(['0', '0.11']);
    expect(result.breakEvenRate).toBe(favourable[favourable.length - 1]);
  });
});

describe('arbitrages — les deux décisions d’une année', () => {
  it('rend 3CN avant 2OP, dans l’ordre du formulaire', () => {
    const result = arbitrages(input({ crypto: crypto(), dividends: dividends() }));
    expect(result.map((a) => a.option)).toEqual(['3CN', '2OP']);
  });

  it('n’en rend aucune quand rien ne bascule', () => {
    expect(arbitrages(input())).toEqual([]);
  });

  it('n’en rend qu’une quand une seule famille est là', () => {
    expect(arbitrages(input({ interest: interest() })).map((a) => a.option)).toEqual(['2OP']);
    expect(arbitrages(input({ crypto: crypto() })).map((a) => a.option)).toEqual(['3CN']);
  });
});

// --- Les mots, et l'année ------------------------------------------------------------------------

describe('ce que l’écran lit à côté de chaque montant', () => {
  /**
   * Chaque libellé nomme une case que quelqu'un ira chercher sur un imprimé. Le test de mutation
   * les a tous vus remplaçables par la chaîne vide (décision n° 150) : ils se vérifient en entier.
   */
  it('nomme chaque assiette par son revenu ET sa case', () => {
    const result = arbitrate(
      input({
        dividends: dividends(),
        interest: interest(),
        lending: lending(),
        equity: equity(),
      }),
      '2OP',
    );
    expect(result.bases.map((b) => [b.family, b.label])).toEqual([
      ['dividend', 'Dividendes (2DC)'],
      ['interest', 'Intérêts de trésorerie (2TR)'],
      ['lending', 'Intérêts de prêts participatifs (2TT)'],
      ['equity', 'Plus-values de valeurs mobilières (3VG)'],
    ]);
  });

  it('nomme l’assiette des actifs numériques par sa case à elle', () => {
    const result = arbitrate(input({ crypto: crypto() }), '3CN');
    expect(result.bases.map((b) => [b.family, b.label])).toEqual([
      ['crypto', 'Plus-values de crypto-actifs (3AN)'],
    ]);
  });

  it('applique à chaque assiette la part impôt sur le revenu de SON régime', () => {
    // Deux tables distinctes, et c'est voulu : la hausse de CSG n'a pas la même date d'effet pour
    // les cessions et pour les revenus de placement. La part IR, elle, vaut 12,8 % des deux côtés.
    const result = arbitrate(input({ dividends: dividends(), equity: equity() }), '2OP');
    expect(result.bases[0]?.flatRate).toBe(rcmRateFor(YEAR).incomeTax);
    expect(result.bases[1]?.flatRate).toBe(rateFor(YEAR).incomeTax);
  });
});

describe('chaque moteur rend l’année demandée, pas la première venue', () => {
  /** Même défaut que la décision n° 141, à l'échelle d'un moteur : un montant juste, mauvaise année. */
  const twoYears = <T extends { year: number }>(older: T, wanted: T): T[] => [older, wanted];

  it('les dividendes', () => {
    const ledger = dividends();
    const older = { ...ledger.years[0]!, year: YEAR - 1, declaredEur: '99999' };
    const result = arbitrate(
      input({ dividends: { ...ledger, years: twoYears(older, ledger.years[0]!) } }),
      '2OP',
    );
    expect(result.totalTaxableEur).toBe('10000');
  });

  it('les intérêts', () => {
    const ledger = interest();
    const older = { ...ledger.years[0]!, year: YEAR - 1, grossEur: '99999' };
    const result = arbitrate(
      input({ interest: { ...ledger, years: twoYears(older, ledger.years[0]!) } }),
      '2OP',
    );
    expect(result.totalTaxableEur).toBe('1000');
  });

  it('les prêts', () => {
    const ledger = lending();
    const older = { ...ledger.years[0]!, year: YEAR - 1, taxableInterest: '99999' };
    const result = arbitrate(
      input({ lending: { ...ledger, years: twoYears(older, ledger.years[0]!) } }),
      '2OP',
    );
    expect(result.totalTaxableEur).toBe('1000');
  });

  it('les titres', () => {
    const ledger = equity();
    const older = { ...ledger.years[0]!, year: YEAR - 1, taxableEur: '99999' };
    const result = arbitrate(
      input({ equity: { ...ledger, years: twoYears(older, ledger.years[0]!) } }),
      '2OP',
    );
    expect(result.totalTaxableEur).toBe('5000');
  });
});
