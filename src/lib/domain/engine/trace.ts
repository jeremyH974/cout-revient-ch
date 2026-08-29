/**
 * « Pourquoi ce chiffre ? » — la chaîne complète d'un montant affiché, jusqu'aux lignes brutes.
 *
 * Le moteur sait déjà tout : les lignes ont une clé stable, chaque événement cite les siennes,
 * chaque lot connaît l'événement qui l'a ouvert, chaque cession sait quels lots elle a consommés
 * et chaque cours porte sa source et sa date. Ce module ne recalcule rien : il **assemble** cette
 * information en un arbre où chaque nœud dit ce qu'il apporte à son parent.
 *
 * Trois règles tiennent tout le reste :
 *
 * 1. **Ça boucle ou ça se voit.** Sous un opérateur `sum` ou `difference`, la somme des montants
 *    des enfants est celle du parent — au centime près et sans exception. `residual` mesure
 *    l'écart restant à la racine : `'0'` signifie « explication complète ».
 * 2. **Un trou est nommé, jamais comblé.** Une ligne non qualifiée, un cours venu du dehors, un
 *    coût reporté par une migration, un virement arrivé d'un autre compte : chacun devient un
 *    `TraceGap` porté par le nœud concerné, à contribution nulle quand il n'apporte rien.
 * 3. **Le moteur ne parle aucune langue.** Rôles, opérateurs et trous sont des codes ; les phrases
 *    françaises vivent dans `src/lib/format/trace.ts`.
 *
 * Tout est en **euros**, y compris quand l'application affiche des dollars : convertir la chaîne
 * introduirait un arrondi par niveau et le bouclage ne tiendrait plus (même choix que les montants
 * fiscaux). C'est à l'écran de le dire.
 */
import { D, ZERO, isPositive, isZero, toDecimalString, type Big } from '../money';
import type {
  AccountId,
  AssetCode,
  DecimalString,
  EngineSettings,
  EventId,
  LedgerEvent,
  LedgerEventKind,
  NaiveDateTime,
  RawCoinhouseRow,
  RawPivotRow,
  RowKey,
  ValueEurSource,
} from '../types';
import type {
  HistoryEntry,
  HistoryKind,
  LotOrigin,
  LotReport,
  PortfolioReport,
  PositionReport,
  PriceQuoteInput,
} from './report';

// --- Vocabulaire ---------------------------------------------------------------------------------

export type TraceMetric =
  | 'pru'
  | 'cost-basis'
  | 'invested'
  | 'proceeds'
  | 'realized'
  | 'unrealized'
  | 'fees'
  | 'value'
  | 'total';

export type TraceUnit = 'eur' | 'qty' | 'price' | 'ratio';

/**
 * `sum` et `difference` sont **additifs** : leurs enfants portent des contributions signées qui
 * s'additionnent au montant du parent. `product` et `quotient` portent des facteurs, chacun dans
 * son unité. `identity` documente : le nœud reprend son enfant sans le décomposer.
 */
export type TraceOperator = 'sum' | 'difference' | 'product' | 'quotient' | 'identity';

export type TraceRole =
  | 'metric'
  | 'cost-basis'
  | 'quantity'
  | 'price'
  | 'value'
  | 'realized'
  | 'unrealized'
  | 'invested'
  | 'proceeds'
  | 'cost-of-sale'
  | 'fee'
  | 'rebate'
  | 'other-income'
  | 'subscription'
  | 'position'
  | 'lot'
  | 'buy'
  | 'sell'
  | 'reward'
  | 'deposit'
  | 'withdrawal'
  | 'migration-in'
  | 'migration-out'
  | 'opening-balance'
  | 'row'
  | 'quote'
  | 'setting'
  | 'unqualified'
  | 'omitted'
  | 'note';

export type TraceScope =
  | { kind: 'position'; asset: AssetCode }
  | { kind: 'lot'; asset: AssetCode; lotId: string }
  | { kind: 'account'; accountId: AccountId; asset: AssetCode | null }
  | { kind: 'portfolio' };

export interface TraceTarget {
  metric: TraceMetric;
  scope: TraceScope;
}

/** Une jambe d'une ligne brute : une seule pour Coinhouse, jusqu'à deux pour le format pivot. */
export interface TraceRowLeg {
  asset: AssetCode;
  /** Quantité signée (négatif = sortie). */
  signedQty: DecimalString;
  /** Contre-valeur en euros **telle qu'elle figure dans le fichier** ; `null` si absente. */
  valueEur: DecimalString | null;
}

/**
 * Dénominateur commun des lignes brutes, quel que soit le format importé (Coinhouse, pivot
 * Koinly/Waltio, convertisseurs de plateformes qui produisent des lignes pivot). Sans ce
 * dénominateur, la moitié des utilisateurs ne verraient que des trous `row-unavailable`.
 */
export interface TraceRowSnapshot {
  key: RowKey;
  importId: string;
  /** Numéro de ligne dans le fichier importé (1 = en-tête), 0 si inconnu. */
  lineNo: number;
  at: NaiveDateTime;
  /** Libellé brut du type d'opération, verbatim (`Echange`, `Abonnement`, étiquette Koinly…). */
  rawType: string;
  legs: readonly TraceRowLeg[];
}

export type TraceProvenance =
  | {
      kind: 'raw-row';
      rowKey: RowKey;
      role: 'counter-leg' | 'asset-leg' | 'fee' | 'single';
      at: NaiveDateTime;
      rawType: string;
      asset: AssetCode;
      signedQty: DecimalString;
      valueEur: DecimalString | null;
      lineNo: number;
      importId: string;
    }
  | {
      kind: 'event';
      eventId: EventId;
      eventKind: LedgerEventKind;
      at: NaiveDateTime;
      accountId: AccountId;
      rowKeys: readonly RowKey[];
      counterRowKey: RowKey | null;
      valueEurSource: ValueEurSource | null;
      warnings: readonly string[];
    }
  | { kind: 'lot'; lotId: string; eventId: EventId; openedAt: NaiveDateTime; origin: LotOrigin }
  | {
      kind: 'quote';
      asset: AssetCode;
      priceEur: DecimalString;
      at: string;
      source: string;
      stale: boolean;
    }
  | { kind: 'setting'; key: keyof EngineSettings; value: string }
  | {
      kind: 'unqualified';
      eventId: EventId;
      rawType: string;
      reason: string;
      rowKeys: readonly RowKey[];
    }
  | { kind: 'derived' };

export type TraceGap =
  | 'external-quote'
  | 'unqualified-row'
  | 'missing-history'
  | 'carried-cost'
  | 'transfer-from-other-account'
  | 'row-unavailable'
  | 'truncated';

export interface TraceNode {
  /** Chemin stable et déterministe, par exemple `pru/btc/cost-basis/lot:ch:42:btc`. */
  id: string;
  role: TraceRole;
  /** Contribution AU PARENT, dans l'unité du parent sous un opérateur additif. */
  amount: DecimalString | null;
  unit: TraceUnit;
  asset: AssetCode | null;
  at: NaiveDateTime | null;
  operator: TraceOperator;
  provenance: TraceProvenance;
  children: readonly TraceNode[];
  gap: TraceGap | null;
}

export interface Trace {
  target: TraceTarget;
  amount: DecimalString | null;
  unit: TraceUnit;
  root: TraceNode;
  /**
   * Σ des écarts de bouclage de tous les nœuds additifs de l'arbre. `'0'` = explication complète.
   * En deçà de `TRACE_EPSILON`, l'écart est de l'ordre du 30e chiffre décimal des divisions du
   * moteur : il est ramené à `'0'` plutôt que de crier au loup.
   */
  residual: DecimalString;
  gaps: readonly TraceGap[];
  settings: readonly { key: keyof EngineSettings; value: string }[];
  /** Nombre de contributions omises par le plafond `maxChildren` (0 = arbre complet). */
  omitted: number;
}

export interface TraceInput {
  report: PortfolioReport;
  target: TraceTarget;
  settings: EngineSettings;
  /** Accès aux lignes brutes, injecté par l'appelant ; `null` → trou `row-unavailable`. */
  row(key: RowKey): TraceRowSnapshot | null;
  /** Grand livre : enrichit les nœuds d'événement (avertissements, jambe retenue, appariement). */
  events?: readonly LedgerEvent[];
  /** Plafond de contributions par nœud additif (défaut 200) → trou `truncated`. */
  maxChildren?: number;
}

/** En deçà, un écart de bouclage vient des divisions à 30 décimales du moteur, pas d'un trou. */
export const TRACE_EPSILON: DecimalString = '0.000000001';

const DEFAULT_MAX_CHILDREN = 200;

// --- Instantanés de lignes brutes ----------------------------------------------------------------

/** Ligne Coinhouse → instantané : une jambe, celle de la ligne. */
export function coinhouseTraceRow(row: RawCoinhouseRow): TraceRowSnapshot {
  return {
    key: row.key,
    importId: row.importId,
    lineNo: row.lineNo,
    at: row.at,
    rawType: row.type,
    legs: [{ asset: row.asset, signedQty: row.qty, valueEur: row.valueEur }],
  };
}

/** Ligne pivot → instantané : une jambe par montant présent (envoyé négatif, reçu positif). */
export function pivotTraceRow(row: RawPivotRow): TraceRowSnapshot {
  const legs: TraceRowLeg[] = [];
  if (row.sent)
    legs.push({
      asset: row.sent.currency,
      signedQty: toDecimalString(D(row.sent.amount).neg()),
      valueEur: row.sent.currency === 'eur' ? row.sent.amount : null,
    });
  if (row.received)
    legs.push({
      asset: row.received.currency,
      signedQty: row.received.amount,
      valueEur: row.received.currency === 'eur' ? row.received.amount : null,
    });
  return {
    key: row.key,
    importId: row.importId,
    lineNo: row.lineNo,
    at: row.at,
    rawType: row.label ?? '',
    legs,
  };
}

// --- Fabrique de nœuds ---------------------------------------------------------------------------

interface NodeInit {
  id: string;
  role: TraceRole;
  operator?: TraceOperator;
  amount?: Big | null;
  unit?: TraceUnit;
  asset?: AssetCode | null;
  at?: NaiveDateTime | null;
  provenance?: TraceProvenance;
  children?: readonly TraceNode[];
  gap?: TraceGap | null;
}

function mk(init: NodeInit): TraceNode {
  const amount = init.amount ?? null;
  return {
    id: init.id,
    role: init.role,
    amount: amount === null ? null : toDecimalString(amount),
    unit: init.unit ?? 'eur',
    asset: init.asset ?? null,
    at: init.at ?? null,
    operator: init.operator ?? 'identity',
    provenance: init.provenance ?? { kind: 'derived' },
    children: init.children ?? [],
    gap: init.gap ?? null,
  };
}

/**
 * Inverse le signe d'une branche soustraite, pour que « A − B » reste une somme d'enfants signés
 * et boucle à tous les niveaux. La descente s'arrête aux opérateurs non additifs : les facteurs
 * d'un produit gardent leur propre signe, seul le résultat change de sens.
 */
function negate(node: TraceNode): TraceNode {
  const amount = node.amount === null ? null : toDecimalString(D(node.amount).neg());
  const additive = node.operator === 'sum' || node.operator === 'difference';
  const children =
    additive || node.operator === 'identity' ? node.children.map(negate) : node.children;
  return { ...node, amount, children };
}

// --- Contexte ------------------------------------------------------------------------------------

interface Ctx {
  report: PortfolioReport;
  settings: EngineSettings;
  row: (key: RowKey) => TraceRowSnapshot | null;
  events: Map<EventId, LedgerEvent>;
  maxChildren: number;
  omitted: number;
  used: Map<keyof EngineSettings, string>;
}

function noteSetting(ctx: Ctx, key: keyof EngineSettings): void {
  ctx.used.set(key, String(ctx.settings[key]));
}

/** Identifiants uniques entre frères : un suffixe déterministe plutôt qu'une collision silencieuse. */
function unique(seen: Set<string>, id: string): string {
  if (!seen.has(id)) {
    seen.add(id);
    return id;
  }
  let n = 2;
  while (seen.has(`${id}#${n}`)) n++;
  const result = `${id}#${n}`;
  seen.add(result);
  return result;
}

/**
 * Plafonne les contributions d'un nœud additif **sans casser son bouclage** : les omises sont
 * remplacées par un nœud unique qui porte leur somme exacte et le trou `truncated`.
 */
function cap(ctx: Ctx, parentId: string, unit: TraceUnit, children: TraceNode[]): TraceNode[] {
  if (children.length <= ctx.maxChildren) return children;
  const kept = children.slice(0, ctx.maxChildren - 1);
  const dropped = children.slice(ctx.maxChildren - 1);
  ctx.omitted += dropped.length;
  const rest = dropped.reduce((acc, c) => acc.plus(c.amount === null ? ZERO : D(c.amount)), ZERO);
  kept.push(
    mk({
      id: `${parentId}/omitted`,
      role: 'omitted',
      amount: rest,
      unit,
      gap: 'truncated',
    }),
  );
  return kept;
}

// --- Provenance des événements et des lignes -----------------------------------------------------

const KIND_TO_EVENT_KIND: Record<HistoryKind, LedgerEventKind> = {
  buy: 'trade',
  sell: 'trade',
  reward: 'reward',
  deposit: 'deposit',
  withdrawal: 'withdrawal',
  'migration-in': 'migration',
  'migration-out': 'migration',
  'opening-balance': 'opening-balance',
};

interface EventFacts {
  provenance: Extract<TraceProvenance, { kind: 'event' }>;
  rowKeys: readonly RowKey[];
  counterRowKey: RowKey | null;
  assetRowKey: RowKey | null;
  transferFrom: EventId | null;
}

function eventFacts(ctx: Ctx, h: HistoryEntry): EventFacts {
  const event = ctx.events.get(h.eventId);
  const trade = event?.kind === 'trade' ? event : null;
  const counterRowKey = trade?.counterRowKey ?? null;
  const assetRowKey = trade?.assetRowKey ?? null;
  const rowKeys = event ? event.rowKeys : h.rowKeys;
  return {
    provenance: {
      kind: 'event',
      eventId: h.eventId,
      eventKind: event?.kind ?? KIND_TO_EVENT_KIND[h.kind],
      at: h.at,
      accountId: h.accountId,
      rowKeys,
      counterRowKey,
      valueEurSource: trade?.valueEurSource ?? null,
      warnings: event?.warnings ?? h.warnings,
    },
    rowKeys,
    counterRowKey,
    assetRowKey,
    transferFrom:
      event?.kind === 'deposit' && event.transferFrom !== undefined ? event.transferFrom : null,
  };
}

function pickLeg(
  snapshot: TraceRowSnapshot,
  role: 'counter-leg' | 'asset-leg' | 'fee' | 'single',
  asset: AssetCode | null,
): TraceRowLeg | null {
  if (snapshot.legs.length === 0) return null;
  if (role === 'asset-leg' && asset !== null) {
    const own = snapshot.legs.find((l) => l.asset === asset);
    if (own) return own;
  }
  if (role === 'counter-leg') {
    const valued = snapshot.legs.find((l) => l.valueEur !== null && l.asset !== asset);
    if (valued) return valued;
  }
  return snapshot.legs[0] ?? null;
}

/**
 * Feuille « ligne brute ». Seule la jambe **retenue** porte un montant : c'est elle qui a fourni la
 * contre-valeur (règle d'or de l'export Coinhouse). Les autres documentent sans rien apporter —
 * ainsi aucune feuille ne peut afficher plus que ce que sa ligne contient.
 */
function rowNode(
  ctx: Ctx,
  parentId: string,
  seen: Set<string>,
  key: RowKey,
  role: 'counter-leg' | 'asset-leg' | 'fee' | 'single',
  asset: AssetCode | null,
  amount: Big | null,
): TraceNode {
  const id = unique(seen, `${parentId}/row:${key}`);
  const snapshot = ctx.row(key);
  if (!snapshot) return mk({ id, role: 'row', gap: 'row-unavailable' });
  const leg = pickLeg(snapshot, role, asset);
  if (!leg) return mk({ id, role: 'row', gap: 'row-unavailable' });
  return mk({
    id,
    role: 'row',
    amount,
    asset: leg.asset,
    at: snapshot.at,
    provenance: {
      kind: 'raw-row',
      rowKey: key,
      role,
      at: snapshot.at,
      rawType: snapshot.rawType,
      asset: leg.asset,
      signedQty: leg.signedQty,
      valueEur: leg.valueEur,
      lineNo: snapshot.lineNo,
      importId: snapshot.importId,
    },
  });
}

/**
 * Les lignes brutes d'un événement, la jambe retenue en tête. **Seule** cette jambe porte un
 * montant, et ce montant est exactement la contre-valeur inscrite dans le fichier : une feuille ne
 * peut donc jamais afficher plus que ce que sa ligne contient.
 */
function rowChildren(
  ctx: Ctx,
  parentId: string,
  facts: EventFacts,
  asset: AssetCode,
  counterAmount: Big | null,
): TraceNode[] {
  const seen = new Set<string>();
  const nodes: TraceNode[] = [];
  if (facts.counterRowKey !== null)
    nodes.push(
      rowNode(ctx, parentId, seen, facts.counterRowKey, 'counter-leg', asset, counterAmount),
    );
  for (const key of facts.rowKeys) {
    if (key === facts.counterRowKey) continue;
    const role = key === facts.assetRowKey ? 'asset-leg' : 'single';
    nodes.push(rowNode(ctx, parentId, seen, key, role, asset, null));
  }
  return nodes;
}

/**
 * Nœud d'un mouvement : l'événement, puis ses lignes brutes, puis ce qui manque encore.
 * `counterAmount` n'est renseigné que si le montant du nœud **vient** de la contre-valeur du
 * fichier ; un frais, lui, ne se lit sur aucune contre-valeur et laisse la feuille sans montant.
 */
function operationNode(
  ctx: Ctx,
  parentId: string,
  seen: Set<string>,
  h: HistoryEntry,
  asset: AssetCode,
  amount: Big | null,
  role: TraceRole,
  counterAmount: Big | null = null,
): TraceNode {
  const id = unique(seen, `${parentId}/${role}:${h.eventId}`);
  const facts = eventFacts(ctx, h);
  const children: TraceNode[] = rowChildren(ctx, id, facts, asset, counterAmount);
  let gap: TraceGap | null = children.length === 0 ? 'missing-history' : null;
  if (facts.transferFrom !== null) {
    gap = 'transfer-from-other-account';
    const source = ctx.events.get(facts.transferFrom);
    children.push(
      mk({
        id: `${id}/transfer:${facts.transferFrom}`,
        role: 'withdrawal',
        at: source?.at ?? null,
        gap: 'transfer-from-other-account',
        provenance: source
          ? {
              kind: 'event',
              eventId: source.id,
              eventKind: source.kind,
              at: source.at,
              accountId: source.accountId,
              rowKeys: source.rowKeys,
              counterRowKey: null,
              valueEurSource: null,
              warnings: source.warnings,
            }
          : { kind: 'derived' },
      }),
    );
  }
  return mk({
    id,
    role,
    amount,
    asset,
    at: h.at,
    operator: 'identity',
    provenance: facts.provenance,
    children,
    gap,
  });
}

// --- Découpes ------------------------------------------------------------------------------------

const ACQUISITIONS: ReadonlySet<HistoryKind> = new Set([
  'buy',
  'deposit',
  'opening-balance',
  'migration-in',
]);

interface Slice {
  asset: AssetCode | null;
  lots: readonly LotReport[];
  /** Historique chronologique (le rapport le stocke du plus récent au plus ancien). */
  history: readonly HistoryEntry[];
  qty: Big;
  costBasis: Big;
  pru: Big | null;
  price: PriceQuoteInput | null;
  value: Big | null;
  unrealized: Big | null;
  realized: Big;
  otherIncome: Big;
  invested: Big;
  proceeds: Big;
  fees: Big;
  rebates: Big;
  total: Big | null;
  /** Positions bloquées et lignes non qualifiées : des trous à nommer sur la racine. */
  blocked: boolean;
  unqualifiedAssets: readonly AssetCode[];
}

const chronological = (p: PositionReport): HistoryEntry[] => [...p.history].reverse();

const valueOf = (h: HistoryEntry): Big => h.valueEur ?? ZERO;

/** Contribution d'un mouvement à « Σ acquisitions » (négative quand une migration l'emporte). */
function investedContribution(h: HistoryEntry, settings: EngineSettings): Big | null {
  if (ACQUISITIONS.has(h.kind)) return valueOf(h);
  // Coût reporté : la migration sortante transfère sa part d'achats vers l'actif reçu.
  if (h.kind === 'migration-out' && settings.migrationMode === 'carry-cost')
    return valueOf(h).neg();
  return null;
}

function proceedsContribution(h: HistoryEntry, settings: EngineSettings): Big | null {
  if (h.kind === 'sell' || h.kind === 'withdrawal') return valueOf(h);
  if (h.kind === 'migration-out' && settings.migrationMode === 'realize') return valueOf(h);
  return null;
}

function positionSlice(p: PositionReport): Slice {
  return {
    asset: p.asset,
    lots: p.lots,
    history: chronological(p),
    qty: p.qty,
    costBasis: p.costBasis,
    pru: p.pru,
    price: p.price,
    value: p.value,
    unrealized: p.unrealized,
    realized: p.realized,
    otherIncome: p.otherIncome,
    invested: p.investedTotal,
    proceeds: p.proceedsTotal,
    fees: p.feesEur,
    rebates: p.rebatesEur,
    total: p.total,
    blocked: p.blocked !== null,
    unqualifiedAssets: p.unqualifiedCount > 0 ? [p.asset] : [],
  };
}

/** Découpe d'un compte dans une position : les lots suivent le compte de l'événement qui les ouvre. */
function accountSlice(p: PositionReport, accountId: AccountId, settings: EngineSettings): Slice {
  const accountOf = new Map<EventId, AccountId>();
  for (const h of p.history) if (ACQUISITIONS.has(h.kind)) accountOf.set(h.eventId, h.accountId);
  const lots = p.lots.filter((l) => accountOf.get(l.eventId) === accountId);
  const history = chronological(p).filter((h) => h.accountId === accountId);
  const qty = lots.reduce((acc, l) => acc.plus(l.qtyRemaining), ZERO);
  const costBasis = lots.reduce((acc, l) => acc.plus(l.costRemaining), ZERO);
  const unit = p.price ? D(p.price.priceEur) : null;
  const value = unit ? qty.times(unit) : isPositive(qty) ? null : ZERO;
  const unrealized = value ? value.minus(costBasis) : null;
  const realized = history.reduce((acc, h) => acc.plus(h.realized ?? ZERO), ZERO);
  const otherIncome = history.reduce(
    (acc, h) => (h.kind === 'reward' ? acc.plus(valueOf(h)) : acc),
    ZERO,
  );
  const invested = history.reduce(
    (acc, h) => acc.plus(investedContribution(h, settings) ?? ZERO),
    ZERO,
  );
  const proceeds = history.reduce(
    (acc, h) => acc.plus(proceedsContribution(h, settings) ?? ZERO),
    ZERO,
  );
  return {
    asset: p.asset,
    lots,
    history,
    qty,
    costBasis,
    pru: isPositive(qty) ? costBasis.div(qty) : null,
    price: p.price,
    value,
    unrealized,
    realized,
    otherIncome,
    invested,
    proceeds,
    fees: history.reduce((acc, h) => acc.plus(h.feeEur), ZERO),
    rebates: history.reduce((acc, h) => acc.plus(h.rebateEur), ZERO),
    total: unrealized ? realized.plus(unrealized).plus(otherIncome) : null,
    blocked: p.blocked !== null,
    unqualifiedAssets: p.unqualifiedCount > 0 ? [p.asset] : [],
  };
}

function lotSlice(p: PositionReport, lot: LotReport): Slice {
  const value = lot.value;
  const unrealized = lot.unrealized;
  return {
    asset: p.asset,
    lots: [lot],
    // L'historique complet reste là pour retrouver l'événement qui a ouvert le lot ; les compteurs
    // de flux, eux, restent à zéro : le CUMP ne s'attribue pas lot par lot.
    history: chronological(p),
    qty: lot.qtyRemaining,
    costBasis: lot.costRemaining,
    pru: isPositive(lot.qtyRemaining) ? lot.costRemaining.div(lot.qtyRemaining) : null,
    price: p.price,
    value,
    unrealized,
    realized: ZERO,
    otherIncome: ZERO,
    invested: ZERO,
    proceeds: ZERO,
    fees: ZERO,
    rebates: ZERO,
    total: unrealized,
    blocked: false,
    unqualifiedAssets: [],
  };
}

const livePositions = (report: PortfolioReport): PositionReport[] => [
  ...report.positions,
  ...report.stablecoins,
  ...report.closed,
];

function findPosition(report: PortfolioReport, asset: AssetCode): PositionReport | null {
  return [...livePositions(report), ...report.blocked].find((p) => p.asset === asset) ?? null;
}

// --- Briques de calcul ---------------------------------------------------------------------------

/** Σ des lots restants : la seule lecture du coût détenu, et donc du PRU (invariant à la vente). */
function costBasisNode(ctx: Ctx, slice: Slice, id: string): TraceNode {
  const seen = new Set<string>();
  const children = slice.lots.map((lot) => {
    const lotId = unique(seen, `${id}/lot:${lot.id}`);
    const carried = lot.origin === 'migration' && ctx.settings.migrationMode === 'carry-cost';
    if (carried) noteSetting(ctx, 'migrationMode');
    if (lot.origin === 'reward') noteSetting(ctx, 'rewardValuation');
    const opening = slice.history.find(
      (h) => h.eventId === lot.eventId && ACQUISITIONS.has(h.kind),
    );
    const openingChildren: TraceNode[] = [];
    if (opening) {
      openingChildren.push(
        operationNode(
          ctx,
          lotId,
          new Set<string>(),
          opening,
          slice.asset ?? '',
          lot.costInitial,
          opening.kind,
          lot.costInitial,
        ),
      );
    }
    if (lot.origin === 'reward') {
      openingChildren.push(
        mk({
          id: `${lotId}/setting:rewardValuation`,
          role: 'setting',
          provenance: {
            kind: 'setting',
            key: 'rewardValuation',
            value: ctx.settings.rewardValuation,
          },
        }),
      );
    }
    return mk({
      id: lotId,
      role: 'lot',
      amount: lot.costRemaining,
      asset: slice.asset,
      at: lot.openedAt,
      operator: 'identity',
      provenance: {
        kind: 'lot',
        lotId: lot.id,
        eventId: lot.eventId,
        openedAt: lot.openedAt,
        origin: lot.origin,
      },
      children: openingChildren,
      gap: carried ? 'carried-cost' : openingChildren.length === 0 ? 'missing-history' : null,
    });
  });
  return mk({
    id,
    role: 'cost-basis',
    amount: slice.costBasis,
    asset: slice.asset,
    operator: 'sum',
    children: cap(ctx, id, 'eur', children),
  });
}

function quantityNode(slice: Slice, id: string): TraceNode {
  return mk({ id, role: 'quantity', amount: slice.qty, unit: 'qty', asset: slice.asset });
}

/** Le cours vient toujours du dehors : la feuille le dit, avec sa source, sa date et sa fraîcheur. */
function quoteNode(slice: Slice, id: string): TraceNode {
  const price = slice.price;
  return mk({
    id,
    role: 'quote',
    amount: price ? D(price.priceEur) : null,
    unit: 'price',
    asset: slice.asset,
    gap: 'external-quote',
    provenance: price
      ? {
          kind: 'quote',
          asset: price.asset,
          priceEur: price.priceEur,
          at: price.at,
          source: price.source,
          stale: price.stale,
        }
      : { kind: 'derived' },
  });
}

function valueNode(slice: Slice, id: string): TraceNode {
  return mk({
    id,
    role: 'value',
    amount: slice.value,
    asset: slice.asset,
    operator: 'product',
    children: [quantityNode(slice, `${id}/quantity`), quoteNode(slice, `${id}/quote`)],
  });
}

function unrealizedNode(ctx: Ctx, slice: Slice, id: string): TraceNode {
  return mk({
    id,
    role: 'unrealized',
    amount: slice.unrealized,
    asset: slice.asset,
    operator: 'difference',
    children: [
      valueNode(slice, `${id}/value`),
      negate(costBasisNode(ctx, slice, `${id}/cost-basis`)),
    ],
  });
}

/** Une cession = produit − Σ des lots qu'elle a consommés. Rien d'autre n'entre dans le réalisé. */
function disposalNode(
  ctx: Ctx,
  slice: Slice,
  parentId: string,
  seen: Set<string>,
  h: HistoryEntry,
): TraceNode {
  const id = unique(seen, `${parentId}/${h.kind}:${h.eventId}`);
  const asset = slice.asset ?? '';
  const realized = h.realized ?? ZERO;
  const proceeds = valueOf(h);
  const costOfSaleId = `${id}/cost-of-sale`;
  const lotSeen = new Set<string>();
  const consumed = h.lotsConsumed.map((c) => {
    if (c.origin === 'migration' && ctx.settings.migrationMode === 'carry-cost')
      noteSetting(ctx, 'migrationMode');
    if (c.origin === 'reward') noteSetting(ctx, 'rewardValuation');
    return mk({
      id: unique(lotSeen, `${costOfSaleId}/lot:${c.lotId}`),
      role: 'lot',
      amount: c.cost.neg(),
      asset,
      at: c.openedAt,
      provenance: {
        kind: 'lot',
        lotId: c.lotId,
        eventId: c.eventId,
        openedAt: c.openedAt,
        origin: c.origin,
      },
      gap:
        c.origin === 'migration' && ctx.settings.migrationMode === 'carry-cost'
          ? 'carried-cost'
          : null,
    });
  });
  const costOfSale = proceeds.minus(realized);
  const costOfSaleNode = mk({
    id: costOfSaleId,
    role: 'cost-of-sale',
    amount: costOfSale.neg(),
    asset,
    operator: 'sum',
    children: cap(ctx, costOfSaleId, 'eur', consumed),
    gap: consumed.length === 0 && !isZero(costOfSale) ? 'missing-history' : null,
  });
  const proceedsNode = operationNode(
    ctx,
    id,
    new Set<string>(),
    h,
    asset,
    proceeds,
    'proceeds',
    proceeds,
  );
  return mk({
    id,
    role: h.kind,
    amount: realized,
    asset,
    at: h.at,
    operator: 'difference',
    children: [proceedsNode, costOfSaleNode],
  });
}

function realizedNode(ctx: Ctx, slice: Slice, id: string): TraceNode {
  const seen = new Set<string>();
  const children = slice.history
    .filter((h) => h.realized !== null)
    .map((h) => disposalNode(ctx, slice, id, seen, h));
  return mk({
    id,
    role: 'realized',
    amount: slice.realized,
    asset: slice.asset,
    operator: 'sum',
    children: cap(ctx, id, 'eur', children),
  });
}

function flowNode(
  ctx: Ctx,
  slice: Slice,
  id: string,
  role: 'invested' | 'proceeds',
  amount: Big,
): TraceNode {
  const seen = new Set<string>();
  const pick = role === 'invested' ? investedContribution : proceedsContribution;
  const children: TraceNode[] = [];
  for (const h of slice.history) {
    const contribution = pick(h, ctx.settings);
    if (contribution === null) continue;
    if (h.kind === 'migration-in' || h.kind === 'migration-out') noteSetting(ctx, 'migrationMode');
    children.push(
      operationNode(ctx, id, seen, h, slice.asset ?? '', contribution, h.kind, contribution),
    );
  }
  return mk({
    id,
    role,
    amount,
    asset: slice.asset,
    operator: 'sum',
    children: cap(ctx, id, 'eur', children),
  });
}

/** Frais nets = Σ frais bruts − Σ remises. Sans remise, la soustraction n'a pas lieu d'être. */
function feesNode(ctx: Ctx, slice: Slice, id: string): TraceNode {
  const withRebate = !isZero(slice.rebates);
  const grossId = withRebate ? `${id}/gross` : id;
  const grossSeen = new Set<string>();
  const gross: TraceNode[] = [];
  const rebateSeen = new Set<string>();
  const rebates: TraceNode[] = [];
  for (const h of slice.history) {
    const grossFee = h.feeEur.plus(h.rebateEur);
    if (!isZero(grossFee))
      gross.push(operationNode(ctx, grossId, grossSeen, h, slice.asset ?? '', grossFee, 'fee'));
    if (withRebate && !isZero(h.rebateEur))
      rebates.push(
        operationNode(
          ctx,
          `${id}/rebates`,
          rebateSeen,
          h,
          slice.asset ?? '',
          h.rebateEur.neg(),
          'rebate',
        ),
      );
  }
  if (!withRebate) {
    return mk({
      id,
      role: 'fee',
      amount: slice.fees,
      asset: slice.asset,
      operator: 'sum',
      children: cap(ctx, id, 'eur', gross),
    });
  }
  const grossTotal = slice.fees.plus(slice.rebates);
  return mk({
    id,
    role: 'fee',
    amount: slice.fees,
    asset: slice.asset,
    operator: 'difference',
    children: [
      mk({
        id: grossId,
        role: 'fee',
        amount: grossTotal,
        asset: slice.asset,
        operator: 'sum',
        children: cap(ctx, grossId, 'eur', gross),
      }),
      mk({
        id: `${id}/rebates`,
        role: 'rebate',
        amount: slice.rebates.neg(),
        asset: slice.asset,
        operator: 'sum',
        children: cap(ctx, `${id}/rebates`, 'eur', rebates),
      }),
    ],
  });
}

function totalNode(ctx: Ctx, slice: Slice, id: string): TraceNode {
  const children: TraceNode[] = [
    realizedNode(ctx, slice, `${id}/realized`),
    unrealizedNode(ctx, slice, `${id}/unrealized`),
  ];
  if (!isZero(slice.otherIncome)) {
    noteSetting(ctx, 'rewardValuation');
    children.push(
      mk({
        id: `${id}/other-income`,
        role: 'other-income',
        amount: slice.otherIncome,
        asset: slice.asset,
        provenance: {
          kind: 'setting',
          key: 'rewardValuation',
          value: ctx.settings.rewardValuation,
        },
      }),
    );
  }
  return mk({
    id,
    role: 'metric',
    amount: slice.total,
    asset: slice.asset,
    operator: 'sum',
    children,
  });
}

function pruNode(ctx: Ctx, slice: Slice, id: string): TraceNode {
  return mk({
    id,
    role: 'price',
    amount: slice.pru,
    unit: 'price',
    asset: slice.asset,
    operator: 'quotient',
    children: [
      costBasisNode(ctx, slice, `${id}/cost-basis`),
      quantityNode(slice, `${id}/quantity`),
    ],
  });
}

const UNIT_OF: Record<TraceMetric, TraceUnit> = {
  pru: 'price',
  'cost-basis': 'eur',
  invested: 'eur',
  proceeds: 'eur',
  realized: 'eur',
  unrealized: 'eur',
  fees: 'eur',
  value: 'eur',
  total: 'eur',
};

function metricNode(ctx: Ctx, slice: Slice, metric: TraceMetric, id: string): TraceNode {
  switch (metric) {
    case 'pru':
      return pruNode(ctx, slice, id);
    case 'cost-basis':
      return costBasisNode(ctx, slice, id);
    case 'invested':
      return flowNode(ctx, slice, id, 'invested', slice.invested);
    case 'proceeds':
      return flowNode(ctx, slice, id, 'proceeds', slice.proceeds);
    case 'realized':
      return realizedNode(ctx, slice, id);
    case 'unrealized':
      return unrealizedNode(ctx, slice, id);
    case 'fees':
      return feesNode(ctx, slice, id);
    case 'value':
      return valueNode(slice, id);
    case 'total':
      return totalNode(ctx, slice, id);
  }
}

// --- Portefeuille --------------------------------------------------------------------------------

function portfolioAmount(report: PortfolioReport, metric: TraceMetric): Big | null {
  const t = report.totals;
  switch (metric) {
    case 'pru':
      return null;
    case 'cost-basis':
      return t.costBasis;
    case 'invested':
      return t.investedTotal;
    case 'proceeds':
      return t.proceedsTotal;
    case 'realized':
      return t.realized;
    case 'unrealized':
      return t.unrealized;
    case 'fees':
      return t.feesEur;
    case 'value':
      return t.value;
    case 'total':
      return t.total;
  }
}

/** Le périmètre d'une métrique : « valeur » et « coût » ne portent que sur les positions cotées. */
function contributes(p: PositionReport, metric: TraceMetric): boolean {
  if (metric === 'value' || metric === 'cost-basis' || metric === 'unrealized')
    return p.value !== null;
  return true;
}

/** Une métrique du portefeuille = la somme de la même métrique sur chaque position de son périmètre. */
function byPosition(
  ctx: Ctx,
  metric: TraceMetric,
  id: string,
  amount: Big | null,
  role: TraceRole = 'metric',
): TraceNode {
  const seen = new Set<string>();
  const children: TraceNode[] = [];
  for (const p of livePositions(ctx.report)) {
    if (!contributes(p, metric)) continue;
    const node = metricNode(
      ctx,
      positionSlice(p),
      metric,
      unique(seen, `${id}/position:${p.asset}`),
    );
    if (node.amount === null) continue;
    children.push({ ...node, role: 'position' });
  }
  return mk({
    id,
    role,
    amount,
    unit: UNIT_OF[metric],
    operator: 'sum',
    children: cap(ctx, id, UNIT_OF[metric], children),
  });
}

function portfolioNode(ctx: Ctx, metric: TraceMetric, id: string): TraceNode {
  const totals = ctx.report.totals;
  // Le PRU n'a pas de sens à l'échelle du portefeuille : mêler des unités d'actifs différents
  // donnerait un chiffre que rien ne pourrait vérifier.
  if (metric === 'pru') return mk({ id, role: 'metric', unit: 'price' });
  if (metric !== 'total') return byPosition(ctx, metric, id, portfolioAmount(ctx.report, metric));

  // Total = réalisé + latent + récompenses valorisées, chacun sur SON périmètre (le latent ne
  // porte que sur les positions cotées) ; l'abonnement s'en déduit s'il est intégré au P&L.
  const otherSeen = new Set<string>();
  const otherIncome: TraceNode[] = [];
  for (const p of livePositions(ctx.report)) {
    if (isZero(p.otherIncome)) continue;
    otherIncome.push(
      mk({
        id: unique(otherSeen, `${id}/other-income/position:${p.asset}`),
        role: 'other-income',
        amount: p.otherIncome,
        asset: p.asset,
      }),
    );
  }
  if (otherIncome.length > 0) noteSetting(ctx, 'rewardValuation');
  const children: TraceNode[] = [
    byPosition(ctx, 'realized', `${id}/realized`, totals.realized, 'realized'),
    byPosition(ctx, 'unrealized', `${id}/unrealized`, totals.unrealized, 'unrealized'),
    mk({
      id: `${id}/other-income`,
      role: 'other-income',
      amount: totals.otherIncome,
      operator: 'sum',
      children: cap(ctx, `${id}/other-income`, 'eur', otherIncome),
    }),
  ];
  if (ctx.settings.includeSubscriptionsInPnl) {
    noteSetting(ctx, 'includeSubscriptionsInPnl');
    children.push(
      mk({
        id: `${id}/subscriptions`,
        role: 'subscription',
        amount: totals.subscriptionsEur.neg(),
        provenance: {
          kind: 'setting',
          key: 'includeSubscriptionsInPnl',
          value: String(ctx.settings.includeSubscriptionsInPnl),
        },
      }),
    );
  }
  return mk({ id, role: 'metric', amount: totals.total, operator: 'sum', children });
}

// --- Trous, résidu, réglages ---------------------------------------------------------------------

/** Lignes non qualifiées de la portée : le trou est **nommé**, à contribution nulle, jamais comblé. */
function unqualifiedNodes(ctx: Ctx, id: string, assets: readonly AssetCode[]): TraceNode[] {
  if (assets.length === 0) return [];
  const wanted = new Set(assets);
  return ctx.report.unqualified
    .filter((e) => e.legs.some((l) => wanted.has(l.asset)))
    .map((e) =>
      mk({
        id: `${id}/unqualified:${e.id}`,
        role: 'unqualified',
        amount: ZERO,
        at: e.at,
        gap: 'unqualified-row',
        provenance: {
          kind: 'unqualified',
          eventId: e.id,
          rawType: e.rawType,
          reason: e.reason,
          rowKeys: e.rowKeys,
        },
      }),
    );
}

function walk(node: TraceNode, visit: (n: TraceNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

/** Σ des écarts de bouclage de tous les nœuds additifs : un seul chiffre pour tout l'arbre. */
function residualOf(root: TraceNode): Big {
  let total = ZERO;
  walk(root, (n) => {
    if (n.operator !== 'sum' && n.operator !== 'difference') return;
    if (n.amount === null) return;
    const sum = n.children.reduce(
      (acc, c) => acc.plus(c.amount === null ? ZERO : D(c.amount)),
      ZERO,
    );
    total = total.plus(sum.minus(D(n.amount)));
  });
  return total;
}

function gapsOf(root: TraceNode): TraceGap[] {
  const seen = new Set<TraceGap>();
  const ordered: TraceGap[] = [];
  walk(root, (n) => {
    if (n.gap !== null && !seen.has(n.gap)) {
      seen.add(n.gap);
      ordered.push(n.gap);
    }
  });
  return ordered;
}

// --- Point d'entrée ------------------------------------------------------------------------------

function scopeSegment(scope: TraceScope): string {
  switch (scope.kind) {
    case 'position':
      return scope.asset;
    case 'lot':
      return `${scope.asset}/lot:${scope.lotId}`;
    case 'account':
      return scope.asset === null
        ? `account:${scope.accountId}`
        : `account:${scope.accountId}/${scope.asset}`;
    case 'portfolio':
      return 'portfolio';
  }
}

/** Métriques qui n'ont pas de sens à l'échelle d'un lot : le CUMP ne s'attribue pas lot par lot. */
const LOT_METRICS: ReadonlySet<TraceMetric> = new Set(['pru', 'cost-basis', 'value', 'unrealized']);

export function traceMetric(input: TraceInput): Trace {
  const ctx: Ctx = {
    report: input.report,
    settings: input.settings,
    row: input.row,
    events: new Map((input.events ?? []).map((e) => [e.id, e])),
    maxChildren: Math.max(2, input.maxChildren ?? DEFAULT_MAX_CHILDREN),
    omitted: 0,
    used: new Map(),
  };
  const { metric, scope } = input.target;
  const id = `${metric}/${scopeSegment(scope)}`;
  const unit = UNIT_OF[metric];

  let root: TraceNode;
  let extra: TraceNode[] = [];
  if (scope.kind === 'portfolio') {
    root = portfolioNode(ctx, metric, id);
    const assets = livePositions(ctx.report)
      .filter((p) => p.unqualifiedCount > 0)
      .map((p) => p.asset);
    extra = unqualifiedNodes(ctx, id, assets);
  } else {
    const asset = scope.kind === 'account' ? scope.asset : scope.asset;
    const position = asset === null ? null : findPosition(ctx.report, asset);
    if (!position) {
      root = mk({ id, role: 'metric', unit, gap: 'missing-history' });
    } else if (scope.kind === 'lot') {
      const lot = position.lots.find((l) => l.id === scope.lotId) ?? null;
      root = !lot
        ? mk({ id, role: 'metric', unit, gap: 'missing-history' })
        : LOT_METRICS.has(metric)
          ? metricNode(ctx, lotSlice(position, lot), metric, id)
          : mk({ id, role: 'metric', unit, asset: position.asset });
    } else {
      const slice =
        scope.kind === 'account'
          ? accountSlice(position, scope.accountId, ctx.settings)
          : positionSlice(position);
      root = metricNode(ctx, slice, metric, id);
      extra = unqualifiedNodes(ctx, id, slice.unqualifiedAssets);
      if (slice.blocked)
        extra.push(
          mk({
            id: `${id}/blocked`,
            role: 'note',
            amount: ZERO,
            asset: position.asset,
            gap: 'missing-history',
          }),
        );
    }
  }
  if (extra.length > 0) root = { ...root, children: [...root.children, ...extra] };

  const rawResidual = residualOf(root);
  const residual = rawResidual.abs().lte(TRACE_EPSILON) ? ZERO : rawResidual;
  return {
    target: input.target,
    amount: root.amount,
    unit,
    root,
    residual: toDecimalString(residual),
    gaps: gapsOf(root),
    settings: [...ctx.used.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => ({ key, value })),
    omitted: ctx.omitted,
  };
}
