import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inlineSegments, parseChangelog, releaseTitle } from './changelog';

describe('lecture du changelog', () => {
  it('structure versions, sections traduites et puces multi-lignes', () => {
    const releases = parseChangelog(`# Changelog

## [Unreleased]

### Added

- Première puce sur
  deux lignes avec \`code\`.
- Deuxième puce.

### Fixed

- Un correctif.

## [1.0.0] - 2026-08-22

### Security

- Verrou.
`);
    expect(releases.map((r) => [r.version, r.date])).toEqual([
      ['Unreleased', null],
      ['1.0.0', '2026-08-22'],
    ]);
    expect(releases[0]?.sections.map((s) => s.title)).toEqual(['Ajouté', 'Corrigé']);
    expect(releases[0]?.sections[0]?.items).toEqual([
      'Première puce sur deux lignes avec `code`.',
      'Deuxième puce.',
    ]);
    expect(releaseTitle(releases[0]!)).toBe('Dernières évolutions');
    expect(releaseTitle(releases[1]!)).toBe('Version 1.0.0 — 2026-08-22');
  });

  it('découpe le code inline sans HTML', () => {
    expect(inlineSegments('Réglages → `npm run e2e` puis fin')).toEqual([
      { kind: 'text', value: 'Réglages → ' },
      { kind: 'code', value: 'npm run e2e' },
      { kind: 'text', value: ' puis fin' },
    ]);
  });

  it('lit le CHANGELOG du dépôt', () => {
    const releases = parseChangelog(readFileSync('CHANGELOG.md', 'utf8'));
    expect(releases.length).toBeGreaterThan(0);
    expect(releases[0]?.sections.length).toBeGreaterThan(0);
    expect(releases.every((r) => r.sections.every((s) => s.items.length > 0))).toBe(true);
  });
});

describe('sections répétées', () => {
  it('fusionne deux « Added » d’une même version (titres uniques pour le rendu)', () => {
    const md = [
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '- a',
      '',
      '### Fixed',
      '',
      '- b',
      '',
      '### Added',
      '',
      '- c',
      '',
    ].join(String.fromCharCode(10));
    const [release] = parseChangelog(md);
    expect(release?.sections.map((s) => s.title)).toEqual(['Ajouté', 'Corrigé']);
    expect(release?.sections[0]?.items).toEqual(['a', 'c']);
  });
});
