import { expect, test } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

/**
 * P12 : l'état principal vit dans IndexedDB (`crch-state`), localStorage n'est qu'un miroir.
 * Preuve : on efface le miroir, on recharge, les données sont toujours là.
 */
test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

async function idbSnapshot(page: import('@playwright/test').Page): Promise<{
  savedAt: string;
  rows: number;
} | null> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open('crch-state', 1);
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction('state', 'readonly').objectStore('state').get('v1');
          get.onsuccess = () => {
            const value = get.result as
              { savedAt: string; state: { rawRows: Record<string, unknown> } } | undefined;
            db.close();
            resolve(
              value
                ? { savedAt: value.savedAt, rows: Object.keys(value.state.rawRows).length }
                : null,
            );
          };
          get.onerror = () => {
            db.close();
            resolve(null);
          };
        };
      }),
  );
}

test('IndexedDB est la source : les données survivent à l’effacement du miroir localStorage', async ({
  page,
}) => {
  await openDemo(page);
  await expect
    .poll(() => idbSnapshot(page), { timeout: 10_000 })
    .toMatchObject({
      rows: expect.any(Number),
    });
  const before = await idbSnapshot(page);
  expect(before?.rows ?? 0).toBeGreaterThan(100);
  // Le miroir est bien écrit lui aussi (format v1 inchangé, horodatage à côté).
  expect(await page.evaluate(() => localStorage.getItem('crch:v1:state') !== null)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('crch:v1:state.savedAt'))).toBe(
    before?.savedAt,
  );

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.goto('#/invest');
  await expect(page.getByRole('list', { name: 'Positions' })).toBeVisible();
  const after = await idbSnapshot(page);
  expect(after?.rows).toBe(before?.rows);
});

test('effacer toutes les données vide aussi IndexedDB', async ({ page }) => {
  await openDemo(page);
  await expect.poll(() => idbSnapshot(page), { timeout: 10_000 }).not.toBeNull();
  await page.goto('#/settings');
  await page.getByRole('button', { name: 'Effacer toutes les données' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Effacer', exact: true }).click();
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect.poll(async () => (await idbSnapshot(page))?.rows ?? 0, { timeout: 10_000 }).toBe(0);
});
