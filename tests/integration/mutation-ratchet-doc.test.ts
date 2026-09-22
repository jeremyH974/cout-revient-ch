/**
 * Le cliquet de mutation, tel que la documentation le cite.
 *
 * `thresholds.break` de `stryker.config.json` est la seule source de vérité ; trois textes la
 * recopient : `CLAUDE.md`, que chaque session lit avant d'agir, `docs/tests-de-mutation.md`, et le
 * commentaire de la configuration elle-même. Le 20/09/2026, le cliquet est passé de 94 à 96
 * (décision n° 173) sans que les deux premiers suivent : pendant deux jours, la consigne lue par
 * chaque session annonçait un plancher que Stryker n'appliquait plus. Rien ne l'a signalé — la
 * mutation tourne hors CI, et un document ne rougit pas tout seul.
 *
 * Même patron que `architecture-doc.test.ts` : lire la source de vérité, scanner l'autre côté, et
 * échouer en disant quoi corriger. Les SCORES ne sont pas gardés : sans relancer Stryker, ils n'ont
 * aucune source à l'exécution, et un test qui prétendrait les tenir donnerait l'illusion d'une
 * garde. Les décisions non plus : elles citent le cliquet de leur jour, et c'est leur rôle.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface StrykerConfig {
  _comment: string;
  thresholds: { break: number };
}

const config = JSON.parse(readFileSync('stryker.config.json', 'utf8')) as StrykerConfig;
const ratchet = config.thresholds.break;

/** Chaque texte qui cite le cliquet, et la forme sous laquelle il le cite. */
const CITATIONS = [
  {
    source: 'CLAUDE.md',
    text: readFileSync('CLAUDE.md', 'utf8'),
    pattern: /`break: (\d+)`/g,
  },
  {
    source: 'docs/tests-de-mutation.md',
    text: readFileSync('docs/tests-de-mutation.md', 'utf8'),
    pattern: /`thresholds\.break` vaut \*\*(\d+)\*\*/g,
  },
  {
    source: 'le commentaire de stryker.config.json',
    text: config._comment,
    pattern: /`break: (\d+)`/g,
  },
] as const;

describe('le cliquet de mutation cité par la documentation', () => {
  it.each(CITATIONS)('$source cite le cliquet de la configuration', ({ source, text, pattern }) => {
    const cited = [...text.matchAll(pattern)].map((m) => Number(m[1]));
    expect(
      cited,
      `${source} ne cite plus le cliquet : l'y remettre, ou le retirer de ce test`,
    ).not.toHaveLength(0);
    for (const value of cited) {
      expect(
        value,
        `${source} cite un cliquet à ${value}, stryker.config.json dit ${ratchet} : corriger ${source}`,
      ).toBe(ratchet);
    }
  });
});
