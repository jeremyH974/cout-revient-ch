/**
 * Le récapitulatif de déclaration (décision n° 149).
 *
 * Ce que ces tests surveillent n'est pas « le module rend quelque chose », c'est **le nombre que
 * l'utilisateur recopiera** : la case exacte, le montant exact, et l'absence de case là où il n'y a
 * rien à écrire. Une case de trop coûte un impôt indu ; une case de moins, une omission.
 */
import { describe, expect, it } from 'vitest';
import type { DeclarationReport } from '../domain/declarations-fr';
import type { DividendTaxLedger, DividendTaxYear } from '../domain/equity-income-fr';
import type { EquityTaxLedger, EquityTaxYear } from '../domain/equity-tax-fr';
import type { InterestTaxLedger, InterestTaxYear } from '../domain/interest-income-fr';
import { rcmRateFor, type LendingTaxLedger, type LendingTaxYear } from '../domain/lending/tax-fr';
import { D, ZERO } from '../domain/money';
import { rateFor, type TaxLedger, type TaxYear } from '../domain/tax-fr';
import {
  FAMILY_LABELS,
  carryBoxCode,
  taxReturn,
  type TaxReturn,
  type TaxReturnInput,
} from './tax-return';

const YEAR = 2025;

// --- Échafaudage : des années fiscales minimales, une par moteur -------------------------------

const cryptoYear = (over: Partial<TaxYear> = {}): TaxYear => ({
  year: YEAR,
  proceedsEur: '10000',
  cessionCount: 1,
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

const crypto = (over: Partial<TaxYear> = {}): TaxLedger => ({
  cessions: [],
  years: [cryptoYear(over)],
  ptaAfter: '0',
  unknownGlobalValue: over.unknownGlobalValue ?? 0,
  externalInflows: 0,
  externalOutflows: 0,
  rewards: 0,
});

const equityYear = (over: Partial<EquityTaxYear> = {}): EquityTaxYear => ({
  year: YEAR,
  rate: rateFor(YEAR),
  cessions: [
    {
      at: `${YEAR}-06-01T10:00:00`,
      asset: 'eq:acme',
      qty: '1',
      proceedsEur: '0',
      costEur: '0',
      gainEur: '0',
    },
  ],
  proceedsEur: '0',
  gainsEur: '0',
  lossesEur: '0',
  netEur: '0',
  lossOfYearEur: '0',
  carryImputedEur: '0',
  carryForward: [],
  expiredEur: '0',
  taxableEur: '0',
  taxEur: '0',
  ...over,
});

const equity = (over: Partial<EquityTaxYear> = {}): EquityTaxLedger => ({
  years: [equityYear(over)],
  assumptions: [],
  hasLosses: false,
});

const noEquity: EquityTaxLedger = { years: [], assumptions: [], hasLosses: false };

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

const dividends = (over: Partial<DividendTaxYear> = {}): DividendTaxLedger => ({
  years: [dividendYear(over)],
  assumptions: [],
  hasUndesignated: (over.undesignated ?? []).length > 0,
});

const noDividends: DividendTaxLedger = { years: [], assumptions: [], hasUndesignated: false };

const interestYear = (over: Partial<InterestTaxYear> = {}): InterestTaxYear => ({
  year: YEAR,
  grossEur: '240',
  withheldEur: '0',
  count: 4,
  ...over,
});

const interest = (over: Partial<InterestTaxYear> = {}): InterestTaxLedger => ({
  years: [interestYear(over)],
  assumptions: [],
  hasWithholding: false,
});

const noInterest: InterestTaxLedger = { years: [], assumptions: [], hasWithholding: false };

const lendingYear = (over: Partial<LendingTaxYear> = {}): LendingTaxYear => ({
  year: YEAR,
  rate: rcmRateFor(YEAR),
  withholding: 'full',
  interestGross: '500',
  withheld: '157',
  incomeTaxCredit: '64',
  socialPaid: '93',
  lossRealised: '0',
  lossImputed: '0',
  taxableInterest: '500',
  carryForward: [],
  expired: '0',
  ...over,
});

const lending = (over: Partial<LendingTaxYear> = {}): LendingTaxLedger => ({
  years: [lendingYear(over)],
  assumptions: [],
  hasLosses: false,
});

const noLending: LendingTaxLedger = { years: [], assumptions: [], hasLosses: false };

const noAccounts: DeclarationReport = {
  year: YEAR,
  accounts: [],
  includedCount: 0,
  uncertainCount: 0,
};

const accounts = (
  statuses: DeclarationReport['accounts'][number]['status'][],
): DeclarationReport => ({
  year: YEAR,
  accounts: statuses.map((status, i) => ({
    accountId: `a${i}`,
    label: `Compte ${i}`,
    status,
    country: 'DE',
    usedInYear: true,
    currentlyHolds: true,
    possiblyClosedInYear: false,
  })),
  includedCount: statuses.filter((s) => s === 'included').length,
  uncertainCount: statuses.filter((s) => s === 'uncertain-self-hosted').length,
});

const input = (over: Partial<TaxReturnInput> = {}): TaxReturnInput => ({
  year: YEAR,
  crypto: null,
  equity: noEquity,
  dividends: noDividends,
  interest: noInterest,
  lending: noLending,
  declarations: noAccounts,
  ...over,
});

const codes = (result: TaxReturn): string[] => result.lines.map((l) => l.box.code);
const line = (result: TaxReturn, code: string) => result.lines.find((l) => l.box.code === code);
const amountOf = (result: TaxReturn, code: string): string | undefined =>
  line(result, code)?.amounts[0]?.amountEur;

// --- L'année vide, et ce qu'elle ne doit pas inventer -------------------------------------------

describe('une année sans rien à déclarer', () => {
  it('ne rend aucune ligne, aucune réserve, aucune famille', () => {
    const result = taxReturn(input());
    expect(result).toEqual({ year: YEAR, lines: [], caveats: [], families: [] });
  });

  it('ignore une année qui n’est pas celle demandée', () => {
    const result = taxReturn(input({ crypto: crypto({ year: 2024, netEur: '5000' }) }));
    expect(result.lines).toEqual([]);
  });

  it('n’ouvre aucune ligne crypto tant que l’historique de prix n’est pas chargé', () => {
    // `crypto: null` n'est pas « pas de cession » : c'est « on ne sait pas encore ».
    expect(codes(taxReturn(input({ crypto: null })))).toEqual([]);
  });
});

// --- Crypto : la case dépend du signe, et le seuil de 305 € l'emporte sur tout -------------------

describe('cessions de crypto-actifs', () => {
  it('porte la plus-value en 3AN, jamais en 3BN, et propose l’option 3CN', () => {
    const result = taxReturn(
      input({ crypto: crypto({ gainsEur: '900', lossesEur: '200', netEur: '700' }) }),
    );
    expect(codes(result)).toEqual(['2086', '3AN', '3CN']);
    expect(amountOf(result, '3AN')).toBe('700');
  });

  it('porte la moins-value en 3BN, en valeur absolue, et sans proposer 3CN', () => {
    const result = taxReturn(
      input({ crypto: crypto({ gainsEur: '100', lossesEur: '400', netEur: '-300' }) }),
    );
    expect(codes(result)).toEqual(['2086', '3BN']);
    expect(amountOf(result, '3BN')).toBe('300');
  });

  it('n’écrit ni 3AN ni 3BN quand le résultat est nul', () => {
    const result = taxReturn(
      input({ crypto: crypto({ gainsEur: '300', lossesEur: '300', netEur: '0' }) }),
    );
    expect(codes(result)).toEqual(['2086']);
  });

  it('sous le seuil de 305 €, dépose le 2086 et ne remplit aucune case', () => {
    const result = taxReturn(
      input({
        crypto: crypto({ proceedsEur: '200', exempt: true, gainsEur: '150', netEur: '150' }),
      }),
    );
    expect(codes(result)).toEqual(['2086']);
    expect(line(result, '2086')?.note).toContain('305');
    expect(line(result, '2086')?.note).toContain('exonérées');
  });

  it('dit ce qu’il ne sait pas : une cession sans valeur globale du portefeuille', () => {
    const result = taxReturn(
      input({ crypto: crypto({ gainsEur: '900', netEur: '900', unknownGlobalValue: 2 }) }),
    );
    expect(result.caveats).toEqual([
      {
        family: 'crypto',
        text: '2 cessions n’ont pas de valeur globale du portefeuille : leur plus-value n’entre dans aucun montant ci-dessus. Renseignez-la depuis le rapport avant de déclarer.',
      },
    ]);
  });

  it('accorde le singulier quand il n’y en a qu’une', () => {
    const result = taxReturn(
      input({ crypto: crypto({ gainsEur: '900', netEur: '900', unknownGlobalValue: 1 }) }),
    );
    expect(result.caveats[0]?.text).toContain('1 cession n’a pas');
  });
});

// --- Titres : 3VG reçoit le net APRÈS imputation des reports -------------------------------------

describe('cessions de valeurs mobilières', () => {
  it('porte en 3VG le net de l’année diminué des moins-values antérieures imputées', () => {
    const result = taxReturn(
      input({
        equity: equity({
          gainsEur: '2000',
          lossesEur: '500',
          netEur: '1500',
          carryImputedEur: '400',
          taxableEur: '1100',
          carryForward: [{ origin: 2021, amount: '100' }],
        }),
      }),
    );
    expect(codes(result)).toEqual(['2047', '2074', '2074-CMV', '3VG', '2OP']);
    expect(amountOf(result, '3VG')).toBe('1100');
    expect(line(result, '3VG')?.amounts[0]?.terms).toEqual([
      { label: 'Plus-values de l’année', amountEur: '2000' },
      { label: 'Moins-values de l’année', amountEur: '-500' },
      { label: 'Moins-values antérieures imputées', amountEur: '-400' },
    ]);
  });

  it('n’ouvre la 2074-CMV que s’il y a des moins-values antérieures en jeu', () => {
    const result = taxReturn(
      input({ equity: equity({ gainsEur: '800', netEur: '800', taxableEur: '800' }) }),
    );
    expect(codes(result)).toEqual(['2047', '2074', '3VG', '2OP']);
  });

  it('n’écrit pas les termes nuls : « moins-values 0,00 € » fait douter au lieu d’éclairer', () => {
    const result = taxReturn(
      input({ equity: equity({ gainsEur: '800', netEur: '800', taxableEur: '800' }) }),
    );
    expect(line(result, '3VG')?.amounts[0]?.terms).toEqual([
      { label: 'Plus-values de l’année', amountEur: '800' },
    ]);
  });

  it('porte la moins-value de l’année en 3VH, après compensation, jamais le cumul des reports', () => {
    const result = taxReturn(
      input({
        equity: equity({
          gainsEur: '300',
          lossesEur: '1100',
          netEur: '-800',
          lossOfYearEur: '800',
          carryForward: [{ origin: YEAR, amount: '800' }],
        }),
      }),
    );
    expect(amountOf(result, '3VH')).toBe('800');
    expect(line(result, '3VG')).toBeUndefined();
  });
});

// --- Le 2047 : le même imprimé, trois cadres différents ------------------------------------------

describe('le formulaire 2047 et ses cadres', () => {
  it('nomme les trois cadres quand les trois familles sont là', () => {
    const result = taxReturn(
      input({
        equity: equity({ gainsEur: '10', netEur: '10', taxableEur: '10' }),
        dividends: dividends(),
        interest: interest(),
      }),
    );
    expect(line(result, '2047')?.note).toBe(
      'À remplir au cadre 3 (cessions de valeurs mobilières), au cadre 20 (dividendes), au cadre 30 (intérêts).',
    );
    expect(line(result, '2047')?.families).toEqual(['equity', 'dividend', 'interest']);
  });

  it('ne nomme que le cadre concerné quand une seule famille est là', () => {
    const result = taxReturn(input({ interest: interest() }));
    expect(line(result, '2047')?.note).toBe('À remplir au cadre 30 (intérêts).');
  });

  it('ne porte aucun montant : c’est une annexe, pas une case', () => {
    const result = taxReturn(input({ dividends: dividends() }));
    expect(line(result, '2047')?.amounts).toEqual([]);
  });
});

// --- Dividendes et intérêts ---------------------------------------------------------------------

describe('revenus de capitaux mobiliers', () => {
  it('remplit 2DC, 8PL et 8VL depuis les montants du moteur', () => {
    const result = taxReturn(input({ dividends: dividends() }));
    expect(codes(result)).toEqual(['2047', '2DC', '8PL', '8VL', '2OP']);
    expect(amountOf(result, '2DC')).toBe('1000');
    expect(amountOf(result, '8PL')).toBe('850');
    expect(amountOf(result, '8VL')).toBe('150');
  });

  it('ne crée pas 8VL quand aucun crédit d’impôt n’est calculé', () => {
    const result = taxReturn(
      input({ dividends: dividends({ creditEur: '0', netForeignEur: '0' }) }),
    );
    expect(codes(result)).toEqual(['2047', '2DC', '2OP']);
  });

  it('dit les titres sans pays désigné, et la retenue excédentaire', () => {
    const result = taxReturn(
      input({ dividends: dividends({ undesignated: ['eq:acme'], excessEur: '12' }) }),
    );
    expect(result.caveats.map((c) => c.family)).toEqual(['dividend', 'dividend']);
    expect(result.caveats[0]?.text).toContain('1 titre n’a pas de pays de source désigné');
    expect(result.caveats[1]?.text).toContain('n’est pas imputable en France');
  });

  it('met les intérêts de trésorerie en 2TR, et non en 2TT', () => {
    const result = taxReturn(input({ interest: interest() }));
    expect(codes(result)).toEqual(['2047', '2TR', '2OP']);
    expect(amountOf(result, '2TR')).toBe('240');
  });
});

// --- Prêts participatifs : la case 2TT reçoit le NET, et la plage a cinq cases -------------------

describe('prêts participatifs et minibons', () => {
  it('porte en 2TT les intérêts NETS de la perte imputée', () => {
    const result = taxReturn(
      input({
        lending: lending({ interestGross: '500', lossImputed: '120', taxableInterest: '380' }),
      }),
    );
    expect(amountOf(result, '2TT')).toBe('380');
    expect(line(result, '2TT')?.amounts[0]?.terms).toEqual([
      { label: 'Intérêts encaissés dans l’année', amountEur: '500' },
      { label: 'Perte en capital imputée', amountEur: '-120' },
    ]);
  });

  it('remplit 2CK et 2CG quand la ventilation est connue', () => {
    const result = taxReturn(input({ lending: lending() }));
    expect(codes(result)).toEqual(['2TT', '2CK', '2CG', '2OP']);
    expect(amountOf(result, '2CK')).toBe('64');
    expect(amountOf(result, '2CG')).toBe('93');
  });

  it('ne chiffre ni 2CK ni 2CG quand le taux retenu ne dit rien, et le dit', () => {
    const result = taxReturn(
      input({
        lending: lending({ withholding: 'unknown', incomeTaxCredit: null, socialPaid: null }),
      }),
    );
    expect(codes(result)).toEqual(['2TT', '2OP']);
    expect(result.caveats[0]?.text).toContain('aucun régime connu');
  });

  it('range chaque perte dans la case de son année d’origine', () => {
    const result = taxReturn(
      input({
        lending: lending({
          carryForward: [
            { origin: 2021, amount: '10' },
            { origin: 2023, amount: '20' },
            { origin: YEAR, amount: '30' },
          ],
        }),
      }),
    );
    expect(line(result, '2TU')?.amounts.map((a) => [a.code, a.amountEur])).toEqual([
      ['2TU', '10'],
      ['2TW', '20'],
      ['2TY', '30'],
    ]);
  });

  it('refuse de forger une case pour une perte que le formulaire ne reporte plus', () => {
    // Le moteur garde une cohorte tant que `année − origine ≤ 5` ; les cases n'en couvrent que cinq.
    const result = taxReturn(
      input({ lending: lending({ carryForward: [{ origin: YEAR - 5, amount: '40' }] }) }),
    );
    expect(line(result, '2TU')).toBeUndefined();
    expect(result.caveats[0]?.text).toBe(
      `Une perte de ${YEAR - 5} reste non imputée, mais aucune case ne la reçoit : elle n’est plus reportable sur ${YEAR + 1}.`,
    );
  });

  it('additionne deux apports qui visent la même case', () => {
    const result = taxReturn(
      input({
        lending: lending({
          carryForward: [
            { origin: 2023, amount: '20' },
            { origin: 2023, amount: '5' },
          ],
        }),
      }),
    );
    expect(line(result, '2TU')?.amounts).toHaveLength(1);
    expect(line(result, '2TU')?.amounts[0]?.amountEur).toBe('25');
  });

  it('dit la perte périmée faute d’intérêts sur lesquels s’imputer', () => {
    const result = taxReturn(input({ lending: lending({ expired: '75' }) }));
    expect(result.caveats.at(-1)?.text).toContain('définitivement perdue');
  });
});

describe('carryBoxCode', () => {
  it('aligne les cinq cases sur les cinq années, la plus ancienne à gauche', () => {
    expect([0, 1, 2, 3, 4].map((n) => carryBoxCode(YEAR, YEAR - n))).toEqual([
      '2TY',
      '2TX',
      '2TW',
      '2TV',
      '2TU',
    ]);
  });

  it('rend `null` au-delà, dans les deux sens', () => {
    expect(carryBoxCode(YEAR, YEAR - 5)).toBeNull();
    expect(carryBoxCode(YEAR, YEAR + 1)).toBeNull();
  });
});

// --- Comptes à l'étranger -----------------------------------------------------------------------

describe('comptes détenus à l’étranger', () => {
  it('ouvre le 3916-bis et compte les comptes concernés', () => {
    const result = taxReturn(input({ declarations: accounts(['included', 'included']) }));
    expect(codes(result)).toEqual(['3916-bis']);
    expect(line(result, '3916-bis')?.note).toBe('2 comptes à déclarer, un formulaire par compte.');
  });

  it('ne compte pas un compte français, et n’ouvre rien pour lui', () => {
    expect(codes(taxReturn(input({ declarations: accounts(['excluded-domestic']) })))).toEqual([]);
  });

  it('ne tranche pas pour un compte auto-hébergé, et le dit', () => {
    const result = taxReturn(input({ declarations: accounts(['uncertain-self-hosted']) }));
    expect(codes(result)).toEqual(['3916-bis']);
    expect(result.caveats[0]?.text).toContain('n’est pas tranché par le texte');
  });

  it('n’annonce jamais « 0 compte à déclarer » sous un formulaire qu’il affiche', () => {
    // Un compte sans pays n'est ni dedans ni dehors : la ligne existe pour poser la question.
    const result = taxReturn(input({ declarations: accounts(['unknown', 'unknown']) }));
    expect(line(result, '3916-bis')?.note).toBe(
      'Aucun compte identifié comme étant à déclarer, mais 2 comptes restent à qualifier : cette ligne est là pour que vous tranchiez, pas pour vous dire de la remplir.',
    );
    expect(result.caveats[0]?.text).toBe(
      '2 comptes n’ont pas de pays renseigné : l’application ne peut pas dire s’il relève du 3916-bis. Renseignez-le sur l’écran Comptes.',
    );
  });

  it('compte les comptes à déclarer quand il y en a', () => {
    const result = taxReturn(input({ declarations: accounts(['included', 'unknown']) }));
    expect(line(result, '3916-bis')?.note).toBe('1 compte à déclarer, un formulaire par compte.');
  });
});

// --- L'ordre, et l'invariant qui rend chaque chiffre contestable ---------------------------------

describe('l’ordre et les invariants de l’ensemble', () => {
  const full = (): TaxReturn =>
    taxReturn(
      input({
        crypto: crypto({ gainsEur: '900', lossesEur: '200', netEur: '700' }),
        equity: equity({
          gainsEur: '2000',
          lossesEur: '500',
          netEur: '1500',
          carryImputedEur: '400',
          taxableEur: '1100',
          carryForward: [{ origin: 2022, amount: '50' }],
        }),
        dividends: dividends(),
        interest: interest(),
        lending: lending({ carryForward: [{ origin: 2024, amount: '15' }] }),
        declarations: accounts(['included']),
      }),
    );

  it('suit l’ordre du parcours : les annexes avant les cases qu’elles alimentent', () => {
    expect(codes(full())).toEqual([
      '2047',
      '2DC',
      '2TR',
      '8PL',
      '8VL',
      '2074',
      '2074-CMV',
      '3VG',
      '2086',
      '3AN',
      '3CN',
      '2TT',
      '2CK',
      '2CG',
      '2TU',
      '2OP',
      '3916-bis',
    ]);
  });

  it('nomme les familles concernées dans l’ordre du parcours', () => {
    expect(full().families).toEqual([
      'crypto',
      'equity',
      'dividend',
      'interest',
      'lending',
      'accounts',
    ]);
  });

  it('ne met aucun montant sur une annexe ni sur une case à cocher', () => {
    for (const l of full().lines)
      if (l.box.kind !== 'box') expect(l.amounts, l.box.code).toEqual([]);
  });

  it('n’écrit jamais un montant nul ou négatif', () => {
    for (const l of full().lines)
      for (const a of l.amounts) expect(D(a.amountEur).gt(ZERO), `${a.code}`).toBe(true);
  });

  it('fait somme des termes égale au montant de la case, partout', () => {
    // C'est ce qui rend le chiffre contestable : l'utilisateur voit d'où il sort.
    for (const l of full().lines)
      for (const a of l.amounts) {
        const total = a.terms.reduce((acc, t) => acc.plus(D(t.amountEur)), ZERO);
        expect(total.toString(), `${a.code}`).toBe(D(a.amountEur).toString());
      }
  });

  it('donne à chaque case au moins un terme et au moins une famille', () => {
    for (const l of full().lines) {
      expect(l.families.length, l.box.code).toBeGreaterThan(0);
      for (const a of l.amounts) {
        expect(a.terms.length, a.code).toBeGreaterThan(0);
        expect(a.families.length, a.code).toBeGreaterThan(0);
      }
    }
  });

  it('ne propose la case 2OP qu’aux familles qu’elle couvre, jamais aux crypto-actifs', () => {
    expect(line(full(), '2OP')?.families).toEqual(['equity', 'dividend', 'interest', 'lending']);
  });
});

// --- Ce que l'utilisateur lit : chaque mot, et chaque absence ------------------------------------

describe('les mots affichés', () => {
  it('nomme chaque famille en français, sans exception', () => {
    expect(FAMILY_LABELS).toEqual({
      crypto: 'Crypto-actifs',
      equity: 'Titres',
      dividend: 'Dividendes',
      interest: 'Intérêts de trésorerie',
      lending: 'Prêts participatifs',
      accounts: 'Comptes à l’étranger',
    });
  });

  /**
   * Chaque terme est un mot que l'utilisateur lit sous un montant qu'il recopie. Les vérifier un
   * par un est le seul moyen d'empêcher qu'un libellé parte à la dérive sans que rien ne rougisse
   * — le test de mutation l'a montré en remplaçant chacun par la chaîne vide (décision n° 149).
   */
  it('écrit en entier les termes de chaque case, pour chaque famille', () => {
    const result = taxReturn(
      input({
        crypto: crypto({ gainsEur: '900', lossesEur: '200', netEur: '700' }),
        dividends: dividends(),
        interest: interest(),
        lending: lending({
          interestGross: '500',
          lossImputed: '120',
          taxableInterest: '380',
          carryForward: [{ origin: 2024, amount: '15' }],
        }),
      }),
    );
    const terms = Object.fromEntries(
      result.lines.flatMap((l) => l.amounts.map((a) => [a.code, a.terms])),
    );
    expect(terms).toEqual({
      '2DC': [{ label: 'Dividendes à déclarer, crédit d’impôt inclus', amountEur: '1000' }],
      '8PL': [{ label: 'Revenus nets ouvrant droit au crédit', amountEur: '850' }],
      '8VL': [{ label: 'Crédit d’impôt conventionnel', amountEur: '150' }],
      '2TR': [{ label: 'Intérêts encaissés dans l’année', amountEur: '240' }],
      '3AN': [
        { label: 'Plus-values de l’année', amountEur: '900' },
        { label: 'Moins-values de l’année', amountEur: '-200' },
      ],
      '2TT': [
        { label: 'Intérêts encaissés dans l’année', amountEur: '500' },
        { label: 'Perte en capital imputée', amountEur: '-120' },
      ],
      '2CK': [{ label: 'Acompte de 12,8 % déjà retenu', amountEur: '64' }],
      '2CG': [{ label: 'Prélèvements sociaux déjà retenus', amountEur: '93' }],
      '2TX': [{ label: 'Perte non imputée de 2024', amountEur: '15' }],
    });
  });

  it('écrit en entier les termes d’une moins-value, dans les deux régimes', () => {
    const result = taxReturn(
      input({
        crypto: crypto({ gainsEur: '100', lossesEur: '400', netEur: '-300' }),
        equity: equity({
          gainsEur: '300',
          lossesEur: '1100',
          netEur: '-800',
          lossOfYearEur: '800',
        }),
      }),
    );
    expect(line(result, '3BN')?.amounts[0]?.terms).toEqual([
      { label: 'Moins-values de l’année', amountEur: '400' },
      { label: 'Plus-values de l’année', amountEur: '-100' },
    ]);
    expect(line(result, '3VH')?.amounts[0]?.terms).toEqual([
      { label: 'Moins-values de l’année', amountEur: '1100' },
      { label: 'Plus-values de l’année', amountEur: '-300' },
    ]);
  });

  it('nomme le cadre du 2047 famille par famille', () => {
    const withEquity = taxReturn(
      input({ equity: equity({ gainsEur: '10', netEur: '10', taxableEur: '10' }) }),
    );
    expect(line(withEquity, '2047')?.note).toBe(
      'À remplir au cadre 3 (cessions de valeurs mobilières).',
    );
    const withDividends = taxReturn(input({ dividends: dividends() }));
    expect(line(withDividends, '2047')?.note).toBe('À remplir au cadre 20 (dividendes).');
  });

  it('dit le seuil de 305 € en toutes lettres, pas seulement en chiffres', () => {
    const result = taxReturn(
      input({
        crypto: crypto({ proceedsEur: '200', exempt: true, gainsEur: '150', netEur: '150' }),
      }),
    );
    expect(line(result, '2086')?.note).toBe(
      'Total des prix de cession sous le seuil de 305 € : les cessions sont exonérées, et ni 3AN ni 3BN ne se remplissent. Le 2086 se dépose tout de même, pour établir ce total.',
    );
  });
});

// --- Les absences : l'autre moitié du travail ----------------------------------------------------

describe('ce qui ne produit aucune ligne', () => {
  it('une année crypto sans cession', () => {
    expect(codes(taxReturn(input({ crypto: crypto({ cessionCount: 0, netEur: '900' }) })))).toEqual(
      [],
    );
  });

  it('une année de titres sans cession', () => {
    expect(codes(taxReturn(input({ equity: equity({ cessions: [], gainsEur: '900' }) })))).toEqual(
      [],
    );
  });

  it('une année de dividendes à zéro', () => {
    expect(codes(taxReturn(input({ dividends: dividends({ grossEur: '0' }) })))).toEqual([]);
  });

  it('une année d’intérêts sans versement', () => {
    expect(codes(taxReturn(input({ interest: interest({ count: 0, grossEur: '240' }) })))).toEqual(
      [],
    );
  });

  const idleLending = (over: Partial<LendingTaxYear> = {}): LendingTaxLedger =>
    lending({
      interestGross: '0',
      withheld: '0',
      incomeTaxCredit: null,
      socialPaid: null,
      taxableInterest: '0',
      withholding: 'none',
      ...over,
    });

  it('une année de prêts sans intérêt, sans perte et sans report', () => {
    expect(codes(taxReturn(input({ lending: idleLending() })))).toEqual([]);
  });

  it('mais une perte seule suffit à ouvrir les prêts', () => {
    expect(codes(taxReturn(input({ lending: idleLending({ lossRealised: '90' }) })))).toEqual([
      '2OP',
    ]);
  });

  it('et un report seul aussi', () => {
    const ledger = idleLending({ carryForward: [{ origin: 2024, amount: '15' }] });
    expect(codes(taxReturn(input({ lending: ledger })))).toEqual(['2TU', '2OP']);
  });

  it('ouvre la 2074-CMV sur le seul report restant', () => {
    const result = taxReturn(
      input({
        equity: equity({
          gainsEur: '800',
          netEur: '800',
          taxableEur: '800',
          carryForward: [{ origin: 2021, amount: '5' }],
        }),
      }),
    );
    expect(codes(result)).toContain('2074-CMV');
  });

  it('ouvre la 2074-CMV sur la seule imputation de l’année', () => {
    const result = taxReturn(
      input({
        equity: equity({
          gainsEur: '800',
          netEur: '800',
          carryImputedEur: '300',
          taxableEur: '500',
        }),
      }),
    );
    expect(codes(result)).toContain('2074-CMV');
  });
});

// --- Les réserves ne sortent que lorsqu'il y a lieu ----------------------------------------------

describe('aucune réserve inventée', () => {
  it('rien à dire quand tout est connu', () => {
    const result = taxReturn(
      input({
        crypto: crypto({ gainsEur: '900', netEur: '900', unknownGlobalValue: 0 }),
        dividends: dividends({ undesignated: [], excessEur: '0' }),
        lending: lending({ withholding: 'full', expired: '0' }),
        declarations: accounts(['included']),
      }),
    );
    expect(result.caveats).toEqual([]);
  });

  it('compte les seuls comptes sans pays, pas tous les comptes', () => {
    const result = taxReturn(input({ declarations: accounts(['included', 'unknown']) }));
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.text).toContain('1 compte n’a pas de pays renseigné');
  });

  it('accorde le pluriel des titres sans pays désigné', () => {
    const result = taxReturn(input({ dividends: dividends({ undesignated: ['eq:a', 'eq:b'] }) }));
    expect(result.caveats[0]?.text).toContain('2 titres n’ont pas de pays de source désigné');
  });

  it('écrit la réserve du compte auto-hébergé en entier', () => {
    const result = taxReturn(input({ declarations: accounts(['uncertain-self-hosted']) }));
    expect(result.caveats[0]?.text).toBe(
      '1 compte auto-hébergé n’est pas tranché par le texte : l’application ne le compte pas comme à déclarer, et ne conclut pas non plus qu’il ne l’est pas.',
    );
  });

  it('écrit en entier la réserve du prélèvement non ventilable et celle de la perte périmée', () => {
    const result = taxReturn(
      input({
        lending: lending({
          withholding: 'unknown',
          incomeTaxCredit: null,
          socialPaid: null,
          expired: '75',
        }),
      }),
    );
    expect(result.caveats.map((c) => c.text)).toEqual([
      'Le taux effectivement retenu par la plateforme ne correspond à aucun régime connu : ni 2CK ni 2CG ne sont chiffrées, faute de savoir comment ventiler ce prélèvement.',
      'Une perte est arrivée au terme des cinq ans sans avoir trouvé d’intérêts sur lesquels s’imputer : elle est définitivement perdue, et ne se reporte nulle part.',
    ]);
    expect(result.caveats.map((c) => c.family)).toEqual(['lending', 'lending']);
  });

  it('écrit en entier la réserve de la retenue excédentaire', () => {
    const result = taxReturn(input({ dividends: dividends({ excessEur: '12' }) }));
    expect(result.caveats[0]?.text).toBe(
      'Une part de la retenue étrangère dépasse le taux conventionnel : elle n’est pas imputable en France et ne figure dans aucune case. Sa restitution se demande à l’État de la source.',
    );
  });
});

// --- Le regroupement par case --------------------------------------------------------------------

describe('regroupement', () => {
  it('ne nomme pas deux fois la même famille sur une case', () => {
    const result = taxReturn(
      input({
        lending: lending({
          carryForward: [
            { origin: 2023, amount: '20' },
            { origin: 2023, amount: '5' },
          ],
        }),
      }),
    );
    expect(line(result, '2TU')?.amounts[0]?.families).toEqual(['lending']);
    expect(line(result, '2TU')?.amounts[0]?.terms).toEqual([
      { label: 'Perte non imputée de 2023', amountEur: '20' },
      { label: 'Perte non imputée de 2023', amountEur: '5' },
    ]);
  });
});

// --- L'année choisie, et elle seule -------------------------------------------------------------

describe('chaque moteur rend l’année demandée, pas la première venue', () => {
  /**
   * C'est le défaut de la décision n° 141, à l'échelle d'un moteur : un `find` qui rendrait la
   * première année du registre au lieu de celle qu'on demande afficherait des montants justes…
   * pour la mauvaise année. Chaque moteur porte ici deux millésimes, et un seul doit ressortir.
   */
  const twoYears = <T extends { year: number }>(a: T, b: T): T[] => [a, b];

  it('les titres', () => {
    const ledger: EquityTaxLedger = {
      years: twoYears(
        equityYear({ year: YEAR - 1, gainsEur: '9999', taxableEur: '9999' }),
        equityYear({ gainsEur: '800', taxableEur: '800' }),
      ),
      assumptions: [],
      hasLosses: false,
    };
    expect(amountOf(taxReturn(input({ equity: ledger })), '3VG')).toBe('800');
  });

  it('les dividendes', () => {
    const ledger: DividendTaxLedger = {
      years: twoYears(dividendYear({ year: YEAR - 1, declaredEur: '9999' }), dividendYear()),
      assumptions: [],
      hasUndesignated: false,
    };
    expect(amountOf(taxReturn(input({ dividends: ledger })), '2DC')).toBe('1000');
  });

  it('les intérêts', () => {
    const ledger: InterestTaxLedger = {
      years: twoYears(interestYear({ year: YEAR - 1, grossEur: '9999' }), interestYear()),
      assumptions: [],
      hasWithholding: false,
    };
    expect(amountOf(taxReturn(input({ interest: ledger })), '2TR')).toBe('240');
  });

  it('les prêts', () => {
    const ledger: LendingTaxLedger = {
      years: twoYears(
        lendingYear({ year: YEAR - 1, interestGross: '9999', taxableInterest: '9999' }),
        lendingYear(),
      ),
      assumptions: [],
      hasLosses: false,
    };
    expect(amountOf(taxReturn(input({ lending: ledger })), '2TT')).toBe('500');
  });
});

describe('les familles nommées sont celles qui sont là', () => {
  it('une seule famille n’en fait pas apparaître six', () => {
    expect(taxReturn(input({ interest: interest() })).families).toEqual(['interest']);
  });

  it('deux familles sortent dans l’ordre du parcours, pas dans celui des arguments', () => {
    const result = taxReturn(
      input({ lending: lending(), crypto: crypto({ gainsEur: '900', netEur: '900' }) }),
    );
    expect(result.families).toEqual(['crypto', 'lending']);
  });
});

describe('une note appartient à sa case, et à elle seule', () => {
  it('la note du 2086 ne déborde pas sur les autres cases', () => {
    const result = taxReturn(
      input({
        crypto: crypto({ proceedsEur: '200', exempt: true }),
        interest: interest(),
      }),
    );
    expect(line(result, '2086')?.note).toContain('305');
    expect(line(result, '2TR')?.note).toBeNull();
    expect(line(result, '2OP')?.note).toBeNull();
  });
});

describe('chaque réserve porte la famille qui la révèle', () => {
  it('les comptes, dans les deux cas où ils parlent', () => {
    expect(taxReturn(input({ declarations: accounts(['uncertain-self-hosted']) })).caveats).toEqual(
      [
        {
          family: 'accounts',
          text: '1 compte auto-hébergé n’est pas tranché par le texte : l’application ne le compte pas comme à déclarer, et ne conclut pas non plus qu’il ne l’est pas.',
        },
      ],
    );
    expect(taxReturn(input({ declarations: accounts(['unknown']) })).caveats).toEqual([
      {
        family: 'accounts',
        text: '1 compte n’a pas de pays renseigné : l’application ne peut pas dire s’il relève du 3916-bis. Renseignez-le sur l’écran Comptes.',
      },
    ]);
  });

  it('les crypto-actifs, et non une autre famille', () => {
    expect(
      taxReturn(
        input({ crypto: crypto({ gainsEur: '900', netEur: '900', unknownGlobalValue: 1 }) }),
      ).caveats[0]?.family,
    ).toBe('crypto');
  });

  it('les dividendes, et non une autre famille', () => {
    expect(taxReturn(input({ dividends: dividends({ excessEur: '12' }) })).caveats[0]?.family).toBe(
      'dividend',
    );
  });
});
