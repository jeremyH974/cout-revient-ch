import { describe, expect, it } from 'vitest';
import { D, toDecimalString } from '../money';
import {
  DEFAULT_ENGINE_SETTINGS,
  type EngineSettings,
  type LedgerEvent,
  type TradeEvent,
} from '../types';
import { computePortfolio } from './aggregate';
import type { PriceQuoteInput } from './report';

let seq = 0;
const base = () => ({
  id: `t${++seq}`,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  rowKeys: [],
  warnings: [],
});
const buy = (at: string, asset: string, qty: string, eur: string, pay = 'eur'): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset: pay, qty: pay === 'eur' ? eur : eur },
  in: { asset, qty },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const sell = (
  at: string,
  asset: string,
  qty: string,
  eur: string,
  receive = 'eur',
): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset, qty },
  in: { asset: receive, qty: eur },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const price = (asset: string, eur: string): PriceQuoteInput => ({
  asset,
  priceEur: eur,
  at: '2026-08-22T10:00:00Z',
  source: 'test',
  stale: false,
});
const s = (b: { toString(): string } | null | undefined): string | null =>
  b == null ? null : toDecimalString(D(b.toString()));
const run = (
  events: LedgerEvent[],
  prices: PriceQuoteInput[],
  settings: EngineSettings = DEFAULT_ENGINE_SETTINGS,
) =>
  computePortfolio({
    events,
    prices: Object.fromEntries(prices.map((p) => [p.asset, p])),
    settings,
  });

describe('moteur — exemple canonique', () => {
  // Achats 1@100, 1@200 ; vente 1@300 ; achat 1@150 ; cours 250.
  const events = [
    buy('2026-01-01T10:00:00', 'x', '1', '100'),
    buy('2026-01-02T10:00:00', 'x', '1', '200'),
    sell('2026-01-03T10:00:00', 'x', '1', '300'),
    buy('2026-01-04T10:00:00', 'x', '1', '150'),
  ];
  const report = run(events, [price('x', '250')]);
  const x = report.positions[0]!;

  it('PRU 150, réalisé +150, latent +200, total +350, net investi 150', () => {
    expect(s(x.pru)).toBe('150');
    expect(s(x.realized)).toBe('150');
    expect(s(x.unrealized)).toBe('200');
    expect(s(x.total)).toBe('350');
    expect(s(x.netInvested)).toBe('150');
    // ROI sur le capital maximal engagé : 100 + 200 = 300 € mobilisés au plus (après la vente, 150).
    expect(s(x.roiBase)).toBe('300');
    expect(s(x.roi)).toBe(s(D('350').div('300')));
    expect(s(x.unrealizedPct)).toBe(s(D('200').div('300')));
  });

  it('les lots au prorata se réconcilient avec le PRU', () => {
    expect(x.lots).toHaveLength(3);
    const lotsUnrealized = x.lots.reduce((acc, l) => acc.plus(l.unrealized!), D('0'));
    expect(s(lotsUnrealized)).toBe('200');
    expect(s(x.lots[0]!.qtyRemaining)).toBe('0.5');
    expect(s(x.lots[0]!.unitCost)).toBe('100');
  });

  it("l'historique donne le PRU après chaque ligne et le réalisé par vente", () => {
    const chrono = [...x.history].reverse();
    expect(chrono.map((h) => s(h.pruAfter))).toEqual(['100', '150', '150', '150']);
    expect(s(chrono[2]!.realized)).toBe('150');
    expect(s(chrono[2]!.qtyAfter)).toBe('1');
  });

  it('invariant : total = valeur + Σ produits − Σ achats', () => {
    expect(s(x.value!.plus(x.proceedsTotal).minus(x.investedTotal))).toBe('350');
    expect(s(report.totals.total)).toBe('350');
    expect(s(report.totals.netCash)).toBe('150');
  });
});

describe('moteur — cas particuliers', () => {
  it('bloque une vente supérieure au solde, tolère un résidu', () => {
    const blocked = run(
      [buy('2026-01-01T10:00:00', 'a', '1', '100'), sell('2026-01-02T10:00:00', 'a', '2', '300')],
      [price('a', '100')],
    );
    expect(blocked.blocked.map((p) => p.asset)).toEqual(['a']);
    expect(blocked.positions).toEqual([]);
    const ok = run(
      [
        buy('2026-01-01T10:00:00', 'b', '7.999999667', '100'),
        sell('2026-01-02T10:00:00', 'b', '8', '120'),
      ],
      [],
    );
    expect(ok.closed[0]?.asset).toBe('b');
    expect(s(ok.closed[0]?.realized)).toBe('20');
  });

  it('stablecoin : achat via USDC = cession USDC + acquisition crypto à la valeur EUR', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'usdc', '1000', '900'),
      buy('2026-01-02T10:00:00', 'btc', '0.01', '425', 'usdc'),
    ];
    (events[1] as TradeEvent).out = { asset: 'usdc', qty: '500' };
    const report = run(events, [price('btc', '90000'), price('usdc', '0.88')]);
    expect(report.stablecoins[0]?.asset).toBe('usdc');
    expect(report.positions[0]?.asset).toBe('btc');
    expect(s(report.positions[0]?.pru)).toBe('42500');
    expect(s(report.stablecoins[0]?.realized)).toBe('-25'); // 425 − 450 : effet de change
    expect(s(report.stablecoins[0]?.unrealized)).toBe('-10'); // 500 × 0,88 − 450
    expect(s(report.totals.netCash)).toBe('900');
    expect(s(report.totals.total)).toBe('440'); // latent btc +475, latent usdc −10, réalisé usdc −25
    const t = report.totals;
    expect(s(t.value.plus(t.proceedsTotal).minus(t.investedTotal))).toBe('440');
  });

  it('migration : coût reporté par défaut, réalisation en option', () => {
    const events: LedgerEvent[] = [
      buy('2026-01-01T10:00:00', 'mkr', '1', '1700'),
      {
        ...base(),
        kind: 'migration',
        at: '2026-02-01T10:00:00',
        out: { asset: 'mkr', qty: '1' },
        in: { asset: 'sky', qty: '24000' },
        fairValueOutEur: '1489',
        fairValueInEur: '1356',
      },
    ];
    const carry = run(events, [price('sky', '0.06')]);
    expect(carry.closed.find((p) => p.asset === 'mkr')?.realized.toString()).toBe('0');
    expect(s(carry.positions[0]?.costBasis)).toBe('1700');
    expect(s(carry.positions[0]?.unrealized)).toBe('-260');
    const realize = run(events, [price('sky', '0.06')], {
      ...DEFAULT_ENGINE_SETTINGS,
      migrationMode: 'realize',
    });
    expect(s(realize.closed.find((p) => p.asset === 'mkr')?.realized)).toBe('-211');
    expect(s(realize.positions[0]?.costBasis)).toBe('1489');
    expect(s(realize.totals.total)).toBe(s(carry.totals.total));
  });

  it('récompense : coût 0, hors dénominateur du ROI', () => {
    const events: LedgerEvent[] = [
      buy('2026-01-01T10:00:00', 'eth', '1', '2000'),
      {
        ...base(),
        kind: 'reward',
        at: '2026-01-02T10:00:00',
        in: { asset: 'eth', qty: '0.1' },
        fairValueEur: '250',
      },
    ];
    const report = run(events, [price('eth', '2500')]);
    const eth = report.positions[0]!;
    expect(s(eth.qty)).toBe('1.1');
    expect(s(eth.pru)).toBe(s(D('2000').div('1.1')));
    expect(s(eth.investedTotal)).toBe('2000');
    expect(s(eth.total)).toBe('750');
    expect(s(eth.roi)).toBe('0.375');
  });
});

describe('moteur — correctifs de revue', () => {
  it('une position « poussière » garde son latent dans le total global', () => {
    const report = run(
      [buy('2026-01-01T10:00:00', 'meme', '1000000', '100')],
      [price('meme', '0.000000001')],
    );
    expect(report.closed[0]?.asset).toBe('meme');
    expect(report.closed[0]?.dust).toBe(true);
    expect(s(report.totals.total)).toBe('-99.999');
    const t = report.totals;
    expect(s(t.value.plus(t.proceedsTotal).minus(t.investedTotal))).toBe('-99.999');
  });

  it('un actif bloqué dès sa première opération reste visible', () => {
    const report = run(
      [sell('2026-01-02T10:00:00', 'btc', '0.1', '6000')],
      [price('btc', '60000')],
    );
    expect(report.blocked.map((p) => p.asset)).toEqual(['btc']);
    expect(report.blocked[0]?.history).toHaveLength(1);
    expect(report.warnings[0]).toMatch(/Historique d'achat manquant/);
  });

  it('les frais sont attribués à la jambe crypto, une seule fois', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'usdc', '1000', '900'),
      buy('2026-01-02T10:00:00', 'btc', '0.01', '425', 'usdc'),
    ];
    (events[1] as TradeEvent).out = { asset: 'usdc', qty: '500' };
    (events[1] as TradeEvent).fee = {
      asset: 'usdc',
      gross: '5',
      rebate: '0',
      grossEur: '4.25',
      rebateEur: '0',
    };
    const report = run(events, [price('btc', '90000'), price('usdc', '0.88')]);
    expect(s(report.positions[0]?.feesEur)).toBe('4.25');
    expect(s(report.stablecoins[0]?.feesEur)).toBe('0');
    expect(s(report.totals.feesEur)).toBe('4.25');
  });

  it('le contrôle de solde ignore les saisies hors Coinhouse', () => {
    const events: LedgerEvent[] = [
      buy('2026-01-01T10:00:00', 'btc', '1', '50000'),
      {
        ...base(),
        kind: 'deposit',
        at: '2026-01-02T10:00:00',
        scope: 'external',
        in: { asset: 'btc', qty: '0.5' },
        costEur: '20000',
      },
    ];
    const report = computePortfolio({
      events,
      prices: { btc: price('btc', '60000') },
      settings: DEFAULT_ENGINE_SETTINGS,
      balances: [
        { rowKey: 'r1', asset: 'btc', signedQty: '1', balance: '1', at: '2026-01-01T10:00:00' },
      ],
    });
    expect(s(report.positions[0]?.qty)).toBe('1.5');
    expect(report.positions[0]?.integrity?.status).toBe('ok');
  });
});
