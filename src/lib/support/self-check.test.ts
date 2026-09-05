import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computePortfolio } from '../domain/engine/aggregate';
import type { PortfolioReport, PriceQuoteInput } from '../domain/engine/report';
import { D } from '../domain/money';
import { DEFAULT_ENGINE_SETTINGS } from '../domain/types';
import { balanceRecords } from '../import/coinhouse/balances';
import { importCoinhouseCsv } from '../import/coinhouse/index';
import { normalizeCoinhouseRows } from '../import/coinhouse/normalize';
import {
  runSelfChecks,
  summarize,
  type SelfCheckInput,
  type TradingCheckInput,
} from './self-check';

const FIXTURE = 'tests/fixtures/coinhouse/export-demo.csv';
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
      cashflows: 'ok',
      lots: 'ok',
      balances: 'ok',
      unqualified: 'ok',
      prices: 'ok',
      backup: 'ok',
    });
    expect(summarize(checks)).toEqual({ ok: 7, total: 7, worst: 'ok' });
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

/**
 * Le voyant du repli (décision n° 79). Il ne dit pas la même chose que « Sauvegarde » : l'un
 * annonce une perte, l'autre annonce qu'il n'y en aura pas de filet le jour où il en faudrait un.
 */
describe('copie de secours hors service', () => {
  const withMirror = (over: Record<string, unknown>) =>
    Object.fromEntries(
      runSelfChecks(
        input(fixture({}), {
          storage: { lastBackupAt: NOW, persisted: true, saveError: null, ...over },
        }),
      ).map((c) => [c.id, c]),
    );

  it('apparaît en avertissement, sans annoncer de perte', () => {
    const byId = withMirror({ mirrorError: 'quota' });
    expect(byId['mirror']?.level, 'un avertissement, pas un échec').toBe('warn');
    expect(byId['mirror']?.detail).toMatch(/bien enregistrées/);
    expect(byId['mirror']?.action).toMatch(/sauvegarde JSON/i);
  });

  it('reste muet quand le miroir va bien', () => {
    expect(withMirror({ mirrorError: null })['mirror']).toBeUndefined();
  });

  /** Deux alertes pour une même panne diluent l'information : le `fail` dit déjà tout. */
  it('s’efface devant l’échec d’enregistrement, qui est plus grave', () => {
    const byId = withMirror({ saveError: 'quota', mirrorError: 'quota' });
    expect(byId['backup']?.level).toBe('fail');
    expect(byId['mirror'], 'le voyant du repli ferait doublon').toBeUndefined();
  });
});

describe('compte de trading sans instantané : la valeur manque, et ça doit s’entendre', () => {
  const account = (over: Partial<TradingCheckInput> = {}): TradingCheckInput => ({
    label: 'Hyperliquid',
    gap: null,
    lastSyncAt: NOW,
    syncError: null,
    unknownLedgerTypes: [],
    fxMissing: 0,
    fills: 0,
    ...over,
  });
  const tradingCheck = (over: Partial<TradingCheckInput>) =>
    runSelfChecks(input(null, { trading: [account(over)] })).find((c) =>
      c.id.startsWith('trading:'),
    )!;

  it('avec de l’historique : un avertissement, pas un « info » que personne ne lit', () => {
    const check = tradingCheck({ fills: 42 });
    // `info` n'apparaît nulle part : `actionable` ne retient que `warn` et `fail`. C'est ce
    // silence qui laissait un espace entier valorisé à zéro sans un mot.
    expect(check.level).toBe('warn');
    expect(check.detail).toContain('elle ne vaut pas zéro');
  });

  it('sans aucune exécution : rien à signaler, le compte vient d’être ajouté', () => {
    const check = tradingCheck({ fills: 0 });
    expect(check.level).toBe('info');
    expect(check.detail).toBe('Pas encore synchronisé.');
  });

  it('un instantané qui se recoupe ne déclenche rien', () => {
    const check = tradingCheck({ fills: 42, gap: D('0') });
    expect(check.level).toBe('ok');
  });
});

describe('fraîcheur du taux de change (décision n° 101)', () => {
  const fxCheck = (over: Partial<NonNullable<SelfCheckInput['fx']>>) =>
    runSelfChecks(
      input(null, {
        fx: { latestDay: '2026-08-01', error: null, usesUsd: true, ...over },
      }),
    ).find((c) => c.id === 'fx');

  it('au-delà d’une semaine : un avertissement, avec la date et l’âge', () => {
    // NOW = 2026-08-23 : le taux du 1ᵉʳ août a 22 jours, plus rien de calendaire ne l'explique.
    const check = fxCheck({});
    expect(check?.level).toBe('warn');
    expect(check?.detail).toContain('2026-08-01');
    expect(check?.detail).toContain('22 jours');
  });

  it('quatre jours : c’est le week-end, on ne dit rien (l’en-tête porte la date)', () => {
    expect(fxCheck({ latestDay: '2026-08-19' })).toBeUndefined();
  });

  it('aucun montant en dollars : le taux ne pèse sur rien', () => {
    expect(fxCheck({ usesUsd: false })).toBeUndefined();
  });

  it('quand le rafraîchissement échoue, l’action nomme l’erreur plutôt que d’envoyer actualiser', () => {
    const check = fxCheck({ error: 'HTTP 503' });
    expect(check?.action).toContain('HTTP 503');
  });
});
