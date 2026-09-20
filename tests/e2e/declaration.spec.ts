/**
 * L'écran de report, case par case (décision n° 149).
 *
 * **Le relevé eToro, et non le jeu de démonstration crypto** : hors ligne, l'historique des cours
 * ne se charge pas, donc la partie crypto reste absente et l'écran n'aurait que le 3916-bis — une
 * page sans un seul montant, sur laquelle tout passerait au vert sans rien prouver (même défaut
 * que la décision n° 145). Le relevé de titres, lui, produit des montants sans aucun cours.
 */
import { expect, test, type Page } from '@playwright/test';
import { TAX_BOXES } from '../../src/lib/domain/tax-boxes';
import { ETORO_FIXTURE, normalize } from './helpers/expected';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** Dépose le relevé de titres : il remplit 2047, 2DC, 3VG et 2TR sans aucune cotation. */
async function importTitles(page: Page): Promise<void> {
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', ETORO_FIXTURE);
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();
}

/** Les codes affichés, dans l'ordre de la page. */
async function shownCodes(page: Page): Promise<string[]> {
  return page.locator('.lines > li .code').allTextContents();
}

/**
 * Ouvre l'écran sur la première année qui a quelque chose à déclarer.
 *
 * Le millésime de la fixture bouge avec la date du jour : figer une année ici ferait passer le test
 * au vert sur une page vide, ce qui est exactement le défaut de la décision n° 145.
 */
async function openYearWithAmounts(page: Page): Promise<string> {
  await page.goto('#/declaration');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ce qu’il faut reporter' }),
  ).toBeVisible();
  const select = page.getByLabel('Année');
  const years = await select.locator('option').allTextContents();
  for (const year of years) {
    await select.selectOption(year);
    // Une année qui n'a que le 3916-bis n'a AUCUN montant : s'y arrêter rendrait la suite creuse.
    if ((await page.locator('.lines .amounts > li').count()) > 0) return year;
  }
  throw new Error(`aucune année avec un montant à reporter (essayées : ${years.join(', ')})`);
}

test('les cases suivent l’ordre du parcours, et chaque montant s’explique', async ({ page }) => {
  await importTitles(page);
  const year = await openYearWithAmounts(page);

  const codes = await shownCodes(page);
  expect(codes.length, `année ${year}`).toBeGreaterThan(0);

  // 1. L'ordre est celui du registre canonique — la seule chose qui empêche de remplir le 2047
  //    après avoir vérifié 2DC.
  const canonical = TAX_BOXES.map((b) => b.code);
  const shown = codes.map((c) => c.replace(/→.*$/, ''));
  expect(shown).toEqual(canonical.filter((c) => shown.includes(c)));

  // 2. Chaque montant affiché est la somme des termes affichés à côté de lui. C'est ce qui rend le
  //    chiffre contestable : si l'écran additionnait mal, cette ligne rougirait.
  const amounts = page.locator('.lines .amounts > li');
  const count = await amounts.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const row = amounts.nth(i);
    const total = euros(normalize(await row.locator('.amount').innerText()));
    const terms = normalize(await row.locator('.terms').innerText());
    const sum = [...terms.matchAll(/([+-])\s*([\d ]+,\d{2}) €/g)].reduce(
      (acc, m) => acc + (m[1] === '-' ? -1 : 1) * euros(`${m[2] ?? '0'} €`),
      0,
    );
    expect(Math.round(sum * 100), `somme des termes de la ligne ${i}`).toBe(
      Math.round(total * 100),
    );
  }
});

test('une annexe et une case à cocher ne portent aucun montant', async ({ page }) => {
  await importTitles(page);
  await openYearWithAmounts(page);

  const lines = page.locator('.lines > li');
  const count = await lines.count();
  for (let i = 0; i < count; i++) {
    const line = lines.nth(i);
    const kind = await line.locator('.badge.kind').innerText();
    if (kind === 'Case à montant') continue;
    const code = await line.locator('.code').innerText();
    expect(await line.locator('.amount').count(), `${code} (${kind})`).toBe(0);
  }
});

test('le bouton copier met le nombre nu dans le presse-papiers', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'permissions presse-papiers : Chromium seulement');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await importTitles(page);
  await openYearWithAmounts(page);

  const row = page.locator('.lines .amounts > li').first();
  const shown = normalize(await row.locator('.amount').innerText());
  await row.getByRole('button').click();
  await expect(row.getByRole('button')).toHaveText(/^Copié/);

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  // Ce qui part au presse-papiers est le nombre SANS symbole ni séparateur de milliers : collé
  // dans un champ de la déclaration, « 1 234,56 € » ne serait pas accepté.
  expect(clipboard).not.toContain('€');
  expect(clipboard).toMatch(/^\d+,\d{2}$/);
  expect(euros(shown)).toBeCloseTo(Number(clipboard.replace(',', '.')), 2);
});

test('sans donnée, l’écran dit qu’il ne dispense de rien', async ({ page }) => {
  await page.goto('#/declaration');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ce qu’il faut reporter' }),
  ).toBeVisible();
  await expect(page.getByText('Cela ne vaut pas dispense')).toBeVisible();
  await expect(page.locator('.lines')).toHaveCount(0);
});

/**
 * L'arbitrage forfait / barème (décision n° 150). Ce qui est vérifié ici n'est pas qu'un bloc
 * s'affiche, mais que **les chiffres se recoupent entre eux** : l'assiette annoncée est la somme
 * des lignes énumérées, et l'écart affiché est bien la différence des deux branches.
 */
test('l’arbitrage se recoupe, et nomme l’hypothèse dont il dépend', async ({ page }) => {
  await importTitles(page);
  await openYearWithAmounts(page);

  const block = page.locator('.arbitrage').first();
  await expect(block).toBeVisible();

  // 1. Sans tranche indiquée, aucun écart n'est chiffré : l'application ne la devine pas.
  await expect(block.getByText('Indiquez votre tranche d’imposition')).toBeVisible();
  await expect(block.locator('.verdict')).toHaveCount(0);

  // 2. L'assiette annoncée est la somme des lignes énumérées, à l'euro près.
  const intro = normalize(await block.locator('.summary').innerText());
  const [flat, base] = [...intro.matchAll(/([\d ]+,\d{2}) €/g)].map((m) => euros(m[0]));
  const lines = await block.locator('.bases li').allInnerTexts();
  const sum = lines.reduce((acc, line) => {
    const amounts = [...normalize(line).matchAll(/([\d ]+,\d{2}) €/g)];
    return acc + euros(amounts[0]?.[0] ?? '0 €');
  }, 0);
  expect(Math.round(sum * 100), 'somme des assiettes').toBe(Math.round((base ?? 0) * 100));

  // 3. Une fois la tranche choisie, l'écart est bien « barème − forfait ».
  await page.getByLabel('Votre tranche').selectOption('0.30');
  const verdict = normalize(await block.locator('.verdict').innerText());
  const numbers = [...verdict.matchAll(/([+-]?[\d ]+,\d{2}) €/g)].map((m) => euros(m[0]));
  const [bareme, delta] = numbers;
  expect(Math.round(((bareme ?? 0) - (flat ?? 0)) * 100), verdict).toBe(
    Math.round((delta ?? 0) * 100),
  );

  // 4. L'hypothèse et le caractère global de l'option sont dits, pas sous-entendus.
  await expect(block.getByText('Cette option est globale')).toBeVisible();
  await expect(block.getByText(/Le barème coûte moins jusqu’à la tranche à/)).toBeVisible();
});

test('l’écran ne recommande jamais de cocher', async ({ page }) => {
  // La frontière que ce projet tient : chiffrer un écart à une hypothèse donnée n'est pas conseiller.
  await importTitles(page);
  await openYearWithAmounts(page);
  await page.getByLabel('Votre tranche').selectOption('0');
  const text = await page.locator('main').innerText();
  for (const phrase of [
    'vous devriez',
    'nous vous conseillons',
    'cochez la case',
    'il faut cocher',
  ])
    expect(text.toLowerCase(), phrase).not.toContain(phrase);
});

/** « 1 234,56 € » → 1234.56 */
function euros(text: string): number {
  return Number(text.replace(/[^\d,-]/g, '').replace(',', '.'));
}
