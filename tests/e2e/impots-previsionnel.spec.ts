/**
 * Le prévisionnel de l'écran « Impôts » (décision n° 171).
 *
 * **Le jeu de démonstration crypto, et non le relevé de titres** : le prévisionnel a besoin du
 * grand livre des cessions, donc de l'historique quotidien des cours. Celui-ci ne se charge qu'en
 * passant par le Rapport — comme pour le simulateur de vente (`alerts.spec.ts`).
 *
 * Ce qui est vérifié n'est pas qu'un bloc s'affiche, mais que **les chiffres se recoupent** : le
 * total des cessions d'après est celui d'avant plus le montant saisi, à l'euro près, et l'écart de
 * la colonne le dit.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { normalize } from './helpers/expected';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** « 1 234,56 € » → 1234.56 */
function euros(text: string): number {
  return Number(
    normalize(text)
      .replace(/[^\d,-]/g, '')
      .replace(',', '.'),
  );
}

async function amounts(scope: Locator): Promise<number[]> {
  const text = normalize(await scope.innerText());
  return [...text.matchAll(/([+-]?[\d ]+,\d{2}) €/g)].map((m) => euros(m[0]));
}

/** Charge la démo, puis l'historique des cours, puis ouvre l'écran sur l'année en cours. */
async function openForecast(page: Page): Promise<Locator> {
  await openDemo(page);
  // Le Rapport déclenche le chargement de l'historique quotidien, dont dépend le grand livre.
  await page.goto('#/invest/report');
  await expect(page.getByText('Fiscalité française (estimation)')).toBeVisible({ timeout: 30_000 });

  await page.goto('#/impots');
  await page.getByLabel('Année').selectOption(String(new Date().getFullYear()));
  const block = page.locator('.forecast');
  await expect(block).toBeVisible();
  return block;
}

test('le prévisionnel ne propose aucun montant, et ses colonnes se recoupent', async ({ page }) => {
  const block = await openForecast(page);
  const montant = block.getByLabel('Montant de la vente, net de frais');

  // 1. Le champ part VIDE : un défaut se lirait comme une recommandation de montant.
  await expect(montant).toHaveValue('');
  await expect(block.getByText('L’application n’en propose aucun')).toBeVisible();
  await expect(block.locator('table')).toHaveCount(0);

  // Plusieurs montants plutôt qu'un seul : l'accord au centime entre le titre et le tableau ne
  // tombe en défaut que sur un demi-centime, et un montant unique passerait à côté par chance.
  for (const saisi of ['1000', '2000', '1234.56']) {
    await montant.fill(saisi);
    const cessions = block.locator('tbody tr').first();
    await expect(cessions).toBeVisible();
    const [avant, apres, ecart] = await amounts(cessions);

    // 2. La vente ajoute exactement son montant au total des cessions de l'année.
    expect(Math.round(((apres ?? 0) - (avant ?? 0)) * 100), `cessions, ${saisi} €`).toBe(
      Math.round(Number(saisi) * 100),
    );

    // 3. La colonne « Écart » dit la même chose que la soustraction des deux autres.
    expect(Math.round((ecart ?? 0) * 100), `écart, ${saisi} €`).toBe(
      Math.round(((apres ?? 0) - (avant ?? 0)) * 100),
    );

    // 4. Le titre annonce EXACTEMENT ce que la ligne « Résultat de l'année » montre.
    const verdict = await amounts(block.locator('.verdict'));
    const resultat = await amounts(block.locator('tbody tr').nth(1));
    expect(
      Math.abs(Math.round(((resultat[1] ?? 0) - (resultat[0] ?? 0)) * 100)),
      `titre, ${saisi} €`,
    ).toBe(Math.round((verdict[0] ?? 0) * 100));
  }
});

test('une vente plus grande que le portefeuille est refusée, pas chiffrée', async ({ page }) => {
  const block = await openForecast(page);
  // La valeur globale affichée est celle du portefeuille : on en demande le double.
  const globale = euros(
    await block.getByLabel('Valeur de votre portefeuille avant la vente').inputValue(),
  );
  expect(globale, 'le portefeuille de démonstration a une valeur').toBeGreaterThan(0);

  await block.getByLabel('Montant de la vente, net de frais').fill(String(Math.ceil(globale * 2)));
  await expect(block.getByText('On ne cède pas plus que ce que l’on détient')).toBeVisible();
  await expect(block.locator('table')).toHaveCount(0);
});

test('une année close n’a pas de prévisionnel : elle ne se simule plus', async ({ page }) => {
  await openForecast(page);
  await page.getByLabel('Année').selectOption(String(new Date().getFullYear() - 1));
  await expect(page.locator('.forecast')).toHaveCount(0);
});

test('le prévisionnel ne recommande jamais de vendre', async ({ page }) => {
  // La frontière du projet : chiffrer une hypothèse fournie n'est pas conseiller. Un simulateur
  // de vente en fin d'année est l'endroit exact où le vocabulaire dérape.
  const block = await openForecast(page);
  await block.getByLabel('Montant de la vente, net de frais').fill('1000');
  const text = (await page.locator('main').innerText()).toLowerCase();
  for (const phrase of [
    'vous devriez',
    'nous vous conseillons',
    'il vaut mieux vendre',
    'profitez-en',
    'avant qu’il ne soit trop tard',
    'nous recommandons',
    'pensez à vendre',
  ])
    expect(text, phrase).not.toContain(phrase);
  // Et il dit ce qu'il est, près du résultat plutôt qu'en mentions légales.
  await expect(block.getByText('ne constitue ni une déclaration, ni un conseil')).toBeVisible();
});
