import { expect, test } from '@playwright/test';
import { BASE_URL } from '../../playwright.config';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.use({ serviceWorkers: 'allow' });

test('manifeste, service worker, CSP, et aucune erreur console sur le parcours', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await stubNetwork(context);
  // Compteur installé dans chaque document (WebKit recharge le document sur certains `goto`).
  await context.addInitScript(() => {
    const w = window as Window & { __cspViolations?: number };
    w.__cspViolations = 0;
    document.addEventListener('securitypolicyviolation', () => {
      w.__cspViolations = (w.__cspViolations ?? 0) + 1;
    });
  });

  await page.goto('');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifest = await page.request.get(new URL(manifestHref!, BASE_URL).toString());
  expect(manifest.ok()).toBe(true);
  const json = (await manifest.json()) as { start_url?: string; name?: string };
  expect(json.start_url ?? '').toContain('/cout-revient-ch/');
  expect(json.name).toBeTruthy();

  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /^#/);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);

  const swState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (!worker) return null;
    if (worker.state !== 'activated') {
      await new Promise<void>((resolve) => {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') resolve();
        });
        setTimeout(resolve, 5000);
      });
    }
    return worker.state;
  });
  expect(swState).toBe('activated');

  await openDemo(page);
  await page.goto('#/asset/btc');
  await expect(page.getByRole('main')).toBeVisible();
  await page.goto('#/settings');
  await expect(page.getByRole('heading', { name: 'Aide et retours' })).toBeVisible();

  const violations = await page.evaluate(
    () => (window as Window & { __cspViolations?: number }).__cspViolations ?? -1,
  );
  expect(violations).toBe(0);
  expect(errors).toEqual([]);
});
