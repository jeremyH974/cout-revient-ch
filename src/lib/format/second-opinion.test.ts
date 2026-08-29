import { describe, expect, it } from 'vitest';
import {
  compareSecondOpinion,
  METRIC_CLASS,
  type ComparableMetric,
  type CostBasisMethod,
  type Divergence,
  type DivergenceCause,
  type InconclusiveReason,
  type SecondOpinionSource,
} from '../domain/second-opinion';
import type { SecondOpinionRefusal } from '../import/second-opinion/detect';
import {
  causeTitle,
  inconclusiveSentence,
  metricClassLabel,
  metricLabel,
  methodLabel,
  renderCounts,
  renderDivergence,
  renderInconclusive,
  renderRefusal,
  renderSource,
  secondOpinionToText,
  toolLabel,
} from './second-opinion';

const OPTS = { discreet: false, currency: 'EUR' as const };

const source = (declaredMethod: CostBasisMethod): SecondOpinionSource => ({
  tool: 'cointracking',
  declaredMethod,
  declaredBy: 'user',
  period: null,
});

const compare = (input: {
  method: CostBasisMethod;
  metric: ComparableMetric;
  ours: string;
  theirs: string;
  operations?: { ours: never[]; theirs: never[] } | null;
}) =>
  compareSecondOpinion({
    source: source(input.method),
    label: 'export.csv',
    importId: 'fmt',
    claims: [
      {
        metric: input.metric,
        asset: 'btc',
        at: null,
        value: input.theirs,
        currency: 'EUR',
        issue: null,
        line: 7,
        verbatim: 'BTC · 1 234,56',
      },
    ],
    ours: [{ metric: input.metric, asset: 'btc', at: null, value: input.ours, trace: null }],
    operations: input.operations ?? null,
    sameScopeConfirmed: true,
  });

const only = (report: ReturnType<typeof compare>): Divergence => {
  const first = report.divergences[0];
  if (first === undefined) throw new Error('aucune divergence produite par le scénario de test');
  return first;
};

// --- Exhaustivité --------------------------------------------------------------------------------

describe('exhaustivité du rendu', () => {
  it('chaque grandeur a un libellé et une classe', () => {
    for (const metric of Object.keys(METRIC_CLASS) as ComparableMetric[]) {
      expect(metricLabel(metric).length).toBeGreaterThan(0);
      expect(metricClassLabel(metric).length).toBeGreaterThan(0);
    }
  });

  it('chaque cause a un intitulé', () => {
    const causes: DivergenceCause[] = ['method', 'scope', 'valuation', 'rounding', 'unexplained'];
    for (const cause of causes) expect(causeTitle(cause).length).toBeGreaterThan(0);
  });

  it('chaque motif de non-comparaison a une phrase', () => {
    const reasons: InconclusiveReason[] = [
      'scope-not-confirmed',
      'method-not-declared',
      'currency-not-eur',
      'value-unreadable',
      'no-figure-of-ours',
      'ambiguous-line',
    ];
    for (const reason of reasons) expect(inconclusiveSentence(reason).length).toBeGreaterThan(0);
  });

  it('chaque motif de refus a une phrase et un repli', () => {
    const reasons: SecondOpinionRefusal[] = [
      'no-calculated-figures',
      'pdf-only',
      'not-yet-comparable',
      'transactions-only',
      'unrecognised',
    ];
    for (const reason of reasons) {
      const rendered = renderRefusal(reason, 'blockpit', ['Prix de cession (213)'], ['A']);
      expect(rendered.title.length).toBeGreaterThan(0);
      expect(rendered.detail.length).toBeGreaterThan(0);
      expect(rendered.fallback).not.toBeNull();
    }
  });

  it('chaque méthode a un libellé', () => {
    const methods: CostBasisMethod[] = [
      'wac',
      'fifo',
      'lifo',
      'hifo',
      'acb',
      'opti',
      'fr-global',
      'unknown',
    ];
    for (const method of methods) expect(methodLabel(method).length).toBeGreaterThan(0);
  });
});

// --- Les phrases ---------------------------------------------------------------------------------

describe('phrases du comparatif', () => {
  it('énonce les deux chiffres sans en désigner un', () => {
    const report = compare({ method: 'wac', metric: 'qty-held', ours: '0.5', theirs: '0.8' });
    const rendered = renderDivergence(only(report), source('wac'), OPTS);
    expect(rendered.comparison).toMatch(/^Votre fichier annonce .+\. Ce moteur calcule .+\.$/);
  });

  it('explique un écart de méthode et n’affiche AUCUN écart chiffré', () => {
    const report = compare({ method: 'fifo', metric: 'pru', ours: '20000', theirs: '21500' });
    const rendered = renderDivergence(only(report), source('fifo'), OPTS);
    expect(rendered.detail).toContain('Écart expliqué par la méthode');
    expect(rendered.detail).toContain('Votre outil déclare FIFO');
    expect(rendered.detail).toContain('coût moyen pondéré invariant à la vente');
    expect(rendered.deltaLabel).toBeNull();
  });

  it('un écart à examiner ne cite JAMAIS le nom d’un éditeur', () => {
    const report = compare({
      method: 'wac',
      metric: 'acquisitions-total',
      ours: '1000',
      theirs: '1200',
    });
    const rendered = renderDivergence(only(report), source('wac'), OPTS);
    expect(rendered.cause).toBe('unexplained');
    expect(rendered.detail).toContain('Écart à examiner');
    for (const brand of ['Waltio', 'CoinTracking', 'CoinTracker', 'Koinly', 'Blockpit']) {
      expect(rendered.detail).not.toContain(brand);
    }
  });

  it('sur une ligne imposée par la loi, l’écart à examiner le dit', () => {
    const report = compareSecondOpinion({
      source: { tool: 'waltio', declaredMethod: 'fr-global', declaredBy: 'file', period: null },
      label: '2086.csv',
      importId: 'fmt',
      claims: [
        {
          metric: 'tax-gain',
          asset: null,
          at: '2026-07-20T00:00:00',
          value: '612.40',
          currency: 'EUR',
          issue: null,
          line: 3,
          verbatim: '20/07/2026 · 612,40',
        },
      ],
      ours: [
        {
          metric: 'tax-gain',
          asset: null,
          at: '2026-07-20T00:00:00',
          value: '549.74',
          trace: null,
        },
      ],
      operations: null,
      sameScopeConfirmed: true,
    });
    const rendered = renderDivergence(
      only(report),
      { tool: 'waltio', declaredMethod: 'fr-global', declaredBy: 'file', period: null },
      OPTS,
    );
    expect(rendered.detail).toContain('imposée par la loi');
    expect(rendered.title).toContain('20/07/2026');
    expect(rendered.deltaLabel).not.toBeNull();
  });

  it('cite la ligne d’origine en preuve, verbatim', () => {
    const report = compare({ method: 'wac', metric: 'qty-held', ours: '0.5', theirs: '0.8' });
    const rendered = renderDivergence(only(report), source('wac'), OPTS);
    expect(rendered.evidenceLabel).toBe('Ligne 7 de votre fichier : « BTC · 1 234,56 »');
  });

  it('nomme le repli pour ce qu’il est : notre calcul sur leurs données', () => {
    const rendered = renderRefusal('no-calculated-figures', 'blockpit', [], []);
    expect(rendered.fallback).toContain('le calcul de ce moteur sur leurs données');
    expect(rendered.fallback).toContain('jamais une méthode');
  });

  it('l’en-tête dit que la question de la méthode ne se pose pas sur une annexe 2086', () => {
    const rendered = renderSource({
      tool: 'waltio',
      declaredMethod: 'fr-global',
      declaredBy: 'file',
      period: { from: '2026-03-15T00:00:00', to: '2026-07-20T00:00:00' },
    });
    expect(rendered).toContain('imposée par la loi');
    expect(rendered).toContain('du 15/03/2026 au 20/07/2026');
  });

  it('une marque n’apparaît que comme nom de format de fichier', () => {
    expect(toolLabel('waltio')).toBe('fichier Waltio');
    expect(toolLabel('unknown')).toBe('fichier');
  });
});

// --- Mode discret --------------------------------------------------------------------------------

describe('mode discret', () => {
  it('masque les montants mais pas les dénombrements', () => {
    const money = compare({
      method: 'wac',
      metric: 'acquisitions-total',
      ours: '1000',
      theirs: '1200',
    });
    const masked = renderDivergence(only(money), source('wac'), { ...OPTS, discreet: true });
    expect(masked.comparison).not.toContain('1 200');

    const count = compareSecondOpinion({
      source: source('wac'),
      label: 'export.csv',
      importId: 'fmt',
      claims: [
        {
          metric: 'operation-count',
          asset: null,
          at: null,
          value: '42',
          currency: null,
          issue: null,
          line: 2,
          verbatim: '42',
        },
      ],
      ours: [{ metric: 'operation-count', asset: null, at: null, value: '40', trace: null }],
      operations: null,
      sameScopeConfirmed: true,
    });
    const counted = renderDivergence(only(count), source('wac'), { ...OPTS, discreet: true });
    expect(counted.comparison).toContain('42');
    expect(counted.comparison).toContain('40');
  });
});

// --- Résumé --------------------------------------------------------------------------------------

describe('résumé et export texte', () => {
  it('ne contient ni score ni classement : des dénombrements', () => {
    const report = compare({ method: 'wac', metric: 'qty-held', ours: '0.5', theirs: '0.8' });
    expect(renderCounts(report)).toBe(
      '1 grandeur lue · 0 concordante · 1 divergente · 0 non comparée.',
    );
  });

  it('le texte collable reprend la comparaison et son imputation', () => {
    const report = compare({ method: 'wac', metric: 'qty-held', ours: '0.5', theirs: '0.8' });
    const text = secondOpinionToText([renderDivergence(only(report), source('wac'), OPTS)]);
    expect(text).toContain('Quantité détenue');
    expect(text).toContain('Votre fichier annonce');
  });

  it('rend une non-comparaison avec sa ligne', () => {
    const rendered = renderInconclusive({
      metric: 'pru',
      asset: 'btc',
      at: null,
      reason: 'method-not-declared',
      line: 9,
      verbatim: 'BTC',
    });
    expect(rendered.title).toBe('Prix de revient unitaire · BTC');
    expect(rendered.detail).toBe(
      'Méthode de calcul non déclarée : la comparaison n’est pas concluante sur cette grandeur.',
    );
    expect(rendered.evidenceLabel).toBe('Ligne 9 de votre fichier.');
  });
});
