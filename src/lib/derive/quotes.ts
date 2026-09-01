/**
 * Les cotations que le moteur utilisera, et l'ordre de priorité qui les départage
 * (décision n° 94).
 *
 * Trois sources coexistent, et leur ordre décide de tous les chiffres affichés : le **prix manuel**
 * l'emporte sur la **cotation en direct**, qui l'emporte sur le **cache**. C'est le seul endroit où
 * cet arbitrage est écrit, il n'avait aucun test, et se tromper d'ordre ne casserait rien de
 * visible — cela afficherait simplement de mauvais prix.
 */
import type { PriceQuoteInput } from '../domain/engine/report';
import type { AssetCode } from '../domain/types';

/** Réglage d'actif, réduit à ce qui influence la cotation. */
export interface QuoteOverride {
  manualPriceEur: string | null;
  manualPriceAt: string | null;
}

/**
 * Date portée par un prix manuel qui n'en a pas. L'époque Unix, délibérément : elle n'est pas
 * plausible, donc elle se remarque, là qu'une date du jour ferait passer une saisie ancienne pour
 * fraîche.
 */
export const MANUAL_PRICE_EPOCH = '1970-01-01T00:00:00.000Z';

export function effectiveQuotes(
  cache: Readonly<Record<AssetCode, PriceQuoteInput>>,
  live: Readonly<Record<AssetCode, PriceQuoteInput>>,
  overrides: Readonly<Record<AssetCode, QuoteOverride>>,
): Record<AssetCode, PriceQuoteInput> {
  const result: Record<AssetCode, PriceQuoteInput> = { ...cache, ...live };
  for (const [asset, settings] of Object.entries(overrides)) {
    if (!settings.manualPriceEur) continue;
    result[asset] = {
      asset,
      priceEur: settings.manualPriceEur,
      at: settings.manualPriceAt ?? MANUAL_PRICE_EPOCH,
      source: 'manuel',
      // Un prix saisi par l'utilisateur n'est jamais « périmé » : c'est SA valeur, pas une
      // cotation qu'on aurait dû rafraîchir.
      stale: false,
    };
  }
  return result;
}
