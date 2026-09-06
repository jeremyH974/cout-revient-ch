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

  it('énonce ses hypothèses au lieu de les faire passer pour du droit', () => {
    const l = ledger([loan('a')], [sub('a', '2025-01-01T00:00:00', '100')], 2025);
    expect(l.assumptions).toHaveLength(3);
    expect(l.assumptions[0]).toContain('plus anciennes');
    expect(l.assumptions[1]).toContain('8 000');
  });
});
