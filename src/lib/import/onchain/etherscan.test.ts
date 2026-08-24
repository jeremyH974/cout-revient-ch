/**
 * Dialecte « module/action » (Etherscan V2, Blockscout Pro, Routescan) et chaîne de repli.
 * Les pièges du dialecte sont ce qu'on teste : `timeStamp` en secondes, `value` en wei,
 * `isError:"1"`, `tokenDecimal` en chaîne, et surtout `status:"0"` + « No transactions found »
 * qui est un SUCCÈS vide et non un rejet de clé.
 */
import { describe, expect, it } from 'vitest';
import { CHAIN_IDS, flavorSupports, syncEvmViaExplorer } from './etherscan';
import { evmAttempts, syncEvmWithFallback } from './evm-sync';
import { OnchainError } from './normalize';

const ME = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const USDC_ETH = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

const ok = (result: unknown, message = 'OK', status = '1'): Response =>
  new Response(JSON.stringify({ status, message, result }), { status: 200 });

/** Répond par action ; enregistre les URL appelées. */
function stub(byAction: Record<string, Response | (() => Response)>): {
  fetch: (url: string) => Promise<Response>;
  urls: string[];
} {
  const urls: string[] = [];
  return {
    urls,
    fetch: (url: string) => {
      urls.push(url);
      const action = new URL(url).searchParams.get('action') ?? '';
      const entry = byAction[action];
      if (entry === undefined) return Promise.resolve(ok([], 'No transactions found', '0'));
      return Promise.resolve(typeof entry === 'function' ? entry() : entry.clone());
    },
  };
}

describe('syncEvmViaExplorer', () => {
  it('lit natif, interne et ERC-20 ; frais de gaz inclus dans un envoi', async () => {
    const s = stub({
      txlist: ok([
        {
          hash: '0xAAA',
          timeStamp: '1700000000',
          from: OTHER,
          to: ME,
          value: '2000000000000000000',
          gasUsed: '21000',
          gasPrice: '1000000000',
          isError: '0',
        },
        {
          hash: '0xBBB',
          timeStamp: '1700000100',
          from: ME,
          to: OTHER,
          value: '1000000000000000000',
          gasUsed: '21000',
          gasPrice: '1000000000',
          isError: '0',
        },
        // Échouée : écartée (son gaz reste dépensé — limite connue et documentée).
        { hash: '0xCCC', timeStamp: '1700000200', from: ME, to: OTHER, value: '1', isError: '1' },
      ]),
      txlistinternal: ok([
        {
          hash: '0xDDD',
          timeStamp: '1700000300',
          from: OTHER,
          to: ME,
          value: '500000000000000000',
          traceId: '0_1',
          isError: '0',
        },
      ]),
      tokentx: ok([
        {
          hash: '0xEEE',
          timeStamp: '1700000400',
          from: OTHER,
          to: ME,
          value: '1500000',
          contractAddress: USDC_ETH,
          tokenDecimal: '6',
          tokenSymbol: 'USDC',
        },
        // Jeton hors liste blanche : ignoré, quel que soit son symbole.
        {
          hash: '0xFFF',
          timeStamp: '1700000500',
          from: OTHER,
          to: ME,
          value: '1',
          contractAddress: '0xdeadbeef00000000000000000000000000000000',
          tokenDecimal: '18',
          tokenSymbol: 'USDC',
        },
      ]),
    });
    const result = await syncEvmViaExplorer('eth', ME, {
      flavor: 'etherscan',
      apiKey: 'K',
      fetch: s.fetch,
    });
    expect(result.movements.map((m) => `${m.direction} ${m.qty} ${m.asset}`)).toEqual([
      'in 2 eth',
      'out 1.000021 eth', // 1 ETH + 21 000 × 1 gwei de gaz
      'in 0.5 eth', // reçu via un contrat : invisible dans txlist
      'in 1.5 usdc',
    ]);
    expect(result.ignored).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('traite « No transactions found » comme un succès vide, pas comme une erreur', async () => {
    const s = stub({});
    const result = await syncEvmViaExplorer('base', ME, {
      flavor: 'etherscan',
      apiKey: 'K',
      fetch: s.fetch,
    });
    expect(result.movements).toEqual([]);
  });

  it('remonte un rejet de clé comme une erreur explicite', async () => {
    const s = stub({ txlist: ok('Missing/Invalid API Key', 'NOTOK', '0') });
    await expect(
      syncEvmViaExplorer('eth', ME, { flavor: 'etherscan', fetch: s.fetch }),
    ).rejects.toThrow(/Missing\/Invalid API Key/);
  });

  it('construit l’URL propre à chaque parfum', async () => {
    const s = stub({});
    await syncEvmViaExplorer('arbitrum', ME, { flavor: 'etherscan', apiKey: 'K', fetch: s.fetch });
    expect(s.urls[0]).toContain('api.etherscan.io/v2/api?chainid=42161');
    expect(s.urls[0]).toContain('apikey=K');
    const s2 = stub({});
    await syncEvmViaExplorer('eth', ME, { flavor: 'blockscout-pro', apiKey: 'K', fetch: s2.fetch });
    expect(s2.urls[0]).toContain('api.blockscout.com/v2/api?chain_id=1');
    const s3 = stub({});
    await syncEvmViaExplorer('eth', ME, { flavor: 'routescan', fetch: s3.fetch });
    expect(s3.urls[0]).toContain('/network/mainnet/evm/1/etherscan/api');
    expect(s3.urls[0]).not.toContain('apikey');
  });

  it('refuse une chaîne que le parfum ne couvre pas', async () => {
    expect(flavorSupports('routescan', 'base')).toBe(false);
    expect(flavorSupports('etherscan', 'base')).toBe(true);
    expect(CHAIN_IDS.base).toBe(8453);
    await expect(
      syncEvmViaExplorer('base', ME, { flavor: 'routescan', fetch: stub({}).fetch }),
    ).rejects.toThrow(OnchainError);
  });
});

describe('ordre de repli', () => {
  it('sans clé : Blockscout d’abord, Routescan en secours sur Ethereum', () => {
    expect(evmAttempts('eth', ME, {}).map((a) => a.label)).toEqual([
      'Blockscout',
      'Routescan (sans clé, Ethereum seulement)',
    ]);
    expect(evmAttempts('base', ME, {}).map((a) => a.label)).toEqual(['Blockscout']);
  });

  it('avec une clé : le parfum choisi passe devant', () => {
    const labels = evmAttempts('base', ME, { explorerKey: 'K', explorerFlavor: 'etherscan' }).map(
      (a) => a.label,
    );
    expect(labels[0]).toBe('Etherscan V2');
    expect(labels).toContain('Blockscout');
  });

  it('bascule sur le suivant quand un fournisseur tombe, et dit qui a répondu', async () => {
    let blockscoutCalls = 0;
    const fetchLike = (url: string): Promise<Response> => {
      if (url.includes('blockscout.com')) {
        blockscoutCalls++;
        return Promise.resolve(new Response('rate limited', { status: 429 }));
      }
      return Promise.resolve(ok([], 'No transactions found', '0'));
    };
    const outcome = await syncEvmWithFallback('eth', ME, { fetch: fetchLike });
    expect(blockscoutCalls).toBeGreaterThan(0);
    expect(outcome.provider).toContain('Routescan');
  });

  it('tout échoue : le message dit quoi faire, il ne récite pas un code HTTP', async () => {
    const dead = (): Promise<Response> => Promise.resolve(new Response('non', { status: 503 }));
    await expect(syncEvmWithFallback('base', ME, { fetch: dead })).rejects.toThrow(
      /clé d’explorateur gratuite/,
    );
  });
});
