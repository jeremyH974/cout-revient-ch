/**
 * Bitcoin — API Esplora (mempool.space, secours blockstream.info ; CORS `*` vérifié le
 * 24/08/2026, sans clé).
 *
 * Deux entrées : une **adresse** seule, ou une **clé publique étendue** (xpub/ypub/zpub) dérivée
 * localement (voir `xpub.ts`). Dans les deux cas le calcul est le même et c'est le point qui
 * compte : le mouvement d'une transaction est **net sur l'ensemble des adresses du portefeuille**
 * — `Σ vout vers moi − Σ vin depuis moi` — et non par adresse. Un portefeuille réel renvoie sa
 * monnaie sur une adresse neuve à chaque dépense ; netter par adresse compterait ce retour de
 * monnaie comme une réception, et gonflerait dépôts et retraits en miroir.
 *
 * Un net négatif est un envoi (la quote-part de frais est dedans : « le coût voyage ») ; un net
 * nul est un déplacement purement interne, ignoré.
 */
import { D, ZERO, type Big } from '../../domain/money';
import { OnchainError, type OnchainMovement, type OnchainSyncResult } from './normalize';
import type { AddressScheme, DerivationChain } from './xpub';

/** Exporté pour que le catalogue des sources (`src/lib/support/sources.ts`) puisse être croisé. */
export const BTC_HOSTS = ['https://mempool.space/api', 'https://blockstream.info/api'] as const;
const HOSTS = BTC_HOSTS;
const PAGE_SIZE = 25;
const SATS = D('100000000');
/** Norme BIP44 : 20 adresses consécutives inutilisées ferment la chaîne. */
export const DEFAULT_GAP_LIMIT = 20;
/** Garde-fou de débit : ces API publiques sont gratuites, on ne les martèle pas. */
const DEFAULT_DELAY_MS = 250;
/** Plafond dur du nombre d'adresses dérivées, toutes chaînes confondues. */
const DEFAULT_MAX_ADDRESSES = 500;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface BtcScanProgress {
  /** Adresses interrogées jusqu'ici. */
  scanned: number;
  /** Adresses ayant au moins une transaction. */
  used: number;
  /** Transactions distinctes collectées. */
  txs: number;
}

interface Client {
  json(path: string, signal?: AbortSignal): Promise<unknown>;
}

/**
 * Client Esplora sérialisé : une requête à la fois, pause entre deux, bascule définitive sur
 * l'hôte de secours au premier 429 (mieux vaut finir la synchronisation ailleurs que la perdre).
 */
function createClient(fetchLike: FetchLike, delayMs: number): Client {
  let hostIndex = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const sleep = (ms: number): Promise<void> =>
    ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

  const once = async (path: string, signal?: AbortSignal): Promise<unknown> => {
    for (let attempt = 0; attempt < HOSTS.length; attempt++) {
      const host = HOSTS[hostIndex]!;
      let response: Response;
      try {
        response = await fetchLike(`${host}${path}`, {
          signal: signal ?? null,
          headers: { accept: 'application/json' },
        });
      } catch (error) {
        throw new OnchainError(`Service Bitcoin injoignable : ${String(error)}`);
      }
      if (response.status === 429 && hostIndex < HOSTS.length - 1) {
        hostIndex++; // débit limité : on continue chez l'autre fournisseur
        continue;
      }
      if (response.status === 429)
        throw new OnchainError(
          'Les services Bitcoin publics limitent le débit : réessayez dans une minute.',
          429,
        );
      if (!response.ok)
        throw new OnchainError(`Service Bitcoin : réponse ${response.status}.`, response.status);
      return (await response.json()) as unknown;
    }
    throw new OnchainError('Aucun service Bitcoin disponible.');
  };

  return {
    json(path, signal) {
      const run = chain.then(async () => {
        const result = await once(path, signal);
        await sleep(delayMs);
        return result;
      });
      // La file ne doit pas se rompre sur un échec : le rejet est propagé à l'appelant seulement.
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

interface RawTx {
  txid: string;
  blockTimeMs: number;
  raw: Record<string, unknown>;
}

function readTx(raw: unknown): RawTx | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const tx = raw as Record<string, unknown>;
  const status = (tx['status'] ?? {}) as Record<string, unknown>;
  if (status['confirmed'] !== true) return null; // mempool : ignoré jusqu'à confirmation
  const blockTime = status['block_time'];
  const txid = tx['txid'];
  if (typeof txid !== 'string' || typeof blockTime !== 'number') return null;
  return { txid, blockTimeMs: blockTime * 1000, raw: tx };
}

/** Mouvement net d'une transaction sur un ensemble d'adresses (`mine`). */
function netOf(tx: RawTx, mine: ReadonlySet<string>): Big {
  let net = ZERO;
  for (const vout of Array.isArray(tx.raw['vout']) ? tx.raw['vout'] : []) {
    const o = (vout ?? {}) as Record<string, unknown>;
    const address = o['scriptpubkey_address'];
    if (typeof address === 'string' && mine.has(address) && typeof o['value'] === 'number')
      net = net.plus(String(o['value']));
  }
  for (const vin of Array.isArray(tx.raw['vin']) ? tx.raw['vin'] : []) {
    const p = (((vin ?? {}) as Record<string, unknown>)['prevout'] ?? {}) as Record<
      string,
      unknown
    >;
    const address = p['scriptpubkey_address'];
    if (typeof address === 'string' && mine.has(address) && typeof p['value'] === 'number')
      net = net.minus(String(p['value']));
  }
  return net;
}

/** Transactions distinctes → mouvements nets sur l'ensemble d'adresses. */
export function movementsFromTxs(
  txs: readonly RawTx[],
  mine: ReadonlySet<string>,
): { movements: OnchainMovement[]; ignored: number } {
  const movements: OnchainMovement[] = [];
  let ignored = 0;
  for (const tx of [...txs].sort((a, b) => a.blockTimeMs - b.blockTimeMs)) {
    const net = netOf(tx, mine);
    if (net.eq(ZERO)) {
      ignored++; // déplacement interne (monnaie rendue à soi-même) : aucun mouvement économique
      continue;
    }
    const out = net.lt(ZERO);
    movements.push({
      nativeContent: `btc|${tx.txid}`,
      timeMs: tx.blockTimeMs,
      direction: out ? 'out' : 'in',
      qty: net.abs().div(SATS).toString(),
      asset: 'btc',
      txHash: tx.txid,
      note: out ? 'Envoi on-chain : frais réseau inclus dans la quantité.' : null,
    });
  }
  return { movements, ignored };
}

/** Toutes les transactions confirmées d'une adresse, paginées (25 par page). */
async function collectAddressTxs(
  client: Client,
  address: string,
  maxPages: number,
  signal: AbortSignal | undefined,
  into: Map<string, RawTx>,
): Promise<boolean> {
  let lastTxid: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const path =
      lastTxid === null ? `/address/${address}/txs` : `/address/${address}/txs/chain/${lastTxid}`;
    const body = await client.json(path, signal);
    if (!Array.isArray(body)) throw new OnchainError('Réponse Bitcoin inattendue.');
    let confirmedInPage = 0;
    for (const raw of body) {
      const tx = readTx(raw);
      if (tx === null) continue;
      confirmedInPage++;
      lastTxid = tx.txid;
      into.set(tx.txid, tx);
    }
    if (confirmedInPage < PAGE_SIZE) return false;
  }
  return true; // plafond atteint : de l'historique plus ancien reste non lu
}

/** Nombre de transactions d'une adresse (confirmées + mempool) : 1 requête légère. */
async function addressTxCount(
  client: Client,
  address: string,
  signal: AbortSignal | undefined,
): Promise<number> {
  const body = await client.json(`/address/${address}`, signal);
  if (typeof body !== 'object' || body === null)
    throw new OnchainError('Réponse Bitcoin inattendue.');
  const record = body as Record<string, unknown>;
  const count = (key: string): number => {
    const stats = (record[key] ?? {}) as Record<string, unknown>;
    return typeof stats['tx_count'] === 'number' ? stats['tx_count'] : 0;
  };
  return count('chain_stats') + count('mempool_stats');
}

export const BTC_ADDRESS_RE = /^(bc1[a-z0-9]{8,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,42})$/;

export interface BtcSyncOptions {
  fetch?: FetchLike;
  maxPages?: number;
  delayMs?: number;
  signal?: AbortSignal;
}

export async function syncBtcAddress(
  address: string,
  options: BtcSyncOptions = {},
): Promise<OnchainSyncResult> {
  const client = createClient(
    options.fetch ?? ((url, init) => fetch(url, init)),
    options.delayMs ?? DEFAULT_DELAY_MS,
  );
  const txs = new Map<string, RawTx>();
  const truncated = await collectAddressTxs(
    client,
    address,
    options.maxPages ?? 8,
    options.signal,
    txs,
  );
  const { movements, ignored } = movementsFromTxs([...txs.values()], new Set([address]));
  return { movements, ignored, truncated };
}

export interface BtcWalletSyncOptions extends BtcSyncOptions {
  gapLimit?: number;
  maxAddresses?: number;
  onProgress?: (progress: BtcScanProgress) => void;
}

export interface BtcWalletSyncResult extends OnchainSyncResult {
  scheme: AddressScheme;
  /** Adresses dérivées et interrogées. */
  derived: number;
  /** Adresses ayant au moins une transaction. */
  used: number;
  gapLimit: number;
}

/**
 * Synchronise un portefeuille entier à partir d'une clé publique étendue : dérivation locale,
 * balayage des chaînes de réception (0) et de monnaie (1) jusqu'à `gapLimit` adresses vides
 * consécutives, puis mouvements **nets sur toutes les adresses**.
 *
 * Coût en requêtes : une par adresse balayée (légère), plus la pagination des seules adresses
 * réellement utilisées. Un portefeuille de 30 adresses actives coûte ~80 requêtes, pas 500.
 */
export async function syncBtcWallet(
  extendedKey: string,
  options: BtcWalletSyncOptions = {},
): Promise<BtcWalletSyncResult> {
  const { parseExtendedKey, deriveAddresses } = await import('./xpub');
  const parsed = parseExtendedKey(extendedKey);
  const gapLimit = options.gapLimit ?? DEFAULT_GAP_LIMIT;
  const maxAddresses = options.maxAddresses ?? DEFAULT_MAX_ADDRESSES;
  const client = createClient(
    options.fetch ?? ((url, init) => fetch(url, init)),
    options.delayMs ?? DEFAULT_DELAY_MS,
  );

  const mine = new Set<string>();
  const txs = new Map<string, RawTx>();
  let scanned = 0;
  let used = 0;
  let truncated = false;
  const report = (): void => options.onProgress?.({ scanned, used, txs: txs.size });

  for (const chain of [0, 1] as DerivationChain[]) {
    let gap = 0;
    let index = 0;
    while (gap < gapLimit && scanned < maxAddresses) {
      const batch = Math.min(gapLimit - gap, maxAddresses - scanned);
      const addresses = deriveAddresses(parsed, chain, index, batch);
      for (const address of addresses) {
        index++;
        scanned++;
        mine.add(address);
        const count = await addressTxCount(client, address, options.signal);
        if (count === 0) gap++;
        else {
          gap = 0;
          used++;
          if (await collectAddressTxs(client, address, options.maxPages ?? 8, options.signal, txs))
            truncated = true;
        }
        report();
        if (gap >= gapLimit) break;
      }
    }
    if (scanned >= maxAddresses) truncated = true;
  }

  const { movements, ignored } = movementsFromTxs([...txs.values()], mine);
  return {
    movements,
    ignored,
    truncated,
    scheme: parsed.scheme,
    derived: scanned,
    used,
    gapLimit,
  };
}
