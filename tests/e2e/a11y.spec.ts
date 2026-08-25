import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact ?? '?'}) : ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(summary, `violations axe sur ${label}`).toEqual([]);
}

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test.describe('accessibilité (axe, WCAG 2.2 AA)', () => {
  for (const route of [
    '#/welcome',
    '#/import',
    '#/add',
    '#/accounts',
    '#/help',
    '#/privacy',
    '#/settings',
    '#/trading',
    '#/trading/add',
    '#/more',
    '#/news',
    '#/invest/alerts',
  ]) {
    test(`sans données : ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoViolations(page, route);
    });
  }

  for (const route of [
    '#/',
    '#/asset/btc',
    '#/settings',
    '#/report',
    '#/invest',
    '#/trading',
    '#/trading/trades',
    '#/trading/stats',
    '#/trading/fills',
    '#/more',
    '#/accounts',
    '#/invest/asset/btc',
    '#/invest/alerts',
  ]) {
    test(`avec la démo : ${route}`, async ({ page }) => {
      await openDemo(page);
      await page.goto(route);
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoViolations(page, route);
    });
  }

  /**
   * Le détail d'un trade est l'écran le plus interactif de l'app (formulaire de journal, plan,
   * étiquettes, graphique) — donc celui où une violation est la plus probable. Son hash porte un
   * identifiant : il ne peut pas figurer dans la liste ci-dessus, et il était le seul écran à
   * n'être jamais passé sous axe.
   */
  test('avec la démo : #/trading/trade/<id> (détail et journal)', async ({ page }) => {
    await openDemo(page);
    await page.goto('#/trading/trades');
    await page
      .getByRole('link', { name: /Long|Short/ })
      .first()
      .click();
    await expect(page).toHaveURL(/#\/trading\/trade\//);
    await expect(page.getByRole('main')).toBeVisible();
    await expectNoViolations(page, '#/trading/trade/<id>');
  });
});
