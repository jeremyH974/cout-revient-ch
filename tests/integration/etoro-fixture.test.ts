/**
 * Le relevé eToro de démonstration, de bout en bout : classeur → lignes pivot → événements →
 * rapport. La fixture est **entièrement inventée** (`scripts/generate-etoro-fixture.ts`), jamais
 * dérivée d'un relevé réel (décision n° 17), et porte volontairement les particularités du format :
 * préfixe `x:`, chaîne partagée fragmentée, cibles absolues, deux instantanés empilés, une position
 * à effet de levier et un contrat pour différence.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetClass } from '../../src/lib/domain/assets';
import { computePortfolio } from '../../src/lib/domain/engine/aggregate';
import { isPositive } from '../../src/lib/domain/money';
import { DEFAULT_ENGINE_SETTINGS } from '../../src/lib/domain/types';
import { importEtoroWorkbook } from '../../src/lib/import/etoro/index';
import { pivotLedgerEvents } from '../../src/lib/import/pivot/events';
import { ingestPivotRows } from '../../src/lib/import/pivot/index';

const FIXTURE = 'tests/fixtures/etoro/releve-demo.xlsx';
/** Taux fixe : ce test mesure la conversion du relevé, pas la justesse des taux BCE. */
const usdRate = (): string => '1.25';

function workbook(): ArrayBuffer {
  const file = readFileSync(FIXTURE);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

async function imported() {
  const result = await importEtoroWorkbook(workbook(), 'imp:test', 'etoro:main');
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('relevé eToro de démonstration', () => {
  it('ne retient que le dernier instantané, et écarte levier et CFD en les nommant', async () => {
    const result = await imported();
    // 3 positions du dernier instantané + 1 position fermée (achat puis vente) = 5 lignes.
    expect(result.rows).toHaveLength(5);
    expect(result.skipped).toBe(2);
    const motifs = result.issues.map((i) => i.message).join(' | ');
    expect(motifs).toContain('levier');
    expect(motifs).toContain('hors périmètre');
  });

  it('donne à chaque actif la classe déclarée par la source', async () => {
    const result = await imported();
    const codes = [
      ...new Set(
        Object.values(result.rows).flatMap((r) =>
          [r.sent?.currency, r.received?.currency].filter((c): c is string => !!c),
        ),
      ),
    ].sort();
    expect(codes).toEqual(['btc', 'eq:xx0000000001', 'eq:xx0000000002', 'usd']);
    expect(assetClass('eq:xx0000000001')).toBe('equity');
    expect(assetClass('btc')).toBe('crypto');
  });

  it('produit un portefeuille cohérent : deux titres, une crypto, rien à qualifier', async () => {
    const result = await imported();
    const ingested = ingestPivotRows(
      { rows: result.rows, issues: result.issues },
      { format: 'etoro', header: [], unknownColumns: [], totalRows: result.rows.length },
      {},
      'etoro:main',
      usdRate,
    );
    if (!ingested.ok) throw new Error(ingested.error);
    const { events } = pivotLedgerEvents(Object.values(ingested.rows), {}, usdRate);
    const report = computePortfolio({ events, prices: {}, settings: DEFAULT_ENGINE_SETTINGS });

    expect(report.equities.map((p) => p.asset).sort()).toEqual([
      'eq:xx0000000001',
      'eq:xx0000000002',
    ]);
    expect(report.positions.map((p) => p.asset)).toEqual(['btc']);
    expect(report.unqualified).toHaveLength(0);
    // La position fermée a rapporté 240 pour 200 investis : le titre garde une plus-value réalisée.
    const demo = report.equities.find((p) => p.asset === 'eq:xx0000000001');
    expect(demo && isPositive(demo.realized)).toBe(true);
    expect(demo?.qty.toString()).toBe('10');
  });

  it('refuse un classeur qui n’est pas un relevé eToro', async () => {
    const notEtoro = new TextEncoder().encode('même pas une archive').buffer;
    const result = await importEtoroWorkbook(notEtoro as ArrayBuffer, 'imp:x', 'etoro:main');
    expect(result.ok).toBe(false);
  });
});
