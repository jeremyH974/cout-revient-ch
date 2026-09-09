/**
 * Plus-values de cession de valeurs mobilières — article 150-0 D du CGI.
 *
 * **Le moteur calcule déjà la règle sans le savoir.** `Position.dispose` retire le coût au prorata
 * (`costBasis × qty / qtyDétenue`), ce qui EST le prix moyen pondéré d'acquisition qu'impose le 3
 * de l'article 150-0 D, et laisse le PMP du reliquat inchangé — la propriété qu'énonce le BOFiP
 * (BOI-RPPM-PVBMI-20-10-20-40, § 50) : « cette valeur moyenne n'est pas affectée par les ventes ».
 * Ce module ne recalcule donc aucune plus-value : il **agrège par année civile**, applique le
 * report des moins-values, et nomme les cases.
 *
 * Trois écarts avec l'assiette des actifs numériques (`domain/tax-fr.ts`), tous voulus :
 *
 * 1. **Par ligne, pas par portefeuille.** Le 150-0 D raisonne série de titres par série de titres ;
 *    le 150 VH bis prend le portefeuille entier. Les deux sont incompatibles dans un même calcul.
 * 2. **Aucun sursis d'échange.** Céder une action pour en acheter une autre est une cession, là où
 *    l'échange entre actifs numériques ne déclenche rien.
 * 3. **Les moins-values se REPORTENT dix ans**, alors qu'un net annuel négatif est perdu côté
 *    crypto. C'est le seul mécanisme d'état de ce module.
 *
 * Le taux, lui, est **partagé** avec `domain/tax-fr.ts` : même fait générateur (une cession), même
 * texte, même date d'effet. Le module des prêts duplique sa table parce que le fait générateur d'un
 * revenu de placement est son VERSEMENT, donc une autre date — ici, rien ne justifierait la copie,
 * et deux tables identiques divergeraient au premier amendement.
 */
import { allPositions, type PortfolioReport } from './engine/report';
import { D, ZERO, max, min, toDecimalString, type Big } from './money';
import { rateFor, type TaxRate } from './tax-fr';
import type { AssetCode, DecimalString, NaiveDateTime } from './types';

/** « Reporté sur les plus-values des dix années suivantes » (Brochure pratique IR, plus-values). */
export const LOSS_CARRY_YEARS = 10;

/**
 * Entrée de veille portant la MÉTHODE elle-même (prix moyen pondéré, § 20 et § 50).
 *
 * Une chaîne nue plutôt qu'un import : le domaine reste pur, et la citation vit dans
 * `lib/watch/entries.ts`, résolue à l'affichage — même patron que `TaxRate.sourceId`.
 */
export const PMP_SOURCE_ID = 'pmp-150-0-d';

/**
 * Cases de la déclaration, avec leur formulaire et leur fondement.
 *
 * **`form` n'est pas décoratif** : 3VG et 3VH sont sur la **2042 C**, pas sur la 2042 — confusion
 * assez répandue pour mériter d'être écrite à côté de chaque montant.
 */
export const EQUITY_TAX_BOXES = {
  gain: {
    box: '3VG',
    form: '2042 C',
    label: 'Plus-value de cession de valeurs mobilières, avant abattement',
    ref: 'CGI art. 150-0 D',
    sourceId: 'cases-3vg-3vh',
  },
  loss: {
    box: '3VH',
    form: '2042 C',
    label: 'Moins-value de l’année, après compensation avec les plus-values de l’année',
    ref: 'CGI art. 150-0 D, 11',
    sourceId: 'report-mv-10-ans',
  },
  option: {
    box: '2OP',
    form: '2042',
    label: 'Option pour le barème progressif',
    ref: 'CGI art. 200 A',
    sourceId: 'bareme-progressif',
  },
  detail: {
    box: '2074',
    form: '2074',
    label: 'Détail des cessions et des moins-values antérieures',
    ref: 'CGI art. 150-0 D',
    sourceId: 'form-2074',
  },
  carry: {
    box: '2074-CMV',
    form: '2074-CMV',
    label: 'Moins-values antérieures reportables et leur imputation',
    ref: 'CGI art. 150-0 D, 11',
    sourceId: 'report-mv-10-ans',
  },
  foreign: {
    box: '2047',
    form: '2047',
    label: 'Revenus encaissés à l’étranger (cadre 3), à reporter en 3VG',
    ref: 'CGI art. 170',
    sourceId: 'cases-3vg-3vh',
  },
} as const;

/**
 * Ce que l'outil décide faute de règle écrite, ou faute de données. À reproduire à l'écran mot pour
 * mot : une convention n'est pas une règle de droit, et l'utilisateur doit pouvoir la contester.
 */
export const EQUITY_TAX_ASSUMPTIONS: readonly string[] = [
  'Les moins-values les plus anciennes sont imputées les premières : ce sont elles qui expirent en premier. Le texte ne fixe pas d’ordre.',
  'Les moins-values antérieures à ce que l’application connaît lui sont invisibles : elle ne compte que les cessions qu’elle a importées. Si vous en reportez d’avant, le net imposable affiché est trop élevé.',
  'Aucun abattement pour durée de détention n’est appliqué : il est réservé aux titres acquis avant 2018, et seulement en cas d’option pour le barème.',
  'La déclaration 2074 est présumée nécessaire, un courtier étranger ne calculant pas les plus-values selon les règles françaises. C’est une lecture du critère de dispense, pas une doctrine qui nomme ce cas.',
  'Les dividendes ne figurent pas ici : ils relèvent des revenus de capitaux mobiliers, régime distinct.',
];

/** Une cession, telle que la 2074 la réclame : quand, quoi, combien reçu, combien coûté. */
export interface EquityCession {
  at: NaiveDateTime;
  asset: AssetCode;
  qty: DecimalString;
  /** Produit **net des frais de cession** : le pivot les a déjà déduits (décision n° 126). */
  proceedsEur: DecimalString;
  /** Coût moyen pondéré des titres cédés, frais d’acquisition compris. */
  costEur: DecimalString;
  gainEur: DecimalString;
}

export interface EquityTaxYear {
  year: number;
  rate: TaxRate;
  cessions: readonly EquityCession[];
  proceedsEur: DecimalString;
  /** Somme des cessions bénéficiaires de l’année. */
  gainsEur: DecimalString;
  /** Somme des cessions déficitaires de l’année, en valeur absolue. */
  lossesEur: DecimalString;
  /** Résultat de l’année après compensation interne (peut être négatif). */
  netEur: DecimalString;
  /** Ce qui va case 3VH : la moins-value de l’ANNÉE, jamais un cumul. */
  lossOfYearEur: DecimalString;
  /** Moins-values des années antérieures imputées sur le net positif de l’année. */
  carryImputedEur: DecimalString;
  carryForward: readonly { origin: number; amount: DecimalString }[];
  /** Cohortes atteignant leur onzième année : définitivement perdues. */
  expiredEur: DecimalString;
  taxableEur: DecimalString;
  taxEur: DecimalString;
}

export interface EquityTaxLedger {
  years: readonly EquityTaxYear[];
  assumptions: readonly string[];
  /** Vrai dès qu’une moins-value existe : l’écran n’affiche ses conventions que dans ce cas. */
  hasLosses: boolean;
}

export interface EquityTaxInput {
  report: PortfolioReport;
  /** Dernière année à produire (l’année civile en cours, en général). */
  throughYear: number;
}

const yearOf = (at: string): number => Number(at.slice(0, 4));

/**
 * Toutes les cessions de titres du rapport, dans l’ordre.
 *
 * `allPositions` plutôt que `report.equities` : une ligne entièrement cédée n’est plus une position
 * ouverte, et c’est précisément celle dont on veut la plus-value. Six modules ont un jour oublié un
 * seau en recomposant cette liste à la main — d’où le passage par l’aide qui les connaît tous.
 */
export function equityCessions(report: PortfolioReport): EquityCession[] {
  const out: EquityCession[] = [];
  for (const position of allPositions(report)) {
    if (position.assetClass !== 'equity') continue;
    for (const entry of position.history) {
      // `realized` non nul marque une SORTIE, quelle qu’en soit la contrepartie : un titre échangé
      // contre un autre est une cession, sans le sursis dont bénéficient les actifs numériques.
      if (entry.realized === null || entry.valueEur === null) continue;
      out.push({
        at: entry.at,
        asset: position.asset,
        qty: toDecimalString(entry.qty.abs()),
        proceedsEur: toDecimalString(entry.valueEur),
        costEur: toDecimalString(entry.valueEur.minus(entry.realized)),
        gainEur: toDecimalString(entry.realized),
      });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export function equityTaxFr(input: EquityTaxInput): EquityTaxLedger {
  const cessions = equityCessions(input.report);
  const byYear = new Map<number, EquityCession[]>();
  let first = Number.POSITIVE_INFINITY;
  for (const cession of cessions) {
    const year = yearOf(cession.at);
    if (Number.isNaN(year)) continue;
    first = Math.min(first, year);
    const list = byYear.get(year) ?? [];
    list.push(cession);
    byYear.set(year, list);
  }
  if (!Number.isFinite(first))
    return { years: [], assumptions: EQUITY_TAX_ASSUMPTIONS, hasLosses: false };

  const years: EquityTaxYear[] = [];
  let cohorts: { origin: number; remaining: Big }[] = [];
  let hasLosses = false;

  for (let year = first; year <= input.throughYear; year++) {
    // 1. Les cohortes au-delà de dix ans s’éteignent : la moins-value est définitivement perdue.
    let expired = ZERO;
    cohorts = cohorts.filter((c) => {
      if (year - c.origin > LOSS_CARRY_YEARS) {
        expired = expired.plus(c.remaining);
        return false;
      }
      return true;
    });

    const list = byYear.get(year) ?? [];
    let proceeds = ZERO;
    let gains = ZERO;
    let losses = ZERO;
    for (const cession of list) {
      proceeds = proceeds.plus(D(cession.proceedsEur));
      const gain = D(cession.gainEur);
      if (gain.gt(ZERO)) gains = gains.plus(gain);
      else losses = losses.plus(gain.abs());
    }
    // 2. Compensation INTERNE à l’année d’abord : c’est elle qui décide de la case 3VH.
    const net = gains.minus(losses);

    // 3. Les moins-values antérieures ne s’imputent que sur un net POSITIF — un net négatif a déjà
    //    absorbé les plus-values de l’année, il ne reste rien sur quoi les imputer.
    let imputed = ZERO;
    if (net.gt(ZERO)) {
      let room = net;
      cohorts.sort((a, b) => a.origin - b.origin);
      for (const cohort of cohorts) {
        if (room.lte(ZERO)) break;
        const take = min(cohort.remaining, room);
        cohort.remaining = cohort.remaining.minus(take);
        room = room.minus(take);
        imputed = imputed.plus(take);
      }
      cohorts = cohorts.filter((c) => c.remaining.gt(ZERO));
    } else if (net.lt(ZERO)) {
      cohorts.push({ origin: year, remaining: net.abs() });
      hasLosses = true;
    }

    const taxable = max(ZERO, net.minus(imputed));
    const rate = rateFor(year);
    years.push({
      year,
      rate,
      cessions: list,
      proceedsEur: toDecimalString(proceeds),
      gainsEur: toDecimalString(gains),
      lossesEur: toDecimalString(losses),
      netEur: toDecimalString(net),
      // « Indiquez ligne 3VH uniquement la moins-value subie en N, après compensation avec les
      // plus-values de l’année » : jamais le cumul des reports, qui vit sur la 2074.
      lossOfYearEur: toDecimalString(net.lt(ZERO) ? net.abs() : ZERO),
      carryImputedEur: toDecimalString(imputed),
      carryForward: cohorts.map((c) => ({
        origin: c.origin,
        amount: toDecimalString(c.remaining),
      })),
      expiredEur: toDecimalString(expired),
      taxableEur: toDecimalString(taxable),
      taxEur: toDecimalString(taxable.times(D(rate.pfu))),
    });
  }

  return { years, assumptions: EQUITY_TAX_ASSUMPTIONS, hasLosses };
}
