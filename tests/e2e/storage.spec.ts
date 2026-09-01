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

/**
 * La base `crch-history` survivait à « Effacer toutes les données » (décision n° 88).
 *
 * Ce n'était pas un problème de place : son magasin `daily` porte **une entrée par actif**, donc la
 * liste de tout ce qui a été détenu, sur une machine peut-être partagée. Et la boîte de dialogue
 * promet « supprime l'historique importé, vos saisies et vos réglages de ce navigateur ».
 *
 * Le cache est semé directement plutôt que rempli par l'application : ce test doit prouver que
 * l'effacement vide CETTE base, quoi qu'elle contienne, sans dépendre du réseau simulé.
 */
async function historyAssets(page: import('@playwright/test').Page): Promise<string[] | null> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open('crch-history', 1);
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('daily')) {
            db.close();
            resolve([]);
            return;
          }
          const keys = db.transaction('daily', 'readonly').objectStore('daily').getAllKeys();
          keys.onsuccess = () => {
            db.close();
            resolve(keys.result.map(String));
          };
          keys.onerror = () => {
            db.close();
            resolve(null);
          };
        };
      }),
  );
}

test('effacer toutes les données efface aussi l’historique de prix', async ({ page }) => {
  await openDemo(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('crch-history', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('daily'))
            db.createObjectStore('daily', { keyPath: 'asset' });
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        };
        request.onerror = () => reject(new Error('ouverture impossible'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('daily', 'readwrite');
          tx.objectStore('daily').put({
            asset: 'doge',
            points: [{ day: '2026-01-01', priceEur: '1' }],
            source: 'test',
            fetchedAt: '2026-01-01T10:00:00Z',
            from: '2026-01-01',
            to: '2026-01-01',
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('écriture impossible'));
          };
        };
      }),
  );
  expect(await historyAssets(page), 'le cache doit être garni avant l’effacement').toContain(
    'doge',
  );

  await page.goto('#/settings');
  await page.getByRole('button', { name: 'Effacer toutes les données' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Effacer', exact: true }).click();
  await expect(page).toHaveURL(/#\/welcome$/);

  // « doge » nomme un actif détenu : le laisser derrière trahit la promesse de la boîte de dialogue.
  await expect.poll(() => historyAssets(page), { timeout: 10_000 }).toEqual([]);
});
