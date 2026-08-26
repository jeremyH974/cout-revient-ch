/**
 * Indice « Fear & Greed » crypto d'alternative.me (décision n° 43) — du CONTEXTE, pas un signal.
 *
 * Trois choses en font une brique à part dans cette app :
 * 1. **C'est la seule donnée qui ne vienne pas de vos opérations ni des cours de vos actifs.** Elle
 *    est donc derrière un opt-in réseau distinct, décoché par défaut, comme les prix.
 * 2. **L'attribution est une condition d'utilisation** : la source doit rester visible à l'écran,
 *    et l'app l'affiche systématiquement à côté de la valeur.
 * 3. **Elle ne dit jamais quoi faire.** L'indice est repris tel quel, daté ; aucune règle de l'app
 *    n'en tire de recommandation d'acheter ou de vendre.
 *
 * Module pur côté parsing : `fetch` est injecté, la réponse est validée avant d'être crue.
 */

/** L'API n'a pas de clé et n'accepte aucun paramètre au-delà de `limit`. */
export const FEAR_GREED_URL = 'https://api.alternative.me/fng/';

/** Mention exigée par les conditions d'utilisation de la source, affichée avec la valeur. */
export const FEAR_GREED_ATTRIBUTION = 'alternative.me';

/** Classement publié par la source, repris tel quel (jamais retraduit en conseil). */
export type FearGreedBand =
  'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed' | 'unknown';

export interface FearGreedPoint {
  /** 0 (peur extrême) à 100 (avidité extrême). */
  value: number;
  band: FearGreedBand;
  /** Libellé brut de la source, conservé pour la traçabilité. */
  rawLabel: string;
  /** Jour de la mesure, AAAA-MM-JJ (l'indice est quotidien, calculé en UTC). */
  day: string;
}

const BANDS: Record<string, FearGreedBand> = {
  'extreme fear': 'extreme-fear',
  fear: 'fear',
  neutral: 'neutral',
  greed: 'greed',
  'extreme greed': 'extreme-greed',
};

/** Bandes déduites de la valeur, si le libellé de la source est inconnu (elle a déjà changé). */
function bandOf(value: number, label: string): FearGreedBand {
  const known = BANDS[label.trim().toLowerCase()];
  if (known) return known;
  if (value < 25) return 'extreme-fear';
  if (value < 45) return 'fear';
  if (value <= 55) return 'neutral';
  if (value <= 75) return 'greed';
  return 'extreme-greed';
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Valide et convertit la réponse de l'API. Tout écart au format attendu rend `null` : mieux vaut
 * ne rien afficher qu'un contexte faux.
 */
export function parseFearGreed(payload: unknown): FearGreedPoint | null {
  if (!isRecord(payload) || !Array.isArray(payload['data'])) return null;
  const first: unknown = payload['data'][0];
  if (!isRecord(first)) return null;
  const value = Number(first['value']);
  const timestamp = Number(first['timestamp']);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const label =
    typeof first['value_classification'] === 'string' ? first['value_classification'] : '';
  // Horodatage en SECONDES chez la source ; le jour est celui d'UTC, la mesure étant quotidienne.
  const day = new Date(timestamp * 1000).toISOString().slice(0, 10);
  return { value, band: bandOf(value, label), rawLabel: label, day };
}

export interface FearGreedOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal | undefined;
}

/** Dernière valeur publiée. Rend `null` sur toute erreur : le contexte est facultatif par nature. */
export async function loadFearGreed(
  options: FearGreedOptions = {},
): Promise<FearGreedPoint | null> {
  const doFetch = options.fetch ?? globalThis.fetch;
  try {
    const response = await doFetch(`${FEAR_GREED_URL}?limit=1`, {
      headers: { accept: 'application/json' },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) return null;
    return parseFearGreed(await response.json());
  } catch {
    return null;
  }
}
