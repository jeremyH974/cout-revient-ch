/**
 * Écran Prêts : import d'un export BienPrêter par l'interface, chiffres recalculés par le moteur
 * (jamais de littéraux), persistance après rechargement, et les deux règles de présentation —
 * le capital prêté n'est pas en tête, et le régime de prélèvement se lit dans le tableau fiscal.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { computeLending } from '../../src/lib/domain/lending/compute';
import { lendingSummary } from '../../src/lib/domain/lending/summary';
import { lendingTaxFr } from '../../src/lib/domain/lending/tax-fr';
import { D } from '../../src/lib/domain/money';
import { fmtMoney, fmtRatio } from '../../src/lib/format/fr';
import { parseBienPreter } from '../../src/lib/import/bienpreter/parse';
import { parseCsvText } from '../../src/lib/import/csv';
import { normalize } from './helpers/expected';
import { stubNetwork } from './helpers/network';

const FIXTURE = 'tests/fixtures/bienpreter/export-demo.csv';

const parsed = parseBienPreter(parseCsvText(readFileSync(FIXTURE, 'utf8')), 'lend:bienpreter');
// La fixture ne porte ni échéance ni convention de jours : le rapport ne dépend donc pas du jour
// d'observation, et l'attendu reste stable quelle que soit la date d'exécution du test.
const asOf = new Date().toISOString().slice(0, 10);
const report = computeLending({ loans: parsed.loans, events: parsed.events, asOf });
const summary = lendingSummary(report, parsed.wallet);
const tax = lendingTaxFr({ report, events: parsed.events, throughYear: Number(asOf.slice(0, 4)) });

const eur = (value: string): string => normalize(fmtMoney(D(value), 'EUR'));

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('sans données, l’écran dit où trouver l’export au lieu d’afficher des zéros', async ({
  page,
}) => {
  await page.goto('#/invest/loans');
  await expect(page.getByRole('heading', { name: 'Aucun prêt importé' })).toBeVisible();
  await expect(page.getByText(/sans filtre/)).toBeVisible();
  // Aucun chiffre inventé tant que rien n'est importé.
  await expect(page.getByText('Apports nets')).toHaveCount(0);
});

test('import puis lecture : les chiffres de l’écran sont ceux du moteur', async ({ page }) => {
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole('heading', { name: 'Prêts importés' })).toBeVisible();
  // Apostrophe droite ou typographique : le dépôt est mixte, le test ne tranche pas pour lui.
  await page.getByRole('link', { name: /Ouvrir l.écran Prêts/ }).click();

  const headline = page.locator('.headline');
  await expect(headline).toContainText(eur(summary.netContributions));
  await expect(headline).toContainText(eur(summary.value));

  // Le capital prêté n'est PAS en tête : il vit dans le bloc explicatif, avec son facteur de
  // recyclage. C'est la règle de présentation que cette spec existe pour tenir.
  await expect(headline).not.toContainText(eur(summary.principalLent));
  const details = page.getByText(/fois vos apports/);
  await expect(details).toContainText(fmtRatio(D(summary.recycling!), 2));

  // Une variance passe par le composant dédié : signe et équivalent parlé, jamais la couleur seule.
  await expect(page.locator('.delta .sr-only').first()).toHaveText(/hausse|baisse|stable/);

  const rows = report.loans.filter((l) => l.status !== 'repaid' && l.status !== 'written-off');
  await expect(page.getByRole('heading', { name: `Prêts (${rows.length})` })).toBeVisible();
});

test('le tableau fiscal vise la case 2TT et nomme le régime de prélèvement', async ({ page }) => {
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await page.goto('#/invest/loans');

  const block = page.locator('details', { hasText: 'Déclaration de revenus' });
  await block.getByText('Déclaration de revenus — estimation').click(); // ouvre le <details>
  await expect(block).toContainText('2TT');
  await expect(block).toContainText('et non 2TR');
  for (const year of tax.years) {
    await expect(block).toContainText(String(year.year));
    await expect(block).toContainText(eur(year.interestGross));
  }
});

test('les prêts survivent au rechargement', async ({ page }) => {
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole('heading', { name: 'Prêts importés' })).toBeVisible();

  await page.reload();
  await page.goto('#/invest/loans');
  await expect(page.locator('.headline')).toContainText(eur(summary.value));
});
