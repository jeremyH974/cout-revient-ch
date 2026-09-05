/**
 * Choix du fournisseur EVM et repli. L'ordre est dicté par un fait mesuré, pas par une préférence :
 * les instances Blockscout par chaîne répondent encore sans clé (sonde du 24/08/2026) mais leur
 * API publique est officiellement basculée vers une Pro API payante-au-delà-du-gratuit ; il faut
 * donc pouvoir continuer sans elles, sans imposer de clé à qui n'en veut pas.
 *
 * 1. clé configurée → son parfum d'abord (meilleures limites, historique complet, transactions
 *    internes lues) ;
 * 2. sinon Blockscout par instance, comportement historique, aucune clé ;
 * 3. échec → Routescan, sans clé, mais Ethereum seulement ;
 * 4. tout a échoué → un message qui dit quoi faire, pas un code HTTP.
 *
 * Chaque fournisseur a droit à **un réessai** quand il ne répond pas (panne de transport ou 5xx) :
 * un hoquet n'est pas un refus, et sans cela un seul `500` de Blockscout envoyait l'utilisateur
 * chercher une clé (décision n° 102).
 */
import {
  FLAVOR_LABELS,
  flavorSupports,
  syncEvmViaExplorer,
  type ExplorerFlavor,
} from './etherscan';
import { syncEvmAddress, type EvmChain } from './evm';
import { OnchainError, type OnchainSyncResult } from './normalize';

export interface EvmSyncSettings {
  /** Clé d'explorateur facultative (lecture de données publiques ; jamais une clé d'exchange). */
  explorerKey?: string | null;
  explorerFlavor?: ExplorerFlavor;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
  /** Pause entre deux essais d'un même fournisseur ; abaissée par les tests. */
  retryPauseMs?: number;
}

/** Un seul réessai : au-delà, ce n'est plus un hoquet, et le fournisseur suivant attend. */
const RETRIES = 1;
const RETRY_PAUSE_MS = 1_500;

/**
 * Panne de transport ou 5xx : **une non-réponse, pas un verdict** (décisions n° 98 et 99). Un `429`
 * n'en est pas une — le fournisseur a répondu, et il dit d'attendre : on passe au suivant plutôt
 * que d'insister. Un 4xx non plus : il refuse pour une raison qui ne changera pas en deux secondes.
 *
 * Mesuré le 05/09/2026 sur `base.blockscout.com` : 8 succès sur 8, alors que la même instance
 * rendait `500` une heure plus tôt et une fois sur sept le 30/08. Sans réessai, un seul de ces
 * hoquets suffisait à épuiser le chemin sans clé et à réclamer une clé d'explorateur à
 * l'utilisateur — pour une chaîne (Base) qui n'a aucun autre secours gratuit.
 */
function estUneNonReponse(error: unknown): boolean {
  if (!(error instanceof OnchainError)) return false;
  return error.httpStatus === null || error.httpStatus >= 500;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface EvmSyncOutcome extends OnchainSyncResult {
  /** Fournisseur qui a réellement répondu : affiché pour que l'origine d'un chiffre soit lisible. */
  provider: string;
}

interface Attempt {
  label: string;
  run: () => Promise<OnchainSyncResult>;
}

export function evmAttempts(
  chain: EvmChain,
  address: string,
  settings: EvmSyncSettings,
): Attempt[] {
  const attempts: Attempt[] = [];
  const key = settings.explorerKey?.trim();
  const flavor = settings.explorerFlavor ?? 'etherscan';
  const explorerOptions = (f: ExplorerFlavor, apiKey: string | null): Attempt => ({
    label: FLAVOR_LABELS[f],
    run: () =>
      syncEvmViaExplorer(chain, address, {
        flavor: f,
        apiKey,
        ...(settings.fetch ? { fetch: settings.fetch } : {}),
        ...(settings.signal ? { signal: settings.signal } : {}),
      }),
  });
  if (key && flavorSupports(flavor, chain)) attempts.push(explorerOptions(flavor, key));
  attempts.push({
    label: 'Blockscout',
    run: () =>
      syncEvmAddress(chain, address, {
        ...(settings.fetch ? { fetch: settings.fetch } : {}),
        ...(settings.signal ? { signal: settings.signal } : {}),
      }),
  });
  if (flavorSupports('routescan', chain)) attempts.push(explorerOptions('routescan', null));
  return attempts;
}

export async function syncEvmWithFallback(
  chain: EvmChain,
  address: string,
  settings: EvmSyncSettings = {},
): Promise<EvmSyncOutcome> {
  const attempts = evmAttempts(chain, address, settings);
  const failures: string[] = [];
  const pauseMs = settings.retryPauseMs ?? RETRY_PAUSE_MS;
  for (const attempt of attempts) {
    for (let essai = 0; essai <= RETRIES; essai++) {
      try {
        const result = await attempt.run();
        return { ...result, provider: attempt.label };
      } catch (error) {
        if (essai < RETRIES && estUneNonReponse(error)) {
          await pause(pauseMs);
          continue;
        }
        failures.push(
          `${attempt.label} : ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }
    }
  }
  const hasKey = (settings.explorerKey ?? '').trim() !== '';
  throw new OnchainError(
    `Aucun explorateur n’a répondu pour cette chaîne. ${failures.join(' · ')}` +
      (hasKey
        ? ''
        : ' — ajoutez une clé d’explorateur gratuite dans Réglages : elle ne lit que des données publiques et ne donne accès à aucun fonds.'),
  );
}
