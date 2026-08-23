import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computePortfolio } from '../domain/engine/aggregate';
import type { PortfolioReport, PriceQuoteInput } from '../domain/engine/report';
import { D } from '../domain/money';
import { DEFAULT_ENGINE_SETTINGS } from '../domain/types';
import { balanceRecords } from '../import/coinhouse/balances';
import { importCoinhouseCsv } from '../import/coinhouse/index';
import { normalizeCoinhouseRows } from '../import/coinhouse/normalize';
import { runSelfChecks, summarize, type SelfCheckInput } from './self-check';

const FIXTURE = 'tests/fixtures/coinhouse/export-anonymized.csv';
const NOW = '2026-08-23T12:00:00.000Z';

function fixture(prices: Record<string, PriceQuoteInput>): PortfolioReport {
  const result = importCoinhouseCsv(readFileSync(FIXTURE, 'utf8'), {}, 'imp:check');
  if (!result.ok) throw new Error(result.error);
  const rows = Object.values(result.rows);
  return computePortfolio({
    events: normalizeCoinhouseRows(rows).events,
    prices,
    settings: DEFAULT_ENGINE_SETTINGS,
    balances: balanceRecords(rows),
  });
}

const quote = (asset: string, stale = false): PriceQuoteInput => ({
  asset,
  priceEur: '100',
  at: NOW,
  source: 'test',
  stale,
});

function input(report: PortfolioReport | null, over: Partial<SelfCheckInput> = {}): SelfCheckInput {
  return {
    report,
    quotes: {},
    prices: { source: 'auto', online: true, lastRefreshAt: NOW },
    storage: { lastBackupAt: NOW, persisted: true, saveError: null },
    now: NOW,
    ...over,
  };
}

describe('auto-vérifications', () => {
  it('fixture valorisée : tout est vert', () => {
    const report = fixture({});
    const held = [...report.positions, ...report.stablecoins].map((p) => p.asset);
    const priced = fixture(Object.fromEntries(held.map((a) => [a, quote(a)])));
    const checks = runSelfChecks(
      input(priced, { quotes: Object.fromEntries(held.map((a) => [a, quote(a)])) }),
    );
    const byId = Object.fromEntries(checks.map((c) => [c.id, c.level]));
    expect(byId).toEqual({
      invariant: 'ok',
      lots: 'ok',
      balances: 'ok',
      unqualified: 'ok',
      prices: 'ok',
      backup: 'ok',
    });
    expect(summarize(checks)).toEqual({ ok: 6, total: 6, worst: 'ok' });
    expect(checks.find((c) => c.id === 'balances')?.detail).toMatch(/\d+ actifs : soldes/);
  });

  it('sans prix : avertissement, et aucun montant dans les détails', () => {
    const checks = runSelfChecks(input(fixture({})));
    const prices = checks.find((c) => c.id === 'prices');
    expect(prices?.level).toBe('warn');
    expect(prices?.detail).toMatch(/Pas de prix pour/);
    expect(checks.map((c) => c.detail).join(' ')).not.toMatch(/€|\d+\.\d{3,}/);
  });

  it('une cohérence cassée, une survente ou une erreur de sauvegarde passent au rouge', () => {
    const report = fixture({});
    const btc = report.positions.find((p) => p.asset === 'btc')!;
    const tampered: PortfolioReport = {
      ...report,
      positions: report.positions.map((p) =>
        p.asset === 'btc'
          ? { ...p, value: D('1'), total: D('999999'), investedTotal: btc.investedTotal }
          : p,
      ),
      blocked: [{ ...btc, asset: 'xyz' }],
    };
    const checks = runSelfChecks(
      input(tampered, { storage: { lastBackupAt: null, persisted: false, saveError: 'quota' } }),
    );
    const byId = Object.fromEntries(checks.map((c) => [c.id, c.level]));
    expect(byId['invariant']).toBe('fail');
    expect(byId['blocked']).toBe('fail');
    expect(byId['backup']).toBe('fail');
    expect(summarize(checks).worst).toBe('fail');
    expect(checks.find((c) => c.id === 'invariant')?.detail).toContain('BTC');
  });

  it('sauvegarde ancienne ou prix périmés : avertissements', () => {
    const report = fixture({});
    const held = [...report.positions, ...report.stablecoins].map((p) => p.asset);
    const quotes = Object.fromEntries(held.map((a) => [a, quote(a, a === 'btc')]));
    const checks = runSelfChecks(
      input(fixture(quotes), {
        quotes,
        storage: { lastBackupAt: '2026-06-01T00:00:00.000Z', persisted: true, saveError: null },
      }),
    );
    expect(checks.find((c) => c.id === 'prices')?.detail).toContain('BTC');
    expect(checks.find((c) => c.id === 'prices')?.level).toBe('warn');
    expect(checks.find((c) => c.id === 'backup')?.level).toBe('warn');
    expect(checks.find((c) => c.id === 'backup')?.detail).toMatch(/il y a 8\d jours/);
  });

  it('sans données : informations seulement', () => {
    const checks = runSelfChecks(
      input(null, { storage: { lastBackupAt: null, persisted: null, saveError: null } }),
    );
    expect(checks.every((c) => c.level === 'info')).toBe(true);
  });
});
