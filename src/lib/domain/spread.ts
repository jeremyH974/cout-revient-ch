/**
 * Spread implicite (décision n° 49) — ce que la plateforme prend EN PLUS de sa commission.
 *
 * Coinhouse n'affiche pas de spread : il annonce un prix, et répond publiquement que ce prix est
 * « une moyenne entre le prix d'achat et de vente ». L'écart entre ce prix et le cours de
 * référence du marché est donc un coût réel, invisible sur le relevé et absent de la grille
 * tarifaire. Ce module l'estime.
 *
 * **La précaution méthodologique commande tout le reste.** Le seul cours de référence dont l'app
 * dispose sur tout l'historique est QUOTIDIEN, alors qu'une opération a lieu à un instant précis.
 * Comparer les deux, opération par opération, produit un écart dominé par le mouvement du marché
 * dans la journée — souvent plus grand que le spread cherché. Le module n'affiche donc JAMAIS
 * d'estimation par opération : il agrège. Le bruit intrajournalier est à peu près symétrique et
 * s'annule en médiane ; un spread systématiquement défavorable, lui, ne s'annule pas. C'est
 * précisément ce que la médiane isole — et c'est pour cela qu'elle est préférée à la moyenne, que
 * quelques journées très volatiles suffiraient à emporter.
 *
 * Module pur : `Big` de bout en bout, aucun arrondi d'affichage, aucune horloge, aucun réseau.
 */
import { isFiat } from './assets';
import { D, ZERO, toDecimalString, type Big, type DecimalString } from './money';
import type { AssetCode, LedgerEvent, NaiveDateTime, TradeEvent } from './types';

/**
 * En dessous de ce nombre d'opérations comparables, le bruit intrajournalier domine la médiane :
 * le module rend son estimation mais la déclare NON fiable, et l'affichage doit le dire.
 */
export const MIN_SPREAD_SAMPLES = 20;

/**
 * Seuil par actif, plus bas que le seuil global mais non nul : une médiane sur une ou deux
 * opérations n'est pas une médiane, c'est l'écart d'un jour donné. Les actifs en dessous sont
 * simplement absents de la ventilation.
 */
export const MIN_ASSET_SAMPLES = 5;

/** Une opération comparée à son cours de référence. Jamais affichée seule : trop bruitée. */
export interface SpreadSample {
  eventId: string;
  at: NaiveDateTime;
  asset: AssetCode;
  side: 'buy' | 'sell';
  /** Prix affiché par la plateforme, en euros. */
  quoteEur: DecimalString;
  /** Cours de référence retenu pour ce jour, en euros. */
  referenceEur: DecimalString;
  /** Surcoût en ratio : POSITIF = défavorable à l'utilisateur, dans les deux sens d'opération. */
  deviation: DecimalString;
  valueEur: DecimalString;
}

export interface SpreadByAsset {
  asset: AssetCode;
  samples: number;
  medianDeviation: DecimalString;
  volumeEur: DecimalString;
  estimatedCostEur: DecimalString;
}

export interface SpreadEstimate {
  samples: number;
  /** Opérations écartées, par motif : de quoi expliquer un échantillon plus petit qu'attendu. */
  skipped: { noQuotePrice: number; notEurQuoted: number; noReference: number };
  /** Médiane des écarts (estimateur robuste) ; `null` sans aucun échantillon. */
  medianDeviation: DecimalString | null;
  /** Moyenne, donnée à titre de comparaison : sensible aux journées très volatiles. */
  meanDeviation: DecimalString | null;
  volumeEur: DecimalString;
  /** Coût estimé = médiane × volume comparé. Jamais une somme d'estimations par opération. */
  estimatedCostEur: DecimalString;
  /** Vrai si l'échantillon atteint `MIN_SPREAD_SAMPLES`. */
  reliable: boolean;
  byAsset: SpreadByAsset[];
  samplesDetail: SpreadSample[];
}

/** Cours de référence d'un actif pour un jour donné ; `null` si l'historique ne le couvre pas. */
export type ReferenceLookup = (asset: AssetCode, day: string) => Big | null;

/** Médiane d'une liste triable ; moyenne des deux valeurs centrales si le compte est pair. */
function median(values: readonly Big[]): Big | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a.cmp(b));
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return sorted[middle - 1]!.plus(sorted[middle]!).div('2');
}

function mean(values: readonly Big[]): Big | null {
  if (values.length === 0) return null;
  return values.reduce((acc, v) => acc.plus(v), ZERO).div(D(String(values.length)));
}

/** Sens de l'opération vu du prix coté : acheter au-dessus du marché coûte, vendre en dessous aussi. */
function sideOf(trade: TradeEvent): 'buy' | 'sell' | null {
  const outCash = isFiat(trade.out.asset);
  const inCash = isFiat(trade.in.asset);
  if (outCash && !inCash) return 'buy';
  if (!outCash && inCash) return 'sell';
  return null;
}

/**
 * Estime le spread implicite sur les opérations COTÉES EN EUROS d'un grand livre.
 *
 * Les échanges cotés dans une autre devise (paiement en USDC, par exemple) sont écartés et
 * comptés : les convertir ajouterait le bruit du change à celui de la journée, pour une mesure
 * qui vise justement à isoler un écart systématique de quelques dixièmes de pour cent.
 */
export function estimateSpread(
  events: readonly LedgerEvent[],
  reference: ReferenceLookup,
): SpreadEstimate {
  const samplesDetail: SpreadSample[] = [];
  const skipped = { noQuotePrice: 0, notEurQuoted: 0, noReference: 0 };

  for (const event of events) {
    if (event.kind !== 'trade' || event.source !== 'coinhouse-csv') continue;
    const side = sideOf(event);
    if (side === null) continue;
    if (!event.quotePrice) {
      skipped.noQuotePrice++;
      continue;
    }
    if (event.quotePrice.asset !== 'eur') {
      skipped.notEurQuoted++;
      continue;
    }
    const asset = side === 'buy' ? event.in.asset : event.out.asset;
    const day = event.at.slice(0, 10);
    const ref = reference(asset, day);
    if (ref === null || !ref.gt(ZERO)) {
      skipped.noReference++;
      continue;
    }
    const quote = D(event.quotePrice.price);
    if (!quote.gt(ZERO)) {
      skipped.noQuotePrice++;
      continue;
    }
    // Acheter plus cher que la référence, ou vendre moins cher : les deux sont défavorables.
    const raw = side === 'buy' ? quote.minus(ref) : ref.minus(quote);
    samplesDetail.push({
      eventId: event.id,
      at: event.at,
      asset,
      side,
      quoteEur: toDecimalString(quote),
      referenceEur: toDecimalString(ref),
      deviation: toDecimalString(raw.div(ref)),
      valueEur: event.valueEur,
    });
  }

  const deviations = samplesDetail.map((s) => D(s.deviation));
  const volume = samplesDetail.reduce((acc, s) => acc.plus(s.valueEur), ZERO);
  const med = median(deviations);
  const cost = med === null ? ZERO : med.times(volume);

  return {
    samples: samplesDetail.length,
    skipped,
    medianDeviation: med === null ? null : toDecimalString(med),
    meanDeviation: mean(deviations) === null ? null : toDecimalString(mean(deviations)!),
    volumeEur: toDecimalString(volume),
    estimatedCostEur: toDecimalString(cost),
    reliable: samplesDetail.length >= MIN_SPREAD_SAMPLES,
    byAsset: summarizeByAsset(samplesDetail),
    samplesDetail,
  };
}

/** Même estimateur, actif par actif : un spread peut être bien plus large sur les petites lignes. */
function summarizeByAsset(samples: readonly SpreadSample[]): SpreadByAsset[] {
  const assets = [...new Set(samples.map((s) => s.asset))];
  return assets
    .filter((asset) => samples.filter((s) => s.asset === asset).length >= MIN_ASSET_SAMPLES)
    .map((asset) => {
      const own = samples.filter((s) => s.asset === asset);
      const med = median(own.map((s) => D(s.deviation)))!;
      const volume = own.reduce((acc, s) => acc.plus(s.valueEur), ZERO);
      return {
        asset,
        samples: own.length,
        medianDeviation: toDecimalString(med),
        volumeEur: toDecimalString(volume),
        estimatedCostEur: toDecimalString(med.times(volume)),
      };
    })
    .sort((a, b) => D(b.estimatedCostEur).cmp(D(a.estimatedCostEur)));
}
