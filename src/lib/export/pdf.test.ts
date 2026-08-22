import { describe, expect, it } from 'vitest';
import { computePortfolio } from '../domain/engine';
import { DEFAULT_ENGINE_SETTINGS, type TradeEvent } from '../domain/types';
import { buildReportPdf, reportFileName, toPdfText } from './pdf';
import { buildReportModel } from './report-model';

describe('toPdfText (encodage WinAnsi de la police standard)', () => {
  it('remplace le signe moins typographique et l’espace fine insécable', () => {
    expect(toPdfText('\u22121\u202f234,56\u00a0€')).toBe('-1\u00a0234,56\u00a0€');
  });
  it('conserve les caractères WinAnsi (accents, €, œ, guillemets, puces)', () => {
    const text = 'Coût « œuvre » • € — ’ … ×';
    expect(toPdfText(text)).toBe(text);
  });
  it('substitue ou neutralise le reste', () => {
    expect(toPdfText('a → b ↔ c ≥ Σ ∞')).toBe('a -> b <-> c >= somme ?');
  });
});

describe('reportFileName', () => {
  it('suit le motif cout-revient-ch-rapport-AAAA-MM-JJ.pdf', () => {
    expect(reportFileName('2026-08-22')).toBe('cout-revient-ch-rapport-2026-08-22.pdf');
  });
});

describe('buildReportPdf (jsPDF chargé à la demande, exécuté sous Node)', () => {
  const trade = (id: string, at: string, asset: string, qty: string, eur: string): TradeEvent => ({
    id,
    at,
    source: 'manual',
    scope: 'coinhouse',
    rowKeys: [],
    warnings: [],
    kind: 'trade',
    out: { asset: 'eur', qty: eur },
    in: { asset, qty },
    valueEur: eur,
    valueEurSource: 'manual',
    fee: null,
    quotePrice: null,
  });
  const report = computePortfolio({
    events: [
      trade('a', '2026-01-01T10:00:00', 'btc', '0.5', '20000'),
      trade('b', '2026-02-01T10:00:00', 'eth', '2', '4000'),
    ],
    prices: {
      btc: {
        asset: 'btc',
        priceEur: '60000',
        at: '2026-08-22T10:00:00Z',
        source: 't',
        stale: false,
      },
    },
    settings: DEFAULT_ENGINE_SETTINGS,
  });
  const model = buildReportModel(report, {
    discreet: false,
    generatedAt: '2026-08-22T10:00:00.000Z',
    version: '0.1.0',
    timeZone: 'Europe/Paris',
  });

  it('produit un PDF A4 multipage (garde, synthèse, positions, méthodologie)', async () => {
    const doc = await buildReportPdf(model);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(4);
    const { width, height } = doc.internal.pageSize;
    expect(Math.round(width)).toBe(210);
    expect(Math.round(height)).toBe(297);
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
  });
});
