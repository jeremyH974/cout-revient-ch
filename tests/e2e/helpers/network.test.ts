/**
 * Le stub d'historique des tests E2E doit coter **l'actif qu'on lui demande**.
 *
 * Il rendait le même cours synthétique (100 à 122 €) pour tout le monde, sans regarder l'URL. Un
 * jeton détenu en milliards d'unités valorisait alors le portefeuille de démonstration à deux
 * millions d'euros : toute proportion mesurée dessus — part d'un actif, pourcentage d'allocation,
 * valeur portée au coût — devenait une fiction, et une spec qui aurait voulu la vérifier n'aurait
 * mesuré que l'artefact. Ce fichier est le garde-fou de cette propriété (décision n° 116).
 */
import { describe, expect, it } from 'vitest';
import { coinbaseCandles, coingeckoMarketChart, STUB_PRICES_EUR } from './network';

const geckoUrl = (id: string): URL =>
  new URL(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=eur&days=3`);
const coinbaseUrl = (symbol: string): URL =>
  new URL(
    `https://api.exchange.coinbase.com/products/${symbol}-EUR/candles` +
      '?granularity=86400&start=2026-09-01T00:00:00Z&end=2026-09-05T00:00:00Z',
  );

/** Écart relatif au prix de référence de l'actif : ce que le stub a le droit de faire osciller. */
const spread = (price: number, id: string): number => Math.abs(price / STUB_PRICES_EUR[id]! - 1);

describe('cours historique synthétique', () => {
  it('CoinGecko : chaque identifiant reçoit l’échelle de son propre actif', () => {
    const btc = coingeckoMarketChart(geckoUrl('bitcoin')).prices.map((p) => p[1]!);
    const pepe = coingeckoMarketChart(geckoUrl('pepe')).prices.map((p) => p[1]!);
    expect(btc.length).toBeGreaterThan(1);
    for (const price of btc) expect(spread(price, 'bitcoin')).toBeLessThan(0.15);
    for (const price of pepe) expect(spread(price, 'pepe')).toBeLessThan(0.15);
    // Sept ordres de grandeur séparent les deux : un stub qui ignore l'actif les rendrait égaux.
    expect(btc[0]! / pepe[0]!).toBeGreaterThan(1e9);
  });

  it('Coinbase : le symbole du produit choisit l’échelle, et le plus bas reste positif', () => {
    const rows = coinbaseCandles(coinbaseUrl('PEPE'));
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      // `[time, low, high, open, close, volume]` — la clôture est le seul champ que le
      // fournisseur lit, mais un plus bas négatif trahirait une bande en euros absolus.
      expect(spread(row[4]!, 'pepe')).toBeLessThan(0.15);
      expect(row[1]!).toBeGreaterThan(0);
      expect(row[1]!).toBeLessThanOrEqual(row[4]!);
      expect(row[2]!).toBeGreaterThanOrEqual(row[4]!);
    }
    expect(spread(coinbaseCandles(coinbaseUrl('BTC'))[0]![4]!, 'bitcoin')).toBeLessThan(0.15);
  });

  it('le cours bouge d’un jour à l’autre : une courbe plate ne prouverait rien', () => {
    const prices = coingeckoMarketChart(geckoUrl('bitcoin')).prices.map((p) => p[1]!);
    expect(new Set(prices).size).toBeGreaterThan(1);
  });

  it('un identifiant hors table reçoit un prix déterministe et strictement positif', () => {
    const first = coingeckoMarketChart(geckoUrl('un-jeton-inconnu')).prices[0]![1]!;
    const again = coingeckoMarketChart(geckoUrl('un-jeton-inconnu')).prices[0]![1]!;
    expect(first).toBeGreaterThan(0);
    expect(again).toBe(first);
  });
});
