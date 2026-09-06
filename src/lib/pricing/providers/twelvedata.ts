/**
 * Twelve Data `GET /quote?symbol=<s1,s2,…>&apikey=<clé>` : dernier cours des actions et ETF —
 * la seule famille d'actifs qu'aucun fournisseur crypto du dépôt ne sait coter.
 *
 * **Seul fournisseur à clé obligatoire.** Sans clé saisie par l'utilisateur, il ne contacte rien
 * et laisse les actifs aux suivants, donc au prix manuel : la dégradation est douce, jamais une
 * erreur. Une clé de données de marché est en lecture seule et n'ouvre aucun compte — même
 * famille que la clé d'explorateur de blocs acceptée par la décision n° 32, à l'opposé d'une clé
 * d'exchange, et à l'opposé de la clé d'API eToro qui, elle, donne accès au compte.
 * Elle voyage en paramètre d'URL parce que l'API l'impose, comme la clé d'explorateur.
 *
 * CORS vérifié le 06/09/2026 avec
 * `curl -s -D - -o /dev/null -H "Origin: https://jeremyh974.github.io" <url>` :
 * `Access-Control-Allow-Origin: *`, HTTP 200. Quinze fournisseurs ont été sondés ainsi ; Yahoo
 * Finance, EODHD, Tiingo et OpenFIGI n'envoient aucun en-tête CORS et sont hors de portée d'une
 * application sans serveur (proposition du 06/09/2026).
 *
 * Ne cote que les codes de titres (`eq:`, décision n° 103), avec le symbole nu en majuscules. Une
 * devise autre qu'EUR ou USD repart sans prix plutôt que convertie au hasard : un prix faux est
 * pire qu'un prix absent (décision n° 54).
 */
import { nowIso } from '../../clock';
import { assetSymbol, isEquityCode } from '../../domain/assets';
import { isPositive, parseDecimal, toDecimalString } from '../../domain/money';
import type { AssetCode, DecimalString } from '../../domain/types';
import { defaultFetch, readJson } from '../../history/providers/shared';
import type { FetchLike } from '../../history/types';
import { numberToDecimal, type PriceProvider, type PriceQuoteInput, type UsdToEur } from '../types';

const ENDPOINT = 'https://api.twelvedata.com/quote';
/** Un appel consomme un crédit par symbole ; le palier gratuit en accorde 800 par jour. */
const CHUNK_SIZE = 20;

interface QuoteEntry {
  close?: unknown;
  currency?: unknown;
  status?: unknown;
}

/** Chaîne décimale strictement positive, ou `null` (valeur absente, invalide ou ≤ 0). */
function positiveDecimal(value: unknown): DecimalString | null {
  const text = numberToDecimal(value);
  if (text === null) return null;
  const big = parseDecimal(text);
  return big !== null && isPositive(big) ? toDecimalString(big) : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface TwelveDataOptions {
  /** Clé saisie par l'utilisateur ; `null` désactive le fournisseur sans appel réseau. */
  apiKey: string | null;
  usdToEur: UsdToEur;
  fetch?: FetchLike;
}

export function twelveDataProvider(options: TwelveDataOptions): PriceProvider {
  const doFetch = options.fetch ?? defaultFetch;

  return {
    name: 'Twelve Data',
    async fetchPrices(codes, signal) {
      const found = new Map<AssetCode, PriceQuoteInput>();
      const key = options.apiKey?.trim();
      if (!key) return found;

      // Un seul symbole peut porter deux actifs de classes différentes : seuls les titres passent.
      const codeBySymbol = new Map<string, AssetCode>();
      for (const code of codes) {
        if (isEquityCode(code)) codeBySymbol.set(assetSymbol(code).toUpperCase(), code);
      }
      if (codeBySymbol.size === 0) return found;

      for (const group of chunk([...codeBySymbol.keys()], CHUNK_SIZE)) {
        const url = `${ENDPOINT}?symbol=${group.join(',')}&apikey=${encodeURIComponent(key)}`;
        const response = await doFetch(url, { signal, headers: { accept: 'application/json' } });
        const body = (await readJson('Twelve Data', response)) as Record<string, unknown>;
        // Débit dépassé ou clé refusée : l'API répond 200 avec un statut d'erreur en bande.
        if (body['status'] === 'error') {
          const message =
            typeof body['message'] === 'string' ? body['message'] : 'réponse en erreur';
          throw new Error(`Twelve Data : ${message}`);
        }
        // Un symbole unique renvoie la cotation à plat ; plusieurs, un objet indexé par symbole.
        const entries: Record<string, QuoteEntry> =
          group.length === 1
            ? { [group[0]!]: body as QuoteEntry }
            : (body as Record<string, QuoteEntry>);
        const at = nowIso();
        for (const symbol of group) {
          const code = codeBySymbol.get(symbol);
          const entry = entries[symbol];
          if (!code || !entry || entry.status === 'error') continue;
          const close = positiveDecimal(entry.close);
          if (close === null) continue;
          const currency = typeof entry.currency === 'string' ? entry.currency.toUpperCase() : null;
          const priceEur =
            currency === 'EUR' ? close : currency === 'USD' ? options.usdToEur(close) : null;
          if (priceEur === null) continue;
          found.set(code, { asset: code, priceEur, at, source: 'Twelve Data', stale: false });
        }
      }
      return found;
    },
  };
}
