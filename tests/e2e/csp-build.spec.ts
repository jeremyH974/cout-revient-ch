/**
 * Le maillon qui manquait à la décision n° 57 : **lire la CSP réellement écrite dans `dist/`**.
 *
 * `src/lib/support/csp.test.ts` croise la table des origines avec le code livré, et c'est
 * indispensable — mais il tourne dans Node, sur des sources. Il ne peut pas constater que la
 * balise `<meta>` produite par le build contient bien ce que la table déclare : entre les deux, il
 * y a un plugin Vite (`cspMetaOnBuild`) qui remplace une chaîne dans `index.html`. Un
 * `<meta charset>` reformaté par un outil de mise en forme, un plugin déplacé après celui de la
 * PWA, une balise dupliquée : le remplacement échoue, la CSP disparaît ou reste incomplète, et
 * **tout continue de marcher en développement**. C'est exactement le scénario qui a rendu l'indice
 * Fear & Greed muet pendant des semaines.
 *
 * D'où ce test : il ne lit pas la page servie, il lit le **fichier produit**, avant même qu'un
 * navigateur l'ouvre. Il tourne dans la suite de bout en bout parce que c'est la seule étape qui
 * exécute `vite build` avant les tests (`npm run e2e`, et le job `e2e` de la CI).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { KNOWN_ORIGINS, TRUSTED_TYPES_POLICIES, buildCsp } from '../../src/lib/support/csp';

const INDEX = fileURLToPath(new URL('../../dist/index.html', import.meta.url));
const ASSETS = fileURLToPath(new URL('../../dist/assets', import.meta.url));

/** Le contenu de la balise CSP telle qu'elle est écrite sur le disque, ou `null`. */
function cspOfBuild(): string | null {
  const html = readFileSync(INDEX, 'utf8');
  const match = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i,
  );
  return match?.[1] ?? null;
}

test.describe('la CSP du build', () => {
  test('la balise existe une fois et vaut exactement la politique déclarée', () => {
    const html = readFileSync(INDEX, 'utf8');
    expect(
      html.match(/http-equiv="Content-Security-Policy"/gi)?.length ?? 0,
      'une balise CSP, ni zéro (injection ratée) ni deux (politiques concurrentes)',
    ).toBe(1);
    expect(cspOfBuild()).toBe(buildCsp());
  });

  test('chaque origine `connect` de la table est réellement autorisée dans le fichier livré', () => {
    const csp = cspOfBuild();
    expect(csp, 'aucune balise CSP dans dist/index.html').not.toBeNull();
    const connectSrc = csp
      ?.split('; ')
      .find((directive) => directive.startsWith('connect-src '))
      ?.split(' ')
      .slice(1);
    expect(connectSrc, 'aucune directive connect-src dans le fichier livré').toBeDefined();
    for (const origin of KNOWN_ORIGINS.filter((o) => o.use === 'connect').map((o) => o.origin))
      expect(connectSrc, `${origin} déclarée mais absente du build`).toContain(origin);
  });

  test('l’origine du modèle de langage y figure : sans elle, le récit échouerait en silence', () => {
    // Nommée à part parce que c'est le premier appel ajouté depuis que la panne muette a été
    // comprise. `loadFearGreed` avalait ses erreurs ; le récit, lui, retomberait sur le rendu
    // déterministe — un repli correct, mais qui masquerait un blocage CSP au lieu de le montrer.
    expect(cspOfBuild()).toContain('https://api.anthropic.com');
  });

  test('Trusted Types est exigé, et la liste des politiques est fermée', () => {
    const csp = cspOfBuild();
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).toContain(`trusted-types ${TRUSTED_TYPES_POLICIES.join(' ')}`);
    // `*` autoriserait n'importe quelle politique, donc n'importe quel puits : ce serait la
    // directive sans la protection.
    expect(csp).not.toContain('trusted-types *');
  });

  /**
   * Le garde-fou qui compte, et le patron de la décision n° 57 appliqué aux politiques.
   *
   * La liste blanche est écrite à la main dans `csp.ts`, mais les politiques, elles, sont créées par
   * nos **dépendances** — `svelte-trusted-html` vient du runtime de Svelte, pas de nous. Le jour où
   * une mise à jour en introduira une autre, la CSP la bloquera : l'application se casserait chez
   * l'utilisateur, en développement tout continuerait de marcher (aucune CSP n'y est posée), et rien
   * ne l'aurait dit. Ce croisement lit le bundle livré et fait échouer la CI à la place.
   */
  test('toute politique créée dans le bundle figure dans la liste blanche', () => {
    const created = new Set<string>();
    for (const file of readdirSync(ASSETS).filter((f) => f.endsWith('.js'))) {
      const source = readFileSync(join(ASSETS, file), 'utf8');
      for (const match of source.matchAll(/createPolicy\(\s*[`'"]([^`'"]+)[`'"]/g)) {
        const name = match[1];
        if (name) created.add(name);
      }
    }
    expect(
      created.size,
      'aucune politique trouvée : le motif de recherche a-t-il vieilli ?',
    ).toBeGreaterThan(0);
    for (const name of created)
      expect(
        TRUSTED_TYPES_POLICIES as readonly string[],
        `la politique « ${name} » est créée dans le bundle mais absente de TRUSTED_TYPES_POLICIES`,
      ).toContain(name);
  });
});
