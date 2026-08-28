import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_ORIGINS, buildCsp, connectSrcOrigins } from './csp';

/**
 * Le croisement qui manquait : les origines écrites dans le code livré, confrontées à la CSP.
 *
 * La CSP n'existant qu'au build, aucun test tournant dans Node ne peut constater un blocage. Ce
 * fichier ne le constate pas non plus — il le rend impossible, en refusant qu'une origine soit
 * contactée sans avoir été déclarée et autorisée.
 */

/** Racine du dépôt : Vitest s'exécute depuis là. */
const ROOT = process.cwd();

/** Ce qui part réellement dans le navigateur : le code de l'app et les scripts du service worker. */
const SCANNED: readonly { dir: string; keep: (file: string) => boolean }[] = [
  {
    dir: 'src',
    keep: (f) => (f.endsWith('.ts') || f.endsWith('.svelte')) && !f.endsWith('.test.ts'),
  },
  { dir: 'public', keep: (f) => f.endsWith('.js') },
];

const ORIGIN_PATTERN = /(?:https|wss):\/\/[a-z0-9.-]+/gi;

/** Toutes les origines littérales du code livré, avec le fichier où chacune apparaît. */
function scanOrigins(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const { dir, keep } of SCANNED) {
    const base = join(ROOT, dir);
    for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !keep(entry.name)) continue;
      const path = join(entry.parentPath, entry.name);
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(ORIGIN_PATTERN)) {
        const origin = match[0].toLowerCase();
        const relative = path
          .slice(ROOT.length + 1)
          .split(sep)
          .join('/');
        const files = found.get(origin);
        if (!files) found.set(origin, [relative]);
        else if (!files.includes(relative)) files.push(relative);
      }
    }
  }
  return found;
}

const FOUND = scanOrigins();
const DECLARED = new Map(KNOWN_ORIGINS.map((o) => [o.origin, o]));

describe('origines connues', () => {
  it('le code ne cite aucune origine absente de la table', () => {
    const undeclared = [...FOUND]
      .filter(([origin]) => !DECLARED.has(origin))
      .map(([origin, files]) => `${origin} (${files.join(', ')})`);
    expect(
      undeclared,
      "Déclarez ces origines dans `csp.ts` : `connect` si l'app les contacte — sans quoi le " +
        'navigateur les bloquera en production, en silence —, `link` si elles ne sont que citées.',
    ).toEqual([]);
  });

  it('la table ne garde aucune origine que le code n’écrit plus', () => {
    const orphans = KNOWN_ORIGINS.filter((o) => o.use !== 'reserved' && !FOUND.has(o.origin)).map(
      (o) => o.origin,
    );
    expect(
      orphans,
      'Ces origines ont disparu du code : retirez-les, ou passez-les en `reserved` avec la raison.',
    ).toEqual([]);
  });

  it('aucune origine n’est déclarée deux fois', () => {
    expect(DECLARED.size).toBe(KNOWN_ORIGINS.length);
  });

  it('chaque entrée porte une justification', () => {
    expect(KNOWN_ORIGINS.filter((o) => o.why.trim().length < 10)).toEqual([]);
  });

  it('les origines sont écrites sans chemin ni barre finale', () => {
    expect(KNOWN_ORIGINS.filter((o) => !/^(?:https|wss):\/\/[a-z0-9.-]+$/.test(o.origin))).toEqual(
      [],
    );
  });
});

describe('content-security-policy', () => {
  const csp = buildCsp();
  const connectSrc = csp
    .split('; ')
    .find((directive) => directive.startsWith('connect-src '))
    ?.split(' ')
    .slice(1);

  it('expose une directive connect-src', () => {
    expect(connectSrc).toBeDefined();
    expect(connectSrc).toContain("'self'");
  });

  it('autorise toutes les origines que l’app contacte', () => {
    const contacted = KNOWN_ORIGINS.filter((o) => o.use === 'connect').map((o) => o.origin);
    for (const origin of contacted) expect(connectSrc).toContain(origin);
  });

  it('n’autorise pas les origines qui ne sont que des liens', () => {
    const links = KNOWN_ORIGINS.filter((o) => o.use === 'link').map((o) => o.origin);
    for (const origin of links) expect(connectSrc).not.toContain(origin);
  });

  it('n’autorise rien qui ne soit pas dans la table', () => {
    const allowed = new Set(connectSrcOrigins());
    expect(connectSrc?.filter((source) => source !== "'self'" && !allowed.has(source))).toEqual([]);
  });

  it('couvre l’indice Fear & Greed, dont l’absence rendait les alertes de sentiment muettes', () => {
    expect(connectSrc).toContain('https://api.alternative.me');
  });
});
