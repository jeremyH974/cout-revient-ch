/**
 * Analyse de l'abonnement Coinhouse (décision n° 39) : l'offre de l'utilisateur est DÉDUITE DE
 * SES DONNÉES, jamais demandée — les lignes « Abonnement » facturées dans l'export disent s'il
 * paie une offre (et laquelle, par le montant annualisé), les colonnes de remises disent ce que
 * l'offre lui a réellement fait gagner. Le contrefactuel « qu'aurait coûté la grille Classique
 * sur les mêmes opérations » est une ESTIMATION prudente (achat supposé par virement, 0,99 % —
 * l'export ne distingue pas la carte), toujours annoncée comme telle. Module pur : uniquement
 * les événements du grand livre issus de l'export Coinhouse.
 */
import { isFiat, isStablecoin } from './assets';
import { COINHOUSE_FEES, feeOnGross, type FeeRate } from './fees';
import { D, ZERO, toDecimalString, type Big, type DecimalString } from './money';
import type { LedgerEvent, NaiveDateTime, TradeEvent } from './types';

/** Prix Particuliers de la grille du 18/08/2026 (PDF officiel) : Investisseur 118,80 €/an TTC. */
export const INVESTISSEUR_ANNUAL_EUR: DecimalString = '118.8';

/**
 * Frontière de classement d'un abonnement observé, en €/12 mois : en dessous, Investisseur
 * (118,80 €/an, ou son équivalent mensuel) ; au-dessus, Gestion Privée (≈ 800-1 000 €/an sur la
 * grille du 18/08/2026). Large à dessein : elle sépare des ordres de grandeur, pas des centimes,
 * et reste juste si l'affichage convertit les montants en dollars.
 */
const TIER_BOUNDARY_12M = D('400');

export type CoinhouseTier = 'classique' | 'investisseur' | 'gestion-privee';

export interface SubscriptionAnalysis {
  /** Nombre d'opérations Coinhouse analysées (échanges) ; 0 = rien à dire. */
  tradeCount: number;
  detectedTier: CoinhouseTier;
  /** Preuve lisible de la détection (« 3 abonnements facturés… », « aucune ligne… »). */
  detectionNote: string;
  subscriptionCount: number;
  subscriptionsTotal: DecimalString;
  subscriptions12m: DecimalString;
  /** Frais d'opérations : bruts, remises accordées par l'offre, nets réellement payés. */
  feesGross: DecimalString;
  rebates: DecimalString;
  rebates12m: DecimalString;
  feesNet: DecimalString;
  feesNet12m: DecimalString;
  /** Contrefactuel : frais estimés de la grille Classique sur les mêmes opérations. */
  classiqueFees: DecimalString;
  /** Économies vs Classique (contrefactuel − frais nets payés) ; peut être négatif. */
  savedVsClassique: DecimalString;
  /** Rentabilité RÉALISÉE de l'offre : remises − abonnements payés (total et 12 mois). */
  netOfSubscription: DecimalString | null;
  netOfSubscription12m: DecimalString | null;
  /** Volume d'opérations (Σ des contre-valeurs) — total et 12 derniers mois. */
  volume: DecimalString;
  volume12m: DecimalString;
  /**
   * Compte Classique seulement : volume annuel d'opérations à partir duquel l'offre Investisseur
   * (118,80 €/an) se rembourse, si elle offrait les frais sur ce volume — hypothèse annoncée.
   */
  breakEvenAnnualVolume: DecimalString | null;
  /** Borne de la fenêtre glissante (12 mois avant le dernier événement Coinhouse). */
  windowStart: NaiveDateTime | null;
}

/** `2026-08-25T…` → `2025-08-25T…` (29 février rabattu au 28) : fenêtre sans fuseau ni Date. */
export function oneYearBefore(at: NaiveDateTime): NaiveDateTime {
  const year = Number(at.slice(0, 4)) - 1;
  const rest = at.slice(4);
  const candidate = `${year}${rest}`;
  return candidate.slice(5, 10) === '02-29' ? `${year}-02-28${at.slice(10)}` : candidate;
}

/** Barème Classique d'un échange, déduit de ses jambes (achat supposé par virement — prudent). */
export function classiqueFeeKindOf(trade: TradeEvent): FeeRate {
  const outCash = isFiat(trade.out.asset);
  const inCash = isFiat(trade.in.asset);
  if (outCash && !inCash) return COINHOUSE_FEES['buy-sepa'];
  if (!outCash && inCash) return COINHOUSE_FEES['sell-eur'];
  if (isStablecoin(trade.out.asset) && isStablecoin(trade.in.asset))
    return COINHOUSE_FEES['stable-stable'];
  return COINHOUSE_FEES['crypto-crypto'];
}

export interface AnalyzeOptions {
  /**
   * Frais fixes par transaction du contrefactuel, dans la devise des événements fournis
   * (0,12 € sur la grille ; l'appelant le convertit si les événements sont affichés en dollars).
   */
  fixedPerTrade?: DecimalString;
}

/**
 * Analyse les événements ISSUS DE L'EXPORT COINHOUSE (les autres comptes ne paient pas la grille
 * Coinhouse et sont ignorés). Pur et sans arrondi : l'affichage arrondit, pas l'analyse.
 */
export function analyzeSubscription(
  events: readonly LedgerEvent[],
  options: AnalyzeOptions = {},
): SubscriptionAnalysis {
  const fixedPerTrade = D(options.fixedPerTrade ?? '0.12');
  const coinhouse = events.filter((e) => e.source === 'coinhouse-csv');
  const trades = coinhouse.filter((e): e is TradeEvent => e.kind === 'trade');
  const subscriptions = coinhouse.filter((e) => e.kind === 'fee');
  const lastAt = coinhouse.reduce<NaiveDateTime | null>(
    (max, e) => (max === null || e.at > max ? e.at : max),
    null,
  );
  const windowStart = lastAt === null ? null : oneYearBefore(lastAt);
  const inWindow = (at: NaiveDateTime): boolean => windowStart !== null && at >= windowStart;

  let feesGross = ZERO;
  let feesGross12m = ZERO;
  let rebates = ZERO;
  let rebates12m = ZERO;
  let classiqueFees = ZERO;
  let volume = ZERO;
  let volume12m = ZERO;
  for (const trade of trades) {
    const value = D(trade.valueEur);
    volume = volume.plus(value);
    if (inWindow(trade.at)) volume12m = volume12m.plus(value);
    if (trade.fee) {
      feesGross = feesGross.plus(trade.fee.grossEur);
      rebates = rebates.plus(trade.fee.rebateEur);
      if (inWindow(trade.at)) {
        feesGross12m = feesGross12m.plus(trade.fee.grossEur);
        rebates12m = rebates12m.plus(trade.fee.rebateEur);
      }
    }
    // Pourcentage de la grille + fixe PARAMÉTRÉ (converti par l'appelant si l'affichage est en
    // dollars) — jamais le fixe de la grille en plus, il serait compté deux fois.
    const kind = classiqueFeeKindOf(trade);
    classiqueFees = classiqueFees
      .plus(feeOnGross(value, { pctFee: kind.pctFee, fixedEur: '0' }))
      .plus(fixedPerTrade);
  }
  const feesNet = feesGross.minus(rebates);
  const feesNet12m = feesGross12m.minus(rebates12m);

  let subscriptionsTotal = ZERO;
  let subscriptions12m = ZERO;
  for (const fee of subscriptions) {
    if (fee.kind !== 'fee') continue;
    subscriptionsTotal = subscriptionsTotal.plus(fee.amountEur);
    if (inWindow(fee.at)) subscriptions12m = subscriptions12m.plus(fee.amountEur);
  }

  // La note reste SANS montant : les chiffres se formatent dans la couche d'affichage.
  let detectedTier: CoinhouseTier = 'classique';
  let detectionNote = 'aucune ligne d’abonnement dans l’export — grille Classique';
  if (subscriptions.length > 0) {
    detectedTier = subscriptions12m.gt(TIER_BOUNDARY_12M) ? 'gestion-privee' : 'investisseur';
    const count = subscriptions.length;
    detectionNote = `${count} ligne${count > 1 ? 's' : ''} d’abonnement facturée${count > 1 ? 's' : ''} dans l’export`;
  }

  // Compte Classique : à partir de quel volume annuel l'offre Investisseur se rembourserait-elle ?
  // `taux effectif observé = frais Classique estimés ÷ volume` ; hypothèse « frais offerts sur ce
  // volume » — la grille du jour ne publie pas de plafond lisible, l'écran le dit.
  let breakEvenAnnualVolume: Big | null = null;
  if (detectedTier === 'classique' && volume.gt(ZERO) && classiqueFees.gt(ZERO)) {
    const effectiveRate = classiqueFees.div(volume);
    if (effectiveRate.gt(ZERO))
      breakEvenAnnualVolume = D(INVESTISSEUR_ANNUAL_EUR).div(effectiveRate);
  }

  const hasSubscription = subscriptions.length > 0;
  return {
    tradeCount: trades.length,
    detectedTier,
    detectionNote,
    subscriptionCount: subscriptions.length,
    subscriptionsTotal: toDecimalString(subscriptionsTotal),
    subscriptions12m: toDecimalString(subscriptions12m),
    feesGross: toDecimalString(feesGross),
    rebates: toDecimalString(rebates),
    rebates12m: toDecimalString(rebates12m),
    feesNet: toDecimalString(feesNet),
    feesNet12m: toDecimalString(feesNet12m),
    classiqueFees: toDecimalString(classiqueFees),
    savedVsClassique: toDecimalString(classiqueFees.minus(feesNet)),
    netOfSubscription: hasSubscription ? toDecimalString(rebates.minus(subscriptionsTotal)) : null,
    netOfSubscription12m: hasSubscription
      ? toDecimalString(rebates12m.minus(subscriptions12m))
      : null,
    volume: toDecimalString(volume),
    volume12m: toDecimalString(volume12m),
    breakEvenAnnualVolume:
      breakEvenAnnualVolume === null ? null : toDecimalString(breakEvenAnnualVolume),
    windowStart,
  };
}
