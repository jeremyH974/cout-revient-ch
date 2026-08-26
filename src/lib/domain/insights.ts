/**
 * Moteur de constats (décision n° 40) — des règles PURES qui lisent le rapport déjà calculé et
 * émettent des constats CODÉS, jamais des phrases : le texte français vit dans
 * `src/lib/format/insights.ts`. Le moteur ignore la langue, le mode discret et la devise
 * d'affichage (il travaille dans celle des données qu'on lui donne). Un constat est du JSON simple
 * — chaînes décimales et compteurs — donc réutilisable tel quel par l'écran, le rapport, le PDF,
 * le presse-papier et, demain, une version anglaise ou un serveur MCP.
 *
 * Règle intangible : un constat CONSTATE (un chiffre, sa portée, sa source). Il ne recommande
 * jamais d'acheter, de vendre ni d'arbitrer — frontière information / conseil rappelée dans
 * docs/proposals/2026-08-26-aide-a-la-decision.md § 1.
 */
import { benchmarkGap, type BenchmarkResult } from './benchmark';
import type { PortfolioReport, PositionReport } from './engine/report';
import { D, ZERO, toDecimalString, type Big, type DecimalString } from './money';
import type { CoinhouseTier, SubscriptionAnalysis } from './subscription';
import type { AssetCode } from './types';
import type { XirrResult } from './xirr';

/**
 * Ton d'un constat. Le SIGNE d'un chiffre (`positive` / `negative`) et un POINT À TRAITER
 * (`attention` : donnée manquante, concentration) sont deux choses différentes — les confondre
 * peindrait tout un portefeuille en baisse en orange et noierait les vrais problèmes de données.
 */
export type InsightTone = 'positive' | 'negative' | 'neutral' | 'attention';

/**
 * Valeur typée d'un constat. Le moteur annonce la NATURE de chaque valeur ; la couche d'affichage
 * décide du format, du masquage (mode discret) et du symbole monétaire.
 */
export type InsightValue =
  | { kind: 'money'; value: DecimalString }
  | { kind: 'ratio'; value: DecimalString }
  | { kind: 'count'; value: number }
  | { kind: 'assets'; value: readonly AssetCode[] }
  | { kind: 'day'; value: string }
  | { kind: 'tier'; value: CoinhouseTier };

export type InsightCode =
  | 'unqualified'
  | 'unpriced'
  | 'subscription-net'
  | 'fees-12m'
  | 'concentration'
  | 'xirr'
  | 'benchmark-gap'
  | 'realized'
  | 'contribution-top'
  | 'contribution-bottom'
  | 'capital-recovered'
  | 'stablecoin-share';

/** Écran vers lequel un constat renvoie ; l'interface le traduit en route (le moteur ignore le routeur). */
export type InsightLink =
  | { route: 'report' }
  | { route: 'portfolio' }
  | { route: 'import' }
  | { route: 'asset'; asset: AssetCode };

export interface Insight {
  /** Identité stable (clé d'affichage, et demain clé de masquage) ; vaut le code tant qu'il est unique. */
  id: string;
  code: InsightCode;
  tone: InsightTone;
  /** Rang d'affichage : plus grand = plus haut ; égalité départagée par `id` (ordre déterministe). */
  priority: number;
  values: Readonly<Record<string, InsightValue>>;
  link: InsightLink | null;
}

/**
 * Entrées du moteur. Tout est optionnel sauf le rapport : une règle privée de sa donnée ne produit
 * rien (l'écran d'accueil n'a pas d'historique de prix chargé, le rapport si).
 */
export interface InsightContext {
  /** Rapport du moteur, DANS LA DEVISE D'AFFICHAGE (l'appelant a déjà converti s'il le fallait). */
  report: PortfolioReport;
  subscription?: SubscriptionAnalysis | null | undefined;
  /** Repère « mêmes apports sur un seul actif », si l'historique de prix est chargé. */
  benchmark?: BenchmarkResult | null | undefined;
  /** Rendement personnel annualisé, calculé par l'appelant sur les flux du rapport. */
  xirr?: XirrResult | null | undefined;
}

/** Sous une unité de la devise affichée (1 € ou 1 $), un montant ne fait pas un constat. */
export const MIN_NOTABLE = D('1');
/** Part d'un actif dans la valeur : signalée à partir de 25 %, mise en avant à partir de 50 %. */
export const CONCENTRATION_NOTE = D('0.25');
export const CONCENTRATION_HIGH = D('0.5');
/** En dessous de 5 %, les stablecoins ne caractérisent pas le portefeuille. */
export const STABLE_SHARE_MIN = D('0.05');

/**
 * Ordre d'affichage, déclaré en UN SEUL endroit : la qualité des données passe avant les chiffres
 * (un total calculé sur des lignes non qualifiées est faux, le dire d'abord).
 */
const PRIORITY: Record<InsightCode, number> = {
  unqualified: 100,
  unpriced: 95,
  'subscription-net': 80,
  'fees-12m': 70,
  concentration: 60,
  xirr: 55,
  'benchmark-gap': 50,
  realized: 45,
  'contribution-top': 40,
  'contribution-bottom': 38,
  'capital-recovered': 35,
  'stablecoin-share': 30,
};

const money = (value: Big): InsightValue => ({ kind: 'money', value: toDecimalString(value) });
const ratio = (value: Big): InsightValue => ({ kind: 'ratio', value: toDecimalString(value) });
const count = (value: number): InsightValue => ({ kind: 'count', value });
const assets = (value: readonly AssetCode[]): InsightValue => ({ kind: 'assets', value });
const day = (value: string): InsightValue => ({ kind: 'day', value });
const tierValue = (value: CoinhouseTier): InsightValue => ({ kind: 'tier', value });

function make(
  code: InsightCode,
  tone: InsightTone,
  values: Record<string, InsightValue>,
  link: InsightLink | null = null,
  id: string = code,
): Insight {
  return { id, code, tone, priority: PRIORITY[code], values, link };
}

/** Notable = strictement au-dessus du seuil en valeur absolue (un centime n'est pas un constat). */
const notable = (value: Big): boolean => value.abs().gte(MIN_NOTABLE);

const sumValues = (items: readonly PositionReport[]): Big =>
  items.reduce((acc, p) => acc.plus(p.value ?? ZERO), ZERO);

/** Une règle est pure et peut n'émettre aucun constat, ou plusieurs. */
type InsightRule = (ctx: InsightContext) => Insight[];

/** Lignes que le moteur n'a pas su interpréter : les totaux sont incomplets tant qu'elles restent. */
const unqualifiedRule: InsightRule = (ctx) => {
  const n = ctx.report.unqualified.length;
  if (n === 0) return [];
  return [make('unqualified', 'attention', { count: count(n) }, { route: 'import' })];
};

/** Actifs détenus sans cours connu : leur valeur et leur latent manquent aux totaux. */
const unpricedRule: InsightRule = (ctx) => {
  const list = ctx.report.totals.unpricedAssets;
  if (list.length === 0) return [];
  return [
    make(
      'unpriced',
      'attention',
      { count: count(list.length), assets: assets(list.slice(0, 3)) },
      { route: 'portfolio' },
    ),
  ];
};

/** Rentabilité réalisée de l'offre Coinhouse sur 12 mois glissants (remises − abonnements). */
const subscriptionRule: InsightRule = (ctx) => {
  const s = ctx.subscription;
  if (!s || s.detectedTier === 'classique' || s.netOfSubscription12m === null) return [];
  const net = D(s.netOfSubscription12m);
  return [
    make(
      'subscription-net',
      net.gte(ZERO) ? 'positive' : 'negative',
      { amount: money(net), tier: tierValue(s.detectedTier), rebates: money(D(s.rebates12m)) },
      { route: 'report' },
    ),
  ];
};

/** Frais d'opérations réellement payés sur 12 mois, et ce qu'ils pèsent sur le volume échangé. */
const feesRule: InsightRule = (ctx) => {
  const s = ctx.subscription;
  if (!s || s.tradeCount === 0) return [];
  const fees = D(s.feesNet12m);
  if (!notable(fees)) return [];
  const volume = D(s.volume12m);
  const values: Record<string, InsightValue> = { amount: money(fees) };
  if (volume.gt(ZERO)) values['rate'] = ratio(fees.div(volume));
  return [make('fees-12m', 'neutral', values, { route: 'report' })];
};

/** Poids du premier actif dans la valeur des positions cotées. */
const concentrationRule: InsightRule = (ctx) => {
  const top = ctx.report.allocation.reduce<(typeof ctx.report.allocation)[number] | null>(
    (best, entry) => (best === null || entry.share.gt(best.share) ? entry : best),
    null,
  );
  if (top === null || top.share.lt(CONCENTRATION_NOTE)) return [];
  return [
    make(
      'concentration',
      top.share.gte(CONCENTRATION_HIGH) ? 'attention' : 'neutral',
      { assets: assets([top.asset]), share: ratio(top.share), amount: money(top.value) },
      { route: 'asset', asset: top.asset },
    ),
  ];
};

/** Rendement personnel annualisé (XIRR) : ce que vos versements ont réellement rapporté. */
const xirrRule: InsightRule = (ctx) => {
  const result = ctx.xirr;
  if (!result || !result.ok) return [];
  return [
    make(
      'xirr',
      result.rate.gt(ZERO) ? 'positive' : 'negative',
      { rate: ratio(result.rate), since: day(result.since) },
      { route: 'report' },
    ),
  ];
};

/** Écart avec le repère « mêmes apports, un seul actif » : un fait, jamais une suggestion d'arbitrage. */
const benchmarkRule: InsightRule = (ctx) => {
  const benchmark = ctx.benchmark;
  const value = ctx.report.totals.value;
  if (!benchmark || value === null) return [];
  const gap = benchmarkGap(value, benchmark);
  if (!notable(gap)) return [];
  return [
    make(
      'benchmark-gap',
      gap.gt(ZERO) ? 'positive' : 'negative',
      { amount: money(gap), assets: assets([benchmark.asset]), since: day(benchmark.since) },
      { route: 'report' },
    ),
  ];
};

/** Plus-values déjà encaissées depuis le début (réalisé), toutes ventes confondues. */
const realizedRule: InsightRule = (ctx) => {
  const realized = ctx.report.totals.realized;
  if (!notable(realized)) return [];
  return [
    make(
      'realized',
      realized.gt(ZERO) ? 'positive' : 'negative',
      { amount: money(realized) },
      { route: 'report' },
    ),
  ];
};

/** Actifs qui pèsent le plus — en bien et en mal — dans le résultat total. */
const contributionRule: InsightRule = (ctx) => {
  const scored = ctx.report.positions
    .filter((p): p is PositionReport & { total: Big } => p.total !== null)
    .sort((a, b) => b.total.cmp(a.total));
  if (scored.length < 2) return [];
  const out: Insight[] = [];
  const best = scored[0];
  const worst = scored[scored.length - 1];
  if (best && best.total.gt(ZERO) && notable(best.total))
    out.push(
      make(
        'contribution-top',
        'positive',
        { assets: assets([best.asset]), amount: money(best.total) },
        { route: 'asset', asset: best.asset },
      ),
    );
  if (worst && worst.total.lt(ZERO) && notable(worst.total))
    out.push(
      make(
        'contribution-bottom',
        'negative',
        { assets: assets([worst.asset]), amount: money(worst.total) },
        { route: 'asset', asset: worst.asset },
      ),
    );
  return out;
};

/** Positions dont les ventes ont déjà rendu la mise de départ (le reste tourne « à capital rendu »). */
const capitalRecoveredRule: InsightRule = (ctx) => {
  const recovered = ctx.report.positions
    .filter((p) => p.capitalRecovered && p.qty.gt(ZERO))
    .sort((a, b) => (b.value ?? ZERO).cmp(a.value ?? ZERO));
  if (recovered.length === 0) return [];
  return [
    make(
      'capital-recovered',
      'positive',
      {
        count: count(recovered.length),
        assets: assets(recovered.slice(0, 2).map((p) => p.asset)),
      },
      { route: 'portfolio' },
    ),
  ];
};

/** Part des stablecoins dans la valeur : la trésorerie qui ne suit pas le marché. */
const stablecoinRule: InsightRule = (ctx) => {
  const total = ctx.report.totals.value;
  if (total === null || !total.gt(ZERO)) return [];
  const stable = sumValues(ctx.report.stablecoins);
  if (!stable.gt(ZERO)) return [];
  const share = stable.div(total);
  if (share.lt(STABLE_SHARE_MIN)) return [];
  return [
    make(
      'stablecoin-share',
      'neutral',
      { share: ratio(share), amount: money(stable) },
      { route: 'portfolio' },
    ),
  ];
};

/**
 * Registre des règles : ajouter un constat = ajouter une règle ici, son code dans `InsightCode`,
 * son rang dans `PRIORITY` et sa phrase dans `src/lib/format/insights.ts` (le compilateur exige
 * les trois — voir le contrôle d'exhaustivité du rendu).
 */
const RULES: readonly InsightRule[] = [
  unqualifiedRule,
  unpricedRule,
  subscriptionRule,
  feesRule,
  concentrationRule,
  xirrRule,
  benchmarkRule,
  realizedRule,
  contributionRule,
  capitalRecoveredRule,
  stablecoinRule,
];

/** Tous les constats disponibles, du plus important au moins important (ordre déterministe). */
export function buildInsights(ctx: InsightContext): Insight[] {
  return RULES.flatMap((rule) => rule(ctx)).sort(
    (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
