/**
 * Cascade de prix : manuel → cache frais → fournisseurs (dans l'ordre) → cache périmé.
 * Jamais de polling ; une seule actualisation à la demande ou à l'ouverture.
 */
import type { AssetCode } from '../domain/types';
import type { AssetSettings } from '../storage/schema';
import { EUR_PEGGED } from './tickers';
import type { PriceProvider, PriceQuoteInput } from './types';

export interface RefreshOptions {
  providers: PriceProvider[];
  /** Âge maximal d'une cotation en cache avant rafraîchissement. */
  maxAgeMs: number;
  now: () => number;
  timeoutMs?: number;
}

export interface RefreshResult {
  quotes: Record<AssetCode, PriceQuoteInput>;
  missing: AssetCode[];
  errors: string[];
  /** Vrai si au moins un fournisseur a répondu. */
  online: boolean;
}

export function manualQuote(
  code: AssetCode,
  settings: AssetSettings | undefined,
): PriceQuoteInput | null {
  if (!settings?.manualPriceEur) return null;
  return {
    asset: code,
    priceEur: settings.manualPriceEur,
    at: settings.manualPriceAt ?? new Date(0).toISOString(),
    source: 'manuel',
    stale: false,
  };
}

export async function refreshPrices(
  codes: AssetCode[],
  cache: Record<AssetCode, PriceQuoteInput>,
  assetSettings: Record<AssetCode, AssetSettings>,
  options: RefreshOptions,
): Promise<RefreshResult> {
  const quotes: Record<AssetCode, PriceQuoteInput> = {};
  const errors: string[] = [];
  let online = false;
  let pending: AssetCode[] = [];
  const now = options.now();

  for (const code of codes) {
    const manual = manualQuote(code, assetSettings[code]);
    if (manual) {
      quotes[code] = manual;
      continue;
    }
    if (EUR_PEGGED.has(code)) {
      quotes[code] = {
        asset: code,
        priceEur: '1',
        at: new Date(now).toISOString(),
        source: 'parité €',
        stale: false,
      };
      continue;
    }
    const cached = cache[code];
    if (cached && now - Date.parse(cached.at) <= options.maxAgeMs) {
      quotes[code] = { ...cached, stale: false };
      continue;
    }
    pending.push(code);
  }

  for (const provider of options.providers) {
    if (pending.length === 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
    try {
      const found = await provider.fetchPrices(pending, controller.signal);
      online = true;
      for (const [code, quote] of found) quotes[code] = quote;
      pending = pending.filter((code) => !found.has(code));
    } catch (error) {
      errors.push(`${provider.name} : ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  const missing: AssetCode[] = [];
  for (const code of pending) {
    const cached = cache[code];
    if (cached) quotes[code] = { ...cached, stale: true };
    else missing.push(code);
  }
  return { quotes, missing, errors, online };
}
