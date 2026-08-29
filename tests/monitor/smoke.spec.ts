/**
 * Parcours de surveillance sur le site en ligne : la page se charge, la démo fonctionne, les
 * ressources PWA répondent. Aucune donnée personnelle n'est en jeu (données d'exemple).
 */
import { expect, test } from '@playwright/test';
import { MONITOR_BASE_URL } from '../../playwright.monitor.config';

test('le site en ligne se charge sans erreur et avec sa politique de sécurité', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const response = await page.goto('');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Coût de revient CH/);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Votre PRU par crypto');
  expect(errors).toEqual([]);
});

test('la démo charge un portefeuille et se quitte', async ({ page }) => {
  await page.goto('#/welcome');
  await page
    .getByRole('button', { name: 'Essayer avec des données d’exemple', exact: true })
    .click();
  await expect(page.getByRole('status').filter({ hasText: /Données d.exemple/ })).toBeVisible();
  // Depuis la 2.0.0, la démo atterrit sur la Vue d'ensemble : les positions vivent dans l'espace
  // Investissement, pas sur l'accueil. La surveillance suit la navigation réelle du site.
  await expect(page.getByRole('heading', { level: 1, name: "Vue d'ensemble" })).toBeVisible();
  await page.goto('#/invest');
  await expect(
    page.getByRole('list', { name: 'Positions' }).getByRole('listitem').first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Quitter la démo' }).click();
  await expect(page).toHaveURL(/#\/welcome$/);
});

test('manifeste, service worker et logos sont servis', async ({ request }) => {
  const manifest = await request.get(new URL('manifest.webmanifest', MONITOR_BASE_URL).toString());
  expect(manifest.status()).toBe(200);
  const body = (await manifest.json()) as { start_url?: string };
  expect(body.start_url ?? '').toContain('/cout-revient-ch/');
  const sw = await request.get(new URL('sw.js', MONITOR_BASE_URL).toString());
  expect(sw.status()).toBe(200);
  expect(sw.headers()['content-type'] ?? '').toContain('javascript');
  const icon = await request.get(new URL('icons/btc.svg', MONITOR_BASE_URL).toString());
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type'] ?? '').toContain('svg');
});

test('le contexte de marché est servi, daté et sans requête sortante', async ({ page }) => {
  /**
   * Ce que cette surveillance attrape et qu'aucun test local ne peut voir : un instantané publié
   * qui aurait vieilli — le cron en échec depuis des semaines, l'issue ignorée — et une éventuelle
   * requête sortante que la CSP de production laisserait passer alors que l'écran promet de n'en
   * faire aucune.
   */
  const external: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (!host.endsWith('github.io')) external.push(request.url());
  });

  await page.goto('#/market');
  await expect(page.getByRole('heading', { name: 'Régime macroéconomique' })).toBeVisible();

  const rows = page.locator('.regime .list li');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(4);

  // Chaque indicateur porte au moins deux rangs : c'est la règle du module, vérifiée en ligne.
  for (let index = 0; index < (await rows.count()); index += 1) {
    expect(await rows.nth(index).locator('.rank').count()).toBeGreaterThanOrEqual(2);
  }

  // Aucun indicateur ne doit être signalé périmé : si le cron ne tourne plus, cela se voit ici.
  await expect(rows.locator('.stale')).toHaveCount(0);

  // Et le calendrier doit encore connaître des échéances à venir.
  await expect(page.getByText('Prochaine publication :')).toBeVisible();

  expect(external, 'l’écran de contexte ne doit contacter personne').toEqual([]);
});
