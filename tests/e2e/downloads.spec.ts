import { readFileSync, statSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context, browserName }) => {
  test.skip(browserName !== 'chromium', 'téléchargements : Chromium seulement');
  await stubNetwork(context);
});

test('exports CSV depuis les réglages', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/settings');
  for (const [label, pattern] of [
    ['Positions (CSV)', /^cout-revient-ch-positions-\d{4}-\d{2}-\d{2}\.csv$/],
    ['Opérations avec PRU (CSV)', /^cout-revient-ch-operations-\d{4}-\d{2}-\d{2}\.csv$/],
    ['Lots ouverts (CSV)', /^cout-revient-ch-lots-\d{4}-\d{2}-\d{2}\.csv$/],
  ] as const) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: label }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(pattern);
    const path = await file.path();
    const content = readFileSync(path, 'utf8');
    expect(content.charCodeAt(0)).toBe(0xfeff); // BOM UTF-8 pour Excel
    expect(content.split('\n').length).toBeGreaterThan(2);
  }
});

test('rapport PDF généré dans le navigateur', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/report');
  await expect(
    page.getByRole('article').getByRole('heading', { level: 1, name: 'Rapport de portefeuille' }),
  ).toBeVisible();
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Télécharger le PDF' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^cout-revient-ch-rapport-\d{4}-\d{2}-\d{2}\.pdf$/);
  const path = await file.path();
  expect(statSync(path).size).toBeGreaterThan(10_000);
  expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
});

test('sauvegarde JSON → effacement → restauration : mêmes totaux', async ({ page }) => {
  await openDemo(page);
  const totals = page.locator('section.summary .big');
  await expect(totals).toHaveCount(3);
  const before = await totals.allTextContents();

  await page.goto('#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger une sauvegarde (JSON)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^demo-cout-revient-ch-sauvegarde-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const backupPath = await file.path();

  await page.getByRole('button', { name: 'Effacer toutes les données' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Effacer', exact: true }).click();
  await expect(page).toHaveURL(/#\/welcome$/);

  await page.goto('#/settings');
  await page.getByLabel('Mode de restauration').selectOption('replace');
  await page.setInputFiles('input[type="file"][accept*="json"]', backupPath);
  await expect(page.getByText('Sauvegarde restaurée.')).toBeVisible();
  await expect(page).toHaveURL(/#\/$/); // restauration → Vue d'ensemble
  await page.goto('#/invest'); // la synthèse (section.summary) vit dans l'espace Investissement
  await expect(totals).toHaveCount(3);
  expect(await totals.allTextContents()).toEqual(before);
});
