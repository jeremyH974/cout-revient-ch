/**
 * Bitcoin par adresse — mempool.space (REST Esplora, CORS `*` vérifié le 24/08/2026, sans clé).
 * `GET /api/address/{addr}/txs` (25 confirmées + mempool) puis pagination
 * `GET /api/address/{addr}/txs/chain/{last_txid}` (25 par page). Mouvement net par transaction :
 * Σ vout vers l'adresse − Σ vin depuis l'adresse (satoshis entiers) ; net < 0 = envoi (quote-part
 * de frais incluse, cohérent avec « le coût voyage »), net ≈ 0 = auto-transfert ignoré.
 * Adresses simples uniquement (pas de xpub : non supporté par l'API). L'adresse n'est envoyée
 * qu'à mempool.space (décision n° 20).
 */
import { D, ZERO, type Big } from '../../domain/money';
import { OnchainError, type OnchainMovement, type OnchainSyncResult } from './normalize';

const BASE = 'https://mempool.space/api';
const PAGE_SIZE = 25;
const SATS = D('100000000');

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface BtcTx {
  txid: string;
  blockTimeMs: number;
  net: Big;
}

function parseTx(raw: unknown, address: string): BtcTx | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const tx = raw as Record<string, unknown>;
  const status = (tx['status'] ?? {}) as Record<string, unknown>;
  if (status['confirmed'] !== true) return null; // mempool : ignoré jusqu'à confirmation
  const blockTime = status['block_time'];
  const txid = tx['txid'];
  if (typeof txid !== 'string' || typeof blockTime !== 'number') return null;
  let net = ZERO;
  for (const vout of Array.isArray(tx['vout']) ? tx['vout'] : []) {
    const o = (vout ?? {}) as Record<string, unknown>;
    if (o['scriptpubkey_address'] === address && typeof o['value'] === 'number')
      net = net.plus(String(o['value']));
  }
  for (const vin of Array.isArray(tx['vin']) ? tx['vin'] : []) {
    const prevout = ((vin ?? {}) as Record<string, unknown>)['prevout'];
    const p = (prevout ?? {}) as Record<string, unknown>;
    if (p['scriptpubkey_address'] === address && typeof p['value'] === 'number')
      net = net.minus(String(p['value']));
  }
  return { txid, blockTimeMs: blockTime * 1000, net };
}

async function getJson(fetchLike: FetchLike, url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchLike(url, {
      signal: signal ?? null,
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new OnchainError(`mempool.space injoignable : ${String(error)}`);
  }
  if (!response.ok)
    throw new OnchainError(`mempool.space a répondu ${response.status}.`, response.status);
  return response.json() as Promise<unknown>;
}

export const BTC_ADDRESS_RE = /^(bc1[a-z0-9]{8,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,42})$/;

export async function syncBtcAddress(
  address: string,
  options: { fetch?: FetchLike; maxPages?: number; signal?: AbortSignal } = {},
): Promise<OnchainSyncResult> {
  const fetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const maxPages = options.maxPages ?? 8;
  const movements: OnchainMovement[] = [];
  let ignored = 0;
  let lastTxid: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const url =
      lastTxid === null
        ? `${BASE}/address/${address}/txs`
        : `${BASE}/address/${address}/txs/chain/${lastTxid}`;
    const body = await getJson(fetchLike, url, options.signal);
    if (!Array.isArray(body)) throw new OnchainError('Réponse mempool.space inattendue.');
    let confirmedInPage = 0;
    for (const raw of body) {
      const tx = parseTx(raw, address);
      if (tx === null) continue;
      confirmedInPage++;
      lastTxid = tx.txid;
      if (tx.net.eq(ZERO)) {
        ignored++; // auto-transfert (change) : aucun mouvement économique
        continue;
      }
      const out = tx.net.lt(ZERO);
      movements.push({
        nativeContent: `btc|${tx.txid}`,
        timeMs: tx.blockTimeMs,
        direction: out ? 'out' : 'in',
        qty: tx.net.abs().div(SATS).toString(),
        asset: 'btc',
        txHash: tx.txid,
        note: out ? 'Envoi on-chain : frais réseau inclus dans la quantité.' : null,
      });
    }
    if (confirmedInPage < PAGE_SIZE) return { movements, ignored, truncated: false };
  }
  // Plafond atteint avec une dernière page pleine : l'historique plus ancien n'a pas été lu.
  return { movements, ignored, truncated: true };
}
