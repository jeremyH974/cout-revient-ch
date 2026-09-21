import { inflateSync } from 'node:zlib';
import type { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';
import { computeDeclarations } from '../domain/declarations-fr';
import { computePortfolio } from '../domain/engine';
import { buildInsights } from '../domain/insights';
import { D } from '../domain/money';
import { riskMetrics } from '../domain/risk';
import { DEFAULT_ENGINE_SETTINGS, type Account, type TradeEvent } from '../domain/types';
import { latestNetWorth, netWorthSeries, reconcileNetWorth } from '../history/net-worth';
import type { DayString } from '../history/types';
import { buildGlobalReportModel } from './global-report-model';
import { buildLendingReportModel } from './lending-report-model';
import { buildReportPdf, reportFileName, toPdfText } from './pdf';
import { buildReportModel, type ReportModel } from './report-model';
import { buildTradingReportModel } from './trading-report-model';

/** Les opérateurs d'affichage de texte `(…) Tj` d'un flux, décodés dans l'ordre. */
const showTexts = (content: string): string[] =>
  [...content.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)].map((m) =>
    (m[1] ?? '').replace(/\\([()\\])/g, '$1'),
  );

/**
 * Le texte de chaque page, dans l'ordre des pages.
 *
 * `doc.internal.pages` porte les opérateurs **avant** compression, une entrée par page (l'indice 0
 * est vide chez jsPDF). C'est la seule façon d'attribuer un titre à SA page — ce que le flux
 * compressé du fichier ne dit pas simplement — et donc de vérifier qu'un saut de page a bien eu lieu.
 */
function pdfTextsByPage(doc: jsPDF): string[][] {
  const pages = (doc.internal as unknown as { pages: string[][] }).pages;
  return pages.slice(1).map((ops) => showTexts(ops.join('\n')));
}

/**
 * Le texte réellement écrit dans le fichier, dans l'ordre où il y est posé.
 *
 * Les flux de contenu sont compressés (`compress: true`) : on les décomprime, puis on relève les
 * opérateurs d'affichage. C'est l'artefact lui-même qu'on lit, pas le modèle qui l'a produit —
 * sans quoi un rendu qui perd une section resterait vert.
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
    texts.push(...showTexts(content));
  }
  return texts;
}

/**
 * Les titres de section du modèle, dans l'ordre du modèle.
 *
 * C'était une énumération de treize champs nommés — une TROISIÈME copie de la séquence, après
 * celle de `pdf.ts` et celle du markup de `Report.svelte`. Depuis que le modèle porte une liste
 * ordonnée (décision n° 174), l'ordre est une donnée, et cette fonction n'a plus rien à recopier.
 */
export function sectionTitles(m: ReportModel): string[] {
  return m.sections.map((s) => s.title);
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

  /**
   * **Un saut de page est une donnée du modèle, plus un `if` du rendu.**
   *
   * `pdf.ts` ouvrait une page avant « Positions ouvertes », avant « Méthodologie », et avant
   * « Positions clôturées » quand elle avait des lignes — trois décisions de mise en page écrites
   * au milieu du rendu, qui l'obligeaient à connaître ces sections par leur nom. Elles vivent
   * maintenant sur `ReportSection.breakBefore` (décision n° 174), et ce test les y tient : une
   * section qui l'annonce doit être la PREMIÈRE de sa page.
   */
  it('ouvre une page devant chaque section qui l’annonce', async () => {
    const doc = await buildReportPdf(model);
    const pages = pdfTextsByPage(doc);
    const titles = new Set(sectionTitles(model));
    const breaking = model.sections.filter((s) => s.breakBefore);
    // Garde-fou du garde-fou : sans section à saut de page, ce test ne prouverait rien.
    expect(breaking.length).toBeGreaterThanOrEqual(2);
    for (const s of breaking) {
      const page = pages.findIndex((texts) => texts.includes(s.title));
      expect(page, `« ${s.title} » introuvable dans le PDF`).toBeGreaterThanOrEqual(0);
      const firstTitle = (pages[page] ?? []).find((t) => titles.has(t));
      expect(firstTitle, `« ${s.title} » n’ouvre pas sa page`).toBe(s.title);
    }
  });

  /**
   * **La liste des comptes à déclarer au 3916-bis ne figurait PAS dans le PDF** — `pdf.ts` ne
   * mentionnait pas une seule fois `declarations`, alors que l'écran l'affiche depuis toujours.
   *
   * Le défaut est resté invisible parce que les deux rendus écrivaient leur séquence de sections
   * à la main, chacun de son côté, et que rien ne les confrontait. Il contredisait frontalement la
   * décision n° 141, qui a donné son année au titre de cette section **parce qu'un PDF circule
   * détaché de l'écran qui l'a produit**. La boucle sur `model.sections` le corrige par
   * construction ; ce test interdit qu'il revienne.
   */
  it('emporte la liste des comptes à déclarer, que le PDF perdait', async () => {
    const account = (id: string, country: string): Account => ({
      id,
      kind: 'csv',
      label: id,
      space: 'invest',
      country,
      createdAt: '2026-01-01T00:00:00Z',
    });
    const declarations = computeDeclarations({
      accounts: [account('csv:nl', 'NL')],
      events: [],
      year: 2026,
    });
    const withAccounts = buildReportModel(report, {
      discreet: false,
      generatedAt: '2026-08-22T10:00:00.000Z',
      version: '0.1.0',
      timeZone: 'Europe/Paris',
      declarations,
      taxYear: 2026,
    });
    const title = 'Comptes à déclarer au titre de 2026 (formulaire 3916-bis)';
    // Le modèle la porte — c'est le RENDU qui l'oubliait.
    expect(sectionTitles(withAccounts)).toContain(title);
    expect(pdfTexts(await buildReportPdf(withAccounts))).toContain(title);
  });

  /**
   * **Le rendu pose un SECOND périmètre sans rien apprendre de lui.**
   *
   * C'est la mise à l'épreuve de la décision n° 174, et la raison d'être du remaniement. `pdf.ts`
   * n'a pas une ligne qui mentionne le patrimoine, la réconciliation ou la contribution : il itère
   * `model.sections` et sait dessiner six formes de bloc. Un rapport entièrement différent, bâti par
   * un autre constructeur, en sort donc imprimé — titres, tableau, puces, paragraphes.
   *
   * Le seul ajout qu'a demandé ce périmètre est un gabarit de largeurs de colonnes, et c'est le
   * COMPILATEUR qui l'a réclamé : `COLUMN_WIDTHS` est un `Record<TableKind, …>`, donc une entrée
   * manquante est une erreur de type, pas une liste à tenir à jour.
   */
  it('pose aussi le rapport de patrimoine, sans une ligne de rendu en plus', async () => {
    const part = (id: string, label: string, value: string, contributed: string) => ({
      id,
      label,
      // Sans objet pour le rendu : le PDF ne lit pas l'espace d'une ligne.
      space: 'invest' as const,
      firstDay: null,
      valueAt: () => ({ value: D(value), contributed: D(contributed), estimated: false }),
    });
    const points = netWorthSeries({
      contributions: [
        part('invest', 'Investissement', '12000', '10000'),
        part('lending', 'Prêts', '2700', '2250'),
      ],
      days: ['2026-09-20' as DayString],
    });
    const global = buildGlobalReportModel(reconcileNetWorth(latestNetWorth(points))!, {
      discreet: false,
      generatedAt: '2026-09-20T18:00:00.000Z',
      version: '0.1.0',
      timeZone: 'Europe/Paris',
      emptyScopes: ['Trading'],
    });
    const texts = pdfTexts(await buildReportPdf(global));
    const expected = sectionTitles(global);
    expect(expected).toEqual([
      'Synthèse',
      'Contribution par espace',
      'Ce que ce document ne dit pas',
      'Méthodologie',
    ]);
    assertSectionOrder(texts, expected);
    // La garde et le tableau, c'est-à-dire les deux choses que le rendu dessine différemment.
    expect(texts).toContain('Rapport de patrimoine');
    expect(texts).toContain('Apports nets');
    // Et le périmètre vide arrive jusqu’au papier, au lieu de disparaître en route.
    //
    // Sans la puce : le flux est écrit en WinAnsi, où « • » vaut 0x95 et « ’ » 0x92 — décodés en
    // latin1, ce ne sont PAS leurs points de code Unicode. Une assertion qui contient l’un ou
    // l’autre échoue donc sans rien prouver.
    expect(texts.some((t) => t.includes('Trading : aucune donnée'))).toBe(true);
  });

  const opts = {
    discreet: false,
    generatedAt: '2026-09-21T08:00:00.000Z',
    version: '0.1.0',
    timeZone: 'Europe/Paris',
  };

  it('pose le rapport de trading, sans une ligne de rendu en plus', async () => {
    const trading = buildTradingReportModel(
      {
        net: D('600'),
        realized: D('700'),
        fees: D('90'),
        funding: D('-10'),
        unrealized: D('150'),
        equity: D('5200'),
        netFlows: D('4000'),
        accounts: [
          {
            label: 'Compte principal',
            equity: D('5200'),
            net: D('600'),
            realized: D('700'),
            fees: D('90'),
            funding: D('-10'),
            netFlows: D('4000'),
            fills: 120,
          },
        ],
        unvalued: [],
        nativeFeeTokens: [],
        stats: {
          total: 12,
          closed: 12,
          open: 0,
          incomplete: 0,
          excluded: 0,
          wins: 7,
          losses: 5,
          breakeven: 0,
          winRate: D('0.5833'),
          profitFactor: D('1.4'),
          expectancy: D('8'),
          expectancyR: null,
          nR: 0,
          avgWin: D('40'),
          avgLoss: D('-30'),
          payoff: D('1.33'),
          best: D('90'),
          worst: D('-60'),
          netTotal: D('96'),
          grossTotal: D('120'),
          feesTotal: D('20'),
          fundingTotal: D('-4'),
          maxDrawdown: D('75'),
          longestWinStreak: 3,
          longestLossStreak: 2,
          avgHoldSeconds: 3600,
          smallSample: true,
        },
        statsPeriod: 'depuis l’origine',
      },
      opts,
    );
    const texts = pdfTexts(await buildReportPdf(trading));
    const expected = sectionTitles(trading);
    expect(expected).toEqual([
      'Synthèse',
      'Statistiques des trades clos',
      'Comptes',
      'Ce que ce document ne dit pas',
      'Méthodologie',
    ]);
    assertSectionOrder(texts, expected);
    expect(texts).toContain('Rapport de trading');
    // L'avertissement de petit échantillon arrive jusqu'au papier, pas seulement à l'écran.
    expect(texts.some((t) => t.includes('sous 30'))).toBe(true);
  });

  it('pose le rapport de prêts, sans une ligne de rendu en plus', async () => {
    const ok = {
      ok: true as const,
      rate: D('0.05'),
      since: '2025-01-01',
      until: '2026-09-21',
      flowCount: 8,
    };
    const loans = buildLendingReportModel(
      {
        netContributions: D('1000'),
        result: D('14.18'),
        value: D('1014.18'),
        deposits: D('1000'),
        withdrawals: D('0'),
        bonus: D('5'),
        principalLent: D('800'),
        outstanding: D('380'),
        accrued: D('0'),
        cash: D('634.18'),
        interestGross: D('12.11'),
        withheld: D('2.93'),
        interestNet: D('9.18'),
        taxDebitedFromWallet: D('0'),
        writtenOff: D('0'),
        recycling: D('0.8'),
        returnOnContributions: D('0.01418'),
        xirrNet: ok,
        xirrGross: ok,
        accrualUnavailable: 0,
        concentration: {
          index: D('0.12'),
          effectiveCount: D('8.3'),
          top: [{ key: 'Emprunteur A', outstanding: D('120'), weight: D('0.3158') }],
        },
      },
      opts,
    );
    const texts = pdfTexts(await buildReportPdf(loans));
    const expected = sectionTitles(loans);
    expect(expected).toEqual([
      'Synthèse',
      'Détails du compte',
      'Revenus et pertes',
      'Répartition du risque',
      'Ce que ce document ne dit pas',
      'Méthodologie',
    ]);
    assertSectionOrder(texts, expected);
    expect(texts).toContain('Rapport de prêts');
    expect(texts).toContain('Emprunteur A');
  });
});
