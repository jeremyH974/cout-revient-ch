/**
 * Reconstruction des aller-retours perps (flat → position → flat) à partir des exécutions, par
 * (compte, symbole) : un retournement (`Long > Short`) clôt l'aller-retour et en ouvre un autre
 * dans la même exécution (frais partagés au prorata, `closedPnl` entièrement à la clôture) ; le
 * funding est rattaché à l'aller-retour ouvert au moment du paiement ; `startPosition` sert de
 * garde — si l'historique reconstruit ne recolle pas (fills antérieurs purgés par l'API), un
 * aller-retour « incomplet » est ouvert plutôt que d'afficher des moyennes fausses. Module pur.
 *
 * Périmètre v1 : perps uniquement — le spot vit dans « Avoirs spot » ou dans l'Investissement
 * (PRU), un aller-retour spot n'aurait pas de `closedPnl` de plateforme à réconcilier.
 */
import { D, ZERO, divOrNull, max, type Big } from '../money';
import type { AccountId, NaiveDateTime } from '../types';
import type { Execution, FundingPayment, Market, TradingSource } from './types';

export interface RoundTrip {
  /** `rt:<compte>:<symbole>:<ms d'ouverture>` ; stable tant que l'historique ne change pas. */
  id: string;
  accountId: AccountId;
  market: Market;
  symbol: string;
  quote: string;
  direction: 'long' | 'short';
  status: 'open' | 'closed';
  openedAt: NaiveDateTime;
  openedTime: number;
  closedAt: NaiveDateTime | null;
  closedTime: number | null;
  executionIds: string[];
  /** Quantités cumulées à l'ouverture / à la clôture (égales sur un aller-retour clos et complet). */
  qtyOpened: Big;
  qtyClosed: Big;
  /** Taille maximale atteinte. */
  qtyMax: Big;
  /** Prix d'entrée moyen ; `null` si l'ouverture est inconnue (historique tronqué). */
  avgEntry: Big | null;
  avgExit: Big | null;
  /** Σ `closedPnl` (brut de frais). */
  grossPnl: Big;
  /** Frais dans la devise de cotation (prorata sur les retournements). */
  fees: Big;
  funding: Big;
  /** `grossPnl − fees + funding`. */
  netPnl: Big;
  holdSeconds: number | null;
  liquidated: boolean;
  /** Ouverture non couverte par l'historique disponible : moyennes d'entrée non calculables. */
  incomplete: boolean;
  source: TradingSource;
}

interface Building {
  trip: RoundTrip;
  entryNotional: Big;
  exitNotional: Big;
}

/**
 * Identifiant stable ET unique : plusieurs aller-retours peuvent naître à la même milliseconde
 * (fills multiples d'un même ordre, clôture + réouverture, retournement) — un numéro d'ordre par
 * (compte, symbole) départage, déterministe tant que l'historique ne fait que s'allonger.
 */
const tripId = (accountId: AccountId, symbol: string, openedTime: number, seq: number): string =>
  `rt:${accountId}:${symbol}:${openedTime}:${seq}`;

/**
 * Séparateur de la clé composite (compte, symbole) — ni l’un ni l’autre ne peut contenir
 * un NUL, donc aucune collision possible. Écrit en ÉCHAPPEMENT et jamais en octet brut : un NUL
 * littéral dans un fichier source le rend « binaire » aux yeux de grep, qui saute alors le
 * fichier ENTIER en silence — invisible à toute recherche dans le dépôt.
 */
const KEY_SEP = '\u0000';

function open(
  x: Execution,
  qty: Big,
  price: Big,
  direction: 'long' | 'short',
  incomplete: boolean,
  seq: number,
): Building {
  return {
    trip: {
      id: tripId(x.accountId, x.symbol, x.time, seq),
      accountId: x.accountId,
      market: x.market,
      symbol: x.symbol,
      quote: x.quote,
      direction,
      status: 'open',
      openedAt: x.at,
      openedTime: x.time,
      closedAt: null,
      closedTime: null,
      executionIds: [x.id],
      qtyOpened: qty,
      qtyClosed: ZERO,
      qtyMax: qty,
      avgEntry: null,
      avgExit: null,
      grossPnl: ZERO,
      fees: ZERO,
      funding: ZERO,
      netPnl: ZERO,
      holdSeconds: null,
      liquidated: x.liquidation,
      incomplete,
      source: x.source,
    },
    entryNotional: incomplete ? ZERO : qty.times(price),
    exitNotional: ZERO,
  };
}

function finalize(
  b: Building,
  closedAt: NaiveDateTime | null,
  closedTime: number | null,
): RoundTrip {
  const t = b.trip;
  const avgEntry = t.incomplete ? null : divOrNull(b.entryNotional, t.qtyOpened);
  const avgExit = divOrNull(b.exitNotional, t.qtyClosed);
  const status = closedTime === null ? 'open' : 'closed';
  return {
    ...t,
    status,
    closedAt,
    closedTime,
    avgEntry,
    avgExit,
    netPnl: t.grossPnl.minus(t.fees).plus(t.funding),
    holdSeconds: closedTime === null ? null : Math.round((closedTime - t.openedTime) / 1000),
  };
}

/** Aller-retours d'un compte, du plus récent au plus ancien ; funding rattaché par fenêtre. */
export function buildRoundTrips(
  executions: readonly Execution[],
  funding: readonly FundingPayment[] = [],
): RoundTrip[] {
  const bySymbol = new Map<string, Execution[]>();
  for (const x of executions) {
    if (x.market !== 'perp') continue;
    const key = `${x.accountId}${KEY_SEP}${x.symbol}`;
    const list = bySymbol.get(key);
    if (list) list.push(x);
    else bySymbol.set(key, [x]);
  }
  const trips: RoundTrip[] = [];

  for (const list of bySymbol.values()) {
    /*
     * Tri par instant SEUL, et stable (ES2019) : dans une même milliseconde, l'ordre reçu EST
     * l'ordre d'exécution — c'est la normalisation qui l'établit, en rejouant la chaîne des
     * `startPosition` (décision n° 129). Départager par identifiant, comme ici auparavant, revenait
     * à rejouer un ordre qui traverse le carnet dans le désordre : la position reconstruite ne
     * recollait plus, et le garde-fou ci-dessous ouvrait un aller-retour « incomplet » par fill.
     */
    list.sort((a, b) => a.time - b.time);
    let position = ZERO;
    let current: Building | null = null;
    let seq = 0;
    const close = (b: Building, at: NaiveDateTime | null, time: number | null): void => {
      trips.push(finalize(b, at, time));
    };

    for (const x of list) {
      // Garde : si la position reconstruite ne recolle pas avec `startPosition` (historique purgé
      // côté API, premier import en cours de position), on repart de la position annoncée.
      const startPosition = D(x.startPosition);
      if (!position.eq(startPosition)) {
        if (current) {
          current.trip.incomplete = true;
          close(current, null, null);
          current = null;
        }
        position = startPosition;
        if (!position.eq(ZERO)) {
          current = open(
            x,
            position.abs(),
            D(x.price),
            position.lt(ZERO) ? 'short' : 'long',
            true,
            seq++,
          );
          current.trip.executionIds = [];
          current.trip.liquidated = false;
        }
      }

      const qty = D(x.qty);
      const price = D(x.price);
      const signed = x.side === 'buy' ? qty : qty.neg();
      const opens = position.eq(ZERO) || position.s === signed.s;

      if (opens) {
        if (current === null) {
          current = open(x, qty, price, signed.lt(ZERO) ? 'short' : 'long', false, seq++);
          current.trip.fees = D(x.fee);
        } else {
          current.trip.executionIds.push(x.id);
          current.trip.qtyOpened = current.trip.qtyOpened.plus(qty);
          current.entryNotional = current.entryNotional.plus(qty.times(price));
          current.trip.fees = current.trip.fees.plus(x.fee);
          current.trip.liquidated ||= x.liquidation;
        }
        position = position.plus(signed);
        current.trip.qtyMax = max(current.trip.qtyMax, position.abs());
        continue;
      }

      // L'exécution réduit (ou retourne) la position.
      const closing = qty.lte(position.abs()) ? qty : position.abs();
      const remainder = qty.minus(closing);
      const closingFee = remainder.gt(ZERO) ? D(x.fee).times(closing).div(qty) : D(x.fee);
      if (current === null) {
        // Position non nulle sans aller-retour courant : historique tronqué (déjà couvert par la
        // garde `startPosition`), on ouvre un incomplet par sûreté.
        current = open(x, position.abs(), price, position.lt(ZERO) ? 'short' : 'long', true, seq++);
        current.trip.executionIds = [];
        current.trip.fees = ZERO;
      }
      current.trip.executionIds.push(x.id);
      current.trip.qtyClosed = current.trip.qtyClosed.plus(closing);
      current.exitNotional = current.exitNotional.plus(closing.times(price));
      current.trip.grossPnl = current.trip.grossPnl.plus(x.closedPnl);
      current.trip.fees = current.trip.fees.plus(closingFee);
      current.trip.liquidated ||= x.liquidation;
      position = position.plus(signed);

      if (remainder.gt(ZERO)) {
        // Retournement : clôture ici, réouverture dans l'autre sens avec le reliquat.
        close(current, x.at, x.time);
        current = open(x, remainder, price, signed.lt(ZERO) ? 'short' : 'long', false, seq++);
        current.trip.fees = D(x.fee).minus(closingFee);
        current.trip.qtyMax = remainder;
      } else if (position.eq(ZERO)) {
        close(current, x.at, x.time);
        current = null;
      }
    }
    if (current) close(current, null, null);
  }

  // Funding : rattaché à l'aller-retour du symbole dont la fenêtre contient le paiement.
  const sorted = trips.sort((a, b) => b.openedTime - a.openedTime);
  for (const f of funding) {
    const trip = tripOfFunding(sorted, f);
    if (trip) {
      trip.funding = trip.funding.plus(f.amount);
      trip.netPnl = trip.grossPnl.minus(trip.fees).plus(trip.funding);
    }
  }
  return sorted;
}

/**
 * Aller-retour auquel rattacher un paiement de funding : même compte, même symbole, et paiement
 * dans la fenêtre de détention. Exporté pour que le calendrier applique EXACTEMENT la même règle
 * que la reconstruction — deux rattachements divergents donneraient deux chiffres différents.
 * `trips` est parcouru dans son ordre : le premier candidat gagne.
 */
export const tripOfFunding = (
  trips: readonly RoundTrip[],
  payment: Pick<FundingPayment, 'accountId' | 'symbol' | 'time'>,
): RoundTrip | undefined =>
  trips.find(
    (t) =>
      t.accountId === payment.accountId &&
      t.symbol === payment.symbol &&
      t.openedTime <= payment.time &&
      (t.closedTime === null || payment.time <= t.closedTime),
  );
