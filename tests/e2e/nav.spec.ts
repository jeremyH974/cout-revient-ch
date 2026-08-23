/**
 * Navigation en espaces (v2) : alias v1 encore valables, quatre destinations de la navigation
 * principale, Vue d'ensemble, espace Trading accessible sans données, et liens de retour de la
 * barre d'application. Les autres specs (mobile, a11y, demo, asset…) couvrent le contenu de chaque
 * écran ; celle-ci couvre le routage lui-même.
 */
import { expect, test } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test.describe('alias v1 (hashes historiques toujours compris)', () => {
  test('#/asset/btc affiche la fiche BTC', async ({ page }) => {
    await openDemo(page);
    await page.goto('#/asset/btc');
    await expect(page.getByRole('heading', { level: 1, name: 'BTC' })).toBeVisible();
  });

  test('#/import affiche l’écran d’import', async ({ page }) => {
    await page.goto('#/import');
    await expect(page.getByRole('heading', { level: 1, name: 'Importer' })).toBeVisible();
  });
});

test.describe('navigation principale', () => {
  test('quatre destinations, aria-current suit la route', async ({ page }) => {
    await openDemo(page);
    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    const labels = ["Vue d'ensemble", 'Investissement', 'Trading', 'Plus'];
    await expect(nav.getByRole('link')).toHaveCount(labels.length);
    for (const label of labels) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }

    await page.goto('#/invest/asset/btc');
    await expect(nav.getByRole('link', { name: 'Investissement' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const inactive of ["Vue d'ensemble", 'Trading', 'Plus']) {
      await expect(nav.getByRole('link', { name: inactive })).not.toHaveAttribute('aria-current');
    }

    await page.goto('#/settings');
    await expect(nav.getByRole('link', { name: 'Plus' })).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('Vue d’ensemble', () => {
  test('titre, valeur nette et cartes vers les deux espaces', async ({ page }) => {
    await openDemo(page);
    await page.goto('#/');
    await expect(page.getByRole('heading', { level: 1, name: "Vue d'ensemble" })).toBeVisible();
    await expect(page.getByText('Valeur nette', { exact: true })).toBeVisible();

    const investCard = page.locator('a.card.space.invest');
    const tradingCard = page.locator('a.card.space.trading');
    await expect(
      investCard.getByRole('heading', { level: 2, name: 'Investissement' }),
    ).toBeVisible();
    await expect(tradingCard.getByRole('heading', { level: 2, name: 'Trading' })).toBeVisible();
    await expect(investCard).toHaveAttribute('href', '#/invest');
    await expect(tradingCard).toHaveAttribute('href', '#/trading');
  });
});

test.describe('espace Trading', () => {
  test('accessible sans données, état vide informatif (pas de redirection)', async ({ page }) => {
    await page.goto('#/trading');
    await expect(page).toHaveURL(/#\/trading$/);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Vos trades, bientôt ici' }),
    ).toBeVisible();
  });

  test('#/ sans données redirige vers l’accueil', async ({ page }) => {
    await page.goto('#/');
    await expect(page).toHaveURL(/#\/welcome$/);
  });
});

test.describe('retour de la barre d’application', () => {
  test('fiche actif → « Retour au portefeuille » → #/invest', async ({ page }) => {
    await openDemo(page);
    await page.goto('#/invest/asset/btc');
    await page.getByRole('link', { name: 'Retour au portefeuille' }).click();
    await expect(page).toHaveURL(/#\/invest$/);
    await expect(page.getByRole('list', { name: 'Positions' })).toBeVisible();
  });

  test('réglages → « Retour au menu » → #/more', async ({ page }) => {
    await openDemo(page);
    await page.goto('#/settings');
    await page.getByRole('link', { name: 'Retour au menu' }).click();
    await expect(page).toHaveURL(/#\/more$/);
    await expect(page.getByRole('navigation', { name: 'Écrans secondaires' })).toBeVisible();
  });
});
