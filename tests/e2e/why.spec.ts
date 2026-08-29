/**
 * « Pourquoi ce chiffre ? » (P61) : le PRU affiché sur la fiche actif doit s'expliquer jusqu'aux
 * lignes brutes de l'export. Comme partout ici, l'écran est comparé au MOTEUR et jamais à un
 * chiffre codé en dur — sans quoi le test finirait par valider une régression avec conviction.
 */
import { expect, test, type Locator } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { fixtureReport, moneyText, normalize, position, pruText } from './helpers/expected';
import { stubNetwork } from './helpers/network';

const MASK = '••••';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** Numéros de ligne affichés par l'arbre (« Ligne 42 »), dans l'ordre du DOM. */
async function shownLineNumbers(sheet: Locator): Promise<number[]> {
  const labels = await sheet.getByText(/^Ligne \d+$/).allInnerTexts();
  return labels.map((text) => Number(/\d+/.exec(text)?.[0] ?? '0'));
}

test('le PRU s’explique jusqu’aux lignes brutes, et le mode discret garde la structure', async ({
  page,
}) => {
  const { report, rows } = fixtureReport();
  const btc = position(report, 'btc');
  await openDemo(page);
  await page.goto('#/asset/btc');
  await expect(page.getByRole('heading', { level: 1, name: 'BTC' })).toBeVisible();

  // Le déclencheur est le montant lui-même : pas d'icône « ? » ajoutée à côté.
  const hero = page.locator('header.hero');
  const trigger = hero.locator('button.why').first();
  // Le nom accessible du bouton est le PRU lui-même ; « Pourquoi ce chiffre ? » est une
  // description, jamais du texte inséré dans le montant.
  await expect(trigger).toHaveAccessibleName(pruText(btc));
  await expect(trigger).toHaveAccessibleDescription('Pourquoi ce chiffre ?');
  await hero.locator('button.why').first().click();

  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'D’où vient ce PRU ?' })).toBeVisible();

  // La racine porte EXACTEMENT le PRU calculé par le moteur sur la fixture.
  await expect(sheet).toContainText(pruText(btc));
  // Et le coût des unités détenues, qui en est le numérateur.
  await expect(sheet).toContainText(moneyText(btc.costBasis));
  // Le bouclage est annoncé : l'explication est complète.
  await expect(sheet).toContainText('retombent exactement');

  await sheet.getByRole('button', { name: 'Tout déplier' }).click();

  // Les numéros de ligne cités sont ceux du fichier importé — comparés à la fixture, pas au hasard.
  const fixtureLines = new Set(rows.map((r) => r.lineNo));
  const shown = await shownLineNumbers(sheet);
  expect(shown.length).toBeGreaterThan(0);
  for (const line of shown) expect(fixtureLines.has(line)).toBe(true);

  // La jambe retenue est nommée : c'est toute la valeur ajoutée face à la règle d'or.
  await expect(sheet).toContainText('jambe contrepartie retenue');

  // Mode discret : les montants disparaissent, la structure reste. La feuille est MODALE : on la
  // ferme pour basculer, puis on la rouvre — le geste réel de qui s'apprête à montrer son écran.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.getByRole('button', { name: 'Mode discret (masquer les montants)' }).click();
  await hero.locator('button.why').first().click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Tout déplier' }).click();

  await expect(sheet).toContainText(MASK);
  await expect(sheet).not.toContainText(moneyText(btc.costBasis));
  expect(await shownLineNumbers(sheet)).toEqual(shown);
  await expect(sheet).toContainText('Type brut');
  await expect(sheet).toContainText('jambe contrepartie retenue');
  await expect(sheet).toContainText('retombent exactement');
  // Le PRU est un prix, pas un montant patrimonial : il reste lisible, comme partout ailleurs.
  await expect(sheet).toContainText(pruText(btc));
});

test('la traçabilité du réalisé montre les lots consommés par chaque cession', async ({ page }) => {
  const { report } = fixtureReport();
  const btc = position(report, 'btc');
  test.skip(btc.realized.eq('0'), 'la fixture n’a pas de cession sur BTC');
  await openDemo(page);
  await page.goto('#/asset/btc');
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Calcul' })
    .click();

  const trigger = page.locator('section', { hasText: 'Réalisé' }).locator('button.why').last();
  await trigger.click();

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'D’où vient ce réalisé ?' })).toBeVisible();
  await expect(sheet).toContainText(normalize('produit − coût des lots consommés'));
  await sheet.getByRole('button', { name: 'Tout déplier' }).click();
  await expect(sheet.getByText('Coût de ce qui a été cédé').first()).toBeVisible();
  await expect(sheet.getByText(/^Lot du \d{2}\/\d{2}\/\d{4}$/).first()).toBeVisible();
  await expect(sheet).toContainText('retombent exactement');
});
