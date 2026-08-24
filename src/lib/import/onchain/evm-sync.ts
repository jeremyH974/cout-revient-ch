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
}

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
  for (const attempt of attempts) {
    try {
      const result = await attempt.run();
      return { ...result, provider: attempt.label };
    } catch (error) {
      failures.push(`${attempt.label} : ${error instanceof Error ? error.message : String(error)}`);
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
