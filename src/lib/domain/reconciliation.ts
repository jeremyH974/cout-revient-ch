/**
 * Réconciliation (P68) — écarts, trous et doublons, rassemblés en une seule liste d'actions.
 *
 * Comme `insights.ts` (décision n° 40) : des règles PURES qui lisent des rapports DÉJÀ CALCULÉS et
 * émettent des constats CODÉS, jamais des phrases — le texte français vit dans
 * `src/lib/format/reconciliation.ts`. Ce module ne recalcule rien : `PortfolioReport.unqualified`,
 * `PositionReport.integrity`, `TransferPairing`, `TaxLedger`, `DeclarationReport` existent déjà et
 * sont simplement PARCOURUS ici. La seule anomalie construite depuis zéro est le doublon candidat
 * (`duplicate-candidate`) : le dédoublonnage du moteur est exact (même clé de ligne), il ne
 * rapproche jamais deux lignes ÉQUIVALENTES mais non identiques.
 *
 * Un item ne porte qu'une `TraceTarget`, jamais une `Trace` précalculée : la résolution reste
 * paresseuse (décision n° 61), exactement comme `WhySheet` calcule `app.trace(target)` seulement à
 * l'ouverture.
 */
import { isCashLike } from './assets';
import type { ValueGap } from './gap';
import type { DeclarationReport } from './declarations-fr';
import type { TraceTarget } from './engine/trace';
import type { PortfolioReport, PositionReport } from './engine/report';
import type { InsightValue } from './insights';
import { Big, D } from './money';
import type { TaxLedger } from './tax-fr';
import type { TransferPairing } from './transfers';
import {
  COINHOUSE_ACCOUNT_ID,
  type AccountId,
  type AssetCode,
  type EventId,
  type LedgerEvent,
  type NaiveDateTime,
  type RowKey,
  type TradeEvent,
} from './types';

// --- Vocabulaire -----------------------------------------------------------------------------

export type ReconciliationCode =
  | 'unqualified-rows'
  | 'unpriced-asset'
  | 'balance-mismatch'
  | 'onchain-balance-gap'
  | 'unpaired-withdrawal'
  | 'unpaired-deposit'
  | 'duplicate-candidate'
  | 'external-inflow-no-cost'
  | 'external-outflow-unqualified'
  | 'price-gap-at-cession'
  | 'account-missing-country';

export type ReconciliationSeverity = 'fail' | 'warn' | 'info';

export type ReconciliationActionCode =
  | 'qualify-rows'
  | 'set-manual-price'
  | 'reimport-export'
  | 'enter-opening-balance'
  | 'pair-or-value-transfer'
  | 'set-account-country'
  | 'review-duplicate'
  | 'none';

export interface ReconciliationAction {
  code: ReconciliationActionCode;
  accountId?: AccountId;
  asset?: AssetCode;
}

export interface ReconciliationEvidence {
  rowKeys: readonly RowKey[];
  eventIds: readonly EventId[];
  trace: TraceTarget | null;
  gap?: ValueGap;
}

export interface ReconciliationItem {
  id: string;
  code: ReconciliationCode;
  severity: ReconciliationSeverity;
  priority: number;
  scope: { asset: AssetCode | null; accountId: AccountId | null };
  values: Readonly<Record<string, InsightValue>>;
  evidence: ReconciliationEvidence;
  action: ReconciliationAction;
}

export interface ReconciliationReport {
  items: readonly ReconciliationItem[];
}

/**
 * Priorité, déclarée en UN SEUL endroit (même modèle que `PRIORITY` dans `insights.ts`) : la
 * qualité des données (lignes non qualifiées, soldes qui ne bouclent pas) prime sur tout le reste,
 * puis le risque fiscal direct, puis les virements, puis les doublons, puis l'information pure.
 * Deux items du MÊME code peuvent porter des `severity` différentes selon la situation (un solde
 * Coinhouse « opening-balance-missing » reste `warn` quand un vrai `balance-mismatch` est `fail`) :
 * la sévérité groupe l'écran, cette table ne fait que départager l'ordre à l'intérieur d'un groupe.
 */
const PRIORITY: Record<ReconciliationCode, number> = {
  'unqualified-rows': 100,
  'balance-mismatch': 100,
  'unpriced-asset': 90,
  'external-inflow-no-cost': 80,
  'price-gap-at-cession': 80,
  'unpaired-withdrawal': 70,
  'unpaired-deposit': 70,
  'external-outflow-unqualified': 70,
  'duplicate-candidate': 60,
  'account-missing-country': 50,
  'onchain-balance-gap': 0,
};

/** Compte perps (Hyperliquid) dont l'équité ne se recoupe pas : même comparaison que `self-check.ts`. */
export interface ReconciliationTradingGap {
  accountId: AccountId;
  gap: Big | null;
}

export type DuplicateReview = 'confirmed' | 'dismissed';

export interface ReconciliationContext {
  /** Rapport du moteur, DANS LA DEVISE D'AFFICHAGE (même convention que `InsightContext.report`). */
  report: PortfolioReport;
  /** Grand livre déjà assemblé (dont les décorations de virements) : sert au doublon candidat. */
  events: readonly LedgerEvent[];
  transfers: TransferPairing;
  declarations: DeclarationReport;
  /** `null` tant que l'historique de prix n'est pas chargé (même garde que `checks.svelte.ts`). */
  tax: TaxLedger | null;
  trading: readonly ReconciliationTradingGap[];
  /** Doublons déjà tranchés par l'utilisateur (confirmés ou écartés) : filtrés hors de la liste. */
  duplicateOverrides: Readonly<Record<string, DuplicateReview>>;
}

// --- Fabrique ------------------------------------------------------------------------------------

const count = (value: number): InsightValue => ({ kind: 'count', value });
const day = (value: NaiveDateTime): InsightValue => ({ kind: 'day', value });

function item(input: {
  id: string;
  code: ReconciliationCode;
  severity: ReconciliationSeverity;
  scope: { asset: AssetCode | null; accountId: AccountId | null };
  values: Record<string, InsightValue>;
  evidence: ReconciliationEvidence;
  action: ReconciliationAction;
}): ReconciliationItem {
  return { ...input, priority: PRIORITY[input.code] };
}

type ReconciliationRule = (ctx: ReconciliationContext) => ReconciliationItem[];

// --- Qualité des données (fail) ------------------------------------------------------------------

/** Lignes que le moteur n'a pas su interpréter : les totaux restent incomplets tant qu'elles restent. */
const unqualifiedRowsRule: ReconciliationRule = (ctx) => {
  const list = ctx.report.unqualified;
  if (list.length === 0) return [];
  return [
    item({
      id: 'unqualified-rows',
      code: 'unqualified-rows',
      severity: 'fail',
      scope: { asset: null, accountId: null },
      values: { count: count(list.length) },
      evidence: {
        rowKeys: list.flatMap((e) => e.rowKeys),
        eventIds: list.map((e) => e.id),
        trace: { metric: 'total', scope: { kind: 'portfolio' } },
      },
      action: { code: 'qualify-rows' },
    }),
  ];
};

const allPositions = (r: PortfolioReport): PositionReport[] => [
  ...r.positions,
  ...r.stablecoins,
  ...r.closed,
  ...r.blocked,
];

/**
 * Écart de solde Coinhouse : la colonne « Solde » de l'export n'est pas retrouvée après chaque
 * opération. Deux situations, deux sévérités — un écart réel est `fail` (le calcul est faux tant
 * qu'il n'est pas réglé), un export tronqué (`opening-balance-missing`) reste `warn` : c'est peut-
 * être volontaire (export filtré par période).
 */
const balanceMismatchRule: ReconciliationRule = (ctx) => {
  const out: ReconciliationItem[] = [];
  for (const p of allPositions(ctx.report)) {
    const integrity = p.integrity;
    if (!integrity) continue;
    const trace: TraceTarget = {
      metric: 'cost-basis',
      scope: { kind: 'position', asset: p.asset },
    };
    if (integrity.status === 'balance-mismatch' || integrity.status === 'final-mismatch') {
      out.push(
        item({
          id: `balance-mismatch:coinhouse:${p.asset}`,
          code: 'balance-mismatch',
          severity: 'fail',
          scope: { asset: p.asset, accountId: COINHOUSE_ACCOUNT_ID },
          values: {},
          evidence: { rowKeys: [], eventIds: [], trace },
          action: { code: 'reimport-export', accountId: COINHOUSE_ACCOUNT_ID, asset: p.asset },
        }),
      );
    } else if (integrity.status === 'opening-balance-missing') {
      out.push(
        item({
          id: `balance-mismatch:coinhouse:${p.asset}`,
          code: 'balance-mismatch',
          severity: 'warn',
          scope: { asset: p.asset, accountId: COINHOUSE_ACCOUNT_ID },
          values: {},
          evidence: { rowKeys: [], eventIds: [], trace },
          action: {
            code: 'enter-opening-balance',
            accountId: COINHOUSE_ACCOUNT_ID,
            asset: p.asset,
          },
        }),
      );
    }
  }
  return out;
};

/** Tolérance de réconciliation d'un compte perps (USDC) : même valeur que `self-check.ts`. */
const TRADING_TOLERANCE = D('0.01');

/**
 * Écart de solde Hyperliquid : `accountValue − (flux + réalisé − frais + funding + latent)`, déjà
 * calculé par `computeTrading` (`TradingAccountReport.reconciliation.gap`) — cette règle ne fait que
 * lire le résultat et le comparer à la tolérance, exactement comme `self-check.ts`. Le trace-métier
 * ne couvre pas les comptes de trading (`TraceScope` n'a pas de portée « compte perps ») : `trace`
 * reste `null`, l'écran s'appuie sur les preuves (identifiants) plutôt que sur « Pourquoi ce chiffre ? ».
 */
const tradingBalanceMismatchRule: ReconciliationRule = (ctx) =>
  ctx.trading
    .filter((t) => t.gap !== null && t.gap.abs().gt(TRADING_TOLERANCE))
    .map((t) =>
      item({
        id: `balance-mismatch:hyperliquid:${t.accountId}`,
        code: 'balance-mismatch',
        severity: 'fail',
        scope: { asset: null, accountId: t.accountId },
        values: {},
        evidence: { rowKeys: [], eventIds: [], trace: null },
        action: { code: 'reimport-export', accountId: t.accountId },
      }),
    );

// --- Prix et risque fiscal direct (warn) ---------------------------------------------------------

/** Actifs détenus sans cours connu : leur valeur et leur latent manquent aux totaux. */
const unpricedAssetRule: ReconciliationRule = (ctx) =>
  ctx.report.totals.unpricedAssets.map((asset) =>
    item({
      id: `unpriced-asset:${asset}`,
      code: 'unpriced-asset',
      severity: 'warn',
      scope: { asset, accountId: null },
      values: {},
      evidence: {
        rowKeys: [],
        eventIds: [],
        trace: { metric: 'value', scope: { kind: 'position', asset } },
      },
      action: { code: 'set-manual-price', asset },
    }),
  );

/**
 * Entrées externes sans coût connu : `TransferPairing.unpairedDeposits` est PLUS PRÉCIS que
 * `TaxLedger.externalInflows` (celui-ci compte tout dépôt sans coût, y compris ceux qu'un virement
 * interne appariera plus tard). Un coût sous-estimé gonfle le PTA... non : le SOUS-estime, donc
 * SURESTIME la plus-value future — risque fiscal direct, d'où la priorité haute (groupe 3).
 */
const externalInflowNoCostRule: ReconciliationRule = (ctx) => {
  const list = ctx.transfers.unpairedDeposits;
  if (list.length === 0) return [];
  return [
    item({
      id: 'external-inflow-no-cost',
      code: 'external-inflow-no-cost',
      severity: 'warn',
      scope: { asset: null, accountId: null },
      values: { count: count(list.length) },
      evidence: {
        rowKeys: list.flatMap((d) => d.rowKeys),
        eventIds: list.map((d) => d.id),
        trace: null,
      },
      action: { code: 'pair-or-value-transfer' },
    }),
  ];
};

/**
 * Trou de prix à une cession : `TaxCession.globalValueEur === null` empêche d'estimer la plus-value
 * de l'année. Livré en `info` avec `action: 'none'` (arbitrage explicite, voir `docs/reconciliation.md`) :
 * il n'existe aucun écran pour annoter la valeur globale du portefeuille à une date passée, et cette
 * limite est nommée ici plutôt que comblée par un écran ad hoc.
 */
const priceGapAtCessionRule: ReconciliationRule = (ctx) => {
  const list = (ctx.tax?.cessions ?? []).filter((c) => c.globalValueEur === null);
  if (list.length === 0) return [];
  return [
    item({
      id: 'price-gap-at-cession',
      code: 'price-gap-at-cession',
      severity: 'info',
      scope: { asset: null, accountId: null },
      values: { count: count(list.length) },
      evidence: { rowKeys: [], eventIds: list.map((c) => c.eventId), trace: null },
      action: { code: 'none' },
    }),
  ];
};

// --- Virements (warn) ------------------------------------------------------------------------

/** Un retrait par item : chaque virement non apparié s'apparie ou se valorise individuellement. */
const unpairedWithdrawalRule: ReconciliationRule = (ctx) =>
  ctx.transfers.unpairedWithdrawals.map((w) =>
    item({
      id: `unpaired-withdrawal:${w.id}`,
      code: 'unpaired-withdrawal',
      severity: 'warn',
      scope: { asset: w.out.asset, accountId: w.accountId },
      values: { day: day(w.at) },
      evidence: {
        rowKeys: w.rowKeys,
        eventIds: [w.id],
        trace: {
          metric: 'proceeds',
          scope: { kind: 'account', accountId: w.accountId, asset: w.out.asset },
        },
      },
      action: { code: 'pair-or-value-transfer', accountId: w.accountId, asset: w.out.asset },
    }),
  );

const unpairedDepositRule: ReconciliationRule = (ctx) =>
  ctx.transfers.unpairedDeposits.map((d) =>
    item({
      id: `unpaired-deposit:${d.id}`,
      code: 'unpaired-deposit',
      severity: 'warn',
      scope: { asset: d.in.asset, accountId: d.accountId },
      values: { day: day(d.at) },
      evidence: {
        rowKeys: d.rowKeys,
        eventIds: [d.id],
        trace: {
          metric: 'invested',
          scope: { kind: 'account', accountId: d.accountId, asset: d.in.asset },
        },
      },
      action: { code: 'pair-or-value-transfer', accountId: d.accountId, asset: d.in.asset },
    }),
  );

/**
 * Sortie externe non qualifiable : un paiement en crypto (biens, services) serait imposable, mais un
 * export ne permet pas de le distinguer d'un simple transfert vers un wallet personnel — signalé,
 * jamais deviné (même principe que `tax-fr.ts`, § 2 de son en-tête).
 */
const externalOutflowUnqualifiedRule: ReconciliationRule = (ctx) => {
  const list = ctx.transfers.unpairedWithdrawals;
  if (list.length === 0) return [];
  return [
    item({
      id: 'external-outflow-unqualified',
      code: 'external-outflow-unqualified',
      severity: 'warn',
      scope: { asset: null, accountId: null },
      values: { count: count(list.length) },
      evidence: {
        rowKeys: list.flatMap((w) => w.rowKeys),
        eventIds: list.map((w) => w.id),
        trace: null,
      },
      action: { code: 'pair-or-value-transfer' },
    }),
  ];
};

// --- Doublons candidats (warn) -----------------------------------------------------------------

/** Décimales conservées pour regrouper deux quantités « quasi identiques » (poussière d'arrondi). */
const DUPLICATE_QTY_DP = 8;

interface DuplicateLeg {
  eventId: EventId;
  accountId: AccountId;
  source: LedgerEvent['source'];
  at: NaiveDateTime;
  asset: AssetCode;
  rowKeys: readonly RowKey[];
}

/**
 * La « jambe actif » d'un événement, pour le seul usage du rapprochement de doublons : un côté
 * cash-like (fiat OU stablecoin) et l'autre non. Les échanges cash↔cash (conversion EUR→USDC) et
 * crypto↔crypto (sursis d'imposition) sont exclus de CETTE règle : ce sont deux catégories que le
 * projet traite déjà séparément ailleurs, et le cas qui compte ici — un achat ou une vente comptés
 * deux fois par deux chemins d'import différents — n'a besoin que du côté fiat/crypto.
 */
function tradeLeg(e: TradeEvent): { asset: AssetCode; qty: Big } | null {
  const outCash = isCashLike(e.out.asset);
  const inCash = isCashLike(e.in.asset);
  if (outCash === inCash) return null;
  return outCash
    ? { asset: e.in.asset, qty: D(e.in.qty) }
    : { asset: e.out.asset, qty: D(e.out.qty) };
}

/** Une jambe candidate par mouvement qui porte un actif et une quantité sans ambiguïté. */
function duplicateLegsOf(events: readonly LedgerEvent[]): (DuplicateLeg & { qty: Big })[] {
  const legs: (DuplicateLeg & { qty: Big })[] = [];
  const base = (e: LedgerEvent): DuplicateLeg => ({
    eventId: e.id,
    accountId: e.accountId,
    source: e.source,
    at: e.at,
    asset: '',
    rowKeys: e.rowKeys,
  });
  for (const e of events) {
    if (e.kind === 'trade') {
      const leg = tradeLeg(e);
      if (leg) legs.push({ ...base(e), asset: leg.asset, qty: leg.qty });
    } else if (e.kind === 'reward') {
      legs.push({ ...base(e), asset: e.in.asset, qty: D(e.in.qty) });
    } else if (e.kind === 'deposit') {
      legs.push({ ...base(e), asset: e.in.asset, qty: D(e.in.qty) });
    } else if (e.kind === 'withdrawal') {
      legs.push({ ...base(e), asset: e.out.asset, qty: D(e.out.qty) });
    }
    // migration, fee, opening-balance, unqualified : hors périmètre de cette règle (voir en-tête).
  }
  return legs;
}

/** Clé de regroupement : jour + actif + quantité arrondie (poussière d'arrondi entre plateformes). */
function duplicateGroupKey(leg: DuplicateLeg & { qty: Big }): string {
  const rounded = leg.qty.round(DUPLICATE_QTY_DP, Big.roundHalfEven);
  return `${leg.at.slice(0, 10)}|${leg.asset}|${rounded.toString()}`;
}

/** Clé stable et symétrique d'une paire d'événements : ordre des identifiants sans importance. */
export function duplicatePairKey(a: EventId, b: EventId): string {
  return a < b ? `${a}~${b}` : `${b}~${a}`;
}

/**
 * Doublon candidat : deux mouvements du même jour, même actif, quantité quasi identique — QUE si
 * les deux viennent de comptes différents ou de sources d'import différentes (`EventBase.source`).
 * Deux achats identiques le même jour sur le MÊME compte, importés de la MÊME façon, sont un achat
 * programmé légitime : c'est ce qui élimine la classe entière de faux positifs (arbitrage explicite).
 * Jamais de suppression automatique : l'action est toujours `review-duplicate`, l'utilisateur
 * confirme ou écarte — un doublon déjà tranché (`duplicateOverrides`) n'est plus listé.
 */
const duplicateCandidateRule: ReconciliationRule = (ctx) => {
  const groups = new Map<string, (DuplicateLeg & { qty: Big })[]>();
  for (const leg of duplicateLegsOf(ctx.events)) {
    const key = duplicateGroupKey(leg);
    const list = groups.get(key) ?? [];
    list.push(leg);
    groups.set(key, list);
  }
  const out: ReconciliationItem[] = [];
  const seen = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        if (a.accountId === b.accountId && a.source === b.source) continue;
        const pairKey = duplicatePairKey(a.eventId, b.eventId);
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        if (ctx.duplicateOverrides[pairKey]) continue;
        const sameAccount = a.accountId === b.accountId;
        out.push(
          item({
            id: `duplicate-candidate:${pairKey}`,
            code: 'duplicate-candidate',
            severity: 'warn',
            scope: { asset: a.asset, accountId: sameAccount ? a.accountId : null },
            values: { day: day(a.at) },
            evidence: {
              rowKeys: [...a.rowKeys, ...b.rowKeys],
              eventIds: [a.eventId, b.eventId],
              trace: null,
            },
            action: {
              code: 'review-duplicate',
              asset: a.asset,
              ...(sameAccount ? { accountId: a.accountId } : {}),
            },
          }),
        );
      }
    }
  }
  return out;
};

// --- Information (info) ---------------------------------------------------------------------

/** Compte dont le pays de l'organisme n'est pas renseigné : son statut 3916-bis reste indéterminé. */
const accountMissingCountryRule: ReconciliationRule = (ctx) =>
  ctx.declarations.accounts
    .filter((a) => a.status === 'unknown')
    .map((a) =>
      item({
        id: `account-missing-country:${a.accountId}`,
        code: 'account-missing-country',
        severity: 'info',
        scope: { asset: null, accountId: a.accountId },
        values: {},
        evidence: { rowKeys: [], eventIds: [], trace: null },
        action: { code: 'set-account-country', accountId: a.accountId },
      }),
    );

/**
 * Solde on-chain : le code et sa `GapSource` restent déclarés (voir `gap.ts`) pour que l'écran, le
 * type et un futur chantier partagent la même forme, mais AUCUNE règle ne le peuple : l'import
 * on-chain (`src/lib/import/onchain/*`) ne lit que des MOUVEMENTS, jamais un solde courant à
 * comparer. Une fonctionnalité qui fait semblant d'exister est pire qu'une absente (arbitrage
 * explicite) : cette règle n'émet donc jamais rien, volontairement.
 */
const onchainBalanceGapRule: ReconciliationRule = () => [];

/**
 * Registre des règles : ajouter une anomalie = une règle ici, son code dans `ReconciliationCode`,
 * son rang dans `PRIORITY`, sa phrase dans `src/lib/format/reconciliation.ts` (le compilateur exige
 * les trois — voir le contrôle d'exhaustivité du rendu, sur `code` ET sur `action.code`).
 */
const RULES: readonly ReconciliationRule[] = [
  unqualifiedRowsRule,
  balanceMismatchRule,
  tradingBalanceMismatchRule,
  unpricedAssetRule,
  externalInflowNoCostRule,
  priceGapAtCessionRule,
  unpairedWithdrawalRule,
  unpairedDepositRule,
  externalOutflowUnqualifiedRule,
  duplicateCandidateRule,
  accountMissingCountryRule,
  onchainBalanceGapRule,
];

/** Tous les items, du plus important au moins important dans son groupe (ordre déterministe). */
export function buildReconciliation(ctx: ReconciliationContext): ReconciliationReport {
  const items = RULES.flatMap((rule) => rule(ctx)).sort(
    (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return { items };
}

export interface ReconciliationSummary {
  fail: number;
  warn: number;
  info: number;
  worst: ReconciliationSeverity | null;
}

const SEVERITY_RANK: Record<ReconciliationSeverity, number> = { info: 0, warn: 1, fail: 2 };

/** Décompte par sévérité, pour un badge compact (même esprit que `summarize()` de `self-check.ts`). */
export function summarizeReconciliation(report: ReconciliationReport): ReconciliationSummary {
  let fail = 0;
  let warn = 0;
  let info = 0;
  let worst: ReconciliationSeverity | null = null;
  for (const it of report.items) {
    if (it.severity === 'fail') fail++;
    else if (it.severity === 'warn') warn++;
    else info++;
    if (worst === null || SEVERITY_RANK[it.severity] > SEVERITY_RANK[worst]) worst = it.severity;
  }
  return { fail, warn, info, worst };
}
