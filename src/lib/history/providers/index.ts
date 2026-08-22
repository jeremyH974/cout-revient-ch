import type { AssetCode } from '../../domain/types';
import type { HistoryProvider } from '../types';
import { coinbaseExchangeHistoryProvider } from './coinbase';
import { coingeckoHistoryProvider } from './coingecko';
import { krakenHistoryProvider } from './kraken';

export { coinbaseExchangeHistoryProvider, coinbaseProductId, coinbaseQueue } from './coinbase';
export { COINGECKO_MAX_DAYS, coingeckoHistoryProvider, coingeckoQueue } from './coingecko';
export { KRAKEN_MAX_DAYS, krakenHistoryProvider, krakenPairName, krakenQueue } from './kraken';

/**
 * Ordre recommandé : Coinbase (profondeur illimitée, rapide) puis Kraken (720 j) comblent avec
 * des clôtures d'exchange ; CoinGecko (365 j, lent) ne sert qu'aux actifs cotés nulle part
 * ailleurs ou pour la tête manquante.
 */
export function defaultHistoryProviders(
  coingeckoIdOverrides: Record<AssetCode, string | null> = {},
): HistoryProvider[] {
  return [
    coinbaseExchangeHistoryProvider(),
    krakenHistoryProvider(),
    coingeckoHistoryProvider({ idOverrides: coingeckoIdOverrides }),
  ];
}
