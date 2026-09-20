/**
 * Le barème appliqué à un foyer (décision n° 169).
 *
 * Les chiffres attendus sont posés à la main, tranche par tranche du barème des revenus 2025, et
 * jamais recalculés par le code qu'ils surveillent. Pour 30 000 € et une part :
 * `(29 579 − 11 600) × 11 % + (30 000 − 29 579) × 30 % = 1 977,69 + 126,30 = 2 103,99`.
 */
import { describe, expect, it } from 'vitest';
import { scaleFor } from '../domain/income-tax-fr';
import { D } from '../domain/money';
import {
  marginalRateFor,
  scaleForYearOrLatest,
  taxOnExtraIncome,
  taxOnIncome,
} from './household-tax';

const SCALE_2025 = scaleFor(2025)!;
const tax = (income: string, parts = '1'): string =>
  taxOnIncome(SCALE_2025, D(income), D(parts)).toString();
const rate = (income: string, parts = '1'): string =>
  marginalRateFor(SCALE_2025, D(income), D(parts));

describe('scaleForYearOrLatest — le repli ne va que vers l’avant', () => {
  it('rend le barème de l’année quand il existe, sans se replier', () => {
    const choice = scaleForYearOrLatest(2025);
    expect(choice?.scale.year).toBe(2025);
    expect(choice?.isFallback).toBe(false);
    expect(choice?.requestedYear).toBe(2025);
  });

  it('se rabat sur le dernier barème publié pour une année qui n’en a pas encore', () => {
    // L'année en cours : aucune loi de finances n'a fixé ses bornes. Les TAUX, eux, ne bougent pas.
    const choice = scaleForYearOrLatest(2026);
    expect(choice?.isFallback).toBe(true);
    expect(choice?.requestedYear).toBe(2026);
    expect(choice?.scale.year).toBe(2025);
  });

  it('refuse de projeter un barème en arrière', () => {
    // Montrer les bornes de 2024 à quelqu'un qui déclare 2019 lui ferait reconnaître la mauvaise
    // tranche : on renonce, comme `scaleFor` lui-même.
    expect(scaleForYearOrLatest(2019)).toBeNull();
  });
});

describe('taxOnIncome — le barème, quotient familial compris', () => {
  it('30 000 € pour une part : 2 103,99 €', () => {
    expect(tax('30000')).toBe('2103.99');
  });

  it('le quotient familial divise avant d’appliquer : 60 000 € pour deux parts coûtent le double', () => {
    expect(tax('60000', '2')).toBe('4207.98');
  });

  it('une part et demie', () => {
    // 45 000 ÷ 1,5 = 30 000 de quotient, donc 2 103,99 × 1,5.
    expect(tax('45000', '1.5')).toBe('3155.985');
  });

  it('un revenu pile sur une borne reste dans la tranche basse', () => {
    expect(tax('11600')).toBe('0');
  });

  it('la dernière tranche n’a pas de plafond', () => {
    // 1 977,69 + 16 499,40 + 39 909,40 + 8 137,35
    expect(tax('200000')).toBe('66523.84');
  });

  it('ni un revenu nul ni des parts nulles ne produisent d’impôt', () => {
    expect(tax('0')).toBe('0');
    expect(tax('30000', '0')).toBe('0');
  });
});

describe('marginalRateFor — la tranche qu’on lit sur le barème', () => {
  it('se lit sur le quotient, pas sur le revenu du foyer', () => {
    expect(rate('100000', '2')).toBe('0.30');
    expect(rate('100000', '1')).toBe('0.41');
  });

  it('une borne appartient à la tranche basse, l’euro suivant à la tranche d’après', () => {
    expect(rate('11600')).toBe('0');
    expect(rate('11601')).toBe('0.11');
  });

  it('sans revenu, la première tranche', () => {
    expect(rate('0')).toBe('0');
    expect(rate('30000', '0')).toBe('0');
  });

  it('au sommet du barème', () => {
    expect(rate('300000')).toBe('0.45');
  });
});

describe('taxOnExtraIncome — ce qu’une tranche choisie à la main ne peut pas savoir', () => {
  const household = (taxableIncomeEur: string, parts = '1') => ({ taxableIncomeEur, parts });

  it('un gain qui franchit une borne coûte plus que sa tranche de départ et moins que celle d’arrivée', () => {
    // 29 000 € de revenu (tranche à 11 %), 2 000 € de gain : 579 € restent à 11 %, 1 421 € passent
    // à 30 %. Ni 220 € (tout à 11 %), ni 600 € (tout à 30 %).
    const result = taxOnExtraIncome(SCALE_2025, household('29000'), D('2000'));
    expect(result.taxEur).toBe('489.99');
    expect(result.marginalRateBefore).toBe('0.11');
    expect(result.marginalRateAfter).toBe('0.30');
    expect(result.crossesBracket).toBe(true);
    expect(D(result.taxEur).gt(D('2000').times(D('0.11')))).toBe(true);
    expect(D(result.taxEur).lt(D('2000').times(D('0.30')))).toBe(true);
  });

  it('sans franchissement, c’est exactement le taux de la tranche', () => {
    const result = taxOnExtraIncome(SCALE_2025, household('50000'), D('1000'));
    expect(result.taxEur).toBe('300');
    expect(result.crossesBracket).toBe(false);
    expect(result.marginalRateAfter).toBe('0.30');
  });

  it('un montant nul ou négatif ne coûte rien', () => {
    expect(taxOnExtraIncome(SCALE_2025, household('50000'), D('0')).taxEur).toBe('0');
    const loss = taxOnExtraIncome(SCALE_2025, household('50000'), D('-500'));
    expect(loss.taxEur).toBe('0');
    expect(loss.crossesBracket).toBe(false);
  });
});
