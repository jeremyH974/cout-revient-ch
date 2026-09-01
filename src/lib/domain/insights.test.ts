import { describe, expect, it } from 'vitest';
import type { BenchmarkResult } from './benchmark';
import { computePortfolio, type PortfolioReport, type PriceQuoteInput } from './engine';
import { buildInsights, type Insight, type InsightCode, type InsightContext } from './insights';
import { D } from './money';
import { riskMetrics } from './risk';
import type { TaxLedger, TaxYear } from './tax-fr';
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

  it('signale le poids cumulé des trois premiers actifs, à partir de quatre lignes', () => {
    // 45 / 30 / 15 / 10 % : les trois premiers pèsent 90 %.
    const report = compute(
      [
        buy('2026-01-01T10:00:00', 'btc', '1', '10000'),
        buy('2026-01-02T10:00:00', 'eth', '10', '10000'),
        buy('2026-01-03T10:00:00', 'sol', '100', '10000'),
        buy('2026-01-04T10:00:00', 'ada', '1000', '10000'),
      ],
      {
        btc: price('btc', '45000'),
        eth: price('eth', '3000'),
        sol: price('sol', '150'),
        ada: price('ada', '10'),
      },
    );
    const top3 = find(buildInsights({ report }), 'top3-share');
    expect(raw(top3, 'share')).toBe('0.9');
    expect(raw(top3, 'assets')).toBe('btc,eth,sol');
  });

  it('reprend le repli maximal fourni, et hausse le ton au-delà de 30 %', () => {
    const report = compute([buy('2026-01-01T10:00:00', 'btc', '1', '40000')], {
      btc: price('btc', '50000'),
    });
    const risk = riskMetrics(
      ['1', '1.5', '0.9', '1.2'].map((value, i) => ({
        day: `2026-01-0${i + 1}`,
        index: D(value),
      })),
    );
    const drawdown = find(buildInsights({ report, risk }), 'max-drawdown');
    // 1,5 → 0,9 : −40 %, jamais recomblé (le dernier point est à 1,2).
    expect(raw(drawdown, 'share')).toBe('0.4');
    expect(raw(drawdown, 'from')).toBe('2026-01-02');
    expect(raw(drawdown, 'to')).toBe('2026-01-03');
    expect(drawdown?.values['recovered']).toBeUndefined();
    expect(drawdown?.tone).toBe('attention');

    // Sans mesure de risque (accueil : pas d’historique chargé), rien à dire.
    expect(find(buildInsights({ report }), 'max-drawdown')).toBeUndefined();
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

/**
 * Le constat de fin d'année (décision n° 86).
 *
 * Il énonce deux faits de droit datés, et refuse d'en énoncer un troisième qui n'existe pas en
 * France : la compensation de moins-values PAR ACTIF. La suite vérifie les deux premiers, les
 * bornes de date qui les rendent pertinents, et le silence quand rien n'est vrai.
 */
describe('fin d’année fiscale', () => {
  const year = (over: Partial<TaxYear> = {}): TaxYear => ({
    year: 2026,
    proceedsEur: '12000',
    cessionCount: 4,
    gainsEur: '1000',
    lossesEur: '2800',
    netEur: '-1800',
    exempt: false,
    rate: '0.314',
    rateLabel: '31,4 %',
    taxEur: '0',
    unknownGlobalValue: 0,
    ...over,
  });
  const ledger = (y: TaxYear): TaxLedger => ({
    cessions: [],
    years: [y],
    ptaAfter: '0',
    unknownGlobalValue: 0,
    externalInflows: 0,
    externalOutflows: 0,
    rewards: 0,
  });
  const at = (today: string, y: TaxYear = year()) =>
    find(
      buildInsights({ report: compute([]), tax: ledger(y), taxYear: 2026, today }),
      'tax-year-end',
    );

  it('année perdante : le déficit est chiffré, et l’échéance nommée', () => {
    const insight = at('2026-11-15');
    expect(raw(insight, 'deficit'), 'la moins-value nette, en positif').toBe('1800');
    expect(raw(insight, 'deadline')).toBe('2026-12-31');
    expect(insight?.tone, 'un constat, pas une incitation à agir avant l’échéance').toBe('neutral');
  });

  it('sous le seuil : la marge restante avant la falaise des 305 €', () => {
    const insight = at('2026-11-15', year({ proceedsEur: '200', netEur: '50', exempt: true }));
    expect(raw(insight, 'headroom'), '305 − 200').toBe('105');
    expect(raw(insight, 'deficit'), 'une année gagnante n’a pas de déficit').toBeUndefined();
  });

  it('avant octobre, le 31 décembre n’est pas une échéance : rien n’est dit', () => {
    expect(at('2026-09-30')).toBeUndefined();
    expect(at('2026-10-01'), 'le 1er octobre, si').toBeDefined();
  });

  it('une année révolue ne reçoit aucun constat daté', () => {
    expect(at('2027-11-15')).toBeUndefined();
  });

  it('sans horloge, le moteur ne devine pas quel jour on est', () => {
    expect(
      find(
        buildInsights({ report: compute([]), tax: ledger(year()), taxYear: 2026 }),
        'tax-year-end',
      ),
    ).toBeUndefined();
  });

  it('aucune cession dans l’année : rien à constater', () => {
    expect(at('2026-11-15', year({ cessionCount: 0 }))).toBeUndefined();
  });

  it('année gagnante au-dessus du seuil : `tax-year` dit déjà l’essentiel, pas de doublon', () => {
    expect(at('2026-11-15', year({ netEur: '3000', taxEur: '942' }))).toBeUndefined();
  });
});
