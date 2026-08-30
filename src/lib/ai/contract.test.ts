import { describe, expect, it } from 'vitest';
import { auditText } from './anchor';
import {
  AI_NOTICE,
  AI_REFUSALS,
  TASK_FALLBACK,
  accept,
  buildRequest,
  canonicalJson,
  label,
  refusalOrigin,
  refuse,
  systemPrompt,
  type AiRefusal,
} from './contract';

const CLEAN = auditText('Frais de 12,00 €.', { a: '12' });
const DIRTY = auditText('Frais de 99,00 €.', { a: '12' });

describe('les motifs de refus', () => {
  it('les énumère tous — en ajouter un sans le déclarer ne compile pas', () => {
    const covered: Record<AiRefusal, true> = {
      'no-model': true,
      'model-error': true,
      unanchored: true,
      'forbidden-lexicon': true,
      empty: true,
      quota: true,
      timeout: true,
    };
    expect([...AI_REFUSALS].sort()).toEqual(Object.keys(covered).sort());
  });

  it('classe chaque motif : le modèle n’a rien dit, ou nous avons rejeté ce qu’il a dit', () => {
    for (const reason of AI_REFUSALS) {
      expect(['model-unavailable', 'output-rejected'], reason).toContain(refusalOrigin(reason));
    }
    expect(refusalOrigin('no-model')).toBe('model-unavailable');
    expect(refusalOrigin('unanchored')).toBe('output-rejected');
  });

  it('rend le repli de la TÂCHE, pas celui du motif', () => {
    expect(TASK_FALLBACK.narrative).toBe('deterministic');
    for (const reason of AI_REFUSALS) {
      const outcome = refuse<string>('narrative', reason);
      expect(outcome.status).toBe('refused');
      if (outcome.status === 'refused') {
        expect(outcome.reason).toBe(reason);
        expect(outcome.fallback).toBe('deterministic');
      }
    }
  });
});

describe('accept — l’invariant tenu par construction', () => {
  it('accepte une sortie ancrée, avec son étiquette', () => {
    const outcome = accept('narrative', 'texte', label('essai', '2026-08-30T09:00:00'), CLEAN);
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.label.generated).toBe(true);
      expect(outcome.label.notice).toBe(AI_NOTICE);
      expect(outcome.audit.unanchored).toEqual([]);
    }
  });

  it('JETTE la sortie entière dès qu’un seul nombre n’est pas ancré', () => {
    // Jamais un texte partiel : afficher les phrases valides d'un texte rejeté publierait un
    // résumé que personne n'a écrit.
    const outcome = accept('narrative', 'texte', label('essai', '2026-08-30T09:00:00'), DIRTY);
    expect(outcome).toEqual({ status: 'refused', reason: 'unanchored', fallback: 'deterministic' });
  });

  it('un succès porte toujours une étiquette et un audit vide', () => {
    for (const audit of [CLEAN, DIRTY]) {
      const outcome = accept('narrative', 1, label('essai', '2026-08-30T09:00:00'), audit);
      if (outcome.status === 'ok') {
        expect(outcome.label).toBeDefined();
        expect(outcome.audit.unanchored).toHaveLength(0);
      }
    }
  });
});

describe('la requête est déterministe', () => {
  it('trie les clés : le même JSON produit toujours le même texte', () => {
    expect(canonicalJson({ b: 1, a: [2, '3'] })).toBe('{"a":[2,"3"],"b":1}');
    expect(canonicalJson({ a: [2, '3'], b: 1 })).toBe(canonicalJson({ b: 1, a: [2, '3'] }));
  });

  it('ignore les propriétés absentes plutôt que d’écrire « undefined »', () => {
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });

  it('porte une consigne qui interdit le calcul et la recommandation', () => {
    const request = buildRequest('narrative', { a: '1' });
    expect(request.system).toBe(systemPrompt('narrative'));
    expect(request.system).toContain('Tu ne calcules rien');
    expect(request.user).toBe('{"a":"1"}');
  });
});
