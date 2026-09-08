/**
 * Alpha Vantage `GET /query?function=GLOBAL_QUOTE` : le dernier cours des titres **européens**,
 * les seuls que Twelve Data laisse sans prix.
 *
 * Le palier gratuit de Twelve Data ne cote que les places américaines : une valeur de Paris, de
 * Francfort ou de Londres y répond « This symbol is available starting with the Grow plan »
 * (mesuré le 08/09/2026, décision n° 113). Vingt sources ont été sondées avec un en-tête `Origin`
 * réel ; une seule passe à la fois le CORS, la gratuité et l'Europe.
 *
 * Deuxième clé de l'utilisateur, même famille que la première (décision n° 32, étendue par la
 * n° 104) : données de marché en lecture seule, qui n'ouvrent aucun compte. Sans elle, rien n'est
 * contacté et les titres passent au prix manuel — la dégradation reste douce.
 *
 * **`GLOBAL_QUOTE` ne dit pas la devise.** Le prix est donc pris pour un euro seulement sur les
 * places dont la cotation est en euros sans ambiguïté ; partout ailleurs le titre repart sans
 * prix. Un cours de Londres, coté tantôt en pence tantôt en dollars, vaudrait un facteur cent —
 * et un prix faux est pire qu'un prix absent (décision n° 54).
 */
import { nowIso } from '../../clock';
import { assetSymbol, isEquityCode } from '../../domain/assets';
import { isPositive, parseDecimal, toDecimalString } from '../../domain/money';
import type { AssetCode, DecimalString } from '../../domain/types';
import { defaultFetch, readJson } from '../../history/providers/shared';
import type { FetchLike } from '../../history/types';
import { numberToDecimal, type PriceProvider, type PriceQuoteInput } from '../types';

const ENDPOINT = 'https://www.alphavantage.co/query';

/**
 * Le palier gratuit accorde vingt-cinq requêtes par jour et cinq par minute, et `GLOBAL_QUOTE` ne
 * groupe rien : un symbole, une requête. On s'arrête à cinq par rafraîchissement, et le suivant
 * reprend là où celui-ci s'est arrêté — les cours obtenus tiennent en cache d'ici là.
 */
const MAX_PER_REFRESH = 5;

/**
 * Suffixe de place d'Alpha Vantage → devise de cotation, pour les seules places dont la réponse
 * est en euros sans discussion. Vérifié le 08/09/2026 par `SYMBOL_SEARCH`, qui rend la devise là
 * où `GLOBAL_QUOTE` la tait : `KER.PAR` et `SW.PAR` en EUR sur Paris, `MOH.DEX` sur XETRA,
 * `SJ7.FRK` sur Francfort. Londres (`.LON`) est exclue à dessein — elle cote en pence ou en
 * dollars selon la ligne, et rien dans la réponse ne le dit.
 */
const EUR_VENUES: ReadonlySet<string> = new Set(['PAR', 'DEX', 'FRK']);

/**
 * Traduction du suffixe de place d'un relevé eToro vers celui d'Alpha Vantage. Mécanique, donc
 * sans entretien : elle vaut pour tout titre à venir sur ces places.
 */
const VENUE_BY_BROKER_SUFFIX: Readonly<Record<string, string>> = {
  PA: 'PAR', // Euronext Paris
  DE: 'DEX', // XETRA Francfort
};

/**
 * Ce que la traduction mécanique ne peut pas deviner. Un relevé nomme parfois un titre par son
 * ticker d'une autre place — ou sans place du tout — quand le fournisseur, lui, exige la sienne :
 * `SWDA` (Londres, en pence) et `EUNL` (XETRA, en euros) sont **le même fonds**, IE00B4L5Y983.
 * Choisir la ligne en euros évite une conversion, et le facteur cent qui va avec.
 *
 * Table tenue à la main et prioritaire, sur le patron de `tickers.ts` : un symbole qu'on ne sait
 * pas placer ne reçoit **aucune** correspondance, jamais une approximation.
 */
const CURATED: Readonly<Record<string, string>> = {
  KER: 'KER.PAR', // Kering — le relevé omet la place
  SWDA: 'EUNL.DEX', // iShares Core MSCI World UCITS — IE00B4L5Y983, pris à Francfort
  'CNDX.L': 'SXRV.DEX', // iShares NASDAQ 100 UCITS — IE00B53SZB19, idem
};

export interface AlphaVantageOptions {
  apiKey: string | null;
  fetch?: FetchLike;
}

/**
 * Symbole Alpha Vantage d'un ticker de courtier, ou `null` si la place est inconnue ou ne cote
 * pas en euros. Exporté pour être éprouvé seul : c'est là que se joue l'identité du titre.
 */
export function alphaVantageSymbol(ticker: string): string | null {
  const bare = ticker.trim().toUpperCase();
  if (bare === '') return null;
  const curated = CURATED[bare];
  if (curated !== undefined) return curated;
  const cut = bare.lastIndexOf('.');
  if (cut <= 0) return null;
  const venue = VENUE_BY_BROKER_SUFFIX[bare.slice(cut + 1)];
  if (venue === undefined || !EUR_VENUES.has(venue)) return null;
  return `${bare.slice(0, cut)}.${venue}`;
}

/** Chaîne décimale strictement positive, ou `null` (valeur absente, invalide ou ≤ 0). */
function positiveDecimal(value: unknown): DecimalString | null {
  const text = numberToDecimal(value);
  if (text === null) return null;
  const big = parseDecimal(text);
  return big !== null && isPositive(big) ? toDecimalString(big) : null;
}

export function alphaVantageProvider(options: AlphaVantageOptions): PriceProvider {
  const key = options.apiKey?.trim() ?? '';
  const doFetch = options.fetch ?? defaultFetch;

  return {
    name: 'Alpha Vantage',
    async fetchPrices(codes, signal) {
      const found = new Map<AssetCode, PriceQuoteInput>();
      if (key === '') return found;

      const wanted: [AssetCode, string][] = [];
      for (const code of codes) {
        if (!isEquityCode(code)) continue;
        const symbol = alphaVantageSymbol(assetSymbol(code));
        if (symbol !== null) wanted.push([code, symbol]);
      }

      for (const [code, symbol] of wanted.slice(0, MAX_PER_REFRESH)) {
        const url = `${ENDPOINT}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
        const response = await doFetch(url, { signal, headers: { accept: 'application/json' } });
        const body = (await readJson('Alpha Vantage', response)) as Record<string, unknown>;
        // Quota épuisé ou clé refusée : l'API répond 200 avec une phrase en anglais, sans cours.
        // On rend les cours déjà obtenus — un refus de débit est une attente, pas une panne.
        if (typeof body['Information'] === 'string' || typeof body['Note'] === 'string') {
          return found;
        }
        const quote = body['Global Quote'];
        if (typeof quote !== 'object' || quote === null) continue;
        const priceEur = positiveDecimal((quote as Record<string, unknown>)['05. price']);
        if (priceEur === null) continue;
        found.set(code, {
          asset: code,
          priceEur,
          at: nowIso(),
          source: 'Alpha Vantage',
          stale: false,
        });
      }
      return found;
    },
  };
}
