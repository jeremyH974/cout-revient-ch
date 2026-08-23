/**
 * Valeurs attendues calculées par le moteur lui-même à partir de la fixture : les tests E2E
 * comparent l'écran au moteur, jamais à des chiffres codés en dur.
 */
import { readFileSync } from 'node:fs';
import { computePortfolio } from '../../../src/lib/domain/engine/aggregate';
import type { PortfolioReport, PositionReport } from '../../../src/lib/domain/engine/report';
import { DEFAULT_ENGINE_SETTINGS, type RawCoinhouseRow } from '../../../src/lib/domain/types';
import { balanceRecords } from '../../../src/lib/import/coinhouse/balances';
import { importCoinhouseCsv } from '../../../src/lib/import/coinhouse/index';
import { normalizeCoinhouseRows } from '../../../src/lib/import/coinhouse/normalize';
import { fmtMoney, fmtPrice } from '../../../src/lib/format/fr';

export const FIXTURE = 'tests/fixtures/coinhouse/export-anonymized.csv';

/** Espaces fines et insécables d'Intl → espaces simples, comme Playwright normalise le DOM. */
export const normalize = (s: string): string => s.replace(/[\u202f\u00a0]/g, ' ');

export function fixtureReport(): { report: PortfolioReport; rows: RawCoinhouseRow[] } {
  const result = importCoinhouseCsv(readFileSync(FIXTURE, 'utf8'), {}, 'imp:e2e');
  if (!result.ok) throw new Error(result.error);
  const rows = Object.values(result.rows);
  const report = computePortfolio({
    events: normalizeCoinhouseRows(rows).events,
    prices: {},
    settings: DEFAULT_ENGINE_SETTINGS,
    balances: balanceRecords(rows),
  });
  return { report, rows };
}

export function position(report: PortfolioReport, asset: string): PositionReport {
  const p = [...report.positions, ...report.stablecoins].find((x) => x.asset === asset);
  if (!p) throw new Error(`position ${asset} absente de la fixture`);
  return p;
}

export const pruText = (p: PositionReport): string => normalize(fmtPrice(p.pru, 'EUR'));
export const moneyText = (value: Parameters<typeof fmtMoney>[0]): string =>
  normalize(fmtMoney(value, 'EUR'));
