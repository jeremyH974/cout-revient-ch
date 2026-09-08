/**
 * Alpha Vantage `GET /query?function=TIME_SERIES_DAILY` : l'historique quotidien des titres
 * **européens**, que le palier gratuit de Twelve Data ne cote pas (décision n° 113).
 *
 * **Le quota commande la conception.** Vingt-cinq requêtes par jour, partagées avec le prix spot :
 * huit lignes européennes en historique et huit en spot en consomment déjà les deux tiers. D'où
 * `outputsize=full` — une seule requête rapporte vingt ans, quand `compact` en rapporterait cent
 * jours et obligerait à revenir. Le cache d'historique (`createHistoryStore`) fait le reste : la
 * série n'est demandée qu'une fois.
 *
 * **La réponse ne dit pas la devise**, comme pour le prix spot. Seul `alphaVantageSymbol()` décide
 * donc de ce qui est interrogé : uniquement les places dont la cotation en euros est certaine, et
 * jamais Londres, qui cote tantôt en pence tantôt en dollars sans que rien ne le signale.
 */
import { isEquityCode, assetSymbol } from '../../domain/assets';
import { alphaVantageSymbol } from '../../pricing/providers/alphavantage';
import type { AssetCode, DecimalString } from '../../domain/types';
import type { DayString, FetchLike, HistoryProvider } from '../types';
import { defaultFetch, pointsFromMap, priceFromJson, readJson } from './shared';

const ENDPOINT = 'https://www.alphavantage.co/query';

export interface AlphaVantageHistoryOptions {
  apiKey: string | null;
  fetch?: FetchLike;
}

export function alphaVantageHistoryProvider(options: AlphaVantageHistoryOptions): HistoryProvider {
  const key = options.apiKey?.trim() ?? '';
  const doFetch = options.fetch ?? defaultFetch;

  return {
    name: 'Alpha Vantage',
    maxDays: null,
    // Sans clé, ou hors d'une place dont l'euro est certain : rien n'est contacté.
    supports: (asset) =>
      Promise.resolve(
        key !== '' && isEquityCode(asset) && alphaVantageSymbol(assetSymbol(asset)) !== null,
      ),

    async fetchDaily(asset: AssetCode, fromDay, toDay, signal) {
      const symbol = key === '' ? null : alphaVantageSymbol(assetSymbol(asset));
      if (symbol === null) return [];
      const url =
        `${ENDPOINT}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}` +
        `&outputsize=full&apikey=${encodeURIComponent(key)}`;
      const response = await doFetch(url, { signal, headers: { accept: 'application/json' } });
      const body = (await readJson('Alpha Vantage', response)) as Record<string, unknown>;
      // Quota épuisé ou clé refusée : l'API répond 200 avec une phrase en anglais. L'actif repart
      // aux fournisseurs suivants plutôt que de faire échouer le chargement entier.
      if (typeof body['Information'] === 'string' || typeof body['Note'] === 'string') return [];
      const series = body['Time Series (Daily)'];
      if (typeof series !== 'object' || series === null) return [];

      const byDay = new Map<DayString, DecimalString>();
      for (const [day, row] of Object.entries(series as Record<string, unknown>)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < fromDay || day > toDay) continue;
        if (typeof row !== 'object' || row === null) continue;
        const price = priceFromJson((row as Record<string, unknown>)['4. close']);
        if (price !== null) byDay.set(day, price);
      }
      return pointsFromMap(byDay, fromDay, toDay);
    },
  };
}
