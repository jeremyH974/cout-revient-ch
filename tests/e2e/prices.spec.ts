/**
 * P23 « bouton Actualiser v2 » : bouton de synthèse, ligne de fraîcheur des prix, et bascule de la
 * chaîne de fournisseurs jusqu'à Hyperliquid pour un actif que CoinGecko/Coinbase/Kraken ne cotent
 * pas dans les stubs (`near`, voir FALLTHROUGH_ASSET dans helpers/network.ts — `hype`, candidat
 * naturel, est absent de la fixture démo).
 */
import { expect, test } from '@playwright/test';
import { fmtPrice } from '../../src/lib/format/fr';
import { openDemo } from './helpers/demo';
import { normalize } from './helpers/expected';
import { STUB_PRICES_EUR, stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('synthèse : bouton Actualiser visible avec la fraîcheur des prix', async ({ page }) => {
  await openDemo(page);
  await expect(page.getByRole('button', { name: 'Actualiser', exact: true })).toBeVisible();

  const freshness = page.locator('p.freshness');
  await expect(freshness).toBeVisible();
  await expect(freshness).toContainText(/Prix : (à l'instant|il y a \d+ (min|h|j))/);
});

test('bascule jusqu’à Hyperliquid pour l’actif que les autres fournisseurs ne cotent pas', async ({
  page,
}) => {
  await openDemo(page);
  const button = page.getByRole('button', { name: 'Actualiser', exact: true });

  // Les deux écoutes sont posées avant le clic pour ne rater ni requête, quel que soit l'ordre
  // exact dans lequel la chaîne (CoinGecko → Coinbase → Kraken → Hyperliquid) les émet.
  const coingeckoRequest = page.waitForRequest(
    (req) => new URL(req.url()).hostname === 'api.coingecko.com',
  );
  const hyperliquidRequest = page.waitForRequest(
    (req) => new URL(req.url()).hostname === 'api.hyperliquid.xyz' && req.method() === 'POST',
  );
  await button.click();
  await coingeckoRequest;
  await hyperliquidRequest;
  await page.waitForLoadState('networkidle');

  const freshness = page.locator('p.freshness');
  await expect(freshness).toContainText(/Prix : (à l'instant|il y a \d+ (min|h|j))/);

  // Fiche actif de `near` : source Hyperliquid et prix identique à celui recalculé par Hyperliquid
  // dans le stub (STUB_PRICES_EUR['near'] × EUR_USD_RATE, converti retour en EUR).
  await page.goto('#/asset/near');
  const price = page.locator('p.price');
  await expect(price).toContainText('Hyperliquid ·');
  const expected = normalize(fmtPrice(String(STUB_PRICES_EUR['near']), 'EUR'));
  await expect(price).toContainText(expected);
});
