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

test('avec une clé, les titres reçoivent un cours et une valeur', async ({ page }) => {
  // LE test qui manquait. Les fournisseurs de cours étaient corrects et éprouvés isolément, mais
  // `heldAssets` ne leur soumettait aucun code `eq:` : aucun titre n'a jamais eu de prix dans
  // l'application. Rien ne le voyait — cette spec ne vérifiait que des libellés (décision n° 119).
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', ETORO_FIXTURE);
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();

  // La clé se saisit comme l'utilisateur le ferait : c'est elle qui arme le fournisseur.
  await page.goto('#/settings');
  const key = page.getByLabel('Clé Twelve Data (facultative)');
  await key.fill('clef-de-test-e2e');
  await key.blur();

  await page.goto('#/wealth');
  const list = page.getByRole('list', { name: 'Titres détenus' });
  await expect(list).toBeVisible();
  // Un prix, pas « Prix indisponible » : c'est la différence entre un fournisseur écrit et un
  // fournisseur atteint. Et plus aucune ligne sans cours — la note du haut disparaît.
  await expect(list.getByText('Prix indisponible').first()).toBeHidden({ timeout: 15000 });
  await expect(page.getByText(/sans cours/)).toBeHidden({ timeout: 15000 });
  // La VALEUR, pas le prix : sous 768 px la colonne « Prix » est masquée par la mise en page
  // (`AssetRow.svelte`, `.price { display: none }`), et l'assertion ne tenait qu'en desktop.
  // La valeur, elle, est affichée sur les deux — et c'est bien elle que l'utilisateur attend.
  await expect(list.getByText('Valeur').first()).toBeVisible();
  const first = list.getByRole('listitem').first();
  await expect(first).toContainText('€');
});
