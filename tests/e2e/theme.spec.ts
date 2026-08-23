import { expect, test } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('cycle de thème système → clair → sombre, couleur de barre et mode discret', async ({
  page,
}) => {
  await openDemo(page);
  const html = page.locator('html');
  const themeColor = page.locator('meta[name="theme-color"]');
  await expect(html).toHaveAttribute('data-theme', 'auto');

  await page.getByRole('button', { name: /^Thème/ }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(themeColor).toHaveAttribute('content', '#f6f7f9');

  await page.getByRole('button', { name: /^Thème/ }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(themeColor).toHaveAttribute('content', '#0f1115');

  const discreet = page.getByRole('button', { name: 'Mode discret (masquer les montants)' });
  await expect(discreet).toHaveAttribute('aria-pressed', 'false');
  await discreet.click();
  await expect(discreet).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(discreet).toHaveAttribute('aria-pressed', 'true');
});
