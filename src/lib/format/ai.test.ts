import { describe, expect, it } from 'vitest';
import { AI_NOTICE, AI_REFUSALS, label } from '../ai/contract';
import { AI_BADGE, AI_REFUSAL_TEXT, aiLabelLine, refusalText } from './ai';
import { ALL_LEXICONS, scanOutput } from './lexicon';

describe('rendu français des états d’IA', () => {
  it('couvre les sept motifs, sans en oublier ni en inventer', () => {
    expect(Object.keys(AI_REFUSAL_TEXT).sort()).toEqual([...AI_REFUSALS].sort());
  });

  it('nos propres phrases passent les quatre lexiques proscrits', () => {
    // Le mot « erreur » est interdit par le lexique de l'accusation, et c'est exactement celui
    // qu'on écrit sans y penser pour parler d'un appel qui n'a pas abouti.
    const sentences = [
      ...Object.values(AI_REFUSAL_TEXT),
      AI_NOTICE,
      AI_BADGE,
      refusalText('unanchored', 'deterministic'),
    ];
    expect(scanOutput(sentences, ALL_LEXICONS)).toEqual([]);
  });

  it('un refli déterministe est annoncé, un refus sans repli ne promet rien', () => {
    expect(refusalText('quota', 'deterministic')).toContain('résumé calculé par l’application');
    expect(refusalText('quota', 'none')).toBe(AI_REFUSAL_TEXT.quota);
  });

  it('l’étiquette d’une ligne porte le modèle, le jour, et la mention légale', () => {
    const line = aiLabelLine(label('claude-opus-5', '2026-08-30T09:12:00'));
    expect(line).toContain('claude-opus-5');
    expect(line).toContain('30/08/2026');
    expect(line).toContain(AI_NOTICE);
    expect(line.startsWith('[Texte généré par IA')).toBe(true);
  });
});
