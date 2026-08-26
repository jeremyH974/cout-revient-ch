import { describe, expect, it } from 'vitest';
import type { BenchmarkResult } from './benchmark';
import { computePortfolio, type PortfolioReport, type PriceQuoteInput } from './engine';
import { buildInsights, type Insight, type InsightCode, type InsightContext } from './insights';
import { D } from './money';
import type { SubscriptionAnalysis } from './subscription';
import {
  DEFAULT_ENGINE_SETTINGS,
  type LedgerEvent,
  type TradeEvent,
  type UnqualifiedEvent,
} from './types';
import type { XirrResult } from './xirr';

let seq = 0;
const base = () => ({
  id: `e${++seq}`,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main' as const,
  rowKeys: [],
  warnings: [],
});
const buy = (at: string, asset: string, qty: string, eur: string): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset: 'eur', qty: eur },
  in: { asset, qty },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const sell = (at: string, asset: string, qty: string, eur: string): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset, qty },
  in: { asset: 'eur', qty: eur },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const unknown = (at: string): UnqualifiedEvent => ({
  ...base(),
  kind: 'unqualified',
  at,
  rawType: 'Récompense inconnue',
  legs: [],
  reason: 'type inconnu',
});
const price = (asset: string, eur: string): PriceQuoteInput => ({
  asset,
  priceEur: eur,
  at: '2026-08-25T10:00:00Z',
  source: 'test',
  stale: false,
});
const compute = (
  events: LedgerEvent[],
  prices: Record<string, PriceQuoteInput> = {},
): PortfolioReport => computePortfolio({ events, prices, settings: DEFAULT_ENGINE_SETTINGS });

const codesOf = (list: readonly Insight[]): InsightCode[] => list.map((i) => i.code);
const find = (list: readonly Insight[], code: InsightCode): Insight | undefined =>
  list.find((i) => i.code === code);
/** Valeur d'un constat, sous forme de chaîne décimale : le moteur ne formate jamais. */
const raw = (insight: Insight | undefined, key: string): string | number | undefined => {
  const value = insight?.values[key];
  if (value === undefined) return undefined;
  return value.kind === 'assets' ? value.value.join(',') : value.value;
};

/** Analyse d'abonnement type, surchargeable champ par champ. */
function subscription(over: Partial<SubscriptionAnalysis> = {}): SubscriptionAnalysis {
  return {
    tradeCount: 10,
    detectedTier: 'investisseur',
    detectionNote: '2 lignes d’abonnement facturées dans l’export',
    subscriptionCount: 2,
    subscriptionsTotal: '237.6',
    subscriptions12m: '118.8',
    feesGross: '1000',
    rebates: '312.42',
    rebates12m: '278.77',
    feesNet: '687.58',
    feesNet12m: '400',
    classiqueFees: '1200',
    savedVsClassique: '512.42',
    netOfSubscription: '74.82',
    netOfSubscription12m: '159.97',
    volume: '200000',
    volume12m: '100000',
    breakEvenAnnualVolume: null,
    windowStart: '2025-08-25T00:00:00',
    ...over,
  };
}

const okXirr: XirrResult = {
  ok: true,
  rate: D('0.184'),
  since: '2024-03-12',
  until: '2026-08-25',
  flowCount: 4,
};

function benchmark(valueEur: string): BenchmarkResult {
  return {
    asset: 'btc',
    qty: D('1'),
    valueEur: D(valueEur),
    investedEur: D('10000'),
    withdrawnEur: D('0'),
    clampedEur: D('0'),
    skippedFlows: 0,
    since: '2024-03-12',
    until: '2026-08-25',
    series: [],
    twr: { ok: false, reason: 'insufficient-series' },
    xirr: { ok: false, reason: 'insufficient-flows' },
  };
}

describe('buildInsights', () => {
  it('ne dit rien d’un portefeuille vide', () => {
    expect(buildInsights({ report: compute([]) })).toEqual([]);
  });

  it('signale d’abord la qualité des données : lignes à qualifier, puis actifs sans cours', () => {
    const report = compute([
      buy('2026-01-01T10:00:00', 'btc', '1', '50000'),
      unknown('2026-02-01T10:00:00'),
    ]);
    const list = buildInsights({ report });
    // Un total calculé sur des lignes non interprétées est faux : ce constat passe avant tout.
    expect(codesOf(list)[0]).toBe('unqualified');
    expect(raw(find(list, 'unqualified'), 'count')).toBe(1);
    // Sans prix, l'actif détenu n'a ni valeur ni latent.
    expect(raw(find(list, 'unpriced'), 'assets')).toBe('btc');
  });

  it('mesure la concentration sur la valeur cotée et hausse le ton au-delà de 50 %', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '1', '50000'),
      buy('2026-01-02T10:00:00', 'eth', '10', '20000'),
    ];
    const prices = { btc: price('btc', '60000'), eth: price('eth', '2000') };
    const list = buildInsights({ report: compute(events, prices) });
    const concentration = find(list, 'concentration');
    // 60 000 / (60 000 + 20 000) = 0,75.
    expect(raw(concentration, 'share')).toBe('0.75');
    expect(raw(concentration, 'assets')).toBe('btc');
    expect(concentration?.tone).toBe('attention');
    expect(concentration?.link).toEqual({ route: 'asset', asset: 'btc' });
  });

  it('reste neutre sur une concentration modérée et se tait sous 25 %', () => {
    // Trois actifs : 40 000 / 35 000 / 25 000 → le premier pèse 40 %, sous le seuil de mise en avant.
    const moderate = compute(
      [
        buy('2026-01-01T10:00:00', 'btc', '1', '30000'),
        buy('2026-01-02T10:00:00', 'eth', '10', '30000'),
        buy('2026-01-03T10:00:00', 'sol', '100', '20000'),
      ],
      { btc: price('btc', '40000'), eth: price('eth', '3500'), sol: price('sol', '250') },
    );
    const top = find(buildInsights({ report: moderate }), 'concentration');
    expect(top?.tone).toBe('neutral');
    expect(raw(top, 'share')).toBe('0.4');

    // Cinq actifs à 20 % chacun : aucun ne caractérise le portefeuille.
    const flat = compute(
      ['btc', 'eth', 'sol', 'ada', 'dot'].map((asset, i) =>
        buy(`2026-01-0${i + 1}T10:00:00`, asset, '100', '15000'),
      ),
      Object.fromEntries(
        ['btc', 'eth', 'sol', 'ada', 'dot'].map((asset) => [asset, price(asset, '200')]),
      ),
    );
    expect(find(buildInsights({ report: flat }), 'concentration')).toBeUndefined();
  });

  it('rapporte les contributeurs extrêmes, jamais sur une position unique', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '1', '40000'),
      buy('2026-01-02T10:00:00', 'eth', '10', '30000'),
    ];
    const prices = { btc: price('btc', '50000'), eth: price('eth', '2000') };
    const list = buildInsights({ report: compute(events, prices) });
    expect(raw(find(list, 'contribution-top'), 'assets')).toBe('btc');
    expect(raw(find(list, 'contribution-top'), 'amount')).toBe('10000');
    expect(raw(find(list, 'contribution-bottom'), 'assets')).toBe('eth');
    expect(raw(find(list, 'contribution-bottom'), 'amount')).toBe('-10000');

    const alone = compute([buy('2026-01-01T10:00:00', 'btc', '1', '40000')], {
      btc: price('btc', '50000'),
    });
    expect(find(buildInsights({ report: alone }), 'contribution-top')).toBeUndefined();
  });

  it('constate le réalisé, la mise récupérée et la part des stablecoins', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '1', '40000'),
      sell('2026-02-01T10:00:00', 'btc', '0.5', '45000'),
      buy('2026-03-01T10:00:00', 'usdc', '10000', '10000'),
    ];
    const prices = { btc: price('btc', '90000'), usdc: price('usdc', '1') };
    const list = buildInsights({ report: compute(events, prices) });
    // Réalisé = 45 000 − 20 000 (moitié du coût) = 25 000 ; la mise de 40 000 est déjà rendue.
    expect(raw(find(list, 'realized'), 'amount')).toBe('25000');
    expect(find(list, 'realized')?.tone).toBe('positive');
    expect(raw(find(list, 'capital-recovered'), 'count')).toBe(1);
    // 10 000 / (45 000 + 10 000) = 18,18… %.
    expect(raw(find(list, 'stablecoin-share'), 'amount')).toBe('10000');
    expect(find(list, 'stablecoin-share')?.tone).toBe('neutral');
  });

  it('reprend l’analyse d’abonnement : rentabilité nette et poids des frais', () => {
    const report = compute([buy('2026-01-01T10:00:00', 'btc', '1', '50000')]);
    const list = buildInsights({ report, subscription: subscription() });
    const net = find(list, 'subscription-net');
    expect(net?.tone).toBe('positive');
    expect(raw(net, 'amount')).toBe('159.97');
    expect(raw(net, 'tier')).toBe('investisseur');
    // 400 / 100 000 = 0,4 % du volume échangé.
    expect(raw(find(list, 'fees-12m'), 'rate')).toBe('0.004');

    const losing = buildInsights({
      report,
      subscription: subscription({ netOfSubscription12m: '-40' }),
    });
    // Une offre non rentabilisée est un chiffre défavorable, pas un problème de données à traiter.
    expect(find(losing, 'subscription-net')?.tone).toBe('negative');
    // Sans abonnement facturé, il n'y a pas de rentabilité d'offre à constater.
    const classique = buildInsights({
      report,
      subscription: subscription({ detectedTier: 'classique', netOfSubscription12m: null }),
    });
    expect(find(classique, 'subscription-net')).toBeUndefined();
  });

  it('n’émet rendement et repère que si l’appelant les a calculés', () => {
    const report = compute([buy('2026-01-01T10:00:00', 'btc', '1', '40000')], {
      btc: price('btc', '50000'),
    });
    const bare = buildInsights({ report });
    expect(find(bare, 'xirr')).toBeUndefined();
    expect(find(bare, 'benchmark-gap')).toBeUndefined();

    const full = buildInsights({ report, xirr: okXirr, benchmark: benchmark('45000') });
    expect(raw(find(full, 'xirr'), 'rate')).toBe('0.184');
    // 50 000 − 45 000 : le portefeuille devance son repère.
    expect(raw(find(full, 'benchmark-gap'), 'amount')).toBe('5000');
    expect(find(full, 'benchmark-gap')?.tone).toBe('positive');

    const behind = buildInsights({ report, benchmark: benchmark('60000') });
    expect(find(behind, 'benchmark-gap')?.tone).toBe('negative');
    // Un XIRR qui n'a pas convergé ne produit pas de constat vide.
    const failed = buildInsights({ report, xirr: { ok: false, reason: 'no-convergence' } });
    expect(find(failed, 'xirr')).toBeUndefined();
  });

  it('ordonne par priorité décroissante, à égalité par identifiant (ordre déterministe)', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '1', '40000'),
      buy('2026-01-02T10:00:00', 'eth', '10', '30000'),
      sell('2026-02-01T10:00:00', 'btc', '0.5', '45000'),
      unknown('2026-02-02T10:00:00'),
    ];
    const prices = { btc: price('btc', '50000'), eth: price('eth', '2000') };
    const ctx: InsightContext = {
      report: compute(events, prices),
      subscription: subscription(),
      xirr: okXirr,
      benchmark: benchmark('45000'),
    };
    const list = buildInsights(ctx);
    const priorities = list.map((i) => i.priority);
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
    // Deux exécutions sur les mêmes entrées donnent exactement la même liste.
    expect(buildInsights(ctx)).toEqual(list);
    // Les identifiants sont uniques : ils servent de clé d'affichage.
    expect(new Set(list.map((i) => i.id)).size).toBe(list.length);
  });

  it('ignore les montants négligeables (moins d’une unité de la devise affichée)', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '1', '40000'),
      sell('2026-02-01T10:00:00', 'btc', '0.5', '20000.4'),
    ];
    // Réalisé = 0,40 € : vrai, mais sans intérêt à afficher comme constat.
    const list = buildInsights({ report: compute(events, { btc: price('btc', '40000') }) });
    expect(find(list, 'realized')).toBeUndefined();
  });
});
