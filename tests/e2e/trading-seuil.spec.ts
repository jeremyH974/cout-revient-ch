import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ONE } from '../../src/lib/domain/money';
import { observedFeeRates, sizeBreakeven } from '../../src/lib/domain/trading/costs';
import { fmtMoney, fmtSmallPct } from '../../src/lib/format/fr';
import { parseFrDecimal, parseSizeList, rateInputText } from '../../src/lib/format/trade-costs';
import { fixtureClient, type HlFixture } from '../../src/lib/import/hyperliquid/fixture-client';
import { normalizeHlAccount } from '../../src/lib/import/hyperliquid/normalize';
import { syncAccount } from '../../src/lib/import/hyperliquid/sync';
import { openDemo } from './helpers/demo';
import { normalize } from './helpers/expected';
import { stubNetwork } from './helpers/network';

const EUR_USD = '1.1';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** Exécutions de la démo, normalisées par le moteur depuis la fixture (aucun chiffre en dur). */
async function demoExecutions() {
  const fixture = JSON.parse(
    readFileSync('tests/fixtures/hyperliquid/demo.json', 'utf8'),
  ) as HlFixture;
  const sync = await syncAccount(fixtureClient(fixture), null, fixture.address, {
    now: () => 1_755_900_000_000,
  });
  return normalizeHlAccount(sync.data, {
    accountId: `hl:${fixture.address}`,
    spotPairs: sync.spotPairs,
    spotAsInvestment: false,
    eurUsdRate: () => EUR_USD,
  }).trading.executions;
}

test('onglet Seuil : gain brut minimum par taille et par type d’ordre, recoupé avec le moteur ; tailles retenues', async ({
  page,
}) => {
  const rates = observedFeeRates(await demoExecutions());
  const taker = rates.taker;
  const maker = rates.maker;
  expect(taker && maker, 'la démo doit porter des exécutions des deux rôles').toBeTruthy();

  await openDemo(page);
  await page.goto('#/trading');
  const tabs = page.getByRole('navigation', { name: 'Espace Trading' });
  await tabs.getByRole('link', { name: 'Seuil' }).click();
  await expect(page).toHaveURL(/#\/trading\/seuil$/);
  await expect(tabs.getByRole('link', { name: 'Seuil' })).toHaveAttribute('aria-current', 'page');

  // Taux pré-remplis : la médiane de ceux que la démo a réellement payés.
  await expect(page.getByLabel('Frais taker (%)')).toHaveValue(rateInputText(taker));
  await expect(page.getByLabel('Frais maker (%)')).toHaveValue(rateInputText(maker));

  await page.getByLabel(/^Tailles/).fill('10 20 30');
  const price = parseFrDecimal(await page.getByLabel('Prix ($)').inputValue());
  expect(price, 'le prix doit être pré-rempli').not.toBeNull();

  const table = page.getByRole('table');
  const sizes = parseSizeList('10 20 30');
  await expect(table.getByRole('columnheader')).toHaveCount(2 + sizes.length);
  for (const [label, entry, exit] of [
    ['Taker → taker', taker!, taker!],
    ['Maker → taker', maker!, taker!],
    ['Maker → maker', maker!, maker!],
  ] as const) {
    const cells = table
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: label }) })
      .getByRole('cell');
    await expect(cells.first()).toContainText(
      normalize(fmtSmallPct(sizeBreakeven(price!, ONE, entry, exit).move)),
    );
    for (const [i, qty] of sizes.entries()) {
      const grossMin = sizeBreakeven(price!, qty, entry, exit).grossMin;
      // En euros au taux stubé, comme tout l'écran ; en dollars sur la ligne du dessous.
      await expect(cells.nth(i + 1)).toContainText(
        normalize(fmtMoney(grossMin.div(EUR_USD), 'EUR')),
      );
      await expect(cells.nth(i + 1)).toContainText(normalize(fmtMoney(grossMin, 'USD')));
    }
  }

  // Les tailles sont retenues pour cet actif : relues après rechargement.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('crch:v1:state') ?? ''))
    .toContain('"10 20 30"');
  await page.reload();
  await expect(page.getByLabel(/^Tailles/)).toHaveValue('10 20 30');
});
