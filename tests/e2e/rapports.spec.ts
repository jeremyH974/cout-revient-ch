/**
 * Un rapport par espace (P116, décision n° 178).
 *
 * Ce qui est vérifié : que chaque rapport se rejoint depuis la carte qui montre ce qu'il consolide,
 * que les liens entre rapports sont les mêmes dans le même ordre sur chacun (WCAG 2.2 § 3.2.3),
 * que le titre de l'onglet suit la page (§ 2.4.2), et qu'un rapport sans données explique ce qui
 * manque au lieu d'imprimer des zéros. Les montants se comparent au moteur, jamais à un littéral.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { computeLending } from '../../src/lib/domain/lending/compute';
import { lendingSummary } from '../../src/lib/domain/lending/summary';
import { D } from '../../src/lib/domain/money';
import { fmtMoney } from '../../src/lib/format/fr';
import { parseBienPreter } from '../../src/lib/import/bienpreter/parse';
import { parseCsvText } from '../../src/lib/import/csv';
import { openDemo } from './helpers/demo';
import { normalize } from './helpers/expected';
import { stubNetwork } from './helpers/network';

const LENDING = 'tests/fixtures/bienpreter/export-demo.csv';
const APP = 'Coût de revient CH';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** Les titres de section du rapport ouvert, dans l'ordre de la page. */
const sectionTitles = (page: Page): Promise<string[]> =>
  page.locator('article.report section.card > h2').allTextContents();

/** Les liens entre rapports : libellé et marque de la page courante, dans l'ordre. */
async function reportLinks(page: Page): Promise<string[]> {
  const nav = page.getByRole('navigation', { name: 'Rapports' });
  const links = nav.getByRole('link');
  const out: string[] = [];
  for (const link of await links.all())
    out.push(`${await link.innerText()}${(await link.getAttribute('aria-current')) ? ' *' : ''}`);
  return out;
}

test('le rapport de trading se rejoint depuis sa carte, et se suit dans l’ordre', async ({
  page,
}) => {
  await openDemo(page);
  await page.goto('#/trading');
  await page.getByRole('link', { name: /Rapport de trading \(PDF\)/ }).click();

  await expect(
    page.getByRole('article').getByRole('heading', { level: 1, name: 'Rapport de trading' }),
  ).toBeVisible();
  await expect(page).toHaveTitle(`Rapport de trading — ${APP}`);

  const titles = await sectionTitles(page);
  // Les statistiques n'existent que s'il y a des trades : on vérifie la charpente autour d'elles.
  expect(titles[0]).toBe('Synthèse');
  expect(titles.slice(-3)).toEqual(['Comptes', 'Ce que ce document ne dit pas', 'Méthodologie']);
  // Le document dit toujours ce qu'il ne chiffre pas.
  await expect(page.getByText(/contrats perpétuels n’est pas chiffré/)).toBeVisible();

  expect(await reportLinks(page)).toEqual(['Patrimoine', 'Investissement', 'Prêts', 'Trading *']);
});

test('le rapport de prêts reprend les chiffres du moteur, et les mêmes liens', async ({ page }) => {
  const parsed = parseBienPreter(parseCsvText(readFileSync(LENDING, 'utf8')), 'lend:bienpreter');
  const asOf = new Date().toISOString().slice(0, 10);
  const report = computeLending({ loans: parsed.loans, events: parsed.events, asOf });
  const summary = lendingSummary(report, parsed.wallet);
  const eur = (value: string): string => normalize(fmtMoney(D(value), 'EUR'));

  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', LENDING);
  await expect(page.getByRole('heading', { name: 'Prêts importés' })).toBeVisible();
  await page.goto('#/wealth/loans');
  await page.getByRole('link', { name: /Rapport de prêts \(PDF\)/ }).click();

  await expect(
    page.getByRole('article').getByRole('heading', { level: 1, name: 'Rapport de prêts' }),
  ).toBeVisible();
  await expect(page).toHaveTitle(`Rapport de prêts — ${APP}`);
  expect(await sectionTitles(page)).toEqual([
    'Synthèse',
    'Détails du compte',
    'Revenus et pertes',
    'Répartition du risque',
    'Ce que ce document ne dit pas',
    'Méthodologie',
  ]);

  // L'identité de l'écran Prêts, au centime : apports nets et valeur viennent du moteur.
  const summaryCard = page.locator('article.report section.card').first();
  await expect(summaryCard).toContainText(eur(summary.netContributions));
  await expect(summaryCard).toContainText(eur(summary.value));

  expect(await reportLinks(page)).toEqual(['Patrimoine', 'Investissement', 'Prêts *', 'Trading']);
});

test('sans données, un rapport dit ce qui manque au lieu d’imprimer des zéros', async ({
  page,
}) => {
  for (const [hash, back] of [
    ['#/trading/report', 'Aller au trading'],
    ['#/wealth/report', 'Aller aux prêts'],
  ] as const) {
    await page.goto(hash);
    await expect(
      page.getByRole('heading', { name: 'Rien à rapporter pour l’instant' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: back })).toBeVisible();
    // Aucun bouton de téléchargement pour un document qui n'existe pas.
    await expect(page.getByRole('button', { name: 'Télécharger le PDF' })).toHaveCount(0);
    // Les liens vers les autres rapports restent : c'est un repère, pas un contenu.
    await expect(page.getByRole('navigation', { name: 'Rapports' }).getByRole('link')).toHaveCount(
      4,
    );
  }
});

test('le titre de l’onglet suit la page', async ({ page }) => {
  await page.goto('#/impots');
  await expect(page).toHaveTitle(`Impôts — ${APP}`);
  await page.goto('#/wealth/loans');
  await expect(page).toHaveTitle(`Prêts — ${APP}`);
});
