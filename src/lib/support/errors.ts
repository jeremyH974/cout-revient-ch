/**
 * Capture des erreurs côté client, sans serveur : les dernières erreurs (message + première ligne
 * de pile, jamais de données) sont gardées en mémoire pour le diagnostic copiable.
 */
export interface CapturedError {
  /** ISO 8601. */
  at: string;
  source: string;
  message: string;
  stack: string;
}

const MAX = 20;

/** Liste vivante (module simple, lue par le diagnostic au moment de la copie). */
export const recentErrors: CapturedError[] = [];

const firstStackLine = (stack: string | undefined): string =>
  (stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('at ') || l.includes('@')) ?? '';

export function recordError(error: unknown, source: string, now = new Date().toISOString()): void {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'erreur inconnue');
  const stack = error instanceof Error ? firstStackLine(error.stack) : '';
  const last = recentErrors[recentErrors.length - 1];
  if (last && last.message === message && last.stack === stack) return;
  recentErrors.push({
    at: now,
    source,
    message: message.slice(0, 300),
    stack: stack.slice(0, 200),
  });
  if (recentErrors.length > MAX) recentErrors.splice(0, recentErrors.length - MAX);
}

/** Erreurs non interceptées (exceptions et promesses rejetées). */
export function installGlobalErrorCapture(target: Window = window): void {
  target.addEventListener('error', (event) => {
    recordError(event.error ?? event.message, 'window');
  });
  target.addEventListener('unhandledrejection', (event) => {
    recordError(event.reason, 'promise');
  });
}

export function formatErrors(errors: readonly CapturedError[]): string {
  if (errors.length === 0) return 'Erreurs récentes : aucune';
  const lines = errors
    .slice(-5)
    .map(
      (e) =>
        `  - ${e.at.slice(0, 19).replace('T', ' ')} [${e.source}] ${e.message}${e.stack ? ` (${e.stack})` : ''}`,
    );
  return `Erreurs récentes : ${errors.length}\n${lines.join('\n')}`;
}
