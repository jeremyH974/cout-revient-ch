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
    '#/trading/seuil',
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

/**
 * La barre d'onglets Trading à 320 px, la largeur du critère WCAG 1.4.10 (décision n° 158).
 *
 * Le test précédent ne voit un débordement qu'avec les polices du poste qui le lance : le cinquième
 * onglet débordait de 12 px sur la CI Linux et tenait sous Windows. À 320 px, la barre déborde
 * partout si elle ne passe pas à la ligne — la régression se voit donc aussi en local.
 */
test('mobile étroit (320 px) : la barre d’onglets Trading passe à la ligne au lieu de déborder', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'projet mobile uniquement');
  await openDemo(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('#/trading/seuil');
  const tabs = page.getByRole('navigation', { name: 'Espace Trading' });
  await expect(tabs.getByRole('link', { name: 'Seuil' })).toBeVisible();
  const overflow = await tabs.evaluate((nav) => ({
    right: Math.round(nav.getBoundingClientRect().right),
    viewport: document.documentElement.clientWidth,
    links: [...nav.querySelectorAll('a')].map((a) => Math.round(a.getBoundingClientRect().right)),
  }));
  expect(
    Math.max(overflow.right, ...overflow.links),
    `barre d'onglets : ${JSON.stringify(overflow)}`,
  ).toBeLessThanOrEqual(overflow.viewport);
});

/**
 * Les mailles du calendrier de P&L à 320 px (décision n° 165) : avec la semaine, quatre boutons et
 * deux flèches ne tiennent plus sur une ligne. Ils passent à la ligne au lieu de pousser la page.
 */
test('mobile étroit (320 px) : les mailles du calendrier passent à la ligne au lieu de déborder', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'projet mobile uniquement');
  await openDemo(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('#/trading/stats');
  const grains = page.getByRole('radiogroup', { name: 'Maille du calendrier' });
  await grains.getByRole('radio', { name: 'Semaine', exact: true }).click();
  await expect(page.getByRole('list', { name: /^Semaines de \d{4}$/ })).toBeVisible();
  const overflow = await grains.evaluate((group) => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    controls: [...(group.parentElement?.querySelectorAll('button') ?? [])].map((b) =>
      Math.round(b.getBoundingClientRect().right),
    ),
  }));
  expect(
    Math.max(overflow.page, ...overflow.controls),
    `mailles du calendrier : ${JSON.stringify(overflow)}`,
  ).toBeLessThanOrEqual(overflow.viewport);
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
