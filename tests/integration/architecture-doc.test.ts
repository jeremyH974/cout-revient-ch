/**
 * `docs/ARCHITECTURE.md` confronté au code (décision n° 90).
 *
 * Le patron est celui de `src/lib/support/csp.test.ts` : lire la source de vérité **typée** (jamais
 * un second parsage), scanner l'autre côté, comparer **dans les deux sens**, et échouer avec un
 * message qui dit l'action corrective plutôt que le symptôme.
 *
 * Ce que ce fichier vaut se mesure à ce qu'il a trouvé le jour où il a été écrit : cinq listes
 * périmées, dont une **fausse** — l'import, la saisie et le rapport y étaient attribués au menu
 * « Plus » alors qu'ils appartiennent à l'Investissement. Une documentation d'architecture qui se
 * trompe d'espace envoie son lecteur au mauvais endroit ; c'est pire que pas de documentation.
 *
 * Toutes les énumérations du document ne sont pas ici : seules celles qui ont une source de vérité
 * **énumérable à l'exécution**. Une liste qu'on ne peut pas confronter n'a rien à faire dans un
 * test — elle y donnerait l'illusion d'être gardée.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLATFORM_CONVERTERS } from '../../src/lib/import/platforms/index';
import { SPACES } from '../../src/lib/spaces';
import { connectSrcOrigins } from '../../src/lib/support/csp';

const DOC = 'docs/ARCHITECTURE.md';
const doc = readFileSync(DOC, 'utf8');

/** Les jetons entre accents graves du document : c'est ainsi que les listes y sont écrites. */
const backticked = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);

/**
 * Le passage qui suit un ancrage, jusqu'au prochain point de liste de premier niveau ou au prochain
 * titre. Les sous-listes, indentées, restent incluses — c'est bien ce qu'on veut : une énumération
 * du document tient dans son point, jamais au-delà.
 */
function section(anchor: string): string {
  const start = doc.indexOf(anchor);
  expect(start, `ancrage introuvable dans ${DOC} : « ${anchor} »`).toBeGreaterThan(-1);
  const rest = doc.slice(start + anchor.length);
  const end = rest.search(/\n(?:- |#{1,6} )/);
  return anchor + (end === -1 ? rest : rest.slice(0, end));
}

/**
 * Une liste explicitement déclarée vérifiable par le document lui-même.
 *
 * Le marqueur est écrit dans `ARCHITECTURE.md`, en toutes lettres : le lecteur voit ainsi quelles
 * énumérations sont tenues par un test et lesquelles restent de la prose. Sans lui, il faudrait
 * deviner la liste par la forme des jetons — et ramasser au passage tous les noms de fichiers et
 * d'identifiants cités alentour.
 */
const LEAD = '**Liste vérifiée** :';

function verifiedList(anchor: string): string[] {
  const text = section(anchor);
  const at = text.indexOf(LEAD);
  expect(at, `marqueur « ${LEAD} » absent sous « ${anchor} » dans ${DOC}`).toBeGreaterThan(-1);
  const rest = text.slice(at + LEAD.length);
  // La liste s'arrête au point qui la termine, à la ligne vide, ou au point de liste suivant. Un
  // point suivi d'une lettre — `kraken.ts` — ne compte pas : c'est ce qui permet d'écrire des noms
  // de fichiers dans une liste vérifiée sans la couper en deux.
  const end = rest.search(/\.\s|\n\s*\n|\n\s*- /);
  return backticked(end === -1 ? rest : rest.slice(0, end));
}

/** Tous les fichiers du dépôt dont le nom correspond, hors `node_modules` et `dist`. */
function filesMatching(pattern: RegExp, roots: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (pattern.test(entry.name)) found.push(entry.name);
    }
  };
  for (const root of roots) walk(root);
  return found.sort();
}

/** Comparaison dans les deux sens : ce que le document oublie, et ce qu'il invente. */
function compare(inDoc: readonly string[], inCode: readonly string[], what: string): void {
  const doc = new Set(inDoc);
  const code = new Set(inCode);
  expect(
    [...code].filter((x) => !doc.has(x)).sort(),
    `${what} : présents dans le code, absents de ${DOC}. Complétez le document.`,
  ).toEqual([]);
  expect(
    [...doc].filter((x) => !code.has(x)).sort(),
    `${what} : cités dans ${DOC}, introuvables dans le code. Retirez-les du document.`,
  ).toEqual([]);
}

describe('ARCHITECTURE.md décrit le code réel', () => {
  it('les hôtes joignables cités sont exactement ceux de la CSP', () => {
    const cited = verifiedList('Hôtes joignables déclarés dans');
    // Le document écrit les hôtes sans schéma ; `KNOWN_ORIGINS` les porte avec.
    const declared = connectSrcOrigins().map((origin) => origin.replace(/^[a-z]+:\/\//, ''));
    compare(cited, declared, 'hôtes de la CSP');
  });

  it('les convertisseurs de plateformes cités sont exactement les modules présents', () => {
    const cited = verifiedList('- `src/lib/import/platforms`');
    const infra = new Set(['index.ts', 'types.ts', 'drafts.ts', 'money-text.ts']);
    const modules = readdirSync('src/lib/import/platforms')
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !infra.has(f))
      .sort();
    compare(cited, modules, 'convertisseurs de plateformes');
    // Garde-fou du garde-fou : un dossier vidé ferait passer la comparaison sans rien prouver.
    expect(modules.length, 'aucun convertisseur trouvé').toBe(
      Object.keys(PLATFORM_CONVERTERS).length,
    );
  });

  it('les fichiers de tests de propriétés cités sont exactement ceux du dépôt', () => {
    const cited = verifiedList('**Propriétés**');
    compare(cited, filesMatching(/\.property\.test\.ts$/, ['src', 'tests']), 'tests de propriétés');
  });

  it('les auto-vérifications citées sont exactement celles du code', () => {
    const cited = verifiedList('- **Auto-vérifications**');
    const source = readFileSync('src/lib/support/self-check.ts', 'utf8');
    const ids = [...new Set([...source.matchAll(/\bid: '([a-z-]+)'/g)].map((m) => m[1]!))];
    compare(cited, ids, 'contrôles de self-check.ts');
  });

  it('les routes citées par espace sont exactement celles de SPACES', () => {
    const cited = verifiedList('- `src/routes`, `src/components`');
    compare(
      cited,
      SPACES.flatMap((space) => space.routes),
      'routes des espaces',
    );
  });

  /**
   * L'erreur exacte trouvée le 01/09/2026, gravée pour qu'elle ne revienne pas : le document
   * plaçait l'import, la saisie et le rapport dans le menu « Plus ». Le test ci-dessus ne l'aurait
   * pas attrapée seul — les trois routes existent bien, simplement dans le mauvais espace.
   */
  it('import, saisie et rapport appartiennent à l’Investissement, pas au menu « Plus »', () => {
    const invest = SPACES.find((s) => s.id === 'invest');
    const more = SPACES.find((s) => s.id === 'more');
    for (const route of ['import', 'add', 'report'] as const) {
      expect(invest?.routes, `${route} doit être dans l’espace Investissement`).toContain(route);
      expect(more?.routes, `${route} ne doit pas être dans le menu « Plus »`).not.toContain(route);
    }
  });
});
