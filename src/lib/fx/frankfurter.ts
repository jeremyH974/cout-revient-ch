/**
 * Frankfurter (https://frankfurter.dev) : taux de référence de la BCE, API ouverte sans clé,
 * CORS activé (vérifié le 22/08/2026). Réponse : `{ rates: { 'YYYY-MM-DD': { USD: 1.08 } } }`,
 * jours ouvrés seulement ; les intervalles longs sont découpés par le service (on re-demande).
 */
import { numberToDecimal } from '../pricing/types';
import type { FxProvider, RateSeries } from './types';

const ENDPOINT = 'https://api.frankfurter.dev/v1';

export function frankfurterProvider(): FxProvider {
  return {
    name: 'BCE via Frankfurter',
    async fetchRange(currency, fromDay, toDay, signal) {
      const url = `${ENDPOINT}/${fromDay}..${toDay}?base=EUR&symbols=${currency}`;
      const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`Frankfurter HTTP ${response.status}`);
      const body = (await response.json()) as { rates?: Record<string, Record<string, unknown>> };
      const series: RateSeries = {};
      for (const [day, rates] of Object.entries(body.rates ?? {})) {
        const value = numberToDecimal(rates[currency]);
        if (value) series[day] = value;
      }
      return series;
    },
  };
}
