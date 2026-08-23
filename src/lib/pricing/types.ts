import type { PriceQuoteInput } from '../domain/engine/report';
import type { AssetCode, DecimalString } from '../domain/types';

export type { PriceQuoteInput };

export interface PriceProvider {
  name: string;
  /** Ne renvoie que les actifs trouvés ; lève en cas d'erreur réseau / HTTP. */
  fetchPrices(codes: AssetCode[], signal: AbortSignal): Promise<Map<AssetCode, PriceQuoteInput>>;
}

/**
 * Convertit un prix coté en USD (ou USDC, traité comme USD) en EUR au taux BCE du jour ;
 * `null` si aucun taux n'est disponible (le fournisseur laisse alors l'actif aux suivants).
 */
export type UsdToEur = (priceUsd: DecimalString) => DecimalString | null;

/** Conversion d'un nombre JSON en chaîne décimale canonique (sans exposant). */
export function numberToDecimal(value: unknown): DecimalString | null {
  if (typeof value === 'string') return /^-?\d+(\.\d+)?$/.test(value) ? value : null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  let text = String(value);
  if (/e/i.test(text)) text = value.toFixed(20);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text;
}
