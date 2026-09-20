import { inflateSync } from 'node:zlib';
import type { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';
import { computePortfolio } from '../domain/engine';
import { buildInsights } from '../domain/insights';
import { D } from '../domain/money';
import { riskMetrics } from '../domain/risk';
import { DEFAULT_ENGINE_SETTINGS, type TradeEvent } from '../domain/types';
import { buildReportPdf, reportFileName, toPdfText } from './pdf';
import { buildReportModel, type ReportModel } from './report-model';

/**
 * Le texte réellement écrit dans le PDF, dans l'ordre où il y est posé.
 *
 * Les flux de contenu sont compressés (`compress: true`) : on les décomprime, puis on relève les
 * opérateurs d'affichage `(…) Tj`. C'est l'artefact lui-même qu'on lit, pas le modèle qui l'a
 * produit — sans quoi un rendu qui perd une section resterait vert.
 */
function pdfTexts(doc: jsPDF): string[] {
  const bytes = Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
  // `latin1` : la police standard écrit en WinAnsi, et `toPdfText` a déjà écarté le reste.
  const raw = bytes.toString('latin1');
  const texts: string[] = [];
  for (const start of raw.matchAll(/stream\r?\n/g)) {
    const from = start.index + start[0].length;
    const to = raw.indexOf('endstream', from);
    if (to === -1) continue;
    const slice = bytes.subarray(from, to);
    let content: string;
    try {
      content = inflateSync(slice).toString('latin1');
    } catch {
      content = slice.toString('latin1');
    }
    for (const show of content.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g))
      texts.push((show[1] ?? '').replace(/\\([()\\])/g, '$1'));
  }
  return texts;
}

/**
 * Les titres de section du modèle, **dans l'ordre où les deux rendus doivent les poser**.
 *
 * Cette liste EST la séquence codée en dur de `pdf.ts` et du markup de `Report.svelte`, écrite une
 * troisième fois — c'est précisément ce que la décision n° 172 laisse à corriger : tant que le
 * modèle porte des champs nommés plutôt qu'une liste ordonnée, l'ordre n'existe nulle part comme
 * donnée, et rien ne peut le vérifier.
 */
export function sectionTitles(m: ReportModel): string[] {
  return [
    m.summary.title,
    m.insights?.title,
    m.risk?.title,
    m.tax?.title,
    m.declarations?.title,
    m.watch?.title,
    m.spread?.title,
    m.subscription?.title,
    m.allocation.title,
    m.positions.title,
    m.stablecoins.title,
    m.closed.title,
    m.methodology.title,
  ].filter((t): t is string => t !== undefined);
}

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
    accountId: 'ch:main',
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

  it('dessine les sections « Constats » et « Risque » sans rompre la pagination', async () => {
    const insights = buildInsights({ report });
    expect(insights.length).toBeGreaterThan(0);
    const withInsights = buildReportModel(report, {
      discreet: false,
      generatedAt: '2026-08-22T10:00:00.000Z',
      version: '0.1.0',
      timeZone: 'Europe/Paris',
      insights,
      risk: riskMetrics([
        { day: '2026-01-01', index: D('1') },
        { day: '2026-01-02', index: D('1.4') },
        { day: '2026-01-03', index: D('0.95') },
      ]),
    });
    const doc = await buildReportPdf(withInsights);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(4);
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
  });

  /**
   * **Le PDF pose toutes les sections du modèle, et dans son ordre.**
   *
   * Rien ne le vérifiait : les deux tests ci-dessus comptent des pages et lisent cinq octets
   * d'en-tête. On pouvait donc intervertir deux sections, ou en perdre une, sans qu'aucun test ne
   * rougisse — et c'est exactement ce que le passage à une liste ordonnée de sections va déplacer.
   * Ce garde-fou est posé AVANT le remaniement, pour qu'il ait quelque chose à protéger.
   *
   * On compare des RANGS, pas une égalité de listes : le PDF contient bien d'autres textes que des
   * titres (libellés, cellules, notes), et une note peut reprendre mot pour mot un titre.
   */
  const assertSectionOrder = (texts: string[], expected: string[]): void => {
    const ranks = expected.map((title) => texts.indexOf(title));
    expect(
      expected.filter((_, i) => ranks[i] === -1),
      'sections absentes du PDF',
    ).toEqual([]);
    const sorted = [...ranks].sort((a, b) => a - b);
    const outOfOrder = expected.filter((_, i) => ranks[i] !== sorted[i]);
    expect(outOfOrder, 'sections posées dans le désordre').toEqual([]);
  };

  it('pose chaque section du modèle, dans l’ordre du modèle', async () => {
    const texts = pdfTexts(await buildReportPdf(model));
    const expected = sectionTitles(model);
    // Garde-fou du garde-fou : une liste vide passerait sans rien prouver.
    expect(expected.length).toBeGreaterThanOrEqual(6);
    assertSectionOrder(texts, expected);
  });

  it('pose aussi les sections optionnelles à leur rang', async () => {
    const insights = buildInsights({ report });
    const rich = buildReportModel(report, {
      discreet: false,
      generatedAt: '2026-08-22T10:00:00.000Z',
      version: '0.1.0',
      timeZone: 'Europe/Paris',
      insights,
      risk: riskMetrics([
        { day: '2026-01-01', index: D('1') },
        { day: '2026-01-02', index: D('1.4') },
        { day: '2026-01-03', index: D('0.95') },
      ]),
    });
    const expected = sectionTitles(rich);
    // « Constats » et « Risque » s'intercalent entre la synthèse et les tableaux : sans elles, ce
    // test serait le précédent une seconde fois.
    expect(expected.length).toBeGreaterThan(sectionTitles(model).length);
    assertSectionOrder(pdfTexts(await buildReportPdf(rich)), expected);
  });
});
