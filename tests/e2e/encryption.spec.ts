import { readFileSync } from 'node:fs';
import { openSettingsSection } from './helpers/settings';
import { expect, test } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context, browserName }) => {
  test.skip(browserName !== 'chromium', 'téléchargements : Chromium seulement');
  await stubNetwork(context);
});

test('sauvegarde chiffrée → effacement → restauration avec la phrase secrète', async ({ page }) => {
  test.slow(); // PBKDF2 à 600 000 itérations, deux fois
  await openDemo(page);
  await page.goto('#/invest');
  const totals = page.locator('section.summary .big');
  await expect(totals).toHaveCount(3);
  const before = await totals.allTextContents();

  await page.goto('#/settings');
  await page.getByLabel('Chiffrer la sauvegarde avec une phrase secrète').check();
  await page.getByLabel('Phrase secrète', { exact: true }).fill('correct horse battery');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger une sauvegarde (JSON)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-chiffree\.json$/);
  const backupPath = await file.path();
  const envelope = JSON.parse(readFileSync(backupPath, 'utf8')) as Record<string, unknown>;
  // Argon2id depuis la décision n° 151 : c'est le fichier qui VOYAGE, il ne peut pas garder le KDF
  // le plus faible. Les paramètres voyagent en clair, pour qu'on puisse les relever un jour sans
  // rendre illisible un seul fichier déjà écrit.
  expect(envelope).toMatchObject({ encrypted: true, version: 2, kdf: 'argon2id' });
  expect(envelope['params']).toMatchObject({ m: expect.any(Number), t: expect.any(Number) });
  expect(JSON.stringify(envelope)).not.toContain('rawRows');

  await openSettingsSection(page, 'danger');
  await page.getByRole('button', { name: 'Effacer toutes les données' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Effacer', exact: true }).click();
  await expect(page).toHaveURL(/#\/welcome$/);

  await page.goto('#/settings');
  await page.getByLabel('Mode de restauration').selectOption('replace');
  await page.setInputFiles('input[type="file"][accept*="json"]', backupPath);
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Ce fichier a été chiffré')).toBeVisible();
  // Mauvaise phrase : message d'erreur, rien n'est restauré.
  await sheet.getByLabel('Phrase secrète de la sauvegarde').fill('mauvaise phrase');
  await sheet.getByRole('button', { name: 'Déchiffrer et restaurer' }).click();
  await expect(page.getByText(/Phrase secrète incorrecte/)).toBeVisible();
  await sheet.getByLabel('Phrase secrète de la sauvegarde').fill('correct horse battery');
  await sheet.getByRole('button', { name: 'Déchiffrer et restaurer' }).click();
  await expect(page.getByText('Sauvegarde restaurée.')).toBeVisible();
  await page.goto('#/invest');
  await expect(totals).toHaveCount(3);
  expect(await totals.allTextContents()).toEqual(before);
});
