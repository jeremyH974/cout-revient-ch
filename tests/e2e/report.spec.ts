/**
 * L'ordre des sections du Rapport, **à l'écran**.
 *
 * Le pendant de `pdf.test.ts` : le PDF et l'écran rendent le MÊME modèle, et leurs deux séquences
 * de sections sont aujourd'hui codées en dur, séparément — l'une dans `pdf.ts`, l'autre dans le
 * markup de `Report.svelte`. Rien ne les tenait ensemble : on pouvait en intervertir une d'un côté
 * seulement, et les deux rendus se mettaient à raconter deux histoires différentes.
 *
 * Ce parcours fige la séquence de l'écran avant que le modèle ne devienne une liste ordonnée de
 * sections. Les titres sont des libellés, pas des chiffres : les écrire ici est la convention de
 * cette suite (voir `declaration.spec.ts`), et c'est ce qui rend l'échec lisible.
 */
import { expect, test } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/**
 * Hors ligne, l'historique des cours ne se charge pas : « Risque », « Fiscalité française » et
 * « Coût réel des opérations » sont donc absents, et c'est normal — ils n'ont rien à décrire. La
 * séquence vérifiée est celle des sections qui, elles, ne dépendent d'aucun cours.
 */
test('les sections du Rapport se suivent dans l’ordre du modèle', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/report');
  await expect(
    page.getByRole('article').getByRole('heading', { level: 1, name: 'Rapport de portefeuille' }),
  ).toBeVisible();

  const titles = await page.locator('article.report section.card > h2').allTextContents();

  // Garde-fou du garde-fou : une liste vide passerait sans rien prouver.
  expect(titles.length).toBeGreaterThanOrEqual(6);
  // Le titre du 3916-bis porte l'année décrite (décision n° 141) : la figer ferait rougir ce
  // parcours au 1er janvier, pour une raison qui n'aurait rien à voir avec l'ordre des sections.
  expect(titles.map((t) => t.replace(/\b(19|20)\d{2}\b/, '<année>'))).toEqual([
    'Synthèse',
    'Constats',
    'Comptes à déclarer au titre de <année> (formulaire 3916-bis)',
    'Veille réglementaire',
    'Abonnement Coinhouse',
    'Répartition',
    'Positions ouvertes',
    'Stablecoins',
    'Positions clôturées',
    'Méthodologie',
  ]);
});
