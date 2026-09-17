/**
 * Bruts Hyperliquid → mouvements de la courbe détaillée (`equity-path.ts`, décision n° 164).
 *
 * Tout vient des bruts, jamais du rapport Trading : l'option « traiter le spot comme de
 * l'investissement » retire les fills spot de ce rapport, alors qu'ils font toujours bouger la
 * valeur du compte. Les apports reprennent en revanche **exactement** l'interprétation du moteur
 * (`ledgerToCashFlow`) : le P&L détaillé et le résultat de la carte ne peuvent pas diverger sur ce
 * qu'est un dépôt. Seule la quantité d'un jeton transféré est relue à part, le flux n'en gardant
 * que la valeur.
 *
 * Ce qui n'est pas interprété (staking, récompenses, types inconnus) n'est pas deviné : la
 * vérification contre les points de la plateforme le fera voir.
 */
import type { AccountMove, SpotBalances } from '../../domain/trading/equity-path';
import { CASH_TOKEN, withoutZeroSeed } from '../../domain/trading/equity-path';
import type { CurvePoint } from '../../domain/trading/curve';
import { isSpotCoin, resolveSpotPair, type HlLedgerUpdate } from './api-types';
import { sortedFills, type HlAccountData, type HlSpotPairRef } from './data';
import { ledgerToCashFlow } from './normalize';

/** Mouvement d'un jeton porté par un transfert : `amount` en quantité, signé selon le sens. */
function transferredQty(entry: HlLedgerUpdate, outgoing: boolean): string | null {
  const raw = entry.fields['amount'];
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : null;
  if (text === null || !/^\d+(\.\d+)?$/.test(text)) return null;
  return outgoing ? `-${text}` : text;
}

export function equityMoves(
  data: HlAccountData,
  spotPairs: Record<string, HlSpotPairRef>,
): { moves: AccountMove[]; spot: SpotBalances | null } {
  const pairs = Object.entries(spotPairs).map(([name, p]) => ({ name, ...p }));
  const moves: AccountMove[] = [];
  for (const fill of sortedFills(data.fills)) {
    if (!isSpotCoin(fill.coin)) {
      moves.push({
        kind: 'perp',
        time: fill.time,
        coin: fill.coin,
        side: fill.side === 'B' ? 'buy' : 'sell',
        qty: fill.sz,
        price: fill.px,
        startPosition: fill.startPosition,
        closedPnl: fill.closedPnl,
        // Un frais perps payé dans un autre jeton n'entame pas la trésorerie.
        fee: fill.feeToken === CASH_TOKEN ? fill.fee : '0',
      });
      continue;
    }
    const pair = resolveSpotPair(fill.coin, pairs);
    if (!pair) continue;
    moves.push({
      kind: 'spot',
      time: fill.time,
      base: pair.base,
      quote: pair.quote,
      side: fill.side === 'B' ? 'buy' : 'sell',
      qty: fill.sz,
      price: fill.px,
      fee: fill.fee,
      feeToken: fill.feeToken,
    });
  }
  for (const funding of Object.values(data.funding)) {
    moves.push({ kind: 'funding', time: funding.time, amount: funding.usdc });
  }
  for (const entry of Object.values(data.ledger)) {
    const { flow } = ledgerToCashFlow(entry, `hl:${data.address}`, data.address);
    if (flow.amount === '0') continue;
    if (flow.asset === CASH_TOKEN) {
      moves.push({
        kind: 'flow',
        time: entry.time,
        token: CASH_TOKEN,
        qty: flow.amount,
        value: flow.amount,
      });
      continue;
    }
    const qty = transferredQty(entry, flow.amount.startsWith('-'));
    if (qty !== null)
      moves.push({ kind: 'flow', time: entry.time, token: flow.asset, qty, value: flow.amount });
  }
  // Fills d'abord dans leur ordre d'exécution, puis tri stable par instant (`replayAt`).
  moves.sort((a, b) => a.time - b.time);

  const snapshot = data.snapshot;
  const spot: SpotBalances | null = snapshot
    ? {
        time: snapshot.perps.time > 0 ? snapshot.perps.time : Date.parse(snapshot.at),
        balances: Object.fromEntries(
          snapshot.spot.filter((b) => b.coin !== CASH_TOKEN).map((b) => [b.coin, b.total]),
        ),
      }
    : null;
  return { moves, spot };
}

/** Nom de marché des bougies d'un jeton spot : sa paire contre la trésorerie, s'il en a une. */
export function spotCandleCoin(
  token: string,
  spotPairs: Record<string, HlSpotPairRef>,
): string | null {
  for (const [name, pair] of Object.entries(spotPairs)) {
    if (pair.base === token && pair.quote === CASH_TOKEN) return name;
  }
  return null;
}

/**
 * Points d'équité de la plateforme (toutes fenêtres, sans les séries perps seules), dédoublonnés,
 * sans le départ à zéro que la fenêtre « depuis l'ouverture » pose avant sa première mesure.
 */
export const EQUITY_SERIES = ['day', 'week', 'month', 'allTime'] as const;

export function equityAnchors(data: HlAccountData): CurvePoint[] {
  const byTime = new Map<number, CurvePoint>();
  for (const period of EQUITY_SERIES) {
    for (const point of withoutZeroSeed(data.portfolio?.[period]?.accountValueHistory ?? [])) {
      byTime.set(point[0], point);
    }
  }
  return [...byTime.values()].sort((a, b) => a[0] - b[0]);
}
