/**
 * Le tableau comparatif de l'écran « Impôts » (décision n° 170).
 *
 * Ce que ces tests surveillent, c'est ce qu'un lecteur VERRA : deux totaux, un verdict, une
 * échelle. Les attendus sont posés à la main depuis la formule — `forfait = assiette × 12,8 %`,
 * `barème = (assiette − CSG déductible) × taux`, `PS = assiette × 18,6 %` en 2025 — et de rien
 * d'autre.
 */
import { describe, expect, it } from 'vitest';
import type { DeclarationReport } from '../domain/declarations-fr';
import type { DividendTaxLedger } from '../domain/equity-income-fr';
import type { EquityTaxLedger } from '../domain/equity-tax-fr';
import type { InterestTaxLedger } from '../domain/interest-income-fr';
import type { LendingTaxLedger } from '../domain/lending/tax-fr';
import { D } from '../domain/money';
import { rateFor, type TaxLedger, type TaxYear } from '../domain/tax-fr';
import { arbitrate, type Arbitrage } from './pfu-vs-bareme';
import type { TaxReturnInput } from './tax-return';
import { taxChoice } from './tax-choice';

const YEAR = 2025;

const input = (netEur: string, year = YEAR): TaxReturnInput => ({
  year,
  crypto: cryptoLedger(netEur, year),
  equity: { years: [], assumptions: [], hasLosses: false } satisfies EquityTaxLedger,
  dividends: { years: [], assumptions: [], hasUndesignated: false } satisfies DividendTaxLedger,
  interest: { years: [], assumptions: [], hasWithholding: false } satisfies InterestTaxLedger,
  lending: { years: [], assumptions: [], hasLosses: false } satisfies LendingTaxLedger,
  declarations: {
    year,
    accounts: [],
    includedCount: 0,
    uncertainCount: 0,
  } satisfies DeclarationReport,
});

function cryptoLedger(netEur: string, year: number): TaxLedger {
  const taxYear: TaxYear = {
    year,
    proceedsEur: '50000',
    cessionCount: 1,
    gainsEur: netEur,
    lossesEur: '0',
    netEur,
    exempt: false,
    rate: rateFor(year).pfu,
    rateLabel: rateFor(year).label,
    taxEur: '0',
    unknownGlobalValue: 0,
  };
  return {
    cessions: [],
    years: [taxYear],
    ptaAfter: '0',
    unknownGlobalValue: 0,
    externalInflows: 0,
    externalOutflows: 0,
    rewards: 0,
  };
}

/** 10 000 € de plus-value crypto en 2025 : forfait 1 280 €, PS 1 860 €. */
const crypto = (netEur = '10000', year = YEAR): Arbitrage => arbitrate(input(netEur, year), '3CN');

describe('taxChoice — les deux colonnes', () => {
  it('les prélèvements sociaux sont le MÊME montant des deux côtés', () => {
    const choice = taxChoice(crypto(), { kind: 'bracket', rate: '0.30' });
    // 10 000 × 18,6 % : le taux crypto de 2025, celui que la LFSS 2026 a porté à 18,6 points.
    expect(choice?.flat.socialTaxEur).toBe('1860');
    expect(choice?.scale.socialTaxEur).toBe('1860');
  });

  it('le total de chaque colonne est bien la somme de ses deux parts', () => {
    const choice = taxChoice(crypto(), { kind: 'bracket', rate: '0.30' });
    // Forfait : 1 280 € d'IR + 1 860 € de PS.
    expect(choice?.flat.incomeTaxEur).toBe('1280');
    expect(choice?.flat.totalEur).toBe('3140');
    // Barème à 30 % : (10 000 − 680) × 30 % = 2 796 €, plus les mêmes 1 860 €.
    expect(choice?.scale.incomeTaxEur).toBe('2796');
    expect(choice?.scale.totalEur).toBe('4656');
  });

  it('nomme la moins chère, et l’écart est toujours positif', () => {
    const haute = taxChoice(crypto(), { kind: 'bracket', rate: '0.30' });
    expect(haute?.cheaper).toBe('flat');
    expect(haute?.gapEur).toBe('1516');

    const basse = taxChoice(crypto(), { kind: 'bracket', rate: '0.11' });
    // (10 000 − 680) × 11 % = 1 025,20 € contre 1 280 € : le barème l'emporte de 254,80 €.
    expect(basse?.cheaper).toBe('scale');
    expect(basse?.gapEur).toBe('254.8');
  });

  it('dit ce que chaque voie prend pour 100 € d’assiette', () => {
    const choice = taxChoice(crypto(), { kind: 'bracket', rate: '0.11' });
    expect(choice?.flatRateOnBase).toBe('0.128');
    // 1 025,20 / 10 000 : le barème à 11 % ne prend pas 11 % de l'assiette, et c'est le propos.
    expect(choice?.scaleRateOnBase).toBe('0.10252');
  });

  it('la colonne la moins chère se reconnaît par sa clé — celle que l’écran compare', () => {
    // `cheaper` et `TaxSide.key` sont écrits à deux endroits : s'ils divergeaient, l'écran
    // n'accrocherait sa pastille « le moins cher ici » à aucune des deux cartes.
    const choice = taxChoice(crypto(), { kind: 'bracket', rate: '0.30' })!;
    expect(choice.cheaper).toBe(choice.flat.key);
    expect(choice.flat.key).toBe('flat');
    expect(choice.scale.key).toBe('scale');
    expect(choice.flat.label).toBe('Prélèvement forfaitaire');
    expect(choice.scale.label).toBe('Barème progressif');
  });

  it('reporte l’assiette telle que le moteur l’a établie', () => {
    expect(taxChoice(crypto('4321.5'), { kind: 'bracket', rate: '0' })?.totalTaxableEur).toBe(
      '4321.5',
    );
  });
});

describe('taxChoice — l’échelle des tranches', () => {
  it('se lit sur les scénarios du moteur, marque la vôtre et la bascule', () => {
    const choice = taxChoice(crypto(), { kind: 'bracket', rate: '0.30' });
    expect(choice?.ladder.map((s) => s.rate)).toEqual(['0', '0.11', '0.30', '0.41', '0.45']);
    expect(choice?.ladder.filter((s) => s.isYours).map((s) => s.rate)).toEqual(['0.30']);
    // 12,8 / 93,2 = 13,7 % : la dernière tranche sous ce seuil est celle à 11 %.
    expect(choice?.ladder.filter((s) => s.isBreakEven).map((s) => s.rate)).toEqual(['0.11']);
  });

  it('en mode foyer, la tranche marquée est celle d’AVANT ces revenus', () => {
    // 28 000 € pour une part : tranche à 11 %. Les 10 000 € de gains la font passer à 30 %,
    // mais c'est bien à 11 % que l'utilisateur doit se reconnaître dans le tableau.
    const choice = taxChoice(crypto(), {
      kind: 'household',
      household: { taxableIncomeEur: '28000', parts: '1' },
    });
    expect(choice?.marginalRateBefore).toBe('0.11');
    expect(choice?.marginalRateAfter).toBe('0.30');
    expect(choice?.crossesBracket).toBe(true);
    expect(choice?.ladder.filter((s) => s.isYours).map((s) => s.rate)).toEqual(['0.11']);
  });
});

describe('taxChoice — le mode foyer voit ce que le mode tranche ne peut pas voir', () => {
  it('le franchissement donne un montant qui n’est NI celui de la tranche d’avant, NI celui de la suivante', () => {
    const arbitrage = crypto();
    const foyer = taxChoice(arbitrage, {
      kind: 'household',
      household: { taxableIncomeEur: '28000', parts: '1' },
    });
    const avant = taxChoice(arbitrage, { kind: 'bracket', rate: '0.11' });
    const apres = taxChoice(arbitrage, { kind: 'bracket', rate: '0.30' });
    const exact = D(foyer!.scale.incomeTaxEur);
    expect(exact.gt(D(avant!.scale.incomeTaxEur))).toBe(true);
    expect(exact.lt(D(apres!.scale.incomeTaxEur))).toBe(true);
    // Le mode tranche ne PEUT pas l'annoncer : il ne connaît pas le revenu.
    expect(avant?.crossesBracket).toBe(false);
  });

  it('sans franchissement, les deux modes tombent d’accord au centime', () => {
    const arbitrage = crypto('1000');
    const foyer = taxChoice(arbitrage, {
      kind: 'household',
      household: { taxableIncomeEur: '40000', parts: '1' },
    });
    const tranche = taxChoice(arbitrage, { kind: 'bracket', rate: '0.30' });
    expect(foyer?.scale.incomeTaxEur).toBe(tranche?.scale.incomeTaxEur);
    expect(foyer?.crossesBracket).toBe(false);
  });
});

describe('taxChoice — le barème employé', () => {
  it('nomme l’année du barème, et le dit quand c’est un report', () => {
    // Aucun barème n'est publié pour 2026 : celui de 2025 sert, et l'écran doit pouvoir le dire.
    const choice = taxChoice(crypto('10000', 2026), { kind: 'bracket', rate: '0.30' });
    expect(choice?.scaleYear).toBe(2025);
    expect(choice?.scaleIsFallback).toBe(true);
  });

  it('une année antérieure au plus ancien barème n’en reçoit aucun', () => {
    const choice = taxChoice(crypto('10000', 2010), { kind: 'bracket', rate: '0.30' });
    expect(choice?.scaleYear).toBeNull();
    expect(choice?.scaleIsFallback).toBe(false);
  });

  it('en mode foyer, une année sans barème ne rend rien plutôt qu’un chiffre faux', () => {
    const choice = taxChoice(crypto('10000', 2010), {
      kind: 'household',
      household: { taxableIncomeEur: '28000', parts: '1' },
    });
    expect(choice).toBeNull();
  });
});

describe('taxChoice — ce qu’il refuse de comparer', () => {
  it('rien à arbitrer : aucune assiette cette année-là', () => {
    expect(taxChoice(crypto('0'), { kind: 'bracket', rate: '0.30' })).toBeNull();
  });

  it('une tranche inconnue du barème ne donne pas un zéro silencieux', () => {
    expect(taxChoice(crypto(), { kind: 'bracket', rate: '0.25' })).toBeNull();
  });

  it('rien à arbitrer en mode foyer non plus — et sans diviser par une assiette nulle', () => {
    // Le refus d'entrée est ce qui autorise `flatRateOnBase` à diviser sans garde. Sans lui, ce
    // cas lèverait une exception big.js plutôt que de rendre `null`.
    expect(() =>
      taxChoice(crypto('0'), {
        kind: 'household',
        household: { taxableIncomeEur: '28000', parts: '1' },
      }),
    ).not.toThrow();
    expect(
      taxChoice(crypto('0'), {
        kind: 'household',
        household: { taxableIncomeEur: '28000', parts: '1' },
      }),
    ).toBeNull();
  });
});

describe('taxChoice — le verdict se prononce sur les montants AFFICHÉS', () => {
  /**
   * Arbitrage fabriqué à la main : il faut un écart sous le centime, que la composition réelle
   * des assiettes ne produit pas. C'est le seul endroit où ce fichier n'appelle pas `arbitrate`.
   */
  const aLaMain = (flatEur: string, baremeEur: string): Arbitrage => ({
    option: '3CN',
    year: YEAR,
    bases: [
      {
        family: 'crypto',
        label: 'Plus-values de crypto-actifs (3AN)',
        taxableEur: '1000',
        abatement: '0',
        csgBaseEur: '1000',
        flatRate: '0.128',
        socialRate: '0.186',
      },
    ],
    totalTaxableEur: '1000',
    flatEur,
    socialEur: '186',
    csgDeductibleEur: '68',
    taxedEur: '1000',
    scenarios: [{ rate: '0.30', baremeEur, deltaEur: '0' }],
    breakEvenRate: '0.11',
    revocable: false,
    optionSourceId: 'bareme-actifs-numeriques',
  });

  it('un écart de 4 dixièmes de centime ne fait pas un verdict', () => {
    // Les deux cartes afficheraient 100,00 € : annoncer un gagnant serait un mensonge visuel.
    const choice = taxChoice(aLaMain('100.001', '100.004'), { kind: 'bracket', rate: '0.30' });
    expect(choice?.cheaper).toBe('equal');
    expect(choice?.gapEur).toBe('0');
  });

  it('un centime plein, lui, se voit et se dit', () => {
    const choice = taxChoice(aLaMain('100.00', '100.01'), { kind: 'bracket', rate: '0.30' });
    expect(choice?.cheaper).toBe('flat');
    expect(choice?.gapEur).toBe('0.01');
  });
});
