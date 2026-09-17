/**
 * Cours synthétiques du jeu de démonstration Hyperliquid (décision n° 164).
 *
 * Un tracé par marché, linéaire entre des nœuds : chaque fill y passe à son prix exact, le cours de
 * l'instantané le termine, et des nœuds toutes les trois heures l'agitent de ±0,4 % autour de la
 * droite qui relie les vrais. Aucun nœud n'est stocké : tout se recalcule depuis le jeu lui-même,
 * par une fonction déterministe du temps.
 *
 * C'est ce qui rend la démo cohérente. Le générateur tire de ce tracé les points `portfolio` de la
 * plateforme ; le client hors ligne en tire les bougies. La courbe détaillée de la démo recoupe donc
 * ses points exactement comme elle recouperait ceux d'un vrai compte, au lieu d'échouer sur une
 * oscillation inventée à part.
 *
 * Des `number` ici, et c'est voulu : ce sont des cours fictifs, arrondis en chaîne décimale avant de
 * quitter ce module. Rien de ce qu'ils valent n'entre dans un calcul du moteur sans cette étape.
 *
 * Aucun import : le générateur (`node scripts/generate-hl-fixture.ts`) charge ce module sans
 * bundler, et Node ne résout pas les imports relatifs sans extension.
 */

/** `[instant (ms), cours]`. */
export type PriceKnot = readonly [number, number];

/** Forme minimale du jeu lue ici (sous-ensemble de `HlFixture`, sans dépendance circulaire). */
export interface PricedFixture {
  userFillsByTime: unknown[];
  userNonFundingLedgerUpdates: unknown[];
  clearinghouseState: unknown;
  spotMeta: unknown;
  allMids: Record<string, string>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Pas des nœuds d'agitation, et distance minimale à un vrai nœud. */
const WIGGLE_STEP = 3 * HOUR;
const WIGGLE_CLEARANCE = HOUR / 2;
const WIGGLE_AMPLITUDE = 0.004;
/** Chiffres significatifs des cours publiés (le perp BTC à 64 123,5, PURR à 0,176543). */
const SIGNIFICANT = 6;

const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Bruit déterministe dans [−1, 1] pour un marché et un rang : un hachage, pas un générateur à état. */
function noise(market: string, rank: number): number {
  let h = 2166136261 ^ rank;
  for (let i = 0; i < market.length; i++) h = Math.imul(h ^ market.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

function interpolate(knots: readonly PriceKnot[], time: number): number {
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  if (time <= first[0]) return first[1];
  if (time >= last[0]) return last[1];
  let lo = 0;
  let hi = knots.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (knots[mid]![0] <= time) lo = mid;
    else hi = mid;
  }
  const [t0, p0] = knots[lo]!;
  const [t1, p1] = knots[hi]!;
  return t1 === t0 ? p1 : p0 + ((p1 - p0) * (time - t0)) / (t1 - t0);
}

/** Cours du tracé à un instant. */
export const pathPrice = interpolate;

/** Décimales qui donnent `SIGNIFICANT` chiffres significatifs à ce cours. */
const decimalsOf = (value: number): number =>
  Math.max(0, SIGNIFICANT - (Math.floor(Math.log10(Math.abs(value) || 1)) + 1));

/** Cours en chaîne décimale, arrondi au plus proche (ou vers le haut, vers le bas). */
export function priceText(value: number, toward: 'nearest' | 'up' | 'down' = 'nearest'): string {
  const decimals = decimalsOf(value);
  const scale = 10 ** decimals;
  const round = toward === 'up' ? Math.ceil : toward === 'down' ? Math.floor : Math.round;
  const text = (round(value * scale) / scale).toFixed(decimals);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** Paires spot du jeu (`@107` = HYPE/USDC), lues dans la forme brute de `spotMeta`. */
function spotPairsOf(spotMeta: unknown): { name: string; base: string; quote: string }[] {
  const meta = record(spotMeta);
  const tokens = Array.isArray(meta['tokens']) ? meta['tokens'].map(record) : [];
  const nameOf = (index: unknown): string | undefined =>
    tokens.find((t) => t['index'] === index)?.['name'] as string | undefined;
  const universe = Array.isArray(meta['universe']) ? meta['universe'].map(record) : [];
  return universe.flatMap((pair) => {
    const [base, quote] = Array.isArray(pair['tokens']) ? pair['tokens'].map(nameOf) : [];
    return typeof pair['name'] === 'string' && base && quote
      ? [{ name: pair['name'], base, quote }]
      : [];
  });
}

/** Tracés de tous les marchés du jeu : les nœuds exacts, puis l'agitation entre eux. */
export function priceKnots(fixture: PricedFixture): Record<string, PriceKnot[]> {
  const exact = new Map<string, Map<number, number>>();
  const put = (market: string, time: number, price: number): void => {
    if (!Number.isFinite(price) || price <= 0) return;
    const knots = exact.get(market) ?? new Map<number, number>();
    knots.set(time, price); // Plusieurs fills dans la milliseconde : le dernier donne le cours.
    exact.set(market, knots);
  };
  let start = Number.POSITIVE_INFINITY;
  for (const raw of fixture.userFillsByTime) {
    const fill = record(raw);
    const time = Number(fill['time']);
    put(String(fill['coin']), time, Number(fill['px']));
    start = Math.min(start, time);
  }
  const pairs = spotPairsOf(fixture.spotMeta);
  for (const raw of fixture.userNonFundingLedgerUpdates) {
    const entry = record(raw);
    const time = Number(entry['time']);
    start = Math.min(start, time);
    const delta = record(entry['delta']);
    // Un transfert de jeton porte sa valeur : c'est un cours observé.
    const pair = pairs.find((p) => p.base === delta['token'] && p.quote === 'USDC');
    if (pair && delta['usdcValue'] !== undefined)
      put(pair.name, time, Number(delta['usdcValue']) / Number(delta['amount']));
  }
  const end = Number(record(fixture.clearinghouseState)['time']);
  for (const [market, price] of Object.entries(fixture.allMids)) {
    if (exact.has(market)) put(market, end, Number(price));
  }
  const first = Math.floor(start / DAY) * DAY - DAY;

  const result: Record<string, PriceKnot[]> = {};
  for (const [market, knots] of exact) {
    const real = [...knots].sort((a, b) => a[0] - b[0]) as PriceKnot[];
    const all: PriceKnot[] = [...real];
    let rank = 0;
    for (let time = first; time <= end; time += WIGGLE_STEP, rank++) {
      if (real.some(([t]) => Math.abs(t - time) < WIGGLE_CLEARANCE)) continue;
      all.push([time, interpolate(real, time) * (1 + WIGGLE_AMPLITUDE * noise(market, rank))]);
    }
    result[market] = all.sort((a, b) => a[0] - b[0]);
  }
  return result;
}

/**
 * Bougies du tracé ouvertes dans `[from, to]`, sous la forme de l'API. Le plus haut et le plus bas
 * encadrent tout le tracé de la bougie : ses bornes et chaque nœud intérieur, arrondis vers
 * l'extérieur — une ligne brisée n'atteint ses extrêmes qu'à ses nœuds.
 */
export function pathCandles(
  knots: readonly PriceKnot[],
  market: string,
  interval: { id: string; ms: number },
  from: number,
  to: number,
): Record<string, unknown>[] {
  if (knots.length === 0) return [];
  const last = knots[knots.length - 1]![0];
  const candles: Record<string, unknown>[] = [];
  let next = 0;
  for (
    let t = Math.ceil(from / interval.ms) * interval.ms;
    t <= to && t <= last;
    t += interval.ms
  ) {
    const open = interpolate(knots, t);
    const close = interpolate(knots, t + interval.ms);
    let high = Math.max(open, close);
    let low = Math.min(open, close);
    while (next < knots.length && knots[next]![0] <= t) next++;
    for (let k = next; k < knots.length && knots[k]![0] < t + interval.ms; k++) {
      high = Math.max(high, knots[k]![1]);
      low = Math.min(low, knots[k]![1]);
    }
    candles.push({
      t,
      T: t + interval.ms - 1,
      s: market,
      i: interval.id,
      o: priceText(open),
      c: priceText(close),
      h: priceText(high, 'up'),
      l: priceText(low, 'down'),
      v: '0.0',
      n: 0,
    });
  }
  return candles;
}
