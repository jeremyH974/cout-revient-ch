/**
 * Second avis (P62) : l'écran comparé au moteur, jamais à des chiffres codés en dur.
 *
 * Le fichier déposé n'est pas une fixture : c'est **l'export « Cessions au format 2086 » que
 * l'écran Rapport vient de produire**, éventuellement modifié d'une case. L'aller-retour est donc
 * une vraie garde de cohérence entre deux fonctionnalités qui ont toutes les raisons de dériver
 * l'une de l'autre (un libellé de colonne changé d'un côté, une orthographe non prévue de l'autre).
 *
 * Ce que ces scénarios protègent, dans l'ordre d'importance :
 *
 * 1. **Aucun écart tant que le périmètre n'est pas confirmé** — la garde la plus importante du
 *    produit, et la plus facile à casser par une refonte d'écran.
 * 2. **Notre propre export concorde** ; une seule case modifiée produit un écart, et un seul.
 * 3. **Un export sans chiffres calculés est refusé en le disant**, et propose le repli.
 * 4. **Un format non reconnu nomme les colonnes cherchées** plutôt que d'analyser de travers.
 * 5. **Rien n'est importé** : après un second avis, le portefeuille est inchangé.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

const SCOPE_LABEL = 'Ces deux fichiers portent sur le même périmètre.';

/** Dépose un fichier construit en mémoire sur la zone de dépôt du second avis. */
async function drop(page: Page, name: string, content: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: name.endsWith('.pdf') ? 'application/pdf' : 'text/csv',
    buffer: Buffer.from(content, 'utf8'),
  });
}

/**
 * L'export « Cessions au format 2086 » de l'écran Rapport, tel quel. `null` quand l'estimation
 * fiscale ne produit aucune cession sur le jeu de démonstration : les scénarios qui en dépendent
 * se sautent alors explicitement plutôt que d'inventer un fichier.
 */
async function ourAnnexe2086(page: Page): Promise<string | null> {
  await page.goto('#/invest/report');
  const button = page.getByRole('button', { name: 'Cessions au format 2086 (CSV)' });
  if (!(await button.isVisible().catch(() => false))) return null;
  const download = page.waitForEvent('download');
  await button.click();
  return readFileSync(await (await download).path(), 'utf8');
}

/** Remplace la valeur de la colonne « Plus ou moins-value » de la première ligne de données. */
function tweakFirstGain(csv: string, delta: number): string {
  const lines = csv.replace(/\r\n/g, '\n').trimEnd().split('\n');
  // Le BOM de l'export ne gêne pas : il n'affecte que la PREMIÈRE cellule, et la colonne
  // recherchée ici n'est pas celle-là.
  const header = lines[0]!.split(';');
  const column = header.findIndex((c) => /plus ou moins-value/i.test(c));
  expect(column, `colonne « Plus ou moins-value » absente de ${lines[0]!}`).toBeGreaterThanOrEqual(
    0,
  );
  const cells = lines[1]!.split(';');
  const current = Number(cells[column]!.replace(',', '.'));
  cells[column] = String(current + delta).replace('.', ',');
  lines[1] = cells.join(';');
  return lines.join('\r\n');
}

test('périmètre non confirmé : le fichier est reconnu, mais AUCUN écart n’est affiché', async ({
  page,
}) => {
  await openDemo(page);
  const annexe = await ourAnnexe2086(page);
  test.skip(annexe === null, 'le jeu de démonstration ne produit aucune cession imposable');

  await page.goto('#/invest/second-opinion');
  await expect(page.getByRole('heading', { level: 1, name: 'Second avis' })).toBeVisible();

  // Un fichier volontairement écarté de 1 000 € : s'il était comparé, l'écart sauterait aux yeux.
  await drop(page, 'annexe-2086.csv', tweakFirstGain(annexe!, 1000));
  await expect(page.getByRole('heading', { name: 'Fichier reconnu' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Résultat' })).toHaveCount(0);
  await expect(page.getByText('Écart à examiner')).toHaveCount(0);

  await page.getByLabel(SCOPE_LABEL).check();
  await expect(page.getByRole('heading', { name: 'Résultat' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Écarts à examiner/ })).toBeVisible();
});

test('notre propre export 2086, redéposé : tous les chiffres concordent', async ({ page }) => {
  await openDemo(page);
  const annexe = await ourAnnexe2086(page);
  test.skip(annexe === null, 'le jeu de démonstration ne produit aucune cession imposable');

  await page.goto('#/invest/second-opinion');
  await drop(page, 'annexe-2086.csv', annexe!);
  await page.getByLabel(SCOPE_LABEL).check();

  await expect(
    page.getByRole('heading', { name: 'Tous les chiffres comparés concordent' }),
  ).toBeVisible();
  await expect(page.getByText('Écart à examiner')).toHaveCount(0);
  await expect(
    page.getByText('Ce comparatif n’est pas un audit et ne remplace pas un professionnel.').first(),
  ).toBeVisible();
});

test('une seule case modifiée : un écart, à examiner, et lui seul', async ({ page }) => {
  await openDemo(page);
  const annexe = await ourAnnexe2086(page);
  test.skip(annexe === null, 'le jeu de démonstration ne produit aucune cession imposable');

  await page.goto('#/invest/second-opinion');
  await drop(page, 'annexe-2086.csv', tweakFirstGain(annexe!, 250));
  await page.getByLabel(SCOPE_LABEL).check();

  const group = page.locator('section', {
    has: page.getByRole('heading', { name: /Écarts à examiner/ }),
  });
  await expect(group.locator('li')).toHaveCount(1);
  await expect(group).toContainText('Votre fichier annonce');
  await expect(group).toContainText('Ce moteur calcule');
  // La méthode est imposée par la loi sur une ligne du 2086 : l'écran doit le dire.
  await expect(group).toContainText('imposée par la loi');
  // Aucun nom d'éditeur dans la phrase d'un écart à examiner.
  for (const brand of ['Waltio', 'CoinTracking', 'CoinTracker', 'Koinly', 'Blockpit']) {
    await expect(group).not.toContainText(brand);
  }
});

test('export sans chiffres calculés : refus nommé, et le repli proposé', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/invest/second-opinion');
  await drop(
    page,
    'export-transactions.csv',
    'Blockpit-ID,Timestamp,Transaction Type,Incoming Asset,Outgoing Asset\ndemo-1,15.03.2026 10:00:00,Trade,BTC,EUR\n',
  );
  await expect(page.getByRole('heading', { name: /Aucun chiffre calculé/ })).toBeVisible();
  await expect(page.getByText('le calcul de ce moteur sur leurs données')).toBeVisible();
  await page.getByRole('link', { name: 'Aller à l’écran Importer' }).click();
  await expect(page).toHaveURL(/#\/invest\/import$/);
});

test('format non reconnu : l’écran nomme les colonnes qu’il cherchait', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/invest/second-opinion');
  await drop(page, 'inconnu.csv', 'Colonne A,Colonne B\n1,2\n');
  await expect(page.getByRole('heading', { name: 'Format non reconnu' })).toBeVisible();
  await expect(page.getByText('Prix de cession (213)')).toBeVisible();
  await expect(page.getByText('Colonne A, Colonne B')).toBeVisible();
});

test('rapport en PDF : refus nommé, sans lecteur de PDF ajouté', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/invest/second-opinion');
  await drop(page, 'rapport.pdf', '%PDF-1.7 (contenu de test, jamais analysé)');
  await expect(page.getByText('Ce comparatif ne lit pas les PDF')).toBeVisible();
});

test('rien n’est importé : le portefeuille est inchangé après un second avis', async ({ page }) => {
  await openDemo(page);
  const annexe = await ourAnnexe2086(page);
  test.skip(annexe === null, 'le jeu de démonstration ne produit aucune cession imposable');

  await page.goto('#/invest');
  const before = await page.getByRole('list', { name: 'Positions' }).innerText();

  await page.goto('#/invest/second-opinion');
  await drop(page, 'annexe-2086.csv', annexe!);
  await page.getByLabel(SCOPE_LABEL).check();
  await expect(page.getByRole('heading', { name: 'Résultat' })).toBeVisible();

  await page.goto('#/invest');
  await expect(page.getByRole('list', { name: 'Positions' })).toHaveText(before);
});

test('les deux points d’entrée mènent au second avis', async ({ page }) => {
  await openDemo(page);

  await page.goto('#/invest/import');
  await page.getByRole('link', { name: 'Ouvrir le second avis' }).click();
  await expect(page).toHaveURL(/#\/invest\/second-opinion$/);

  await page.goto('#/invest/report');
  const fromReport = page.getByRole('link', {
    name: 'Comparer à une annexe 2086 d’un autre outil',
  });
  // Le lien n'existe que lorsque l'estimation fiscale produit au moins une cession.
  if (await fromReport.isVisible().catch(() => false)) {
    await fromReport.click();
    await expect(page).toHaveURL(/#\/invest\/second-opinion$/);
  }
});
