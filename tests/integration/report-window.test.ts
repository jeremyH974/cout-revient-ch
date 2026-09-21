/**
 * La fenêtre d'analyse du Rapport (P118) sur les deux jeux de démonstration, entièrement
 * synthétiques (décision n° 17).
 *
 * Ce qu'elle rend depuis l'origine doit être, au centime et sans tolérance, ce que le Rapport
 * affichait avant elle : les totaux du moteur pour les flux, le XIRR de `report-model.ts` pour le
 * rendement pondéré par les flux. Une fenêtre qui s'écarterait de l'origine sur « Tout » ferait
 * changer un chiffre publié sans que personne ne l'ait décidé.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computePortfolio, holdings, type PortfolioReport } from '../../src/lib/domain/engine';
import type { PriceQuoteInput } from '../../src/lib/domain/engine/report';
import { D } from '../../src/lib/domain/money';
import {
  DEFAULT_ENGINE_SETTINGS,
  type EngineSettings,
  type LedgerEvent,
} from '../../src/lib/domain/types';
import { xirrEur } from '../../src/lib/domain/xirr';
import { externalFlows } from '../../src/lib/history/performance';
import { windowFlows, windowMwr, type WindowFlows } from '../../src/lib/history/window';
import { importCoinhouseCsv } from '../../src/lib/import/coinhouse/index';
import { normalizeCoinhouseRows } from '../../src/lib/import/coinhouse/normalize';
import { importEtoroWorkbook } from '../../src/lib/import/etoro/index';
import { pivotLedgerEvents } from '../../src/lib/import/pivot/events';
import { ingestPivotRows } from '../../src/lib/import/pivot/index';

const FIELDS = [
  'realized',
  'feesEur',
  'rebatesEur',
  'otherIncome',
  'accountIncomeEur',
  'subscriptionsEur',
] as const satisfies readonly (keyof WindowFlows)[];

const ALL = { from: null, to: '2099-12-31' };

/** Le périmètre des totaux : ouvertes et clôturées, jamais bloquées (`aggregate.ts`). */
const live = (report: PortfolioReport) => [...holdings(report), ...report.closed];

function demo(settings: EngineSettings) {
  const result = importCoinhouseCsv(
    readFileSync('tests/fixtures/coinhouse/export-demo.csv', 'utf8'),
    {},
    'imp',
  );
  if (!result.ok) throw new Error(result.error);
  const rows = Object.values(result.rows);
  const { events } = normalizeCoinhouseRows(rows);
  const assets = [...new Set(rows.map((r) => r.asset))].filter((a) => a !== 'eur');
  // Prix factices déterministes : seule la valeur finale du XIRR en dépend, et des deux côtés.
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
  return { events, report: computePortfolio({ events, prices, settings }) };
}

async function etoro() {
  const file = readFileSync('tests/fixtures/etoro/releve-demo.xlsx');
  const imported = await importEtoroWorkbook(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    'imp:test',
    'etoro:main',
  );
  if (!imported.ok) throw new Error(imported.error);
  const usdRate = (): string => '1.25';
  const ingested = ingestPivotRows(
    { rows: imported.rows, issues: imported.issues },
    { format: 'etoro', header: [], unknownColumns: [], totalRows: imported.rows.length },
    {},
    'etoro:main',
    usdRate,
  );
  if (!ingested.ok) throw new Error(ingested.error);
  const { events } = pivotLedgerEvents(Object.values(ingested.rows), {}, usdRate);
  return {
    events,
    report: computePortfolio({ events, prices: {}, settings: DEFAULT_ENGINE_SETTINGS }),
  };
}

function expectTotals(events: readonly LedgerEvent[], report: PortfolioReport): WindowFlows {
  const flows = windowFlows({ positions: live(report), events }, ALL);
  const t = report.totals;
  for (const field of FIELDS)
    expect(
      flows[field].eq(t[field]),
      `${field} depuis l’origine : ${flows[field].toString()} ≠ total du moteur ${t[field].toString()}`,
    ).toBe(true);
  return flows;
}

describe('fenêtre « depuis l’origine » sur le jeu Coinhouse', () => {
  it('les flux de résultat sont les totaux du moteur, récompenses valorisées ou non', () => {
    for (const rewardValuation of ['zero', 'fair-value'] as const) {
      const { events, report } = demo({ ...DEFAULT_ENGINE_SETTINGS, rewardValuation });
      const flows = expectTotals(events, report);
      // Rien de vacant : le jeu porte des cessions, des frais, des remises et des abonnements.
      expect(flows.realized.eq('0')).toBe(false);
      expect(
        flows.feesEur.gt('0') && flows.rebatesEur.gt('0') && flows.subscriptionsEur.gt('0'),
      ).toBe(true);
      expect(flows.otherIncome.gt('0')).toBe(rewardValuation === 'fair-value');
    }
  });

  it('deux années civiles se partagent exactement les flux de toute la période', () => {
    const { events, report } = demo({ ...DEFAULT_ENGINE_SETTINGS, rewardValuation: 'fair-value' });
    const input = { positions: live(report), events };
    const y2025 = windowFlows(input, { from: '2025-01-01', to: '2025-12-31' });
    const y2026 = windowFlows(input, { from: '2026-01-01', to: '2026-12-31' });
    const whole = windowFlows(input, ALL);
    for (const field of FIELDS)
      expect(
        y2025[field].plus(y2026[field]).eq(whole[field]),
        `${field} : 2025 + 2026 ≠ tout`,
      ).toBe(true);
    // Et le partage n'est pas trivial : chaque année porte sa part de réalisé.
    expect(y2025.realized.eq('0') || y2026.realized.eq('0')).toBe(false);
  });

  it('le rendement pondéré par les flux est, au dernier chiffre, le XIRR du Rapport', () => {
    const { report } = demo(DEFAULT_ENGINE_SETTINGS);
    const day = '2026-08-22';
    // L'appel de `report-model.ts` : tous les flux du moteur, la valeur du rapport au jour du rapport.
    const legacy = xirrEur(report.cashFlows, { day, valueEur: report.totals.value });
    expect(legacy.ok).toBe(true);
    const mwr = windowMwr(
      {
        series: [],
        flows: externalFlows(report.cashFlows, {}),
        closingValue: report.totals.value,
      },
      { from: null, to: day },
    );
    expect(mwr).toEqual(legacy);
  });
});

describe('fenêtre « depuis l’origine » sur le relevé eToro', () => {
  it('dividendes, intérêts et frais de conversion retombent sur les totaux du moteur', async () => {
    const { events, report } = await etoro();
    const flows = expectTotals(events, report);
    // Les trois familles de revenus sans ligne d'historique sont bien traversées.
    expect(flows.otherIncome.gt('0')).toBe(true);
    expect(flows.accountIncomeEur.eq(D('0.97'))).toBe(true);
  });
});
