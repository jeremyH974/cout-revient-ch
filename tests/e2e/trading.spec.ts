import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  computeTradingAccount,
  type TradingAccountReport,
} from '../../src/lib/domain/trading/compute';
import { D } from '../../src/lib/domain/money';
import { fmtMoney } from '../../src/lib/format/fr';
import { fixtureClient, type HlFixture } from '../../src/lib/import/hyperliquid/fixture-client';
import { normalizeHlAccount } from '../../src/lib/import/hyperliquid/normalize';
import { syncAccount } from '../../src/lib/import/hyperliquid/sync';
import { openDemo } from './helpers/demo';
import { normalize } from './helpers/expected';
import { stubNetwork } from './helpers/network';

/** Taux EUR→USD du stub réseau (network.ts) : les montants USDC de l'écran sont divisés par lui. */
const EUR_USD = '1.1';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** Rapport attendu, calculé par le moteur lui-même depuis la fixture (jamais de chiffres en dur). */
async function expectedReport(): Promise<{ fixture: HlFixture; report: TradingAccountReport }> {
  const fixture = JSON.parse(
    readFileSync('tests/fixtures/hyperliquid/demo.json', 'utf8'),
  ) as HlFixture;
  const sync = await syncAccount(fixtureClient(fixture), null, fixture.address, {
    now: () => 1_755_900_000_000,
  });
  expect(sync.error).toBeNull();
  const normalized = normalizeHlAccount(sync.data, {
    accountId: `hl:${fixture.address}`,
    spotPairs: sync.spotPairs,
    spotAsInvestment: false,
    eurUsdRate: () => EUR_USD,
  });
  return { fixture, report: computeTradingAccount(normalized.trading) };
}

const eur = (usdc: ReturnType<typeof D>): string =>
  normalize(fmtMoney(usdc.div(EUR_USD), 'EUR', { compact: true }));

async function expectDashboard(page: Page, report: TradingAccountReport): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Trading' })).toBeVisible();
  // Équité en euros (2e colonne de la synthèse) : accountValue USDC ÷ taux BCE stubé.
  await expect(page.locator('section.summary .trio .big').nth(1)).toHaveText(
    eur(report.equity ?? D('0')),
  );
  // Positions ouvertes de l'instantané, avec leur latent.
  const positions = page.getByRole('list', { name: 'Positions ouvertes' });
  for (const p of report.snapshot?.positions ?? []) {
    await expect(positions).toContainText(p.symbol);
  }
  // Avoirs spot présents.
  for (const h of report.snapshot?.spot ?? []) {
    await expect(page.getByRole('list', { name: 'Avoirs spot' })).toContainText(
      h.asset.toUpperCase(),
    );
  }
  // Réconciliation verte : équité = dépôts nets + réalisé − frais + funding + latent.
  await expect(
    page.getByText(/équité = dépôts nets \+ réalisé − frais \+ funding \+ latent/),
  ).toBeVisible();
  // La courbe d'évolution (portfolio) est rendue : un SVG avec la légende Équité.
  await expect(page.locator('.evolution svg').first()).toBeVisible();
}

test('démo : le tableau de bord Trading recoupe le moteur (équité, positions, réconciliation)', async ({
  page,
}) => {
  const { report } = await expectedReport();
  await openDemo(page);
  await page.goto('#/trading');
  await expectDashboard(page, report);
  // Onglet Fills : les exécutions vivent là, 50 par 50.
  await page.getByLabel('Espace Trading').getByRole('link', { name: 'Fills' }).click();
  await expect(page).toHaveURL(/#\/trading\/fills$/);
  const fillCount = report.executions.length;
  await expect(page.getByText(`${fillCount} fills (spot et perps)`)).toBeVisible();
  const rows = page.getByRole('list', { name: 'Fills' }).getByRole('listitem');
  expect(await rows.count()).toBe(Math.min(50, fillCount));
  await page.goto('#/trading');
  // Le P&L net « Tout » = réalisé − frais perps + funding du moteur (carte Résultat).
  await page
    .getByRole('group', { name: 'Période', exact: true })
    .getByRole('button', { name: 'Tout' })
    .click();
  const net = report.totals.realized.minus(report.totals.perpFees).plus(report.totals.funding);
  await expect(page.locator('.kpis .main dd')).toHaveText(
    normalize(fmtMoney(net.div(EUR_USD), 'EUR', { sign: true })),
  );
});

test('ajouter une adresse : synchronisation réelle (stub), persistance après rechargement', async ({
  page,
}) => {
  const { fixture, report } = await expectedReport();
  await page.goto('#/accounts');
  await page.getByLabel('Adresse publique').fill(fixture.address);
  await page.getByLabel('Nom (facultatif)').fill('Mon compte HL');
  await page.getByRole('button', { name: 'Ajouter et synchroniser' }).click();
  await expect(page).toHaveURL(/#\/trading$/);
  await expectDashboard(page, report);
  // Persistance (IndexedDB + miroir) : l'équité revient sans nouvelle synchronisation.
  await page.reload();
  await expect(page.locator('section.summary .trio .big').nth(1)).toHaveText(
    eur(report.equity ?? D('0')),
  );
  await expect(page.getByText(/Synchronisé :/)).toBeVisible();
});

test('quitter la démo retire le compte Hyperliquid fictif', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/trading');
  await expect(page.getByRole('heading', { level: 1, name: 'Trading' })).toBeVisible();
  await page.getByRole('button', { name: 'Quitter la démo' }).click();
  await expect(page).toHaveURL(/#\/welcome$/);
  await page.goto('#/trading');
  await expect(page.getByRole('heading', { name: 'Vos trades, bientôt ici' })).toBeVisible();
});
