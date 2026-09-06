/**
 * Fiscalité française des prêts participatifs — **estimation**, jamais un calcul officiel, ni un
 * conseil. Le module produit des montants à reporter case par case, avec leur référence légale ;
 * il ne calcule aucun impôt dû.
 *
 * POURQUOI CE N'EST PAS UNE EXTENSION DE `domain/tax-fr.ts`. Celui-ci met en œuvre l'article
 * 150 VH bis : portefeuille global, prix total d'acquisition, sursis d'échange. Les intérêts de
 * prêts participatifs sont des **revenus de capitaux mobiliers** : pas de prix d'acquisition, pas
 * de portefeuille global, pas de sursis. Aucun mécanisme n'est commun ; seule l'idée d'une table
 * de taux versionnée est reprise.
 *
 * LA CASE N'EST PAS CELLE DU RÉGIME GÉNÉRAL. La brochure officielle de l'impôt sur le revenu est
 * explicite : « Ne déclarez pas ligne 2TR les intérêts des prêts participatifs et des minibons qui
 * doivent être déclarés ligne 2TT ». L'IFU 2561 porte d'ailleurs une section dédiée — « Produits
 * des minibons et des prêts dans le cadre du financement participatif » — qui alimente 2TT.
 *
 * LE TAUX N'A PAS LA MÊME DATE D'EFFET QUE POUR LES CESSIONS. `domain/tax-fr.ts` fait passer le
 * PFU à 31,4 % dès l'année 2025, et son entrée de veille précise « sur les cessions ». Pour les
 * revenus de placement, le fait générateur est la **date de versement** et la hausse de CSG ne mord
 * qu'à compter du 01/01/2026. Réutiliser `rateFor()` appliquerait donc un taux faux aux intérêts
 * de 2025 : d'où une table distincte.
 *
 * TROIS HYPOTHÈSES, ASSUMÉES ET AFFICHÉES. Le texte de l'article 125-00 A et le BOFiP sont muets
 * sur l'ordre d'imputation des pertes reportées et sur l'année à laquelle se rapporte le plafond.
 * Elles sont énoncées dans `TAX_ASSUMPTIONS` et doivent être reproduites à l'écran : une
 * convention choisie par l'outil ne doit jamais se faire passer pour une règle de droit.
 */
import { D, ZERO, max, min, toDecimalString, type Big } from '../money';
import type { DecimalString } from '../types';
import type { LendingReport, LoanEvent } from './types';

/** Taux du PFU applicable aux revenus de capitaux mobiliers, par année de VERSEMENT. */
export interface RcmRate {
  /** Première année de versement couverte. */
  from: number;
  pfu: DecimalString;
  /** Part impôt sur le revenu : c'est elle que la plateforme prélève en acompte (PFNL). */
  incomeTax: DecimalString;
  social: DecimalString;
  label: string;
  /** Identifiant dans le registre de veille (`lib/watch/entries.ts`). */
  sourceId?: string;
}

export const RCM_RATES: readonly RcmRate[] = [
  { from: 0, pfu: '0.30', incomeTax: '0.128', social: '0.172', label: '30 % (12,8 % + 17,2 %)' },
  {
    from: 2026,
    pfu: '0.314',
    incomeTax: '0.128',
    social: '0.186',
    label: '31,4 % (12,8 % + 18,6 %)',
    sourceId: 'pfu-rcm-31_4',
  },
];

export function rcmRateFor(year: number): RcmRate {
  let found = RCM_RATES[0]!;
  for (const rate of RCM_RATES) if (year >= rate.from) found = rate;
  return found;
}

/** Plafond annuel d'imputation des pertes en capital (art. 125-00 A du CGI, BOFiP § 104). */
export const LOSS_CAP_EUR: DecimalString = '8000';
/** « L'année … ou des cinq années suivantes » (BOFiP § 105). */
export const LOSS_CARRY_YEARS = 5;

/** Cases de la déclaration, avec leur fondement — affichées à côté de chaque montant. */
export const TAX_BOXES = {
  interest: {
    box: '2TT',
    label: 'Intérêts des prêts participatifs et des minibons',
    ref: 'CGI art. 125-00 A',
  },
  incomeTaxCredit: {
    box: '2CK',
    label: 'Prélèvement forfaitaire déjà acquitté',
    ref: 'CGI art. 125 A',
  },
  social: {
    box: '2CG',
    label: 'Revenus déjà soumis aux prélèvements sociaux',
    ref: 'CGI art. 125 A',
  },
  option: { box: '2OP', label: 'Option pour le barème progressif', ref: 'CGI art. 200 A' },
  carry: {
    box: '2TU→2TY',
    label: 'Pertes non imputées à reporter, par année d’origine',
    ref: 'CGI art. 125-00 A',
  },
} as const;

/**
 * Ce que l'outil décide faute de règle écrite. À reproduire à l'écran, mot pour mot : une
 * convention n'est pas une règle de droit, et l'utilisateur doit pouvoir la contester.
 */
export const TAX_ASSUMPTIONS: readonly string[] = [
  'Les pertes les plus anciennes sont imputées les premières : ce sont elles qui expirent en premier. Ni l’article 125-00 A ni le BOFiP ne fixent d’ordre.',
  'Le plafond de 8 000 € est appliqué à l’année d’imputation. Le BOFiP dit « au titre d’une même année » sans trancher laquelle.',
  'Le partage entre acompte de 12,8 % et prélèvements sociaux est déduit du taux effectivement retenu, la plateforme ne fournissant qu’un total. Un taux qui ne correspond à aucun régime connu n’est pas ventilé du tout.',
  'Un recouvrement postérieur à une perte réduit celle-ci à sa date de constat. Si une imputation a déjà été faite au titre d’une année antérieure, elle serait à réviser — faites-la vérifier.',
];

/**
 * Ce que le prélèvement retenu par la plateforme révèle du régime effectivement appliqué. Il se
 * LIT dans le taux effectif (`retenu ÷ intérêts`) au lieu d'être présumé : un investisseur
 * dispensé d'acompte (revenu fiscal de référence sous le seuil, art. 242 quater) ne subit que les
 * prélèvements sociaux, et lui annoncer un crédit d'impôt de 12,8 % qu'il n'a jamais payé serait
 * une erreur de déclaration.
 */
export type WithholdingShape = 'full' | 'social-only' | 'none' | 'unknown';

/** Écart toléré autour d'un taux légal pour le reconnaître (arrondis d'échéance). */
const RATE_TOLERANCE: DecimalString = '0.005';

function shapeOf(gross: Big, paid: Big, rate: RcmRate): WithholdingShape {
  if (paid.lte(ZERO)) return 'none';
  if (gross.lte(ZERO)) return 'unknown';
  const effective = paid.div(gross);
  const near = (target: DecimalString): boolean =>
    effective.minus(D(target)).abs().lte(D(RATE_TOLERANCE));
  if (near(rate.pfu)) return 'full';
  if (near(rate.social)) return 'social-only';
  return 'unknown';
}

export interface LendingTaxYear {
  year: number;
  rate: RcmRate;
  /** Régime lu dans le taux effectivement retenu, jamais présumé. */
  withholding: WithholdingShape;
  /** Case 2TT. **Fait**, lu dans l'export. */
  interestGross: DecimalString;
  /** Prélèvements réellement retenus par la plateforme. **Fait**. */
  withheld: DecimalString;
  /**
   * Case 2CK. `null` quand le taux effectif ne correspond à aucun régime connu : mieux vaut ne
   * rien annoncer que d'annoncer un crédit d'impôt qui n'a pas été payé.
   */
  incomeTaxCredit: DecimalString | null;
  /** Case 2CG. `null` dans le même cas. */
  socialPaid: DecimalString | null;
  /** Capital devenu définitivement irrécouvrable dans l'année (événement `write-off`). */
  lossRealised: DecimalString;
  /** Perte effectivement imputée sur les intérêts de l'année, plafond compris. */
  lossImputed: DecimalString;
  /** Intérêts restant imposables après imputation. */
  taxableInterest: DecimalString;
  /** Reste à reporter au 31/12, par année d'origine — cases 2TU à 2TY. */
  carryForward: { origin: number; amount: DecimalString }[];
  /** Pertes périmées faute d'intérêts sur lesquels les imputer : perdues, et on le dit. */
  expired: DecimalString;
}

export interface LendingTaxLedger {
  years: LendingTaxYear[];
  assumptions: readonly string[];
  /** Vrai dès qu'une année porte une perte : l'avertissement « faites vérifier » se justifie. */
  hasLosses: boolean;
}

export interface LendingTaxInput {
  report: LendingReport;
  events: readonly LoanEvent[];
  /** Dernière année à présenter (l'année en cours). */
  throughYear: number;
}

const yearOf = (at: string): number => Number(at.slice(0, 4));

/**
 * Grand livre fiscal par année civile. Les intérêts et les prélèvements sont des FAITS lus dans
 * l'export ; la répartition acompte / prélèvements sociaux et l'imputation des pertes sont des
 * estimations, signalées comme telles par leur documentation de champ.
 */
export function lendingTaxFr(input: LendingTaxInput): LendingTaxLedger {
  const interest = new Map<number, Big>();
  const withheld = new Map<number, Big>();
  const losses = new Map<number, Big>();
  const bump = (into: Map<number, Big>, year: number, value: Big): void => {
    into.set(year, (into.get(year) ?? ZERO).plus(value));
  };

  let first: number | null = null;
  for (const event of input.events) {
    const year = yearOf(event.at);
    if (Number.isNaN(year)) continue;
    if (first === null || year < first) first = year;
    if (event.kind === 'repayment' || event.kind === 'recovery') {
      bump(interest, year, D(event.interest));
      bump(withheld, year, D(event.withheld));
    }
  }

  // La perte d'un prêt est le montant NET de ses recouvrements (voir `roll`), rattaché à l'année
  // où l'irrécouvrabilité a été constatée — c'est cet événement, et lui seul, qui ouvre le droit.
  const writeOffYear = new Map<string, number>();
  for (const event of input.events)
    if (event.kind === 'write-off') writeOffYear.set(event.loanId, yearOf(event.at));
  for (const line of input.report.loans) {
    const amount = D(line.writtenOff);
    if (amount.lte(ZERO)) continue;
    const year = writeOffYear.get(line.loan.id);
    if (year === undefined || Number.isNaN(year)) continue;
    bump(losses, year, amount);
    if (first === null || year < first) first = year;
  }

  const years: LendingTaxYear[] = [];
  if (first === null) return { years, assumptions: TAX_ASSUMPTIONS, hasLosses: false };

  const cap = D(LOSS_CAP_EUR);
  let cohorts: { origin: number; remaining: Big }[] = [];
  let hasLosses = false;

  for (let year = first; year <= input.throughYear; year++) {
    // 1. Les cohortes au-delà de cinq ans s'éteignent : la perte est définitivement perdue.
    let expired = ZERO;
    cohorts = cohorts.filter((c) => {
      if (year - c.origin > LOSS_CARRY_YEARS) {
        expired = expired.plus(c.remaining);
        return false;
      }
      return true;
    });

    // 2. La perte de l'année entre comme nouvelle cohorte.
    const realised = losses.get(year) ?? ZERO;
    if (realised.gt(ZERO)) {
      cohorts.push({ origin: year, remaining: realised });
      hasLosses = true;
    }

    // 3. Imputation, la plus ancienne d'abord, dans la limite des intérêts et du plafond.
    const gross = interest.get(year) ?? ZERO;
    let room = min(gross, cap);
    let imputed = ZERO;
    cohorts.sort((a, b) => a.origin - b.origin);
    for (const cohort of cohorts) {
      if (room.lte(ZERO)) break;
      const take = min(cohort.remaining, room);
      cohort.remaining = cohort.remaining.minus(take);
      room = room.minus(take);
      imputed = imputed.plus(take);
    }
    cohorts = cohorts.filter((c) => c.remaining.gt(ZERO));

    const paid = withheld.get(year) ?? ZERO;
    const rate = rcmRateFor(year);
    // On ne recalcule jamais un montant que la plateforme a déjà retenu : on le VENTILE, et
    // seulement si le taux effectif dit sous quel régime il a été retenu.
    const shape = shapeOf(gross, paid, rate);
    const credit =
      shape === 'full'
        ? paid.times(D(rate.incomeTax).div(D(rate.pfu)))
        : shape === 'social-only' || shape === 'none'
          ? ZERO
          : null;

    years.push({
      year,
      rate,
      withholding: shape,
      interestGross: toDecimalString(gross),
      withheld: toDecimalString(paid),
      incomeTaxCredit: credit === null ? null : toDecimalString(credit),
      socialPaid: credit === null ? null : toDecimalString(paid.minus(credit)),
      lossRealised: toDecimalString(realised),
      lossImputed: toDecimalString(imputed),
      taxableInterest: toDecimalString(max(ZERO, gross.minus(imputed))),
      carryForward: cohorts.map((c) => ({
        origin: c.origin,
        amount: toDecimalString(c.remaining),
      })),
      expired: toDecimalString(expired),
    });
  }

  return { years, assumptions: TAX_ASSUMPTIONS, hasLosses };
}
