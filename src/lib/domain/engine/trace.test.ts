/**
 * Traçabilité : la chaîne d'un montant jusqu'aux lignes brutes.
 *
 * Le cas qui compte le plus est le premier : un achat payé en USDC. La jambe crypto porte une
 * colonne « Contre-valeur (EUR) » qui n'est PAS en euros, et c'est exactement l'erreur que cette
 * fonctionnalité doit rendre visible — la feuille de contrepartie doit citer la ligne USDC.
 */
import { describe, expect, it } from 'vitest';
import { normalizeCoinhouseRows } from '../../import/coinhouse/normalize';
import { D } from '../money';
import { pairTransfers } from '../transfers';
import {
  COINHOUSE_ACCOUNT_ID,
  DEFAULT_ENGINE_SETTINGS,
  type DepositEvent,
  type EngineSettings,
  type LedgerEvent,
  type RawCoinhouseRow,
  type RowKey,
  type WithdrawalEvent,
} from '../types';
import { computePortfolio } from './aggregate';
import type { PriceQuoteInput } from './report';
import {
  coinhouseTraceRow,
  traceMetric,
  type Trace,
  type TraceNode,
  type TraceProvenance,
} from './trace';

// --- Fabrique de lignes brutes -------------------------------------------------------------------

let lineNo = 1;

function row(
  init: Partial<RawCoinhouseRow> & Pick<RawCoinhouseRow, 'id' | 'asset' | 'qty'>,
): RawCoinhouseRow {
  const at = init.at ?? '2026-01-10T10:00:00';
  const type = init.type ?? 'Echange';
  return {
    key: `ch:${init.id}:${init.asset}`,
    importId: 'imp:test',
    lineNo: ++lineNo,
    id: init.id,
    at,
    type,
    qty: init.qty,
    asset: init.asset,
    marketPrice: init.marketPrice ?? null,
    valueEur: init.valueEur ?? null,
    feeAsset: init.feeAsset ?? null,
    feeEur: init.feeEur ?? null,
    feeRebate: init.feeRebate ?? null,
    balance: init.balance ?? null,
    account: 'Compte principal',
    extra: {},
  };
}

const quote = (asset: string, priceEur: string): PriceQuoteInput => ({
  asset,
  priceEur,
  at: '2026-02-01T09:30:00Z',
  source: 'coingecko',
  stale: false,
});

interface Built {
  trace: (metric: Parameters<typeof traceMetric>[0]['target']['metric'], asset: string) => Trace;
  events: LedgerEvent[];
}

function build(
  rows: RawCoinhouseRow[],
  prices: Record<string, PriceQuoteInput> = {},
  settings: EngineSettings = DEFAULT_ENGINE_SETTINGS,
  extraEvents: readonly LedgerEvent[] = [],
): Built {
  const byKey = new Map<RowKey, RawCoinhouseRow>(rows.map((r) => [r.key, r]));
  const events = [...normalizeCoinhouseRows(rows).events, ...extraEvents];
  const report = computePortfolio({ events, prices, settings });
  return {
    events,
    trace: (metric, asset) =>
      traceMetric({
        report,
        target: { metric, scope: { kind: 'position', asset } },
        settings,
        events,
        row: (key) => {
          const found = byKey.get(key);
          return found ? coinhouseTraceRow(found) : null;
        },
      }),
  };
}

// --- Parcours de l'arbre -------------------------------------------------------------------------

function flatten(node: TraceNode): TraceNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function rawRows(trace: Trace): Extract<TraceProvenance, { kind: 'raw-row' }>[] {
  return flatten(trace.root)
    .map((n) => n.provenance)
    .filter((p): p is Extract<TraceProvenance, { kind: 'raw-row' }> => p.kind === 'raw-row');
}

const nodesWithGap = (trace: Trace, gap: string): TraceNode[] =>
  flatten(trace.root).filter((n) => n.gap === gap);

const find = (trace: Trace, role: string): TraceNode | undefined =>
  flatten(trace.root).find((n) => n.role === role);

// --- Jeux d'essai --------------------------------------------------------------------------------

/** Achat de 0,5 BTC payé 10 000 USDC, qui valent 9 200 €. La jambe BTC ment, la jambe USDC non. */
const usdcPurchase = (): RawCoinhouseRow[] => [
  row({ id: '100', asset: 'eur', qty: '-9200', valueEur: '-9200', at: '2026-01-01T09:00:00' }),
  row({ id: '100', asset: 'usdc', qty: '10000', valueEur: '9200', at: '2026-01-01T09:00:00' }),
  // Jambe actif : « Contre-valeur (EUR) » exprimée en USDC — le piège de l'export.
  row({ id: '200', asset: 'btc', qty: '0.5', valueEur: '10000', marketPrice: '20000' }),
  row({ id: '200', asset: 'usdc', qty: '-10000', valueEur: '-9200', marketPrice: '0.92' }),
];

describe('traçabilité — la règle d’or est enfin auditable', () => {
  it('un achat payé en USDC cite la ligne USDC, jamais la jambe crypto libellée « EUR »', () => {
    const rows = usdcPurchase();
    const { trace } = build(rows, { btc: quote('btc', '30000') });
    const t = trace('cost-basis', 'btc');

    const counter = rawRows(t).find((p) => p.role === 'counter-leg');
    expect(counter).toBeDefined();
    expect(counter!.asset).toBe('usdc');
    expect(counter!.valueEur).toBe('-9200');
    expect(counter!.lineNo).toBe(rows[3]!.lineNo);

    // Le montant retenu est bien 9 200 € (la contrepartie), pas 10 000 (la jambe crypto).
    expect(D(t.amount!).eq('9200')).toBe(true);
    // Et la jambe actif est citée, sans apporter un centime.
    const assetLeg = rawRows(t).find((p) => p.role === 'asset-leg');
    expect(assetLeg?.asset).toBe('btc');
    const assetNode = flatten(t.root).find(
      (n) => n.provenance.kind === 'raw-row' && n.provenance.role === 'asset-leg',
    );
    expect(assetNode?.amount).toBeNull();
  });

  it('l’événement cité porte la jambe contrepartie retenue et sa source', () => {
    const { trace } = build(usdcPurchase(), { btc: quote('btc', '30000') });
    const event = flatten(trace('cost-basis', 'btc').root)
      .map((n) => n.provenance)
      .find((p) => p.kind === 'event');
    expect(event).toBeDefined();
    if (event?.kind !== 'event') throw new Error('événement absent');
    expect(event.counterRowKey).toBe('ch:200:usdc');
    expect(event.valueEurSource).toBe('counter-leg');
    expect(event.accountId).toBe(COINHOUSE_ACCOUNT_ID);
  });
});

describe('traçabilité — les formes de calcul', () => {
  it('PRU = Σ des lots restants ÷ quantité détenue, et ça boucle', () => {
    const { trace } = build(
      [
        row({ id: '1', asset: 'eur', qty: '-1000', valueEur: '-1000', at: '2026-01-01T10:00:00' }),
        row({ id: '1', asset: 'btc', qty: '1', valueEur: '1000', at: '2026-01-01T10:00:00' }),
        row({ id: '2', asset: 'eur', qty: '-3000', valueEur: '-3000', at: '2026-01-02T10:00:00' }),
        row({ id: '2', asset: 'btc', qty: '1', valueEur: '3000', at: '2026-01-02T10:00:00' }),
      ],
      { btc: quote('btc', '5000') },
    );
    const t = trace('pru', 'btc');
    expect(t.unit).toBe('price');
    expect(D(t.amount!).eq('2000')).toBe(true);
    expect(t.root.operator).toBe('quotient');
    expect(t.residual).toBe('0');

    const costBasis = find(t, 'cost-basis')!;
    expect(costBasis.operator).toBe('sum');
    expect(costBasis.children).toHaveLength(2);
    const sum = costBasis.children.reduce((acc, c) => acc.plus(D(c.amount!)), D('0'));
    expect(sum.eq(D(costBasis.amount!))).toBe(true);
    expect(find(t, 'quantity')?.unit).toBe('qty');
  });

  it('réalisé d’une vente = produit − Σ des lots consommés', () => {
    const { trace } = build(
      [
        row({ id: '1', asset: 'eur', qty: '-1000', valueEur: '-1000', at: '2026-01-01T10:00:00' }),
        row({ id: '1', asset: 'btc', qty: '1', valueEur: '1000', at: '2026-01-01T10:00:00' }),
        row({ id: '2', asset: 'eur', qty: '-3000', valueEur: '-3000', at: '2026-01-02T10:00:00' }),
        row({ id: '2', asset: 'btc', qty: '1', valueEur: '3000', at: '2026-01-02T10:00:00' }),
        row({ id: '3', asset: 'btc', qty: '-1', valueEur: '-2500', at: '2026-01-03T10:00:00' }),
        row({ id: '3', asset: 'eur', qty: '2500', valueEur: '2500', at: '2026-01-03T10:00:00' }),
      ],
      { btc: quote('btc', '5000') },
    );
    const t = trace('realized', 'btc');
    // Vendu 2 500 €, PRU 2 000 € : +500 €.
    expect(D(t.amount!).eq('500')).toBe(true);
    expect(t.residual).toBe('0');

    const sale = t.root.children[0]!;
    expect(sale.operator).toBe('difference');
    const [proceeds, costOfSale] = sale.children as [TraceNode, TraceNode];
    expect(D(proceeds.amount!).eq('2500')).toBe(true);
    expect(costOfSale.role).toBe('cost-of-sale');
    expect(D(costOfSale.amount!).eq('-2000')).toBe(true);
    // Les DEUX lots ont été consommés au prorata : c'est le CUMP, pas du FIFO.
    expect(costOfSale.children).toHaveLength(2);
    const consumed = costOfSale.children.reduce((acc, c) => acc.plus(D(c.amount!)), D('0'));
    expect(consumed.eq('-2000')).toBe(true);
    for (const lot of costOfSale.children) expect(lot.provenance.kind).toBe('lot');
  });

  it('la valeur est un produit dont la feuille cours est un trou nommé, daté et sourcé', () => {
    const { trace } = build(
      [
        row({ id: '1', asset: 'eur', qty: '-1000', valueEur: '-1000' }),
        row({ id: '1', asset: 'btc', qty: '1', valueEur: '1000' }),
      ],
      { btc: quote('btc', '5000') },
    );
    const t = trace('value', 'btc');
    expect(t.root.operator).toBe('product');
    expect(t.gaps).toContain('external-quote');
    const quoteNode = find(t, 'quote')!;
    expect(quoteNode.gap).toBe('external-quote');
    expect(quoteNode.unit).toBe('price');
    if (quoteNode.provenance.kind !== 'quote') throw new Error('provenance de cours attendue');
    expect(quoteNode.provenance.source).toBe('coingecko');
    expect(quoteNode.provenance.at).toBe('2026-02-01T09:30:00Z');
    expect(quoteNode.provenance.stale).toBe(false);
  });

  it('le latent est une différence qui boucle : valeur − coût des lots restants', () => {
    const { trace } = build(
      [
        row({ id: '1', asset: 'eur', qty: '-1000', valueEur: '-1000' }),
        row({ id: '1', asset: 'btc', qty: '1', valueEur: '1000' }),
      ],
      { btc: quote('btc', '5000') },
    );
    const t = trace('unrealized', 'btc');
    expect(D(t.amount!).eq('4000')).toBe(true);
    expect(t.root.operator).toBe('difference');
    const sum = t.root.children.reduce((acc, c) => acc.plus(D(c.amount!)), D('0'));
    expect(sum.eq('4000')).toBe(true);
    expect(t.residual).toBe('0');
  });

  it('les frais se décomposent en frais bruts moins remises', () => {
    const { trace } = build(
      [
        row({
          id: '1',
          asset: 'eur',
          qty: '-1000',
          valueEur: '-1000',
          feeAsset: '20',
          feeEur: '20',
          feeRebate: '5',
        }),
        row({ id: '1', asset: 'btc', qty: '1', valueEur: '1000' }),
      ],
      { btc: quote('btc', '5000') },
    );
    const t = trace('fees', 'btc');
    expect(D(t.amount!).eq('15')).toBe(true);
    expect(t.root.operator).toBe('difference');
    expect(t.residual).toBe('0');
    const rebate = find(t, 'rebate')!;
    expect(D(rebate.amount!).eq('-5')).toBe(true);
  });
});

describe('traçabilité — les trous sont nommés, jamais comblés', () => {
  it('une position à qualifier porte un enfant à contribution nulle citant ses lignes', () => {
    const rows = [
      row({ id: '1', asset: 'eur', qty: '-1000', valueEur: '-1000' }),
      row({ id: '1', asset: 'btc', qty: '1', valueEur: '1000' }),
      row({
        id: '9',
        asset: 'btc',
        qty: '0.1',
        type: 'Opération martienne',
        at: '2026-01-20T10:00:00',
      }),
    ];
    const { trace } = build(rows, { btc: quote('btc', '5000') });
    const t = trace('pru', 'btc');
    expect(t.gaps).toContain('unqualified-row');
    const gapNodes = nodesWithGap(t, 'unqualified-row');
    expect(gapNodes).toHaveLength(1);
    expect(gapNodes[0]!.amount).toBe('0');
    if (gapNodes[0]!.provenance.kind !== 'unqualified') throw new Error('provenance attendue');
    expect(gapNodes[0]!.provenance.rowKeys).toContain(rows[2]!.key);
    // Le trou ne change pas le chiffre : il le qualifie.
    expect(t.residual).toBe('0');
  });

  it('une migration en coût reporté marque le lot d’un trou « coût reporté »', () => {
    const { trace } = build(
      [
        row({ id: '1', asset: 'eur', qty: '-1000', valueEur: '-1000', at: '2026-01-01T10:00:00' }),
        row({ id: '1', asset: 'aaa', qty: '100', valueEur: '1000', at: '2026-01-01T10:00:00' }),
        // Échange crypto ↔ crypto sans contrepartie en euros : migration, coût reporté.
        row({ id: '2', asset: 'aaa', qty: '-100', valueEur: '-1200', at: '2026-02-01T10:00:00' }),
        row({ id: '2', asset: 'bbb', qty: '50', valueEur: '1200', at: '2026-02-01T10:00:00' }),
      ],
      { bbb: quote('bbb', '30') },
    );
    const t = trace('cost-basis', 'bbb');
    expect(D(t.amount!).eq('1000')).toBe(true);
    expect(t.gaps).toContain('carried-cost');
    expect(t.settings).toContainEqual({ key: 'migrationMode', value: 'carry-cost' });
    const lot = find(t, 'lot')!;
    expect(lot.gap).toBe('carried-cost');
  });

  it('un dépôt apparié cite le retrait de l’autre compte', () => {
    const withdrawal: WithdrawalEvent = {
      kind: 'withdrawal',
      id: 'man:w1',
      at: '2026-03-01T10:00:00',
      source: 'manual',
      scope: 'external',
      accountId: 'man:kraken',
      rowKeys: [],
      warnings: [],
      out: { asset: 'btc', qty: '1' },
      proceedsEur: null,
    };
    const deposit: DepositEvent = {
      kind: 'deposit',
      id: 'man:d1',
      at: '2026-03-01T12:00:00',
      source: 'manual',
      scope: 'external',
      accountId: 'man:ledger',
      rowKeys: [],
      warnings: [],
      in: { asset: 'btc', qty: '1' },
      costEur: null,
    };
    const opening: LedgerEvent = {
      kind: 'opening-balance',
      id: 'man:o1',
      at: '2026-01-01T10:00:00',
      source: 'manual',
      scope: 'external',
      accountId: 'man:kraken',
      rowKeys: [],
      warnings: [],
      in: { asset: 'btc', qty: '1' },
      costEur: '20000',
    };
    const paired = pairTransfers([opening, withdrawal, deposit]);
    expect(paired.pairs).toHaveLength(1);
    const { trace } = build(
      [],
      { btc: quote('btc', '30000') },
      DEFAULT_ENGINE_SETTINGS,
      paired.events,
    );
    const t = trace('cost-basis', 'btc');
    expect(t.gaps).toContain('transfer-from-other-account');
    const linked = nodesWithGap(t, 'transfer-from-other-account').find(
      (n) => n.role === 'withdrawal',
    );
    expect(linked).toBeDefined();
    if (linked?.provenance.kind !== 'event') throw new Error('événement attendu');
    expect(linked.provenance.eventId).toBe('man:w1');
    expect(linked.provenance.accountId).toBe('man:kraken');
    // Le coût a voyagé : 20 000 € ouverts sur Kraken, 20 000 € détenus sur le Ledger.
    expect(D(t.amount!).eq('20000')).toBe(true);
  });

  it('une ligne absente du magasin devient un trou « ligne indisponible », pas une invention', () => {
    const rows = [
      row({ id: '1', asset: 'eur', qty: '-1000', valueEur: '-1000' }),
      row({ id: '1', asset: 'btc', qty: '1', valueEur: '1000' }),
    ];
    const events = normalizeCoinhouseRows(rows).events;
    const report = computePortfolio({ events, prices: {}, settings: DEFAULT_ENGINE_SETTINGS });
    const t = traceMetric({
      report,
      target: { metric: 'cost-basis', scope: { kind: 'position', asset: 'btc' } },
      settings: DEFAULT_ENGINE_SETTINGS,
      events,
      row: () => null,
    });
    expect(t.gaps).toContain('row-unavailable');
    expect(rawRows(t)).toHaveLength(0);
  });

  it('le plafond de contributions garde le bouclage juste et compte les omises', () => {
    const rows: RawCoinhouseRow[] = [];
    for (let i = 0; i < 12; i++) {
      const day = String(i + 1).padStart(2, '0');
      rows.push(
        row({
          id: `${i}`,
          asset: 'eur',
          qty: '-100',
          valueEur: '-100',
          at: `2026-01-${day}T10:00:00`,
        }),
        row({
          id: `${i}`,
          asset: 'btc',
          qty: '0.1',
          valueEur: '100',
          at: `2026-01-${day}T10:00:00`,
        }),
      );
    }
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const events = normalizeCoinhouseRows(rows).events;
    const report = computePortfolio({
      events,
      prices: { btc: quote('btc', '5000') },
      settings: DEFAULT_ENGINE_SETTINGS,
    });
    const t = traceMetric({
      report,
      target: { metric: 'cost-basis', scope: { kind: 'position', asset: 'btc' } },
      settings: DEFAULT_ENGINE_SETTINGS,
      events,
      maxChildren: 5,
      row: (key) => {
        const found = byKey.get(key);
        return found ? coinhouseTraceRow(found) : null;
      },
    });
    expect(t.omitted).toBe(8);
    expect(t.gaps).toContain('truncated');
    expect(t.residual).toBe('0');
    expect(t.root.children).toHaveLength(5);
    expect(D(t.amount!).eq('1200')).toBe(true);
  });
});

describe('traçabilité — déterminisme et portées', () => {
  it('deux appels rendent exactement le même arbre', () => {
    const rows = usdcPurchase();
    const { trace } = build(rows, { btc: quote('btc', '30000') });
    expect(JSON.stringify(trace('total', 'btc'))).toBe(JSON.stringify(trace('total', 'btc')));
  });

  it('le total du portefeuille se décompose en réalisé, latent et récompenses', () => {
    const rows = usdcPurchase();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const events = normalizeCoinhouseRows(rows).events;
    const report = computePortfolio({
      events,
      prices: { btc: quote('btc', '30000'), usdc: quote('usdc', '0.92') },
      settings: DEFAULT_ENGINE_SETTINGS,
    });
    const t = traceMetric({
      report,
      target: { metric: 'total', scope: { kind: 'portfolio' } },
      settings: DEFAULT_ENGINE_SETTINGS,
      events,
      row: (key) => {
        const found = byKey.get(key);
        return found ? coinhouseTraceRow(found) : null;
      },
    });
    expect(t.residual).toBe('0');
    expect(D(t.amount!).eq(report.totals.total)).toBe(true);
    expect(t.root.children.map((c) => c.role)).toEqual(['realized', 'unrealized', 'other-income']);
  });
});
