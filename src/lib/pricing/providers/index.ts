/**
 * Chaîne de fournisseurs de prix par défaut : premier succès gagne, actif par actif
 * (`refreshPrices` ne transmet à chaque fournisseur que les actifs encore sans cotation).
 *
 * Ordre : CoinGecko (une requête groupée, cotation EUR native, longue traîne ; clé Demo
 * optionnelle) → Coinbase (EUR natif, un appel par actif) → Kraken (EUR natif, groupé) →
 * Hyperliquid (mids USDC : HYPE, PURR et tokens spot Hyperliquid) → DefiLlama (USD, filet de
 * sécurité par identifiant CoinGecko). Les prix en dollars sont convertis au taux BCE du jour par
 * `usdToEur` (docs/DECISIONS.md n° 18).
 */
import type { AssetCode } from '../../domain/types';
import type { PriceProvider, UsdToEur } from '../types';
import { coinbaseProvider } from './coinbase';
import { coingeckoProvider } from './coingecko';
import { defillamaProvider } from './defillama';
import { hyperliquidProvider } from './hyperliquid';
import { krakenTickerProvider } from './kraken';

export interface DefaultProvidersOptions {
  /** Identifiants CoinGecko forcés par actif (réglages). */
  idOverrides?: Record<AssetCode, string | null>;
  coingeckoDemoKey?: string | null;
  /**
   * Convertisseur USD → EUR, éventuellement différé : le taux BCE se charge en parallèle des
   * fournisseurs cotés en euros, et seuls Hyperliquid et DefiLlama l'attendent.
   */
  usdToEur: UsdToEur | Promise<UsdToEur>;
}

/** Fournisseur coté en dollars : construit une fois le convertisseur disponible. */
function usdProvider(
  name: string,
  usdToEur: UsdToEur | Promise<UsdToEur>,
  build: (usdToEur: UsdToEur) => PriceProvider,
): PriceProvider {
  if (typeof usdToEur === 'function') return build(usdToEur);
  return {
    name,
    fetchPrices: async (codes, signal) => build(await usdToEur).fetchPrices(codes, signal),
  };
}

export function defaultPriceProviders(options: DefaultProvidersOptions): PriceProvider[] {
  const idOverrides = options.idOverrides ?? {};
  return [
    coingeckoProvider(idOverrides, { apiKey: options.coingeckoDemoKey ?? null }),
    coinbaseProvider(),
    krakenTickerProvider(),
    usdProvider('Hyperliquid', options.usdToEur, (usdToEur) => hyperliquidProvider({ usdToEur })),
    usdProvider('DefiLlama', options.usdToEur, (usdToEur) =>
      defillamaProvider({ idOverrides, usdToEur }),
    ),
  ];
}
