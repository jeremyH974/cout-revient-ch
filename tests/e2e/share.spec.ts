import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

/**
 * Carte de partage (P9). Les tests unitaires prouvent que le modèle ne peut pas émettre de montant
 * en mode par défaut ; ici on vérifie ce que les tests unitaires ne voient pas — que le canvas
 * produit réellement une image aux bonnes dimensions, que son équivalent textuel porte les mêmes
 * chiffres, et que la bascule des montants ne survit pas à la fermeture de la feuille.
 */
test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'partage : Chromium desktop seulement');
  await stubNetwork(context);
});

async function openShare(page: import('@playwright/test').Page): Promise<void> {
  await openDemo(page);
  await page.goto('#/');
  await page.getByRole('button', { name: 'Partager', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // `toBeVisible` suffit à l'élément mais pas à l'image : la source `data:` est encore en cours de
  // décodage, et `naturalWidth` vaut alors 0. On attend le décodage, pas la mise en page.
  await expect
    .poll(
      () =>
        page
          .locator('dialog[open] img.preview')
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      { timeout: 10_000 },
    )
    .toBe(true);
}

test('la carte est une vraie image 1200 × 630, pas un cadre vide', async ({ page }) => {
  await openShare(page);
  const size = await page
    .locator('dialog[open] img.preview')
    .evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size).toEqual([1200, 630]);

  // Une image peut avoir la bonne taille et être vide. On compte les couleurs distinctes : un
  // aplat en aurait une poignée, du texte anticrénelé en a des centaines.
  const colors = await page
    .locator('dialog[open] img.preview')
    .evaluate((img: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const seen = new Set<string>();
      for (let i = 0; i < data.length; i += 4 * 37)
        seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return seen.size;
    });
  expect(colors).toBeGreaterThan(50);
});

test('l’équivalent textuel porte les chiffres, pas une description de l’image', async ({
  page,
}) => {
  await openShare(page);
  const alt = (await page.locator('dialog[open] img.preview').getAttribute('alt')) ?? '';
  // Un `alt` qui dirait « image de partage » ne servirait à personne : il porte les mêmes lignes
  // que la carte, dans le même ordre.
  expect(alt).toContain('Performance');
  expect(alt).toContain('Lignes ouvertes');
  expect(alt).toContain('hors apports');
  expect(alt).toContain('Coût de revient CH');
  expect(alt).toMatch(/%/);
});

test('aucun montant par défaut, et la bascule ne survit pas à la fermeture', async ({ page }) => {
  await openShare(page);
  const preview = page.locator('dialog[open] img.preview');
  const amounts = page.getByRole('checkbox', { name: 'Afficher mes montants' });

  expect(await preview.getAttribute('alt')).not.toContain('€');
  await expect(page.locator('dialog[open] .warn')).toHaveCount(0);

  await amounts.check();
  await expect.poll(async () => (await preview.getAttribute('alt')) ?? '').toContain('€');
  await expect(page.locator('dialog[open] .warn')).toBeVisible();

  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('button', { name: 'Partager', exact: true }).click();
  await expect(preview).toBeVisible();
  // Le point qui compte : rouvrir repart des pourcentages seuls. Un réglage mémorisé finirait par
  // publier ce qu'on ne voulait publier qu'une fois.
  await expect(amounts).not.toBeChecked();
  await expect.poll(async () => (await preview.getAttribute('alt')) ?? '').not.toContain('€');
});

test('la feuille de partage reste accessible (axe, WCAG 2.2 AA)', async ({ page }) => {
  await openShare(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id} : ${v.help}`),
    'violations axe sur la feuille de partage',
  ).toEqual([]);
});
