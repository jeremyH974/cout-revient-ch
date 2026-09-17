/**
 * Courbe détaillée sur le jeu de démonstration (décision n° 164) : l'application reconstitue la
 * valeur du compte depuis ses bruts et les bougies du client hors ligne, et doit recouper les
 * points `portfolio` que le générateur a tirés du compte par une implémentation À PART. Deux
 * calculs indépendants, un même compte : c'est l'oracle.
 *
 * Toutes les fenêtres de la plateforme, vues entières puis zoomées au début, au milieu et à la fin,
 * en équité comme en P&L. Puis la contre-épreuve à demeure : un dépôt retiré des bruts doit faire
 * écarter la reconstitution, et non la faire lisser.
 */
import { describe, expect, it } from 'vitest';
import { generateHlFixture, HL_DEMO_ADDRESS } from '../../scripts/generate-hl-fixture';
import {
  detailedCurve,
  marketsHeld,
  perpMarket,
  tokenMarket,
  type AccountMove,
  type DetailOutcome,
  type PriceSeries,
} from '../../src/lib/domain/trading/equity-path';
import {
  CandleCache,
  candleFetcher,
  planDetail,
  type TimeRange,
} from '../../src/lib/import/hyperliquid/candles';
import type { HlAccountData, HlSpotPairRef } from '../../src/lib/import/hyperliquid/data';
import {
  equityAnchors,
  equityMoves,
  spotCandleCoin,
} from '../../src/lib/import/hyperliquid/equity-moves';
import { fixtureClient, type HlFixture } from '../../src/lib/import/hyperliquid/fixture-client';
import { syncAccount } from '../../src/lib/import/hyperliquid/sync';

const PERIODS = ['day', 'week', 'month', 'allTime'] as const;
type Period = (typeof PERIODS)[number];

async function demo(): Promise<{
  fixture: HlFixture;
  data: HlAccountData;
  spotPairs: Record<string, HlSpotPairRef>;
}> {
  const fixture = generateHlFixture();
  const { data, spotPairs, error } = await syncAccount(
    fixtureClient(fixture),
    null,
    HL_DEMO_ADDRESS,
    { now: () => 1_755_900_000_000 },
  );
  expect(error).toBeNull();
  return { fixture, data, spotPairs };
}

async function detail(
  context: Awaited<ReturnType<typeof demo>>,
  period: Period,
  view: TimeRange,
  metric: 'equity' | 'pnl',
  alter: (moves: AccountMove[]) => AccountMove[] = (m) => m,
): Promise<{ outcome: DetailOutcome; interval: string }> {
  const { fixture, data, spotPairs } = context;
  const series = data.portfolio![period]!;
  const history = series.accountValueHistory;
  const extent = { from: history[0]![0], to: history[history.length - 1]![0] };
  const anchors = equityAnchors(data);
  const plan = planDetail(
    view,
    extent,
    anchors.map(([t]) => t),
    () => Number.NEGATIVE_INFINITY,
  );
  if (!plan) throw new Error(`aucun plan pour ${period}`);
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
    moves: alter(moves),
    spot,
    prices,
    from: plan.from,
    to: plan.to,
    intervalMs: plan.interval.ms,
    equity: anchors,
    pnl: metric === 'pnl' ? { equity: history, points: series.pnlHistory } : null,
  });
  return { outcome, interval: plan.interval.id };
}

/** La vue entière, puis un cinquième de la fenêtre au début, au milieu et à la fin. */
function views(data: HlAccountData, period: Period): TimeRange[] {
  const history = data.portfolio![period]!.accountValueHistory;
  const from = history[0]![0];
  const to = history[history.length - 1]![0];
  const fifth = (to - from) / 5;
  return [
    { from, to },
    { from, to: from + fifth },
    { from: from + 2 * fifth, to: from + 3 * fifth },
    { from: to - fifth, to },
  ];
}

describe('courbe détaillée du jeu de démonstration', () => {
  it('recoupe les points de la plateforme sur toutes les fenêtres, en équité comme en P&L', async () => {
    const context = await demo();
    for (const period of PERIODS) {
      for (const view of views(context.data, period)) {
        for (const metric of ['equity', 'pnl'] as const) {
          const { outcome, interval } = await detail(context, period, view, metric);
          const where = `${period} ${new Date(view.from).toISOString()} → ${new Date(view.to).toISOString()} (${metric}, ${interval})`;
          expect(outcome.kind, `${where} : ${JSON.stringify(outcome)}`).toBe('ok');
          if (outcome.kind !== 'ok') continue;
          expect(outcome.checked, where).toBeGreaterThan(0);
          expect(outcome.points.length, where).toBeGreaterThan(1);
        }
      }
    }
  });

  it('les positions ouvertes sont bien dans le périmètre : la vérification porte sur un compte exposé', async () => {
    const context = await demo();
    // Du 1er au 10 août : BTC, puis ETH, puis HYPE ouverts tour à tour.
    const view = { from: Date.UTC(2026, 7, 1), to: Date.UTC(2026, 7, 10) };
    const { moves, spot } = equityMoves(context.data, context.spotPairs);
    expect(marketsHeld(moves, spot, view.from, view.to).perps).toEqual(['BTC', 'ETH', 'HYPE']);
    const { outcome } = await detail(context, 'month', view, 'equity');
    expect(outcome.kind).toBe('ok');
  });

  it('contre-épreuve : un dépôt effacé des bruts fait écarter la reconstitution, sans la lisser', async () => {
    const context = await demo();
    // Le dépôt du 12 août, au milieu de la fenêtre de 30 jours.
    const deposit = Date.UTC(2026, 7, 12, 10);
    const view = { from: deposit - 2 * 86_400_000, to: deposit + 2 * 86_400_000 };
    const { outcome } = await detail(context, 'month', view, 'equity', (moves) =>
      moves.filter((m) => !(m.kind === 'flow' && m.time === deposit)),
    );
    expect(outcome.kind).toBe('mismatch');
  });
});
