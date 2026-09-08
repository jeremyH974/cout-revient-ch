/**
 * Données Hyperliquid persistées (conteneur `hyperliquid` de l'état, DECISIONS n° 22) : bruts par
 * compte (fills, funding, grand livre), instantané du compte, curseurs de synchronisation, et la
 * table des paires spot (pour lire `@107` hors ligne). L'API ne conserve que les fills récents :
 * l'application est la mémoire longue, d'où la persistance des bruts plutôt que d'un dérivé.
 */
import { fnv1a32 } from '../../domain/hash';
import { D, toDecimalString } from '../../domain/money';
import type { AccountId } from '../../domain/types';
import type {
  HlClearinghouse,
  HlFill,
  HlFunding,
  HlLedgerUpdate,
  HlPortfolio,
  HlSpotBalance,
} from './api-types';

export interface HlCursors {
  /** `time` (ms) du dernier élément reçu par flux ; `null` = jamais synchronisé. */
  fills: number | null;
  funding: number | null;
  ledger: number | null;
}

export interface HlSnapshot {
  /** ISO 8601 de la lecture. */
  at: string;
  perps: HlClearinghouse;
  spot: HlSpotBalance[];
}

export interface HlAccountData {
  /** Adresse publique normalisée en minuscules. */
  address: string;
  /** Clé = `tid`. */
  fills: Record<string, HlFill>;
  /** Clé = `fundingKey`. */
  funding: Record<string, HlFunding>;
  /** Clé = `ledgerKey`. */
  ledger: Record<string, HlLedgerUpdate>;
  cursors: HlCursors;
  snapshot: HlSnapshot | null;
  /** Courbes `portfolio` de la plateforme (équité et P&L par période), lues à la synchronisation. */
  portfolio: HlPortfolio | null;
  /** ISO 8601 de la dernière synchronisation complète réussie. */
  lastSyncAt: string | null;
}

export interface HlSpotPairRef {
  base: string;
  quote: string;
}

export interface HlState {
  accounts: Record<AccountId, HlAccountData>;
  /** Nom de paire (`PURR/USDC`, `@107`) → jetons ; rempli à chaque synchronisation. */
  spotPairs: Record<string, HlSpotPairRef>;
}

export const hlAccountId = (address: string): AccountId => `hl:${address}`;

export function emptyHlAccountData(address: string): HlAccountData {
  return {
    address,
    fills: {},
    funding: {},
    ledger: {},
    cursors: { fills: null, funding: null, ledger: null },
    snapshot: null,
    portfolio: null,
    lastSyncAt: null,
  };
}

export const emptyHlState = (): HlState => ({ accounts: {}, spotPairs: {} });

export const fundingKey = (f: HlFunding): string => `${f.time}:${f.coin}:${f.hash}`;

/** Le même hash peut porter plusieurs mouvements (ex. transfert + frais) : empreinte du contenu. */
export const ledgerKey = (l: HlLedgerUpdate): string =>
  `${l.time}:${l.type}:${fnv1a32(`${l.hash}|${JSON.stringify(l.fields)}`)}`;

/** Identifiants numériques en chaîne : ordre numérique (longueur puis lexical), jamais `localeCompare`. */
export const compareIds = (a: string, b: string): number =>
  a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/** Position du compte APRÈS ce fill, telle que la plateforme la décrit. */
const arrivalOf = (f: HlFill): string =>
  toDecimalString(D(f.startPosition).plus(f.side === 'B' ? D(f.sz) : D(f.sz).neg()));

/**
 * Remet un paquet de fills — même symbole, même milliseconde — dans son ordre d'EXÉCUTION, ou rend
 * `null` s'il ne peut pas le prouver. Le `tid` est un identifiant, pas un rang : quand un ordre
 * traverse le carnet, la plateforme rend des dizaines d'exécutions au même instant (32 relevées sur
 * un compte réel) et l'ordre de leurs `tid` n'est pas le leur. Le rang manquant est déjà dans la
 * donnée : `startPosition` EST la séquence, la position d'arrivée d'un fill étant le
 * `startPosition` du suivant. On repart de la seule position de départ qu'aucun fill du paquet ne
 * produit — la tête — puis on suit la chaîne.
 *
 * Le refus est aussi important que le succès : un paquet qui revient à sa position de départ
 * (ouverture ET clôture dans la même milliseconde) n'a pas de tête, et un paquet troué casse la
 * chaîne. Dans ces deux cas on ne devine pas, on rend l'ordre reçu, et c'est le garde-fou
 * `startPosition` de la reconstruction des aller-retours qui tranchera — bruyamment, mais
 * honnêtement. Décision n° 129.
 */
function chainByPosition(packet: readonly HlFill[]): HlFill[] | null {
  const byStart = new Map<string, HlFill[]>();
  const arrivals = new Map<string, number>();
  for (const fill of packet) {
    const start = toDecimalString(D(fill.startPosition));
    const waiting = byStart.get(start);
    if (waiting) waiting.push(fill);
    else byStart.set(start, [fill]);
    const arrival = arrivalOf(fill);
    arrivals.set(arrival, (arrivals.get(arrival) ?? 0) + 1);
  }
  // Départage déterministe quand la position repasse deux fois par la même valeur.
  for (const waiting of byStart.values()) waiting.sort((a, b) => compareIds(a.tid, b.tid));

  const heads = [...byStart].filter(
    ([start, waiting]) => waiting.length > (arrivals.get(start) ?? 0),
  );
  const head = heads.length === 1 ? heads[0] : undefined;
  if (!head || head[1].length - (arrivals.get(head[0]) ?? 0) !== 1) return null;

  const ordered: HlFill[] = [];
  let position = head[0];
  while (ordered.length < packet.length) {
    const next = byStart.get(position)?.shift();
    if (!next) return null;
    ordered.push(next);
    position = arrivalOf(next);
  }
  return ordered;
}

/** Réordonne sur place, symbole par symbole, les fills des positions `from` à `to` (même instant). */
function reorderInstant(sorted: HlFill[], from: number, to: number): void {
  const slotsOf = new Map<string, number[]>();
  for (let i = from; i <= to; i++) {
    const coin = sorted[i]?.coin;
    if (coin === undefined) continue;
    const slots = slotsOf.get(coin);
    if (slots) slots.push(i);
    else slotsOf.set(coin, [i]);
  }
  for (const slots of slotsOf.values()) {
    if (slots.length < 2) continue;
    const packet: HlFill[] = [];
    for (const slot of slots) {
      const fill = sorted[slot];
      if (fill) packet.push(fill);
    }
    const chained = chainByPosition(packet);
    if (!chained) continue;
    slots.forEach((slot, rank) => {
      const fill = chained[rank];
      if (fill) sorted[slot] = fill;
    });
  }
}

/**
 * Fills triés par instant puis identifiant — et, à l'intérieur d'un instant, remis dans leur ordre
 * d'exécution par `chainByPosition`. Trier par `tid` seul suffisait tant qu'un instant ne portait
 * qu'un fill ; un ordre qui traverse le carnet en produit des dizaines, et la reconstruction des
 * aller-retours les rejouait alors dans le désordre.
 */
export function sortedFills(fills: Record<string, HlFill>): HlFill[] {
  const sorted = Object.values(fills).sort((a, b) => a.time - b.time || compareIds(a.tid, b.tid));
  for (let from = 0; from < sorted.length;) {
    let to = from;
    while (to + 1 < sorted.length && sorted[to + 1]?.time === sorted[from]?.time) to++;
    if (to > from) reorderInstant(sorted, from, to);
    from = to + 1;
  }
  return sorted;
}

/** Compte Hyperliquid du mode démonstration (adresse fictive de `tests/fixtures/hyperliquid/demo.json`). */
export const DEMO_HL_ADDRESS = '0x000000000000000000000000000000000000d3a0';
export const DEMO_HL_ACCOUNT_ID: AccountId = hlAccountId(DEMO_HL_ADDRESS);
