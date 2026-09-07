/**
 * Espace Patrimoine : un relevé eToro déposé dans l'écran d'import doit remplir l'écran Titres.
 *
 * Le fichier est un **classeur**, pas un CSV : ce parcours vérifie aussi qu'un binaire traverse
 * l'écran d'import sans être lu comme du texte (décision n° 107). Les actifs attendus sont
 * calculés par le convertisseur lui-même, jamais écrits en dur (helpers/expected.ts).
 */
import { expect, test } from '@playwright/test';
import { ETORO_FIXTURE, etoroAssets } from './helpers/expected';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('un relevé eToro remplit l’espace Patrimoine', async ({ page }) => {
  const expected = await etoroAssets();
  expect(expected.length).toBeGreaterThan(1);

  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', ETORO_FIXTURE);
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();

  await page.goto('#/wealth');
  const list = page.getByRole('list', { name: 'Titres détenus' });
  await expect(list).toBeVisible();
  // Un titre par ligne, et seulement des titres : la crypto du même relevé va à l'Investissement.
  await expect(list.getByRole('listitem')).toHaveCount(expected.length);
  for (const { label } of expected) {
    await expect(list.getByText(label, { exact: false }).first()).toBeVisible();
  }
});

test('la crypto du même relevé reste à l’Investissement, jamais au Patrimoine', async ({
  page,
}) => {
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', ETORO_FIXTURE);
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();

  await page.goto('#/invest');
  // .first() : le code d'un actif apparaît plusieurs fois dans une ligne (pastille, nom, unité).
  await expect(
    page.getByRole('list', { name: 'Positions' }).getByText('BTC').first(),
  ).toBeVisible();
  await page.goto('#/wealth');
  await expect(page.getByRole('list', { name: 'Titres détenus' }).getByText('BTC')).toHaveCount(0);
});

test('la barre de navigation mène au Patrimoine', async ({ page }) => {
  // Depuis l'écran Titres : sans données, la racine renvoie à l'accueil, qui n'a pas de barre.
  await page.goto('#/wealth');
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav.getByRole('link', { name: 'Patrimoine' })).toBeVisible();
  await nav.getByRole('link', { name: 'Patrimoine' }).click();
  await expect(page).toHaveURL(/#\/wealth$/);
});
