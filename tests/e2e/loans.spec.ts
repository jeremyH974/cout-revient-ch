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

// --- Contrats : une archive fabriquée ici, pour éprouver le câblage de l'écran ----------------

/** Latin-1 : un PDF WinAnsi code un octet par caractère, jamais de l'UTF-8. */
function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function contractPdf(sentences: readonly string[]): Uint8Array {
  const content = latin1(`BT /F1 12 Tf 1 0 0 1 10 700 Tm (${sentences.join(') Tj (')}) Tj ET`);
  const head = latin1(
    [
      '%PDF-1.7',
      '1 0 obj',
      '<< /Font << /F1 2 0 R >> >>',
      'endobj',
      '2 0 obj',
      '<< /Type /Font /Subtype /Type1 /Encoding /WinAnsiEncoding >>',
      'endobj',
      '3 0 obj',
      `<< /Length ${content.length} >>`,
      'stream',
      '',
    ].join('\n'),
  );
  const tail = latin1('\nendstream\nendobj\n%%EOF\n');
  const out = new Uint8Array(head.length + content.length + tail.length);
  out.set(head, 0);
  out.set(content, head.length);
  out.set(tail, head.length + content.length);
  return out;
}

/** Archive « stockée », CRC nul : le lecteur ne le vérifie pas. */
function storedZip(name: string, data: Uint8Array): Buffer {
  const raw = new TextEncoder().encode(name);
  const buffer = new ArrayBuffer(76 + raw.length * 2 + data.length + 22);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint32(18, data.length, true);
  view.setUint32(22, data.length, true);
  view.setUint16(26, raw.length, true);
  bytes.set(raw, 30);
  bytes.set(data, 30 + raw.length);
  const directoryAt = 30 + raw.length + data.length;
  view.setUint32(directoryAt, 0x02014b50, true);
  view.setUint32(directoryAt + 20, data.length, true);
  view.setUint32(directoryAt + 24, data.length, true);
  view.setUint16(directoryAt + 28, raw.length, true);
  view.setUint32(directoryAt + 42, 0, true);
  bytes.set(raw, directoryAt + 46);
  const eocd = directoryAt + 46 + raw.length;
  view.setUint32(eocd, 0x06054b50, true);
  view.setUint16(eocd + 8, 1, true);
  view.setUint16(eocd + 10, 1, true);
  view.setUint32(eocd + 12, eocd - directoryAt, true);
  view.setUint32(eocd + 16, directoryAt, true);
  return Buffer.from(bytes.subarray(0, eocd + 22));
}

const CONTRACT = contractPdf([
  'Le taux fixe annuel de 12 %.',
  "Ces intérêts sont calculés sur la base d'une année civile.",
]);

test('un contrat complete le pret : les interets courus cessent d etre hors de portee', async ({
  page,
}) => {
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await page.goto('#/invest/loans');
  // Le constat vit dans un bloc repliable : il faut l'ouvrir pour le voir.
  await page.getByText('Comment lire ces chiffres').click();
  // Sans contrat, le moteur DIT qu'il ne peut pas calculer les courus.
  await expect(page.getByText(/intérêts courus non échus ne sont pas comptés/)).toBeVisible();

  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', {
    name: 'contracts.zip',
    mimeType: 'application/zip',
    buffer: storedZip('C-001.pdf', CONTRACT),
  });
  const card = page.locator('section', { hasText: 'Contrats lus' });
  await expect(card.getByRole('heading', { name: 'Contrats lus' })).toBeVisible();
  // Un seul prêt de la fixture porte ce numéro de contrat.
  await expect(card).toContainText('1 prêt(s) complété(s)');

  await page.goto('#/invest/loans');
  await page.getByText('Comment lire ces chiffres').click();
  await expect(page.getByText(/intérêts courus non échus ne sont pas comptés/)).toHaveCount(0);
});

test('avec des prêts et AUCUNE crypto, l’écran Prêts reste atteignable par l’interface', async ({
  page,
}) => {
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole('heading', { name: 'Prêts importés' })).toBeVisible();

  // `hasData` ne compte que la crypto : un compte qui n'a QUE des prêts est renvoyé à l'accueil.
  await page.goto('#/');
  await expect(page.getByRole('heading', { level: 1, name: /PRU par crypto/ })).toBeVisible();

  // Depuis l'accueil, un lien direct.
  await page.getByRole('link', { name: /Voir mes \d+ prêts/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Prêts' })).toBeVisible();

  // Et par la navigation principale, sans connaître l'adresse.
  await page.goto('#/');
  await page.getByRole('link', { name: 'Plus' }).click();
  await page.getByRole('link', { name: 'Prêts' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Prêts' })).toBeVisible();
  await expect(page.locator('.headline')).toContainText(eur(summary.value));
});

test('avec de la crypto ET des prêts, le portefeuille porte une passerelle vers les prêts', async ({
  page,
}) => {
  // Un export Coinhouse d'abord : sans lui, l'écran Portefeuille renvoie à l'accueil.
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', 'tests/fixtures/coinhouse/export-demo.csv');
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole('heading', { name: 'Prêts importés' })).toBeVisible();

  await page.goto('#/invest');
  const bridge = page.locator('a.bridge');
  await expect(bridge).toContainText('Prêts');
  await expect(bridge).toContainText(eur(summary.value));
  await bridge.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Prêts' })).toBeVisible();
});
