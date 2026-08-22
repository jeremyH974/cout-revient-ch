/** Taux de change : l'euro est la devise de référence des données importées. */
import type { DecimalString } from '../domain/money';

export type Currency = 'EUR' | 'USD';

export const CURRENCIES: readonly Currency[] = ['EUR', 'USD'];

export interface CurrencyInfo {
  code: Currency;
  label: string;
  /** Symbole affiché (Intl `narrowSymbol`). */
  symbol: string;
}

export const CURRENCY_INFO: Record<Currency, CurrencyInfo> = {
  EUR: { code: 'EUR', label: 'Euro', symbol: '€' },
  USD: { code: 'USD', label: 'Dollar américain', symbol: '$' },
};

/** Série de taux EUR → devise, indexée par jour `YYYY-MM-DD` (jours ouvrés BCE uniquement). */
export type RateSeries = Record<string, DecimalString>;

export interface FxCache {
  /** Devise de base des taux (toujours EUR pour l'instant). */
  base: 'EUR';
  rates: Partial<Record<Currency, RateSeries>>;
  /** ISO 8601 de la dernière mise à jour réussie, par devise. */
  updatedAt: Partial<Record<Currency, string>>;
  source: string;
}

export const EMPTY_FX_CACHE: FxCache = {
  base: 'EUR',
  rates: {},
  updatedAt: {},
  source: 'BCE via Frankfurter',
};

export interface FxProvider {
  name: string;
  /** Taux EUR→`currency` pour chaque jour ouvré de l'intervalle [fromDay, toDay]. */
  fetchRange(
    currency: Currency,
    fromDay: string,
    toDay: string,
    signal: AbortSignal,
  ): Promise<RateSeries>;
}
