import { expect, test } from '@playwright/test';
import { DEMO_BUTTON, openDemo } from './helpers/demo';
import { fixtureReport, position, pruText } from './helpers/expected';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('accueil → démo → portefeuille : lignes et PRU identiques au moteur', async ({ page }) => {
  const { report } = fixtureReport();
  await openDemo(page);

  const rows = page.getByRole('list', { name: 'Positions' }).getByRole('listitem');
  await expect(rows).toHaveCount(report.positions.length);
  await expect(page.getByRole('list', { name: 'Stablecoins' }).getByRole('listitem')).toHaveCount(
    report.stablecoins.length,
  );

  for (const asset of ['btc', 'eth', 'sol']) {
    const p = position(report, asset);
    const row = rows.filter({ has: page.getByText(asset.toUpperCase(), { exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`PRU ${pruText(p)}`);
  }

  // Le rapport PDF est proposé dès la carte de synthèse, pas seulement en pied de page.
  const pdfLink = page.locator('section.summary').getByRole('link', { name: 'Rapport PDF' });
  await expect(pdfLink).toBeVisible();
  await pdfLink.click();
  await expect(page).toHaveURL(/#\/invest\/report$/);
  await expect(page.getByRole('button', { name: 'Télécharger le PDF' })).toBeVisible();
});

test('la démo survit à un rechargement et se quitte proprement', async ({ page }) => {
  await openDemo(page);
  // La sauvegarde locale est débouncée (300 ms) : on attend qu'elle contienne la démo avant de recharger.
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('crch:v1:state')?.includes('"demoMode":true')),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: /Données d.exemple/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Positions' })).toBeVisible();

  await page.getByRole('button', { name: 'Quitter la démo' }).click();
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole('button', { name: DEMO_BUTTON, exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /Données d.exemple/ })).toHaveCount(0);
});

test('la page Importer prévient que l’import remplace la démo', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/import');
  await expect(page.getByRole('note')).toContainText('Vous êtes en démo');
});
