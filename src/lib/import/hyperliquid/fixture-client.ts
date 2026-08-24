/**
 * Client Hyperliquid hors ligne servant un jeu de données synthétique (`tests/fixtures/hyperliquid/
 * demo.json`, généré par `npm run fixture:hl`) avec la sémantique de l'API réelle : pagination par
 * `startTime` inclusif, tailles de page, adresse inconnue → réponse vide. Utilisé par le mode
 * démonstration (`app.loadDemo`) et par le stub réseau des tests E2E (`tests/e2e/helpers/network.ts`),
 * pour que l'écran, la démo et les tests passent par le même code de synchronisation.
 */
import type { HlClient } from './client';
import { parseSpotMeta } from './api-types';
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

/** Réponse de l'API fixture à un corps `info` ; `null` si le type n'est pas servi. */
export function answerInfo(fixture: HlFixture, body: Record<string, unknown>): unknown {
  const type = body['type'];
  if (type === 'spotMeta') return fixture.spotMeta;
  if (type === 'allMids') return fixture.allMids;
  if (type === 'portfolio') return fixture.portfolio;
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

export function fixtureClient(fixture: HlFixture): HlClient {
  return {
    info: (body) => Promise.resolve(answerInfo(fixture, body)),
    spotMeta: () => Promise.resolve(parseSpotMeta(fixture.spotMeta)),
  };
}
