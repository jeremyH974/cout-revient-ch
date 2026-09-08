import type { AssetCode } from '../../domain/types';
import type { HistoryProvider } from '../types';
import { coinbaseExchangeHistoryProvider } from './coinbase';
import { coingeckoHistoryProvider } from './coingecko';
import { alphaVantageHistoryProvider } from './alphavantage';
import { defillamaHistoryProvider, type UsdToEurAt } from './defillama';
import { twelveDataHistoryProvider } from './twelvedata';
import { krakenHistoryProvider } from './kraken';

export { coinbaseExchangeHistoryProvider, coinbaseProductId, coinbaseQueue } from './coinbase';
export { COINGECKO_MAX_DAYS, coingeckoHistoryProvider, coingeckoQueue } from './coingecko';
export {
  DEFILLAMA_MAX_SPAN,
  defillamaHistoryProvider,
  defillamaHistoryQueue,
  type DefillamaHistoryOptions,
  type UsdToEurAt,
} from './defillama';
export { KRAKEN_MAX_DAYS, krakenHistoryProvider, krakenPairName, krakenQueue } from './kraken';
export { alphaVantageHistoryProvider } from './alphavantage';
export { twelveDataHistoryProvider } from './twelvedata';

/**
 * Ordre recommandé : Coinbase (profondeur illimitée, rapide) puis Kraken (720 j) comblent avec
 * des clôtures d'exchange ; CoinGecko (365 j, lent) ne sert qu'aux actifs cotés nulle part
 * ailleurs ou pour la tête manquante.
 *
 * DefiLlama vient **en dernier** (décision n° 42) : les trois premiers cotent nativement en euros,
 * lui seul cote en dollars et impose une conversion — on préfère toujours un prix coté à un prix
 * converti. Le service ne faisant remplir à chaque fournisseur que les bords encore vides, il ne
 * reçoit donc que ce que personne n'a couvert : l'histoire profonde et la longue traîne. Sans
 * `usdToEurAt` il ne peut rien convertir, et n'est alors pas ajouté.
 */
export interface HistoryKeys {
  /** Cours des titres américains ; sans elle, ce fournisseur ne contacte rien. */
  twelveDataApiKey?: string | null;
  /** Cours des titres européens (Paris, Francfort) ; même règle. */
  alphaVantageApiKey?: string | null;
}

export function defaultHistoryProviders(
  coingeckoIdOverrides: Record<AssetCode, string | null> = {},
  usdToEurAt?: UsdToEurAt,
  keys: HistoryKeys = {},
): HistoryProvider[] {
  const providers = [
    coinbaseExchangeHistoryProvider(),
    krakenHistoryProvider(),
    coingeckoHistoryProvider({ idOverrides: coingeckoIdOverrides }),
    // Les deux sources de titres passent AVANT DefiLlama : toutes déclarent `supports`, donc
    // l'ordre ne coûte rien, mais il dit la lecture — un `eq:` se cote ici, pas ailleurs.
    twelveDataHistoryProvider({ apiKey: keys.twelveDataApiKey ?? null, usdToEurAt }),
    alphaVantageHistoryProvider({ apiKey: keys.alphaVantageApiKey ?? null }),
  ];
  if (usdToEurAt) {
    providers.push(defillamaHistoryProvider({ idOverrides: coingeckoIdOverrides, usdToEurAt }));
  }
  return providers;
}
