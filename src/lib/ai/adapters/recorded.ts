/**
 * Adaptateur enregistré (P70) : l'exécution hors ligne du banc d'essai.
 *
 * **Il n'existe aucun chemin réseau dans ce module.** Pas de `fetch`, pas de clé, pas de repli
 * silencieux : une cassette absente lève une exception. C'est ce qui garantit que la CI ne sort
 * jamais sur Internet et n'appelle jamais un modèle — une propriété qu'on ne peut pas obtenir en
 * la promettant dans une documentation, seulement en n'écrivant pas le code qui la violerait.
 *
 * La clé est `sha256(system ‖ ' ' ‖ user ‖ ' ' ‖ modelId)` : changer la consigne système, le JSON
 * d'entrée **ou** le modèle produit une autre clé, donc une cassette introuvable — c'est-à-dire un
 * cas « à recapturer », signalé comme tel, jamais un cas silencieusement vert.
 *
 * `@noble/hashes` est déjà une dépendance du projet (dérivation des clés publiques étendues) :
 * P70 n'en ajoute aucune (décision n° 13).
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { ModelAdapter, ModelReply, ModelRequest } from '../contract';

/**
 * Provenance d'une cassette, et il n'en existe que deux.
 *
 * `handwritten` — écrite à la main pour le banc d'essai. `fixture-capture` — capturée depuis un
 * vrai modèle, **sur le jeu de démonstration synthétique uniquement**. Le futur script de capture
 * (livré avec P65) devra faire respecter cette seconde valeur : jamais de capture sur un export
 * réel, même « anonymisé » (décision n° 17).
 */
export type CassetteSource = 'handwritten' | 'fixture-capture';

export const CASSETTE_SOURCES: readonly CassetteSource[] = ['handwritten', 'fixture-capture'];

export interface Cassette {
  /** La clé, recopiée dans le fichier : un test vérifie qu'elle correspond à son nom. */
  readonly hash: string;
  readonly modelId: string;
  /** Jour et heure de capture, `AAAA-MM-JJTHH:mm:ss` — jamais un fuseau. */
  readonly capturedAt: string;
  readonly source: CassetteSource;
  readonly text: string;
}

export class MissingCassette extends Error {
  readonly hash: string;
  readonly modelId: string;

  constructor(hash: string, modelId: string) {
    super(`Cassette absente pour ${modelId} : ${hash}`);
    this.name = 'MissingCassette';
    this.hash = hash;
    this.modelId = modelId;
  }
}

/** `sha256(system ‖ ' ' ‖ user ‖ ' ' ‖ modelId)`, en hexadécimal minuscule. */
export function cassetteKey(request: ModelRequest, modelId: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${request.system} ${request.user} ${modelId}`)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSource(value: unknown): value is CassetteSource {
  return CASSETTE_SOURCES.includes(value as CassetteSource);
}

/**
 * Relit une cassette et **refuse toute provenance inconnue**. Une cassette sans provenance
 * déclarée serait le point exact par lequel une capture sur données réelles entrerait dans le
 * dépôt sans que personne ne le voie.
 */
export function parseCassette(raw: unknown): Cassette {
  if (!isRecord(raw)) throw new Error('Cassette illisible : un objet JSON est attendu');
  const { hash, modelId, capturedAt, source, text } = raw;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash))
    throw new Error('Cassette illisible : `hash` doit être un sha256 hexadécimal');
  if (typeof modelId !== 'string' || modelId === '')
    throw new Error(`Cassette ${hash} : \`modelId\` manquant`);
  if (typeof capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(capturedAt))
    throw new Error(`Cassette ${hash} : \`capturedAt\` doit être une date naïve`);
  if (!isSource(source))
    throw new Error(
      `Cassette ${hash} : provenance « ${String(source)} » inconnue — ` +
        `seules ${CASSETTE_SOURCES.join(' et ')} sont admises`,
    );
  if (typeof text !== 'string' || text.trim() === '')
    throw new Error(`Cassette ${hash} : \`text\` vide`);
  return { hash, modelId, capturedAt, source, text };
}

/**
 * Un modèle rejoué depuis des cassettes. `cassettes` est indexé par clé : le chargement des
 * fichiers appartient à l'appelant (Node en test), pas à ce module, qui reste utilisable dans un
 * navigateur et dans le serveur MCP.
 */
export function recordedAdapter(
  modelId: string,
  cassettes: ReadonlyMap<string, Cassette>,
): ModelAdapter {
  return {
    id: modelId,
    complete(request: ModelRequest): Promise<ModelReply> {
      const hash = cassetteKey(request, modelId);
      const cassette = cassettes.get(hash);
      if (cassette === undefined) return Promise.reject(new MissingCassette(hash, modelId));
      return Promise.resolve({ modelId: cassette.modelId, text: cassette.text });
    },
  };
}
