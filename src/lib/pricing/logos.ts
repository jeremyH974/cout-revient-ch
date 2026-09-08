/**
 * Logos des sociétés cotées, résolus par ticker chez Twelve Data.
 *
 * L'appel rend une URL servie par **la même origine que les cours**, déjà déclarée dans la CSP :
 * afficher ces images n'ouvre aucune porte que `connect-src` ne laissait pas ouverte. Il faut la
 * clé de l'utilisateur, comme pour les cours (décision n° 104) — sans elle, rien n'est demandé.
 *
 * **Le résultat est mémorisé, l'absence de logo comprise.** Un titre sans logo redemandé à chaque
 * rafraîchissement gaspillerait un crédit d'API par affichage, et le palier gratuit en accorde huit
 * cents par jour. Un `null` mémorisé vaut donc réponse.
 *
 * Le logo est une **icône d'identification** posée à côté d'un ticker, jamais un élément de marque
 * de l'application : c'est l'usage nominatif, celui que les fournisseurs de logos décrivent comme
 * acceptable. Le repli sur les initiales reste la norme dès qu'un logo manque.
 */
import type { AssetCode } from '../domain/types';
import { defaultFetch, readJson } from '../history/providers/shared';
import type { FetchLike } from '../history/types';
import { nowIso } from '../clock';

const ENDPOINT = 'https://api.twelvedata.com/logo';

export interface LogoLookup {
  /** URL du logo, ou `null` : le fournisseur n'en a pas pour ce symbole. */
  url: string | null;
  /** Instant de la résolution : une réponse, même négative, ne se redemande pas. */
  at: string;
}

export interface LogoOptions {
  apiKey: string | null;
  fetch?: FetchLike;
}

/** N'accepte qu'une URL de l'origine attendue : un fournisseur ne choisit pas où l'app va chercher. */
function safeLogoUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return value.startsWith(`${ENDPOINT}/`) ? value : null;
}

/**
 * Résout les logos manquants. Ne renvoie que ce qui a été demandé maintenant : l'appelant fusionne
 * avec ce qu'il connaît déjà, et n'interroge donc jamais deux fois le même symbole.
 */
export async function fetchLogos(
  symbolByCode: Readonly<Record<AssetCode, string>>,
  options: LogoOptions,
): Promise<Record<AssetCode, LogoLookup>> {
  const found: Record<AssetCode, LogoLookup> = {};
  const key = options.apiKey?.trim();
  const entries = Object.entries(symbolByCode);
  if (!key || entries.length === 0) return found;
  const doFetch = options.fetch ?? defaultFetch;

  for (const [code, symbol] of entries) {
    const url = `${ENDPOINT}?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
    try {
      const response = await doFetch(url, { headers: { accept: 'application/json' } });
      const body = (await readJson('Twelve Data', response)) as { url?: unknown; status?: unknown };
      // Un symbole inconnu répond « error » sans que ce soit une panne : on mémorise l'absence.
      found[code] = {
        url: body.status === 'error' ? null : safeLogoUrl(body.url),
        at: nowIso(),
      };
    } catch {
      // Panne réseau : ne rien mémoriser, pour retenter plus tard.
    }
  }
  return found;
}
