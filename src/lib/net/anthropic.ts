/**
 * Adaptateur Anthropic (P65) — le **seul** chemin réseau des fonctions d'IA, et il vit ici, pas
 * dans `src/lib/ai/`.
 *
 * Ce n'est pas un détail de rangement. `tests/integration/ai-harness.test.ts` lit le TEXTE des
 * fichiers de `src/lib/ai/` et échoue s'il y trouve `fetch(`, `XMLHttpRequest`, `WebSocket` ou
 * `EventSource` : c'est ce qui garantit que le harnais et sa CI ne sortent jamais sur Internet.
 * Poser l'adaptateur dans `src/lib/ai/` ferait sauter ce garde-fou au moment précis où il devient
 * utile. Le harnais garde donc son module d'exécution hors ligne (les cassettes), et le réseau vit
 * dans `src/lib/net/`, derrière le même contrat `ModelAdapter`.
 *
 * ## L'URL est écrite en toutes lettres, une seule fois
 *
 * `src/lib/support/csp.test.ts` (décision n° 57) croise les origines **littérales** du code livré
 * avec la table de `csp.ts` : une URL assemblée (`https://${host}/v1/messages`) lui échapperait, et
 * l'appel serait bloqué en production — en silence, exactement la panne de l'indice Fear & Greed.
 * D'où `ANTHROPIC_ENDPOINT`, en dur, et un test qui exige que ce fichier soit le seul du code
 * livré à écrire cette origine, avec la table qui l'autorise.
 *
 * ## Zéro dépendance
 *
 * `fetch` nu, pas de SDK (décision n° 13 : la chaîne d'approvisionnement reste verrouillée). Le
 * seul en-tête inhabituel est `anthropic-dangerous-direct-browser-access` : sans lui, l'API refuse
 * toute requête venue d'un navigateur. C'est la contrepartie assumée d'une app sans backend — il
 * n'existe aucun proxy où cacher une clé, donc la clé est celle de l'utilisateur, elle vit en
 * mémoire (`src/state/ai-key.svelte.ts`) et elle ne part qu'à cette origine.
 *
 * ## Aucun réessai automatique
 *
 * La facture est celle de l'utilisateur. Un `429` réessayé trois fois, c'est trois appels qu'il
 * n'a pas demandés ; `max_tokens` borne le coût d'un appel, seule l'absence de réessai borne le
 * nombre d'appels. Un échec se rejoue par un clic, jamais tout seul.
 */
import {
  AI_REFUSALS,
  type AiRefusal,
  type ModelAdapter,
  type ModelReply,
  type ModelRequest,
} from '../ai/contract';

/** Destination unique et littérale (voir l'en-tête : la CSP compare des littéraux). */
export const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

/** L'hôte seul, pour les écrans qui doivent NOMMER la destination sans reconstruire l'URL. */
export const ANTHROPIC_HOST = 'api.anthropic.com';

/**
 * Un seul modèle en v1. Pas de choix offert : chaque modèle supplémentaire multiplierait les
 * cassettes du banc d'essai, et un petit modèle qui échoue à l'ancrage produit un refus — sûr,
 * mais sans valeur pour l'utilisateur.
 */
export const ANTHROPIC_MODEL_ID = 'claude-opus-5';

/** Version d'API épinglée : une évolution de format ne doit jamais arriver par surprise. */
export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Plafond de sortie. C'est le SEUL chiffre de coût que l'on puisse annoncer exactement avant
 * l'envoi : au-delà, la réponse est coupée (`stop_reason: 'max_tokens'`), ce que l'on traite comme
 * une sortie vide plutôt que comme un texte à publier.
 */
export const ANTHROPIC_MAX_TOKENS = 1024;

/** Au-delà, on abandonne : un récit qui n'arrive pas en trente secondes n'arrivera pas. */
export const ANTHROPIC_TIMEOUT_MS = 30_000;

/**
 * Tarifs publics du modèle, en dollars par million de jetons, au 30/08/2026. Ils servent à
 * ANNONCER un ordre de grandeur avant l'envoi, jamais à facturer : c'est le compte Anthropic de
 * l'utilisateur qui fait foi. Un tarif qui changerait sans qu'on le voie ne casse rien — il rend
 * l'estimation fausse, ce que l'écran dit déjà en l'annonçant comme un ordre de grandeur.
 */
export const ANTHROPIC_PRICE_USD_PER_MTOK = { input: 5, output: 25 } as const;

/**
 * Charge du bouton « Tester la clé » (livraison 1). Elle ne contient **aucune donnée
 * personnelle** — pas un montant, pas un actif, pas une date — et exerce pourtant toute la chaîne :
 * la CSP du site publié, l'en-tête d'accès navigateur, la version d'API, la clé, et le classement
 * des erreurs. C'est ce qui rend la première livraison utile seule, sans attendre le récit.
 */
export const ANTHROPIC_PROBE: ModelRequest = {
  system: 'Réponds exactement « ok », en minuscules, sans ponctuation ni explication.',
  user: 'test',
};

/**
 * Quatre caractères par jeton : l'approximation courante, volontairement grossière. Compter les
 * jetons exactement demanderait un aller-retour de plus — consenti, facturé — pour chiffrer un
 * appel qui coûte un centime. C'est disproportionné, donc l'entrée est annoncée en **ordre de
 * grandeur**, et l'écran le dit avec ce mot-là.
 */
const CHARS_PER_TOKEN = 4;

export interface CostEstimate {
  /** Jetons d'entrée, en ordre de grandeur (jamais présenté comme un décompte). */
  readonly inputTokens: number;
  /** Plafond de sortie : celui-là est EXACT, c'est `max_tokens`. */
  readonly outputTokens: number;
  /** Dollars, chaîne décimale à quatre décimales. */
  readonly inputUsd: string;
  readonly outputUsd: string;
  readonly totalUsd: string;
}

/**
 * Ce qu'un envoi peut coûter, au pire. La sortie est un plafond exact ; l'entrée est une
 * estimation, et le total est donc un **majorant approché** — on l'annonce comme tel.
 */
export function estimateCost(request: ModelRequest): CostEstimate {
  const chars = request.system.length + request.user.length;
  const inputTokens = Math.ceil(chars / CHARS_PER_TOKEN);
  const usd = (tokens: number, perMTok: number): string =>
    ((tokens * perMTok) / 1_000_000).toFixed(4);
  const inputUsd = usd(inputTokens, ANTHROPIC_PRICE_USD_PER_MTOK.input);
  const outputUsd = usd(ANTHROPIC_MAX_TOKENS, ANTHROPIC_PRICE_USD_PER_MTOK.output);
  return {
    inputTokens,
    outputTokens: ANTHROPIC_MAX_TOKENS,
    inputUsd,
    outputUsd,
    totalUsd: (Number(inputUsd) + Number(outputUsd)).toFixed(4),
  };
}

/**
 * Erreur d'adaptateur portant son motif de refus. `aiRefusal` est lu **en canard** par
 * `src/lib/ai/narrative.ts` : le pipeline n'importe donc rien de `src/lib/net/`, et le harnais
 * reste un module sans réseau, y compris par ses imports.
 */
export class AnthropicFailure extends Error {
  readonly aiRefusal: AiRefusal;
  /** Code HTTP, ou `null` quand l'appel n'a même pas abouti (réseau, CORS, abandon). */
  readonly status: number | null;

  constructor(aiRefusal: AiRefusal, message: string, status: number | null = null) {
    super(message);
    this.name = 'AnthropicFailure';
    this.aiRefusal = aiRefusal;
    this.status = status;
  }
}

/**
 * Classement des réponses de l'API dans les **sept** motifs déjà typés (`AiRefusal`). On n'en crée
 * pas un huitième : un motif de plus, c'est une branche de plus à traiter dans chaque écran, pour
 * une nuance que l'utilisateur ne peut pas exploiter.
 *
 * - `429` → `quota` : le seul cas où réessayer plus tard a un sens.
 * - `401`, `403`, `400`, `404`, `5xx` → `model-error` : clé absente, invalide, sans crédit, requête
 *   refusée, panne du fournisseur. L'utilisateur ne peut rien en faire de différent.
 */
export function refusalForStatus(status: number): AiRefusal {
  if (status === 429) return 'quota';
  return 'model-error';
}

/** Le motif porté par une erreur d'adaptateur, ou `model-error` si elle n'en porte aucun. */
export function refusalOfError(error: unknown): AiRefusal {
  const carried = (error as { aiRefusal?: unknown } | null)?.aiRefusal;
  return AI_REFUSALS.includes(carried as AiRefusal) ? (carried as AiRefusal) : 'model-error';
}

interface AnthropicBlock {
  readonly type?: unknown;
  readonly text?: unknown;
}

/** Concatène les blocs de texte de la réponse ; tout autre bloc (réflexion…) est ignoré. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((block: AnthropicBlock) =>
      block?.type === 'text' && typeof block.text === 'string' ? block.text : '',
    )
    .join('');
}

/**
 * Le corps exact envoyé, construit à part pour que la feuille de consentement puisse en montrer
 * la version réindentée **avant** l'envoi. Ce qui est affiché est donc ce qui part, au caractère
 * près — pas un résumé rassurant écrit à côté.
 *
 * Ce qui n'y figure pas est aussi important : pas de `thinking` (il est adaptatif par défaut sur
 * ce modèle, et le désactiver dégrade la sortie), pas de `budget_tokens` (retiré de l'API sur
 * cette génération, il vaudrait une erreur 400), pas de préremplissage de la réponse (refusé par
 * l'API), pas de streaming (une seule réponse courte).
 */
export function anthropicBody(request: ModelRequest, modelId = ANTHROPIC_MODEL_ID): string {
  return JSON.stringify({
    model: modelId,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    system: request.system,
    messages: [{ role: 'user', content: request.user }],
    output_config: { effort: 'low' },
  });
}

export interface AnthropicOptions {
  readonly modelId?: string;
  readonly timeoutMs?: number;
  /** Injecté par les tests ; en production, le `fetch` du navigateur. */
  readonly fetchImpl?: typeof globalThis.fetch;
}

/**
 * Un `ModelAdapter` qui parle à l'API Anthropic avec la clé de l'utilisateur.
 *
 * La clé n'est pas capturée depuis un état global : elle est passée à la construction, par
 * l'appelant qui vient de la lire en mémoire. Un module qui va chercher lui-même une clé quelque
 * part est un module dont on ne sait plus dire, en le lisant, ce qu'il envoie.
 */
export function anthropicAdapter(apiKey: string, opts: AnthropicOptions = {}): ModelAdapter {
  const modelId = opts.modelId ?? ANTHROPIC_MODEL_ID;
  const timeoutMs = opts.timeoutMs ?? ANTHROPIC_TIMEOUT_MS;
  const call = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return {
    id: modelId,
    async complete(request: ModelRequest): Promise<ModelReply> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await call(ANTHROPIC_ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            // Sans cet en-tête, l'API refuse toute requête émise depuis un navigateur. C'est le
            // seul chemin possible ici : il n'existe aucun serveur derrière cette application.
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: anthropicBody(request, modelId),
          signal: controller.signal,
        });
      } catch (error) {
        // Abandon volontaire (délai dépassé) d'un côté ; échec réseau ou blocage CORS de l'autre.
        // Les deux arrivent ici sous la même forme : c'est le signal qui les distingue.
        throw controller.signal.aborted
          ? new AnthropicFailure('timeout', `Aucune réponse en ${timeoutMs} ms.`)
          : new AnthropicFailure(
              'model-error',
              `Appel impossible : ${error instanceof Error ? error.message : String(error)}`,
            );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new AnthropicFailure(
          refusalForStatus(response.status),
          `L’API a répondu ${response.status}.`,
          response.status,
        );
      }

      let payload: { model?: unknown; stop_reason?: unknown; content?: unknown };
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        throw new AnthropicFailure('model-error', 'Réponse illisible (JSON invalide).');
      }

      // Un refus du modèle n'est pas une sortie à rattraper : c'est le modèle qui n'a rien dit.
      if (payload.stop_reason === 'refusal')
        throw new AnthropicFailure('model-error', 'Le modèle a refusé de répondre.');

      const text = textOf(payload.content);
      // Une réponse coupée n'est pas un texte court : c'est une phrase interrompue, dont rien ne
      // dit qu'elle serait restée juste. On la jette comme une sortie vide.
      if (payload.stop_reason === 'max_tokens')
        throw new AnthropicFailure('empty', `Réponse coupée à ${ANTHROPIC_MAX_TOKENS} jetons.`);
      if (text.trim() === '') throw new AnthropicFailure('empty', 'Réponse vide.');

      return { modelId: typeof payload.model === 'string' ? payload.model : modelId, text };
    },
  };
}
