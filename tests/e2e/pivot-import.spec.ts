/**
 * Import pivot (Koinly/Waltio) + virements internes appariés : deux fichiers dans deux comptes via
 * l'UI, chiffres à l'écran = moteur (jamais de littéraux), appariement délié/réactivé, persistance.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { computePortfolio } from '../../src/lib/domain/engine';
import { pairTransfers } from '../../src/lib/domain/transfers';
import { DEFAULT_ENGINE_SETTINGS } from '../../src/lib/domain/types';
import { fmtQty } from '../../src/lib/format/fr';
import { D } from '../../src/lib/domain/money';
import { pivotLedgerEvents } from '../../src/lib/import/pivot/events';
import { importPivotCsv } from '../../src/lib/import/pivot/index';
import { stubNetwork } from './helpers/network';

const EXCHANGE = 'tests/fixtures/pivot/demo-exchange.csv';
const LEDGER = 'tests/fixtures/pivot/demo-ledger.csv';
/** Même taux que le stub Frankfurter de `helpers/network.ts`. */
const USD_RATE = (): string => '1.1';

/** Rejoue les deux fichiers comme l'app : lignes → événements → appariement → moteur. */
function expected() {
  const first = importPivotCsv(
    readFileSync(EXCHANGE, 'utf8'),
    {},
    'csv:e2e-exchange',
    'i1',
    USD_RATE,
  );
  if (!first.ok) throw new Error(first.error);
  const second = importPivotCsv(
    readFileSync(LEDGER, 'utf8'),
    first.rows,
    'csv:e2e-ledger',
    'i2',
    USD_RATE,
  );
  if (!second.ok) throw new Error(second.error);
  const { events } = pivotLedgerEvents(Object.values(second.rows), {}, USD_RATE);
  const pairing = pairTransfers(events);
  const report = computePortfolio({
    events: pairing.events,
    prices: {},
    settings: DEFAULT_ENGINE_SETTINGS,
  });
  return { pairing, report, reports: { first: first.report, second: second.report } };
}

async function importInto(page: Page, file: string, accountLabel: string): Promise<void> {
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', file);
  await expect(page.getByRole('heading', { name: /reconnu$/ })).toBeVisible();
  await page.getByRole('radio', { name: 'Nouveau compte' }).check();
  await page.getByPlaceholder(/Nom du compte/).fill(accountLabel);
  await page.getByRole('button', { name: 'Importer dans ce compte' }).click();
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('deux CSV pivot dans deux comptes : chiffres = moteur, virement apparié, délier/réactiver, persistance', async ({
  page,
}) => {
  const { pairing, report, reports } = expected();
  expect(pairing.pairs).toHaveLength(1);
  const pair = pairing.pairs[0]!;

  await importInto(page, EXCHANGE, 'Plateforme démo');
  await expect(
    page.getByText(`${reports.first.newRows} nouvelle(s) ligne(s) · 0 déjà connue(s)`),
  ).toBeVisible();
  await importInto(page, LEDGER, 'Ledger démo');
  await expect(
    page.getByText('1 virement(s) interne(s) apparié(s)', { exact: false }),
  ).toBeVisible();

  // Portefeuille : autant de positions ouvertes que le moteur, quantité BTC identique.
  await page.getByRole('link', { name: 'Voir mon portefeuille' }).click();
  await expect(page.getByRole('list', { name: 'Positions' }).getByRole('listitem')).toHaveCount(
    report.positions.length,
  );
  const btc = report.positions.find((p) => p.asset === 'btc')!;
  await expect(
    page
      .getByRole('list', { name: 'Positions' })
      .getByRole('listitem')
      .filter({ hasText: 'BTC' })
      .getByText(fmtQty(btc.qty), { exact: false }),
  ).toBeVisible();

  // Comptes : la paire est listée avec ses deux comptes et la quantité du moteur.
  await page.goto('#/accounts');
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Virements internes' }),
  });
  await expect(card).toBeVisible();
  const line = card.locator('li').filter({ hasText: 'BTC' });
  await expect(line).toContainText(`${fmtQty(D(pair.qtyOut))} BTC`);
  await expect(line).toContainText('Plateforme démo → Ledger démo');

  // Délier : le retrait devient orphelin, puis l'appariement automatique se réactive.
  await card.getByRole('button', { name: 'Délier' }).click();
  await expect(card.getByText('retirés sans contrepartie', { exact: false })).toBeVisible();
  await card.getByRole('button', { name: "Réactiver l'appariement automatique" }).click();
  await expect(card.getByRole('button', { name: 'Délier' })).toBeVisible();

  // Persistance : après rechargement, lignes et appariement sont toujours là.
  await page.reload();
  await page.goto('#/accounts');
  await expect(page.getByRole('heading', { name: 'Virements internes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Délier' })).toBeVisible();
});

test('appariement manuel via le sélecteur quand la fenêtre automatique ne suffit pas', async ({
  page,
}) => {
  // Un retrait et un dépôt à 10 jours d'écart : hors fenêtre → orphelins → appariés à la main.
  const out = [
    'Date,Sent Amount,Sent Currency,Received Amount,Received Currency,Fee Amount,Fee Currency,Net Worth Amount,Net Worth Currency,Label,Description,TxHash',
    '2026-03-02 09:00:00,1000,EUR,0.03,BTC,,,,,,,',
    '2026-04-01 10:00:00,0.01,BTC,,,,,,,,,',
  ].join('\n');
  const into = [
    'Date,Sent Amount,Sent Currency,Received Amount,Received Currency,Fee Amount,Fee Currency,Net Worth Amount,Net Worth Currency,Label,Description,TxHash',
    '2026-04-11 10:00:00,,,0.0099,BTC,,,,,,,',
  ].join('\n');
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', {
    name: 'sortie.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(out),
  });
  await page.getByRole('radio', { name: 'Nouveau compte' }).check();
  await page.getByPlaceholder(/Nom du compte/).fill('Source');
  await page.getByRole('button', { name: 'Importer dans ce compte' }).click();
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();
  await page.setInputFiles('input[type="file"]', {
    name: 'entree.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(into),
  });
  await page.getByRole('radio', { name: 'Nouveau compte' }).check();
  await page.getByPlaceholder(/Nom du compte/).fill('Destination');
  await page.getByRole('button', { name: 'Importer dans ce compte' }).click();
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();

  await page.goto('#/accounts');
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Virements internes' }),
  });
  await expect(card.getByText('retirés sans contrepartie', { exact: false })).toBeVisible();
  await card.getByRole('combobox').selectOption({ index: 1 });
  await card.getByRole('button', { name: 'Apparier' }).click();
  await expect(card.getByRole('button', { name: 'Délier' })).toBeVisible();
  await expect(card.getByText('apparié manuellement', { exact: false })).toBeVisible();
});
