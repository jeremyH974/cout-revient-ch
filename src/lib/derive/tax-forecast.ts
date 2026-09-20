/**
 * « Et si je vendais d'ici le 31 décembre ? » — l'année en cours, rejouée avec une vente de plus
 * (décision n° 171).
 *
 * C'est la seule question fiscale encore **actionnable** : une année close ne se simule pas, elle
 * se déclare. Ce module ne décide rien et ne suggère aucun montant ; il rend l'année telle qu'elle
 * est et l'année telle qu'elle serait, et laisse l'écran soustraire.
 *
 * **Trois points de droit, relus le 20/09/2026 sur sources primaires.**
 *
 * 1. **La valeur globale du portefeuille** est « la somme des valeurs, évaluées au moment de la
 *    cession imposable, des différents crypto-actifs […] détenus par le cédant **avant de procéder
 *    à la cession** » (CGI art. 150 VH bis, III-C ; BOI-RPPM-PVBMC-30-20 § 140). C'est donc bien la
 *    valeur d'AVANT la vente qui entre au dénominateur — celle que l'appelant fournit.
 * 2. **Ce portefeuille est celui du FOYER FISCAL**, « quel que soit [le] support de conservation
 *    (plateformes d'échanges, y compris étrangères, serveurs personnels, dispositifs de stockage
 *    hors-ligne) », et « un même cédant ne peut avoir qu'un seul portefeuille » (même BOI, § 70 et
 *    § 140). L'application ne connaît que ce qu'on lui a importé : la valeur globale est donc une
 *    **hypothèse fournie**, jamais une donnée, et une valeur trop basse **sous-estime l'impôt**.
 * 3. **Le seuil de 305 € est une falaise, pas un abattement** : le franchir rend imposables toutes
 *    les cessions de l'année, « y compris celles dont le prix n'excédait pas le seuil »
 *    (BOI-RPPM-PVBMC-30-10 § 100). Et sous le seuil, on n'est pas dispensé de déclarer : « seuls
 *    les prix de cession doivent alors être déclarés » (§ 90).
 *
 * Module pur. Montants en euros, jamais convertis.
 */
import { D, ZERO, toDecimalString, type Big, type DecimalString } from '../domain/money';
import {
  EXEMPTION_THRESHOLD,
  previewCession,
  type CessionPreview,
  type TaxLedger,
  type TaxYear,
} from '../domain/tax-fr';
import { arbitrate, type Arbitrage } from './pfu-vs-bareme';
import type { TaxReturnInput } from './tax-return';

/**
 * L'hypothèse de vente.
 *
 * Union discriminée alors qu'elle n'a qu'un membre : le jour où les titres ou les intérêts
 * entreront dans le prévisionnel, ils s'ajouteront ici sans toucher à la signature ni aux
 * appelants. Le coût est d'une ligne ; celui d'une signature à réécrire ne l'est pas.
 */
export type SaleHypothesis = {
  kind: 'crypto';
  /** Prix de cession **net des frais** (ligne 215) : c'est lui que le seuil de 305 € regarde. */
  proceedsEur: DecimalString;
  /**
   * Frais attendus (ligne 214). Ils entrent au **numérateur du quotient** mais pas dans la
   * soustraction : « les frais déductibles […] ne viennent pas en diminution du prix de cession
   * pour la détermination du quotient » (BOI-RPPM-PVBMC-30-20 § 50). Décision n° 159.
   */
  feesEur: DecimalString;
  /** Valeur globale du portefeuille du foyer **avant** la vente (voir l'en-tête, point 2). */
  globalValueEur: DecimalString;
};

export interface Forecast {
  year: number;
  /** L'aperçu de la cession elle-même, du moteur pur. */
  preview: CessionPreview;
  /** L'arbitrage de l'année **telle qu'elle est** aujourd'hui. */
  before: Arbitrage;
  /**
   * Le total des cessions et le résultat net de l'année **avant** cette vente. Rendus ici plutôt
   * que laissés à soustraire à l'écran : un « avant / après » dont l'une des deux colonnes serait
   * recalculée ailleurs finirait par ne plus correspondre à l'autre.
   */
  beforeProceedsEur: DecimalString;
  beforeNetEur: DecimalString;
  /** L'arbitrage de l'année **cette vente comprise**. */
  after: Arbitrage;
  /**
   * L'année **rejouée**, telle que le moteur la verrait si la vente avait lieu : nombre de
   * cessions, plus-values et moins-values brutes comprises. Exposée plutôt que gardée pour soi —
   * c'est l'objet même du prévisionnel, et une année synthétique qu'on ne peut pas inspecter est
   * une année qu'on ne peut pas vérifier.
   */
  afterYear: TaxYear;
  /**
   * `true` quand c'est **cette vente** qui fait franchir le seuil de 305 €. L'année entière
   * bascule alors d'un coup, les cessions déjà faites comprises.
   */
  crossesThreshold: boolean;
  /** Ce que cette vente consommerait de la moins-value imputable ; `'0'` si elle n'en consomme pas. */
  pocketUsedEur: DecimalString;
  /** Ce qu'il resterait de cette poche. Éteinte au 31 décembre, jamais reportée (art. 150 VH bis, IV). */
  pocketLeftEur: DecimalString;
}

/**
 * Ce qu'il faut savoir de l'année **avant** la vente, et rien de plus.
 *
 * Volontairement plus étroit qu'un `TaxYear` : tout le reste — taux, exonération, impôt — se lit
 * sur l'aperçu de la cession, qui le calcule. Une année vide qui porterait ces champs les poserait
 * pour les voir aussitôt écrasés, c'est-à-dire du code que rien ne peut vérifier.
 */
type YearStart = Pick<
  TaxYear,
  'proceedsEur' | 'cessionCount' | 'gainsEur' | 'lossesEur' | 'netEur' | 'unknownGlobalValue'
>;

/** Une année sans aucune cession — le point de départ quand le grand livre n'en connaît pas. */
const NO_CESSION: YearStart = {
  proceedsEur: '0',
  cessionCount: 0,
  gainsEur: '0',
  lossesEur: '0',
  netEur: '0',
  unknownGlobalValue: 0,
};

/** Une moins-value nette, vue comme une poche positive ; `0` dès que l'année est en gain. */
function pocket(netEur: Big): Big {
  return netEur.lt(ZERO) ? netEur.times(D('-1')) : ZERO;
}

/**
 * L'année en cours rejouée avec une vente de plus.
 *
 * `null` quand rien ne peut être chiffré : pas de grand livre crypto (historique des cours absent),
 * ou une hypothèse que le moteur refuse — valeur globale ou prix de cession non strictement
 * positifs, cas où `previewCession` rend `null` plutôt qu'un zéro silencieux.
 */
export function forecastCession(input: TaxReturnInput, sale: SaleHypothesis): Forecast | null {
  const ledger = input.crypto;
  if (ledger === null) return null;

  const current = ledger.years.find((y) => y.year === input.year) ?? null;
  const preview = previewCession({
    ptaBefore: D(ledger.ptaAfter),
    proceedsEur: D(sale.proceedsEur),
    feesEur: D(sale.feesEur),
    globalValueEur: D(sale.globalValueEur),
    year: input.year,
    yearProceedsEur: current === null ? undefined : D(current.proceedsEur),
    yearNetEur: current === null ? undefined : D(current.netEur),
  });
  if (preview === null) return null;

  const beforeYear: YearStart = current ?? NO_CESSION;
  const gain = D(preview.gainEur);
  const afterYear: TaxYear = {
    year: input.year,
    proceedsEur: preview.yearProceedsEur,
    cessionCount: beforeYear.cessionCount + 1,
    gainsEur: toDecimalString(D(beforeYear.gainsEur).plus(gain.gt(ZERO) ? gain : ZERO)),
    lossesEur: toDecimalString(
      D(beforeYear.lossesEur).plus(gain.lt(ZERO) ? gain.times(D('-1')) : ZERO),
    ),
    netEur: preview.yearNetEur,
    exempt: preview.exempt,
    rate: preview.rate,
    rateLabel: preview.rateLabel,
    taxEur: preview.taxEur,
    unknownGlobalValue: beforeYear.unknownGlobalValue,
  };

  /**
   * Le grand livre rejoué, **réduit à la seule année simulée**.
   *
   * Ni les autres millésimes ni `cessions` n'y figurent, et ce n'est pas une paresse : une
   * moins-value d'actifs numériques ne se reporte **pas** d'une année sur l'autre (CGI art. 150 VH
   * bis, IV), si bien que l'arbitrage d'une année ne regarde jamais les précédentes. Y recopier un
   * historique que le prévisionnel ne complète pas — il n'ajoute aucune ligne de formulaire —
   * ferait croire ce grand livre complet alors qu'il ne l'est pas.
   */
  const afterLedger: TaxLedger = {
    ...ledger,
    ptaAfter: preview.ptaAfterEur,
    years: [afterYear],
  };

  const beforeProceeds = D(beforeYear.proceedsEur);
  const pocketLeft = pocket(D(preview.yearNetEur));
  // Une vente en perte AGRANDIT la poche : elle n'en consomme alors rien, et l'écart négatif
  // ne doit pas s'afficher comme une consommation.
  const consumed = pocket(D(beforeYear.netEur)).minus(pocketLeft);
  return {
    year: input.year,
    preview,
    before: arbitrate(input, '3CN'),
    beforeProceedsEur: beforeYear.proceedsEur,
    beforeNetEur: beforeYear.netEur,
    after: arbitrate({ ...input, crypto: afterLedger }, '3CN'),
    afterYear,
    crossesThreshold: beforeProceeds.lte(D(EXEMPTION_THRESHOLD)) && !preview.exempt,
    pocketUsedEur: toDecimalString(consumed.gt(ZERO) ? consumed : ZERO),
    pocketLeftEur: toDecimalString(pocketLeft),
  };
}
