/**
 * Prix « live » Hyperliquid (P26, MVP) : WebSocket `wss://api.hyperliquid.xyz/ws`, abonnement
 * `allMids` — opt-in, jamais ouvert par défaut. Forme des messages vérifiée en direct le
 * 24/08/2026 : requête `{"method":"subscribe","subscription":{"type":"allMids"}}`, accusé
 * `{"channel":"subscriptionResponse",…}`, pousses `{"channel":"allMids","data":{"mids":{…}}}`
 * (clés perp `BTC`, spot `@107`, et `#<id>` non documentées — parsing défensif), keepalive
 * `{"method":"ping"}` → `{"channel":"pong"}`. Reconnexion : backoff exponentiel avec jitter
 * (la doc n'impose rien, elle demande de « gracefully reconnect »).
 * Module pur : le socket est injectable pour les tests ; aucun montant en `number` (les mids
 * restent des chaînes décimales).
 */

export type LiveStatus = 'off' | 'connecting' | 'live' | 'retry';

/** Sous-ensemble de l'API WebSocket utilisé (injectable dans les tests). */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface LiveMidsOptions {
  onMids(mids: Record<string, string>): void;
  onStatus(status: LiveStatus): void;
  /** Fabrique de socket (défaut : `new WebSocket(url)` du navigateur). */
  createSocket?: (url: string) => SocketLike;
  url?: string;
  pingMs?: number;
  maxBackoffMs?: number;
}

export interface LiveMids {
  start(): void;
  stop(): void;
}

const DEFAULT_URL = 'wss://api.hyperliquid.xyz/ws';
const DEFAULT_PING_MS = 50_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

export function createLiveMids(options: LiveMidsOptions): LiveMids {
  const url = options.url ?? DEFAULT_URL;
  const pingMs = options.pingMs ?? DEFAULT_PING_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const createSocket =
    options.createSocket ??
    ((target: string): SocketLike => new WebSocket(target) as unknown as SocketLike);

  let socket: SocketLike | null = null;
  let running = false;
  let attempts = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = (): void => {
    if (pingTimer !== null) clearInterval(pingTimer);
    pingTimer = null;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const teardownSocket = (): void => {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close();
    } catch {
      // déjà fermé
    }
    socket = null;
  };

  const scheduleRetry = (): void => {
    if (!running || retryTimer !== null) return;
    options.onStatus('retry');
    const backoff = Math.min(maxBackoffMs, 1000 * 2 ** Math.min(attempts, 8));
    const jitter = backoff * 0.2 * Math.random();
    attempts++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, backoff + jitter);
  };

  const handleMessage = (raw: unknown): void => {
    if (typeof raw !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const { channel, data } = parsed as { channel?: unknown; data?: unknown };
    if (channel !== 'allMids') return;
    const rawMids =
      typeof data === 'object' && data !== null ? (data as { mids?: unknown }).mids : undefined;
    if (typeof rawMids !== 'object' || rawMids === null) return;
    const mids: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawMids as Record<string, unknown>)) {
      if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) mids[key] = value;
    }
    attempts = 0; // flux vivant : le prochain incident repartira d'un backoff court
    options.onStatus('live');
    options.onMids(mids);
  };

  const connect = (): void => {
    if (!running) return;
    teardownSocket();
    options.onStatus('connecting');
    let created: SocketLike;
    try {
      created = createSocket(url);
    } catch {
      scheduleRetry();
      return;
    }
    socket = created;
    created.onopen = () => {
      created.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
      if (pingTimer === null)
        pingTimer = setInterval(() => {
          try {
            created.send(JSON.stringify({ method: 'ping' }));
          } catch {
            // le onclose suivra
          }
        }, pingMs);
    };
    created.onmessage = (event) => handleMessage(event.data);
    created.onclose = () => {
      if (pingTimer !== null) clearInterval(pingTimer);
      pingTimer = null;
      socket = null;
      scheduleRetry();
    };
    created.onerror = () => {
      // le navigateur enchaîne toujours sur onclose ; rien à faire ici
    };
  };

  return {
    start() {
      if (running) return;
      running = true;
      attempts = 0;
      connect();
    },
    stop() {
      running = false;
      clearTimers();
      teardownSocket();
      options.onStatus('off');
    },
  };
}
