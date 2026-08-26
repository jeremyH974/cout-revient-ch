/**
 * DefiLlama `GET /chart/{coingecko:id}?start=<sec>&span=<n>&period=1d` : série de prix **en
 * dollars**, sans clé, sur toute la profondeur disponible. Filet de sécurité profond : ne sert que
 * les bords que les fournisseurs cotant nativement en euros (Coinbase, Kraken, CoinGecko) ne
 * couvrent pas — l'histoire ancienne et les actifs de longue traîne.
 *
 * Sondes du 26/08/2026 avec
 * `curl -s -D - -o /dev/null -H "Origin: https://jeremyh974.github.io" <url>` :
 * `access-control-allow-origin: https://jeremyh974.github.io`, HTTP 200.
 *
 * - Profondeur réelle : `coingecko:bitcoin` remonte au 2013-04-28 ; `coingecko:terra-luna`
 *   (jeton mort) renvoie encore ses points de mai 2022.
 * - `span` (nombre de périodes couvertes depuis `start`) est plafonné à **500** : `span=500` répond
 *   200, `span=501` répond **HTTP 400** avec `{"message":"Requested 501 data points exceeds the
 *   maximum of 500."}`. La pagination ne dépasse donc jamais 500 ; `seriesOf` garde tout de même le
 *   champ `message`, au cas où l'API servirait un jour cette erreur en 200.
 * - `start` et `end` sont mutuellement exclusifs (« use either start or end parameter, not both »),
 *   d'où la pagination en marche avant par `start` + `span`.
 * - Actif inconnu, identifiant invalide ou plage antérieure à la création de l'actif :
 *   `{"coins":{}}`, sans erreur HTTP.
 * - La documentation officielle (`docs.llama.fi/coin-prices-api`) renvoyait 404 ce jour-là : ce
 *   contrat vient des sondes ci-dessus, et `scripts/api-contract.mjs` le surveille.
 *
 * Deux particularités par rapport aux autres fournisseurs de cette couche :
 *
 * 1. **Les prix sont cotés en dollars.** La conversion est *injectée* (`usdToEurAt`, taux BCE du
 *    jour) et jamais devinée : un jour sans taux voit son point omis plutôt que converti à un taux
 *    approximatif. `fetchDaily` a le droit de renvoyer un résultat partiel.
 * 2. **`start` est posé à midi UTC**, si bien que chaque point tombe vers 12:00 et appartient sans
 *    ambiguïté à sa journée — pas la bascule de minuit que `closeDayOf` traite chez CoinGecko. Ces
 *    points sont donc des cours de milieu de journée et non des clôtures ; comme le service ne fait
 *    remplir à chaque fournisseur que des bords disjoints, les deux natures ne se mélangent jamais
 *    au sein d'une même journée.
 */
import { isPositive, parseDecimal } from '../../domain/money';
import type { AssetCode, DecimalString } from '../../domain/types';
import { TICKERS } from '../../pricing/tickers';
import { DAY_MS, addDays, dayToMs, daysBetween, msToDay } from '../days';
import { RequestQueue } from '../queue';
import type { DayString, FetchLike, HistoryProvider } from '../types';
import { defaultFetch, pointsFromMap, priceFromJson, readJson } from './shared';

const ENDPOINT = 'https://coins.llama.fi/chart';

/** Plafond de points par requête, mesuré le 26/08/2026 (au-delà : corps `message`, HTTP 200). */
export const DEFILLAMA_MAX_SPAN = 500;

/**
 * En deçà, DefiLlama juge le prix trop incertain (faible profondeur de marché) : même seuil que le
 * fournisseur spot du dépôt. Une série *sans* champ `confidence` est acceptée — un champ absent
 * signifie « inconnu », pas « mauvais », et la table des tickers ne contient de toute façon que des
 * actifs curés. C'est `scripts/api-contract.mjs` qui prévient d'un changement de forme.
 */
const MIN_CONFIDENCE = 0.8;

/** Conversion USD → EUR au taux BCE d'un jour donné ; `null` si le taux manque. */
export type UsdToEurAt = (day: DayString, priceUsd: DecimalString) => DecimalString | null;

export interface DefillamaHistoryOptions {
  /** Id CoinGecko par actif (réglages utilisateur), prioritaire sur la table des tickers. */
  idOverrides?: Record<AssetCode, string | null>;
  /** Sans elle, le fournisseur ne peut rien coter en euros : `supports()` répond faux. */
  usdToEurAt?: UsdToEurAt;
  fetch?: FetchLike;
  queue?: RequestQueue;
}

/**
 * Aucune limite de débit n'est publiée pour l'accès gratuit ; rotki, seule implémentation de
 * référence, s'auto-limite à ~1,5 requête/s. Une requête toutes les 700 ms, backoff 1 s → 4 s.
 */
export function defillamaHistoryQueue(): RequestQueue {
  return new RequestQueue({ minIntervalMs: 700, maxAttempts: 3, backoffMs: 1000 });
}

interface ChartPoint {
  timestamp: number;
  price: number;
}

function isChartPoint(value: unknown): value is ChartPoint {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ChartPoint).timestamp === 'number' &&
    typeof (value as ChartPoint).price === 'number'
  );
}

/**
 * Série d'un actif. `confidence` est ici au **niveau de la série** ; `/batchHistorical` la porte au
 * contraire par point, et `/percentage` renvoie un simple nombre : ne jamais partager ce type entre
 * ces endpoints.
 */
interface ChartSeries {
  confidence: number | null;
  prices: ChartPoint[];
}

/** Gardes champ par champ ; lève si le corps porte le `message` d'erreur applicatif de l'API. */
function seriesOf(body: unknown, key: string): ChartSeries | null {
  if (typeof body !== 'object' || body === null) return null;
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') throw new Error(`DefiLlama : ${message}`);
  const coins = (body as { coins?: unknown }).coins;
  if (typeof coins !== 'object' || coins === null) return null;
  const series = (coins as Record<string, unknown>)[key];
  if (typeof series !== 'object' || series === null) return null;
  const prices = (series as { prices?: unknown }).prices;
  if (!Array.isArray(prices)) return null;
  const confidence = (series as { confidence?: unknown }).confidence;
  return {
    confidence: typeof confidence === 'number' ? confidence : null,
    prices: prices.filter(isChartPoint),
  };
}

export function defillamaHistoryProvider(options: DefillamaHistoryOptions = {}): HistoryProvider {
  const doFetch = options.fetch ?? defaultFetch;
  const queue = options.queue ?? defillamaHistoryQueue();
  const usdToEurAt = options.usdToEurAt;
  const idOf = (asset: AssetCode): string | null =>
    options.idOverrides?.[asset] ?? TICKERS[asset]?.coingeckoId ?? null;

  async function chart(
    key: string,
    fromDay: DayString,
    span: number,
    signal: AbortSignal,
  ): Promise<ChartSeries | null> {
    // Midi UTC : le point du jour ne tombe pas sur la frontière de minuit.
    const start = Math.floor((dayToMs(fromDay) + DAY_MS / 2) / 1000);
    const url = `${ENDPOINT}/${key}?start=${start}&span=${span}&period=1d`;
    const response = await queue.run(
      () => doFetch(url, { signal, headers: { accept: 'application/json' } }),
      signal,
    );
    const body = await readJson('DefiLlama', response);
    return seriesOf(body, key);
  }

  return {
    name: 'DefiLlama',
    maxDays: null,
    supports: (asset) => Promise.resolve(idOf(asset) !== null && usdToEurAt !== undefined),

    async fetchDaily(asset, fromDay, toDay, signal) {
      const id = idOf(asset);
      if (id === null || usdToEurAt === undefined) return [];
      if (daysBetween(fromDay, toDay) < 0) return [];
      const key = `coingecko:${id}`;
      const byDay = new Map<DayString, DecimalString>();
      let seen = false;
      let windowFrom = fromDay;

      while (windowFrom <= toDay) {
        const span = Math.min(DEFILLAMA_MAX_SPAN, daysBetween(windowFrom, toDay) + 1);
        const series = await chart(key, windowFrom, span, signal);
        const points =
          series !== null && (series.confidence === null || series.confidence >= MIN_CONFIDENCE)
            ? series.prices
            : [];

        if (points.length === 0) {
          // Fenêtre vide *avant* toute donnée : l'actif est coté plus tard, on continue.
          // Fenêtre vide *après* des données : la série est close (délistage), on s'arrête.
          if (seen) break;
        } else {
          seen = true;
          for (const point of points) {
            const priceUsd = priceFromJson(point.price);
            if (priceUsd === null) continue;
            const big = parseDecimal(priceUsd);
            if (big === null || !isPositive(big)) continue;
            const day = msToDay(point.timestamp * 1000);
            const priceEur = usdToEurAt(day, priceUsd);
            if (priceEur !== null) byDay.set(day, priceEur);
          }
        }
        windowFrom = addDays(windowFrom, span);
      }

      return pointsFromMap(byDay, fromDay, toDay);
    },
  };
}
