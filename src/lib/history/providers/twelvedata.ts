/**
 * Twelve Data `GET /time_series?symbol=…&interval=1day&start_date=…&end_date=…` : l'historique
 * quotidien des **titres**, que ne cote aucune source crypto du dépôt.
 *
 * **Un appel rend la série entière d'un symbole pour un crédit** (mesuré le 08/09/2026), là où le
 * prix spot en coûte un par symbole et par rafraîchissement. Le palier gratuit en accorde huit
 * cents par jour : les lignes américaines tiennent largement.
 *
 * Contrairement à `/quote`, **`meta.currency` est rendu** — le fournisseur n'a donc pas à deviner.
 * Un euro est pris tel quel, un dollar est converti **au taux du jour de chaque point** (jamais au
 * taux courant : une série de deux ans convertie au cours d'aujourd'hui serait une autre courbe),
 * et toute autre devise fait repartir l'actif sans point plutôt qu'avec un facteur inconnu — un
 * prix faux est pire qu'un prix absent (décision n° 54).
 *
 * Le palier gratuit ne cote que les places américaines (décision n° 113) : une valeur de Paris ou
 * de Francfort répond en erreur, et repart vers Alpha Vantage.
 */
import { isEquityCode, assetSymbol } from '../../domain/assets';
import type { AssetCode, DecimalString } from '../../domain/types';
import type { DayString, FetchLike, HistoryProvider } from '../types';
import { defaultFetch, pointsFromMap, priceFromJson, readJson } from './shared';
import type { UsdToEurAt } from './defillama';

const ENDPOINT = 'https://api.twelvedata.com/time_series';

export interface TwelveDataHistoryOptions {
  apiKey: string | null;
  /** Conversion datée : obligatoire pour les titres américains, cotés en dollars. */
  usdToEurAt?: UsdToEurAt | undefined;
  fetch?: FetchLike;
}

interface Row {
  datetime?: unknown;
  close?: unknown;
}

/** Ligne exploitable : un jour `AAAA-MM-JJ` et un cours de clôture positif. */
function dayAndClose(row: unknown): [DayString, DecimalString] | null {
  if (typeof row !== 'object' || row === null) return null;
  const { datetime, close } = row as Row;
  if (typeof datetime !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(datetime)) return null;
  const price = priceFromJson(close);
  return price === null ? null : [datetime.slice(0, 10), price];
}

export function twelveDataHistoryProvider(options: TwelveDataHistoryOptions): HistoryProvider {
  const key = options.apiKey?.trim() ?? '';
  const doFetch = options.fetch ?? defaultFetch;
  const usdToEurAt = options.usdToEurAt;

  return {
    name: 'Twelve Data',
    maxDays: null,
    // Sans clé, rien n'est contacté : le fournisseur suivant garde sa chance.
    supports: (asset) => Promise.resolve(key !== '' && isEquityCode(asset)),

    async fetchDaily(asset: AssetCode, fromDay, toDay, signal) {
      if (key === '') return [];
      const symbol = assetSymbol(asset).toUpperCase();
      const url =
        `${ENDPOINT}?symbol=${encodeURIComponent(symbol)}&interval=1day` +
        `&start_date=${fromDay}&end_date=${toDay}&outputsize=5000` +
        `&apikey=${encodeURIComponent(key)}`;
      const response = await doFetch(url, { signal, headers: { accept: 'application/json' } });
      const body = (await readJson('Twelve Data', response)) as {
        status?: unknown;
        values?: unknown;
        meta?: { currency?: unknown };
      };
      // Symbole hors du palier gratuit, ou quota épuisé : l'actif repart aux fournisseurs suivants
      // au lieu de faire échouer tout le chargement.
      if (body.status === 'error' || !Array.isArray(body.values)) return [];

      const currency = typeof body.meta?.currency === 'string' ? body.meta.currency : '';
      const isEur = currency.toUpperCase() === 'EUR';
      const isUsd = currency.toUpperCase() === 'USD';
      if (!isEur && !(isUsd && usdToEurAt)) return [];

      const byDay = new Map<DayString, DecimalString>();
      for (const row of body.values) {
        const parsed = dayAndClose(row);
        if (parsed === null) continue;
        const [day, price] = parsed;
        const eur = isEur ? price : usdToEurAt!(day, price);
        // Un jour sans taux BCE (week-end, jour férié) est écarté : la série a le droit d'avoir
        // des trous, pas d'avoir un point converti au taux d'un autre jour.
        if (eur !== null) byDay.set(day, eur);
      }
      return pointsFromMap(byDay, fromDay, toDay);
    },
  };
}
