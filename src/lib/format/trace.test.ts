/**
 * Rendu français d'une trace. Ce qui se vérifie ici : le mode discret masque les MONTANTS sans
 * toucher à la structure (numéros de ligne, dates, type brut, jambe retenue, source du cours,
 * résidu), et la note « tout est en euros » n'apparaît que quand l'application affiche autre chose.
 */
import { describe, expect, it } from 'vitest';
import { computePortfolio } from '../domain/engine/aggregate';
import { coinhouseTraceRow, traceMetric, type Trace } from '../domain/engine/trace';
import { normalizeCoinhouseRows } from '../import/coinhouse/normalize';
import { DEFAULT_ENGINE_SETTINGS, type RawCoinhouseRow, type RowKey } from '../domain/types';
import { renderTrace, traceToText, type RenderedTraceNode } from './trace';

let seq = 1;
const row = (
  id: string,
  asset: string,
  qty: string,
  valueEur: string | null,
  at = '2026-01-10T10:00:00',
): RawCoinhouseRow => ({
  key: `ch:${id}:${asset}`,
  importId: 'imp:test',
  lineNo: ++seq,
  id,
  at,
  type: 'Echange',
  qty,
  asset,
  marketPrice: null,
  valueEur,
  feeAsset: null,
  feeEur: null,
  feeRebate: null,
  balance: null,
  account: 'Compte principal',
  extra: {},
});

function fixture(metric: 'pru' | 'value' = 'pru'): { trace: Trace; usdcLine: number } {
  const rows = [
    row('100', 'eur', '-9200', '-9200', '2026-01-01T09:00:00'),
    row('100', 'usdc', '10000', '9200', '2026-01-01T09:00:00'),
    row('200', 'btc', '0.5', '10000'),
    row('200', 'usdc', '-10000', '-9200'),
  ];
  const byKey = new Map<RowKey, RawCoinhouseRow>(rows.map((r) => [r.key, r]));
  const events = normalizeCoinhouseRows(rows).events;
  const report = computePortfolio({
    events,
    prices: {
      btc: {
        asset: 'btc',
        priceEur: '30000',
        at: '2026-02-01T09:30:00Z',
        source: 'kraken',
        stale: true,
      },
    },
    settings: DEFAULT_ENGINE_SETTINGS,
  });
  return {
    usdcLine: rows[3]!.lineNo,
    trace: traceMetric({
      report,
      target: { metric, scope: { kind: 'position', asset: 'btc' } },
      settings: DEFAULT_ENGINE_SETTINGS,
      events,
      row: (key) => {
        const found = byKey.get(key);
        return found ? coinhouseTraceRow(found) : null;
      },
    }),
  };
}

const flatten = (node: RenderedTraceNode): RenderedTraceNode[] => [
  node,
  ...node.children.flatMap(flatten),
];

describe('rendu français d’une trace', () => {
  it('nomme la métrique, sa forme et la seule lecture du PRU', () => {
    const { trace } = fixture();
    const rendered = renderTrace(trace, { discreet: false, displayCurrency: 'EUR' });
    expect(rendered.title).toBe('D’où vient ce PRU ?');
    expect(rendered.formula).toContain('÷ quantité détenue');
    expect(rendered.notes.join(' ')).toContain('Une seule lecture du PRU');
    expect(rendered.residual).toContain('retombent exactement');
  });

  it('la note « tout est en euros » n’apparaît que si l’application affiche autre chose', () => {
    const { trace } = fixture();
    expect(
      renderTrace(trace, { discreet: false, displayCurrency: 'EUR' }).notes.join(' '),
    ).not.toContain('en euros, même si');
    expect(
      renderTrace(trace, { discreet: false, displayCurrency: 'USD' }).notes.join(' '),
    ).toContain('en euros, même si');
  });

  it('mode discret : les montants sont masqués, la structure reste entière', () => {
    const { trace, usdcLine } = fixture();
    const rendered = renderTrace(trace, { discreet: true, displayCurrency: 'EUR' });
    const nodes = flatten(rendered.root);
    const text = traceToText(rendered);

    // Aucun montant en clair.
    expect(text).not.toContain('9 200');
    expect(text).not.toContain('10 000');
    // Mais la structure, elle, est intacte.
    expect(nodes.some((n) => n.lineNo === usdcLine)).toBe(true);
    expect(text).toContain(`Ligne du fichier : ${usdcLine}`);
    expect(text).toContain('Type brut : Echange');
    expect(text).toContain('jambe contrepartie retenue');
    // Le PRU est un prix, pas un montant patrimonial : il reste lisible, comme partout ailleurs.
    expect(rendered.amount).not.toBe('');
    expect(rendered.amount).toContain('18');
    expect(rendered.residual).toContain('retombent exactement');
  });

  it('mode discret : le cours garde sa source, sa date et sa fraîcheur', () => {
    const { trace } = fixture('value');
    const text = traceToText(renderTrace(trace, { discreet: true, displayCurrency: 'EUR' }));
    expect(text).toContain('Source : kraken');
    expect(text).toContain('Fraîcheur : périmé');
    expect(text).toContain('Cours du : 01/02/2026');
    expect(text).toContain('fournisseur extérieur');
  });

  it('le texte copiable reprend l’arbre, le contrôle et les réserves', () => {
    const { trace } = fixture();
    const text = traceToText(renderTrace(trace, { discreet: false, displayCurrency: 'EUR' }));
    expect(text.split('\n')[0]).toContain('D’où vient ce PRU ?');
    expect(text).toContain('Coût des unités détenues');
    expect(text).toContain('Contrôle :');
  });
});
