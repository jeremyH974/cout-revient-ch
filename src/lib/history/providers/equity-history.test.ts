/**
 * Historique des cours de titres. Les deux fournisseurs partagent une règle et se séparent sur une
 * autre : aucun ne contacte quoi que ce soit sans clé, mais **Twelve Data rend la devise** de la
 * série (`meta.currency`) alors qu'Alpha Vantage la tait — d'où une conversion datée d'un côté, et
 * un filtre de place de l'autre.
 */
import { describe, expect, it } from 'vitest';
import { equityCode } from '../../domain/assets';
import type { FetchLike } from '../types';
import { alphaVantageHistoryProvider } from './alphavantage';
import { twelveDataHistoryProvider } from './twelvedata';

function fakeFetch(body: unknown): { calls: string[]; fetch: FetchLike } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetch };
}

const signal = new AbortController().signal;
const aapl = equityCode('AAPL');
/** Taux fictif : 1 USD = 0,90 € le 12, 0,50 € le 13 — deux jours DIFFÉRENTS, à dessein. */
const usdToEurAt = (day: string, usd: string): string | null =>
  day === '2026-09-12'
    ? String(Number(usd) * 0.9)
    : day === '2026-09-13'
      ? String(Number(usd) * 0.5)
      : null;

const series = (currency: string): unknown => ({
  meta: { currency },
  values: [
    { datetime: '2026-09-13', close: '200' },
    { datetime: '2026-09-12', close: '100' },
  ],
});

describe('historique Twelve Data', () => {
  it('sans clé, ne contacte rien', async () => {
    const { calls, fetch } = fakeFetch(series('USD'));
    const p = twelveDataHistoryProvider({ apiKey: null, usdToEurAt, fetch });
    expect(await p.supports!(aapl, signal)).toBe(false);
    expect(await p.fetchDaily(aapl, '2026-09-01', '2026-09-30', signal)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('ne s’occupe pas des cryptos', async () => {
    const { fetch } = fakeFetch(series('USD'));
    const p = twelveDataHistoryProvider({ apiKey: 'clef', usdToEurAt, fetch });
    expect(await p.supports!('btc', signal)).toBe(false);
  });

  it('convertit CHAQUE point au taux de SON jour, jamais au taux courant', async () => {
    // Le cœur du fournisseur : une série de deux ans convertie au cours d'aujourd'hui serait une
    // autre courbe. 100 $ le 12 → 90 € ; 200 $ le 13 → 100 €, pas 180.
    const { fetch } = fakeFetch(series('USD'));
    const p = twelveDataHistoryProvider({ apiKey: 'clef', usdToEurAt, fetch });
    const points = await p.fetchDaily(aapl, '2026-09-01', '2026-09-30', signal);
    expect(points).toEqual([
      { day: '2026-09-12', priceEur: '90' },
      { day: '2026-09-13', priceEur: '100' },
    ]);
  });

  it('prend l’euro tel quel', async () => {
    const { fetch } = fakeFetch(series('EUR'));
    const p = twelveDataHistoryProvider({ apiKey: 'clef', usdToEurAt, fetch });
    const points = await p.fetchDaily(aapl, '2026-09-01', '2026-09-30', signal);
    expect(points.map((x) => x.priceEur)).toEqual(['100', '200']);
  });

  it('écarte une devise qu’il ne sait pas convertir plutôt que d’inventer un facteur', async () => {
    // Une livre prise pour un euro vaudrait ~20 % d'erreur ; prise pour des pence, un facteur cent.
    const { fetch } = fakeFetch(series('GBP'));
    const p = twelveDataHistoryProvider({ apiKey: 'clef', usdToEurAt, fetch });
    expect(await p.fetchDaily(aapl, '2026-09-01', '2026-09-30', signal)).toEqual([]);
  });

  it('écarte un jour sans taux plutôt que d’emprunter celui d’un autre', async () => {
    const { fetch } = fakeFetch({
      meta: { currency: 'USD' },
      values: [{ datetime: '2026-09-14', close: '100' }],
    });
    const p = twelveDataHistoryProvider({ apiKey: 'clef', usdToEurAt, fetch });
    expect(await p.fetchDaily(aapl, '2026-09-01', '2026-09-30', signal)).toEqual([]);
  });

  it('rend la main sur un quota épuisé au lieu de faire échouer le chargement', async () => {
    const { fetch } = fakeFetch({ status: 'error', message: 'run out of API credits' });
    const p = twelveDataHistoryProvider({ apiKey: 'clef', usdToEurAt, fetch });
    expect(await p.fetchDaily(aapl, '2026-09-01', '2026-09-30', signal)).toEqual([]);
  });
});

const avSeries = {
  'Time Series (Daily)': {
    '2026-09-13': { '4. close': '431.2000' },
    '2026-09-12': { '4. close': '429.1000' },
  },
};

describe('historique Alpha Vantage', () => {
  it('sans clé, ne contacte rien', async () => {
    const { calls, fetch } = fakeFetch(avSeries);
    const p = alphaVantageHistoryProvider({ apiKey: null, fetch });
    expect(await p.supports!(equityCode('MC.PA'), signal)).toBe(false);
    expect(await p.fetchDaily(equityCode('MC.PA'), '2026-09-01', '2026-09-30', signal)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('n’interroge que les places dont l’euro est certain', async () => {
    // La réponse ne porte AUCUNE devise : seul le symbole décide. Londres cote tantôt en pence,
    // tantôt en dollars, et rien ne le signale — donc on ne demande pas.
    const { fetch } = fakeFetch(avSeries);
    const p = alphaVantageHistoryProvider({ apiKey: 'clef', fetch });
    expect(await p.supports!(equityCode('MC.PA'), signal)).toBe(true);
    expect(await p.supports!(equityCode('SXR8.DE'), signal)).toBe(true);
    expect(await p.supports!(equityCode('VOD.L'), signal)).toBe(false);
    expect(await p.supports!(equityCode('AAPL'), signal)).toBe(false);
  });

  it('suit la table curée : le fonds est pris à Francfort, en euros', async () => {
    const { calls, fetch } = fakeFetch(avSeries);
    const p = alphaVantageHistoryProvider({ apiKey: 'clef', fetch });
    await p.fetchDaily(equityCode('SWDA'), '2026-09-01', '2026-09-30', signal);
    expect(new URL(calls[0]!).searchParams.get('symbol')).toBe('EUNL.DEX');
  });

  it('demande la série entière : le quota ne permet pas d’y revenir', async () => {
    // Vingt-cinq requêtes par jour, partagées avec le prix spot. `compact` rendrait cent jours et
    // obligerait à redemander ; `full` rend vingt ans pour la même requête.
    const { calls, fetch } = fakeFetch(avSeries);
    const p = alphaVantageHistoryProvider({ apiKey: 'clef', fetch });
    await p.fetchDaily(equityCode('MC.PA'), '2026-09-01', '2026-09-30', signal);
    expect(new URL(calls[0]!).searchParams.get('outputsize')).toBe('full');
  });

  it('rend des points triés, bornés à la fenêtre demandée', async () => {
    const { fetch } = fakeFetch(avSeries);
    const p = alphaVantageHistoryProvider({ apiKey: 'clef', fetch });
    const points = await p.fetchDaily(equityCode('MC.PA'), '2026-09-13', '2026-09-30', signal);
    expect(points).toEqual([{ day: '2026-09-13', priceEur: '431.2' }]);
  });

  it('rend la main sur un quota épuisé au lieu de faire échouer le chargement', async () => {
    const { fetch } = fakeFetch({ Information: 'the standard API rate limit is 25 per day' });
    const p = alphaVantageHistoryProvider({ apiKey: 'clef', fetch });
    expect(await p.fetchDaily(equityCode('MC.PA'), '2026-09-01', '2026-09-30', signal)).toEqual([]);
  });
});
