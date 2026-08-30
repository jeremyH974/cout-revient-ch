/**
 * L'adaptateur réseau, éprouvé **sans réseau** : `fetchImpl` est injecté, et aucun test de ce
 * dépôt n'appelle jamais l'API réelle (la CI ne sort pas sur Internet — décision n° 68).
 *
 * Ce qui est vérifié ici et nulle part ailleurs : la destination littérale, les quatre en-têtes,
 * la forme exacte du corps — y compris ce qui n'y figure PAS —, et le classement de chaque échec
 * dans l'un des sept motifs déjà typés.
 */
import { describe, expect, it, vi } from 'vitest';
import { AI_REFUSALS, type AiRefusal, type ModelRequest } from '../ai/contract';
import {
  ANTHROPIC_ENDPOINT,
  ANTHROPIC_MAX_TOKENS,
  ANTHROPIC_MODEL_ID,
  ANTHROPIC_PROBE,
  ANTHROPIC_VERSION,
  AnthropicFailure,
  anthropicAdapter,
  anthropicBody,
  estimateCost,
  refusalForStatus,
  refusalOfError,
} from './anthropic';

const REQUEST: ModelRequest = { system: 'consigne', user: '{"devise":"EUR"}' };

/** Une réponse OK minimale, à la forme réelle de l'API. */
function reply(text: string, stop = 'end_turn'): Response {
  return new Response(
    JSON.stringify({
      model: ANTHROPIC_MODEL_ID,
      stop_reason: stop,
      content: [{ type: 'text', text }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** Le motif porté par une promesse rejetée, quel que soit le type de l'erreur. */
async function refusalOf(promise: Promise<unknown>): Promise<AiRefusal> {
  try {
    await promise;
  } catch (error) {
    return refusalOfError(error);
  }
  throw new Error('la promesse aurait dû être rejetée');
}

describe('adaptateur Anthropic — la requête', () => {
  it('poste à l’URL littérale, avec les quatre en-têtes, dont l’accès navigateur', async () => {
    const call = vi.fn(async () => reply('Bonjour.'));
    await anthropicAdapter('cle-de-test', { fetchImpl: call as unknown as typeof fetch }).complete(
      REQUEST,
    );
    expect(call).toHaveBeenCalledTimes(1);
    const [url, init] = call.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ANTHROPIC_ENDPOINT);
    expect(url.startsWith('https://api.anthropic.com/')).toBe(true);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('cle-de-test');
    expect(headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(headers['content-type']).toBe('application/json');
    // Sans cet en-tête, l'API refuse toute requête émise depuis un navigateur : c'est le seul
    // chemin possible pour une application sans backend.
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('borne le coût par `max_tokens`, demande un effort faible, et n’envoie rien d’autre', () => {
    const body = JSON.parse(anthropicBody(REQUEST)) as Record<string, unknown>;
    expect(body['model']).toBe(ANTHROPIC_MODEL_ID);
    expect(body['max_tokens']).toBe(ANTHROPIC_MAX_TOKENS);
    expect(body['output_config']).toEqual({ effort: 'low' });
    expect(body['system']).toBe(REQUEST.system);
    expect(body['messages']).toEqual([{ role: 'user', content: REQUEST.user }]);
    // Ce qui n'y est PAS, et qui doit le rester : `budget_tokens` vaudrait une erreur 400 sur
    // cette génération de modèles, `thinking: disabled` dégraderait la sortie, un préremplissage
    // de la réponse est refusé par l'API, et le streaming n'a aucun intérêt pour un texte court.
    expect(Object.keys(body).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'output_config',
      'system',
    ]);
    expect(anthropicBody(REQUEST)).not.toContain('budget_tokens');
    expect(anthropicBody(REQUEST)).not.toContain('stream');
    expect(JSON.stringify(body['messages'])).not.toContain('"assistant"');
  });

  it('la charge du bouton « Tester la clé » ne porte aucune donnée personnelle', () => {
    const text = `${ANTHROPIC_PROBE.system} ${ANTHROPIC_PROBE.user}`;
    // Ni montant, ni ticker, ni date : de quoi exercer la chaîne, rien de plus.
    expect(/\d/.test(text)).toBe(false);
    expect(text.length).toBeLessThan(200);
  });
});

describe('adaptateur Anthropic — la réponse', () => {
  it('rend le texte des blocs `text`, et le modèle annoncé par l’API', async () => {
    const call = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          model: 'claude-opus-5',
          stop_reason: 'end_turn',
          content: [
            { type: 'thinking', thinking: '' },
            { type: 'text', text: 'Deux ' },
            { type: 'text', text: 'phrases.' },
          ],
        }),
        { status: 200 },
      );
    const out = await anthropicAdapter('k', {
      fetchImpl: call as unknown as typeof fetch,
    }).complete(REQUEST);
    expect(out.text).toBe('Deux phrases.');
    expect(out.modelId).toBe('claude-opus-5');
  });
});

describe('adaptateur Anthropic — les sept motifs, et pas un huitième', () => {
  const adapterFor = (fetchImpl: unknown, timeoutMs?: number) =>
    anthropicAdapter('k', {
      fetchImpl: fetchImpl as typeof fetch,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });

  it('429 → quota (le seul cas où réessayer plus tard a un sens)', async () => {
    const call = async (): Promise<Response> => new Response('{}', { status: 429 });
    expect(await refusalOf(adapterFor(call).complete(REQUEST))).toBe('quota');
  });

  it('401, 403, 400, 404 et 5xx → model-error', async () => {
    for (const status of [400, 401, 403, 404, 500, 503]) {
      const call = async (): Promise<Response> => new Response('{}', { status });
      expect(await refusalOf(adapterFor(call).complete(REQUEST)), String(status)).toBe(
        'model-error',
      );
    }
  });

  it('échec réseau ou blocage CORS → model-error', async () => {
    const call = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    };
    expect(await refusalOf(adapterFor(call).complete(REQUEST))).toBe('model-error');
  });

  it('abandon au bout du délai → timeout', async () => {
    const call = (_url: string, init: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('abandon')));
      });
    expect(await refusalOf(adapterFor(call, 5).complete(REQUEST))).toBe('timeout');
  });

  it('refus du modèle (`stop_reason: refusal`) → model-error', async () => {
    const call = async (): Promise<Response> => reply('', 'refusal');
    expect(await refusalOf(adapterFor(call).complete(REQUEST))).toBe('model-error');
  });

  it('réponse coupée (`stop_reason: max_tokens`) → empty : une phrase interrompue n’est pas un texte', async () => {
    const call = async (): Promise<Response> => reply('Votre année a commencé par', 'max_tokens');
    expect(await refusalOf(adapterFor(call).complete(REQUEST))).toBe('empty');
  });

  it('texte vide ou blanc → empty', async () => {
    for (const text of ['', '   \n  ']) {
      const call = async (): Promise<Response> => reply(text);
      expect(await refusalOf(adapterFor(call).complete(REQUEST))).toBe('empty');
    }
  });

  it('JSON illisible → model-error', async () => {
    const call = async (): Promise<Response> => new Response('pas du json', { status: 200 });
    expect(await refusalOf(adapterFor(call).complete(REQUEST))).toBe('model-error');
  });

  it('aucun réessai automatique : la facture est celle de l’utilisateur', async () => {
    const call = vi.fn(async () => new Response('{}', { status: 500 }));
    await expect(
      adapterFor(call as unknown as typeof fetch).complete(REQUEST),
    ).rejects.toBeInstanceOf(AnthropicFailure);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('tous les motifs produits appartiennent à la liste déjà typée', () => {
    for (const status of [400, 401, 403, 404, 429, 500])
      expect(AI_REFUSALS).toContain(refusalForStatus(status));
    expect(refusalOfError(new Error('inconnue'))).toBe('model-error');
    expect(refusalOfError({ aiRefusal: 'pas-un-motif' })).toBe('model-error');
    expect(refusalOfError({ aiRefusal: 'quota' })).toBe('quota');
  });
});

describe('coût annoncé', () => {
  it('la sortie est un plafond exact, l’entrée un ordre de grandeur', () => {
    const cost = estimateCost({ system: 'x'.repeat(400), user: 'y'.repeat(400) });
    expect(cost.outputTokens).toBe(ANTHROPIC_MAX_TOKENS);
    // 1024 jetons à 25 $ / M = 0,0256 $.
    expect(cost.outputUsd).toBe('0.0256');
    expect(cost.inputTokens).toBe(200);
    expect(cost.inputUsd).toBe('0.0010');
    expect(cost.totalUsd).toBe('0.0266');
  });
});
