import { expect, test } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('auto-vérifications : voyants verts sur la démo, rappel en pied de portefeuille', async ({
  page,
}) => {
  await openDemo(page);
  const badge = page.locator('.checks-link .badge');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/Contrôles \d+\/\d+|point.*à voir/);

  await page.goto('#/settings');
  const list = page.getByRole('list', { name: 'Vérifications automatiques' });
  // Le nombre de contrôles grandit avec l'application (virements, flux datés…) : ce qui compte est
  // qu'aucun ne soit en échec sur la démo, pas leur compte exact.
  await expect(list.getByRole('listitem').first()).toBeVisible();
  await expect(list.getByRole('listitem').filter({ has: page.locator('.fail') })).toHaveCount(0);
  for (const label of [
    'Cohérence comptable',
    'Flux datés (XIRR)',
    'Lots et PRU',
    'Soldes Coinhouse',
  ]) {
    const item = list.getByRole('listitem').filter({ hasText: label });
    await expect(item).toHaveClass(/\bok\b/);
  }
  // Aucune sauvegarde téléchargée en démo : avertissement attendu, avec la marche à suivre.
  const backup = list.getByRole('listitem').filter({ hasText: 'Sauvegarde' });
  await expect(backup).toHaveClass(/\bwarn\b/);
  await expect(backup).toContainText('Télécharger une sauvegarde');
});

test('signalement pré-rempli et diagnostic sans montant', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/settings');
  const report = page.getByRole('link', { name: 'Signaler (formulaire pré-rempli)' });
  const url = new URL((await report.getAttribute('href')) ?? '');
  expect(url.pathname).toBe('/jeremyH974/cout-revient-ch/issues/new');
  expect(url.searchParams.get('template')).toBe('bug.yml');
  const diagnostic = url.searchParams.get('diagnostic') ?? '';
  expect(diagnostic).toContain('Coût de revient CH — diagnostic');
  expect(diagnostic).toContain('format coinhouse-2026-08');
  expect(diagnostic).not.toMatch(/€/);
  await expect(page.getByRole('link', { name: 'Proposer une idée' })).toHaveAttribute(
    'href',
    /issues\/new\/choose/,
  );
});

test('page Nouveautés et bandeau de mise à jour', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/news');
  await expect(page.getByRole('heading', { level: 1, name: 'Nouveautés' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 }).first()).toContainText(
    'Dernières évolutions',
  );
  expect(await page.getByRole('listitem').count()).toBeGreaterThan(5);

  // Première visite : pas de bandeau. Version mémorisée différente : bandeau + lien Nouveautés.
  await expect(page.getByRole('status').filter({ hasText: 'installée' })).toHaveCount(0);
  // La sauvegarde locale est débouncée : on attend qu'elle existe avant de la modifier.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('crch:v1:state') !== null))
    .toBe(true);
  // Laisse passer la sauvegarde débouncée (300 ms) : sinon elle écraserait notre modification.
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const raw = localStorage.getItem('crch:v1:state');
    if (!raw) throw new Error('état absent');
    const state = JSON.parse(raw) as { ui: { lastSeenVersion: string | null } };
    state.ui.lastSeenVersion = '0.0.1';
    localStorage.setItem('crch:v1:state', JSON.stringify(state));
  });
  await page.reload();
  const banner = page.getByRole('status').filter({ hasText: 'installée' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Masquer ce message' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'installée' })).toHaveCount(0);
});
