import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** La plage réellement tracée se lit dans l'étiquette de la courbe : « … de X le … à Y le … ». */
const rangeOf = (label: string | null): string => (label ?? '').replace(/^[^:]*: /, '');

async function evolution(page: Page) {
  await openDemo(page);
  await page.goto('#/trading');
  const card = page.locator('section.evolution');
  const toolbar = card.getByRole('group', { name: 'Zoom de la courbe' });
  const chart = card.locator('svg[role="img"]').first();
  const range = async (): Promise<string> => rangeOf(await chart.getAttribute('aria-label'));
  return { toolbar, chart, range, reset: toolbar.getByRole('button', { name: 'Tout afficher' }) };
}

test('courbe Évolution : zoom par boutons — l’alternative au glisser, sur tous les appareils', async ({
  page,
}) => {
  const { toolbar, range, reset } = await evolution(page);
  await expect(reset).toBeDisabled();
  await expect(toolbar.getByRole('button', { name: 'Zoom arrière' })).toBeDisabled();
  const full = await range();

  await toolbar.getByRole('button', { name: 'Zoom avant' }).click();
  await expect(reset).toBeEnabled();
  await expect(toolbar.locator('.zoom-state')).toContainText('Zoom :');
  const zoomed = await range();
  expect(zoomed).not.toBe(full);

  // Zoom centré : on peut aller plus tôt comme plus tard.
  await toolbar.getByRole('button', { name: 'Plus tôt' }).click();
  await expect.poll(range).not.toBe(zoomed);
  await reset.click();
  await expect(reset).toBeDisabled();
  await expect.poll(range).toBe(full);
});

test('courbe Évolution : molette autour du curseur, glisser pour remonter le temps, double-clic pour tout afficher', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'molette et glisser à la souris : parcours desktop');
  const { chart, range, reset } = await evolution(page);
  const full = await range();
  const box = (await chart.boundingBox())!;
  const cx = box.x + box.width * 0.75;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -900);
  await expect(reset).toBeEnabled();
  const wheeled = await range();
  expect(wheeled).not.toBe(full);

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + box.width * 0.25, cy, { steps: 6 });
  await page.mouse.up();
  await expect.poll(range).not.toBe(wheeled);

  await chart.dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(reset).toBeDisabled();
  await expect.poll(range).toBe(full);
});
