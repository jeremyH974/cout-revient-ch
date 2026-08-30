/**
 * Le récit narratif : la charge utile, et le pipeline qui décide de publier ou de jeter.
 *
 * Aucun appel réseau ici non plus — les adaptateurs sont des fonctions de trois lignes. Ce qui est
 * éprouvé, c'est l'ORDRE des étapes et le fait qu'un refus jette le texte entier.
 */
import { describe, expect, it } from 'vitest';
import { AnthropicFailure } from '../net/anthropic';
import type { Insight } from '../domain/insights';
import {
  buildNarrativeInput,
  judgeNarrative,
  refusalOfModelError,
  runNarrative,
  type NarrativeInput,
} from './narrative';
import { canonicalJson, type ModelAdapter } from './contract';

const AT = '2026-08-30T09:00:00';
const MODEL = 'modele-de-test';
/** Séparateurs du français : U+202F groupe les milliers, U+00A0 précède € et %. */
const NNBSP = ' ';
const NBSP = ' ';

const INPUT: NarrativeInput = {
  devise: 'EUR',
  periode: { du: '2026-01-01', au: '2026-08-30' },
  totaux: {
    valeur: '24310.75',
    investi: '21000',
    latent: '3310.75',
    realise: '-2310.5',
    total: '1000.25',
  },
  constats: [
    { code: 'fees-12m', tone: 'neutral', values: { amount: '1284.37', rate: '0.0041' } },
    {
      code: 'concentration',
      tone: 'attention',
      values: { assets: ['btc'], share: '0.7213', amount: '18452.9' },
    },
  ],
};

const VALID = `Vos frais atteignent 1${NNBSP}284,37${NBSP}€, soit 0,4${NBSP}% du volume échangé. BTC pèse 72,1${NBSP}% de vos positions. Vos avoirs valent 24${NNBSP}310,75${NBSP}€.`;

const adapterSaying = (text: string): ModelAdapter => ({
  id: MODEL,
  complete: () => Promise.resolve({ modelId: MODEL, text }),
});
const adapterFailing = (error: unknown): ModelAdapter => ({
  id: MODEL,
  complete: () => Promise.reject(error),
});

describe('charge utile', () => {
  it('ne porte que la devise, la période, les totaux et les constats', () => {
    const insights: Insight[] = [
      {
        id: 'realized',
        code: 'realized',
        tone: 'negative',
        priority: 45,
        values: { amount: { kind: 'money', value: '-2310.5' } },
        link: { route: 'report' },
      },
    ];
    const input = buildNarrativeInput({
      devise: 'EUR',
      periode: { du: '2026-01-01', au: '2026-08-30' },
      totaux: INPUT.totaux,
      insights,
    });
    expect(Object.keys(input).sort()).toEqual(['constats', 'devise', 'periode', 'totaux']);
    // Ni identifiant interne, ni lien vers un écran, ni priorité d'affichage : rien qui décrive
    // l'application plutôt que le portefeuille.
    expect(Object.keys(input.constats[0] ?? {}).sort()).toEqual(['code', 'tone', 'values']);
    const json = canonicalJson(input);
    for (const leaked of ['link', 'priority', 'route', 'id'])
      expect(json.includes(`"${leaked}"`), `« ${leaked} » ne doit pas partir`).toBe(false);
  });

  it('aplatit chaque genre de valeur en une feuille ancrable', () => {
    const values: Insight['values'] = {
      amount: { kind: 'money', value: '12.34' },
      share: { kind: 'ratio', value: '0.5' },
      count: { kind: 'count', value: 3 },
      assets: { kind: 'assets', value: ['btc', 'eth'] },
      since: { kind: 'day', value: '2026-01-01' },
      tier: { kind: 'tier', value: 'investisseur' },
      year: { kind: 'year', value: 2026 },
    };
    const input = buildNarrativeInput({
      devise: 'EUR',
      periode: { du: '2026-01-01', au: '2026-08-30' },
      totaux: INPUT.totaux,
      insights: [{ id: 'x', code: 'tax-year', tone: 'neutral', priority: 1, values, link: null }],
    });
    expect(input.constats[0]?.values).toEqual({
      amount: '12.34',
      share: '0.5',
      count: 3,
      assets: ['btc', 'eth'],
      since: '2026-01-01',
      tier: 'investisseur',
      year: 2026,
    });
  });

  it('omet la valeur du portefeuille plutôt que d’envoyer un `null` qui n’apprend rien', () => {
    const input = buildNarrativeInput({
      devise: 'EUR',
      periode: { du: '2026-01-01', au: '2026-08-30' },
      totaux: { investi: '1', latent: '0', realise: '0', total: '0' },
      insights: [],
    });
    expect(canonicalJson(input)).not.toContain('null');
  });
});

describe('pipeline du récit', () => {
  it('publie un texte entièrement ancré, avec son étiquette', () => {
    const outcome = judgeNarrative(VALID, INPUT, MODEL, AT);
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.label.generated).toBe(true);
    expect(outcome.label.modelId).toBe(MODEL);
    expect(outcome.label.at).toBe(AT);
    expect(outcome.audit.unanchored).toEqual([]);
  });

  it('refuse un texte vide ou blanc', () => {
    for (const text of ['', '   \n\t ']) {
      const outcome = judgeNarrative(text, INPUT, MODEL, AT);
      expect(outcome.status === 'refused' && outcome.reason).toBe('empty');
    }
  });

  it('le lexique passe AVANT l’ancrage : une phrase de conseil ancrée reste du conseil', () => {
    // Chaque chiffre de cette phrase est ancré ; c'est le verbe qui la condamne.
    const advice = `BTC pèse 72,1${NBSP}% de vos positions : vous devriez arbitrer.`;
    const outcome = judgeNarrative(advice, INPUT, MODEL, AT);
    expect(outcome.status === 'refused' && outcome.reason).toBe('forbidden-lexicon');
  });

  it('refuse un chiffre inventé, et jette le texte ENTIER', () => {
    const text = `Vos frais atteignent 1${NNBSP}284,37${NBSP}€. Vos avoirs valent 99${NNBSP}999,00${NBSP}€.`;
    const outcome = judgeNarrative(text, INPUT, MODEL, AT);
    expect(outcome.status === 'refused' && outcome.reason).toBe('unanchored');
    // Aucune phrase n'est conservée : il n'existe pas de sortie partielle.
    expect(outcome.status === 'refused' && 'value' in outcome).toBe(false);
  });

  it('refuse un total recomposé, même juste', () => {
    // 1 284,37 + 18 452,90 = 19 737,27 : l'addition est exacte, et c'est justement le problème.
    const text = `Frais et concentration pèsent ensemble 19${NNBSP}737,27${NBSP}€.`;
    const outcome = judgeNarrative(text, INPUT, MODEL, AT);
    expect(outcome.status === 'refused' && outcome.reason).toBe('unanchored');
  });

  it('n’accorde AUCUNE constante de gabarit au modèle', () => {
    // Le seuil légal de 305 € est une dérogation déclarée pour NOTRE rendu déterministe
    // (`format/insights.ts`). Accordée au modèle, elle blanchirait un nombre inventé qui tomberait
    // dessus par hasard.
    const text = `Vos plus-values restent sous le seuil de 305${NBSP}€.`;
    const outcome = judgeNarrative(text, INPUT, MODEL, AT);
    expect(outcome.status === 'refused' && outcome.reason).toBe('unanchored');
  });

  it('les dates et les millésimes ne sont jamais confrontés aux ancres', () => {
    const text = `Du 01/01/2026 au 30/08/2026, vos avoirs valent 24${NNBSP}310,75${NBSP}€.`;
    expect(judgeNarrative(text, INPUT, MODEL, AT).status).toBe('ok');
  });
});

describe('du modèle au verdict', () => {
  it('sans adaptateur — pas de clé, ou consentement refusé — le refus est `no-model`', async () => {
    const outcome = await runNarrative(null, INPUT, AT);
    expect(outcome.status === 'refused' && outcome.reason).toBe('no-model');
    expect(outcome.status === 'refused' && outcome.fallback).toBe('deterministic');
  });

  it('un texte valide traverse tout le pipeline', async () => {
    const outcome = await runNarrative(adapterSaying(VALID), INPUT, AT);
    expect(outcome.status).toBe('ok');
  });

  it('une erreur porteuse de motif le conserve ; une erreur nue devient `model-error`', async () => {
    const carried = await runNarrative(
      adapterFailing(Object.assign(new Error('429'), { aiRefusal: 'quota' })),
      INPUT,
      AT,
    );
    expect(carried.status === 'refused' && carried.reason).toBe('quota');
    const bare = await runNarrative(adapterFailing(new Error('inconnue')), INPUT, AT);
    expect(bare.status === 'refused' && bare.reason).toBe('model-error');
  });

  it('la lecture en canard s’accorde avec l’erreur réellement levée par l’adaptateur réseau', () => {
    // Ce module n'importe jamais `src/lib/net/` (le harnais doit rester sans réseau, jusque dans
    // ses imports) : la frontière est donc du typage canard, et c'est CE test qui la tient.
    expect(refusalOfModelError(new AnthropicFailure('quota', 'plafond', 429))).toBe('quota');
    expect(refusalOfModelError(new AnthropicFailure('timeout', 'délai'))).toBe('timeout');
    expect(refusalOfModelError(new AnthropicFailure('empty', 'vide'))).toBe('empty');
  });
});
