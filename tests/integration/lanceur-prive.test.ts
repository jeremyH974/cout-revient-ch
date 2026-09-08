/**
 * Le lanceur de la variante personnelle distingue un build PRIVÉ d'un build PUBLIC en cherchant
 * le préfixe `/cout-revient-ch/assets/` dans `dist/index.html`. Ce test existe parce que ce
 * discriminant n'est écrit nulle part dans le code applicatif : il **déduit** l'option `base` de
 * Vite, et rien n'obligeait les deux à rester d'accord.
 *
 * Ce que la divergence coûterait, si elle passait : un build public pris pour un privé serait
 * servi depuis l'origine dédiée `crch.localhost`, **avec sa sortie réseau ouverte** — exactement
 * ce que la variante personnelle existe pour couper. Le lanceur croirait avoir vérifié quelque
 * chose, et n'aurait rien vérifié.
 *
 * Le test croise donc trois sources : l'option `base` du mode public, celle du mode privé, et la
 * chaîne réellement cherchée par le script PowerShell.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../vite.config';

/** Signature minimale de ce que `defineConfig` rend ici : une fonction du mode vers la config. */
type ConfigFn = (env: { mode: string; command: 'build' | 'serve' }) => { base?: string };

const baseFor = (mode: string): string | undefined =>
  (config as unknown as ConfigFn)({ mode, command: 'build' }).base;

const LANCEUR = readFileSync('scripts/lancer-prive.ps1', 'utf8');

/**
 * Le script SANS ses commentaires. Indispensable ici : le fichier **explique** pourquoi il ne
 * passe pas `--user-data-dir`, donc la chaîne y figure — en prose. Chercher dans le texte brut
 * ferait échouer un test qui devrait passer, ce qui est la pire espèce de garde-fou.
 */
const CODE = LANCEUR.replace(/<#[\s\S]*?#>/g, '')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

describe('discriminant du lanceur : build privé ou build public', () => {
  it('le build public est préfixé, le privé sert à la racine', () => {
    expect(baseFor('production')).toBe('/cout-revient-ch/');
    expect(baseFor('prive')).toBe('/');
  });

  it('le lanceur cherche exactement le préfixe que le build public produit', () => {
    const publicBase = baseFor('production')!;
    // La chaîne du script, telle qu'elle y est écrite : `/cout-revient-ch/assets/`.
    const cherchee = /'([^']*\/assets\/)'/.exec(LANCEUR)?.[1];
    expect(cherchee, 'le script doit chercher un préfixe se terminant par /assets/').toBeDefined();
    expect(cherchee).toBe(`${publicBase}assets/`);
  });

  it('le préfixe cherché ne peut PAS apparaître dans un build privé', () => {
    const priveBase = baseFor('prive')!;
    // Un build privé écrit `/assets/…` ; le discriminant ne doit pas y correspondre par accident.
    expect(`${priveBase}assets/`).not.toContain('cout-revient-ch');
  });

  it('le lanceur refuse le mode rapide sur un build public, et le dit', () => {
    // Un garde-fou muet vaut un garde-fou absent : le refus doit nommer sa raison.
    expect(LANCEUR).toMatch(/-Rapide ignore/);
    expect(LANCEUR).toMatch(/sortie reseau/);
  });

  it('aucun `--user-data-dir` n’est passé au navigateur', () => {
    // Un profil dédié aurait son propre stockage : le raccourci et l'adresse tapée à la main ne
    // montreraient pas les mêmes données. C'est le piège d'origine, déguisé en option de confort.
    expect(CODE).not.toContain('--user-data-dir');
  });

  it('l’adresse ouverte est l’origine dédiée, jamais `localhost` nu', () => {
    expect(CODE).toContain('http://crch.localhost:');
    expect(CODE).not.toMatch(/["'`]http:\/\/localhost:7331/);
  });
});
