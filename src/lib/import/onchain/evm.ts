/**
 * EVM par adresse — Blockscout API v2 (CORS `*` vérifié le 24/08/2026, sans clé), instances
 * `eth|arbitrum|base.blockscout.com`. Deux flux : transactions natives (`value` en wei ; pour un
 * envoi, les frais de gaz s'ajoutent à la quantité — un envoi de token à value 0 laisse quand
 * même sortir son gaz) et `token-transfers` ERC-20 filtrés par une **liste blanche d'adresses de
 * contrats** (anti-spam ; on ne fait jamais confiance au `symbol` : l'USDT d'Arbitrum s'affiche
 * « USDT0 » depuis sa migration de janvier 2026). Palier public : ~3 requêtes/minute → pagination
 * plafonnée (`truncated`) et 429 rendu comme une erreur « réessayez dans une minute ».
 * L'adresse n'est envoyée qu'à l'instance Blockscout de sa chaîne (décision n° 20).
 */
import { D, ZERO } from '../../domain/money';
import { OnchainError, type OnchainMovement, type OnchainSyncResult } from './normalize';

export type EvmChain = 'eth' | 'arbitrum' | 'base';

export const EVM_CHAINS: Record<EvmChain, { label: string; base: string }> = {
  eth: { label: 'Ethereum', base: 'https://eth.blockscout.com' },
  arbitrum: { label: 'Arbitrum One', base: 'https://arbitrum.blockscout.com' },
  base: { label: 'Base', base: 'https://base.blockscout.com' },
};

/**
 * Liste blanche v1 : uniquement des contrats vérifiés chez leur émetteur (Circle, Tether) le
 * 24/08/2026. Tout autre token est compté « ignoré » (extensible sur demande).
 */
export const EVM_TOKEN_WHITELIST: Record<EvmChain, Record<string, string>> = {
  eth: {
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'usdc',
    '0xdac17f958d2ee523a2206206994597c13d831ec7': 'usdt',
  },
  arbitrum: {
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'usdc',
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'usdt', // « USDT0 » depuis 01/2026, même contrat
  },
  base: {
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'usdc',
  },
};

export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const WEI = D('10').pow(18);

async function getJson(
  fetchLike: FetchLike,
  chainLabel: string,
  url: string,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchLike(url, {
      signal: signal ?? null,
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new OnchainError(`Blockscout (${chainLabel}) injoignable : ${String(error)}`);
  }
  if (response.status === 429)
    throw new OnchainError(
      `Blockscout (${chainLabel}) limite le débit sans clé (~3 requêtes/minute) : réessayez dans une minute.`,
      429,
    );
  if (!response.ok)
    throw new OnchainError(
      `Blockscout (${chainLabel}) a répondu ${response.status}.`,
      response.status,
    );
  return response.json() as Promise<unknown>;
}

interface Page {
  items: unknown[];
  next: Record<string, unknown> | null;
}

function parsePage(body: unknown, chainLabel: string): Page {
  if (typeof body !== 'object' || body === null)
    throw new OnchainError(`Réponse Blockscout (${chainLabel}) inattendue.`);
  const record = body as Record<string, unknown>;
  const items = Array.isArray(record['items']) ? record['items'] : null;
  if (items === null) throw new OnchainError(`Réponse Blockscout (${chainLabel}) inattendue.`);
  const nextRaw = record['next_page_params'];
  const next =
    typeof nextRaw === 'object' && nextRaw !== null ? (nextRaw as Record<string, unknown>) : null;
  return { items, next };
}

const hashOf = (value: unknown): string => {
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value === 'object' && value !== null) {
    const hash = (value as Record<string, unknown>)['hash'];
    if (typeof hash === 'string') return hash.toLowerCase();
  }
  return '';
};

function withParams(base: string, params: Record<string, unknown> | null): string {
  if (!params) return base;
  const query = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return query === '' ? base : `${base}${base.includes('?') ? '&' : '?'}${query}`;
}

export async function syncEvmAddress(
  chain: EvmChain,
  address: string,
  options: { fetch?: FetchLike; maxPages?: number; signal?: AbortSignal } = {},
): Promise<OnchainSyncResult> {
  const fetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const maxPages = options.maxPages ?? 2; // ~3 requêtes/minute sans clé : rester frugal
  const { label, base } = EVM_CHAINS[chain];
  const me = address.toLowerCase();
  const whitelist = EVM_TOKEN_WHITELIST[chain];
  const movements: OnchainMovement[] = [];
  let ignored = 0;
  let truncated = false;

  // 1) Transactions natives (ETH) — inclut le gaz des envois, même à value nulle.
  let next: Record<string, unknown> | null = null;
  for (let page = 0; page < maxPages; page++) {
    const url = withParams(`${base}/api/v2/addresses/${address}/transactions`, next);
    const parsed = parsePage(await getJson(fetchLike, label, url, options.signal), label);
    for (const raw of parsed.items) {
      if (typeof raw !== 'object' || raw === null) continue;
      const tx = raw as Record<string, unknown>;
      if (tx['status'] !== 'ok') {
        ignored++;
        continue;
      }
      const hash = typeof tx['hash'] === 'string' ? tx['hash'] : null;
      const timestamp = typeof tx['timestamp'] === 'string' ? Date.parse(tx['timestamp']) : NaN;
      const valueRaw = typeof tx['value'] === 'string' ? tx['value'] : null;
      if (hash === null || Number.isNaN(timestamp) || valueRaw === null) continue;
      const from = hashOf(tx['from']);
      const to = hashOf(tx['to']);
      const fee = (tx['fee'] ?? {}) as Record<string, unknown>;
      const feeRaw = typeof fee['value'] === 'string' ? fee['value'] : '0';
      const isOut = from === me;
      const isIn = to === me;
      if (isOut && isIn) {
        ignored++; // auto-transfert
        continue;
      }
      let qtyWei = D(valueRaw);
      let note: string | null = null;
      if (isOut) {
        qtyWei = qtyWei.plus(feeRaw);
        note = 'Envoi on-chain : frais de gaz inclus dans la quantité.';
      }
      if (qtyWei.eq(ZERO) || (!isOut && !isIn)) {
        ignored++;
        continue;
      }
      movements.push({
        nativeContent: `evm|${chain}|native|${hash}`,
        timeMs: timestamp,
        direction: isOut ? 'out' : 'in',
        qty: qtyWei.div(WEI).toString(),
        asset: 'eth',
        txHash: hash,
        note,
      });
    }
    next = parsed.next;
    if (next === null) break;
    if (page === maxPages - 1) truncated = true;
  }

  // 2) Transferts ERC-20 de la liste blanche.
  next = null;
  for (let page = 0; page < maxPages; page++) {
    const url = withParams(`${base}/api/v2/addresses/${address}/token-transfers?type=ERC-20`, next);
    const parsed = parsePage(await getJson(fetchLike, label, url, options.signal), label);
    for (const raw of parsed.items) {
      if (typeof raw !== 'object' || raw === null) continue;
      const transfer = raw as Record<string, unknown>;
      const token = (transfer['token'] ?? {}) as Record<string, unknown>;
      const contract = hashOf(token['address_hash'] ?? token['address']);
      const asset = whitelist[contract];
      if (asset === undefined) {
        ignored++;
        continue;
      }
      const total = (transfer['total'] ?? {}) as Record<string, unknown>;
      const valueRaw = typeof total['value'] === 'string' ? total['value'] : null;
      const decimalsRaw = total['decimals'] ?? token['decimals'];
      const decimals =
        typeof decimalsRaw === 'string'
          ? Number(decimalsRaw)
          : typeof decimalsRaw === 'number'
            ? decimalsRaw
            : null;
      const hash =
        typeof transfer['transaction_hash'] === 'string' ? transfer['transaction_hash'] : null;
      const timestamp =
        typeof transfer['timestamp'] === 'string' ? Date.parse(transfer['timestamp']) : NaN;
      const from = hashOf(transfer['from']);
      const to = hashOf(transfer['to']);
      if (
        valueRaw === null ||
        decimals === null ||
        !Number.isInteger(decimals) ||
        decimals < 0 ||
        decimals > 30 ||
        hash === null ||
        Number.isNaN(timestamp)
      ) {
        ignored++;
        continue;
      }
      const isOut = from === me;
      const isIn = to === me;
      if (isOut === isIn) {
        ignored++; // ni l'un ni l'autre (improbable) ou auto-transfert
        continue;
      }
      const qty = D(valueRaw).div(D('10').pow(decimals));
      if (qty.eq(ZERO)) {
        ignored++;
        continue;
      }
      movements.push({
        nativeContent: `evm|${chain}|erc20|${hash}|${contract}|${from}|${to}|${valueRaw}`,
        timeMs: timestamp,
        direction: isOut ? 'out' : 'in',
        qty: qty.toString(),
        asset,
        txHash: hash,
        note: isOut ? 'Envoi de token : le gaz sort séparément en ETH.' : null,
      });
    }
    next = parsed.next;
    if (next === null) break;
    if (page === maxPages - 1) truncated = true;
  }

  movements.sort((a, b) => a.timeMs - b.timeMs || a.nativeContent.localeCompare(b.nativeContent));
  return { movements, ignored, truncated };
}
