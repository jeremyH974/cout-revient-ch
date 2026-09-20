import { describe, expect, it } from 'vitest';
import { SPREAD_INSTALMENTS, SPREAD_THRESHOLD_EUR, settlement } from './tax-calendar';

describe('settlement', () => {
  it('règle l’année qui suit celle des gains', () => {
    // Le fait générateur est dans l'année ; l'avis, lui, arrive l'été d'après.
    expect(settlement(2026, '1200').year).toBe(2027);
  });

  it('étale AU-DELÀ de 300 €, pas à 300 €', () => {
    // La borne exacte est le seul endroit où la règle peut se tromper d'un cran.
    expect(settlement(2026, '300')).toEqual({
      year: 2027,
      direction: 'pay',
      amountEur: '300',
      instalments: 1,
      thresholdEur: '300',
    });
    expect(settlement(2026, '300.01').instalments).toBe(SPREAD_INSTALMENTS);
    expect(SPREAD_THRESHOLD_EUR).toBe('300');
  });

  it('ne fractionne pas un remboursement', () => {
    // L'acompte de 12,8 % excède parfois l'impôt dû : « l'excédent est restitué » (art. 117
    // quater, I). Un remboursement n'a pas d'échéancier.
    const result = settlement(2026, '-450');
    expect(result.direction).toBe('refund');
    expect(result.amountEur).toBe('450');
    expect(result.instalments).toBe(0);
  });

  it('ne réclame ni ne rend rien quand le solde est nul', () => {
    expect(settlement(2026, '0')).toEqual({
      year: 2027,
      direction: 'none',
      amountEur: '0',
      instalments: 0,
      thresholdEur: '300',
    });
  });

  it('rend le montant positif dans les deux sens : le sens est dans `direction`', () => {
    expect(settlement(2026, '1200').amountEur).toBe('1200');
    expect(settlement(2026, '-1200').amountEur).toBe('1200');
  });
});
