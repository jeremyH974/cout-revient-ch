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
/**
 * **Un lot coûte un crédit par symbole, pas un crédit par appel** — et le palier gratuit n'en
 * accorde que huit _par minute_ (huit cents par jour). Grouper plus large ne fait donc pas
 * d'économie : ça garantit le refus. Mesuré le 08/09/2026 : douze symboles renvoient
 * « 12 API credits were used, with the current limit being 8 », huit renvoient huit cotations.
 */
const CHUNK_SIZE = 8;
/** Refus pour cause de débit : ce n'est pas une panne, c'est une minute à attendre. */
const RATE_LIMIT_CODE = 429;

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

const SEARCH_ENDPOINT = 'https://api.twelvedata.com/symbol_search';
/** Format ISIN : code pays, neuf caractères, clé de contrôle. */
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/**
 * Symboles résolus depuis un ISIN, mémorisés pour la durée de la session. Un relevé de courtier
 * identifie ses titres par ISIN — c'est le seul identifiant qu'il donne, et le seul qui soit
 * unique au monde — quand les fournisseurs de cours parlent en symboles. La résolution coûte un
 * crédit ; la refaire à chaque rafraîchissement en gaspillerait la moitié.
 */
const symbolByIsin = new Map<string, string | null>();

async function resolveSymbol(
  isin: string,
  key: string,
  doFetch: FetchLike,
  signal: AbortSignal,
): Promise<string | null> {
  const known = symbolByIsin.get(isin);
  if (known !== undefined) return known;
  const url = `${SEARCH_ENDPOINT}?symbol=${isin}&outputsize=1&apikey=${encodeURIComponent(key)}`;
  const response = await doFetch(url, { signal, headers: { accept: 'application/json' } });
  const body = (await readJson('Twelve Data', response)) as { data?: { symbol?: unknown }[] };
  const first = Array.isArray(body.data) ? body.data[0] : undefined;
  const symbol = typeof first?.symbol === 'string' && first.symbol !== '' ? first.symbol : null;
  symbolByIsin.set(isin, symbol);
  return symbol;
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
      const wanted = codes.filter(isEquityCode);
      if (wanted.length === 0) return found;
      const codeBySymbol = new Map<string, AssetCode>();
      for (const code of wanted) {
        const identifier = assetSymbol(code).toUpperCase();
        // Un ISIN se résout en symbole ; tout autre identifiant est déjà celui du fournisseur.
        const symbol = ISIN.test(identifier)
          ? await resolveSymbol(identifier, key, doFetch, signal)
          : identifier;
        if (symbol !== null) codeBySymbol.set(symbol, code);
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
          // Le quota par minute est une limite, pas une panne : rendre les lots déjà obtenus vaut
          // mieux que tout perdre. Les actifs restants passent aux fournisseurs suivants, puis au
          // prochain rafraîchissement — qui, lui, trouvera ceux-ci en cache et avancera d'autant.
          if (body['code'] === RATE_LIMIT_CODE) return found;
          throw new Error(`Twelve Data : ${message}`);
        }
        // Un symbole unique renvoie la cotation à plat, plusieurs un objet indexé par symbole.
        // On reconnaît la forme au lieu de la déduire du nombre demandé : l'API a le droit de
        // changer d’avis, et une cotation lue de travers vaudrait un prix absent.
        const flat = typeof (body as QuoteEntry).close !== 'undefined';
        const entries: Record<string, QuoteEntry> =
          flat && group[0] !== undefined
            ? { [group[0]]: body as QuoteEntry }
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
