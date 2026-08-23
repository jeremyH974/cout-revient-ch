import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computePortfolio } from '../domain/engine';
import { DEFAULT_ENGINE_SETTINGS, type RawCoinhouseRow } from '../domain/types';
import { balanceRecords } from '../import/coinhouse/balances';
import { importCoinhouseCsv } from '../import/coinhouse/index';
import { normalizeCoinhouseRows } from '../import/coinhouse/normalize';
import { DEFAULT_UI_SETTINGS } from '../storage/schema';
import { buildDiagnostic, type DiagnosticInput } from './diagnostic';

const FIXTURE = 'tests/fixtures/coinhouse/export-demo.csv';

function fixtureInput(): { input: DiagnosticInput; rows: RawCoinhouseRow[] } {
  const result = importCoinhouseCsv(readFileSync(FIXTURE, 'utf8'), {}, 'imp:diag');
  if (!result.ok) throw new Error(result.error);
  const rows = Object.values(result.rows);
  const report = computePortfolio({
    events: normalizeCoinhouseRows(rows).events,
    prices: {},
    settings: DEFAULT_ENGINE_SETTINGS,
    balances: balanceRecords(rows),
  });
  const input: DiagnosticInput = {
    version: '0.1.0',
    build: 'abc1234',
    now: '2026-08-23T10:00:00.000Z',
    environment: {
      userAgent: 'TestBrowser/1.0',
      language: 'fr-FR',
      viewport: '390×844 (×3)',
      online: true,
      standalone: false,
    },
    storage: {
      status: 'ok',
      saveError: null,
      persisted: true,
      usageBytes: 150_000,
      quotaBytes: 2_000_000_000,
    },
    imports: [
      {
        id: 'imp:diag',
        at: '2026-08-23T09:59:00.000Z',
        fileName: 'historique des transactions.csv',
        rows: result.report.parsedRows,
        newRows: result.report.newRows,
        format: result.report.format,
        header: result.report.header,
        unknownColumns: result.report.unknownColumns,
      },
      {
        id: 'imp:old',
        at: '2026-07-01T08:00:00.000Z',
        fileName: 'ancien.csv',
        rows: 10,
        newRows: 10,
      },
    ],
    rows,
    manualEvents: 0,
    report,
    prices: { source: 'auto', online: null, errors: [], missing: [], lastRefreshAt: null },
    fx: { wanted: 'EUR', effective: 'EUR', error: null },
    engine: DEFAULT_ENGINE_SETTINGS,
    ui: DEFAULT_UI_SETTINGS,
  };
  return { input, rows };
}

describe('diagnostic copiable', () => {
  it('résume la version, les imports, les colonnes et les compteurs', () => {
    const { input } = fixtureInput();
    const text = buildDiagnostic(input);
    expect(text).toContain('Version : 0.1.0 (build abc1234)');
    expect(text).toContain('Imports : 2');
    expect(text).toContain('format coinhouse-2026-08');
    expect(text).toContain('colonnes : ID Coinhouse, Date, Type, Quantité');
    expect(text).toContain('inconnues (import antérieur)');
    expect(text).toContain('Types d’opérations'.replace('’', "'"));
    expect(text).toMatch(/Echange ×\d+/);
    expect(text).toContain('Intégrité des soldes : ok ×');
    expect(text).toContain('usage 146 Ko / quota 1907,3 Mo');
  });

  it("ne contient aucune quantité, contre-valeur, prix ou solde de l'export", () => {
    const { input, rows } = fixtureInput();
    const text = buildDiagnostic(input);
    let checked = 0;
    for (const row of rows) {
      for (const value of [row.qty, row.valueEur, row.marketPrice, row.balance, row.feeEur]) {
        if (!value) continue;
        const digits = value.replace('-', '');
        // Les petits entiers (« 1 », « 24 ») peuvent coïncider avec un compteur : on ne teste que les
        // valeurs identifiantes (décimales ou longues).
        if (!digits.includes('.') && digits.length < 5) continue;
        expect(text, `valeur ${value} trouvée dans le diagnostic`).not.toContain(digits);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(text).not.toMatch(/€/);
  });

  it("décrit un échec d'import par ses colonnes, sans données", () => {
    const { input } = fixtureInput();
    const text = buildDiagnostic({
      ...input,
      imports: [],
      rows: [],
      report: null,
      failure: {
        error: 'Ce fichier ne ressemble pas à un export Coinhouse.',
        header: ['Date', 'Montant'],
      },
    });
    expect(text).toContain('Rapport : aucun');
    expect(text).toContain(
      "Échec d'import affiché : Ce fichier ne ressemble pas à un export Coinhouse.",
    );
    expect(text).toContain('colonnes trouvées : Date, Montant');
    expect(text).toContain('Logos : aucun échec');
  });

  it('liste les logos qui ont échoué avec le résultat du contrôle', () => {
    const { input } = fixtureInput();
    const text = buildDiagnostic({
      ...input,
      iconFailures: [
        { asset: 'eth', url: '/cout-revient-ch/icons/eth.svg?retry=1', probe: '404 text/html' },
      ],
    });
    expect(text).toContain('Logos : eth (/cout-revient-ch/icons/eth.svg?retry=1 → 404 text/html)');
  });
});
