/**
 * Intérêts de trésorerie : la case 2TR, et tout ce que ce module refuse de calculer.
 */
import { describe, expect, it } from 'vitest';
import {
  INTEREST_TAX_ASSUMPTIONS,
  INTEREST_TAX_BOXES,
  interestTaxFr,
  type InterestTaxInput,
} from './interest-income-fr';
import type { IncomeEvent, LedgerEvent } from './types';

let seq = 0;
const income = (at: string, gross: string, over: Partial<IncomeEvent> = {}): IncomeEvent => ({
  id: `e${++seq}`,
  source: 'manual',
  scope: 'coinhouse',
  accountId: 'etoro:main',
  rowKeys: [],
  warnings: [],
  kind: 'income',
  at,
  asset: null,
  grossEur: gross,
  withheldEur: '0',
  nature: 'interest',
  label: 'Intérêts',
  ...over,
});
const ledger = (events: LedgerEvent[], throughYear = 2026) =>
  interestTaxFr({ events, throughYear } satisfies InterestTaxInput);
const yearOf = (l: ReturnType<typeof ledger>, year: number) => l.years.find((y) => y.year === year);

describe('les intérêts se regroupent par année', () => {
  it('somme les versements de l’année et les compte', () => {
    const l = ledger([
      income('2025-03-01T00:00:00', '0.02'),
      income('2025-05-01T00:00:00', '3.84'),
      income('2026-01-01T00:00:00', '33.29'),
    ]);
    expect([yearOf(l, 2025)!.grossEur, yearOf(l, 2025)!.count]).toEqual(['3.86', 2]);
    expect([yearOf(l, 2026)!.grossEur, yearOf(l, 2026)!.count]).toEqual(['33.29', 1]);
  });

  it('s’arrête à l’année demandée', () => {
    const l = ledger([income('2025-03-01T00:00:00', '10'), income('2027-03-01T00:00:00', '99')]);
    expect(l.years.map((y) => y.year)).toEqual([2025]);
  });

  it('ne prend NI les dividendes NI les frais de conversion', () => {
    // Les trois partagent le type `income` ; aucun ne partage le régime. Un dividende relève du
    // cadre 20 et de la case 2DC ; un frais de conversion n'est pas un revenu.
    const l = ledger([
      income('2025-03-01T00:00:00', '50', { nature: 'dividend', asset: 'eq:aapl' }),
      income('2025-03-02T00:00:00', '-30', { nature: 'conversion-fee' }),
      income('2025-03-03T00:00:00', '7', { nature: 'interest' }),
    ]);
    expect(yearOf(l, 2025)!.grossEur).toBe('7');
  });

  it('ne rend aucun millésime quand rien n’a été versé', () => {
    expect(ledger([]).years).toEqual([]);
  });
});

describe('ce que le module refuse de calculer, et le dit', () => {
  it('vise la case 2TR, et JAMAIS la 2TT des prêts participatifs', () => {
    // La brochure est explicite : « Ne déclarez pas ligne 2TR les intérêts des prêts participatifs
    // et des minibons qui doivent être déclarés ligne 2TT ». Les deux cases ne se remplacent pas.
    expect(INTEREST_TAX_BOXES.interest.box).toBe('2TR');
    expect(INTEREST_TAX_ASSUMPTIONS.join(' ')).toContain('2TT');
  });

  it('signale une retenue sans en tirer de crédit', () => {
    // Aucune retenue n'existe en pratique, mais si le relevé en portait une, la créditer
    // demanderait la colonne « intérêts » de la notice 2047 — que l'application n'a pas relevée.
    const l = ledger([income('2025-03-01T00:00:00', '100', { withheldEur: '15' })]);
    expect([yearOf(l, 2025)!.grossEur, yearOf(l, 2025)!.withheldEur]).toEqual(['100', '15']);
    expect(l.hasWithholding).toBe(true);
    // Rien dans la sortie ne porte un crédit : il n'y a pas de champ pour en loger un.
    expect(Object.keys(yearOf(l, 2025)!)).not.toContain('creditEur');
  });

  it('reste muet sur la retenue quand il n’y en a aucune', () => {
    expect(ledger([income('2025-03-01T00:00:00', '10')]).hasWithholding).toBe(false);
  });

  it('rappelle que le formulaire 2047 est requis pour un payeur étranger', () => {
    expect(INTEREST_TAX_BOXES.foreign.box).toBe('2047');
    expect(INTEREST_TAX_BOXES.foreign.label).toContain('cadre 30');
  });
});
