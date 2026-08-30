import { describe, expect, it } from 'vitest';
import {
  ALL_LEXICONS,
  DOMAIN_LEXICONS,
  missingAllowed,
  scanOutput,
  scanSource,
  type LexiconDomain,
} from './lexicon';

const DOMAINS: readonly LexiconDomain[] = ['accusation', 'advice', 'guarantee', 'ranking'];

describe('les quatre lexiques', () => {
  it('existent tous, non vides, et se réunissent sans perte', () => {
    for (const domain of DOMAINS) expect(DOMAIN_LEXICONS[domain].length, domain).toBeGreaterThan(0);
    const total = DOMAINS.reduce((n, domain) => n + DOMAIN_LEXICONS[domain].length, 0);
    expect(ALL_LEXICONS).toHaveLength(total);
  });

  it('donne à chaque règle une raison lisible : le message d’échec doit expliquer', () => {
    for (const rule of ALL_LEXICONS)
      expect(rule.why.length, String(rule.pattern)).toBeGreaterThan(8);
  });

  it('couvre le vocabulaire du conseil que la doctrine AMF rend réglementé', () => {
    const advice = [
      'vous devriez alléger votre position',
      'vous pourriez y revenir',
      'achetez pendant la baisse',
      'il serait temps de vendre',
      'à arbitrer sans tarder',
      'nous recommandons de patienter',
      'il faut vendre maintenant',
    ];
    for (const sentence of advice) {
      expect(scanOutput([sentence], DOMAIN_LEXICONS.advice), sentence).not.toEqual([]);
    }
  });

  it('laisse passer une phrase qui CONSTATE, y compris sur des ventes déjà faites', () => {
    const facts = [
      'Depuis le début, vos ventes ont dégagé 2 310,50 € de plus-values réalisées.',
      'BTC représente 72,1 % de la valeur de vos positions.',
      'Sur 3 positions, vos ventes ont déjà rendu la mise de départ.',
    ];
    expect(scanOutput(facts, ALL_LEXICONS)).toEqual([]);
  });
});

describe('scanSource — le fichier lu comme du texte', () => {
  const source = ['ligne neutre', 'un commentaire qui parle d’erreur', 'fin'].join('\n');

  it('signale la ligne fautive, commentaire compris', () => {
    const hits = scanSource(source, DOMAIN_LEXICONS.accusation);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(2);
    expect(hits[0]?.text).toContain('erreur');
    expect(hits[0]?.why.length).toBeGreaterThan(0);
  });

  it('retire l’exception MOT POUR MOT, sans affaiblir le motif ailleurs', () => {
    const allowed = ['un commentaire qui parle d’erreur'];
    expect(scanSource(source, DOMAIN_LEXICONS.accusation, allowed)).toEqual([]);
    expect(
      scanSource(`${source}\nune autre erreur`, DOMAIN_LEXICONS.accusation, allowed),
    ).toHaveLength(1);
  });

  it('signale une exception qui n’est plus dans le fichier', () => {
    expect(missingAllowed(source, ['un commentaire qui parle d’erreur'])).toEqual([]);
    expect(missingAllowed(source, ['phrase disparue'])).toEqual(['phrase disparue']);
  });
});

describe('scanOutput — les phrases affichées n’ont pas d’excuse', () => {
  it('numérote les phrases et n’admet aucune exception', () => {
    const hits = scanOutput(['tout va bien', 'nous recommandons de vendre'], ALL_LEXICONS);
    expect(hits.map((h) => h.line)).toEqual([2, 2]);
  });

  it('ignore les lignes vides', () => {
    expect(scanOutput(['', '   '], ALL_LEXICONS)).toEqual([]);
  });
});
