/**
 * File d'attente de requêtes HTTP : une requête à la fois, délai minimal entre deux départs,
 * nouvelles tentatives avec backoff exponentiel sur 429 / 5xx. Horloge et attente injectables
 * pour des tests déterministes.
 */

export interface RequestQueueOptions {
  /** Délai minimal entre deux départs de requêtes (ms). */
  minIntervalMs: number;
  /** Nombre maximal de tentatives pour une même requête (≥ 1). */
  maxAttempts: number;
  /** Attente avant la 1re nouvelle tentative (ms), doublée à chaque tentative suivante. */
  backoffMs: number;
  /** Réponses à rejouer (défaut : 429 et 5xx). */
  shouldRetry?: (response: Response) => boolean;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error) return reason;
  return new DOMException('Requête annulée', 'AbortError');
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

/** Attente annulable (setTimeout). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function defaultShouldRetry(response: Response): boolean {
  return response.status === 429 || response.status >= 500;
}

/** Délai `Retry-After` (secondes) si le serveur l'expose, sinon 0. */
function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after');
  if (!header) return 0;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

export class RequestQueue {
  private chain: Promise<void> = Promise.resolve();
  private lastStartMs = Number.NEGATIVE_INFINITY;
  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly shouldRetry: (response: Response) => boolean;
  private readonly sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;

  constructor(options: RequestQueueOptions) {
    this.minIntervalMs = options.minIntervalMs;
    this.maxAttempts = Math.max(1, options.maxAttempts);
    this.backoffMs = options.backoffMs;
    this.shouldRetry = options.shouldRetry ?? defaultShouldRetry;
    this.sleepFn = options.sleep ?? sleep;
    this.now = options.now ?? Date.now;
  }

  /**
   * Planifie une requête. La réponse finale est renvoyée telle quelle (même 429 après la
   * dernière tentative) : c'est à l'appelant de décider quoi en faire.
   */
  run(fetcher: () => Promise<Response>, signal?: AbortSignal): Promise<Response> {
    const turn = this.chain.then(() => this.execute(fetcher, signal));
    this.chain = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  private async execute(fetcher: () => Promise<Response>, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      throwIfAborted(signal);
      const wait = this.lastStartMs + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleepFn(wait, signal);
      this.lastStartMs = this.now();
      const response = await fetcher();
      if (attempt >= this.maxAttempts || !this.shouldRetry(response)) return response;
      const backoff = this.backoffMs * 2 ** (attempt - 1);
      await this.sleepFn(Math.max(backoff, retryAfterMs(response)), signal);
    }
  }
}
