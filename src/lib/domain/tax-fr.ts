/**
 * Fiscalité française des actifs numériques — **estimation**, jamais un calcul officiel
 * (décision n° 43). Article 150 VH bis du CGI, méthode dite « globale » :
 *
 *   plus-value = prix de cession − prix total d'acquisition × (prix de cession ÷ valeur globale
 *                                                              du portefeuille au jour de la cession)
 *
 * Deux conséquences qui commandent tout le module :
 *
 * 1. **Le prix total d'acquisition (PTA) est celui du PORTEFEUILLE ENTIER, pas d'un actif.** Il
 *    n'a donc rien à voir avec le PRU par actif que calcule le reste de l'app (décision n° 10) :
 *    il monte à chaque achat en euros et se consomme, cession après cession, au prorata de ce qui
 *    est vendu. Il faut REJOUER l'historique dans l'ordre pour connaître le PTA d'aujourd'hui.
 * 2. **Seule la sortie vers une monnaie ayant cours légal est imposable.** Les échanges entre
 *    actifs numériques — stablecoins compris — bénéficient du sursis : ils ne déclenchent rien et
 *    ne touchent pas au PTA. L'achat de biens ou de services en crypto est imposable lui aussi,
 *    mais un export ne permet pas de le distinguer d'un retrait : c'est signalé, pas deviné.
 *
 * Module pur : `Big` et chaînes décimales, aucun arrondi d'affichage, aucune horloge (l'année
 * d'une cession se lit dans sa date). Le texte français vit dans la couche d'affichage.
 */
import { isFiat } from './assets';
import { D, ZERO, toDecimalString, type Big, type DecimalString } from './money';
import type { EventId, LedgerEvent, NaiveDateTime } from './types';

/**
 * Prélèvement forfaitaire unique par millésime de cession. La CSG patrimoine étant passée à
 * 10,6 % (LFSS 2026), les prélèvements sociaux valent 18,6 % et le PFU 31,4 % ; il valait 30 %
 * auparavant. Table ordonnée : un nouveau taux = une ligne de plus, rien à réécrire.
 */
export interface TaxRate {
  /** Première année de cession à laquelle le taux s'applique. */
  from: number;
  /** Taux global (impôt sur le revenu + prélèvements sociaux). */
  pfu: DecimalString;
  label: string;
}

export const TAX_RATES: readonly TaxRate[] = [
  { from: 0, pfu: '0.30', label: '30 % (12,8 % + 17,2 %)' },
  { from: 2025, pfu: '0.314', label: '31,4 % (12,8 % + 18,6 %)' },
];

/** Taux applicable aux cessions d'une année (le plus récent qui la couvre). */
export function rateFor(year: number): TaxRate {
  let found = TAX_RATES[0]!;
  for (const rate of TAX_RATES) if (year >= rate.from) found = rate;
  return found;
}

/**
 * Seuil d'exonération : si la SOMME DES PRIX DE CESSION de l'année (hors échanges en sursis) ne
 * dépasse pas 305 €, la plus-value n'est pas imposable. Au-delà, tout est imposable dès le
 * premier euro — ce n'est pas un abattement.
 */
export const EXEMPTION_THRESHOLD: DecimalString = '305';

/** Nature fiscale d'un événement du grand livre, telle que ce module la lit. */
export type TaxEventKind =
  'acquisition' | 'cession' | 'sursis' | 'reward' | 'external-in' | 'external-out' | 'ignored';

export interface TaxCession {
  eventId: EventId;
  at: NaiveDateTime;
  year: number;
  /** Prix de cession retenu : le produit NET perçu (frais de la plateforme déduits). */
  proceedsEur: DecimalString;
  /** Valeur globale du portefeuille au jour de la cession ; `null` si elle n'a pas pu être établie. */
  globalValueEur: DecimalString | null;
  ptaBefore: DecimalString;
  /** Fraction du PTA imputée sur cette cession ; `null` sans valeur globale. */
  acquisitionShareEur: DecimalString | null;
  /** Plus ou moins-value brute ; `null` sans valeur globale. */
  gainEur: DecimalString | null;
  ptaAfter: DecimalString;
}

export interface TaxYear {
  year: number;
  /** Σ des prix de cession : c'est CE total que le seuil de 305 € regarde. */
  proceedsEur: DecimalString;
  cessionCount: number;
  /** Σ des plus-values brutes de l'année. */
  gainsEur: DecimalString;
  /** Σ des moins-values brutes (valeur positive). */
  lossesEur: DecimalString;
  /**
   * Résultat net de l'année. Les moins-values ne s'imputent QUE sur les plus-values de même
   * nature de la MÊME année : un net négatif est perdu, il ne se reporte pas.
   */
  netEur: DecimalString;
  exempt: boolean;
  rate: DecimalString;
  rateLabel: string;
  /** Impôt estimé : 0 si exonéré ou si le net est négatif. */
  taxEur: DecimalString;
  /** Cessions de l'année dont la valeur globale manque : l'année est alors approximative. */
  unknownGlobalValue: number;
}

export interface TaxLedger {
  cessions: TaxCession[];
  years: TaxYear[];
  /** Prix total d'acquisition résiduel après la dernière cession — base d'une vente simulée. */
  ptaAfter: DecimalString;
  /** Cessions dont la valeur globale du portefeuille n'a pas pu être établie. */
  unknownGlobalValue: number;
  /** Entrées venues de l'extérieur sans coût connu : le PTA est alors sous-estimé. */
  externalInflows: number;
  /** Sorties vers l'extérieur : un paiement en crypto serait imposable, un transfert non. */
  externalOutflows: number;
  /** Récompenses reçues (leur régime propre n'est pas traité ici). */
  rewards: number;
}

export interface TaxInput {
  /** Grand livre EN EUROS, dans n'importe quel ordre (le module trie). */
  events: readonly LedgerEvent[];
  /**
   * Valeur globale du portefeuille à la CLÔTURE d'un jour, si elle est connue. Le module y ajoute
   * lui-même les produits des cessions du jour pour reconstituer la valeur d'AVANT la cession —
   * une clôture est postérieure à la vente, l'actif vendu n'y figure plus.
   */
  closingValueAt?: ((day: string) => Big | null) | undefined;
  /** Valeurs globales saisies à la main (prioritaires sur la reconstitution). */
  annotations?: Record<EventId, DecimalString | null> | undefined;
}

const yearOf = (at: NaiveDateTime): number => Number(at.slice(0, 4));
const dayOf = (at: NaiveDateTime): string => at.slice(0, 10);

/** Nature fiscale d'un événement : c'est la seule règle de classement du module. */
export function taxKindOf(event: LedgerEvent): TaxEventKind {
  switch (event.kind) {
    case 'trade': {
      const outCash = isFiat(event.out.asset);
      const inCash = isFiat(event.in.asset);
      if (outCash && inCash) return 'ignored';
      // Sortie vers une monnaie ayant cours légal : la seule opération imposable d'un export.
      if (inCash) return 'cession';
      if (outCash) return 'acquisition';
      // Actif numérique contre actif numérique, stablecoins compris : sursis d'imposition.
      return 'sursis';
    }
    case 'reward':
      return 'reward';
    case 'deposit':
      return 'external-in';
    case 'withdrawal':
      return 'external-out';
    case 'opening-balance':
      return 'acquisition';
    // Migration (coût reporté), frais d'abonnement, lignes à qualifier : sans effet sur le PTA.
    default:
      return 'ignored';
  }
}

/** Coût d'acquisition en euros porté par un événement, quand il en porte un. */
function acquisitionCost(event: LedgerEvent): Big {
  if (event.kind === 'trade') return D(event.valueEur);
  if (event.kind === 'opening-balance') return D(event.costEur);
  if (event.kind === 'deposit') return event.costEur === null ? ZERO : D(event.costEur);
  return ZERO;
}

/**
 * Rejoue le grand livre et produit l'estimation année par année.
 *
 * Hypothèse structurante, à annoncer partout où le résultat s'affiche : **le portefeuille de cette
 * app est supposé être le portefeuille entier du contribuable**. La méthode est globale ; des
 * actifs détenus ailleurs changeraient à la fois le PTA et la valeur globale.
 */
export function computeFrenchTax(input: TaxInput): TaxLedger {
  const events = [...input.events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const annotations = input.annotations ?? {};

  // Produits encaissés par jour : ils servent à reconstituer la valeur d'avant la cession.
  const proceedsByDay = new Map<string, Big>();
  for (const event of events) {
    if (taxKindOf(event) !== 'cession' || event.kind !== 'trade') continue;
    const day = dayOf(event.at);
    proceedsByDay.set(day, (proceedsByDay.get(day) ?? ZERO).plus(event.valueEur));
  }

  let pta = ZERO;
  let externalInflows = 0;
  let externalOutflows = 0;
  let rewards = 0;
  const cessions: TaxCession[] = [];

  for (const event of events) {
    const kind = taxKindOf(event);
    if (kind === 'acquisition') {
      pta = pta.plus(acquisitionCost(event));
      if (event.kind === 'deposit' && event.costEur === null) externalInflows++;
      continue;
    }
    if (kind === 'reward') {
      // Une récompense entre à coût nul par défaut (décision n° 9) : elle n'ajoute rien au PTA.
      rewards++;
      continue;
    }
    if (kind === 'external-in') {
      pta = pta.plus(acquisitionCost(event));
      if (event.kind === 'deposit' && event.costEur === null) externalInflows++;
      continue;
    }
    if (kind === 'external-out') {
      externalOutflows++;
      continue;
    }
    if (kind !== 'cession' || event.kind !== 'trade') continue;

    const proceeds = D(event.valueEur);
    const day = dayOf(event.at);
    const annotated = annotations[event.id];
    const closing = input.closingValueAt?.(day) ?? null;
    // Valeur d'avant la cession ≈ clôture du jour + ce qui est sorti du portefeuille ce jour-là.
    const globalValue =
      annotated !== undefined && annotated !== null
        ? D(annotated)
        : closing === null
          ? null
          : closing.plus(proceedsByDay.get(day) ?? ZERO);

    const ptaBefore = pta;
    let share: Big | null = null;
    let gain: Big | null = null;
    if (globalValue !== null && globalValue.gt(ZERO)) {
      // La fraction imputée ne peut pas dépasser le PTA restant (cession de tout le portefeuille).
      const raw = ptaBefore.times(proceeds).div(globalValue);
      share = raw.gt(ptaBefore) ? ptaBefore : raw;
      gain = proceeds.minus(share);
      pta = ptaBefore.minus(share);
    }
    cessions.push({
      eventId: event.id,
      at: event.at,
      year: yearOf(event.at),
      proceedsEur: toDecimalString(proceeds),
      globalValueEur: globalValue === null ? null : toDecimalString(globalValue),
      ptaBefore: toDecimalString(ptaBefore),
      acquisitionShareEur: share === null ? null : toDecimalString(share),
      gainEur: gain === null ? null : toDecimalString(gain),
      ptaAfter: toDecimalString(pta),
    });
  }

  return {
    cessions,
    years: summarizeYears(cessions),
    ptaAfter: toDecimalString(pta),
    unknownGlobalValue: cessions.filter((c) => c.globalValueEur === null).length,
    externalInflows,
    externalOutflows,
    rewards,
  };
}

/** Agrège les cessions par année : seuil, plus et moins-values, impôt estimé. */
function summarizeYears(cessions: readonly TaxCession[]): TaxYear[] {
  const byYear = new Map<number, TaxCession[]>();
  for (const cession of cessions) {
    const list = byYear.get(cession.year) ?? [];
    list.push(cession);
    byYear.set(cession.year, list);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => {
      let proceeds = ZERO;
      let gains = ZERO;
      let losses = ZERO;
      let unknown = 0;
      for (const cession of list) {
        proceeds = proceeds.plus(cession.proceedsEur);
        if (cession.gainEur === null) {
          unknown++;
          continue;
        }
        const gain = D(cession.gainEur);
        if (gain.gte(ZERO)) gains = gains.plus(gain);
        else losses = losses.plus(gain.abs());
      }
      const net = gains.minus(losses);
      const exempt = proceeds.lte(D(EXEMPTION_THRESHOLD));
      const rate = rateFor(year);
      const tax = exempt || net.lte(ZERO) ? ZERO : net.times(rate.pfu);
      return {
        year,
        proceedsEur: toDecimalString(proceeds),
        cessionCount: list.length,
        gainsEur: toDecimalString(gains),
        lossesEur: toDecimalString(losses),
        netEur: toDecimalString(net),
        exempt,
        rate: rate.pfu,
        rateLabel: rate.label,
        taxEur: toDecimalString(tax),
        unknownGlobalValue: unknown,
      };
    });
}

export interface CessionPreviewInput {
  /** Prix total d'acquisition avant la cession simulée (`TaxLedger.ptaAfter`). */
  ptaBefore: Big;
  /** Produit net attendu de la vente. */
  proceedsEur: Big;
  /** Valeur globale du portefeuille AVANT la vente (positions actuelles, cet actif compris). */
  globalValueEur: Big;
  year: number;
  /** Cessions déjà réalisées cette année (pour le seuil de 305 €). */
  yearProceedsEur?: Big | undefined;
  /** Résultat net déjà constaté cette année (les moins-values s'imputent dans l'année). */
  yearNetEur?: Big | undefined;
}

export interface CessionPreview {
  acquisitionShareEur: DecimalString;
  /** Plus ou moins-value brute de CETTE cession. */
  gainEur: DecimalString;
  /** Prix total d'acquisition qui resterait après la vente. */
  ptaAfterEur: DecimalString;
  /** Total des cessions de l'année, cette vente comprise. */
  yearProceedsEur: DecimalString;
  /** Résultat net de l'année, cette vente comprise. */
  yearNetEur: DecimalString;
  exempt: boolean;
  rate: DecimalString;
  rateLabel: string;
  /** Impôt estimé sur l'année, cette vente comprise. */
  taxEur: DecimalString;
  /** Supplément d'impôt imputable à cette vente (impôt avec − impôt sans). */
  taxDeltaEur: DecimalString;
}

/** Aperçu d'une vente en euros AVANT de la passer : la même formule, sur le PTA du jour. */
export function previewCession(input: CessionPreviewInput): CessionPreview | null {
  if (!input.globalValueEur.gt(ZERO) || !input.proceedsEur.gt(ZERO)) return null;
  const rate = rateFor(input.year);
  const yearProceedsBefore = input.yearProceedsEur ?? ZERO;
  const yearNetBefore = input.yearNetEur ?? ZERO;

  const raw = input.ptaBefore.times(input.proceedsEur).div(input.globalValueEur);
  const share = raw.gt(input.ptaBefore) ? input.ptaBefore : raw;
  const gain = input.proceedsEur.minus(share);

  const taxOf = (proceeds: Big, net: Big): Big =>
    proceeds.lte(D(EXEMPTION_THRESHOLD)) || net.lte(ZERO) ? ZERO : net.times(rate.pfu);
  const before = taxOf(yearProceedsBefore, yearNetBefore);
  const yearProceeds = yearProceedsBefore.plus(input.proceedsEur);
  const yearNet = yearNetBefore.plus(gain);
  const after = taxOf(yearProceeds, yearNet);

  return {
    acquisitionShareEur: toDecimalString(share),
    gainEur: toDecimalString(gain),
    ptaAfterEur: toDecimalString(input.ptaBefore.minus(share)),
    yearProceedsEur: toDecimalString(yearProceeds),
    yearNetEur: toDecimalString(yearNet),
    exempt: yearProceeds.lte(D(EXEMPTION_THRESHOLD)),
    rate: rate.pfu,
    rateLabel: rate.label,
    taxEur: toDecimalString(after),
    taxDeltaEur: toDecimalString(after.minus(before)),
  };
}
