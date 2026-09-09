/**
 * Un montant fiscal reste en euros, quoi qu'affiche l'application.
 *
 * `app.report` est calculé **dans la devise d'affichage** ; `app.eurReport` en euros. Les écrans
 * appliquent ensuite `displayFromEur` à un montant fiscal — donc une dérivation fiscale branchée
 * sur `report` le convertit **deux fois**.
 *
 * Le défaut a été livré une fois (`equityTax`, décision n° 138) et **rien ne l'a vu** : la devise
 * par défaut est l'euro, où la double conversion est l'identité. Aucun test de calcul ne pouvait
 * l'attraper, puisque le module fiscal, lui, est juste. C'est donc le **câblage** qu'on surveille
 * ici, en lisant la source — même patron que l'écran Confidentialité (décision n° 128).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync('src/state/app.svelte.ts', 'utf8');

/**
 * Corps d'une dérivation `nom = $derived…` : du nom jusqu'à la ligne qui la ferme.
 *
 * Découpage volontairement grossier — on ne cherche pas à analyser du TypeScript, seulement à
 * savoir de quel rapport une dérivation part.
 */
function bodyOf(name: string): string {
  const start = SOURCE.indexOf(`\n  ${name} = $derived`);
  if (start === -1) return '';
  const end = SOURCE.indexOf('\n  );', start);
  return SOURCE.slice(start, end === -1 ? start + 400 : end);
}

/** Toute dérivation dont le nom parle d'impôt : la liste se découvre, elle ne se tient pas. */
const taxDerivations = [...SOURCE.matchAll(/\n {2}(\w*[Tt]ax\w*) = \$derived/g)].map((m) => m[1]!);

describe('la fiscalité se calcule en euros', () => {
  it('trouve les dérivations fiscales, sinon le test ne prouve rien', () => {
    // Garde-fou du garde-fou : une renommée qui les ferait disparaître se verrait ici.
    expect(taxDerivations.length).toBeGreaterThanOrEqual(2);
  });

  it('aucune dérivation fiscale ne part du rapport en devise d’affichage', () => {
    const coupables = taxDerivations.filter((name) => /this\.report\b/.test(bodyOf(name)));
    expect(
      coupables,
      `ces dérivations lisent « this.report », converti dans la devise d’affichage, alors que ` +
        `l’écran leur appliquera « displayFromEur » : les montants seraient convertis deux fois. ` +
        `Lisez « this.eurReport ».`,
    ).toEqual([]);
  });

  it('les deux rapports existent bien, et disent ce qu’ils sont', () => {
    // Si l'un des deux disparaissait, la règle ci-dessus deviendrait vide de sens sans échouer.
    expect(SOURCE).toMatch(/\n {2}report = \$derived/);
    expect(SOURCE).toMatch(/\n {2}eurReport = \$derived/);
  });
});
