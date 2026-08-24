/**
 * Clients on-chain (mempool.space, Blockscout v2) : mouvements nets, frais inclus côté envoi,
 * liste blanche de contrats, pagination, garde-fous — sur réponses simulées 100 % synthétiques.
 */
import { describe, expect, it } from 'vitest';
import { draftsToPivotRows } from '../platforms/drafts';
import { syncBtcAddress, BTC_ADDRESS_RE } from './btc';
import { EVM_ADDRESS_RE, syncEvmAddress } from './evm';
import { movementsToDrafts, OnchainError } from './normalize';

const ADDR_BTC = 'bc1qdemo000000000000000000000000000000000';
const ADDR_EVM = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const USDC_ETH = '0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48';

type Route = (url: string) => unknown;
const fakeFetch =
  (route: Route) =>
  async (url: string): Promise<Response> => {
    const body = route(url);
    if (body === 429) return { ok: false, status: 429 } as unknown as Response;
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  };

const btcTx = (
  txid: string,
  net: { in?: number; out?: number },
  confirmed = true,
  blockTime = 1_740_000_000,
): unknown => ({
  txid,
  status: { confirmed, block_time: blockTime },
  vout: net.in ? [{ scriptpubkey_address: ADDR_BTC, value: net.in }] : [],
  vin: net.out ? [{ prevout: { scriptpubkey_address: ADDR_BTC, value: net.out } }] : [],
});

describe('syncBtcAddress', () => {
  it('calcule le mouvement net par transaction (frais inclus côté envoi)', async () => {
    const fetch = fakeFetch(() => [
      btcTx('t-in', { in: 50_000 }),
      btcTx('t-out', { in: 30_000, out: 100_000 }), // envoi avec change : net −70 000 sats
      btcTx('t-self', { in: 10_000, out: 10_000 }), // auto-transfert
      btcTx('t-pending', { in: 99_999 }, false), // non confirmée
    ]);
    const result = await syncBtcAddress(ADDR_BTC, { fetch });
    expect(result.truncated).toBe(false);
    expect(result.ignored).toBe(1);
    expect(result.movements).toHaveLength(2);
    expect(result.movements[0]).toMatchObject({ direction: 'in', qty: '0.0005', asset: 'btc' });
    expect(result.movements[1]).toMatchObject({ direction: 'out', qty: '0.0007' });
    expect(result.movements[1]!.note).toContain('frais réseau inclus');
  });

  it('pagine par dernier txid et signale la troncature au plafond', async () => {
    const page = (prefix: string): unknown[] =>
      Array.from({ length: 25 }, (_, i) => btcTx(`${prefix}-${i}`, { in: 1_000 + i }));
    const calls: string[] = [];
    const fetch = fakeFetch((url) => {
      calls.push(url);
      return page(url.includes('/txs/chain/') ? 'p2' : 'p1');
    });
    const result = await syncBtcAddress(ADDR_BTC, { fetch, maxPages: 2 });
    expect(calls[1]).toContain('/txs/chain/p1-24');
    expect(result.movements).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it('remonte une OnchainError sur 429', async () => {
    await expect(syncBtcAddress(ADDR_BTC, { fetch: fakeFetch(() => 429) })).rejects.toMatchObject({
      name: 'OnchainError',
      httpStatus: 429,
    });
  });
});

describe('syncEvmAddress', () => {
  const nativeItems = [
    {
      hash: '0xa1',
      status: 'ok',
      timestamp: '2026-08-01T10:00:00.000000Z',
      value: '500000000000000000',
      fee: { value: '1000000000000000' },
      from: { hash: OTHER },
      to: { hash: ADDR_EVM },
    },
    {
      hash: '0xa2',
      status: 'ok',
      timestamp: '2026-08-02T10:00:00.000000Z',
      value: '1000000000000000000',
      fee: { value: '1000000000000000' },
      from: { hash: ADDR_EVM },
      to: { hash: OTHER },
    },
    {
      hash: '0xa3',
      status: 'ok',
      timestamp: '2026-08-03T10:00:00.000000Z',
      value: '0',
      fee: { value: '2100000000000000' },
      from: { hash: ADDR_EVM },
      to: { hash: USDC_ETH },
    },
    {
      hash: '0xa4',
      status: 'error',
      timestamp: '2026-08-04T10:00:00.000000Z',
      value: '1',
      fee: { value: '0' },
      from: { hash: OTHER },
      to: { hash: ADDR_EVM },
    },
  ];
  const tokenItems = [
    {
      transaction_hash: '0xa3',
      timestamp: '2026-08-03T10:00:00.000000Z',
      token: { address_hash: USDC_ETH, symbol: 'USDC', decimals: '6', type: 'ERC-20' },
      total: { value: '250000000', decimals: '6' },
      from: { hash: ADDR_EVM },
      to: { hash: OTHER },
    },
    {
      transaction_hash: '0xspam',
      timestamp: '2026-08-05T10:00:00.000000Z',
      token: { address_hash: '0x9999999999999999999999999999999999999999', decimals: '18' },
      total: { value: '1000000000000000000000', decimals: '18' },
      from: { hash: OTHER },
      to: { hash: ADDR_EVM },
    },
  ];

  it('natif + gaz, tokens en liste blanche, spam ignoré', async () => {
    const fetch = fakeFetch((url) =>
      url.includes('token-transfers')
        ? { items: tokenItems, next_page_params: null }
        : { items: nativeItems, next_page_params: null },
    );
    const result = await syncEvmAddress('eth', ADDR_EVM, { fetch });
    expect(result.ignored).toBe(2); // tx en échec + token spam
    expect(result.truncated).toBe(false);
    const byHash = Object.fromEntries(result.movements.map((m) => [m.nativeContent, m]));
    expect(byHash['evm|eth|native|0xa1']).toMatchObject({
      direction: 'in',
      qty: '0.5',
      asset: 'eth',
    });
    expect(byHash['evm|eth|native|0xa2']).toMatchObject({ direction: 'out', qty: '1.001' });
    // Appel de contrat à value 0 : seul le gaz sort.
    expect(byHash['evm|eth|native|0xa3']).toMatchObject({ direction: 'out', qty: '0.0021' });
    const usdc = result.movements.find((m) => m.asset === 'usdc')!;
    expect(usdc).toMatchObject({ direction: 'out', qty: '250', txHash: '0xa3' });
  });

  it('repasse next_page_params en query et signale la troncature', async () => {
    const calls: string[] = [];
    const fetch = fakeFetch((url) => {
      calls.push(url);
      if (url.includes('token-transfers')) return { items: [], next_page_params: null };
      return { items: nativeItems.slice(0, 1), next_page_params: { block_number: 42, index: 7 } };
    });
    const result = await syncEvmAddress('eth', ADDR_EVM, { fetch, maxPages: 2 });
    expect(calls[1]).toContain('block_number=42');
    expect(calls[1]).toContain('index=7');
    expect(result.truncated).toBe(true);
  });

  it('USDT d’Arbitrum reconnu par son contrat (pas par son symbole « USDT0 »)', async () => {
    const fetch = fakeFetch((url) =>
      url.includes('token-transfers')
        ? {
            items: [
              {
                transaction_hash: '0xu1',
                timestamp: '2026-08-06T10:00:00Z',
                token: {
                  address_hash: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
                  symbol: 'USD₮0',
                  decimals: '6',
                },
                total: { value: '12000000', decimals: '6' },
                from: { hash: OTHER },
                to: { hash: ADDR_EVM },
              },
            ],
            next_page_params: null,
          }
        : { items: [], next_page_params: null },
    );
    const result = await syncEvmAddress('arbitrum', ADDR_EVM, { fetch });
    expect(result.movements).toEqual([
      expect.objectContaining({ asset: 'usdt', direction: 'in', qty: '12' }),
    ]);
  });

  it('remonte une OnchainError explicite sur 429', async () => {
    await expect(
      syncEvmAddress('eth', ADDR_EVM, { fetch: fakeFetch(() => 429) }),
    ).rejects.toBeInstanceOf(OnchainError);
  });
});

describe('movementsToDrafts + clés', () => {
  it('produit des lignes pivot stables (re-synchronisation idempotente)', async () => {
    const fetch = fakeFetch(() => [btcTx('t-in', { in: 50_000 })]);
    const { movements } = await syncBtcAddress(ADDR_BTC, { fetch });
    const first = draftsToPivotRows(movementsToDrafts(movements), 'i1', 'oc:btc:demo');
    const second = draftsToPivotRows(movementsToDrafts(movements), 'i2', 'oc:btc:demo');
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]!.key).toBe(second.rows[0]!.key);
    expect(first.rows[0]!.received).toEqual({ amount: '0.0005', currency: 'btc' });
    expect(first.rows[0]!.txHash).toBe('t-in');
  });

  it('les regex d’adresses acceptent les formes usuelles et rejettent le reste', () => {
    expect(BTC_ADDRESS_RE.test('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
    expect(BTC_ADDRESS_RE.test('nimporte')).toBe(false);
    expect(EVM_ADDRESS_RE.test('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(true);
    expect(EVM_ADDRESS_RE.test('0x123')).toBe(false);
  });
});
