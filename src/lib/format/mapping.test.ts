import { describe, expect, it } from 'vitest';
import { TARGET_FIELDS } from '../import/mapping/schema';
import { MATCH_RULES } from '../import/mapping/score';
import { VALUE_SHAPES } from '../import/mapping/shape';
import { ALL_LEXICONS, scanOutput } from './lexicon';
import {
  CHECK_LABELS,
  RULE_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  TARGET_LABELS,
  UNSUPPORTED_LABELS,
  checkReason,
  confidenceLabel,
  confidencePercent,
} from './mapping';

/** Toutes les phrases que ce module peut mettre à l'écran, en un seul endroit. */
const ALL_PHRASES: string[] = [
  ...Object.values(TARGET_LABELS),
  ...Object.values(SOURCE_LABELS),
  ...Object.values(RULE_LABELS),
  ...Object.values(CHECK_LABELS),
  ...Object.values(STATUS_LABELS),
  ...Object.values(UNSUPPORTED_LABELS),
  ...[
    'missing-date-or-pair',
    'rows-kept=0.50<0.9',
    'issues=0.50>0.1',
    'dates-read=0.10<0.99',
    'amounts-read=0.90<1',
    'currencies-known=0.10<0.95',
    'invariant-off=btc',
    'blocked=btc,eth',
    'unqualified=0.90>0.05',
    'balance-off=3/10',
    'no-balance-column',
    'balance-ambiguous',
    'code-inconnu',
  ].map(checkReason),
  confidenceLabel(1),
  confidenceLabel(0.6),
  confidenceLabel(0.1),
];

describe('le français de l’appariement', () => {
  it('nomme chacun des douze champs cibles', () => {
    for (const field of TARGET_FIELDS) {
      expect(TARGET_LABELS[field], field).toBeTruthy();
    }
    expect(new Set(Object.values(TARGET_LABELS)).size).toBe(TARGET_FIELDS.length);
  });

  it('nomme chacune des règles d’appariement, la proposition du modèle comprise', () => {
    for (const rule of [...MATCH_RULES, 'model' as const]) {
      expect(RULE_LABELS[rule], rule).toBeTruthy();
    }
  });

  it('dit la confiance en toutes lettres, et le pourcentage EN PLUS — jamais à sa place', () => {
    expect(confidenceLabel(0.95)).toBe('confiance élevée');
    expect(confidenceLabel(0.6)).toBe('à confirmer');
    expect(confidenceLabel(0.2)).toBe('non apparié');
    expect(confidencePercent(0.9)).toBe('90 %');
  });

  it('ne dit JAMAIS « vérifié » d’un contrôle non applicable', () => {
    expect(STATUS_LABELS['not-applicable']).toBe('non applicable');
    expect(STATUS_LABELS['not-applicable']).not.toBe(STATUS_LABELS.pass);
  });

  it('explique un refus par une phrase, quel que soit le code — jamais un code nu', () => {
    for (const code of ['blocked=btc', 'rows-kept=0.1<0.9', 'un-code-que-personne-n-a-prevu']) {
      const phrase = checkReason(code);
      expect(phrase.length, code).toBeGreaterThan(30);
      expect(phrase, code).not.toContain('=');
    }
  });

  it('nomme la forme non prise en charge plutôt que d’échouer génériquement', () => {
    const phrase = UNSUPPORTED_LABELS['signed-single-leg'];
    expect(phrase).toContain('signe');
    expect(phrase).toContain('pas encore prise en charge');
    // Elle dit aussi QUOI FAIRE : une impasse sans issue n'est pas une explication.
    expect(phrase).toContain('Koinly');
  });

  it('passe les quatre lexiques proscrits, phrase par phrase', () => {
    // Comme `format/ai.ts` : « erreur » est interdit, et c'est le mot qu'on écrit sans y penser
    // pour parler d'un appariement refusé. Un appariement refusé n'est pas une panne.
    const hits = scanOutput(ALL_PHRASES, ALL_LEXICONS);
    expect(hits.map((h) => `${h.why} — ${h.text}`)).toEqual([]);
  });

  it('couvre toutes les formes de valeur déclarées par un libellé de champ compatible', () => {
    // Garde-fou d'exhaustivité : ajouter une forme sans la relier à un champ se verrait ici.
    expect(new Set(VALUE_SHAPES).size).toBe(VALUE_SHAPES.length);
  });
});
