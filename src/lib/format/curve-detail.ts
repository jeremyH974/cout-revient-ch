/**
 * Les mots de la courbe détaillée du Trading (décision n° 164) : le pas des bougies, les marchés
 * sans cours, le nombre de points recoupés. Les montants, eux, restent au composant `Money`, qui
 * sait les convertir et les masquer.
 */

const INTERVAL_WORDS: Readonly<Record<string, string>> = {
  '1m': "d'une minute",
  '3m': 'de 3 minutes',
  '5m': 'de 5 minutes',
  '15m': 'de 15 minutes',
  '30m': 'de 30 minutes',
  '1h': "d'une heure",
  '2h': 'de 2 heures',
  '4h': 'de 4 heures',
  '8h': 'de 8 heures',
  '12h': 'de 12 heures',
  '1d': "d'un jour",
};

/** « bougies d'une minute », « bougies de 15 minutes » : le pas dit en toutes lettres. */
export const candleWords = (intervalId: string): string =>
  `bougies ${INTERVAL_WORDS[intervalId] ?? `de ${intervalId}`}`;

/** `perp:BTC` → « BTC (perp) », `spot:HYPE` → « HYPE (spot) » : le même nom peut être les deux. */
export function marketLabel(market: string): string {
  const [kind, ...name] = market.split(':');
  return name.length > 0 ? `${name.join(':')} (${kind})` : market;
}

/** « BTC (perp), HYPE (spot) et PURR (spot) ». */
export function marketList(markets: readonly string[]): string {
  const labels = markets.map(marketLabel);
  return labels.length <= 1
    ? (labels[0] ?? '')
    : `${labels.slice(0, -1).join(', ')} et ${labels[labels.length - 1]}`;
}

/** « 1 point d'Hyperliquid », « 5 points d'Hyperliquid ». */
export const platformPoints = (count: number): string =>
  `${count} point${count > 1 ? 's' : ''} d'Hyperliquid`;
