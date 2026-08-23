import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computePortfolio } from '../../src/lib/domain/engine';
import type { PriceQuoteInput } from '../../src/lib/domain/engine/report';
import { D, ZERO } from '../../src/lib/domain/money';
import { DEFAULT_ENGINE_SETTINGS } from '../../src/lib/domain/types';
import { balanceRecords } from '../../src/lib/import/coinhouse/balances';
import { importCoinhouseCsv } from '../../src/lib/import/coinhouse/index';
import { normalizeCoinhouseRows } from '../../src/lib/import/coinhouse/normalize';

const FIXTURE = 'tests/fixtures/coinhouse/export-demo.csv';
const REAL = 'historique des transactions (4).csv';

function reportFor(path: string) {
  const result = importCoinhouseCsv(readFileSync(path, 'utf8'), {}, 'imp');
  if (!result.ok) throw new Error(result.error);
  const rows = Object.values(result.rows);
  const { events } = normalizeCoinhouseRows(rows);
  const assets = [...new Set(rows.map((r) => r.asset))].filter((a) => a !== 'eur');
  // Prix factices déterministes : l'invariant ne dépend pas des prix.
  const prices: Record<string, PriceQuoteInput> = Object.fromEntries(
    assets.map((a, i) => [
      a,
      {
        asset: a,
        priceEur: String(1 + (i % 7)),
        at: '2026-08-22T10:00:00Z',
        source: 'test',
        stale: false,
      },
    ]),
  );
  return {
    report: computePortfolio({
      events,
      prices,
      settings: DEFAULT_ENGINE_SETTINGS,
      balances: balanceRecords(rows),
    }),
    rows,
  };
}

function expectConsistent(path: string, expected: { assets: number; rows: number }): void {
  const { report, rows } = reportFor(path);
  const all = [...report.positions, ...report.stablecoins, ...report.closed];
  expect(report.blocked).toEqual([]);
  expect(report.unqualified).toEqual([]);
  expect(report.totals.unpricedAssets).toEqual([]);
  // Tous les actifs hors eur ont un contrôle de solde OK.
  const checked = all.filter((p) => p.integrity !== null);
  expect(checked).toHaveLength(expected.assets);
  expect(
    checked
      .filter((p) => p.integrity!.status !== 'ok')
      .map((p) => `${p.asset}:${p.integrity!.message}`),
  ).toEqual([]);
  // Le ré-ordonnancement intra-journée USDC est détecté mais accepté.
  expect(all.find((p) => p.asset === 'usdc')?.integrity?.reorderedDays.length).toBeGreaterThan(0);
  // Invariant global : total = valeur + Σ produits − Σ acquisitions.
  const t = report.totals;
  expect(
    t.total.minus(t.value.plus(t.proceedsTotal).minus(t.investedTotal)).abs().lt('0.000000001'),
  ).toBe(true);
  // Invariant par actif.
  for (const p of all) {
    const lhs = p.total ?? ZERO;
    const rhs = (p.value ?? ZERO).plus(p.proceedsTotal).minus(p.investedTotal);
    expect(lhs.minus(rhs).abs().lt('0.000000001'), p.asset).toBe(true);
  }
  // Les soldes finaux du moteur égalent les derniers soldes exportés (vérifié par integrity).
  expect(rows.length).toBe(expected.rows);
  // Abonnements listés à part, jamais dans le P&L par défaut.
  expect(t.subscriptionsEur.gt(ZERO)).toBe(true);
  expect(D(t.cashIn.toString()).gt(ZERO)).toBe(true);
}

describe('moteur sur le jeu de démonstration synthétique', () => {
  it('0 bloqué, 0 à qualifier, 21 soldes cohérents, invariants vérifiés', () =>
    expectConsistent(FIXTURE, { assets: 21, rows: 217 }));
});

describe('moteur sur l’export réel (local, ignoré par git)', () => {
  it.skipIf(!existsSync(REAL))('mêmes garanties que la fixture', () =>
    expectConsistent(REAL, { assets: 27, rows: 201 }),
  );
});
