import { expect, test } from '@playwright/test';
import { CALENDAR, splitAround } from '../../src/lib/calendar';
import { MACRO, orderedIndicators } from '../../src/lib/macro';
import { openDemo } from './helpers/demo';
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

test('affiche chaque indicateur macro avec son rang, jamais une valeur seule', async ({ page }) => {
  await page.goto('#/market');
  const rows = page.locator('.regime .list li');
  await expect(rows).toHaveCount(MACRO.indicators.length);

  // La règle qui fonde tout le module : aucune valeur ne s'affiche sans son rang historique, et
  // deux fenêtres au moins, parce qu'un percentile n'existe que relativement à la sienne.
  for (const [index, indicator] of orderedIndicators().entries()) {
    const row = rows.nth(index);
    await expect(row.getByRole('heading', { level: 3 })).toHaveText(indicator.label);
    const ranks = row.locator('.rank');
    await expect(ranks).toHaveCount(indicator.ranks.length);
    expect(indicator.ranks.length).toBeGreaterThanOrEqual(2);
    for (const [i, rank] of indicator.ranks.entries()) {
      await expect(ranks.nth(i)).toContainText(`${Math.round(rank.percentile)}`);
    }
    // Et jamais sans sa date d'observation.
    await expect(row).toContainText('Au ');
  }
});

test('dit ce qu’il a fait à une série avant de la classer', async ({ page }) => {
  await page.goto('#/market');
  const reserves = page.locator('.regime .list li', { hasText: 'Réserves bancaires' });
  await expect(reserves).toContainText('variation sur 3 mois');
  // La réserve sur la « liquidité nette » est affichée, pas cachée dans le code.
  await expect(reserves).toContainText('n’est pas une statistique officielle');
});

test('les indicateurs macro non plus ne contactent personne', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') external.push(request.url());
  });
  await page.goto('#/market');
  await expect(page.getByRole('heading', { name: 'Régime macroéconomique' })).toBeVisible();
  expect(external).toEqual([]);
});

test('la confrontation à vos chiffres attend qu’on la demande', async ({ page }) => {
  await page.goto('#/market');
  const lens = page.locator('.lens');
  await expect(lens.getByRole('heading', { name: 'Vos chiffres face au décor' })).toBeVisible();
  // Sans données importées, la section explique au lieu de disparaître.
  await expect(lens).toContainText('une fois vos opérations importées');
  await expect(lens.getByRole('button')).toHaveCount(0);
});

test('avec un portefeuille, elle propose le calcul sans le lancer d’elle-même', async ({
  page,
}) => {
  await openDemo(page);

  // La promesse de l'écran : aucune requête tant que l'utilisateur n'a rien demandé. On mesure à
  // partir de l'arrivée sur l'écran, une fois la démo chargée.
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') external.push(request.url());
  });
  /*
   * L'ouverture de la démo lance le chargement de l'historique des prix, dont les requêtes
   * retombent de façon asynchrone : sans ce délai, l'une d'elles se fait passer pour une requête
   * de CET écran (échec observé en CI le 05/09/2026 sur des chandelles Coinbase demandées par
   * l'écran précédent). On les laisse atterrir, puis on remet le compteur à zéro — attendre
   * `networkidle` ne convient pas : l'historique finirait de charger et la section n'afficherait
   * plus son bouton, ce que le test veut précisément voir.
   */
  await page.waitForTimeout(1_500);
  external.length = 0;
  await page.goto('#/market');

  const lens = page.locator('.lens');
  await expect(
    lens.getByRole('button', { name: /Calculer à partir de mon historique/ }),
  ).toBeVisible();
  expect(external, 'la section ne doit rien télécharger avant qu’on le lui demande').toEqual([]);
});
