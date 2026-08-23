/** Collecte navigateur pour le diagnostic. Rien n'est envoyé : le texte va dans le presse-papiers. */
import type { DiagnosticInput } from './diagnostic';

export interface EnvironmentSnapshot {
  environment: DiagnosticInput['environment'];
  storage: Pick<DiagnosticInput['storage'], 'persisted' | 'usageBytes' | 'quotaBytes'>;
}

/** Installé (écran d'accueil / PWA) : Safari iOS ne purge pas le stockage d'une app installée. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    (window.matchMedia?.('(display-mode: standalone)').matches ?? false) || nav.standalone === true
  );
}

/** iPhone/iPad (détection par agent utilisateur, signal indicatif : iPadOS peut se dire « Mac »). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { maxTouchPoints?: number };
  return (
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)
  );
}

export async function collectEnvironment(): Promise<EnvironmentSnapshot> {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = isStandalone();
  let persisted: boolean | null = null;
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  try {
    persisted = (await nav.storage?.persisted?.()) ?? null;
    const estimate = await nav.storage?.estimate?.();
    usageBytes = estimate?.usage ?? null;
    quotaBytes = estimate?.quota ?? null;
  } catch {
    // API absente (navigation privée, ancien navigateur) : on laisse « ? ».
  }
  return {
    environment: {
      userAgent: nav.userAgent,
      language: nav.language,
      viewport: `${window.innerWidth}×${window.innerHeight} (×${window.devicePixelRatio})`,
      online: typeof nav.onLine === 'boolean' ? nav.onLine : null,
      standalone,
    },
    storage: { persisted, usageBytes, quotaBytes },
  };
}
