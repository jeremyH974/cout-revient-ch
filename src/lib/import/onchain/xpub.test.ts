/**
 * Clés étendues : conformité aux vecteurs de test officiels des BIP (publics, tirés des BIP
 * eux-mêmes), refus des clés privées, et — le test qui compte — netting **au niveau du
 * portefeuille** : une dépense qui rend la monnaie sur une autre adresse dérivée doit produire UN
 * mouvement sortant, pas un sortant plus un entrant.
 */
import { describe, expect, it } from 'vitest';
import { syncBtcWallet } from './btc';
import { XpubError, deriveAddresses, parseExtendedKey } from './xpub';

// Vecteurs officiels : mnémonique « abandon × 11 about », comptes m/44'|49'|84'/0'/0'.
const ZPUB =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const YPUB =
  'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP';
const XPUB =
  'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
const ZPRV =
  'zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvG6GFBZduosCc1YP5wixPox7zhZLfiUm8aunE96BBa4Kei5';

describe('parseExtendedKey / deriveAddresses', () => {
  it('BIP84 (zpub) : adresses de réception et de monnaie conformes au vecteur officiel', () => {
    const parsed = parseExtendedKey(ZPUB);
    expect(parsed.scheme).toBe('p2wpkh');
    expect(deriveAddresses(parsed, 0, 0, 2)).toEqual([
      'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
      'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g',
    ]);
    expect(deriveAddresses(parsed, 1, 0, 1)).toEqual([
      'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el',
    ]);
  });

  it('BIP49 (ypub) et BIP44 (xpub) : mêmes vecteurs officiels', () => {
    const y = parseExtendedKey(YPUB);
    expect(y.scheme).toBe('p2sh-p2wpkh');
    expect(deriveAddresses(y, 0, 0, 1)).toEqual(['37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf']);
    const x = parseExtendedKey(XPUB);
    expect(x.scheme).toBe('p2pkh');
    expect(deriveAddresses(x, 0, 0, 1)).toEqual(['1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA']);
  });

  it('refuse une clé PRIVÉE étendue avec un message sans ambiguïté', () => {
    expect(() => parseExtendedKey(ZPRV)).toThrow(XpubError);
    expect(() => parseExtendedKey(ZPRV)).toThrow(/clé PRIVÉE/);
  });

  it('refuse une clé tronquée, une somme de contrôle fausse, une chaîne quelconque', () => {
    expect(() => parseExtendedKey(ZPUB.slice(0, 40))).toThrow(XpubError);
    expect(() => parseExtendedKey(`${ZPUB.slice(0, -1)}X`)).toThrow(XpubError);
    expect(() => parseExtendedKey('bonjour')).toThrow(XpubError);
  });
});

/** Fabrique de réponses Esplora : `txs[address]` liste les transactions vues par cette adresse. */
function stubEsplora(txs: Record<string, unknown[]>): {
  fetch: (url: string) => Promise<Response>;
  calls: string[];
} {
  const calls: string[] = [];
  const ok = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'text/json' } });
  return {
    calls,
    fetch: (url: string) => {
      calls.push(url);
      const path = new URL(url).pathname.replace(/^\/api/, '');
      const list = /^\/address\/([^/]+)\/txs/.exec(path);
      if (list) return Promise.resolve(ok(txs[list[1]!] ?? []));
      const info = /^\/address\/([^/]+)$/.exec(path);
      if (info) {
        const count = (txs[info[1]!] ?? []).length;
        return Promise.resolve(
          ok({ chain_stats: { tx_count: count }, mempool_stats: { tx_count: 0 } }),
        );
      }
      return Promise.resolve(new Response('non', { status: 404 }));
    },
  };
}

const tx = (
  txid: string,
  blockTime: number,
  vin: { address: string; value: number }[],
  vout: { address: string; value: number }[],
): unknown => ({
  txid,
  status: { confirmed: true, block_time: blockTime },
  vin: vin.map((v) => ({ prevout: { scriptpubkey_address: v.address, value: v.value } })),
  vout: vout.map((v) => ({ scriptpubkey_address: v.address, value: v.value })),
});

describe('syncBtcWallet', () => {
  const parsed = parseExtendedKey(ZPUB);
  const [receive0, receive1] = deriveAddresses(parsed, 0, 0, 2) as [string, string];
  const [change0] = deriveAddresses(parsed, 1, 0, 1) as [string];
  const EXTERNAL = 'bc1qexterneexterneexterneexterneexterneexterne';

  it('nette la monnaie rendue : une dépense = UN mouvement sortant', async () => {
    // Réception d'1 BTC, puis dépense de 0,6 BTC vers l'extérieur avec 0,3999 BTC de monnaie
    // rendue sur une autre adresse dérivée. Sortie nette = 0,6001 BTC (frais réseau compris).
    const received = tx(
      't1',
      1_700_000_000,
      [{ address: EXTERNAL, value: 100_000_000 }],
      [{ address: receive0, value: 100_000_000 }],
    );
    const spent = tx(
      't2',
      1_700_100_000,
      [{ address: receive0, value: 100_000_000 }],
      [
        { address: EXTERNAL, value: 60_000_000 },
        { address: change0, value: 39_990_000 },
      ],
    );
    const stub = stubEsplora({
      [receive0]: [spent, received],
      [change0]: [spent],
    });
    const result = await syncBtcWallet(ZPUB, {
      fetch: stub.fetch,
      gapLimit: 2,
      delayMs: 0,
    });
    expect(result.movements.map((m) => `${m.direction} ${m.qty}`)).toEqual(['in 1', 'out 0.6001']);
    expect(result.scheme).toBe('p2wpkh');
    expect(result.used).toBe(2); // une adresse de réception, une de monnaie
    expect(result.truncated).toBe(false);
  });

  it('s’arrête après `gapLimit` adresses vides consécutives', async () => {
    const stub = stubEsplora({});
    const result = await syncBtcWallet(ZPUB, { fetch: stub.fetch, gapLimit: 3, delayMs: 0 });
    expect(result.used).toBe(0);
    expect(result.movements).toEqual([]);
    // 3 adresses vides par chaîne (réception + monnaie), une requête légère chacune.
    expect(result.derived).toBe(6);
    expect(stub.calls).toHaveLength(6);
  });

  it('reprend le balayage après un trou plus court que le gap', async () => {
    const stub = stubEsplora({
      [receive1]: [tx('t3', 1_700_200_000, [], [{ address: receive1, value: 5_000_000 }])],
    });
    const result = await syncBtcWallet(ZPUB, { fetch: stub.fetch, gapLimit: 2, delayMs: 0 });
    expect(result.used).toBe(1);
    expect(result.movements.map((m) => `${m.direction} ${m.qty}`)).toEqual(['in 0.05']);
  });

  it('marque `truncated` quand le plafond d’adresses est atteint', async () => {
    const stub = stubEsplora({});
    const result = await syncBtcWallet(ZPUB, {
      fetch: stub.fetch,
      gapLimit: 5,
      maxAddresses: 3,
      delayMs: 0,
    });
    expect(result.truncated).toBe(true);
    expect(result.derived).toBe(3);
  });
});
