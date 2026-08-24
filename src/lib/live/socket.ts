/**
 * Transport WebSocket Hyperliquid, partagé par les flux « en direct » : un seul socket porte
 * PLUSIEURS abonnements (`allMids` pour les cours, `userFills`/`userFundings` par compte).
 *
 * Contrat vérifié en direct le 24/08/2026 : requête
 * `{"method":"subscribe","subscription":{…}}`, accusé `{"channel":"subscriptionResponse",…}`,
 * pousses `{"channel":"<type>","data":{…}}`, keepalive `{"method":"ping"}` → `{"channel":"pong"}`.
 * La documentation demande seulement de « gracefully reconnect » : backoff exponentiel avec gigue.
 *
 * Deux détails qui font la différence entre un flux vivant et un flux mort en silence :
 * 1. les abonnements sont **relus à chaque (re)connexion** — un compte ajouté après coup est pris
 *    en compte, et une reconnexion ne repart pas amputée de ses abonnements ;
 * 2. seul un message de DONNÉES (ni accusé, ni pong, ni erreur) fait passer l'état à « live » et
 *    remet le backoff à zéro : un simple accusé ne prouve pas que le flux coule.
 *
 * Module pur : le socket est injectable, aucun accès au DOM.
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

export interface LiveSocketOptions {
  /** Relu à chaque connexion : la liste peut changer entre deux tentatives. */
  subscriptions: () => readonly unknown[];
  onMessage(channel: string, data: unknown): void;
  onStatus(status: LiveStatus): void;
  createSocket?: (url: string) => SocketLike;
  url?: string;
  pingMs?: number;
  maxBackoffMs?: number;
}

export interface LiveSocket {
  start(): void;
  stop(): void;
}

export const HYPERLIQUID_WS_URL = 'wss://api.hyperliquid.xyz/ws';
const DEFAULT_PING_MS = 50_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
/** Canaux de service : ils prouvent que le socket parle, pas que les données arrivent. */
const CONTROL_CHANNELS = new Set(['subscriptionResponse', 'pong', 'error']);

export function createLiveSocket(options: LiveSocketOptions): LiveSocket {
  const url = options.url ?? HYPERLIQUID_WS_URL;
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
    if (typeof channel !== 'string') return;
    if (!CONTROL_CHANNELS.has(channel)) {
      attempts = 0; // flux vivant : le prochain incident repartira d'un backoff court
      options.onStatus('live');
    }
    options.onMessage(channel, data);
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
      for (const subscription of options.subscriptions())
        created.send(JSON.stringify({ method: 'subscribe', subscription }));
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
