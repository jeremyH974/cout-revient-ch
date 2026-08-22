import { describe, expect, it } from 'vitest';
import { computePortfolio, type PriceQuoteInput } from '../domain/engine';
import { DEFAULT_ENGINE_SETTINGS, type LedgerEvent, type TradeEvent } from '../domain/types';
import {
  buildReportModel,
  type ReportKpi,
  type ReportModel,
  type ReportTable,
} from './report-model';

const nbsp = (s: string): string => s.replace(/[\u00a0\u202f]/g, ' ');

let seq = 0;
const base = () => ({
  id: `t${++seq}`,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  rowKeys: [],
  warnings: [],
});
const buy = (at: string, asset: string, qty: string, eur: string): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset: 'eur', qty: eur },
  in: { asset, qty },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const sell = (at: string, asset: string, qty: string, eur: string): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset, qty },
  in: { asset: 'eur', qty: eur },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const price = (asset: string, eur: string): PriceQuoteInput => ({
  asset,
  priceEur: eur,
  at: '2026-08-22T10:00:00Z',
  source: 'test',
  stale: false,
});

// Exemple canonique (btc) + stablecoin + position clôturée.
const events: LedgerEvent[] = [
  buy('2026-01-01T10:00:00', 'btc', '1', '100'),
  buy('2026-01-02T10:00:00', 'btc', '1', '200'),
  sell('2026-01-03T10:00:00', 'btc', '1', '300'),
  buy('2026-01-04T10:00:00', 'btc', '1', '150'),
  buy('2026-02-01T10:00:00', 'usdc', '1000', '900'),
  buy('2026-03-01T10:00:00', 'ada', '10', '50'),
  sell('2026-03-05T10:00:00', 'ada', '10', '70'),
];
const report = computePortfolio({
  events,
  prices: { btc: price('btc', '250'), usdc: price('usdc', '0.88') },
  settings: DEFAULT_ENGINE_SETTINGS,
});
const opts = {
  discreet: false,
  generatedAt: '2026-08-22T10:00:00.000Z',
  version: '0.1.0',
  timeZone: 'Europe/Paris',
};
const model = buildReportModel(report, opts);

const fact = (m: ReportModel, label: string): string | undefined =>
  m.cover.facts.find((f) => f.label === label)?.value;
const kpi = (list: ReportKpi[], label: string): ReportKpi | undefined =>
  list.find((k) => k.label === label);
const texts = (table: ReportTable, row: number): string[] =>
  (table.rows[row] ?? []).map((c) => nbsp(c.text));

describe('modèle de rapport — page de garde et synthèse', () => {
  it('date locale, devise, période couverte et nombre d’opérations', () => {
    expect(model.meta.generatedLabel).toBe('22/08/2026 à 12:00');
    expect(model.meta.dateStamp).toBe('2026-08-22');
    expect(model.meta.currency).toBe('EUR');
    expect(fact(model, 'Devise')).toBe('EUR');
    expect(fact(model, 'Période couverte')).toBe('du 01/01/2026 au 05/03/2026');
    expect(fact(model, 'Opérations')).toBe('7');
    expect(fact(model, 'Positions')).toBe('2 ouvertes · 1 clôturée');
    expect(fact(model, 'Cours')).toBe('au 22/08/2026 à 12:00');
    expect(model.cover.disclaimer).toContain('150 VH bis');
    expect(model.cover.notes).toEqual([]);
    expect(model.footer.right).toBe('Généré le 22/08/2026 à 12:00');
    expect(model.footer.left).toContain('version 0.1.0');
  });

  it('indicateurs de synthèse formatés et colorés', () => {
    const k = model.summary.kpis;
    expect(nbsp(kpi(k, 'Investi')?.value ?? '')).toBe('1 200,00 €');
    expect(nbsp(kpi(k, 'Valeur')?.value ?? '')).toBe('1 380,00 €');
    expect(nbsp(kpi(k, 'Latent')?.value ?? '')).toBe('+180,00 €');
    expect(kpi(k, 'Latent')?.tone).toBe('gain');
    expect(nbsp(kpi(k, 'Réalisé')?.value ?? '')).toBe('+170,00 €');
    expect(nbsp(kpi(k, 'P&L total')?.value ?? '')).toBe('+350,00 €');
    expect(kpi(k, 'P&L total')?.tone).toBe('gain');
    expect(nbsp(kpi(k, 'ROI')?.value ?? '')).toBe('+25,0 %');
    expect(nbsp(kpi(k, 'ROI')?.hint ?? '')).toBe('sur 1 400,00 € achetés');
    const d = model.summary.details;
    expect(nbsp(kpi(d, 'Apports nets en euros')?.value ?? '')).toBe('1 030,00 €');
    expect(nbsp(kpi(d, 'Net investi')?.value ?? '')).toBe('1 030,00 €');
    expect(kpi(d, 'Abonnements Coinhouse')?.hint).toBe('hors P&L');
    const inPnl = buildReportModel(report, { ...opts, subscriptionsInPnl: true });
    expect(kpi(inPnl.summary.details, 'Abonnements Coinhouse')?.hint).toBe(
      'inclus dans le P&L total',
    );
  });
});

describe('modèle de rapport — tableaux', () => {
  it('positions ouvertes : une ligne par actif, total cohérent', () => {
    const p = model.positions;
    expect(p.rows).toHaveLength(1);
    expect(texts(p, 0)).toEqual([
      'BTC',
      '2',
      '150,00 €',
      '250,00 €',
      '500,00 €',
      '+200,00 €',
      '+66,7 %',
      '+150,00 €',
      '+350,00 €',
    ]);
    expect(p.rows[0]?.[0]?.sub).toBe('Bitcoin');
    expect(p.rows[0]?.map((c) => c.tone)).toEqual([
      'neutral',
      'neutral',
      'neutral',
      'neutral',
      'neutral',
      'gain',
      'gain',
      'gain',
      'gain',
    ]);
    expect(p.total?.map((c) => nbsp(c.text))).toEqual([
      'Total',
      '',
      '',
      '',
      '500,00 €',
      '+200,00 €',
      '+66,7 %',
      '+150,00 €',
      '+350,00 €',
    ]);
  });

  it('stablecoins : effet de change, zéro sans signe', () => {
    const s = model.stablecoins;
    expect(texts(s, 0)).toEqual([
      'USDC',
      '1 000',
      '0,90 €',
      '0,88 €',
      '880,00 €',
      '−20,00 €',
      '−2,2 %',
      '0,00 €',
      '−20,00 €',
    ]);
    expect(s.rows[0]?.[5]?.tone).toBe('loss');
    expect(s.rows[0]?.[7]?.tone).toBe('neutral');
    expect(s.note).toContain('effet de change');
  });

  it('positions clôturées : réalisé, nombre et date de la dernière opération', () => {
    const c = model.closed;
    expect(texts(c, 0)).toEqual(['ADA', '+20,00 €', '2', '05/03/2026']);
    expect(c.rows[0]?.[0]?.sub).toBe('Cardano');
    expect(c.total?.map((x) => nbsp(x.text))).toEqual(['Total', '+20,00 €', '2', '']);
  });

  it('répartition : parts sans signe, total 100 %', () => {
    const a = model.allocation;
    expect(texts(a, 0)).toEqual(['USDC', '880,00 €', '63,8 %']);
    expect(texts(a, 1)).toEqual(['BTC', '500,00 €', '36,2 %']);
    expect(a.total?.map((x) => nbsp(x.text))).toEqual(['Total', '1 380,00 €', '100,0 %']);
  });

  it('chaque ligne a autant de cellules que de colonnes', () => {
    for (const table of [model.allocation, model.positions, model.stablecoins, model.closed]) {
      for (const row of table.rows) expect(row, table.kind).toHaveLength(table.columns.length);
      if (table.total) expect(table.total, table.kind).toHaveLength(table.columns.length);
    }
  });
});

describe('modèle de rapport — mode discret et rapport vide', () => {
  it('masque montants et quantités, conserve pourcentages et prix', () => {
    const d = buildReportModel(report, { ...opts, discreet: true });
    expect(d.meta.discreet).toBe(true);
    expect(d.cover.notes[0]).toContain('Mode discret');
    expect(kpi(d.summary.kpis, 'Investi')?.value).toBe('••••');
    expect(kpi(d.summary.kpis, 'P&L total')?.value).toBe('••••');
    expect(nbsp(kpi(d.summary.kpis, 'ROI')?.value ?? '')).toBe('+25,0 %');
    expect(kpi(d.summary.kpis, 'ROI')?.hint).toBe('sur •••• achetés');
    expect(texts(d.positions, 0)).toEqual([
      'BTC',
      '••••',
      '••••',
      '250,00 €',
      '••••',
      '••••',
      '+66,7 %',
      '••••',
      '••••',
    ]);
    expect(d.positions.total?.[4]?.text).toBe('••••');
    expect(texts(d.allocation, 0)).toEqual(['USDC', '••••', '63,8 %']);
    expect(texts(d.closed, 0)).toEqual(['ADA', '••••', '2', '05/03/2026']);
  });

  it('rapport sans opération : tableaux vides, totaux absents', () => {
    const empty = buildReportModel(
      computePortfolio({ events: [], prices: {}, settings: DEFAULT_ENGINE_SETTINGS }),
      opts,
    );
    expect(fact(empty, 'Période couverte')).toBe('aucune opération');
    expect(fact(empty, 'Opérations')).toBe('0');
    expect(fact(empty, 'Cours')).toBe('aucun cours chargé');
    for (const table of [empty.allocation, empty.positions, empty.stablecoins, empty.closed]) {
      expect(table.rows).toEqual([]);
      expect(table.total).toBeNull();
      expect(table.emptyText.length).toBeGreaterThan(0);
    }
    expect(kpi(empty.summary.kpis, 'ROI')?.value).toBe('—');
  });

  it('actif sans cours : signalé en page de garde et dans le tableau', () => {
    const noPrice = buildReportModel(
      computePortfolio({
        events: [buy('2026-01-01T10:00:00', 'xyz', '3', '30')],
        prices: {},
        settings: DEFAULT_ENGINE_SETTINGS,
      }),
      opts,
    );
    expect(noPrice.cover.notes).toEqual([
      '1 actif sans cours, exclu de la valeur et du latent : XYZ.',
    ]);
    expect(noPrice.positions.note).toContain('XYZ');
    expect(texts(noPrice.positions, 0).slice(3, 6)).toEqual(['—', '—', '—']);
    expect(noPrice.positions.rows[0]?.[0]?.sub).toBeNull();
  });
});
