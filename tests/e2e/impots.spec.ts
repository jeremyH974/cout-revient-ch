/**
 * L'écran « Impôts » (décision n° 170).
 *
 * **Le relevé eToro, et non le jeu de démonstration crypto** : hors ligne, l'historique des cours
 * ne se charge pas, donc la partie crypto resterait vide et tout passerait au vert sur une page
 * sans un seul montant (défaut de la décision n° 145). Le relevé de titres, lui, produit l'option
 * 2OP sans aucune cotation.
 *
 * Ce qui est vérifié n'est pas qu'un bloc s'affiche, mais que **les chiffres se recoupent** : le
 * total de chaque carte est la somme de ses deux lignes, les prélèvements sociaux sont identiques
 * des deux côtés, et l'écart annoncé est bien la différence des deux impôts.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ETORO_FIXTURE, normalize } from './helpers/expected';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

async function importTitles(page: Page): Promise<void> {
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', ETORO_FIXTURE);
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();
}

/**
 * Ouvre l'écran sur la première année qui a quelque chose à arbitrer. Le millésime de la fixture
 * bouge avec la date du jour : figer une année ferait passer le test au vert sur une page vide.
 */
async function openYearWithAmounts(page: Page): Promise<string> {
  await page.goto('#/impots');
  await expect(page.getByRole('heading', { level: 1, name: 'Forfait ou barème' })).toBeVisible();
  const select = page.getByLabel('Année');
  const years = await select.locator('option').allTextContents();
  for (const year of years) {
    await select.selectOption(year);
    if ((await page.locator('.option').count()) > 0) return year;
  }
  throw new Error(`aucune année à arbitrer (essayées : ${years.join(', ')})`);
}

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

test('les deux colonnes se recoupent, et l’écart est bien leur différence', async ({ page }) => {
  await importTitles(page);
  const year = await openYearWithAmounts(page);

  // 1. Sans hypothèse de foyer, aucun chiffrage : l'application ne devine pas la tranche.
  await expect(page.getByText('Indiquez votre tranche ou votre revenu')).toBeVisible();
  await expect(page.locator('.duel')).toHaveCount(0);

  await page.getByRole('radio', { name: '30 %' }).check();
  const duel = page.locator('.duel').first();
  await expect(duel).toBeVisible();

  const cards = duel.locator('.side');
  await expect(cards).toHaveCount(2);

  const totals: number[] = [];
  const socials: number[] = [];
  const incomes: number[] = [];
  for (const card of await cards.all()) {
    const total = euros(await card.locator('.total').innerText());
    const [income, social] = await amounts(card.locator('.split'));
    // 2. Le total affiché est la somme des deux lignes affichées, au centime.
    expect(Math.round(total * 100), `total de « ${await card.locator('h3').innerText()} »`).toBe(
      Math.round(((income ?? 0) + (social ?? 0)) * 100),
    );
    totals.push(total);
    incomes.push(income ?? 0);
    socials.push(social ?? 0);
  }

  // 3. Les prélèvements sociaux sont le MÊME montant des deux côtés : c'est ce que l'écran dit.
  expect(socials[0], `année ${year}`).toBe(socials[1]);
  expect(totals[0]).not.toBe(undefined);

  // 4. L'écart annoncé est la différence des deux impôts sur le revenu, pas autre chose.
  const gap = euros(await page.locator('.gap').first().innerText());
  expect(Math.round(gap * 100)).toBe(
    Math.abs(Math.round(((incomes[1] ?? 0) - (incomes[0] ?? 0)) * 100)),
  );

  // 5. La ligne « la vôtre » du tableau porte EXACTEMENT ce chiffre. Deux montants qui se
  //    contredisent d'un centime à trois lignes d'écart feraient douter de tout l'écran.
  const ladder = page.locator('.ladder').first();
  await ladder.getByText('Où ça bascule').click();
  const mine = await amounts(ladder.locator('tr.yours'));
  expect(Math.abs(Math.round((mine[mine.length - 1] ?? 0) * 100)), 'ligne « la vôtre »').toBe(
    Math.round(gap * 100),
  );
});

test('l’échelle marque une seule tranche « la vôtre » et une seule bascule', async ({ page }) => {
  await importTitles(page);
  await openYearWithAmounts(page);
  await page.getByRole('radio', { name: '41 %' }).check();

  const ladder = page.locator('.ladder').first();
  await ladder.getByText('Où ça bascule').click();
  const rows = ladder.locator('tbody');
  await expect(rows.locator('tr')).toHaveCount(5);
  // Dans le TABLEAU seul : le mot « bascule » est aussi dans le titre du volet.
  await expect(rows.getByText('la vôtre')).toHaveCount(1);
  await expect(rows.getByText('bascule')).toHaveCount(1);
  // La tranche marquée est bien celle qui a été choisie.
  await expect(ladder.locator('tr.yours th')).toContainText('41');
});

test('le mode « revenu » applique le barème au foyer, et le dit', async ({ page }) => {
  await importTitles(page);
  await openYearWithAmounts(page);
  await page.getByRole('radio', { name: '30 %' }).check();
  const avant = await amounts(page.locator('.side').nth(1).locator('.split'));

  await page.getByRole('radio', { name: 'Je saisis mon revenu' }).check();
  await expect(page.getByText('Renseignez le revenu et les parts')).toBeVisible();

  // Un revenu qui laisse le foyer dans la tranche à 0 % : l'impôt sous barème doit tomber.
  await page.getByLabel('Revenu imposable du foyer').fill('5000');
  await page.getByLabel('Parts').selectOption('1');
  await expect(page.getByText(/Votre tranche : 0/)).toBeVisible();

  const apres = await amounts(page.locator('.side').nth(1).locator('.split'));
  expect(apres[0], 'le barème à 0 % ne prélève aucun impôt').toBe(0);
  expect(avant[0], 'le barème à 30 % en prélevait').toBeGreaterThan(0);
  // Les prélèvements sociaux, eux, n'ont pas bougé d'un centime.
  expect(apres[1]).toBe(avant[1]);
});

test('l’année en cours s’annonce comme provisoire', async ({ page }) => {
  await importTitles(page);
  await page.goto('#/impots');
  const current = new Date().getFullYear();
  await page.getByLabel('Année').selectOption(String(current));
  await expect(page.getByText('Année en cours — provisoire')).toBeVisible();
  await expect(page.getByText(`À déclarer au printemps ${current + 1}`)).toBeVisible();
});

test('l’écran ne recommande jamais de cocher', async ({ page }) => {
  // La frontière que ce projet tient : chiffrer un écart à une hypothèse donnée n'est pas conseiller.
  await importTitles(page);
  await openYearWithAmounts(page);
  await page.getByRole('radio', { name: '30 %' }).check();
  const text = (await page.locator('main').innerText()).toLowerCase();
  for (const phrase of [
    'vous devriez',
    'nous vous conseillons',
    'cochez la case',
    'il faut cocher',
    'nous recommandons',
    'choisissez le',
  ])
    expect(text, phrase).not.toContain(phrase);
});
