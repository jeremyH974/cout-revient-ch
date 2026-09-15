/**
 * Les planchers de version que les `overrides` de `package.json` tiennent — et celui qu'on ne tient
 * pas (décision n° 154).
 *
 * **Pourquoi un test plutôt qu'une confiance.** Un `override` est une contrainte posée dans un
 * fichier que personne ne relit : rien ne dit qu'il a été retiré par mégarde au fil d'un conflit,
 * ni qu'une nouvelle copie d'un paquet est réapparue sous le plancher à la faveur d'une résolution
 * différente. L'alerte, elle, ne revient que lors d'un scan côté GitHub — après coup, et hors du
 * dépôt. Ici, la vérification est locale, immédiate, et nomme le chemin fautif.
 *
 * **Ce que ce fichier vérifie n'est pas l'existence d'un `override`, mais l'ÉTAT DE L'ARBRE** :
 * les versions réellement installées, toutes copies confondues et à toutes les profondeurs. C'est
 * la seule grandeur qui décide de l'exposition, et c'est pourquoi la liste ci-dessous est plus
 * longue que la liste des `overrides` de `package.json`.
 *
 * **Cinq des neuf alertes ne demandaient aucun `override`.** `fast-uri` et `js-yaml` étaient déjà
 * corrigés dans la ligne que leur parent déclare (`^3.0.1`, `^3.13.1`) : c'était le **verrou** qui
 * était périmé, pas la contrainte qui était trop basse. Un `npm install` suffisait. Poser un
 * `override` là où une résolution neuve suffit ajoute une contrainte permanente pour un gain nul —
 * et ces deux-là figurent ici quand même, comme planchers, précisément pour que le verrou ne
 * puisse pas redescendre en silence.
 *
 * **Tout descend de deux outils de développement**, jamais livrés au navigateur : `@lhci/cli`
 * (Lighthouse CI, figé depuis le 25/06/2025) et `@stryker-mutator/core`. `npm run audit:prod`, qui
 * regarde ce qui est *livré*, n'a jamais rien eu à dire — et c'est exactement la distinction que la
 * décision n° 99 a posée.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Compare deux versions `a.b.c` numériquement. Aucune préversion dans cet arbre. */
function compare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * Toutes les copies installées d'un paquet, à toutes les profondeurs. npm en loge une au sommet et
 * dédouble les autres sous leur consommateur dès qu'il y a conflit : ne regarder que la copie
 * hissée laisserait passer précisément celle qu'un `override` imbriqué a manquée.
 */
function installedCopies(name: string, dir = 'node_modules', found: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.name.startsWith('@')) {
      installedCopies(name, path, found);
      continue;
    }
    if (entry.name === name) {
      try {
        found.push(`${JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).version}`);
      } catch {
        /* dossier sans manifeste : ce n'est pas un paquet installé */
      }
    }
    if (entry.name !== 'node_modules') installedCopies(name, join(path, 'node_modules'), found);
  }
  return found;
}

/**
 * Le plancher de chaque paquet, et ce qu'il écarte. Une liste adossée à un test (règle n° 90) :
 * retirer un `override` sans retirer sa ligne ici fait rougir en nommant le paquet.
 */
const FLOORS: readonly { name: string; floor: string; avis: string }[] = [
  {
    name: 'fast-uri',
    floor: '3.1.6',
    avis: 'CVE-2026-75975 et trois autres — SSRF et confusion d’hôte',
  },
  {
    name: 'js-yaml',
    floor: '3.15.2',
    avis: 'CVE-2026-84375 — déni de service par clés de fusion vides',
  },
  {
    name: 'tmp',
    floor: '0.2.6',
    avis: 'CVE-2026-44705 — traversée de chemin par préfixe non assaini',
  },
  { name: 'uuid', floor: '11.1.1', avis: 'CVE-2026-41907 — dépassement de tampon en v3/v5/v6' },
  { name: 'qs', floor: '6.15.2', avis: 'CVE-2026-8723 — déni de service déclenchable à distance' },
];

describe('les planchers de version tenus par les overrides', () => {
  for (const { name, floor, avis } of FLOORS) {
    it(`${name} n’est jamais installé sous ${floor} (${avis})`, () => {
      const copies = installedCopies(name);
      expect(
        copies.length,
        `aucune copie de ${name} : la dépendance a-t-elle disparu ?`,
      ).toBeGreaterThan(0);
      for (const version of copies)
        expect(
          compare(version, floor) >= 0,
          `${name}@${version} est sous le plancher ${floor}`,
        ).toBe(true);
    });
  }
});

/**
 * **L'exception assumée, et elle est adossée elle aussi.**
 *
 * `extract-zip` porte deux failles hautes (CVE-2026-19693 et CVE-2026-56876, écriture arbitraire
 * par entrées de lien symbolique) et **aucune version corrigée n'existe** : 2.0.1 est la dernière
 * publiée. Le correctif amont a consisté à s'en débarrasser — `@puppeteer/browsers` 3.x l'a
 * remplacé par `modern-tar`. Mais `puppeteer-core@24.43.1` épingle `@puppeteer/browsers` à
 * **exactement** 2.13.2, et `lighthouse@12.6.1` demande `puppeteer-core@^24.10.0` : il faudrait
 * forcer une majeure sur le pilote de Chrome, à l'intérieur d'un outil que plus personne ne
 * publie, sans aucun test pour rattraper la casse.
 *
 * L'exposition réelle est mince : `extract-zip` décompresse l'archive Chrome téléchargée chez
 * Google en TLS. L'exploiter suppose qu'on nous serve un faux Chrome — auquel cas le binaire qu'on
 * s'apprête à exécuter est un problème plus grave qu'une traversée de chemin.
 *
 * Ce test ne protège de rien ; il **rougit le jour où la situation change**, et c'est ce qu'on lui
 * demande : une version différente veut dire qu'un correctif est apparu, ou que l'arbre a bougé
 * sous nos pieds. Dans les deux cas, la décision est à reprendre.
 */
describe('l’exception assumée', () => {
  it('extract-zip reste la seule faille non corrigée, et toujours en 2.0.1', () => {
    expect(installedCopies('extract-zip')).toEqual(['2.0.1']);
  });
});
