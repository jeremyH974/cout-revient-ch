import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fullWindow, minimumSpan, zoomWindow } from '../../src/components/charts/zoom';
import type { Big } from '../../src/lib/domain/money';
import {
  detailedCurve,
  marketsHeld,
  perpMarket,
  tokenMarket,
  type DetailOutcome,
  type PriceSeries,
} from '../../src/lib/domain/trading/equity-path';
import { candleWords, platformPoints } from '../../src/lib/format/curve-detail';
import { fmtMoney } from '../../src/lib/format/fr';
import {
  CandleCache,
  DETAIL_MIN_SPAN_MS,
  candleFetcher,
  planDetail,
} from '../../src/lib/import/hyperliquid/candles';
import {
  equityAnchors,
  equityMoves,
  spotCandleCoin,
} from '../../src/lib/import/hyperliquid/equity-moves';
import { fixtureClient, type HlFixture } from '../../src/lib/import/hyperliquid/fixture-client';
import { syncAccount } from '../../src/lib/import/hyperliquid/sync';
import { openDemo } from './helpers/demo';
import { normalize } from './helpers/expected';
import { EUR_USD_RATE, stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** La plage réellement tracée se lit dans l'étiquette de la courbe : « … de X le … à Y le … ». */
const rangeOf = (label: string | null): string => (label ?? '').replace(/^[^:]*: /, '');

async function evolution(page: Page) {
  await openDemo(page);
  await page.goto('#/trading');
  const card = page.locator('section.evolution');
  const toolbar = card.getByRole('group', { name: 'Zoom de la courbe' });
  const chart = card.locator('svg[role="img"]').first();
  const range = async (): Promise<string> => rangeOf(await chart.getAttribute('aria-label'));
  return { toolbar, chart, range, reset: toolbar.getByRole('button', { name: 'Tout afficher' }) };
}

test('courbe Évolution : zoom par boutons — l’alternative au glisser, sur tous les appareils', async ({
  page,
}) => {
  const { toolbar, range, reset } = await evolution(page);
  await expect(reset).toBeDisabled();
  await expect(toolbar.getByRole('button', { name: 'Zoom arrière' })).toBeDisabled();
  const full = await range();

  await toolbar.getByRole('button', { name: 'Zoom avant' }).click();
  await expect(reset).toBeEnabled();
  await expect(toolbar.locator('.zoom-state')).toContainText('Zoom :');
  const zoomed = await range();
  expect(zoomed).not.toBe(full);

  // Zoom centré : on peut aller plus tôt comme plus tard.
  await toolbar.getByRole('button', { name: 'Plus tôt' }).click();
  await expect.poll(range).not.toBe(zoomed);
  await reset.click();
  await expect(reset).toBeDisabled();
  await expect.poll(range).toBe(full);
});

test('courbe Évolution : molette autour du curseur, glisser pour remonter le temps, double-clic pour tout afficher', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'molette et glisser à la souris : parcours desktop');
  const { chart, range, reset } = await evolution(page);
  const full = await range();
  const box = (await chart.boundingBox())!;
  const cx = box.x + box.width * 0.75;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -900);
  await expect(reset).toBeEnabled();
  const wheeled = await range();
  expect(wheeled).not.toBe(full);

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + box.width * 0.25, cy, { steps: 6 });
  await page.mouse.up();
  await expect.poll(range).not.toBe(wheeled);

  await chart.dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(reset).toBeDisabled();
  await expect.poll(range).toBe(full);
});

const eur = (value: Big): string => normalize(fmtMoney(value.div(EUR_USD_RATE), 'EUR'));

/** La fin de la phrase du détail, telle que l'écran doit la dire pour ce résultat. */
function recoupe(outcome: Extract<DetailOutcome, { kind: 'ok' }>): string {
  const head = `Il recoupe ${platformPoints(outcome.checked)}`;
  if (outcome.flatDeviation === null) return `${head} dans la marge du cours de chaque bougie.`;
  const tail =
    outcome.flatChecked < outcome.checked
      ? ' aux instants sans position, et dans la marge du cours ailleurs'
      : '';
  return `${head} à ${eur(outcome.flatDeviation)} près${tail}.`;
}

/**
 * Le détail qu'un zoom avant sur la courbe « 1M » doit afficher, recalculé par le moteur depuis la
 * fixture — la vue suit le même chemin que l'écran : abscisses en heures de Paris à la minute,
 * zoom centré, retour aux instants réels, plan, bougies du client hors ligne.
 */
async function expectedDetail(metric: 'equity' | 'pnl') {
  const fixture = JSON.parse(
    readFileSync('tests/fixtures/hyperliquid/demo.json', 'utf8'),
  ) as HlFixture;
  const { data, spotPairs } = await syncAccount(fixtureClient(fixture), null, fixture.address, {
    now: () => 1_755_900_000_000,
  });
  const series = data.portfolio!['month']!;
  const history = series.accountValueHistory;
  const minute = (ms: number): number => Math.floor(ms / 60_000) * 60_000;
  const times = (metric === 'equity' ? history : series.pnlHistory).map(([ms]) => minute(ms));
  const full = fullWindow(times)!;
  const view = zoomWindow(
    full,
    full,
    (full.from + full.to) / 2,
    1.6,
    Math.min(minimumSpan(times, full), DETAIL_MIN_SPAN_MS),
  );
  // `realMs` de l'écran, fuseau de Paris (configuration Playwright) : l'abscisse lit la seconde.
  const second = (ms: number): number => Math.floor(Math.trunc(ms) / 1000) * 1000;
  const real = (ms: number): number => ms - (second(ms) - ms);
  const anchors = equityAnchors(data);
  const plan = planDetail(
    { from: real(view.from), to: real(view.to) },
    { from: history[0]![0], to: history[history.length - 1]![0] },
    anchors.map(([t]) => t),
    () => Number.NEGATIVE_INFINITY,
  )!;
  const { moves, spot } = equityMoves(data, spotPairs);
  const held = marketsHeld(moves, spot, plan.from, plan.to);
  const fetcher = candleFetcher(fixtureClient(fixture));
  const cache = new CandleCache();
  const prices: Record<string, PriceSeries> = {};
  for (const coin of held.perps)
    prices[perpMarket(coin)] = await cache.series(fetcher, coin, plan.interval, plan, Infinity);
  for (const token of held.tokens) {
    const coin = spotCandleCoin(token, spotPairs);
    if (coin)
      prices[tokenMarket(token)] = await cache.series(fetcher, coin, plan.interval, plan, Infinity);
  }
  const outcome = detailedCurve({
    moves,
    spot,
    prices,
    from: plan.from,
    to: plan.to,
    intervalMs: plan.interval.ms,
    equity: anchors,
    pnl: metric === 'pnl' ? { equity: history, points: series.pnlHistory } : null,
  });
  if (outcome.kind !== 'ok') throw new Error(`détail attendu : ${JSON.stringify(outcome)}`);
  return { interval: plan.interval.id, outcome, platformPointCount: history.length };
}

test('courbe Évolution : zoomée, elle se reconstitue depuis les fills et recoupe les points de la plateforme', async ({
  page,
}) => {
  const { toolbar, chart } = await evolution(page);
  const card = page.locator('section.evolution');
  const note = card.locator('.detail-note');
  const line = chart.locator('path.line.neutral');
  const segments = async (): Promise<number> =>
    ((await line.getAttribute('d')) ?? '').split('L').length;
  await expect(note).toHaveCount(0);

  await toolbar.getByRole('button', { name: 'Zoom avant' }).click();
  const equity = await expectedDetail('equity');
  await expect(note).toContainText('Détail reconstitué');
  await expect(note).toContainText(candleWords(equity.interval));
  await expect(note).toContainText(recoupe(equity.outcome));
  // Bien plus de points tracés que la plateforme n'en donne sur toute la période.
  expect(await segments()).toBeGreaterThan(4 * equity.platformPointCount);

  // P&L : même fenêtre, même bougies, calage recoupé sur la série de P&L.
  await card.getByRole('group', { name: 'Courbe' }).getByRole('button', { name: 'P&L' }).click();
  const pnl = await expectedDetail('pnl');
  await expect(note).toContainText(recoupe(pnl.outcome));

  // Zoomée, l'échelle suit la courbe : après le dépôt du 12 août, l'équité est loin au-dessus de
  // son départ, et la ligne « départ » sort du cadre au lieu d'écraser le détail en bas du graphique.
  await card.getByRole('group', { name: 'Courbe' }).getByRole('button', { name: 'Équité' }).click();
  for (let i = 0; i < 2; i++) await toolbar.getByRole('button', { name: 'Zoom avant' }).click();
  for (let i = 0; i < 4; i++) await toolbar.getByRole('button', { name: 'Plus tard' }).click();
  await expect(toolbar.getByRole('button', { name: 'Plus tard' })).toBeDisabled();
  const height = Number(await chart.getAttribute('height'));
  const departY = async (): Promise<number> => {
    const d = (await chart.locator('path.secondary').getAttribute('d')) ?? '';
    return Math.min(...[...d.matchAll(/[\d.]+,([\d.-]+)/g)].map((m) => Number(m[1])));
  };
  await expect.poll(departY).toBeGreaterThan(height);

  // Vue entière : la courbe redevient exactement celle de la plateforme, départ compris.
  await toolbar.getByRole('button', { name: 'Tout afficher' }).click();
  await expect(note).toHaveCount(0);
  await expect.poll(segments).toBeLessThan(4 * pnl.platformPointCount);
  await expect.poll(departY).toBeLessThan(height);
});
