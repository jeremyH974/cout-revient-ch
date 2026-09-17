/**
 * Client Hyperliquid hors ligne servant un jeu de données synthétique (`tests/fixtures/hyperliquid/
 * demo.json`, généré par `npm run fixture:hl`) avec la sémantique de l'API réelle : pagination par
 * `startTime` inclusif, tailles de page, adresse inconnue → réponse vide. Utilisé par le mode
 * démonstration (`app.loadDemo`) et par le stub réseau des tests E2E (`tests/e2e/helpers/network.ts`),
 * pour que l'écran, la démo et les tests passent par le même code de synchronisation. Les bougies
 * (`candleSnapshot`) viennent du tracé de cours du jeu (`fixture-prices.ts`), le même dont le
 * générateur tire les points `portfolio` : la courbe détaillée de la démo se recoupe.
 */
import type { HlClient } from './client';
import { parseSpotMeta } from './api-types';
import { CANDLE_INTERVALS } from './candles';
import { pathCandles, priceKnots, type PriceKnot } from './fixture-prices';
import { FILLS_PAGE, LEDGER_PAGE } from './sync';

/** Réponses de l'API telles quelles (formes brutes), pour une adresse. */
export interface HlFixture {
  address: string;
  userFillsByTime: unknown[];
  userFunding: unknown[];
  userNonFundingLedgerUpdates: unknown[];
  clearinghouseState: unknown;
  spotClearinghouseState: unknown;
  spotMeta: unknown;
  /** Cours `allMids` (perp par nom, spot par paire/index), pour le stub de prix. */
  allMids: Record<string, string>;
  /** Réponse `portfolio` : tuples `[période, { accountValueHistory, pnlHistory, vlm }]`. */
  portfolio: unknown;
}

const timeOf = (item: unknown): number =>
  typeof item === 'object' && item !== null && typeof (item as { time?: unknown }).time === 'number'
    ? (item as { time: number }).time
    : 0;

function page(items: unknown[], body: Record<string, unknown>, size: number): unknown[] {
  const start = typeof body['startTime'] === 'number' ? body['startTime'] : 0;
  const end = typeof body['endTime'] === 'number' ? body['endTime'] : Number.POSITIVE_INFINITY;
  return items
    .filter((item) => timeOf(item) >= start && timeOf(item) <= end)
    .sort((a, b) => timeOf(a) - timeOf(b))
    .slice(0, size);
}

const knotsByFixture = new WeakMap<HlFixture, Record<string, PriceKnot[]>>();

/** Bougies du tracé de cours du jeu, sous la forme de `candleSnapshot` (vide si inconnu). */
function candles(fixture: HlFixture, body: Record<string, unknown>): unknown[] {
  const req = typeof body['req'] === 'object' && body['req'] !== null ? body['req'] : {};
  const { coin, interval, startTime, endTime } = req as Record<string, unknown>;
  const step = CANDLE_INTERVALS.find((i) => i.id === interval);
  if (typeof coin !== 'string' || !step || typeof startTime !== 'number') return [];
  let knots = knotsByFixture.get(fixture);
  if (!knots) {
    knots = priceKnots(fixture);
    knotsByFixture.set(fixture, knots);
  }
  const to = typeof endTime === 'number' ? endTime : Number.POSITIVE_INFINITY;
  return pathCandles(knots[coin] ?? [], coin, step, startTime, to);
}

/** Réponse de l'API fixture à un corps `info` ; `null` si le type n'est pas servi. */
export function answerInfo(fixture: HlFixture, body: Record<string, unknown>): unknown {
  const type = body['type'];
  if (type === 'spotMeta') return fixture.spotMeta;
  if (type === 'allMids') return fixture.allMids;
  if (type === 'portfolio') return fixture.portfolio;
  if (type === 'candleSnapshot') return candles(fixture, body);
  const user = typeof body['user'] === 'string' ? body['user'].toLowerCase() : '';
  const known = user === fixture.address.toLowerCase();
  switch (type) {
    case 'userFillsByTime':
    case 'userFills':
      return known ? page(fixture.userFillsByTime, body, FILLS_PAGE) : [];
    case 'userFunding':
      return known ? page(fixture.userFunding, body, LEDGER_PAGE) : [];
    case 'userNonFundingLedgerUpdates':
      return known ? page(fixture.userNonFundingLedgerUpdates, body, LEDGER_PAGE) : [];
    case 'clearinghouseState':
      return known
        ? fixture.clearinghouseState
        : { marginSummary: { accountValue: '0.0' }, assetPositions: [], withdrawable: '0.0' };
    case 'spotClearinghouseState':
      return known ? fixture.spotClearinghouseState : { balances: [] };
    default:
      return null;
  }
}

let demoClient: Promise<HlClient> | null = null;

/**
 * Client hors ligne du jeu de démonstration, chargé à la demande et une seule fois. La courbe
 * détaillée s'en sert en démonstration même après un rechargement de page, quand le client de la
 * synchronisation n'existe plus : sans lui, un compte fictif recevrait de vrais cours.
 */
export function demoFixtureClient(): Promise<HlClient> {
  demoClient ??= import('../../../../tests/fixtures/hyperliquid/demo.json?raw').then(
    ({ default: text }) => fixtureClient(JSON.parse(text) as HlFixture),
  );
  return demoClient;
}

export function fixtureClient(fixture: HlFixture): HlClient {
  return {
    info: (body) => Promise.resolve(answerInfo(fixture, body)),
    spotMeta: () => Promise.resolve(parseSpotMeta(fixture.spotMeta)),
  };
}
