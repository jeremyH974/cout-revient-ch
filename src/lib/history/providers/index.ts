import type { AssetCode } from '../../domain/types';
import type { HistoryProvider } from '../types';
import { coinbaseExchangeHistoryProvider } from './coinbase';
import { coingeckoHistoryProvider } from './coingecko';
import { defillamaHistoryProvider, type UsdToEurAt } from './defillama';
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
export function defaultHistoryProviders(
  coingeckoIdOverrides: Record<AssetCode, string | null> = {},
  usdToEurAt?: UsdToEurAt,
): HistoryProvider[] {
  const providers = [
    coinbaseExchangeHistoryProvider(),
    krakenHistoryProvider(),
    coingeckoHistoryProvider({ idOverrides: coingeckoIdOverrides }),
  ];
  if (usdToEurAt) {
    providers.push(defillamaHistoryProvider({ idOverrides: coingeckoIdOverrides, usdToEurAt }));
  }
  return providers;
}
