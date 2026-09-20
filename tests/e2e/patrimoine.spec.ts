/**
 * Le rapport de patrimoine, **à l'écran**.
 *
 * Le pendant de `global-report-model.test.ts` et du cas PDF : le même modèle, trois rendus, une
 * seule séquence. Ce parcours tient la partie que ni l'un ni l'autre ne peut tenir — que l'écran
 * existe, qu'on puisse l'atteindre, et qu'il dessine bien les sections du modèle avec le corps
 * partagé du rapport d'investissement.
 *
 * Les titres sont écrits en toutes lettres : c'est la convention de cette suite (voir
 * `report.spec.ts`), et c'est ce qui rend l'échec lisible quand une section disparaît.
 */
import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/**
 * La courbe de patrimoine n'existe qu'une fois l'historique QUOTIDIEN chargé — il suit les
 * cotations du jour de plusieurs secondes. Sans cette attente, la réconciliation est encore nulle
 * et l'écran affiche, à juste titre, « Rien à consolider ». Le pied de la carte d'évolution ne
 * nomme ses sources qu'à la fin du chargement : c'est le signal, et il est déterministe.
 */
async function waitForDailyHistory(page: Page): Promise<void> {
  await page.goto('#/invest');
  await expect(page.locator('section.evolution footer')).toContainText('Sources :', {
    timeout: 30_000,
  });
}

test('le rapport de patrimoine se suit dans l’ordre du modèle', async ({ page }) => {
  await openDemo(page);
  await waitForDailyHistory(page);
  await page.goto('#/patrimoine');

  await expect(
    page.getByRole('article').getByRole('heading', { level: 1, name: 'Rapport de patrimoine' }),
  ).toBeVisible();

  const titles = await page.locator('article.report section.card > h2').allTextContents();
  expect(titles).toEqual([
    'Synthèse',
    'Contribution par espace',
    'Ce que ce document ne dit pas',
    'Méthodologie',
  ]);
});

/**
 * **Le pont, dans l'ordre.** Apports nets, puis résultat, puis patrimoine : lus de gauche à droite
 * les trois chiffres sont une identité. C'est le seul endroit du rapport où l'ordre porte du sens,
 * et un bandeau d'indicateurs est précisément ce qu'un remaniement réordonne sans y penser.
 */
test('le bandeau pose le pont, puis le multiple', async ({ page }) => {
  await openDemo(page);
  await waitForDailyHistory(page);
  await page.goto('#/patrimoine');

  const labels = await page.locator('article.report .kpi .label').allTextContents();
  expect(labels.slice(0, 4)).toEqual([
    'Apports nets',
    'Résultat',
    'Patrimoine',
    'Résultat ÷ apports',
  ]);
  // La méthodologie reprend la même phrase, à dessein : on vise donc la section de synthèse.
  await expect(
    page
      .locator('article.report section.card')
      .first()
      .getByText('Apports nets + résultat = patrimoine'),
  ).toBeVisible();
});

/**
 * **Une route sans lien n'existe pas.** Le rapport se rejoint depuis la carte « Répartition » de la
 * Vue d'ensemble, qui montre déjà cette décomposition — pas depuis un menu où personne ne la
 * chercherait.
 */
test('la Vue d’ensemble mène au rapport de patrimoine', async ({ page }) => {
  await openDemo(page);
  await waitForDailyHistory(page);
  await page.goto('#/');

  await page.getByRole('link', { name: 'Rapport de patrimoine (PDF)' }).click();
  await expect(page).toHaveURL(/#\/patrimoine$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Rapport de patrimoine' }).first(),
  ).toBeVisible();
});

/**
 * **Pas de document vide.** Sans historique chargé, la courbe n'existe pas : un tableau de zéros
 * serait un mensonge par mise en page. L'écran dit ce qui manque et renvoie là où cela se construit.
 */
test('sans courbe de patrimoine, il refuse d’ouvrir un document vide', async ({ page }) => {
  await page.goto('#/patrimoine');
  await expect(
    page.getByRole('heading', { name: 'Rien à consolider pour l’instant' }),
  ).toBeVisible();
  await expect(page.locator('article.report')).toHaveCount(0);
});
