import { expect, test } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('mobile : cartes, libellé « Réalisé » et navigation basse', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'projet mobile uniquement');
  await openDemo(page);

  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav).toBeVisible();
  for (const label of ["Vue d'ensemble", 'Investissement', 'Trading', 'Plus']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
  const box = await nav.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);

  await expect(page.locator('.head')).toBeHidden();
  const firstRow = page.getByRole('list', { name: 'Positions' }).getByRole('listitem').first();
  await expect(firstRow.getByText('Réalisé', { exact: true })).toBeVisible();
});

test('mobile : aucune page ne déborde horizontalement (pas de dézoom du navigateur)', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'projet mobile uniquement');
  await openDemo(page);
  const problems: string[] = [];
  for (const route of [
    '#/',
    '#/invest',
    '#/trading',
    '#/more',
    '#/asset/btc',
    '#/asset/pepe',
    '#/import',
    '#/add',
    '#/settings',
    '#/help',
    '#/privacy',
    '#/report',
  ]) {
    await page.goto(route);
    await expect(page.getByRole('main')).toBeVisible();
    // Les éléments qui dépassent sont listés pour que le rapport de CI désigne le coupable.
    const metrics = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const culprits: string[] = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && r.width > 0 && r.width < vw * 1.6) {
          culprits.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
        }
      }
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: vw,
        innerWidth: window.innerWidth,
        visualWidth: Math.round(window.visualViewport?.width ?? window.innerWidth),
        culprits: culprits.slice(0, 6),
      };
    });
    if (
      metrics.innerWidth !== metrics.visualWidth ||
      metrics.scrollWidth > metrics.clientWidth + 1
    ) {
      problems.push(
        `${route} : largeur ${metrics.innerWidth}/${metrics.visualWidth}, défilement ${metrics.scrollWidth} — ${metrics.culprits.join(', ') || 'aucun élément isolé'}`,
      );
    }
  }
  expect(problems, 'pages qui débordent sur mobile').toEqual([]);
});

test('desktop : en-tête de colonnes visible, libellé « Réalisé » réservé aux lecteurs d’écran', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'projets desktop uniquement');
  await openDemo(page);
  await expect(page.locator('.head')).toBeVisible();
  await expect(page.locator('.head')).toHaveAttribute('aria-hidden', 'true');
  const firstRow = page.getByRole('list', { name: 'Positions' }).getByRole('listitem').first();
  // Réservé aux lecteurs d'écran : présent dans le DOM mais réduit à un pixel (technique « sr-only »).
  const label = firstRow.getByText('Réalisé', { exact: true });
  await expect(label).toHaveCount(1);
  const box = await label.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(1);
  expect(box!.height).toBeLessThanOrEqual(1);
});
