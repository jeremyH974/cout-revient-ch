/**
 * Le prévisionnel : l'année en cours rejouée avec une vente de plus (décision n° 171).
 *
 * Les attendus sont posés à la main depuis la formule de l'article 150 VH bis, III :
 * `plus-value = prix net − PTA × (prix brut / valeur globale)`, et de rien d'autre.
 */
import { describe, expect, it } from 'vitest';
import type { DeclarationReport } from '../domain/declarations-fr';
import type { DividendTaxLedger } from '../domain/equity-income-fr';
import type { EquityTaxLedger } from '../domain/equity-tax-fr';
import type { InterestTaxLedger } from '../domain/interest-income-fr';
import type { LendingTaxLedger } from '../domain/lending/tax-fr';
import { D } from '../domain/money';
import { rateFor, type TaxLedger, type TaxYear } from '../domain/tax-fr';
import { forecastCession, type SaleHypothesis } from './tax-forecast';
import type { TaxReturnInput } from './tax-return';

const YEAR = 2026;

const year = (over: Partial<TaxYear> = {}): TaxYear => ({
  year: YEAR,
  proceedsEur: '10000',
  cessionCount: 2,
  gainsEur: '0',
  lossesEur: '0',
  netEur: '0',
  exempt: false,
  rate: rateFor(YEAR).pfu,
  rateLabel: rateFor(YEAR).label,
  taxEur: '0',
  unknownGlobalValue: 0,
  ...over,
});

const ledger = (over: Partial<TaxLedger> = {}, years: TaxYear[] = [year()]): TaxLedger => ({
  cessions: [],
  years,
  ptaAfter: '5000',
  unknownGlobalValue: 0,
  externalInflows: 0,
  externalOutflows: 0,
  rewards: 0,
  ...over,
});

const input = (crypto: TaxLedger | null): TaxReturnInput => ({
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
});

/** Vendre 1 000 € d'un portefeuille valant 20 000 € dont le PTA résiduel est de 5 000 €. */
const sale = (over: Partial<SaleHypothesis> = {}): SaleHypothesis => ({
  kind: 'crypto',
  proceedsEur: '1000',
  feesEur: '0',
  globalValueEur: '20000',
  ...over,
});

describe('forecastCession — la vente elle-même', () => {
  it('applique la formule de l’article 150 VH bis, III', () => {
    // Part de capital initial : 5 000 × 1 000 / 20 000 = 250 €. Plus-value : 1 000 − 250 = 750 €.
    const f = forecastCession(input(ledger()), sale())!;
    expect(f.preview.acquisitionShareEur).toBe('250');
    expect(f.preview.gainEur).toBe('750');
    expect(f.preview.ptaAfterEur).toBe('4750');
  });

  it('les frais entrent au numérateur du quotient, pas dans la soustraction', () => {
    // Avec 100 € de frais, le quotient porte sur 1 100 € : part = 5 000 × 1 100 / 20 000 = 275 €.
    // La plus-value se calcule toujours sur le prix NET : 1 000 − 275 = 725 €.
    const f = forecastCession(input(ledger()), sale({ feesEur: '100' }))!;
    expect(f.preview.acquisitionShareEur).toBe('275');
    expect(f.preview.gainEur).toBe('725');
    // Exactement PTA × frais / valeur globale de moins que sans frais : 5 000 × 100 / 20 000 = 25 €.
    const sansFrais = forecastCession(input(ledger()), sale())!;
    expect(D(sansFrais.preview.gainEur).minus(D(f.preview.gainEur)).eq(D('25'))).toBe(true);
  });

  it('le total des cessions de l’année s’additionne exactement', () => {
    const f = forecastCession(input(ledger()), sale())!;
    expect(f.preview.yearProceedsEur).toBe('11000');
  });

  it('vendre plus que le portefeuille borne la part de capital, et n’a pas de sens', () => {
    // La valeur globale EST celle de tout le portefeuille : on ne peut pas en vendre plus. Le
    // moteur borne alors la part au PTA pour ne jamais le rendre négatif — c'est un garde-fou,
    // pas un régime. La propriété de monotonie tombe au-delà, et l'écran doit donc refuser d'y
    // aller plutôt que d'afficher un chiffre qui ne veut rien dire.
    const f = forecastCession(input(ledger()), sale({ proceedsEur: '30000' }))!;
    expect(f.preview.acquisitionShareEur).toBe('5000');
    expect(f.preview.ptaAfterEur).toBe('0');
  });
});

describe('forecastCession — la poche d’imputation', () => {
  it('une vente en gain la consomme, sans jamais la rendre négative', () => {
    // L'année est à −3 508,82 € : la vente y apporte 750 € de plus-value.
    const f = forecastCession(input(ledger({}, [year({ netEur: '-3508.82' })])), sale())!;
    expect(f.pocketUsedEur).toBe('750');
    expect(f.pocketLeftEur).toBe('2758.82');
    expect(f.preview.yearNetEur).toBe('-2758.82');
    // Rien n'est dû : le net de l'année reste négatif.
    expect(f.preview.taxEur).toBe('0');
    expect(f.preview.taxDeltaEur).toBe('0');
  });

  it('une vente qui l’épuise laisse une poche nulle et une année imposable', () => {
    const f = forecastCession(input(ledger({}, [year({ netEur: '-500' })])), sale())!;
    expect(f.pocketUsedEur).toBe('500');
    expect(f.pocketLeftEur).toBe('0');
    // 750 − 500 = 250 € de plus-value nette, imposée au forfait de l'année.
    expect(f.preview.yearNetEur).toBe('250');
    expect(f.after.totalTaxableEur).toBe('250');
  });

  it('une vente en perte l’agrandit, et n’en consomme rien', () => {
    // Un portefeuille en moins-value : PTA 40 000 € pour une valeur globale de 20 000 €.
    // Part = 40 000 × 1 000 / 20 000 = 2 000 € ; la vente réalise donc −1 000 €.
    const f = forecastCession(
      input(ledger({ ptaAfter: '40000' }, [year({ netEur: '-500' })])),
      sale(),
    )!;
    expect(f.preview.gainEur).toBe('-1000');
    expect(f.pocketUsedEur).toBe('0');
    expect(f.pocketLeftEur).toBe('1500');
  });
});

describe('forecastCession — la falaise des 305 €', () => {
  it('dit quand c’est CETTE vente qui fait basculer l’année', () => {
    // 200 € de cessions déjà faites, 200 € de plus : le total passe à 400 €, au-dessus du seuil.
    const avant = year({ proceedsEur: '200', netEur: '120', exempt: true });
    const f = forecastCession(input(ledger({}, [avant])), sale({ proceedsEur: '200' }))!;
    expect(f.crossesThreshold).toBe(true);
    expect(f.preview.exempt).toBe(false);
    // Toute l'année bascule, les 120 € déjà réalisés compris — ce n'est pas un abattement.
    expect(D(f.after.totalTaxableEur).gt(D('120'))).toBe(true);
    expect(f.before.bases).toHaveLength(0);
  });

  it('ne le dit pas quand le seuil était déjà franchi', () => {
    const f = forecastCession(input(ledger({}, [year({ netEur: '100' })])), sale())!;
    expect(f.crossesThreshold).toBe(false);
  });

  it('ne le dit pas quand la vente laisse l’année sous le seuil', () => {
    const avant = year({ proceedsEur: '100', netEur: '50', exempt: true });
    const f = forecastCession(input(ledger({}, [avant])), sale({ proceedsEur: '100' }))!;
    expect(f.crossesThreshold).toBe(false);
    expect(f.preview.exempt).toBe(true);
    expect(f.after.bases).toHaveLength(0);
  });
});

describe('forecastCession — l’avant et l’après', () => {
  it('l’arbitrage d’après porte sur le net de l’année rejouée, et pas sur autre chose', () => {
    // L'invariant qui tient le grand livre synthétique : si l'arbitrage lisait `cessions`, que le
    // prévisionnel ne complète pas, cette égalité tomberait.
    const f = forecastCession(input(ledger({}, [year({ netEur: '1000' })])), sale())!;
    expect(f.after.totalTaxableEur).toBe(f.preview.yearNetEur);
    expect(f.before.totalTaxableEur).toBe('1000');
  });

  it('une année que le grand livre ne connaît pas part de zéro', () => {
    const f = forecastCession(input(ledger({}, [year({ year: 2025, netEur: '9999' })])), sale())!;
    expect(f.before.bases).toHaveLength(0);
    expect(f.preview.yearProceedsEur).toBe('1000');
    expect(f.preview.yearNetEur).toBe('750');
    expect(f.after.totalTaxableEur).toBe('750');
  });
});

describe('forecastCession — ce qu’il refuse de chiffrer', () => {
  it('sans grand livre crypto, rien plutôt qu’un zéro', () => {
    expect(forecastCession(input(null), sale())).toBeNull();
  });

  it('sans valeur globale, rien : c’est le dénominateur de la formule', () => {
    expect(forecastCession(input(ledger()), sale({ globalValueEur: '0' }))).toBeNull();
  });

  it('sans prix de cession, rien non plus', () => {
    expect(forecastCession(input(ledger()), sale({ proceedsEur: '0' }))).toBeNull();
  });
});
