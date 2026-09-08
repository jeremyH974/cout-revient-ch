import { describe, expect, it } from 'vitest';
import { equityCode } from '../../domain/assets';
import type { FetchLike } from '../../history/types';
import { alphaVantageProvider, alphaVantageSymbol } from './alphavantage';

type Route = (url: string) => { status?: number; body?: unknown } | undefined;

function fakeFetch(route: Route): { calls: string[]; fetch: FetchLike } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const hit = route(url);
    return new Response(JSON.stringify(hit?.body ?? null), {
      status: hit?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetch };
}

const signal = new AbortController().signal;
const quote = (price: string): unknown => ({ 'Global Quote': { '05. price': price } });
const lvmh = equityCode('MC.PA');

describe('symbole Alpha Vantage', () => {
  it('traduit le suffixe de place du relevé', () => {
    expect(alphaVantageSymbol('MC.PA')).toBe('MC.PAR');
    expect(alphaVantageSymbol('SXR8.DE')).toBe('SXR8.DEX');
  });

  it('suit la table curée quand le relevé nomme une autre place, ou aucune', () => {
    // Le relevé écrit `SWDA` (Londres, en pence) ; c'est le même fonds qu'`EUNL` à Francfort,
    // coté en euros. Prendre la ligne en euros évite la conversion — et le facteur cent.
    expect(alphaVantageSymbol('SWDA')).toBe('EUNL.DEX');
    expect(alphaVantageSymbol('CNDX.L')).toBe('SXRV.DEX');
    expect(alphaVantageSymbol('KER')).toBe('KER.PAR');
  });

  it('refuse une place qui ne cote pas en euros : la réponse ne dit pas la devise', () => {
    // `GLOBAL_QUOTE` ne rend aucune devise. Londres cote tantôt en pence, tantôt en dollars :
    // prendre ce nombre pour un euro vaudrait un facteur cent.
    expect(alphaVantageSymbol('VOD.L')).toBeNull();
    expect(alphaVantageSymbol('AAPL')).toBeNull();
    expect(alphaVantageSymbol('')).toBeNull();
  });
});

describe('Alpha Vantage', () => {
  it('sans clé, ne contacte rien et laisse les actifs aux suivants', async () => {
    const { calls, fetch } = fakeFetch(() => ({ body: quote('431.20') }));
    const provider = alphaVantageProvider({ apiKey: null, fetch });
    expect((await provider.fetchPrices([lvmh], signal)).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('cote une valeur parisienne en euros', async () => {
    const { calls, fetch } = fakeFetch(() => ({ body: quote('431.2000') }));
    const provider = alphaVantageProvider({ apiKey: 'clef-de-test', fetch });
    const found = await provider.fetchPrices([lvmh], signal);
    expect(found.get(lvmh)?.priceEur).toBe('431.2');
    expect(new URL(calls[0]!).searchParams.get('symbol')).toBe('MC.PAR');
  });

  it('ne demande rien pour un titre américain : Twelve Data s’en charge', async () => {
    const { calls, fetch } = fakeFetch(() => ({ body: quote('100') }));
    const provider = alphaVantageProvider({ apiKey: 'clef-de-test', fetch });
    const found = await provider.fetchPrices([equityCode('AAPL')], signal);
    expect(found.size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('ne demande pas de cours pour une crypto homonyme', async () => {
    const { calls, fetch } = fakeFetch(() => ({ body: quote('100') }));
    const provider = alphaVantageProvider({ apiKey: 'clef-de-test', fetch });
    await provider.fetchPrices(['btc', 'sol'], signal);
    expect(calls).toEqual([]);
  });

  it('laisse sans prix un symbole que le fournisseur ne connaît pas', async () => {
    const { fetch } = fakeFetch(() => ({ body: { 'Global Quote': {} } }));
    const provider = alphaVantageProvider({ apiKey: 'clef-de-test', fetch });
    expect((await provider.fetchPrices([lvmh], signal)).size).toBe(0);
  });

  it('s’arrête à cinq symboles : le palier gratuit en accorde cinq par minute', async () => {
    const { calls, fetch } = fakeFetch(() => ({ body: quote('10') }));
    const codes = ['MC.PA', 'KER', 'SW.PA', 'ETL.PA', 'AL2SI.PA', 'SXR8.DE'].map(equityCode);
    const provider = alphaVantageProvider({ apiKey: 'clef-de-test', fetch });
    const found = await provider.fetchPrices(codes, signal);
    expect(calls).toHaveLength(5);
    expect(found.size).toBe(5);
  });

  it('cesse de demander dès que le quota est épuisé, et garde ce qui est acquis', async () => {
    // Le compte des APPELS, pas celui des cours : sans la sortie, le fournisseur enchaînerait sur
    // les symboles suivants et n'obtiendrait rien de plus — le résultat serait identique, et le
    // test resterait vert. La contre-épreuve de la décision n° 75 a attrapé cette version creuse.
    let call = 0;
    const { calls, fetch } = fakeFetch(() => {
      call += 1;
      if (call === 1) return { body: quote('431.20') };
      return { body: { Information: 'the standard API rate limit is 25 requests per day' } };
    });
    const codes = [lvmh, equityCode('KER'), equityCode('SW.PA'), equityCode('ETL.PA')];
    const provider = alphaVantageProvider({ apiKey: 'clef-de-test', fetch });
    const found = await provider.fetchPrices(codes, signal);
    expect(calls).toHaveLength(2);
    expect(found.get(lvmh)?.priceEur).toBe('431.2');
    expect(found.size).toBe(1);
  });
});
