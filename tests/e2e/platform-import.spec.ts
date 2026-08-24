/**
 * Imports natifs (Kraken), JSON Ghostfolio et compte on-chain (BTC stubé) : parcours UI complets,
 * chiffres à l'écran recalculés par le moteur (jamais de littéraux), persistance après rechargement.
 */
import { expect, test, type Page } from '@playwright/test';
import { computePortfolio } from '../../src/lib/domain/engine';
import { pairTransfers } from '../../src/lib/domain/transfers';
import { DEFAULT_ENGINE_SETTINGS } from '../../src/lib/domain/types';
import { fmtQty } from '../../src/lib/format/fr';
import { importGhostfolioJson } from '../../src/lib/import/ghostfolio/index';
import { syncBtcAddress } from '../../src/lib/import/onchain/btc';
import { movementsToDrafts } from '../../src/lib/import/onchain/normalize';
import { pivotLedgerEvents } from '../../src/lib/import/pivot/events';
import { importAnyCsv } from '../../src/lib/import/platforms/index';
import { draftsToPivotRows } from '../../src/lib/import/platforms/drafts';
import type { RawPivotRow } from '../../src/lib/domain/types';
import { ONCHAIN_BTC_ADDRESS, ONCHAIN_BTC_TXS, stubNetwork } from './helpers/network';

/** Même taux que le stub Frankfurter de `helpers/network.ts`. */
const USD_RATE = (): string => '1.1';

const KRAKEN_CSV = [
  'txid,refid,time,type,subtype,aclass,asset,wallet,amount,fee,balance',
  'L1,T1,2025-03-11 09:14:22.1180,trade,,currency,ZEUR,spot,-150.0000,0.25,842.10',
  'L2,T1,2025-03-11 09:14:22.1180,trade,,currency,XXBT,spot,0.00500000,0.00001200,0.00500000',
  'L3,T2,2025-04-02 18:02:03.4400,deposit,,currency,XETH,spot,0.50000000,0.00,0.50000000',
  'L4,T3,2025-04-05 07:40:11.0000,withdrawal,,currency,XETH,spot,-0.20000000,0.00050000,0.29950000',
  'L5,T4,2025-04-30 00:05:00.0000,earn,reward,currency,ADA.S,earn,4.552000,0.00,4.552000',
  'L6,T7,2025-05-03 08:00:00.0000,trade,,currency,XXBT,spot,-0.00200000,0,0.00298800',
  'L7,T7,2025-05-03 08:00:00.0000,trade,,currency,ZEUR,spot,90.00,0,932.10',
].join('\n');

const GHOSTFOLIO_JSON = JSON.stringify({
  meta: { date: '2026-08-01T00:00:00.000Z', version: '2.100.0' },
  accounts: [
    {
      id: 'a1111111-1111-4111-8111-111111111111',
      name: 'Portefeuille démo',
      currency: 'EUR',
      comment: null,
      platformId: null,
      balances: [],
    },
  ],
  activities: [
    {
      accountId: 'a1111111-1111-4111-8111-111111111111',
      comment: null,
      fee: 2.5,
      quantity: 0.02,
      type: 'BUY',
      unitPrice: 50000,
      currency: 'EUR',
      dataSource: 'COINGECKO',
      date: '2025-02-01T09:00:00.000Z',
      symbol: 'bitcoin',
      tags: [],
    },
    {
      accountId: 'a1111111-1111-4111-8111-111111111111',
      comment: null,
      fee: 0,
      quantity: 0.5,
      type: 'DIVIDEND',
      unitPrice: 120,
      currency: 'EUR',
      dataSource: 'COINGECKO',
      date: '2025-03-01T09:00:00.000Z',
      symbol: 'solana',
      tags: [],
    },
  ],
});

function portfolioOf(rows: Record<string, RawPivotRow>) {
  const { events } = pivotLedgerEvents(Object.values(rows), {}, USD_RATE);
  const pairing = pairTransfers(events);
  return computePortfolio({
    events: pairing.events,
    prices: {},
    settings: DEFAULT_ENGINE_SETTINGS,
  });
}

async function importInto(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
  accountLabel: string,
): Promise<void> {
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

test('export Kraken ledgers.csv : détection, import, chiffres = moteur', async ({ page }) => {
  const expected = importAnyCsv(KRAKEN_CSV, {}, 'csv:e2e-kraken', 'i1', USD_RATE);
  expect(expected.ok).toBe(true);
  if (!expected.ok) return;
  const report = portfolioOf(expected.rows);
  const btc = report.positions.find((p) => p.asset === 'btc')!;

  await importInto(
    page,
    { name: 'ledgers.csv', mimeType: 'text/csv', buffer: Buffer.from(KRAKEN_CSV) },
    'Kraken démo',
  );
  await expect(
    page.getByText(`${expected.report.newRows} nouvelle(s) ligne(s) · 0 déjà connue(s)`, {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Voir mon portefeuille' }).click();
  await expect(page.getByRole('list', { name: 'Positions' }).getByRole('listitem')).toHaveCount(
    report.positions.length,
  );
  await expect(
    page
      .getByRole('list', { name: 'Positions' })
      .getByRole('listitem')
      .filter({ hasText: 'BTC' })
      .getByText(fmtQty(btc.qty), { exact: false }),
  ).toBeVisible();
});

test('export JSON Ghostfolio : détection, import, récompense valorisée', async ({ page }) => {
  const expected = importGhostfolioJson(GHOSTFOLIO_JSON, {}, 'csv:e2e-gf', 'i1', USD_RATE);
  expect(expected.ok).toBe(true);
  if (!expected.ok) return;
  expect(expected.report.counts).toMatchObject({ trades: 1, rewards: 1 });

  await importInto(
    page,
    {
      name: 'ghostfolio-export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(GHOSTFOLIO_JSON),
    },
    'Ghostfolio démo',
  );
  const report = portfolioOf(expected.rows);
  await page.getByRole('link', { name: 'Voir mon portefeuille' }).click();
  await expect(page.getByRole('list', { name: 'Positions' }).getByRole('listitem')).toHaveCount(
    report.positions.length,
  );
});

test('adresse on-chain BTC : suivi, synchronisation stubée, position = moteur, persistance', async ({
  page,
}) => {
  // Rejoue la synchronisation comme l'app, sur les mêmes réponses que le stub réseau.
  const fetchStub = async (url: string): Promise<Response> =>
    ({
      ok: true,
      status: 200,
      json: async () => (url.includes('/txs') ? ONCHAIN_BTC_TXS : {}),
    }) as unknown as Response;
  const sync = await syncBtcAddress(ONCHAIN_BTC_ADDRESS, { fetch: fetchStub });
  const parsed = draftsToPivotRows(movementsToDrafts(sync.movements), 'i1', 'oc:btc-e2e');
  const rows = Object.fromEntries(parsed.rows.map((r) => [r.key, r]));
  const report = portfolioOf(rows);
  const btc = report.positions.find((p) => p.asset === 'btc')!;

  await page.goto('#/accounts');
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Suivre une adresse on-chain' }),
  });
  await card.getByLabel('Adresse publique').fill(ONCHAIN_BTC_ADDRESS);
  await card.getByLabel('Nom (facultatif)').fill('Wallet BTC démo');
  await card.getByRole('button', { name: 'Suivre et synchroniser' }).click();
  await expect(
    page.getByText(`Synchronisé : ${sync.movements.length} nouveau(x) mouvement(s)`, {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText('Bitcoin · bc1qdemo', { exact: false })).toBeVisible();

  await page.goto('#/portfolio');
  await expect(
    page
      .getByRole('list', { name: 'Positions' })
      .getByRole('listitem')
      .filter({ hasText: 'BTC' })
      .getByText(fmtQty(btc.qty), { exact: false }),
  ).toBeVisible();

  // Persistance : l'adresse et ses mouvements survivent au rechargement (re-sync inutile).
  await page.reload();
  await page.goto('#/accounts');
  await expect(page.getByText('Bitcoin · bc1qdemo', { exact: false })).toBeVisible();
  await page.goto('#/portfolio');
  await expect(
    page.getByRole('list', { name: 'Positions' }).getByRole('listitem').filter({ hasText: 'BTC' }),
  ).toBeVisible();
});
