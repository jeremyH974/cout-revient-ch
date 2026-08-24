/**
 * Prix « live » Hyperliquid (P26) : abonnement `allMids` sur le transport partagé
 * (`lib/live/socket.ts`). Opt-in, jamais ouvert par défaut (décision n° 29).
 *
 * Forme des messages vérifiée en direct le 24/08/2026 : pousses
 * `{"channel":"allMids","data":{"mids":{…}}}` — clés perp `BTC`, spot `@107`, et `#<id>` non
 * documentées, d'où un parsing défensif. Les mids restent des chaînes décimales : aucun montant ne
 * devient un `number` en chemin.
 */
import {
  createLiveSocket,
  type LiveSocket,
  type LiveStatus,
  type SocketLike,
} from '../live/socket';

export type { LiveStatus, SocketLike };

export interface LiveMidsOptions {
  onMids(mids: Record<string, string>): void;
  onStatus(status: LiveStatus): void;
  /** Fabrique de socket (défaut : `new WebSocket(url)` du navigateur). */
  createSocket?: (url: string) => SocketLike;
  url?: string;
  pingMs?: number;
  maxBackoffMs?: number;
}

export type LiveMids = LiveSocket;

/** Extrait les mids exploitables d'une charge `allMids` (tout le reste est ignoré). */
export function parseMids(data: unknown): Record<string, string> | null {
  const rawMids =
    typeof data === 'object' && data !== null ? (data as { mids?: unknown }).mids : undefined;
  if (typeof rawMids !== 'object' || rawMids === null) return null;
  const mids: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawMids as Record<string, unknown>))
    if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) mids[key] = value;
  return mids;
}

export function createLiveMids(options: LiveMidsOptions): LiveMids {
  return createLiveSocket({
    subscriptions: () => [{ type: 'allMids' }],
    onMessage: (channel, data) => {
      if (channel !== 'allMids') return;
      const mids = parseMids(data);
      if (mids !== null) options.onMids(mids);
    },
    onStatus: options.onStatus,
    ...(options.createSocket ? { createSocket: options.createSocket } : {}),
    ...(options.url ? { url: options.url } : {}),
    ...(options.pingMs !== undefined ? { pingMs: options.pingMs } : {}),
    ...(options.maxBackoffMs !== undefined ? { maxBackoffMs: options.maxBackoffMs } : {}),
  });
}
