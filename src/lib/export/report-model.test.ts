import { describe, expect, it } from 'vitest';
import { computePortfolio, type PortfolioReport, type PriceQuoteInput } from '../domain/engine';
import { D, ZERO, type Big } from '../domain/money';
import { buildInsights } from '../domain/insights';
import { riskMetrics } from '../domain/risk';
import { computeFrenchTax } from '../domain/tax-fr';
import { xirrEur } from '../domain/xirr';
import { DEFAULT_ENGINE_SETTINGS, type LedgerEvent, type TradeEvent } from '../domain/types';
import { MASK, fmtMoney, fmtPct } from '../format/fr';
import { renderInsights } from '../format/insights';
import {
  buildReportModel,
  type ReportKpi,
  type ReportModel,
  type ReportTable,
} from './report-model';

/** Espaces insécables d'Intl (U+00A0, U+202F) → espace simple, sans caractère invisible dans la source. */
const SPACES = new RegExp('[' + String.fromCharCode(0xa0, 0x202f) + ']', 'g');
const nbsp = (s: string): string => s.replace(SPACES, ' ');
const money = (value: Big | null, sign = false): string => nbsp(fmtMoney(value, 'EUR', { sign }));

let seq = 0;
const base = () => ({
  id: `t${++seq}`,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main' as const,
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
const compute = (events: LedgerEvent[], prices: Record<string, PriceQuoteInput>): PortfolioReport =>
  computePortfolio({ events, prices, settings: DEFAULT_ENGINE_SETTINGS });

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
const report = compute(events, { btc: price('btc', '250'), usdc: price('usdc', '0.88') });
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
const totalTexts = (table: ReportTable): string[] | undefined =>
  table.total?.map((c) => nbsp(c.text));

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

  it('indicateurs de synthèse formatés, colorés, avec leur base', () => {
    const k = model.summary.kpis;
    expect(nbsp(kpi(k, 'Investi')?.value ?? '')).toBe('1 200,00 €');
    expect(kpi(k, 'Investi')?.hint).toBe('quantité détenue × PRU');
    expect(nbsp(kpi(k, 'Valeur')?.value ?? '')).toBe('1 380,00 €');
    expect(nbsp(kpi(k, 'Latent')?.value ?? '')).toBe('+180,00 €');
    expect(kpi(k, 'Latent')?.tone).toBe('gain');
    expect(nbsp(kpi(k, 'Réalisé')?.value ?? '')).toBe('+170,00 €');
    expect(nbsp(kpi(k, 'P&L total')?.value ?? '')).toBe('+350,00 €');
    expect(kpi(k, 'P&L total')?.tone).toBe('gain');
    expect(kpi(k, 'P&L total')?.hint).toBe('réalisé + latent');
    // Le ROI est rapporté au capital maximal engagé, défini par le moteur : le libellé le suit.
    const t = report.totals;
    expect(t.roiBase.gt(ZERO)).toBe(true);
    expect(nbsp(kpi(k, 'ROI')?.value ?? '')).toBe(nbsp(fmtPct(t.roi)));
    expect(nbsp(kpi(k, 'ROI')?.hint ?? '')).toBe(`sur ${money(t.roiBase)} engagés`);
    const d = model.summary.details;
    expect(nbsp(kpi(d, 'Apports nets (espèces)')?.value ?? '')).toBe('1 030,00 €');
    expect(nbsp(kpi(d, 'Net investi')?.value ?? '')).toBe('1 030,00 €');
    expect(kpi(d, 'Abonnements Coinhouse')?.hint).toBe('hors P&L');
    const inPnl = buildReportModel(report, { ...opts, subscriptionsInPnl: true });
    expect(kpi(inPnl.summary.details, 'Abonnements Coinhouse')?.hint).toBe('déduits du P&L total');
    expect(kpi(inPnl.summary.kpis, 'P&L total')?.hint).toBe('réalisé + latent − abonnements');
  });
});

describe('modèle de rapport — tableaux', () => {
  it('positions ouvertes : une ligne par actif, % avec sa base, total cohérent', () => {
    const p = model.positions;
    expect(p.columns[6]?.label).toBe('Latent % vs PRU');
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
    expect(totalTexts(p)).toEqual([
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

  it('stablecoins : effet de change, zéro sans signe ni couleur', () => {
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

  it('positions clôturées : réalisé, résidu, total, nombre et date de la dernière opération', () => {
    const c = model.closed;
    expect(c.columns.map((col) => col.label)).toEqual([
      'Actif',
      'Réalisé',
      'Résidu latent',
      'Total',
      'Opérations',
      'Dernière opération',
    ]);
    expect(texts(c, 0)).toEqual(['ADA', '+20,00 €', '—', '+20,00 €', '2', '05/03/2026']);
    expect(c.rows[0]?.[0]?.sub).toBe('Cardano');
    expect(totalTexts(c)).toEqual(['Total', '+20,00 €', '—', '+20,00 €', '2', '']);
    expect(c.note).not.toContain('Dont résidus');
  });

  it('répartition : parts sans signe, total 100 %', () => {
    const a = model.allocation;
    expect(texts(a, 0)).toEqual(['USDC', '880,00 €', '63,8 %']);
    expect(texts(a, 1)).toEqual(['BTC', '500,00 €', '36,2 %']);
    expect(totalTexts(a)).toEqual(['Total', '1 380,00 €', '100,0 %']);
  });

  it('chaque ligne a autant de cellules que de colonnes', () => {
    for (const table of [model.allocation, model.positions, model.stablecoins, model.closed]) {
      for (const row of table.rows) expect(row, table.kind).toHaveLength(table.columns.length);
      if (table.total) expect(table.total, table.kind).toHaveLength(table.columns.length);
    }
  });
});

describe('modèle de rapport — cas limites', () => {
  it('PRU inférieur au centime : formaté comme un prix, jamais « 0,00 € »', () => {
    const pepe = compute([buy('2026-01-01T10:00:00', 'pepe', '40909000', '158.97')], {
      pepe: price('pepe', '0.000005'),
    });
    const row = texts(buildReportModel(pepe, opts).positions, 0);
    expect(row[2]).toBe('0,000003886 €');
    expect(row[3]).toBe('0,000005 €');
    // Le PRU est un prix : il reste visible en mode discret, comme le cours.
    const discreet = texts(buildReportModel(pepe, { ...opts, discreet: true }).positions, 0);
    expect(discreet.slice(1, 5)).toEqual(['••••', '0,000003886 €', '0,000005 €', '••••']);
  });

  it('poussière : clôturée avec son résidu latent, la somme des tableaux égale le P&L total', () => {
    const dust = compute(
      [
        buy('2026-01-01T10:00:00', 'btc', '1', '100'),
        buy('2026-01-02T10:00:00', 'xyz', '1000', '50'),
      ],
      { btc: price('btc', '120'), xyz: price('xyz', '0.000004') },
    );
    expect(dust.closed.map((p) => p.asset)).toEqual(['xyz']);
    const m = buildReportModel(dust, opts);
    expect(texts(m.closed, 0)).toEqual([
      'XYZ',
      '0,00 €',
      '−50,00 €',
      '−50,00 €',
      '1',
      '02/01/2026',
    ]);
    expect(nbsp(m.closed.rows[0]?.[0]?.sub ?? '')).toBe('résidu 1 000 XYZ');
    expect(m.closed.rows[0]?.[2]?.tone).toBe('loss');
    expect(totalTexts(m.closed)).toEqual(['Total', '0,00 €', '−50,00 €', '−50,00 €', '1', '']);
    expect(nbsp(m.closed.note ?? '')).toContain(
      'Dont résidus : 1 position, latent résiduel −50,00 €.',
    );
    expect(nbsp(kpi(m.summary.kpis, 'P&L total')?.value ?? '')).toBe('−30,00 €');
    expect(totalTexts(m.positions)?.[8]).toBe('+20,00 €');
    // Invariant : Σ totaux des positions (ouvertes, stablecoins, clôturées) = P&L total.
    const sum = [...dust.positions, ...dust.stablecoins, ...dust.closed].reduce(
      (acc, p) => acc.plus(p.total ?? ZERO),
      ZERO,
    );
    expect(sum.eq(dust.totals.total)).toBe(true);
  });

  it('actif sans cours : Investi, P&L et ROI annotés, latent = valeur − investi', () => {
    const m = buildReportModel(
      compute(
        [
          buy('2026-01-01T10:00:00', 'btc', '1', '100'),
          buy('2026-01-02T10:00:00', 'xyz', '3', '30'),
        ],
        { btc: price('btc', '120') },
      ),
      opts,
    );
    const k = m.summary.kpis;
    expect(nbsp(kpi(k, 'Investi')?.value ?? '')).toBe('100,00 €');
    expect(nbsp(kpi(k, 'Investi')?.hint ?? '')).toBe('quantité × PRU · hors 30,00 € sans cours');
    expect(nbsp(kpi(k, 'Valeur')?.value ?? '')).toBe('120,00 €');
    expect(nbsp(kpi(k, 'Latent')?.value ?? '')).toBe('+20,00 €');
    expect(kpi(k, 'P&L total')?.hint).toBe('réalisé + latent · hors actifs sans cours');
    expect(kpi(k, 'ROI')?.hint).toContain('engagés · hors actifs sans cours');
    expect(m.cover.notes).toEqual(['1 actif sans cours, exclu de la valeur et du latent : XYZ.']);
    expect(m.positions.note).toContain('XYZ');
    expect(texts(m.positions, 1).slice(3, 6)).toEqual(['—', '—', '—']);
    expect(m.positions.rows[1]?.[0]?.sub).toBeNull();
  });
});

describe('modèle de rapport — mode discret et rapport vide', () => {
  it('masque montants et quantités, conserve pourcentages, prix et PRU', () => {
    const d = buildReportModel(report, { ...opts, discreet: true });
    expect(d.meta.discreet).toBe(true);
    expect(d.cover.notes[0]).toContain('Mode discret');
    expect(kpi(d.summary.kpis, 'Investi')?.value).toBe('••••');
    expect(kpi(d.summary.kpis, 'P&L total')?.value).toBe('••••');
    expect(nbsp(kpi(d.summary.kpis, 'ROI')?.value ?? '')).toBe(nbsp(fmtPct(report.totals.roi)));
    expect(kpi(d.summary.kpis, 'ROI')?.hint).toBe('sur •••• engagés');
    expect(texts(d.positions, 0)).toEqual([
      'BTC',
      '••••',
      '150,00 €',
      '250,00 €',
      '••••',
      '••••',
      '+66,7 %',
      '••••',
      '••••',
    ]);
    expect(d.positions.total?.[4]?.text).toBe('••••');
    expect(texts(d.allocation, 0)).toEqual(['USDC', '••••', '63,8 %']);
    expect(texts(d.closed, 0)).toEqual(['ADA', '••••', '—', '••••', '2', '05/03/2026']);
  });

  it('rapport sans opération : tableaux vides, totaux absents', () => {
    const empty = buildReportModel(compute([], {}), opts);
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
});

describe('rendement annualisé (XIRR) dans la synthèse', () => {
  it('affiche le taux des flux du moteur, avec la date du premier flux', () => {
    const row = model.summary.details.find((d) => d.label === 'Rendement annualisé (XIRR)');
    expect(row).toBeDefined();
    expect(row!.value).not.toBe('—');
    expect(row!.hint).toContain('depuis le 01/01/2026');
    // Le taux vient bien de xirrEur sur report.cashFlows + valeur finale.
    const expected = xirrEur([...report.cashFlows], {
      day: '2026-08-22',
      valueEur: report.totals.value,
    });
    expect(expected.ok).toBe(true);
    if (expected.ok) expect(nbsp(row!.value)).toBe(nbsp(fmtPct(expected.rate, { sign: true })));
  });

  it('explique pourquoi il manque quand la période est trop courte', () => {
    const shortReport = compute([buy('2026-08-20T10:00:00', 'btc', '1', '100')], {
      btc: price('btc', '250'),
    });
    const shortModel = buildReportModel(shortReport, opts);
    const row = shortModel.summary.details.find((d) => d.label === 'Rendement annualisé (XIRR)');
    expect(row!.value).toBe('—');
    expect(row!.hint).toContain('30 jours');
  });
});

describe('section « Constats »', () => {
  it('absente sans constat fourni, sinon reprend mot pour mot les phrases du moteur', () => {
    expect(model.insights).toBeNull();

    const insights = buildInsights({ report });
    expect(insights.length).toBeGreaterThan(0);
    const withInsights = buildReportModel(report, { ...opts, insights });
    expect(withInsights.insights?.title).toBe('Constats');
    // Le rapport ne reformule pas : il rend les mêmes constats, avec ses propres réglages.
    expect(withInsights.insights?.items).toEqual(
      renderInsights(insights, { discreet: false, currency: 'EUR' }),
    );
    // La note dit ce que ces observations ne sont pas (frontière information / conseil).
    expect(withInsights.insights?.note).toContain('ni un conseil en investissement');
  });

  it('masque les montants des constats en mode discret', () => {
    const insights = buildInsights({ report });
    const discreet = buildReportModel(report, { ...opts, discreet: true, insights });
    const text = (discreet.insights?.items ?? []).map((i) => i.detail).join(' ');
    expect(text).toContain(MASK);
  });
});

describe('section « Risque »', () => {
  /** Indice de performance : +50 %, puis −40 % depuis ce plus haut, puis remontée partielle. */
  const index = ['1', '1.5', '0.9', '1.2'].map((value, i) => ({
    day: `2026-01-0${i + 1}`,
    index: D(value),
  }));

  it('absente sans mesure fournie', () => {
    expect(model.risk).toBeNull();
  });

  it('affiche le repli comme une baisse, avec ses dates et la mention « pas encore retrouvé »', () => {
    const risk = riskMetrics(index);
    const m = buildReportModel(report, { ...opts, risk });
    expect(m.risk?.title).toBe('Risque');
    const line = m.risk!.details.find((d) => d.label === 'Repli maximal')!;
    // Un repli s'affiche négatif : c'est une perte, pas une performance.
    expect(nbsp(line.value)).toBe(nbsp(fmtPct(D('-0.4'))));
    expect(line.tone).toBe('loss');
    expect(line.hint).toContain('du 02/01/2026 au 03/01/2026');
    expect(line.hint).toContain('pas encore retrouvé');
    // La note dit pourquoi ce chiffre ne colle pas au relevé de compte.
    expect(m.risk!.note).toContain('apports et retraits neutralisés');
  });

  it('avoue ce qu’elle ne peut pas calculer sur une série courte', () => {
    const m = buildReportModel(report, { ...opts, risk: riskMetrics(index) });
    const volatility = m.risk!.details.find((d) => d.label === 'Volatilité annualisée')!;
    expect(volatility.value).toBe('—');
    expect(volatility.hint).toContain('30 jours');
    expect(m.risk!.details.find((d) => d.label === 'Ratio de Sortino')!.value).toBe('—');
  });
});

describe('section « Fiscalité française (estimation) »', () => {
  const taxEvents: LedgerEvent[] = [
    buy('2026-01-01T10:00:00', 'btc', '1', '10000'),
    sell('2026-06-01T10:00:00', 'btc', '0.5', '5000'),
  ];
  const taxLedger = computeFrenchTax({
    events: taxEvents,
    closingValueAt: (day) => (day === '2026-06-01' ? D('15000') : null),
  });

  it('absente sans estimation fournie', () => {
    expect(model.tax).toBeNull();
  });

  it('donne le millésime, le net, l’impôt estimé et le PTA restant', () => {
    const m = buildReportModel(report, { ...opts, tax: taxLedger });
    expect(m.tax?.title).toBe('Fiscalité française (estimation)');
    const label = (name: string) => m.tax!.details.find((d) => d.label === name)!;
    // Global 20 000 (clôture 15 000 + 5 000 encaissés) → imputé 2 500, plus-value 2 500.
    expect(nbsp(label('2026 · résultat net').value)).toBe(
      nbsp(fmtMoney(D('2500'), 'EUR', { sign: true })),
    );
    expect(nbsp(label('2026 · impôt estimé').value)).toBe(
      nbsp(fmtMoney(D('2500').times('0.314'), 'EUR')),
    );
    expect(nbsp(label('Prix total d’acquisition restant').value)).toBe(
      nbsp(fmtMoney(D('7500'), 'EUR')),
    );
    // La note porte les deux hypothèses et le refus de tenir lieu de conseil.
    expect(m.tax!.note).toContain('PORTEFEUILLE ENTIER');
    expect(m.tax!.note).toContain('ni un conseil fiscal');
  });

  it('reste en euros même quand l’app affiche en dollars', () => {
    const usd = buildReportModel(report, { ...opts, currency: 'USD', tax: taxLedger });
    expect(usd.tax!.details.every((d) => !d.value.includes('$'))).toBe(true);
  });

  it('avertit quand des cessions n’ont pas pu être chiffrées', () => {
    const blind = computeFrenchTax({ events: taxEvents });
    const m = buildReportModel(report, { ...opts, tax: blind });
    expect(m.tax!.warnings.join(' ')).toContain('valeur du portefeuille au jour de l’opération');
  });
});
