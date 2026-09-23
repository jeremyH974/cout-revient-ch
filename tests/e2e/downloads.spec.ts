import { readFileSync, statSync } from 'node:fs';
import { openSettingsSection } from './helpers/settings';
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

  await openSettingsSection(page, 'danger');
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

/**
 * La preuve de bout en bout de la décision n° 76 : le fichier réellement téléchargé, pas la
 * fonction qui l'écrit.
 *
 * Un libellé de compte est du texte que l'utilisateur choisit. S'il commence par `=`, Excel
 * l'exécute à l'ouverture du CSV. On crée donc un compte nommé `=1+1`, on y rattache une saisie
 * pour qu'il apparaisse dans l'export des opérations, et on inspecte la cellule produite.
 */
test('un libellé de compte en forme de formule ressort désarmé du CSV', async ({ page }) => {
  await page.goto('#/accounts');
  await page.getByLabel('Nom du compte', { exact: true }).fill('=1+1');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

  // Une opération rattachée : sans elle, le compte n'a aucune ligne dans l'export.
  await page.goto('#/invest/add');
  await page.locator('input[type="datetime-local"]').evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, '2026-01-01T10:00:00');
  await page.getByLabel('Actif').fill('trx');
  await page.getByLabel('Quantité').fill('100');
  await page.getByLabel(/Total payé en €/).fill('50');
  await page.getByLabel('Compte').selectOption({ label: '=1+1' });
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

  await page.goto('#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Opérations avec PRU (CSV)' }).click();
  const content = readFileSync(await (await download).path(), 'utf8');

  expect(content, 'le libellé n’apparaît pas : le test ne prouverait rien').toContain('1+1');
  expect(content, 'une cellule commence par « = » : Excel l’exécuterait').not.toContain('"=1+1"');
  expect(content, 'la garde n’a pas été appliquée').toContain(String.raw`"'=1+1"`);
});

/**
 * L'annexe 2086 se remplit POUR UNE ANNÉE. Le Rapport dérivait la sienne de l'instant de
 * génération — donc au printemps il décrivait l'année en cours au lieu de celle qu'on déclare — et
 * l'export déversait tous les millésimes d'un coup (décision n° 141).
 *
 * Ce parcours garde le maillon que ni `cessionsToCsv` ni `declarationYear` ne couvrent : que
 * l'écran passe bien l'année CHOISIE, et non une autre.
 */
test('l’annexe 2086 ne porte que l’année choisie', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/report');
  const picker = page.getByLabel('Année');
  await expect(picker).toBeVisible();

  const years = await picker
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(years.length).toBeGreaterThan(1);
  // Décroissantes : la plus récente en tête, comme `declarableYears` les rend.
  expect([...years].sort((a, b) => Number(b) - Number(a))).toEqual(years);

  for (const year of years) {
    await picker.selectOption(year);
    // Le SÉLECTEUR nomme le printemps où l'année choisie se déclare. « Année déclarée 2026 »
    // laissait croire à une déclaration déposée EN 2026, donc aux revenus 2025 : la phrase ferme
    // la double lecture, et ce parcours la tient sur chaque millésime proposé.
    //
    // Restreint au sélecteur, et pas à la page : la page de garde porte la MÊME phrase, et une
    // recherche globale passait au vert alors que le sélecteur avait perdu la sienne — la
    // contre-épreuve (décision n° 75) l'a montré avant que ce garde-fou ne serve.
    await expect(
      page.locator('.tax-year').getByText(`Elle se déclare au printemps ${Number(year) + 1}`),
    ).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Cessions au format 2086 (CSV)' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toContain(`-2086-${year}-`);

    const content = readFileSync(await file.path(), 'utf8');
    const rows = content.trimEnd().split('\r\n').slice(1);
    for (const row of rows) {
      // Première colonne : la date de la cession, en jj/mm/aaaa.
      expect(row.slice(0, 12)).toContain(`/${year}`);
    }
  }
});
