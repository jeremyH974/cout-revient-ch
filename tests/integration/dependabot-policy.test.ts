/**
 * La politique Dependabot, confrontée au verrou (décision n° 180).
 *
 * Deux règles de `.github/dependabot.yml` ne valent que si le reste du dépôt les respecte, et rien
 * ne le vérifiait :
 *
 * 1. **Les familles voyagent ensemble.** Quand deux dépendances directes s'exigent l'une l'autre à
 *    la version EXACTE (`vitest` et `@vitest/coverage-v8`), Dependabot ouvre pourtant une PR par
 *    paquet pour une majeure, et chacune échoue seule en ERESOLVE dès `npm ci` : PR #164 et #165,
 *    septembre 2026, après #83 et #85 pour `codeql-action`. Les familles sont DÉRIVÉES du verrou,
 *    jamais recopiées ici : une famille nouvelle (un `@vitest/ui`, un paquet Stryker de plus) fait
 *    rougir ce test tant qu'aucun groupe ne la couvre.
 * 2. **Une exclusion est une décision.** Chaque entrée d'`ignore` porte une raison (TypeScript 7
 *    injouable, Vitest 5 qui casse le test de mutation). Un `npm install` à la main qui la
 *    contredirait passerait la CI — la mutation n'y tourne pas. Le verrou doit donc la respecter ;
 *    la lever, c'est retirer l'entrée, en suivant ce que son commentaire prescrit.
 *
 * Le YAML est lu par un analyseur minimal, écrit pour la forme de CE fichier (indentation de deux
 * espaces, listes à tirets) : le dépôt n'a pas de dépendance YAML, et un test n'en justifie pas
 * une. Une forme qu'il ne reconnaît pas le fait échouer, jamais passer.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type UpdateType = 'major' | 'minor' | 'patch';
const UPDATE_TYPES: readonly UpdateType[] = ['major', 'minor', 'patch'];

interface Group {
  name: string;
  patterns: string[];
  excludePatterns: string[];
  /** `null` : la clé est absente, et le groupe prend alors toutes les mises à jour. */
  updateTypes: string[] | null;
}

interface Ignore {
  dependencyName: string;
  versions: string[];
}

interface LockEntry {
  version?: string;
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
  packages: Record<string, LockEntry | undefined>;
};
const root = lock.packages[''];
const direct = [
  ...Object.keys(root?.dependencies ?? {}),
  ...Object.keys(root?.devDependencies ?? {}),
];
const lockedVersion = (name: string): string | undefined =>
  lock.packages[`node_modules/${name}`]?.version;

const dependabot = readFileSync('.github/dependabot.yml', 'utf8');

/** Une version publiée, et non une plage : c'est ce qui rend deux paquets indissociables. */
const EXACT = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

/**
 * Les familles : composantes connexes du graphe « exige à la version exacte » entre dépendances
 * directes. Un pair optionnel compte aussi — npm l'impose dès qu'il est installé.
 */
function families(): string[][] {
  const parent = new Map(direct.map((d) => [d, d]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const name of direct)
    for (const [peer, range] of Object.entries(
      lock.packages[`node_modules/${name}`]?.peerDependencies ?? {},
    ))
      if (parent.has(peer) && EXACT.test(range)) parent.set(find(name), find(peer));
  const byRoot = new Map<string, string[]>();
  for (const d of direct) byRoot.set(find(d), [...(byRoot.get(find(d)) ?? []), d]);
  return [...byRoot.values()].filter((f) => f.length > 1).map((f) => f.sort());
}

const indent = (line: string): number => line.length - line.trimStart().length;
const unquote = (s: string): string =>
  s
    .trim()
    .replace(/^'(.*)'$/, '$1')
    .replace(/^"(.*)"$/, '$1');

/** Les lignes utiles du bloc `npm` de `updates`, commentaires et lignes vides retirés. */
function npmBlock(): string[] {
  const lines = dependabot.split(/\r?\n/).filter((l) => !/^\s*(#|$)/.test(l));
  const start = lines.findIndex((l) => /^\s*- package-ecosystem: npm\s*$/.test(l));
  if (start === -1) return [];
  const next = lines.findIndex((l, i) => i > start && /^\s*- package-ecosystem:/.test(l));
  return lines.slice(start + 1, next === -1 ? undefined : next);
}

/** Le contenu d'une clé du bloc (`groups:`, `ignore:`), jusqu'au retour à son indentation. */
function section(block: readonly string[], key: string): string[] {
  const start = block.findIndex((l) => l.trim() === `${key}:`);
  if (start === -1) return [];
  const depth = indent(block[start]!);
  const end = block.findIndex((l, i) => i > start && indent(l) <= depth);
  return block.slice(start + 1, end === -1 ? undefined : end);
}

function parseGroups(block: readonly string[]): Group[] {
  const lines = section(block, 'groups');
  const groups: Group[] = [];
  const nameDepth = lines.length > 0 ? indent(lines[0]!) : 0;
  let key: string | null = null;
  for (const line of lines) {
    const text = line.trim();
    if (indent(line) === nameDepth && text.endsWith(':')) {
      groups.push({
        name: text.slice(0, -1),
        patterns: [],
        excludePatterns: [],
        updateTypes: null,
      });
      key = null;
    } else if (/^[\w-]+:$/.test(text)) {
      key = text.slice(0, -1);
    } else if (text.startsWith('- ') && groups.length > 0) {
      const group = groups.at(-1)!;
      const value = unquote(text.slice(2));
      if (key === 'patterns') group.patterns.push(value);
      else if (key === 'exclude-patterns') group.excludePatterns.push(value);
      else if (key === 'update-types') (group.updateTypes ??= []).push(value);
      else throw new Error(`clé de groupe inconnue de ce test : « ${key} » — l'y ajouter`);
    } else throw new Error(`ligne de groupe inconnue de ce test : « ${text} » — l'y ajouter`);
  }
  return groups;
}

function parseIgnores(block: readonly string[]): Ignore[] {
  const ignores: Ignore[] = [];
  for (const line of section(block, 'ignore')) {
    const text = line.trim();
    const name = /^- dependency-name:\s*(.+)$/.exec(text);
    const versions = /^versions:\s*\[(.*)\]$/.exec(text);
    if (name) ignores.push({ dependencyName: unquote(name[1]!), versions: [] });
    else if (versions && ignores.length > 0)
      ignores.at(-1)!.versions.push(...versions[1]!.split(',').map(unquote).filter(Boolean));
    else throw new Error(`ligne d'exclusion inconnue de ce test : « ${text} » — l'y ajouter`);
  }
  return ignores;
}

/** Le joker de Dependabot : `*` couvre zéro caractère ou plus, le reste est littéral. */
const glob = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&'))
      .join('.*')}$`,
  );

/**
 * Le groupe qui recevra la mise à jour : le PREMIER qui la couvre, selon la documentation de
 * Dependabot (« it's included in the first group that it matches »). Un groupe sans `patterns`
 * couvre toutes les dépendances ; sans `update-types`, toutes les mises à jour.
 */
function groupOf(groups: readonly Group[], dependency: string, type: UpdateType): string | null {
  for (const group of groups) {
    if (group.updateTypes !== null && !group.updateTypes.includes(type)) continue;
    if (group.patterns.length > 0 && !group.patterns.some((p) => glob(p).test(dependency)))
      continue;
    if (group.excludePatterns.some((p) => glob(p).test(dependency))) continue;
    return group.name;
  }
  return null;
}

/** Seule la forme `>=X[.Y[.Z]]` est prise en charge : c'est la seule que le fichier emploie. */
function excludes(range: string, version: string): boolean {
  const m = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range.trim());
  if (!m) throw new Error(`forme de plage inconnue de ce test : « ${range} » — l'y ajouter`);
  const floor = [m[1], m[2], m[3]].map((x) => Number(x ?? 0));
  const actual = version
    .split('-')[0]!
    .split('.')
    .map((x) => Number(x));
  for (let i = 0; i < 3; i++) {
    const a = actual[i] ?? 0;
    const f = floor[i] ?? 0;
    if (a !== f) return a > f;
  }
  return true;
}

describe('les familles de paquets voyagent ensemble', () => {
  const found = families();

  it('le verrou en compte au moins une, et le fichier au moins un groupe', () => {
    // Sans famille, ce test ne garderait plus rien ; sans groupe lu, l'analyseur ne lit plus le
    // fichier. Les deux se disent ici plutôt que de passer en silence.
    expect(found.length).toBeGreaterThan(0);
    expect(
      parseGroups(npmBlock()).length,
      'aucun groupe lu dans le bloc npm de .github/dependabot.yml : sa forme a changé, adapter ce test',
    ).toBeGreaterThan(0);
  });

  it.each(found.map((f) => [f.join(' + '), f] as const))(
    '%s : un seul groupe, quelle que soit la mise à jour',
    (_label, family) => {
      const groups = parseGroups(npmBlock());
      for (const type of UPDATE_TYPES) {
        const assigned = family.map((d) => groupOf(groups, d, type));
        const detail = family.map((d, i) => `${d} → ${assigned[i] ?? 'aucun groupe'}`).join(', ');
        expect(
          new Set(assigned).size === 1 && assigned[0] !== null,
          `mise à jour ${type} : ${detail}. Dependabot ouvrirait une PR par paquet, et chacune ` +
            'échouerait seule en ERESOLVE : couvrir la famille par un groupe dans .github/dependabot.yml',
        ).toBe(true);
      }
    },
  );
});

describe('le verrou respecte les exclusions de Dependabot', () => {
  const ignores = parseIgnores(npmBlock());

  it.each(ignores.map((i) => [`${i.dependencyName} ${i.versions.join(' ')}`, i] as const))(
    '« %s » vise une dépendance directe, que le verrou tient hors de la plage exclue',
    (_label, entry) => {
      const targets = direct.filter((d) => glob(entry.dependencyName).test(d));
      expect(
        targets,
        `l'exclusion « ${entry.dependencyName} » ne vise plus aucune dépendance directe : la retirer`,
      ).not.toHaveLength(0);
      for (const target of targets) {
        const version = lockedVersion(target);
        expect(version, `${target} est absent du verrou`).toBeDefined();
        for (const range of entry.versions)
          expect(
            excludes(range, version!),
            `${target}@${version} contredit l'exclusion « ${entry.dependencyName} ${range} » de ` +
              '.github/dependabot.yml : lever d’abord l’exclusion, en suivant ce que son commentaire prescrit',
          ).toBe(false);
      }
    },
  );
});
