/**
 * Synchronisation incrémentale d'un compte Hyperliquid (adresse publique) : fills, funding et
 * grand livre par pages depuis le dernier instant connu (borne inclusive + dédoublonnage par clé,
 * donc rejouable à l'identique : sync × 2 = sync × 1), puis instantanés du compte perps et des
 * soldes spot. Une erreur en cours de route conserve ce qui a déjà été reçu (`error` renseigné),
 * la synchronisation suivante reprend aux curseurs.
 */
import {
  parseClearinghouse,
  parseFills,
  parseFunding,
  parseLedger,
  parsePortfolio,
  parseSpotClearinghouse,
} from './api-types';
import type { HlClient } from './client';
import {
  emptyHlAccountData,
  fundingKey,
  ledgerKey,
  type HlAccountData,
  type HlSpotPairRef,
} from './data';

/** Taille de page des fills, documentée et observée le 23/08/2026 (2 000 ; 10 000 fills conservés). */
export const FILLS_PAGE = 2_000;
/**
 * Funding et grand livre : limite par réponse non documentée et jamais atteinte en sonde. Seuil de
 * continuation volontairement bas : une page d'au moins 100 éléments déclenche la suivante (au pire
 * une requête de plus, jamais une page manquée).
 */
export const LEDGER_PAGE = 100;
/** Borne par appel : 50 pages de fills = 100 000 fills, bien au-delà de ce que l'API conserve. */
const MAX_PAGES = 50;

export interface SyncProgress {
  step: 'fills' | 'funding' | 'ledger' | 'snapshot';
  pages: number;
  items: number;
}

export interface SyncOptions {
  now: () => number;
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
}

export interface SyncResult {
  data: HlAccountData;
  spotPairs: Record<string, HlSpotPairRef>;
  added: { fills: number; funding: number; ledger: number };
  /** Une borne de pages a été atteinte : relancer pour continuer. */
  truncated: boolean;
  /** Message d'erreur si la synchronisation s'est interrompue (données partielles conservées). */
  error: string | null;
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface Paged<T> {
  items: T[];
  pages: number;
  truncated: boolean;
}

/**
 * Parcourt un flux paginé par `startTime` : la page suivante repart de l'instant du dernier
 * élément (borne inclusive, l'élément est renvoyé à nouveau et dédoublonné par sa clé).
 */
async function paginate<T extends { time: number }>(
  client: HlClient,
  type: string,
  user: string,
  from: number,
  pageSize: number,
  parse: (body: unknown) => T[],
  options: SyncOptions,
  step: SyncProgress['step'],
): Promise<Paged<T>> {
  const items: T[] = [];
  let startTime = from;
  let pages = 0;
  for (;;) {
    const body = await client.info({ type, user, startTime }, options.signal);
    const page = parse(body);
    pages++;
    items.push(...page);
    options.onProgress?.({ step, pages, items: items.length });
    if (page.length < pageSize) return { items, pages, truncated: false };
    const last = page.reduce((acc, item) => Math.max(acc, item.time), startTime);
    // Toute la page au même instant : impossible d'avancer sans curseur plus fin — on s'arrête.
    if (last <= startTime || pages >= MAX_PAGES) return { items, pages, truncated: true };
    startTime = last;
  }
}

export async function syncAccount(
  client: HlClient,
  previous: HlAccountData | null,
  address: string,
  options: SyncOptions,
): Promise<SyncResult> {
  const data: HlAccountData = previous
    ? {
        ...previous,
        fills: { ...previous.fills },
        funding: { ...previous.funding },
        ledger: { ...previous.ledger },
        cursors: { ...previous.cursors },
      }
    : emptyHlAccountData(address);
  const added = { fills: 0, funding: 0, ledger: 0 };
  let truncated = false;
  const spotPairs: Record<string, HlSpotPairRef> = {};

  try {
    const meta = await client.spotMeta(options.signal);
    for (const pair of meta.pairs) spotPairs[pair.name] = { base: pair.base, quote: pair.quote };

    const fills = await paginate(
      client,
      'userFillsByTime',
      address,
      data.cursors.fills ?? 0,
      FILLS_PAGE,
      parseFills,
      options,
      'fills',
    );
    for (const fill of fills.items) {
      if (!(fill.tid in data.fills)) added.fills++;
      data.fills[fill.tid] = fill;
      data.cursors.fills = Math.max(data.cursors.fills ?? 0, fill.time);
    }
    truncated ||= fills.truncated;

    const funding = await paginate(
      client,
      'userFunding',
      address,
      data.cursors.funding ?? 0,
      LEDGER_PAGE,
      parseFunding,
      options,
      'funding',
    );
    for (const entry of funding.items) {
      const key = fundingKey(entry);
      if (!(key in data.funding)) added.funding++;
      data.funding[key] = entry;
      data.cursors.funding = Math.max(data.cursors.funding ?? 0, entry.time);
    }
    truncated ||= funding.truncated;

    const ledger = await paginate(
      client,
      'userNonFundingLedgerUpdates',
      address,
      data.cursors.ledger ?? 0,
      LEDGER_PAGE,
      parseLedger,
      options,
      'ledger',
    );
    for (const entry of ledger.items) {
      const key = ledgerKey(entry);
      if (!(key in data.ledger)) added.ledger++;
      data.ledger[key] = entry;
      data.cursors.ledger = Math.max(data.cursors.ledger ?? 0, entry.time);
    }
    truncated ||= ledger.truncated;

    options.onProgress?.({ step: 'snapshot', pages: 0, items: 0 });
    const perps = parseClearinghouse(
      await client.info({ type: 'clearinghouseState', user: address }, options.signal),
    );
    const spot = parseSpotClearinghouse(
      await client.info({ type: 'spotClearinghouseState', user: address }, options.signal),
    );
    if (perps) {
      data.snapshot = { at: new Date(options.now()).toISOString(), perps, spot };
    }
    const portfolio = parsePortfolio(
      await client.info({ type: 'portfolio', user: address }, options.signal),
    );
    if (Object.keys(portfolio).length > 0) data.portfolio = portfolio;
    data.lastSyncAt = new Date(options.now()).toISOString();
    return { data, spotPairs, added, truncated, error: null };
  } catch (error) {
    return { data, spotPairs, added, truncated, error: describe(error) };
  }
}
