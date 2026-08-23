/** Cas issus de la revue indépendante du moteur (23/08/2026). */
import { describe, expect, it } from 'vitest';
import { D, toDecimalString } from '../money';
import {
  DEFAULT_ENGINE_SETTINGS,
  type LedgerEvent,
  type MigrationEvent,
  type TradeEvent,
  type UnqualifiedEvent,
} from '../types';
import { computePortfolio } from './aggregate';
import type { PriceQuoteInput } from './report';

let seq = 0;
const base = (at: string, id?: string) => ({
  id: id ?? `r${++seq}`,
  at,
  source: 'coinhouse-csv' as const,
  scope: 'coinhouse' as const,
  rowKeys: [],
  warnings: [],
});
const trade = (
  at: string,
  out: { asset: string; qty: string },
  inn: { asset: string; qty: string },
  valueEur: string,
  id?: string,
): TradeEvent => ({
  ...base(at, id),
  kind: 'trade',
  out,
  in: inn,
  valueEur,
  valueEurSource: 'counter-leg',
  fee: null,
  quotePrice: null,
});
const price = (asset: string, eur: string): PriceQuoteInput => ({
  asset,
  priceEur: eur,
  at: '2026-08-23T10:00:00Z',
  source: 'test',
  stale: false,
});
const s = (b: { toString(): string } | null | undefined): string | null =>
  b == null ? null : toDecimalString(D(b.toString()));
const run = (events: LedgerEvent[], prices: PriceQuoteInput[] = []) =>
  computePortfolio({
    events,
    prices: Object.fromEntries(prices.map((p) => [p.asset, p])),
    settings: DEFAULT_ENGINE_SETTINGS,
  });

describe('ROI rapporté au capital maximal engagé', () => {
  it('un euro qui transite par l’USDC n’est compté qu’une fois', () => {
    // 900 € → 1 000 USDC → 0,01 BTC ; BTC vaut ensuite 990 €, USDC épuisé.
    const report = run(
      [
        trade(
          '2026-01-01T10:00:00',
          { asset: 'eur', qty: '900' },
          { asset: 'usdc', qty: '1000' },
          '900',
        ),
        trade(
          '2026-01-02T10:00:00',
          { asset: 'usdc', qty: '1000' },
          { asset: 'btc', qty: '0.01' },
          '900',
        ),
      ],
      [price('btc', '99000'), price('usdc', '0.9')],
    );
    expect(s(report.totals.total)).toBe('90');
    expect(s(report.totals.roiBase)).toBe('900');
    expect(s(report.totals.roi)).toBe('0.1');
    const btc = report.positions.find((p) => p.asset === 'btc')!;
    expect(s(btc.roiBase)).toBe('900');
    expect(s(btc.roi)).toBe('0.1');
  });

  it('vendre puis racheter ne gonfle pas la base', () => {
    const report = run(
      [
        trade(
          '2026-01-01T10:00:00',
          { asset: 'eur', qty: '1000' },
          { asset: 'x', qty: '1' },
          '1000',
        ),
        trade(
          '2026-01-02T10:00:00',
          { asset: 'x', qty: '1' },
          { asset: 'eur', qty: '1100' },
          '1100',
        ),
        trade(
          '2026-01-03T10:00:00',
          { asset: 'eur', qty: '1100' },
          { asset: 'x', qty: '1' },
          '1100',
        ),
      ],
      [price('x', '1100')],
    );
    const x = report.positions[0]!;
    expect(s(x.total)).toBe('100');
    expect(s(x.roiBase)).toBe('1000');
    expect(s(x.roi)).toBe('0.1');
    expect(s(report.totals.roiBase)).toBe('1000');
  });
});

describe('ordre à horodatage égal', () => {
  it('EUR → USDC puis USDC → BTC à la même seconde, quel que soit l’identifiant', () => {
    const report = run(
      [
        trade(
          '2026-01-01T10:00:00',
          { asset: 'usdc', qty: '1000' },
          { asset: 'btc', qty: '0.01' },
          '900',
          'a',
        ),
        trade(
          '2026-01-01T10:00:00',
          { asset: 'eur', qty: '900' },
          { asset: 'usdc', qty: '1000' },
          '900',
          'b',
        ),
      ],
      [price('btc', '90000')],
    );
    expect(report.blocked).toEqual([]);
    expect(report.positions.map((p) => p.asset)).toEqual(['btc']);
    expect(report.closed.map((p) => p.asset)).toEqual(['usdc']);
  });
});

describe('historique incomplet', () => {
  it('une migration depuis un actif bloqué crée quand même l’actif reçu', () => {
    const migration: MigrationEvent = {
      ...base('2026-02-01T10:00:00'),
      kind: 'migration',
      out: { asset: 'mkr', qty: '1' },
      in: { asset: 'sky', qty: '24000' },
      fairValueOutEur: null,
      fairValueInEur: null,
    };
    const report = run(
      [
        trade(
          '2026-01-01T10:00:00',
          { asset: 'mkr', qty: '1' },
          { asset: 'eur', qty: '1500' },
          '1500',
        ),
        migration,
      ],
      [price('sky', '0.06')],
    );
    expect(report.blocked.map((p) => p.asset)).toEqual(['mkr']);
    const sky = report.positions.find((p) => p.asset === 'sky')!;
    expect(s(sky.qty)).toBe('24000');
    expect(s(sky.costBasis)).toBe('0');
    expect(sky.history[0]?.warnings.join(' ')).toContain('historique de mkr est incomplet');
  });

  it('les euros d’une cession bloquée n’entrent pas dans les apports', () => {
    const report = run(
      [
        trade(
          '2026-01-01T10:00:00',
          { asset: 'eur', qty: '100' },
          { asset: 'btc', qty: '1' },
          '100',
        ),
        trade(
          '2026-01-02T10:00:00',
          { asset: 'btc', qty: '2' },
          { asset: 'eur', qty: '300' },
          '300',
        ),
        trade('2026-01-03T10:00:00', { asset: 'eur', qty: '50' }, { asset: 'eth', qty: '1' }, '50'),
      ],
      [price('eth', '60')],
    );
    expect(report.blocked.map((p) => p.asset)).toEqual(['btc']);
    expect(s(report.totals.cashIn)).toBe('150');
    expect(s(report.totals.cashOut)).toBe('0');
    expect(s(report.totals.investedTotal)).toBe('50');
    expect(s(report.totals.total)).toBe('10');
  });

  it('vendre une poussière d’un actif jamais détenu bloque au lieu d’arrondir', () => {
    const report = run([
      trade(
        '2026-01-01T10:00:00',
        { asset: 'zzz', qty: '0.0000000001' },
        { asset: 'eur', qty: '1' },
        '1',
      ),
    ]);
    expect(report.blocked.map((p) => p.asset)).toEqual(['zzz']);
  });

  it('un actif entièrement « à qualifier » est signalé par le contrôle de solde', () => {
    const unknown: UnqualifiedEvent = {
      ...base('2026-01-01T10:00:00'),
      kind: 'unqualified',
      rawType: 'Récompense de staking',
      legs: [{ asset: 'dot', signedQty: '5', valueEur: null }],
      reason: 'Type inconnu',
    };
    const report = computePortfolio({
      events: [unknown],
      prices: {},
      settings: DEFAULT_ENGINE_SETTINGS,
      balances: [
        { rowKey: 'k1', asset: 'dot', signedQty: '5', balance: '5', at: '2026-01-01T10:00:00' },
      ],
    });
    const dot = [...report.positions, ...report.closed].find((p) => p.asset === 'dot')!;
    expect(dot.status).toBe('needs-qualification');
    expect(dot.integrity?.status).toBe('final-mismatch');
  });
});
