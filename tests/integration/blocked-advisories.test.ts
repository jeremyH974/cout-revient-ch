/**
 * Le réveil des avis de sécurité qu'on a laissés ouverts (décision n° 155).
 *
 * Un avis sans correctif se referme mal : on écrit la décision, on l'oublie, et le jour où le
 * correctif paraît, **rien ne le dit** — les correctifs automatiques de sécurité sont désactivés
 * sur ce dépôt, et dependabot ne propose jamais de montée de version pour une dépendance
 * transitive. `scripts/check-blocked-advisories.ts` est la sonnerie ; ce fichier éprouve qu'elle
 * sonne au bon moment, et seulement à ce moment-là.
 *
 * **Aucune requête ici** : la logique de décision est pure, et c'est exactement pourquoi elle a été
 * séparée de l'appel au registre.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BLOCKED,
  isAbove,
  summarise,
  unblocked,
  type BlockedAdvisory,
} from '../../scripts/check-blocked-advisories.ts';

/** Un dossier de test, indépendant de la table réelle : elle changera, ces cas non. */
const SAMPLE: readonly BlockedAdvisory[] = [
  {
    packageName: 'paquet-bloque',
    advisories: ['CVE-2026-00001'],
    because: 'aucun correctif publié.',
    watch: [{ name: 'paquet-bloque', above: '2.0.1', means: 'un correctif est publié.' }],
  },
];

describe('comparer deux versions', () => {
  it('ne déclenche ni à égalité ni en dessous', () => {
    expect(isAbove('2.0.1', '2.0.1')).toBe(false);
    expect(isAbove('2.0.0', '2.0.1')).toBe(false);
    expect(isAbove('1.9.9', '2.0.1')).toBe(false);
  });

  it('déclenche au correctif de rustine comme au changement de majeure', () => {
    expect(isAbove('2.0.2', '2.0.1')).toBe(true);
    expect(isAbove('3.0.0', '2.0.1')).toBe(true);
  });

  it('compare nombre à nombre, jamais chaîne à chaîne', () => {
    // `'0.10.0' > '0.9.0'` est faux en comparaison lexicale : c'est le piège classique, et il
    // ferait manquer exactement le correctif qu'on attend.
    expect(isAbove('0.10.0', '0.9.0')).toBe(true);
  });

  it('ignore une préversion : elle ne débloque rien', () => {
    expect(isAbove('2.0.1-beta.1', '2.0.1')).toBe(false);
  });
});

describe('ce qui rouvre un dossier', () => {
  it('ne signale rien tant que la version surveillée n’a pas bougé', () => {
    expect(unblocked(SAMPLE, { 'paquet-bloque': '2.0.1' })).toEqual([]);
  });

  it('signale la parution, et rend de quoi écrire la marche à suivre', () => {
    const moved = unblocked(SAMPLE, { 'paquet-bloque': '2.0.2' });
    expect(moved).toHaveLength(1);
    expect(moved[0]?.published).toBe('2.0.2');
    expect(moved[0]?.watched.means).toContain('correctif');
  });

  /**
   * Le cas qui compte le plus : un registre muet ne doit **rien** conclure. Traiter une absence
   * comme un « rien n'a bougé » serait déjà faux ; la traiter comme une parution le serait plus
   * encore — c'est la confusion que la décision n° 99 a tranchée pour l'audit de production.
   */
  it('ne conclut rien d’un paquet que le registre n’a pas rendu', () => {
    expect(unblocked(SAMPLE, {})).toEqual([]);
  });
});

describe('le résumé porté dans l’issue de surveillance', () => {
  it('dit que rien n’a bougé, et pourquoi chaque avis reste ouvert', () => {
    const text = summarise(SAMPLE, { 'paquet-bloque': '2.0.1' }, []);
    expect(text).toContain('Rien n’a bougé');
    expect(text).toContain('aucun correctif publié.');
  });

  it('nomme la parution et ce qu’elle permet', () => {
    const text = summarise(SAMPLE, { 'paquet-bloque': '2.0.2' }, []);
    expect(text).not.toContain('Rien n’a bougé');
    expect(text).toContain('**2.0.2**');
    expect(text).toContain('paquet-bloque');
  });

  it('avoue qu’il n’a pas pu regarder, plutôt que de laisser croire qu’il a regardé', () => {
    const text = summarise(SAMPLE, {}, ['paquet-bloque']);
    expect(text).toContain('muet');
    expect(text).toContain('ce n’est pas un verdict');
  });
});

/**
 * **La table réelle, adossée à l'arbre installé** (règle n° 90). Si quelqu'un monte `extract-zip`
 * sans toucher au veilleur, celui-ci surveillerait un plancher périmé et se tairait pour toujours
 * — la panne la plus silencieuse possible pour une sonnerie de réveil.
 */
describe('la table réelle reste accrochée à ce qui est installé', () => {
  it('surveille chaque avis au-dessus de la version réellement présente', () => {
    expect(BLOCKED.length).toBeGreaterThan(0);
    for (const advisory of BLOCKED) {
      const watched = advisory.watch.find((w) => w.name === advisory.packageName);
      expect(watched, `${advisory.packageName} doit être surveillé lui-même`).toBeDefined();
      const installed = JSON.parse(
        readFileSync(`node_modules/${advisory.packageName}/package.json`, 'utf8'),
      ).version;
      expect(watched?.above, `${advisory.packageName} installé en ${installed}`).toBe(installed);
    }
  });

  it('dit pour chaque avis pourquoi il reste ouvert, et ce qui le rouvrirait', () => {
    for (const advisory of BLOCKED) {
      expect(advisory.advisories.length, advisory.packageName).toBeGreaterThan(0);
      expect(advisory.because.length, advisory.packageName).toBeGreaterThan(40);
      for (const watched of advisory.watch)
        expect(watched.means.length, `${advisory.packageName} → ${watched.name}`).toBeGreaterThan(
          40,
        );
    }
  });
});
