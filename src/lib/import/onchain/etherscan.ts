/**
 * Secours EVM — adaptateur du dialecte « module/action » hérité d'Etherscan.
 *
 * Pourquoi : l'import EVM repose sur les instances Blockscout par chaîne, sans clé, et Blockscout
 * a basculé son trafic vers une **Pro API** payante-au-delà-du-gratuit au 1ᵉʳ juillet 2026. Sondes
 * du 24/08/2026 : les instances par chaîne répondent **encore** 200 sans clé, mais
 * `api.blockscout.com` renvoie déjà `402 Proceed with API key`. Autrement dit le chemin sans clé
 * est en sursis : il faut savoir en changer, et savoir **quand** il tombe (le monitor s'en charge).
 *
 * Trois fournisseurs parlent le même dialecte, donc un seul fichier :
 * | parfum          | base                                                        | chaîne     | clé        | couverture      |
 * | `routescan`     | api.routescan.io/v2/network/mainnet/evm/{id}/etherscan/api   | chemin     | **aucune** | Ethereum        |
 * | `etherscan`     | api.etherscan.io/v2/api                                      | `chainid`  | gratuite   | eth·arbitrum·base |
 * | `blockscout-pro`| api.blockscout.com/v2/api                                    | `chain_id` | gratuite   | idem            |
 *
 * Une clé d'explorateur n'est PAS une clé d'exchange : elle ne lit que des données publiques déjà
 * visibles de tous et ne peut rien signer. C'est la raison pour laquelle elle est acceptée ici
 * alors qu'une clé d'exchange reste refusée (décision n° 32).
 *
 * Bonus de couverture : ce chemin lit aussi `txlistinternal`, donc l'ETH reçu **via un contrat**
 * (retrait de DEX, de pont, de vault) — invisible dans `txlist`, et jusqu'ici manquant.
 */
import { D, ZERO } from '../../domain/money';
import { EVM_TOKEN_WHITELIST, type EvmChain } from './evm';
import { OnchainError, type OnchainMovement, type OnchainSyncResult } from './normalize';

export type ExplorerFlavor = 'routescan' | 'etherscan' | 'blockscout-pro';

/** Identifiants de chaîne EVM (vérifiés dans `api.etherscan.io/v2/chainlist` le 24/08/2026). */
export const CHAIN_IDS: Record<EvmChain, number> = { eth: 1, arbitrum: 42161, base: 8453 };

export const FLAVOR_LABELS: Record<ExplorerFlavor, string> = {
  routescan: 'Routescan (sans clé, Ethereum seulement)',
  etherscan: 'Etherscan V2',
  'blockscout-pro': 'Blockscout Pro',
};

/** Parfums proposés à la saisie d'une clé (Routescan n'en demande pas). */
export const KEYED_FLAVORS: readonly ExplorerFlavor[] = ['etherscan', 'blockscout-pro'];

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ExplorerOptions {
  flavor: ExplorerFlavor;
  apiKey?: string | null;
  fetch?: FetchLike;
  /** Nombre maximal de lignes par requête (Etherscan plafonne à 10 000). */
  pageSize?: number;
  signal?: AbortSignal;
}

function endpoint(flavor: ExplorerFlavor, chain: EvmChain): { base: string; chainParam: string } {
  const id = CHAIN_IDS[chain];
  switch (flavor) {
    case 'routescan':
      return {
        base: `https://api.routescan.io/v2/network/mainnet/evm/${id}/etherscan/api`,
        chainParam: '',
      };
    case 'etherscan':
      return { base: 'https://api.etherscan.io/v2/api', chainParam: `chainid=${id}` };
    case 'blockscout-pro':
      return { base: 'https://api.blockscout.com/v2/api', chainParam: `chain_id=${id}` };
  }
}

/** Routescan n'héberge qu'Ethereum sous ce chemin (sonde : « chain not supported » ailleurs). */
export const flavorSupports = (flavor: ExplorerFlavor, chain: EvmChain): boolean =>
  flavor !== 'routescan' || chain === 'eth';

type Row = Record<string, unknown>;

async function call(
  options: ExplorerOptions,
  chain: EvmChain,
  action: string,
  address: string,
): Promise<Row[]> {
  const fetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const { base, chainParam } = endpoint(options.flavor, chain);
  const params = [
    chainParam,
    'module=account',
    `action=${action}`,
    `address=${address}`,
    'startblock=0',
    'endblock=99999999',
    'page=1',
    `offset=${options.pageSize ?? 1000}`,
    'sort=desc',
    options.apiKey ? `apikey=${encodeURIComponent(options.apiKey)}` : '',
  ].filter((p) => p !== '');
  const label = FLAVOR_LABELS[options.flavor];
  let response: Response;
  try {
    response = await fetchLike(`${base}?${params.join('&')}`, {
      signal: options.signal ?? null,
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new OnchainError(`${label} injoignable : ${String(error)}`);
  }
  if (!response.ok)
    throw new OnchainError(`${label} a répondu ${response.status}.`, response.status);
  const body = (await response.json()) as unknown;
  if (typeof body !== 'object' || body === null)
    throw new OnchainError(`Réponse ${label} inattendue.`);
  const record = body as Row;
  const result = record['result'];
  if (Array.isArray(result))
    return result.filter((r): r is Row => typeof r === 'object' && r !== null);
  // `status:"0"` + « No transactions found » est un SUCCÈS vide, pas une erreur : ne pas le
  // confondre avec un rejet de clé, qui met le motif dans `result` sous forme de chaîne.
  const message = typeof record['message'] === 'string' ? record['message'] : '';
  if (/no transactions found|no records found/i.test(message)) return [];
  const reason = typeof result === 'string' ? result : message || 'réponse inattendue';
  throw new OnchainError(`${label} : ${reason}`);
}

const str = (row: Row, key: string): string => (typeof row[key] === 'string' ? row[key] : '');
const lower = (row: Row, key: string): string => str(row, key).toLowerCase();

/** `timeStamp` est en SECONDES et sous forme de chaîne dans tout le dialecte Etherscan. */
function timeMsOf(row: Row): number | null {
  const raw = str(row, 'timeStamp');
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw) * 1000;
}

export async function syncEvmViaExplorer(
  chain: EvmChain,
  address: string,
  options: ExplorerOptions,
): Promise<OnchainSyncResult> {
  if (!flavorSupports(options.flavor, chain))
    throw new OnchainError(
      `${FLAVOR_LABELS[options.flavor]} ne couvre pas ${chain === 'eth' ? 'Ethereum' : chain}.`,
    );
  const me = address.toLowerCase();
  const whitelist = EVM_TOKEN_WHITELIST[chain];
  const movements: OnchainMovement[] = [];
  let ignored = 0;
  const WEI = D('10').pow(18);

  // 1) Transactions natives : pour un envoi, le gaz réellement consommé s'ajoute à la quantité.
  for (const row of await call(options, chain, 'txlist', address)) {
    const timeMs = timeMsOf(row);
    const hash = lower(row, 'hash');
    const value = str(row, 'value');
    if (timeMs === null || hash === '' || !/^\d+$/.test(value)) {
      ignored++;
      continue;
    }
    if (str(row, 'isError') === '1') {
      ignored++; // transaction échouée (son gaz reste dépensé : limite connue, cf. docs)
      continue;
    }
    const from = lower(row, 'from');
    const to = lower(row, 'to');
    const isOut = from === me;
    const isIn = to === me;
    if (isOut === isIn) {
      ignored++;
      continue;
    }
    let wei = D(value);
    let note: string | null = null;
    if (isOut) {
      const gasUsed = str(row, 'gasUsed');
      const gasPrice = str(row, 'gasPrice');
      if (/^\d+$/.test(gasUsed) && /^\d+$/.test(gasPrice))
        wei = wei.plus(D(gasUsed).times(gasPrice));
      note = 'Envoi on-chain : frais de gaz inclus dans la quantité.';
    }
    if (wei.eq(ZERO)) {
      ignored++;
      continue;
    }
    movements.push({
      nativeContent: `evm|${chain}|native|${hash}`,
      timeMs,
      direction: isOut ? 'out' : 'in',
      qty: wei.div(WEI).toString(),
      asset: 'eth',
      txHash: hash,
      note,
    });
  }

  // 2) Transactions INTERNES : l'ETH qui arrive via un contrat (pont, DEX, vault) n'apparaît
  //    nulle part dans `txlist`. Leur gaz est déjà payé par la transaction parente.
  for (const row of await call(options, chain, 'txlistinternal', address)) {
    const timeMs = timeMsOf(row);
    const hash = lower(row, 'hash');
    const value = str(row, 'value');
    if (timeMs === null || hash === '' || !/^\d+$/.test(value) || str(row, 'isError') === '1') {
      ignored++;
      continue;
    }
    const from = lower(row, 'from');
    const to = lower(row, 'to');
    const isOut = from === me;
    const isIn = to === me;
    if (isOut === isIn || value === '0') {
      ignored++;
      continue;
    }
    movements.push({
      nativeContent: `evm|${chain}|internal|${hash}|${str(row, 'traceId')}|${from}|${to}|${value}`,
      timeMs,
      direction: isOut ? 'out' : 'in',
      qty: D(value).div(WEI).toString(),
      asset: 'eth',
      txHash: hash,
      note: isIn ? 'Reçu via un contrat (transaction interne).' : null,
    });
  }

  // 3) Jetons ERC-20 de la liste blanche — par ADRESSE DE CONTRAT, jamais par symbole
  //    (l'USDT d'Arbitrum s'affiche « USDT0 » depuis janvier 2026, décision n° 28).
  for (const row of await call(options, chain, 'tokentx', address)) {
    const timeMs = timeMsOf(row);
    const hash = lower(row, 'hash');
    const contract = lower(row, 'contractAddress');
    const asset = whitelist[contract];
    if (asset === undefined) {
      ignored++;
      continue;
    }
    const value = str(row, 'value');
    const decimalsRaw = str(row, 'tokenDecimal');
    if (timeMs === null || hash === '' || !/^\d+$/.test(value) || !/^\d{1,2}$/.test(decimalsRaw)) {
      ignored++;
      continue;
    }
    const from = lower(row, 'from');
    const to = lower(row, 'to');
    const isOut = from === me;
    const isIn = to === me;
    if (isOut === isIn) {
      ignored++;
      continue;
    }
    const qty = D(value).div(D('10').pow(Number(decimalsRaw)));
    if (qty.eq(ZERO)) {
      ignored++;
      continue;
    }
    movements.push({
      nativeContent: `evm|${chain}|erc20|${hash}|${contract}|${from}|${to}|${value}`,
      timeMs,
      direction: isOut ? 'out' : 'in',
      qty: qty.toString(),
      asset,
      txHash: hash,
      note: isOut ? 'Envoi de token : le gaz sort séparément en ETH.' : null,
    });
  }

  movements.sort((a, b) => a.timeMs - b.timeMs || a.nativeContent.localeCompare(b.nativeContent));
  // Ce chemin lit tout l'historique en une requête par action : rien n'est tronqué.
  return { movements, ignored, truncated: false };
}
