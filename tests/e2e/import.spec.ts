import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { FIXTURE, fixtureReport } from './helpers/expected';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('import par le sélecteur de fichier, puis ré-import sans doublon', async ({ page }) => {
  const { report, rows } = fixtureReport();
  const n = rows.length;
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();
  await expect(page.getByText(`${n} nouvelle(s) ligne(s) · 0 déjà connue(s)`)).toBeVisible();

  // Même contenu sous un autre nom : le navigateur n'émet pas `change` pour un fichier identique.
  await page.setInputFiles('input[type="file"]', {
    name: 'historique des transactions (2).csv',
    mimeType: 'text/csv',
    buffer: readFileSync(FIXTURE),
  });
  await expect(page.getByText(`0 nouvelle(s) ligne(s) · ${n} déjà connue(s)`)).toBeVisible();

  await page.getByRole('link', { name: 'Voir mon portefeuille' }).click();
  await expect(page.getByRole('list', { name: 'Positions' }).getByRole('listitem')).toHaveCount(
    report.positions.length,
  );
});

test('un fichier étranger est refusé avec les colonnes trouvées et le diagnostic', async ({
  page,
}) => {
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', {
    name: 'releve.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Date,Montant\n01/01/2026,12.5\n'),
  });
  await expect(
    page.getByRole('heading', { name: 'Ce fichier ne ressemble pas à un export Coinhouse.' }),
  ).toBeVisible();
  await expect(page.getByText('Colonnes trouvées : Date, Montant.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copier le diagnostic' })).toBeVisible();
  // Formulaire « fichier non reconnu » pré-rempli avec les colonnes trouvées et le diagnostic.
  const href = (await page
    .getByRole('link', { name: 'Signaler (formulaire pré-rempli)' })
    .getAttribute('href')) as string;
  const url = new URL(href);
  expect(url.pathname).toBe('/jeremyH974/cout-revient-ch/issues/new');
  expect(url.searchParams.get('template')).toBe('fichier-non-reconnu.yml');
  expect(url.searchParams.get('header')).toBe('Date,Montant');
  expect(url.searchParams.get('diagnostic')).toContain('colonnes trouvées : Date, Montant');
});
