/**
 * Le jeu de démonstration commis doit être exactement la sortie du générateur (aucune retouche à
 * la main, aucune dérive), et rester un export « parfait » pour l'importeur et le moteur.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURE_PATH, HEADER, generateFixture } from '../../scripts/generate-fixture';
import { computePortfolio } from '../../src/lib/domain/engine';
import { DEFAULT_ENGINE_SETTINGS } from '../../src/lib/domain/types';
import { balanceRecords } from '../../src/lib/import/coinhouse/balances';
import { importCoinhouseCsv } from '../../src/lib/import/coinhouse/index';
import { normalizeCoinhouseRows } from '../../src/lib/import/coinhouse/normalize';

describe('jeu de démonstration synthétique', () => {
  it('le fichier commis est identique à la sortie du générateur (déterministe)', () => {
    const generated = generateFixture();
    expect(generateFixture()).toBe(generated);
    expect(readFileSync(FIXTURE_PATH, 'utf8')).toBe(generated);
    expect(generated.startsWith(HEADER + '\n')).toBe(true);
  });

  it('est importé sans réserve : 0 à qualifier, 0 bloqué, soldes cohérents, types attendus', () => {
    const result = importCoinhouseCsv(generateFixture(), {}, 'imp:demo');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.format).toBe('coinhouse-2026-08');
    expect(result.report.issues).toEqual([]);
    expect(result.report.warnings).toEqual([]);
    expect(result.report.counts.unqualified).toBe(0);
    expect(result.report.counts.orphanLegs).toBe(0);
    expect(result.report.counts.migrations).toBe(1);
    expect(result.report.counts.fees).toBe(2);
    const rows = Object.values(result.rows);
    const { events } = normalizeCoinhouseRows(rows);
    // Seules les 12 récompenses (auto, mais « avec avertissement » par construction — voir
    // row-types.ts) portent un avertissement ; aucune autre ligne n'en a.
    const rewardEvents = events.filter((e) => e.kind === 'reward');
    expect(rewardEvents).toHaveLength(12);
    expect(events.flatMap((e) => e.warnings)).toEqual(
      rewardEvents.map(() => 'Type « Récompense » interprété par heuristique : à vérifier.'),
    );
    const report = computePortfolio({
      events,
      prices: {},
      settings: DEFAULT_ENGINE_SETTINGS,
      balances: balanceRecords(rows),
    });
    expect(report.blocked).toEqual([]);
    expect(report.unqualified).toEqual([]);
    const all = [...report.positions, ...report.stablecoins, ...report.closed];
    expect(all.filter((p) => p.integrity?.status !== 'ok').map((p) => p.asset)).toEqual([]);
    // Variété du scénario : positions ouvertes, clôturées (gains et pertes), stablecoin, migration.
    expect(report.positions.length).toBeGreaterThanOrEqual(10);
    expect(report.closed.length).toBeGreaterThanOrEqual(6);
    expect(report.closed.some((p) => p.realized.gt('0'))).toBe(true);
    expect(report.closed.some((p) => p.realized.lt('0'))).toBe(true);
    expect(report.stablecoins.map((p) => p.asset)).toEqual(['usdc']);
    expect(report.positions.some((p) => p.asset === 'sky')).toBe(true);
    expect(report.totals.subscriptionsEur.gt('0')).toBe(true);
    // Le jour réglé dans le désordre est détecté et accepté.
    expect(all.find((p) => p.asset === 'usdc')?.integrity?.reorderedDays).toEqual(['2025-08-14']);
  });
});
