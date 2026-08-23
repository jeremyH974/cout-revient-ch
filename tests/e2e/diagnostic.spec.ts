import { expect, test } from '@playwright/test';
import { BASE_URL } from '../../playwright.config';
import { openDemo } from './helpers/demo';
import { fixtureReport } from './helpers/expected';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('« Copier le diagnostic » met un texte sans montant dans le presse-papiers', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'lecture du presse-papiers : Chromium seulement');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(BASE_URL).origin,
  });
  const { rows } = fixtureReport();
  await openDemo(page);
  await page.goto('#/settings');
  await page.getByRole('button', { name: 'Copier le diagnostic' }).click();
  await expect(page.getByText('Diagnostic copié')).toBeVisible();

  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Coût de revient CH — diagnostic');
  expect(text).toMatch(/Version : \d+\.\d+\.\d+ \(build /);
  expect(text).toContain('format coinhouse-2026-08');
  expect(text).toContain("Types d'opérations : Echange ×196");
  expect(text).toContain('Logos : ');
  expect(text).not.toMatch(/€/);
  for (const row of rows.slice(0, 50)) {
    if (row.qty.includes('.')) expect(text).not.toContain(row.qty.replace('-', ''));
  }
});
