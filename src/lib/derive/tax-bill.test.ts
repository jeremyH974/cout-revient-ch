/**
 * L'addition (décision n° 173).
 *
 * Ce que ces tests surveillent n'est pas qu'un total sorte, c'est **qu'il soit le bon au centime**
 * et qu'il ne compte pas deux fois ce qui a déjà été prélevé. Un euro de trop ici est un euro que
 * l'utilisateur croit devoir.
 */
import { describe, expect, it } from 'vitest';
import type { DeclarationReport } from '../domain/declarations-fr';
import type { DividendTaxLedger, DividendTaxYear } from '../domain/equity-income-fr';
import type { EquityTaxLedger } from '../domain/equity-tax-fr';
import type { InterestTaxLedger } from '../domain/interest-income-fr';
import { rcmRateFor, type LendingTaxLedger, type LendingTaxYear } from '../domain/lending/tax-fr';
import { D } from '../domain/money';
import { taxBill, withheldFor, type BillOption, type Withheld } from './tax-bill';
import type { TaxChoice, TaxSide } from './tax-choice';
import type { TaxOption } from './pfu-vs-bareme';
import type { TaxReturnInput } from './tax-return';

const YEAR = 2026;

const side = (key: TaxSide['key'], incomeTaxEur: string, socialTaxEur: string): TaxSide => ({
  key,
  label: key === 'flat' ? 'Prélèvement forfaitaire' : 'Barème progressif',
  incomeTaxEur,
  socialTaxEur,
  totalEur: D(incomeTaxEur).plus(D(socialTaxEur)).toString(),
});

/** Un tableau comparatif minimal : seules `flat`, `scale` et `cheaper` entrent dans la facture. */
const choiceOf = (
  option: TaxOption,
  flat: TaxSide,
  scale: TaxSide,
  cheaper: TaxChoice['cheaper'],
): BillOption => ({
  option,
  choice: {
    option,
    year: YEAR,
    basis: 'bracket',
    flat,
    scale,
    cheaper,
    gapEur: '0',
    totalTaxableEur: '0',
    flatRateOnBase: '0',
    scaleRateOnBase: '0',
    marginalRateBefore: '0.3',
    marginalRateAfter: '0.3',
    crossesBracket: false,
    scaleYear: YEAR,
    scaleIsFallback: false,
    ladder: [],
  },
});

const crypto = choiceOf('3CN', side('flat', '128', '186'), side('scale', '300', '186'), 'flat');
const rcm = choiceOf('2OP', side('flat', '64', '93'), side('scale', '40', '93'), 'scale');

const nothing: Withheld = {
  advanceEur: '0',
  socialEur: '0',
  foreignCreditEur: '0',
  unsplit: false,
  dividendsWithoutAdvanceEur: '0',
};

/** La somme des lignes signées : l'invariant que toute la facture doit tenir. */
const sumLines = (lines: { amountEur: string }[]): string =>
  lines.reduce((acc, l) => acc.plus(D(l.amountEur)), D('0')).toString();

describe('taxBill', () => {
  it('additionne les deux options, et la somme des lignes vaut le solde', () => {
    const bill = taxBill({ year: YEAR, options: [crypto, rcm], withheld: nothing });
    expect(bill).not.toBeNull();
    // Par défaut : la moins chère de chaque côté — forfait pour 3CN, barème pour 2OP.
    expect(bill?.sides.map((s) => s.key)).toEqual(['flat', 'scale']);
    expect(bill?.incomeTaxEur).toBe('168'); // 128 + 40
    expect(bill?.socialTaxEur).toBe('279'); // 186 + 93
    expect(bill?.grossEur).toBe('447');
    expect(bill?.dueEur).toBe('447');
    expect(sumLines(bill?.lines ?? [])).toBe('447');
  });

  it('n’écrit que ce qui existe : deux lignes, aucune déduction, une seule réserve', () => {
    // La moitié de ce que ce module promet est **ce qu'il n'écrit pas**. Une ligne à zéro, une
    // réserve qui ne s'applique pas, un crédit qu'on n'a pas : rien de tout cela ne doit
    // apparaître. Sans cet instantané, aucun test ne le disait.
    const bill = taxBill({ year: YEAR, options: [crypto] });
    expect(bill?.lines).toEqual([
      {
        key: '3CN-ir',
        label: 'Plus-values de crypto-actifs — impôt sur le revenu',
        amountEur: '128',
        kind: 'due',
      },
      {
        key: '3CN-ps',
        label: 'Plus-values de crypto-actifs — prélèvements sociaux',
        amountEur: '186',
        kind: 'due',
      },
    ]);
    // Une seule réserve : celle qui vaut toujours. Les sept autres ne s'appliquent pas ici.
    expect(bill?.caveats).toHaveLength(1);
    expect(bill?.settledEur).toBe('0');
  });

  it('nomme chaque déduction par sa case, et la marque comme déjà réglée', () => {
    const bill = taxBill({
      year: YEAR,
      options: [rcm],
      sides: { '2OP': 'flat' },
      withheld: { ...nothing, advanceEur: '10', socialEur: '20', foreignCreditEur: '5' },
    });
    expect(bill?.lines.filter((l) => l.kind === 'settled')).toEqual([
      {
        key: 'credit-8VL',
        label: 'Crédit d’impôt sur dividendes étrangers (8VL), déjà retenu à l’étranger',
        amountEur: '-5',
        kind: 'settled',
      },
      {
        key: 'advance-2CK',
        label: 'Acompte de 12,8 % déjà retenu au versement (2CK)',
        amountEur: '-10',
        kind: 'settled',
      },
      {
        key: 'social-withheld',
        label: 'Prélèvements sociaux déjà retenus au versement',
        amountEur: '-20',
        kind: 'settled',
      },
    ]);
    expect(bill?.lines.filter((l) => l.kind === 'due').map((l) => l.label)).toEqual([
      'Revenus de capitaux mobiliers — impôt sur le revenu',
      'Revenus de capitaux mobiliers — prélèvements sociaux',
    ]);
  });

  it('suit la voie demandée, et dit qu’elle n’est plus la moins chère', () => {
    const bill = taxBill({
      year: YEAR,
      options: [crypto, rcm],
      sides: { '2OP': 'flat' },
      withheld: nothing,
    });
    expect(bill?.sides).toEqual([
      { option: '3CN', key: 'flat', followsCheapest: true },
      { option: '2OP', key: 'flat', followsCheapest: false },
    ]);
    expect(bill?.incomeTaxEur).toBe('192'); // 128 + 64, le barème n'est plus retenu
  });

  it('prend le forfait à égalité affichée : c’est lui qui s’applique sans rien cocher', () => {
    const equal = choiceOf('2OP', side('flat', '50', '10'), side('scale', '50', '10'), 'equal');
    const bill = taxBill({ year: YEAR, options: [equal], withheld: nothing });
    expect(bill?.sides[0]?.key).toBe('flat');
  });

  it('plafonne le crédit conventionnel à l’impôt dû, et nomme l’excédent', () => {
    // 8VL n'est pas restituable : il ne peut pas creuser un remboursement.
    const bill = taxBill({
      year: YEAR,
      options: [rcm],
      sides: { '2OP': 'flat' },
      withheld: { ...nothing, foreignCreditEur: '500' },
    });
    expect(bill?.settledEur).toBe('64'); // et non 500
    expect(bill?.dueEur).toBe('93'); // les prélèvements sociaux restent entiers
    expect(bill?.caveats.some((c) => c.includes('n’est pas restituable'))).toBe(true);
  });

  it('laisse l’acompte de 12,8 % produire un remboursement', () => {
    // « S'il excède l'impôt dû, l'excédent est restitué » (CGI art. 117 quater, I).
    const bill = taxBill({
      year: YEAR,
      options: [rcm],
      sides: { '2OP': 'flat' },
      withheld: { ...nothing, advanceEur: '300' },
    });
    expect(bill?.dueEur).toBe('-143'); // 64 + 93 − 300
    expect(bill?.settlement.direction).toBe('refund');
    expect(bill?.settlement.amountEur).toBe('143');
  });

  it('n’impute les prélèvements sociaux retenus que sur ceux de même nature', () => {
    // Un prélèvement social retenu au versement est définitif : l'excédent ne se rembourse pas.
    const bill = taxBill({
      year: YEAR,
      options: [rcm],
      sides: { '2OP': 'flat' },
      withheld: { ...nothing, socialEur: '200' },
    });
    expect(bill?.settledEur).toBe('93'); // et non 200
    expect(bill?.dueEur).toBe('64');
    expect(bill?.caveats.some((c) => c.includes('ce n’est pas un acompte'))).toBe(true);
  });

  it('n’impute rien d’un prélèvement dont la ventilation est inconnue, et le dit', () => {
    const bill = taxBill({
      year: YEAR,
      options: [rcm],
      withheld: { ...nothing, unsplit: true },
    });
    expect(bill?.settledEur).toBe('0');
    expect(bill?.caveats.some((c) => c.includes('ne correspond à aucun régime connu'))).toBe(true);
  });

  it('affiche la somme des lignes ARRONDIES, jamais l’arrondi de la somme', () => {
    // 10,004 + 10,004 : la somme exacte s'arrondit à 20,01, les lignes affichées donnent 20,00.
    const tricky = choiceOf(
      '3CN',
      side('flat', '10.004', '10.004'),
      side('scale', '99', '10.004'),
      'flat',
    );
    const bill = taxBill({ year: YEAR, options: [tricky], withheld: nothing });
    expect(bill?.dueEur).toBe('20.008');
    expect(bill?.displayDueEur).toBe('20');
  });

  it('juge l’étalement sur le montant affiché, pas sur le montant exact', () => {
    // 150,002 × 2 : exact 300,004 — au-delà de 300 —, affiché 300,00 — pas au-delà.
    const tricky = choiceOf(
      '2OP',
      side('flat', '150.002', '150.002'),
      side('scale', '999', '150.002'),
      'flat',
    );
    const bill = taxBill({ year: YEAR, options: [tricky], withheld: nothing });
    expect(D(bill?.dueEur ?? '0').gt(D('300'))).toBe(true);
    expect(bill?.settlement.instalments).toBe(1);
  });

  it('rend `null` quand il n’y a ni assiette ni prélèvement', () => {
    expect(taxBill({ year: YEAR, options: [], withheld: nothing })).toBeNull();
  });

  it('rend bien une facture quand un acompte a été retenu sans assiette : c’est un remboursement', () => {
    // Une perte imputée peut annuler l'assiette sans effacer l'acompte déjà versé.
    const bill = taxBill({
      year: YEAR,
      options: [],
      withheld: { ...nothing, advanceEur: '64' },
    });
    expect(bill?.dueEur).toBe('-64');
    expect(bill?.settlement.direction).toBe('refund');
  });

  it('dit que la part crypto manque quand l’historique des cours n’est pas chargé', () => {
    const bill = taxBill({ year: YEAR, options: [rcm], withheld: nothing, cryptoMissing: true });
    expect(bill?.caveats.some((c) => c.includes('150 VH bis'))).toBe(true);
  });

  it('nomme toujours ce que le total ne comprend pas', () => {
    const bill = taxBill({ year: YEAR, options: [crypto], withheld: nothing });
    expect(bill?.caveats.at(-1)).toContain('contribution différentielle');
  });

  it('avertit qu’aucun acompte ne figure sur les dividendes', () => {
    const bill = taxBill({
      year: YEAR,
      options: [rcm],
      withheld: { ...nothing, dividendsWithoutAdvanceEur: '1000' },
    });
    expect(bill?.caveats.some((c) => c.includes('2778-DIV-SD'))).toBe(true);
  });

  it('avertit même quand rien n’est reportable en 2DC', () => {
    // Le cas du nouvel arrivant : aucun pays de source désigné, donc `declaredEur` à zéro et
    // aucune case 2DC. L'acompte, lui, se doit quand même — il tient au PAYEUR établi hors de
    // France, jamais à l'émetteur. Un avertissement adossé au montant reportable se serait tu
    // pour exactement ceux qui en ont le plus besoin.
    const bill = taxBill({
      year: YEAR,
      options: [rcm],
      withheld: withheldFor(inputWith([], [dividendYear({ declaredEur: '0', creditEur: '0' })])),
    });
    expect(bill?.caveats.some((c) => c.includes('2778-DIV-SD'))).toBe(true);
  });
});

// --- `withheldFor` : ce qui a déjà été prélevé, lu dans les millésimes -------------------------

const lendingYear = (over: Partial<LendingTaxYear> = {}): LendingTaxYear => ({
  year: YEAR,
  rate: rcmRateFor(YEAR),
  withholding: 'full',
  interestGross: '500',
  withheld: '157',
  incomeTaxCredit: '64',
  socialPaid: '93',
  socialisedInterest: '500',
  lossRealised: '0',
  lossImputed: '0',
  taxableInterest: '500',
  carryForward: [],
  expired: '0',
  ...over,
});

const dividendYear = (over: Partial<DividendTaxYear> = {}): DividendTaxYear => ({
  year: YEAR,
  countries: [],
  grossEur: '1000',
  withheldEur: '150',
  declaredEur: '1000',
  creditEur: '150',
  netForeignEur: '850',
  excessEur: '0',
  undesignated: [],
  ...over,
});

const inputWith = (lending: LendingTaxYear[], dividends: DividendTaxYear[]): TaxReturnInput => ({
  year: YEAR,
  crypto: null,
  equity: { years: [], assumptions: [], hasLosses: false } satisfies EquityTaxLedger,
  dividends: {
    years: dividends,
    assumptions: [],
    hasUndesignated: false,
  } satisfies DividendTaxLedger,
  interest: { years: [], assumptions: [], hasWithholding: false } satisfies InterestTaxLedger,
  lending: { years: lending, assumptions: [], hasLosses: false } satisfies LendingTaxLedger,
  declarations: {
    year: YEAR,
    accounts: [],
    includedCount: 0,
    uncertainCount: 0,
  } satisfies DeclarationReport,
});

describe('withheldFor', () => {
  it('lit l’acompte, les prélèvements sociaux et le crédit conventionnel du millésime', () => {
    const result = withheldFor(inputWith([lendingYear()], [dividendYear()]));
    expect(result).toEqual({
      advanceEur: '64',
      socialEur: '93',
      foreignCreditEur: '150',
      unsplit: false,
      dividendsWithoutAdvanceEur: '1000',
    });
  });

  it('signale un prélèvement retenu dont la ventilation est inconnue', () => {
    const result = withheldFor(
      inputWith(
        [lendingYear({ withholding: 'unknown', incomeTaxCredit: null, socialPaid: null })],
        [],
      ),
    );
    expect(result.unsplit).toBe(true);
    expect(result.advanceEur).toBe('0');
  });

  it('suffit d’une moitié inconnue pour ne rien présumer de l’autre', () => {
    // Connaître l'acompte sans connaître la part sociale — ou l'inverse — laisse le prélèvement
    // à moitié ventilé : c'est encore un prélèvement qu'on ne sait pas imputer.
    expect(withheldFor(inputWith([lendingYear({ incomeTaxCredit: null })], [])).unsplit).toBe(true);
    expect(withheldFor(inputWith([lendingYear({ socialPaid: null })], [])).unsplit).toBe(true);
  });

  it('ne signale rien quand la plateforme n’a rien retenu', () => {
    const result = withheldFor(
      inputWith([lendingYear({ withheld: '0', incomeTaxCredit: null, socialPaid: null })], []),
    );
    expect(result.unsplit).toBe(false);
  });

  it('ne lit que l’année demandée, des deux côtés', () => {
    // Un millésime voisin n'a rien à faire dans cette facture : ni son acompte, ni son crédit.
    const result = withheldFor(
      inputWith([lendingYear({ year: YEAR - 1 })], [dividendYear({ year: YEAR - 1 })]),
    );
    expect(result).toEqual({
      advanceEur: '0',
      socialEur: '0',
      foreignCreditEur: '0',
      unsplit: false,
      dividendsWithoutAdvanceEur: '0',
    });
  });
});
