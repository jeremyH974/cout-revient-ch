/**
 * L'état d'une année fiscale, et ce qui s'éteint au 31 décembre (décision n° 169).
 *
 * Deux choses que ces tests surveillent parce qu'elles commandent ce que l'écran annonce : la
 * distance au seuil de 305 €, qui est une falaise et non un abattement, et la poche d'imputation
 * d'une moins-value, qui ne se reporte jamais sur l'année suivante.
 */
import { describe, expect, it } from 'vitest';
import { rateFor, type TaxLedger, type TaxYear } from '../domain/tax-fr';
import { yearOutlook } from './tax-outlook';

const year = (over: Partial<TaxYear> = {}): TaxYear => ({
  year: 2026,
  proceedsEur: '50000',
  cessionCount: 3,
  gainsEur: '10000',
  lossesEur: '0',
  netEur: '10000',
  exempt: false,
  rate: rateFor(2026).pfu,
  rateLabel: rateFor(2026).label,
  taxEur: '3140',
  unknownGlobalValue: 0,
  ...over,
});

const ledger = (...years: TaxYear[]): TaxLedger => ({
  cessions: [],
  years,
  ptaAfter: '0',
  unknownGlobalValue: 0,
  externalInflows: 0,
  externalOutflows: 0,
  rewards: 0,
});

describe('yearOutlook — où en est l’année', () => {
  it('l’année civile en cours est provisoire, et se déclare le printemps suivant', () => {
    const out = yearOutlook(ledger(year()), 2026, '2026-09-20');
    expect(out.state).toBe('in-progress');
    expect(out.declaredIn).toBe(2027);
    expect(out.pocketExpiresOn).toBe('2026-12-31');
  });

  it('une année révolue est close', () => {
    expect(yearOutlook(ledger(year({ year: 2025 })), 2025, '2026-09-20').state).toBe('closed');
  });

  it('une année à venir est annoncée comme telle, pas confondue avec l’année en cours', () => {
    expect(yearOutlook(ledger(), 2027, '2026-09-20').state).toBe('future');
  });

  it('rend l’année demandée, pas la première venue', () => {
    // Le test de mutation a trouvé ce trou : avec un grand livre à une seule année, prendre
    // n'importe laquelle donnait le même résultat, et rien ne surveillait la recherche.
    const out = yearOutlook(
      ledger(year({ year: 2025, proceedsEur: '99999' }), year({ year: 2026, proceedsEur: '200' })),
      2026,
      '2026-09-20',
    );
    expect(out.taxYear?.year).toBe(2026);
    expect(out.toThresholdEur).toBe('105');
  });
});

describe('le seuil de 305 €, qui est une falaise', () => {
  it('dit ce qui reste avant de le franchir', () => {
    const out = yearOutlook(ledger(year({ proceedsEur: '200' })), 2026, '2026-09-20');
    expect(out.thresholdEur).toBe('305');
    expect(out.toThresholdEur).toBe('105');
  });

  it('une fois franchi, il ne reste rien — jamais un nombre négatif', () => {
    expect(yearOutlook(ledger(year()), 2026, '2026-09-20').toThresholdEur).toBe('0');
  });

  it('une année sans la moindre cession garde le seuil entier', () => {
    const out = yearOutlook(ledger(), 2026, '2026-09-20');
    expect(out.taxYear).toBeNull();
    expect(out.toThresholdEur).toBe('305');
    expect(out.offsetPocketEur).toBe('0');
  });
});

describe('la poche d’imputation d’une moins-value', () => {
  it('vaut la moins-value nette, en positif', () => {
    const out = yearOutlook(
      ledger(year({ gainsEur: '0', lossesEur: '3508.82', netEur: '-3508.82', taxEur: '0' })),
      2026,
      '2026-09-20',
    );
    expect(out.offsetPocketEur).toBe('3508.82');
    // Elle ne survit pas à l'année : la date est celle du dernier jour, pas une échéance mobile.
    expect(out.pocketExpiresOn).toBe('2026-12-31');
  });

  it('est nulle dès que l’année est en gain', () => {
    expect(yearOutlook(ledger(year()), 2026, '2026-09-20').offsetPocketEur).toBe('0');
  });
});
