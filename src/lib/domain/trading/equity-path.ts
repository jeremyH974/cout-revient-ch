/**
 * Courbe détaillée d'un compte de trading (décision n° 164) : la valeur du compte reconstituée
 * entre les points de la plateforme, à la minute quand les cours le permettent.
 *
 * ## Pourquoi reconstituer
 *
 * La courbe `portfolio` d'Hyperliquid n'a qu'un point toutes les ~2 h 20 sur 24 h comme sur 7
 * jours, ~9 h 40 sur 30 jours et une semaine sur tout l'historique — relevé du 17/09/2026 sur un
 * compte réel ; un vault très actif en reçoit toutes les ~22 min. Un aller-retour de cinq minutes y
 * est invisible, et un plus haut peut n'y être qu'un latent rendu une demi-heure plus tard (décision
 * n° 162). Zoomer sur ces points ne montre rien de plus (décision n° 163) : il faut d'autres
 * données.
 *
 * ## Comment
 *
 * Tout ce qui fait bouger la valeur du compte est déjà synchronisé, sauf le cours : les fills
 * (`closedPnl` crédité tel quel, frais), le funding, les dépôts, retraits et transferts, et la
 * position ouverte à chaque instant (`startPosition` de la plateforme). À l'instant τ :
 *
 *   valeur(τ) = trésorerie(τ) + Σ perps taille × (cours − entrée) + Σ jetons quantité × cours
 *
 * Le cours vient des bougies de la plateforme. L'entrée se relit sur le `closedPnl` à chaque
 * réduction : la plateforme arrondit son prix d'entrée, et le recalculer depuis les moyennes
 * dériverait d'environ un dollar par aller-retour. La trésorerie, elle, n'est jamais supposée
 * complète : un **calage** constant l'ajuste sur les points de la plateforme. Il se prend d'abord
 * aux instants où le compte était à plat, sans position ni jeton : la valeur y est la trésorerie,
 * sans aucun cours, donc exacte — même hors de la fenêtre. À défaut, sur les points de la fenêtre
 * les moins exposés au cours. Un point en position hérite en effet de l'écart entre la bougie et le
 * prix de marque : relevé sur un compte réel, un point en position décalait ainsi toute la fenêtre
 * de plusieurs dizaines de dollars, là où un point à plat la calait à deux dollars près.
 *
 * ## Ce qui garde la reconstitution honnête
 *
 * Chaque point de la plateforme compris dans la fenêtre est recoupé. L'écart admis est ce que le
 * cours peut expliquer : l'amplitude de la bougie qui contient le point, 0,05 % de l'exposition
 * pour l'écart entre dernier échange et prix de marque, et 0,02 % de la valeur (10 $ au moins).
 * Au-delà, la reconstitution est **écartée**, pas lissée. Un mouvement du compte manque alors
 * (vault, staking, jeton sans cours), et une courbe qui l'absorberait en silence mentirait sur
 * tout le reste.
 *
 * Pur, big.js seulement. Les instants sont des millisecondes UTC : des `number`, pas des montants.
 */
import { D, ZERO, max, min, type Big, type DecimalString } from '../money';
import type { CurvePoint } from './curve';

/** Jeton de trésorerie de la plateforme : il vaut sa quantité, sans cours. */
export const CASH_TOKEN = 'USDC';

/** Fill perps : la position suit `startPosition`, la trésorerie reçoit `closedPnl − fee`. */
export interface PerpFillMove {
  kind: 'perp';
  time: number;
  coin: string;
  side: 'buy' | 'sell';
  qty: DecimalString;
  price: DecimalString;
  /** Position signée AVANT le fill, telle que la plateforme la donne. */
  startPosition: DecimalString;
  /** Réalisé brut de frais, crédité tel quel. */
  closedPnl: DecimalString;
  /** Frais en trésorerie (négatif = rebate). */
  fee: DecimalString;
}

/** Fill spot : un jeton contre un autre, frais prélevés dans `feeToken`. */
export interface SpotFillMove {
  kind: 'spot';
  time: number;
  base: string;
  quote: string;
  side: 'buy' | 'sell';
  qty: DecimalString;
  price: DecimalString;
  fee: DecimalString;
  feeToken: string;
}

export interface FundingMove {
  kind: 'funding';
  time: number;
  /** Signé : négatif = payé. */
  amount: DecimalString;
}

/**
 * Argent qui entre ou sort du compte (dépôt, retrait, transfert, vault). `token` et `qty` (signée)
 * disent ce qui bouge dans les soldes, `value` ce que le moteur compte comme apport.
 */
export interface FlowMove {
  kind: 'flow';
  time: number;
  token: string;
  qty: DecimalString;
  value: DecimalString;
}

export type AccountMove = PerpFillMove | SpotFillMove | FundingMove | FlowMove;

/** Bougie : ouverture `t` (ms), cours d'ouverture, plus haut, plus bas, clôture. */
export interface Candle {
  t: number;
  o: DecimalString;
  h: DecimalString;
  l: DecimalString;
  c: DecimalString;
}

export interface PriceSeries {
  intervalMs: number;
  /** Triées par `t` croissant. */
  candles: readonly Candle[];
}

/** Séries de cours par marché (`perpMarket`, `tokenMarket`). */
export type PriceBook = Readonly<Record<string, PriceSeries>>;

/** Le même nom peut être un perp ET un jeton spot (`HYPE`) : deux marchés distincts. */
export const perpMarket = (coin: string): string => `perp:${coin}`;
export const tokenMarket = (token: string): string => `spot:${token}`;

/** Soldes spot lus à un instant (instantané), hors trésorerie : ils recalent les jetons. */
export interface SpotBalances {
  time: number;
  balances: Readonly<Record<string, DecimalString>>;
}

export interface HeldPosition {
  coin: string;
  size: Big;
  /** `null` : entrée inconnue (historique tronqué avant l'ouverture). */
  entry: Big | null;
}

export interface HeldToken {
  token: string;
  qty: Big;
}

/** État du compte après tous les mouvements jusqu'à `time` inclus. */
export interface AccountState {
  time: number;
  /** Trésorerie cumulée depuis le premier mouvement connu (le calage absorbe ce qui précède). */
  cash: Big;
  /** Σ `value` des apports et retraits. */
  flows: Big;
  positions: readonly HeldPosition[];
  tokens: readonly HeldToken[];
  /** Cours exécutés À cet instant, par marché : un fill donne le cours exact. */
  traded: Readonly<Record<string, Big>>;
}

/** Points à plat retenus pour le calage, les plus proches de la fenêtre. */
const FLAT_ANCHORS = 3;
/** Précision des prix d'entrée conservés : borne la croissance des décimales de big.js. */
const ENTRY_DP = 12;
/** Sous ce solde, un jeton est une poussière : il ne réclame pas de cours. */
const DUST = D('0.000001');
/** Écart toléré entre dernier échange et prix de marque, en part de l'exposition. */
export const MARK_TOLERANCE = D('0.0005');
/**
 * Écart toléré en part de la valeur du compte, et son plancher en dollars. Mesuré sur un compte réel
 * le 17/09/2026 : à plat, sans cours en jeu, la valeur de la plateforme s'écarte de la trésorerie
 * rejouée de quelques dollars d'une période à l'autre, et d'autant quand le compte vaut peu. Ni
 * dérive ni marche : un bruit de la plateforme, qui ne suit pas la taille du compte.
 * D'où un plancher absolu. Ce que la vérification doit attraper (un vault, un transfert, une
 * position manquante) pèse des dizaines de dollars au moins.
 */
export const VALUE_TOLERANCE = D('0.0002');
export const VALUE_TOLERANCE_FLOOR = D('10');

interface Ledger {
  cash: Big;
  flows: Big;
  positions: Map<string, { size: Big; entry: Big | null }>;
  tokens: Map<string, Big>;
}

const emptyLedger = (): Ledger => ({
  cash: ZERO,
  flows: ZERO,
  positions: new Map(),
  tokens: new Map(),
});

function addToken(ledger: Ledger, token: string, qty: Big): void {
  if (token === CASH_TOKEN) ledger.cash = ledger.cash.plus(qty);
  else ledger.tokens.set(token, (ledger.tokens.get(token) ?? ZERO).plus(qty));
}

function applyPerp(ledger: Ledger, move: PerpFillMove): void {
  const start = D(move.startPosition);
  const qty = D(move.qty);
  const price = D(move.price);
  const end = start.plus(move.side === 'buy' ? qty : qty.neg());
  const tracked = ledger.positions.get(move.coin);
  // Chaîne rompue (fills manquants) : l'entrée suivie ne vaut plus rien.
  let entry = tracked !== undefined && tracked.size.eq(start) ? tracked.entry : null;
  if (start.eq(ZERO)) entry = price;
  else if (end.eq(ZERO)) entry = null;
  else if (start.gt(ZERO) !== end.gt(ZERO)) entry = price;
  else if (end.abs().gt(start.abs()))
    entry =
      entry === null
        ? null
        : entry.times(start.abs()).plus(price.times(qty)).div(end.abs()).round(ENTRY_DP);
  else if (qty.gt(ZERO))
    // Réduction : `closedPnl = (cours − entrée) × qté` (long) donne l'entrée de la plateforme.
    entry = price.minus(D(move.closedPnl).div(start.gt(ZERO) ? qty : qty.neg())).round(ENTRY_DP);
  ledger.cash = ledger.cash.plus(move.closedPnl).minus(move.fee);
  if (end.eq(ZERO)) ledger.positions.delete(move.coin);
  else ledger.positions.set(move.coin, { size: end, entry });
}

function applySpot(ledger: Ledger, move: SpotFillMove): void {
  const qty = D(move.qty);
  const notional = D(move.price).times(qty);
  if (move.side === 'buy') {
    addToken(ledger, move.base, qty);
    addToken(ledger, move.quote, notional.neg());
  } else {
    addToken(ledger, move.base, qty.neg());
    addToken(ledger, move.quote, notional);
  }
  addToken(ledger, move.feeToken, D(move.fee).neg());
}

function apply(ledger: Ledger, move: AccountMove): void {
  switch (move.kind) {
    case 'perp':
      applyPerp(ledger, move);
      return;
    case 'spot':
      applySpot(ledger, move);
      return;
    case 'funding':
      ledger.cash = ledger.cash.plus(move.amount);
      return;
    case 'flow':
      addToken(ledger, move.token, D(move.qty));
      ledger.flows = ledger.flows.plus(move.value);
  }
}

/** Tri stable par instant : l'ordre reçu dans une milliseconde est celui de la plateforme. */
function chronological(moves: readonly AccountMove[]): AccountMove[] {
  return moves
    .map((move, index) => ({ move, index }))
    .sort((a, b) => a.move.time - b.move.time || a.index - b.index)
    .map(({ move }) => move);
}

/**
 * Écart entre les soldes spot lus et ceux que les mouvements connus expliquent : un historique
 * tronqué, ou un mouvement non interprété, laisse sinon une quantité fausse que chaque variation
 * de cours amplifierait. Appliqué à tous les instants.
 */
function tokenCorrections(ordered: readonly AccountMove[], spot: SpotBalances | null) {
  const corrections = new Map<string, Big>();
  if (!spot) return corrections;
  const ledger = emptyLedger();
  for (const move of ordered) {
    if (move.time > spot.time) break;
    apply(ledger, move);
  }
  const tokens = new Set([...ledger.tokens.keys(), ...Object.keys(spot.balances)]);
  for (const token of tokens) {
    if (token === CASH_TOKEN) continue;
    const read = D(spot.balances[token] ?? '0');
    const diff = read.minus(ledger.tokens.get(token) ?? ZERO);
    if (!diff.eq(ZERO)) corrections.set(token, diff);
  }
  return corrections;
}

function tradedMarket(move: AccountMove): { market: string; price: Big } | null {
  if (move.kind === 'perp') return { market: perpMarket(move.coin), price: D(move.price) };
  if (move.kind === 'spot' && move.quote === CASH_TOKEN)
    return { market: tokenMarket(move.base), price: D(move.price) };
  return null;
}

/**
 * États du compte aux instants demandés (croissants), en un seul passage sur les mouvements.
 */
export function replayAt(
  moves: readonly AccountMove[],
  spot: SpotBalances | null,
  times: readonly number[],
): AccountState[] {
  const ordered = chronological(moves);
  const corrections = tokenCorrections(ordered, spot);
  const ledger = emptyLedger();
  const states: AccountState[] = [];
  let next = 0;
  for (const time of times) {
    const traded: Record<string, Big> = {};
    for (; next < ordered.length && ordered[next]!.time <= time; next++) {
      const move = ordered[next]!;
      apply(ledger, move);
      const exec = move.time === time ? tradedMarket(move) : null;
      if (exec) traded[exec.market] = exec.price;
    }
    const tokens: HeldToken[] = [];
    for (const token of new Set([...ledger.tokens.keys(), ...corrections.keys()])) {
      const qty = (ledger.tokens.get(token) ?? ZERO).plus(corrections.get(token) ?? ZERO);
      if (qty.abs().gt(DUST)) tokens.push({ token, qty });
    }
    states.push({
      time,
      cash: ledger.cash,
      flows: ledger.flows,
      positions: [...ledger.positions].map(([coin, p]) => ({ coin, size: p.size, entry: p.entry })),
      tokens,
      traded,
    });
  }
  return states;
}

/** Marchés dont le cours est nécessaire sur `[from, to]` : tenus au départ ou touchés ensuite. */
export function marketsHeld(
  moves: readonly AccountMove[],
  spot: SpotBalances | null,
  from: number,
  to: number,
): { perps: string[]; tokens: string[] } {
  const [start] = replayAt(moves, spot, [from]);
  const perps = new Set(start?.positions.map((p) => p.coin) ?? []);
  const tokens = new Set(start?.tokens.map((t) => t.token) ?? []);
  for (const move of moves) {
    if (move.time < from || move.time > to) continue;
    if (move.kind === 'perp') perps.add(move.coin);
    else if (move.kind === 'spot')
      for (const t of [move.base, move.quote, move.feeToken]) tokens.add(t);
    else if (move.kind === 'flow') tokens.add(move.token);
  }
  tokens.delete(CASH_TOKEN);
  return { perps: [...perps].sort(), tokens: [...tokens].sort() };
}

/** Dernière bougie ouverte à `time` ou avant (recherche dichotomique), `-1` sinon. */
function candleAtOrBefore(candles: readonly Candle[], time: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.t <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * Cours estimé à `time` et amplitude de l'incertitude. Dans une bougie : interpolation de
 * l'ouverture vers la clôture, et son amplitude (le vrai cours était entre le plus bas et le plus
 * haut). Après la dernière bougie connue (marché sans échange depuis) : sa clôture.
 */
export function priceNear(
  series: PriceSeries | undefined,
  time: number,
): { price: Big; range: Big } | null {
  if (!series) return null;
  const index = candleAtOrBefore(series.candles, time);
  if (index < 0) return null;
  const candle = series.candles[index]!;
  const elapsed = time - candle.t;
  if (elapsed >= series.intervalMs) return { price: D(candle.c), range: ZERO };
  const open = D(candle.o);
  const ratio = D(String(elapsed)).div(String(series.intervalMs));
  return {
    price: open.plus(D(candle.c).minus(open).times(ratio)),
    range: D(candle.h).minus(candle.l),
  };
}

export interface Valuation {
  value: Big;
  /** Σ |taille| × cours : ce que le cours peut faire bouger. */
  exposure: Big;
  /** Σ |taille| × amplitude : l'incertitude due au cours à cet instant. */
  slack: Big;
  /** Marchés sans cours et positions d'entrée inconnue : la valeur n'est alors pas établie. */
  missing: string[];
}

/** Valeur d'un état ; `exact` : les cours exécutés à l'instant priment sur les bougies. */
export function valuationOf(state: AccountState, prices: PriceBook, exact: boolean): Valuation {
  let value = state.cash;
  let exposure = ZERO;
  let slack = ZERO;
  const missing: string[] = [];
  const quote = (market: string): { price: Big; range: Big } | null => {
    const traded = exact ? state.traded[market] : undefined;
    return traded ? { price: traded, range: ZERO } : priceNear(prices[market], state.time);
  };
  for (const position of state.positions) {
    const market = perpMarket(position.coin);
    const q = quote(market);
    if (q === null || position.entry === null) {
      missing.push(market);
      continue;
    }
    value = value.plus(position.size.times(q.price.minus(position.entry)));
    exposure = exposure.plus(position.size.abs().times(q.price));
    slack = slack.plus(position.size.abs().times(q.range));
  }
  for (const holding of state.tokens) {
    const market = tokenMarket(holding.token);
    const q = quote(market);
    if (q === null) {
      missing.push(market);
      continue;
    }
    value = value.plus(holding.qty.times(q.price));
    exposure = exposure.plus(holding.qty.abs().times(q.price));
    slack = slack.plus(holding.qty.abs().times(q.range));
  }
  return { value, exposure, slack, missing };
}

/**
 * Série de la plateforme sans son point de départ à zéro. La fenêtre « depuis l'ouverture » commence
 * par un point nul posé AVANT la première mesure : relevé le 17/09/2026 sur un compte réel, zéro
 * alors que les dépôts y étaient déjà, puis leur montant exact une heure plus tard. Le prendre pour
 * une mesure écarterait toute reconstitution qui le contient.
 */
export function withoutZeroSeed<T extends CurvePoint>(points: readonly T[]): readonly T[] {
  const first = points[0];
  return points.length > 1 && first && D(first[1]).eq(ZERO) ? points.slice(1) : points;
}

export interface DetailInput {
  moves: readonly AccountMove[];
  spot: SpotBalances | null;
  prices: PriceBook;
  /** Fenêtre à tracer (ms). */
  from: number;
  to: number;
  /** Pas des bougies : un point par clôture, plus un par instant d'exécution. */
  intervalMs: number;
  /** Points d'équité de la plateforme, toutes fenêtres confondues : ceux de la fenêtre calent. */
  equity: readonly CurvePoint[];
  /**
   * Tracer le P&L plutôt que l'équité : les deux séries de la période affichée, équité et P&L, aux
   * mêmes instants.
   *
   * Le P&L de la plateforme n'est pas « équité − équité de départ − apports de la fenêtre » : sur
   * la fenêtre « depuis l'ouverture », il compte les dépôts antérieurs à son premier point (relevé
   * du 17/09/2026). Ce qu'elle respecte partout, en revanche, c'est `P&L − équité + apports =
   * constante` sur une même série — vérifié au centime sur les quatre fenêtres d'un compte réel.
   * Cette constante se lit donc sur la série elle-même, point par point, sans cours ni hypothèse
   * sur son départ.
   */
  pnl?: { equity: readonly CurvePoint[]; points: readonly CurvePoint[] } | null;
}

export interface DetailPoint {
  time: number;
  value: Big;
}

export interface DetailCheck {
  time: number;
  /** Point de la plateforme − reconstitution calée. */
  deviation: Big;
  /** Écart que le cours et les arrondis peuvent expliquer à cet instant. */
  allowed: Big;
  /** Compte à plat à cet instant : la comparaison ne doit rien au cours. */
  flat: boolean;
}

export type DetailOutcome =
  | {
      kind: 'ok';
      points: DetailPoint[];
      /** Constante ajoutée à la trésorerie reconstituée. */
      offset: Big;
      /** Points de la plateforme recoupés dans la fenêtre. */
      checked: number;
      /** Plus grand écart constaté sur ces points, en valeur absolue. */
      maxDeviation: Big;
      /** Ceux d'entre eux où le compte était à plat. */
      flatChecked: number;
      /**
       * Plus grand écart sur ces points à plat, `null` s'il n'y en a pas. C'est le chiffre à
       * montrer : ailleurs, l'écart mêle l'amplitude des bougies — une grosse position sur une bougie de
       * 12 h tolèrent des milliers de dollars, ce qui ne dit rien de la reconstitution.
       */
      flatDeviation: Big | null;
    }
  /** Aucun point de la plateforme dans la fenêtre : rien pour caler la trésorerie. */
  | { kind: 'no-anchor' }
  /** Une position ou un jeton sans cours, ou une entrée inconnue : la valeur n'est pas établie. */
  | { kind: 'no-price'; markets: string[] }
  /** Un point de la plateforme s'écarte au-delà de ce que le cours explique. */
  | { kind: 'mismatch'; worst: DetailCheck; checked: number };

const toleranceOf = (value: Big): Big =>
  max(VALUE_TOLERANCE_FLOOR, value.abs().times(VALUE_TOLERANCE));

function median(values: readonly Big[]): Big {
  const sorted = [...values].sort((a, b) => a.cmp(b));
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : sorted[middle - 1]!.plus(sorted[middle]!).div('2');
}

const uniqueSorted = (times: readonly number[]): number[] =>
  [...new Set(times)].sort((a, b) => a - b);

/** Le pire écart relatif à ce qui est admis (le premier en cas d'égalité). */
function worstOf(checks: readonly DetailCheck[]): DetailCheck | null {
  let worst: DetailCheck | null = null;
  for (const check of checks) {
    const excess = check.deviation.abs().minus(check.allowed);
    if (worst === null || excess.gt(worst.deviation.abs().minus(worst.allowed))) worst = check;
  }
  return worst;
}

/**
 * Courbe détaillée d'une fenêtre, calée et recoupée sur les points de la plateforme — ou la raison
 * pour laquelle elle ne peut pas l'être.
 */
export function detailedCurve(input: DetailInput): DetailOutcome {
  const { from, to, intervalMs, prices } = input;
  const inWindow = ([t]: CurvePoint): boolean => t >= from && t <= to;
  const grid: number[] = [];
  for (let t = Math.ceil(from / intervalMs) * intervalMs; t <= to; t += intervalMs) grid.push(t);
  const fills = input.moves
    .filter((m) => (m.kind === 'perp' || m.kind === 'spot') && m.time >= from && m.time <= to)
    .map((m) => m.time);
  const samples = uniqueSorted([...grid, ...fills]);
  const anchors = input.equity.filter(inWindow);
  // Paires (équité, P&L) de la série affichée, aux mêmes instants, sans le départ à zéro.
  const pnlReadings = new Map(input.pnl ? input.pnl.points : []);
  const pairs = input.pnl
    ? withoutZeroSeed(input.pnl.equity).flatMap(([time, equity]) => {
        const pnl = pnlReadings.get(time);
        return pnl === undefined ? [] : [{ time, equity: D(equity), pnl: D(pnl) }];
      })
    : [];
  if (input.pnl && pairs.length === 0) return { kind: 'no-anchor' };
  const pnlAnchors: CurvePoint[] = pairs
    .filter((p) => p.time >= from && p.time <= to)
    .map((p) => [p.time, p.pnl.toString()]);
  const times = uniqueSorted([
    ...samples,
    ...input.equity.map(([t]) => t),
    ...pnlAnchors.map(([t]) => t),
    ...pairs.map((p) => p.time),
  ]);
  const states = new Map<number, AccountState>();
  for (const state of replayAt(input.moves, input.spot, times)) states.set(state.time, state);
  const stateAt = (time: number): AccountState => states.get(time)!;

  const missing = new Set<string>();
  const valued = anchors.flatMap(([time, reading]) => {
    const valuation = valuationOf(stateAt(time), prices, false);
    for (const market of valuation.missing) missing.add(market);
    if (valuation.missing.length > 0) return [];
    const value = D(reading);
    return [{ time, value, valuation, gap: value.minus(valuation.value) }];
  });
  if (missing.size > 0) return { kind: 'no-price', markets: [...missing].sort() };
  if (valued.length === 0) return { kind: 'no-anchor' };

  const uncertainty = (valuation: Valuation): Big =>
    valuation.slack.plus(valuation.exposure.times(MARK_TOLERANCE));
  // Calage d'abord sur les points à plat les plus proches de la fenêtre : la valeur y est la
  // trésorerie, exacte sans cours. Trois, pour qu'un point bruité ne décide pas seul.
  const distance = (t: number): number => (t < from ? from - t : t > to ? t - to : 0);
  const flat = input.equity
    .filter(([t]) => {
      const state = stateAt(t);
      return state.positions.length === 0 && state.tokens.length === 0;
    })
    .sort((a, b) => distance(a[0]) - distance(b[0]) || a[0] - b[0])
    .slice(0, FLAT_ANCHORS);
  let offset: Big;
  let offsetUncertainty = ZERO;
  if (flat.length > 0) {
    offset = median(flat.map(([t, reading]) => D(reading).minus(stateAt(t).cash)));
  } else {
    // Sinon, les points de la fenêtre les moins exposés au cours. Une médiane reste entre ses
    // valeurs : le calage hérite de la plus forte incertitude de ses points.
    const least = valued.reduce(
      (acc, a) => min(acc, a.valuation.slack),
      valued[0]!.valuation.slack,
    );
    const reliable = valued.filter((a) => a.valuation.slack.lte(least.plus(toleranceOf(a.value))));
    offset = median(reliable.map((a) => a.gap));
    offsetUncertainty = reliable.reduce((acc, a) => max(acc, uncertainty(a.valuation)), ZERO);
  }
  const allowedAt = (valuation: Valuation, value: Big): Big =>
    uncertainty(valuation).plus(offsetUncertainty).plus(toleranceOf(value));
  const checks: DetailCheck[] = valued.map((a) => ({
    time: a.time,
    deviation: a.gap.minus(offset),
    allowed: allowedAt(a.valuation, a.value),
    flat: a.valuation.exposure.eq(ZERO),
  }));

  const pnlConstant = input.pnl
    ? median(pairs.map((p) => p.pnl.minus(p.equity).plus(stateAt(p.time).flows)))
    : ZERO;
  /** Équité calée → valeur tracée : l'équité, ou le P&L tel que la série l'entend. */
  const plotted = (equity: Big, state: AccountState): Big =>
    input.pnl ? equity.minus(state.flows).plus(pnlConstant) : equity;

  for (const [time, reading] of pnlAnchors) {
    const state = stateAt(time);
    const valuation = valuationOf(state, prices, false);
    if (valuation.missing.length > 0) continue;
    const equity = valuation.value.plus(offset);
    checks.push({
      time,
      deviation: D(reading).minus(plotted(equity, state)),
      allowed: allowedAt(valuation, equity),
      flat: valuation.exposure.eq(ZERO),
    });
  }
  const worst = worstOf(checks)!;
  if (worst.deviation.abs().gt(worst.allowed))
    return { kind: 'mismatch', worst, checked: checks.length };

  const points: DetailPoint[] = [];
  for (const time of samples) {
    const state = stateAt(time);
    const valuation = valuationOf(state, prices, true);
    if (valuation.missing.length > 0) {
      for (const market of valuation.missing) missing.add(market);
      continue;
    }
    points.push({ time, value: plotted(valuation.value.plus(offset), state) });
  }
  if (missing.size > 0) return { kind: 'no-price', markets: [...missing].sort() };
  const flatChecks = checks.filter((c) => c.flat);
  return {
    kind: 'ok',
    points,
    offset,
    checked: checks.length,
    maxDeviation: checks.reduce((acc, c) => max(acc, c.deviation.abs()), ZERO),
    flatChecked: flatChecks.length,
    flatDeviation:
      flatChecks.length === 0
        ? null
        : flatChecks.reduce((acc, c) => max(acc, c.deviation.abs()), ZERO),
  };
}
