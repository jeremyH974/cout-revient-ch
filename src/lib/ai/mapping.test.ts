import { describe, expect, it } from 'vitest';
import { TYPE_TARGETS } from '../import/mapping/labels';
import type { ColumnMappingInput } from '../import/mapping/payload';
import { TARGET_SCHEMA } from '../import/mapping/schema';
import { TASK_FALLBACK, systemPrompt, type ModelAdapter } from './contract';
import { judgeMapping, parseMappingReply, runMapping } from './mapping';

const NOW = '2026-08-30T09:00:00';

const INPUT: ColumnMappingInput = {
  colonnes: [
    { i: 0, entete: 'Horodatage', forme: 'iso-datetime' },
    { i: 1, entete: 'Opération', forme: 'enum-small', distincts: 3 },
    { i: 2, entete: 'Quantité vendue', forme: 'decimal-comma' },
    { i: 3, entete: 'Devise vendue', forme: 'asset-code', distincts: 3 },
  ],
  typesDistincts: ['récompense', 'achat'],
  cible: TARGET_SCHEMA.map((spec) => ({ champ: spec.field, role: spec.role })),
};

const ok = JSON.stringify({
  colonnes: [
    { i: 0, champ: 'date', confiance: 0.95 },
    { i: 2, champ: 'sentAmount', confiance: 0.9 },
  ],
  types: [{ libelle: 'récompense', cible: 'reward' }],
});

const parse = (text: string) => parseMappingReply(text, INPUT, TYPE_TARGETS);
const accepts = (): null => null;

describe('contrôle 0 : la conformité du JSON EST l’ancrage de cette tâche', () => {
  it('accepte une réponse conforme', () => {
    const parsed = parse(ok);
    expect(parsed?.colonnes).toHaveLength(2);
    expect(parsed?.types).toEqual([{ libelle: 'récompense', cible: 'reward' }]);
  });

  it('refuse tout ce qui n’est pas un objet JSON nu', () => {
    for (const text of [
      'Voici mon appariement : ' + ok,
      '```json\n' + ok + '\n```',
      ok + '\n\nJ’espère que cela convient.',
      '[]',
      'null',
      '{ pas du json }',
    ]) {
      expect(parse(text), text.slice(0, 24)).toBeNull();
    }
  });

  it('refuse une clé non déclarée, à quelque niveau que ce soit', () => {
    expect(parse(JSON.stringify({ colonnes: [], types: [], remarque: 'bonjour' }))).toBeNull();
    expect(
      parse(JSON.stringify({ colonnes: [{ i: 0, champ: 'date', confiance: 1, note: 'x' }] })),
    ).toBeNull();
    expect(
      parse(
        JSON.stringify({
          colonnes: [],
          types: [{ libelle: 'achat', cible: 'reward', pourquoi: 'x' }],
        }),
      ),
    ).toBeNull();
  });

  it('refuse un index hors des colonnes fournies', () => {
    expect(parse(JSON.stringify({ colonnes: [{ i: 9, champ: 'date', confiance: 1 }] }))).toBeNull();
    expect(
      parse(JSON.stringify({ colonnes: [{ i: -1, champ: 'date', confiance: 1 }] })),
    ).toBeNull();
    expect(
      parse(JSON.stringify({ colonnes: [{ i: 1.5, champ: 'date', confiance: 1 }] })),
    ).toBeNull();
  });

  it('refuse un nom de champ inventé', () => {
    expect(
      parse(JSON.stringify({ colonnes: [{ i: 0, champ: 'dateDeValeur', confiance: 1 }] })),
    ).toBeNull();
  });

  it('refuse un champ ou une colonne affectés deux fois', () => {
    expect(
      parse(
        JSON.stringify({
          colonnes: [
            { i: 0, champ: 'date', confiance: 1 },
            { i: 2, champ: 'date', confiance: 1 },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        JSON.stringify({
          colonnes: [
            { i: 0, champ: 'date', confiance: 1 },
            { i: 0, champ: 'sentAmount', confiance: 1 },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('refuse un libellé qui n’a pas été envoyé, même reformulé', () => {
    // « recompense » sans accent n'est PAS « récompense » : recopié caractère pour caractère.
    expect(
      parse(JSON.stringify({ colonnes: [], types: [{ libelle: 'recompense', cible: 'reward' }] })),
    ).toBeNull();
    expect(
      parse(JSON.stringify({ colonnes: [], types: [{ libelle: 'virement', cible: 'reward' }] })),
    ).toBeNull();
  });

  it('refuse une étiquette cible que le moteur ne connaît pas', () => {
    expect(
      parse(JSON.stringify({ colonnes: [], types: [{ libelle: 'achat', cible: 'super-reward' }] })),
    ).toBeNull();
  });

  it('refuse une confiance hors de [0, 1] ou absente', () => {
    expect(parse(JSON.stringify({ colonnes: [{ i: 0, champ: 'date', confiance: 2 }] }))).toBeNull();
    expect(parse(JSON.stringify({ colonnes: [{ i: 0, champ: 'date' }] }))).toBeNull();
  });
});

describe('le pipeline, et son repli', () => {
  it('accepte une réponse conforme que le vérificateur accepte, et l’étiquette', () => {
    const outcome = judgeMapping(ok, INPUT, TYPE_TARGETS, 'essai', NOW, accepts);
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.label.generated).toBe(true);
      expect(outcome.label.modelId).toBe('essai');
      expect(outcome.audit.unanchored).toEqual([]);
    }
  });

  it('refuse `unanchored` sur un jeton inventé — le MÊME motif, pas un huitième', () => {
    const outcome = judgeMapping(
      JSON.stringify({ colonnes: [{ i: 99, champ: 'date', confiance: 1 }] }),
      INPUT,
      TYPE_TARGETS,
      'essai',
      NOW,
      accepts,
    );
    expect(outcome).toEqual({
      status: 'refused',
      reason: 'unanchored',
      fallback: 'deterministic',
    });
  });

  it('refuse `unanchored` quand le vérificateur mord, JSON parfaitement conforme compris', () => {
    const outcome = judgeMapping(ok, INPUT, TYPE_TARGETS, 'essai', NOW, () => 'blocked=btc');
    expect(outcome.status).toBe('refused');
    if (outcome.status === 'refused') expect(outcome.reason).toBe('unanchored');
  });

  it('refuse `empty` sur une réponse blanche', () => {
    const outcome = judgeMapping('   ', INPUT, TYPE_TARGETS, 'essai', NOW, accepts);
    expect(outcome.status).toBe('refused');
    if (outcome.status === 'refused') expect(outcome.reason).toBe('empty');
  });

  it('retombe sur `no-model` sans adaptateur, avec le repli déterministe', async () => {
    const outcome = await runMapping(null, INPUT, TYPE_TARGETS, NOW, accepts);
    expect(outcome).toEqual({ status: 'refused', reason: 'no-model', fallback: 'deterministic' });
    expect(TASK_FALLBACK['column-mapping']).toBe('deterministic');
  });

  it('lit le motif porté par l’erreur de l’adaptateur, comme le récit', async () => {
    const failing: ModelAdapter = {
      id: 'essai',
      complete: () =>
        Promise.reject(Object.assign(new Error('plafond'), { aiRefusal: 'quota' as const })),
    };
    const outcome = await runMapping(failing, INPUT, TYPE_TARGETS, NOW, accepts);
    expect(outcome.status).toBe('refused');
    if (outcome.status === 'refused') expect(outcome.reason).toBe('quota');
  });
});

describe('la consigne système', () => {
  it('dit au modèle qu’il ne voit aucune cellule, et ne lui laisse pas la possibilité d’en demander', () => {
    const prompt = systemPrompt('column-mapping');
    expect(prompt).toContain('Tu ne vois');
    expect(prompt).toContain('aucune valeur de cellule');
    expect(prompt).toContain('CARACTÈRE POUR');
    expect(prompt).toContain('Tu ne calcules rien');
  });

  it('n’est pas celle du récit : deux tâches, deux consignes', () => {
    expect(systemPrompt('column-mapping')).not.toBe(systemPrompt('narrative'));
  });
});
