import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { D } from '../../src/lib/domain/money';
import { journaledTrips } from '../../src/lib/domain/trading/journal';
import { buildRoundTrips } from '../../src/lib/domain/trading/round-trips';
import { fmtMoney } from '../../src/lib/format/fr';
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

/** Aller-retours attendus, reconstruits par le moteur depuis la fixture (aucun chiffre en dur). */
async function expectedTrips() {
  const fixture = JSON.parse(
    readFileSync('tests/fixtures/hyperliquid/demo.json', 'utf8'),
  ) as HlFixture;
  const sync = await syncAccount(fixtureClient(fixture), null, fixture.address, {
    now: () => 1_755_900_000_000,
  });
  const normalized = normalizeHlAccount(sync.data, {
    accountId: `hl:${fixture.address}`,
    spotPairs: sync.spotPairs,
    spotAsInvestment: false,
    eurUsdRate: () => EUR_USD,
  });
  return journaledTrips(
    buildRoundTrips(normalized.trading.executions, normalized.trading.funding),
    [],
    {},
  );
}

test('démo : la liste des trades recoupe le moteur, le journal se sauvegarde et survit au rechargement', async ({
  page,
}) => {
  const trips = await expectedTrips();
  const closed = trips.filter((t) => t.trip.status === 'closed');
  expect(closed.length).toBeGreaterThan(0);

  await openDemo(page);
  await page.goto('#/trading/trades');
  await expect(page.getByText(`${trips.length} trades · ${closed.length} clos`)).toBeVisible();
  const rows = page.getByRole('list', { name: 'Trades' }).getByRole('listitem');
  await expect(rows).toHaveCount(trips.length);

  // Détail du trade le plus récent : P&L net de l'écran = moteur (converti au taux stubé).
  const first = trips[0]!;
  await rows.first().getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`#/trading/trade/`));
  if (first.trip.status === 'closed') {
    await expect(page.locator('.kpis .num, .kpis dd').first()).toContainText(
      normalize(fmtMoney(first.trip.netPnl.div(EUR_USD), 'EUR', { sign: true })),
    );
  }

  // Journal : thèse + setup + plan → R affiché ; rechargement → conservé.
  await page.getByLabel(/Pourquoi j'ai pris ce trade/).fill('Cassure du range 4 h avec volume.');
  await page.getByRole('button', { name: 'Cassure' }).click();
  await page.getByLabel('Entrée prévue').fill('100');
  await page.getByLabel('Stop', { exact: true }).fill('95');
  await page.getByRole('button', { name: 'Enregistrer le journal' }).click();
  await expect(page.getByText('Journal enregistré.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Pourquoi j'ai pris ce trade/)).toHaveValue(
    'Cassure du range 4 h avec volume.',
  );
  await expect(page.getByRole('button', { name: 'Cassure' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // La liste porte maintenant le badge du setup.
  await page.goto('#/trading/trades');
  await expect(
    page.getByRole('list', { name: 'Trades' }).getByText('Cassure').first(),
  ).toBeVisible();
});

test('trade manuel : saisie, P&L calculé, journal, statistiques avec garde-fou, suppression', async ({
  page,
}) => {
  await page.goto('#/trading/add');
  await page.getByLabel('Symbole').fill('sol');
  await page.getByRole('button', { name: 'Short', exact: true }).click();
  await page.getByLabel('Taille').fill('10');
  await page.getByLabel("Prix d'entrée").fill('120');
  await page
    .locator('input[type="datetime-local"]')
    .first()
    .evaluate((el, value) => {
      const input = el as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, '2026-07-01T10:00:00');
  await page.getByLabel('Prix de sortie (vide = encore ouvert)').fill('110');
  await page
    .locator('input[type="datetime-local"]')
    .nth(1)
    .evaluate((el, value) => {
      const input = el as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, '2026-07-02T16:30:00');
  await page.getByLabel(/Frais totaux/).fill('4');
  await page.getByRole('button', { name: 'Enregistrer le trade' }).click();

  // Détail : net = (120 − 110) × 10 − 4 = 96 USD → 96 ÷ 1,1 € une fois le taux stubé chargé.
  await expect(page).toHaveURL(/#\/trading\/trade\/man%3A/);
  await expect(page.locator('.kpis dd').first()).toHaveText(
    normalize(fmtMoney(D('96').div(EUR_USD), 'EUR', { sign: true })),
  );

  // Statistiques : 1 trade clos, avertissement d'échantillon, ventilation par sens.
  await page.goto('#/trading/stats');
  await expect(page.getByText('Échantillon trop petit')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Vue d'ensemble \(1 trades? clos\)/ }),
  ).toBeVisible();
  await page.getByLabel('Ventiler par').selectOption('direction');
  await expect(page.getByRole('rowheader', { name: 'Short' })).toBeVisible();

  // Suppression du trade manuel.
  await page.goto('#/trading/trades');
  await page.getByRole('list', { name: 'Trades' }).getByRole('link').first().click();
  await page.getByRole('button', { name: 'Supprimer ce trade manuel' }).click();
  await expect(page).toHaveURL(/#\/trading\/trades$/);
  await expect(page.getByText('0 trade · 0 clos')).toBeVisible();
});
