import { expect, test } from '@playwright/test';
import { CALENDAR, splitAround } from '../../src/lib/calendar';
import { stubNetwork } from './helpers/network';

/**
 * Le calendrier macro à l'écran, comparé au module qui le porte — jamais à des dates écrites en
 * dur, qui périmeraient à la première régénération.
 *
 * Un point est vérifié ici et nulle part ailleurs : **l'écran n'émet aucune requête**. C'est la
 * promesse de la brique (calendrier compilé dans le bundle, consultable hors ligne) et la seule
 * façon de la tenir dans la durée est de la mesurer.
 */

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('affiche la prochaine publication, telle que le calendrier la connaît', async ({ page }) => {
  await page.goto('#/market');
  await expect(
    page.getByRole('heading', { name: 'Calendrier macroéconomique américain' }),
  ).toBeVisible();

  const next = splitAround(new Date().toISOString()).upcoming[0];
  expect(next, 'le calendrier committé doit encore contenir des dates à venir').toBeDefined();
  await expect(page.getByText(`Prochaine publication :`)).toContainText(next!.title);
});

test('ne contacte aucun serveur : le calendrier est embarqué', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') external.push(request.url());
  });
  await page.goto('#/market');
  await expect(page.getByRole('heading', { name: 'À venir' })).toBeVisible();
  expect(external, 'aucune requête externe ne doit partir de cet écran').toEqual([]);
});

test('le filtre ne garde que les publications majeures', async ({ page }) => {
  await page.goto('#/market');
  const items = page.locator('article.card.day li');
  const all = await items.count();

  await page.getByLabel('Ne montrer que les publications majeures').check();
  const majors = await items.count();

  const upcoming = splitAround(new Date().toISOString()).upcoming;
  const expectedMajors = upcoming.filter((event) => event.tier === 'major').length;
  expect(majors).toBe(expectedMajors);
  expect(majors).toBeLessThan(all);
});

test('le passé se déplie et se replie', async ({ page }) => {
  await page.goto('#/market');
  const toggle = page.getByRole('button', { name: /derniers jours de publications/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  const days = page.locator('article.card.day');
  const before = await days.count();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await days.count()).toBeGreaterThan(before);
});

test('annonce jusqu’où il sait, sans laisser croire qu’il sait au-delà', async ({ page }) => {
  await page.goto('#/market');
  const complete = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${CALENDAR.completeTo}T12:00:00Z`),
  );
  await expect(page.getByText(new RegExp(`Complet jusqu.au ${complete}`))).toBeVisible();
  await expect(page.getByText('« Majeure » est un choix de rédaction')).toBeVisible();
});
