/**
 * L'addition de l'écran « Impôts » (décision n° 173).
 *
 * **Le relevé eToro, et non le jeu de démonstration crypto** : hors ligne, l'historique des cours
 * ne se charge pas, la partie crypto resterait vide et tout passerait au vert sur une page sans un
 * seul montant (défaut de la décision n° 145). Le relevé de titres produit l'option 2OP sans
 * aucune cotation — et, avec ses dividendes, un crédit d'impôt à déduire.
 *
 * Ce qui est vérifié n'est pas qu'une carte s'affiche, mais que **les chiffres se recoupent dans
 * les deux sens** : le solde est la somme de ses propres lignes, et ses lignes « dues » sont les
 * totaux des cartes comparatives, au centime. Un écran qui ne tient pas cette double égalité ne
 * sert à rien : on ne peut pas refaire son calcul.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ETORO_FIXTURE, normalize } from './helpers/expected';
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

const cents = (value: number): number => Math.round(value * 100);

/** Importe les titres, ouvre l'écran sur une année qui a quelque chose à arbitrer, pose la tranche. */
async function openBill(page: Page): Promise<Locator> {
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', ETORO_FIXTURE);
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();

  await page.goto('#/impots');
  const select = page.getByLabel('Année');
  // Le millésime de la fixture bouge avec la date du jour : figer une année ferait passer le test
  // au vert sur une page vide.
  for (const year of await select.locator('option').allTextContents()) {
    await select.selectOption(year);
    if ((await page.locator('.option').count()) > 0) break;
  }
  await page.getByRole('radio', { name: '30 %' }).check();
  const bill = page.locator('.bill');
  await expect(bill).toBeVisible();
  return bill;
}

/** Somme des montants d'une colonne, en centimes — l'unité où l'égalité doit être exacte. */
async function sumColumn(rows: Locator): Promise<number> {
  let total = 0;
  for (const row of await rows.all()) total += cents((await amounts(row))[0] ?? 0);
  return total;
}

test('le solde vaut la somme de ses lignes, et ses lignes valent les cartes', async ({ page }) => {
  const bill = await openBill(page);

  // On impose le forfait des deux côtés : l'égalité avec les cartes doit se lire sans deviner
  // quelle voie le défaut a retenue.
  for (const select of await bill.locator('select').all())
    await select.selectOption('Prélèvement forfaitaire');

  const dues = bill.locator('tbody tr:not(.settled)');
  const all = bill.locator('tbody tr');
  const solde = cents((await amounts(bill.locator('tfoot tr')))[0] ?? 0);

  // 1. Le solde est exactement la somme des lignes affichées — arrondis compris.
  expect(await sumColumn(all), 'somme des lignes').toBe(solde);

  // 2. Les lignes dues sont, au centime, les totaux des cartes comparatives.
  let cards = 0;
  for (const option of await page.locator('.option').all()) {
    const flat = option.locator('.side').filter({ hasText: 'Prélèvement forfaitaire' });
    cards += cents((await amounts(flat.locator('.total')))[0] ?? 0);
  }
  expect(await sumColumn(dues), 'lignes dues contre cartes').toBe(cards);

  // 3. Les lignes déjà réglées sont négatives : elles se retranchent, elles ne s'ajoutent pas.
  for (const row of await bill.locator('tbody tr.settled').all())
    expect((await amounts(row))[0] ?? 0, 'une ligne déjà réglée').toBeLessThan(0);
});

test('changer de voie déplace le solde de l’écart annoncé, et pas d’un centime de plus', async ({
  page,
}) => {
  const bill = await openBill(page);
  const select = bill.locator('select').first();
  const solde = async (): Promise<number> =>
    cents((await amounts(bill.locator('tfoot tr')))[0] ?? 0);

  await select.selectOption('Prélèvement forfaitaire');
  const atFlat = await solde();
  await select.selectOption('Barème progressif');
  const atScale = await solde();

  // L'écart que la carte annonce est celui que le solde encaisse : sinon, deux chiffres du même
  // écran diraient deux choses.
  const gap = cents((await amounts(page.locator('.option').first().locator('.gap')))[0] ?? 0);
  expect(Math.abs(atScale - atFlat), 'écart encaissé par le solde').toBe(gap);
});

test('l’étalement du solde suit le seuil de 300 €, dans les deux sens', async ({ page }) => {
  const bill = await openBill(page);
  const solde = cents((await amounts(bill.locator('tfoot tr')))[0] ?? 0);
  const when = normalize(await bill.locator('.when').innerText());

  if (solde > 30_000) {
    expect(when, 'au-delà de 300 €').toContain('4 prélèvements');
  } else if (solde > 0) {
    expect(when, 'jusqu’à 300 €').toContain('en une fois');
  } else {
    expect(when).toMatch(/restitué|déclarer/);
  }
});

test('l’addition ne recommande jamais rien, et dit ce qu’elle n’est pas', async ({ page }) => {
  const bill = await openBill(page);
  const text = (await bill.innerText()).toLowerCase();
  for (const phrase of [
    'vous devriez',
    'nous vous conseillons',
    'il vaut mieux',
    'nous recommandons',
    'pensez à cocher',
    'cochez la case',
  ])
    expect(text, phrase).not.toContain(phrase);

  await expect(
    bill.getByText('ne constitue ni une déclaration, ni un conseil'),
    'la mise en garde, près du résultat',
  ).toBeVisible();
  await expect(
    bill.getByText('jamais une recommandation de cocher'),
    '« la moins chère » est un constat',
  ).toBeVisible();
});

test('l’année des gains et l’année du règlement ne se confondent pas', async ({ page }) => {
  // « Combien vais-je payer l'an prochain ? » : la carte doit dire N+1, jamais N. L'année se lit
  // sur le sélecteur plutôt que sur l'horloge — le millésime de la fixture bouge avec la date.
  const bill = await openBill(page);
  const year = Number(await page.getByLabel('Année').inputValue());
  const when = normalize(await bill.locator('.when').innerText());
  expect(when, 'la déclaration tombe l’année suivante').toContain(String(year + 1));
  expect(
    normalize(await bill.locator('.headline').innerText()),
    'le titre porte l’année des gains',
  ).toContain(String(year));
});
