/**
 * Fiscalité des prêts participatifs. Trois choses sont gardées ici : la case (2TT et non 2TR), la
 * date d'effet du taux (qui n'est PAS celle des cessions), et la mécanique des cohortes de pertes.
 */
import { describe, expect, it } from 'vitest';
import { rateFor } from '../tax-fr';
import { computeLending } from './compute';
import { LOSS_CAP_EUR, TAX_BOXES, lendingTaxFr, rcmRateFor } from './tax-fr';
import type { Loan, LoanEvent } from './types';

const loan = (id: string): Loan => ({
  id,
  accountId: 'lend:bienpreter',
  platform: 'bienpreter',
  borrower: `B-${id}`,
  label: id,
  principal: '10000',
  rate: '0.1',
  dayCount: 'unknown',
  amortisation: 'unknown',
  subscribedAt: '2019-01-01T00:00:00',
  maturity: null,
  currency: 'eur',
  sector: null,
});

const sub = (id: string, at: string, amount: string): LoanEvent => ({
  id: `s:${id}`,
  loanId: id,
  at,
  kind: 'subscription',
  amount,
});

const rep = (id: string, at: string, interest: string, withheld: string): LoanEvent => ({
  id: `r:${id}:${at}`,
  loanId: id,
  at,
  kind: 'repayment',
  principal: '0',
  interest,
  withheld,
});

const writeOff = (id: string, at: string): LoanEvent => ({
  id: `w:${id}`,
  loanId: id,
  at,
  kind: 'write-off',
  proof: 'failed-proceedings',
});

const recovery = (
  id: string,
  at: string,
  principal: string,
  interest: string,
  withheld: string,
): LoanEvent => ({
  id: `rc:${id}:${at}`,
  loanId: id,
  at,
  kind: 'recovery',
  principal,
  interest,
  withheld,
});

function ledger(loans: Loan[], events: LoanEvent[], throughYear: number) {
  const report = computeLending({ loans, events, asOf: `${throughYear}-12-31` });
  return lendingTaxFr({ report, events, throughYear });
}

describe('la case n’est pas celle du régime général', () => {
  it('vise 2TT, pas 2TR', () => {
    expect(TAX_BOXES.interest.box).toBe('2TT');
    expect(TAX_BOXES.interest.ref).toContain('125-00 A');
  });
});

describe('le taux des revenus de placement n’a pas la date d’effet des cessions', () => {
  it('reste à 30 % sur les intérêts versés en 2025, alors que les cessions sont déjà à 31,4 %', () => {
    expect(rcmRateFor(2025).pfu).toBe('0.30');
    // Le module des cessions, lui, applique déjà 31,4 % à 2025 : c'est la divergence que ce
    // module existe pour porter. Réutiliser `rateFor()` donnerait un taux faux.
    expect(rateFor(2025).pfu).toBe('0.314');
  });

  it('passe à 31,4 % sur les intérêts versés à partir de 2026', () => {
    expect(rcmRateFor(2026).pfu).toBe('0.314');
    expect(rcmRateFor(2026).social).toBe('0.186');
  });

  /**
   * Le croisement avec la veille (`format/tax-source.test.ts`) écarte les identifiants vides avant
   * de chercher : un `sourceId` à `""` y passerait inaperçu, et le taux perdrait sa source sans que
   * rien ne rougisse (même piège que `income-tax-fr.test.ts`). D'où l'assertion nominative ici.
   */
  it('porte le libellé et l’identifiant de veille exacts, pas seulement le taux', () => {
    expect(rcmRateFor(2025).label).toBe('30 % (12,8 % + 17,2 %)');
    expect(rcmRateFor(2026).label).toBe('31,4 % (12,8 % + 18,6 %)');
    expect(rcmRateFor(2026).sourceId).toBe('pfu-rcm-31_4');
  });
});

describe('ventilation du prélèvement réellement retenu', () => {
  it('répartit le montant retenu au prorata légal, sans jamais le recalculer', () => {
    const y = ledger(
      [loan('a')],
      [sub('a', '2025-01-01T00:00:00', '1000'), rep('a', '2025-06-01T00:00:00', '100', '30')],
      2025,
    ).years.find((x) => x.year === 2025)!;
    expect(y.interestGross).toBe('100');
    expect(y.withheld).toBe('30'); // fait : ce que la plateforme a retenu
    // 30 × 12,8/30 = 12,8 ; le reste en prélèvements sociaux.
    expect(Number(y.incomeTaxCredit)).toBeCloseTo(12.8, 10);
    expect(Number(y.socialPaid)).toBeCloseTo(17.2, 10);
    expect(Number(y.incomeTaxCredit) + Number(y.socialPaid)).toBeCloseTo(30, 10);
  });
});

describe('la ventilation se lit dans le taux effectif, elle ne se présume pas', () => {
  const year = (interest: string, withheld: string) =>
    ledger(
      [loan('a')],
      [
        sub('a', '2025-01-01T00:00:00', '10000'),
        rep('a', '2025-06-01T00:00:00', interest, withheld),
      ],
      2025,
    ).years.find((x) => x.year === 2025)!;

  it('reconnaît un PFU complet et le ventile', () => {
    const y = year('100', '30');
    expect(y.withholding).toBe('full');
    expect(Number(y.incomeTaxCredit)).toBeCloseTo(12.8, 10);
    expect(Number(y.socialPaid)).toBeCloseTo(17.2, 10);
  });

  it('reconnaît une dispense d’acompte : prélèvements sociaux seuls, aucun crédit d’impôt', () => {
    // 17,2 % seulement : l'acompte de 12,8 % n'a pas été prélevé (art. 242 quater). Annoncer un
    // crédit d'impôt de 12,8 % ici serait une erreur de déclaration.
    const y = year('100', '17.2');
    expect(y.withholding).toBe('social-only');
    expect(y.incomeTaxCredit).toBe('0');
    expect(y.socialPaid).toBe('17.2');
  });

  it('tolère l’arrondi d’échéance autour d’un taux légal', () => {
    expect(year('1535.88', '461.28').withholding).toBe('full'); // 30,03 %
    expect(year('294.38', '50.60').withholding).toBe('social-only'); // 17,19 %
  });

  it('ne ventile RIEN quand le taux ne correspond à aucun régime connu', () => {
    const y = year('100', '22');
    expect(y.withholding).toBe('unknown');
    expect(y.incomeTaxCredit).toBeNull();
    expect(y.socialPaid).toBeNull();
    expect(y.withheld).toBe('22'); // le fait, lui, reste affiché
  });

  it('ne ventile rien non plus quand rien n’a été retenu', () => {
    const y = year('100', '0');
    expect(y.withholding).toBe('none');
    expect(y.incomeTaxCredit).toBe('0');
  });

  it('ne ventile rien non plus quand aucun intérêt brut n’a été perçu, même avec un prélèvement', () => {
    // gross <= 0 : un taux effectif ne se calcule pas sur une base nulle (division par zéro dans
    // `shapeOf`). Un prélèvement sans intérêt brut en face est une anomalie, pas un régime connu.
    const y = year('0', '5');
    expect(y.withholding).toBe('unknown');
    expect(y.incomeTaxCredit).toBeNull();
    expect(y.socialPaid).toBeNull();
  });
});

describe('imputation des pertes en capital', () => {
  const scenario = (throughYear: number) =>
    ledger(
      [loan('a'), loan('b')],
      [
        sub('a', '2020-01-01T00:00:00', '10000'),
        writeOff('a', '2020-06-01T00:00:00'),
        sub('b', '2021-01-01T00:00:00', '5000'),
        rep('b', '2021-06-01T00:00:00', '3000', '900'),
        rep('b', '2022-06-01T00:00:00', '9000', '2700'),
      ],
      throughYear,
    );

  it('reporte la perte quand l’année n’offre aucun intérêt à absorber', () => {
    const y2020 = scenario(2020).years.find((x) => x.year === 2020)!;
    expect(y2020.lossRealised).toBe('10000');
    expect(y2020.lossImputed).toBe('0');
    expect(y2020.carryForward).toEqual([{ origin: 2020, amount: '10000' }]);
    // Pendant positif du test « garde-fous » : une perte réelle doit lever le signal.
    expect(scenario(2020).hasLosses).toBe(true);
  });

  it('n’impute jamais plus que les intérêts de l’année', () => {
    const y2021 = scenario(2021).years.find((x) => x.year === 2021)!;
    expect(y2021.lossImputed).toBe('3000');
    expect(y2021.taxableInterest).toBe('0');
    expect(y2021.carryForward).toEqual([{ origin: 2020, amount: '7000' }]);
  });

  it('respecte le plafond annuel de 8 000 €', () => {
    const y2022 = scenario(2022).years.find((x) => x.year === 2022)!;
    // 9 000 € d'intérêts, plafond 8 000 €, reste 7 000 € de perte : on impute 7 000.
    expect(LOSS_CAP_EUR).toBe('8000');
    expect(y2022.lossImputed).toBe('7000');
    expect(y2022.taxableInterest).toBe('2000');
    expect(y2022.carryForward).toEqual([]);
  });

  it('plafonne bien à 8 000 € quand la perte disponible dépasse le plafond', () => {
    const y = ledger(
      [loan('a'), loan('b')],
      [
        sub('a', '2024-01-01T00:00:00', '20000'),
        writeOff('a', '2024-06-01T00:00:00'),
        sub('b', '2024-01-01T00:00:00', '5000'),
        rep('b', '2024-06-01T00:00:00', '12000', '3600'),
      ],
      2024,
    ).years.find((x) => x.year === 2024)!;
    expect(y.lossImputed).toBe('8000'); // et non 12 000
    expect(y.taxableInterest).toBe('4000');
  });

  it('éteint une cohorte au-delà de cinq ans, et le dit au lieu de l’oublier', () => {
    const years = ledger(
      [loan('a'), loan('b')],
      [
        sub('a', '2020-01-01T00:00:00', '10000'),
        writeOff('a', '2020-06-01T00:00:00'),
        sub('b', '2026-01-01T00:00:00', '5000'),
        rep('b', '2026-06-01T00:00:00', '4000', '1256'),
      ],
      2026,
    ).years;
    const y2025 = years.find((x) => x.year === 2025)!;
    expect(y2025.carryForward).toEqual([{ origin: 2020, amount: '10000' }]); // encore vivante
    const y2026 = years.find((x) => x.year === 2026)!;
    expect(y2026.expired).toBe('10000');
    expect(y2026.lossImputed).toBe('0'); // périmée avant d'avoir pu servir
    expect(y2026.taxableInterest).toBe('4000');
  });

  it('impute la cohorte la plus ancienne en premier — c’est elle qui expire', () => {
    const y = ledger(
      [loan('a'), loan('b'), loan('c')],
      [
        sub('a', '2022-01-01T00:00:00', '3000'),
        writeOff('a', '2022-06-01T00:00:00'),
        sub('b', '2023-01-01T00:00:00', '3000'),
        writeOff('b', '2023-06-01T00:00:00'),
        sub('c', '2023-01-01T00:00:00', '5000'),
        rep('c', '2023-06-01T00:00:00', '2000', '600'),
      ],
      2023,
    ).years.find((x) => x.year === 2023)!;
    expect(y.lossImputed).toBe('2000');
    // La cohorte 2022 a été entamée la première : il lui reste 1 000, celle de 2023 est intacte.
    expect(y.carryForward).toEqual([
      { origin: 2022, amount: '1000' },
      { origin: 2023, amount: '3000' },
    ]);
  });
});

describe('un recouvrement après une perte reste rattaché à l’année du constat', () => {
  it('rattache la perte nette à l’année de la mise en perte, et compte l’intérêt du recouvrement dans la sienne', () => {
    const l = ledger(
      [loan('a')],
      [
        sub('a', '2020-01-01T00:00:00', '10000'),
        writeOff('a', '2020-06-01T00:00:00'),
        recovery('a', '2021-06-01T00:00:00', '4000', '200', '60'),
      ],
      2021,
    );
    const y2020 = l.years.find((x) => x.year === 2020)!;
    const y2021 = l.years.find((x) => x.year === 2021)!;
    // La perte nette (10 000 − 4 000 de recouvrement, TAX_ASSUMPTIONS[3]) reste à 2020 : ce n’est
    // pas parce que le recouvrement s’encaisse en 2021 que la perte s’y déplace.
    expect(y2020.lossRealised).toBe('6000');
    expect(y2020.carryForward).toEqual([{ origin: 2020, amount: '6000' }]);
    // Un recouvrement porte aussi un intérêt réel, encaissé en 2021 : il doit compter dans SON
    // année à lui, distincte de l’année d’origine de la perte.
    expect(y2021.interestGross).toBe('200');
    expect(y2021.withheld).toBe('60');
    expect(y2021.lossImputed).toBe('200');
    expect(y2021.carryForward).toEqual([{ origin: 2020, amount: '5800' }]);
  });
});

describe('la première année se retrouve même quand les événements n’arrivent pas dans l’ordre', () => {
  it('démarre à la plus ancienne année, pas à la première rencontrée dans le tableau', () => {
    const l = ledger(
      [loan('a')],
      [
        rep('a', '2024-06-01T00:00:00', '300', '90'),
        rep('a', '2022-06-01T00:00:00', '100', '30'), // la plus ancienne, au milieu du tableau
        rep('a', '2023-06-01T00:00:00', '200', '60'),
      ],
      2024,
    );
    expect(l.years.map((y) => y.year)).toEqual([2022, 2023, 2024]);
    expect(l.years.find((y) => y.year === 2022)?.interestGross).toBe('100');
  });
});

describe('une date d’événement illisible n’emporte pas les autres années', () => {
  it('ignore l’événement à l’année illisible sans perdre les années valides', () => {
    const l = ledger(
      [loan('a')],
      [
        rep('a', 'date-illisible', '999', '300'), // yearOf() ne peut en tirer aucune année
        rep('a', '2024-06-01T00:00:00', '100', '30'),
      ],
      2024,
    );
    expect(l.years.map((y) => y.year)).toEqual([2024]);
    expect(l.years[0]?.interestGross).toBe('100');
  });
});

describe('garde-fous du grand livre', () => {
  it('ne rend aucune année quand il n’y a rien à déclarer', () => {
    const empty = lendingTaxFr({
      report: computeLending({ loans: [], events: [], asOf: '2026-12-31' }),
      events: [],
      throughYear: 2026,
    });
    expect(empty.years).toEqual([]);
    expect(empty.hasLosses).toBe(false);
  });

  it('ne signale aucune perte tant qu’aucun prêt n’a été passé en perte', () => {
    // hasLosses conditionne l’avertissement « faites vérifier » (TAX_ASSUMPTIONS[3]) : il ne doit
    // pas s’allumer quand il n’y a eu aucune perte, même sur plusieurs années avec des intérêts.
    const l = ledger(
      [loan('a')],
      [
        sub('a', '2024-01-01T00:00:00', '5000'),
        rep('a', '2024-06-01T00:00:00', '200', '60'),
        rep('a', '2025-06-01T00:00:00', '200', '60'),
      ],
      2025,
    );
    expect(l.hasLosses).toBe(false);
    expect(l.years.map((y) => y.lossRealised)).toEqual(['0', '0']);
  });

  it('énonce ses hypothèses au lieu de les faire passer pour du droit', () => {
    const l = ledger([loan('a')], [sub('a', '2025-01-01T00:00:00', '100')], 2025);
    expect(l.assumptions).toHaveLength(4);
    expect(l.assumptions[0]).toContain('plus anciennes');
    expect(l.assumptions[1]).toContain('8 000');
    // Le mot que l’utilisateur lit sous un taux qui ne correspond à aucun régime connu.
    expect(l.assumptions[2]).toContain('ventilé du tout');
    // La réserve qui l’avertit qu’une imputation déjà faite serait à revoir après un recouvrement.
    expect(l.assumptions[3]).toContain('faites-la vérifier');
  });
});
