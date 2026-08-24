/**
 * Exécutions en direct (P26, deuxième moitié) : abonnements `userFills` et `userFundings` par
 * compte, sur le transport partagé (`lib/live/socket.ts`).
 *
 * Contrat vérifié en direct le 24/08/2026 (adresse publique du vault HLP, aucune donnée
 * utilisateur) :
 * ```
 * → {"method":"subscribe","subscription":{"type":"userFills","user":"0x…"}}
 * ← {"channel":"subscriptionResponse","data":{"subscription":{…,"aggregateByTime":false}}}
 * ← {"channel":"userFills","data":{"isSnapshot":true,"user":"0x…","fills":[…]}}
 * ← {"channel":"userFills","data":{"user":"0x…","fills":[…]}}     ← pousses, sans isSnapshot
 * ```
 * `aggregateByTime` est laissé à sa valeur par défaut (faux) : agréger fusionnerait des exécutions
 * et détruirait les `tid`, seul identifiant unique — et donc la seule clé de dédoublonnage fiable
 * (fait établi de P20, décision n° 22).
 *
 * Deux règles tiennent ce module :
 * - le **snapshot d'ouverture n'est pas un cas particulier** : il rejoue l'historique récent et
 *   passe par le même dédoublonnage que les pousses ;
 * - l'ingestion est **strictement additive** et ne touche jamais aux curseurs de la synchronisation
 *   REST — un fill reçu en direct ne doit pas faire sauter une fenêtre au prochain import.
 */
import { normalizeAddress, parseFills, parseFunding } from './api-types';
import { fundingKey, type HlAccountData } from './data';
import type { HlFill, HlFunding } from './api-types';

/** Abonnements à (re)poser pour un ensemble de comptes. */
export function liveFillSubscriptions(addresses: readonly string[]): unknown[] {
  const subscriptions: unknown[] = [];
  for (const raw of addresses) {
    const user = normalizeAddress(raw);
    if (user === null) continue;
    subscriptions.push({ type: 'userFills', user });
    subscriptions.push({ type: 'userFundings', user });
  }
  return subscriptions;
}

export interface LiveEnvelope {
  /** Adresse concernée, normalisée en minuscules ; `null` si la charge est inexploitable. */
  user: string | null;
  fills: HlFill[];
  fundings: HlFunding[];
  isSnapshot: boolean;
}

/** Lit une charge `userFills` ou `userFundings` sans jamais faire confiance à sa forme. */
export function readLiveEnvelope(channel: string, data: unknown): LiveEnvelope | null {
  if (channel !== 'userFills' && channel !== 'userFundings') return null;
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const user = typeof record['user'] === 'string' ? normalizeAddress(record['user']) : null;
  return {
    user,
    fills: channel === 'userFills' ? parseFills(record['fills']) : [],
    fundings: channel === 'userFundings' ? parseFunding(record['fundings']) : [],
    isSnapshot: record['isSnapshot'] === true,
  };
}

export interface MergeResult {
  data: HlAccountData;
  /** Éléments réellement nouveaux (0 = rien à persister ni à recalculer). */
  added: number;
}

/**
 * Fusionne une enveloppe dans les bruts d'un compte. Dédoublonnage par `tid` pour les fills et par
 * `fundingKey` pour le funding ; les curseurs et l'instantané restent intacts.
 */
export function mergeLiveEnvelope(data: HlAccountData, envelope: LiveEnvelope): MergeResult {
  let added = 0;
  let fills = data.fills;
  for (const fill of envelope.fills) {
    if (fills[fill.tid] !== undefined) continue;
    if (fills === data.fills) fills = { ...data.fills };
    fills[fill.tid] = fill;
    added++;
  }
  let funding = data.funding;
  for (const entry of envelope.fundings) {
    const key = fundingKey(entry);
    if (funding[key] !== undefined) continue;
    if (funding === data.funding) funding = { ...data.funding };
    funding[key] = entry;
    added++;
  }
  return added === 0 ? { data, added: 0 } : { data: { ...data, fills, funding }, added };
}
