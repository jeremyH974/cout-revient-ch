import { expect, test } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { fixtureReport, position, pruText } from './helpers/expected';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('fiche actif : historique avec PRU après chaque ligne, courbe PRU vs prix', async ({
  page,
}) => {
  const { report } = fixtureReport();
  const btc = position(report, 'btc');
  await openDemo(page);
  await page.goto('#/asset/btc');
  await expect(page.getByRole('heading', { level: 1, name: 'BTC' })).toBeVisible();

  const tabs = page.getByRole('navigation', { name: 'Sections' });
  await expect(
    tabs.getByRole('button', { name: `Historique (${btc.history.length})` }),
  ).toBeVisible();
  const operations = page.locator('article.op');
  await expect(operations).toHaveCount(btc.history.length);

  // La ligne la plus récente (affichée en premier) porte le PRU courant.
  const newest = btc.history[0]!;
  const firstOp = operations.first().locator('p.after');
  await expect(firstOp).toContainText(newest.realized === null ? 'PRU après :' : 'PRU inchangé :');
  await expect(firstOp).toContainText(pruText(btc));

  // Les ventes affichent le réalisé de l'opération, les achats non.
  const sales = btc.history.filter((h) => h.realized !== null).length;
  await expect(page.locator('p.after', { hasText: 'Réalisé sur cette opération' })).toHaveCount(
    sales,
  );

  // Courbe : l'historique de prix stubé (Coinbase) suffit à tracer le PRU vs prix.
  const chart = page.getByRole('region', { name: 'Évolution' });
  await expect(chart.getByRole('radio', { name: 'PRU vs prix' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(chart.locator('svg')).toBeVisible({ timeout: 20_000 });
});

test('téléchargement CSV de l’historique d’un actif', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'téléchargements : Chromium seulement');
  await openDemo(page);
  await page.goto('#/asset/btc');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: "Télécharger l'historique de BTC (CSV)" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^cout-revient-ch-btc-operations-\d{4}-\d{2}-\d{2}\.csv$/,
  );
});

/**
 * Couverture des actifs (décision n° 54). La table refuse délibérément de cartographier un symbole
 * ambigu — deux projets pour un ticker — parce qu'un prix faux est pire qu'un prix absent. Ce refus
 * n'est tenable que si l'utilisateur peut trancher lui-même : ce champ est le rattrapage, et il
 * n'existait pas malgré un réglage présent dans les données depuis longtemps.
 */
test('la fiche actif permet de désigner soi-même l’identifiant CoinGecko', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/asset/btc');

  await page.getByRole('button', { name: 'identifiant CoinGecko', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  const field = sheet.getByLabel('Identifiant CoinGecko');
  await expect(field).toHaveValue('');

  await field.fill('dogwifcoin');
  await sheet.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(sheet).toBeHidden();

  // Le libellé du bouton change : le réglage a bien été retenu.
  await expect(
    page.getByRole('button', { name: 'modifier l’identifiant CoinGecko' }),
  ).toBeVisible();

  // Et il se retire, sans quoi une erreur de saisie serait définitive.
  await page.getByRole('button', { name: 'modifier l’identifiant CoinGecko' }).click();
  await sheet.getByLabel('Identifiant CoinGecko').fill('');
  await sheet.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(
    page.getByRole('button', { name: 'identifiant CoinGecko', exact: true }),
  ).toBeVisible();
});
