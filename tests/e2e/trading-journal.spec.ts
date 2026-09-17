import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { D } from '../../src/lib/domain/money';
import { executionLines, tradeCosts } from '../../src/lib/domain/trading/costs';
import { journaledTrips } from '../../src/lib/domain/trading/journal';
import { buildRoundTrips } from '../../src/lib/domain/trading/round-trips';
import { fmtMoney, fmtPct, fmtPrice, fmtSmallPct } from '../../src/lib/format/fr';
import { breakevenSentence, rolesSentence } from '../../src/lib/format/trade-costs';
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

/** Exécutions et aller-retours attendus, reconstruits par le moteur depuis la fixture. */
async function expectedTrading() {
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
  const { executions, funding } = normalized.trading;
  return { executions, trips: journaledTrips(buildRoundTrips(executions, funding), [], {}) };
}

/** Aller-retours attendus (aucun chiffre en dur). */
async function expectedTrips() {
  return (await expectedTrading()).trips;
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

test('fiche d’un trade : part du brut en frais, seuil de rentabilité et rôle de chaque exécution recoupent le moteur', async ({
  page,
}) => {
  const { executions, trips } = await expectedTrading();
  const analysed = trips.map((journaled, index) => {
    const lines = executionLines(journaled.trip, executions);
    return { index, trip: journaled.trip, lines, costs: tradeCosts(journaled.trip, lines) };
  });
  // Un trade clos gagnant sur le prix, aux exécutions maker ET taker ; une position ouverte dont un
  // ordre a traversé le carnet en plusieurs tranches à la même milliseconde.
  const closed = analysed.find(
    (a) =>
      a.trip.status === 'closed' &&
      a.costs.feeShareOfGross !== null &&
      a.costs.makerFills > 0 &&
      a.costs.takerFills > 0,
  );
  const open = analysed.find(
    (a) => a.trip.status === 'open' && a.costs.breakevenPrice && a.lines.some((l) => l.fills > 1),
  );
  const flipped = analysed.find((a) => a.lines.some((l) => l.shared));
  expect(closed && open && flipped, 'la démo doit porter les trois cas').toBeTruthy();

  const rows = page.getByRole('list', { name: 'Trades' }).getByRole('listitem');
  const card = page.getByRole('region', { name: 'Frais et seuil de rentabilité' });
  const kpi = (label: string) =>
    card
      .locator('dl > div')
      .filter({ has: page.locator('dt', { hasText: label }) })
      .locator('dd');
  const executionsList = page.getByRole('list', { name: 'Exécutions du trade' });
  const showTrade = async (index: number) => {
    await page.goto('#/trading/trades');
    await rows.nth(index).getByRole('link').click();
    await expect(page).toHaveURL(/#\/trading\/trade\//);
  };

  await openDemo(page);

  // Trade clos : les quatre chiffres, la phrase du seuil, et le rôle de chaque ligne dans l'ordre.
  const c = closed!;
  await showTrade(c.index);
  await expect(kpi('Part du brut en frais')).toHaveText(
    normalize(fmtPct(c.costs.feeShareOfGross, { sign: false })),
  );
  await expect(kpi('Taux de frais moyen')).toHaveText(
    normalize(fmtSmallPct(c.costs.averageFeeRate)),
  );
  await expect(kpi('Seuil de rentabilité')).toHaveText(
    normalize(fmtSmallPct(c.costs.breakevenMove)),
  );
  await expect(kpi('Mouvement capté')).toHaveText(
    normalize(fmtSmallPct(c.costs.capturedMove, { sign: true })),
  );
  await expect(card.getByText(normalize(breakevenSentence(c.trip, c.costs)!))).toBeVisible();
  await expect(page.getByText(rolesSentence(c.costs)!, { exact: true })).toBeVisible();
  const lines = c.lines.slice(0, 20);
  await expect(executionsList.getByRole('listitem')).toHaveCount(lines.length);
  expect(await executionsList.locator('.role').allTextContents()).toEqual(lines.map((l) => l.role));
  // Frais de la première ligne, convertis au taux stubé comme le reste de l'écran.
  await expect(executionsList.getByRole('listitem').first()).toContainText(
    normalize(fmtMoney(lines[0]!.fee.neg().div(EUR_USD), 'EUR', { sign: true })),
  );
  await expect(executionsList.getByRole('listitem').first()).toContainText(
    normalize(fmtSmallPct(lines[0]!.feeRate)),
  );

  // Position ouverte : point mort et hypothèse nommés ; les tranches d'un ordre tiennent en une ligne.
  const o = open!;
  await showTrade(o.index);
  await expect(kpi('Point mort')).toHaveText(normalize(fmtPrice(o.costs.breakevenPrice, 'USD')));
  await expect(card.getByText(normalize(breakevenSentence(o.trip, o.costs)!))).toBeVisible();
  const sweep = o.lines.findIndex((l) => l.fills > 1);
  await expect(executionsList.getByRole('listitem').nth(sweep)).toContainText(
    `${o.lines[sweep]!.fills} fills`,
  );
  if (o.lines.length > 20) {
    await expect(executionsList.getByRole('listitem')).toHaveCount(20);
    await page.getByRole('button', { name: /^Afficher \d+ de plus/ }).click();
  }
  await expect(executionsList.getByRole('listitem')).toHaveCount(o.lines.length);

  // Retournement : la ligne partagée le dit.
  await showTrade(flipped!.index);
  await expect(executionsList.getByText('part de ce trade (retournement)')).toBeVisible();
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
  //
  // La plage est désormais celle de l'application (décision n° 156), et son défaut est « 1 mois » :
  // ce trade de juillet tombe donc hors fenêtre, et l'écran le DIT — « aucun trade clos sur 1 mois,
  // élargissez la période ». C'est le prix assumé d'une plage unique, et la sortie est à un clic.
  await page.goto('#/trading/stats');
  await expect(page.getByText(/Aucun trade clos sur 1 mois/)).toBeVisible();
  await page.getByRole('radio', { name: 'Tout', exact: true }).click();
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
