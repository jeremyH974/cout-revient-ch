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
    '#/help',
    '#/privacy',
    '#/settings',
    '#/trading',
    '#/more',
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
    '#/more',
    '#/invest/asset/btc',
  ]) {
    test(`avec la démo : ${route}`, async ({ page }) => {
      await openDemo(page);
      await page.goto(route);
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoViolations(page, route);
    });
  }
});
