import { describe, expect, it } from 'vitest';
import { computeDeclarations } from '../domain/declarations-fr';
import { computePortfolio, type PortfolioReport, type PriceQuoteInput } from '../domain/engine';
import { D, ZERO, type Big } from '../domain/money';
import { buildInsights } from '../domain/insights';
import { riskMetrics } from '../domain/risk';
import { computeFrenchTax } from '../domain/tax-fr';
import { xirrEur } from '../domain/xirr';
import { presentMoneyWeighted } from '../derive/presented-return';
import {
  DEFAULT_ENGINE_SETTINGS,
  type Account,
  type LedgerEvent,
  type TradeEvent,
} from '../domain/types';
import { MASK, fmtMoney, fmtPct } from '../format/fr';
import { renderInsights, type RenderedInsight } from '../format/insights';
import type { WatchEntry } from '../watch/entries';
import {
  buildReportModel,
  section,
  tableOf,
  watchReportBlock,
  type ReportKpi,
  type ReportModel,
  type ReportSection,
  type ReportTable,
  type ReportWindow,
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

/*
 * Le modèle porte une LISTE ORDONNÉE de sections (décision n° 174) : ces raccourcis y pointent.
 * `maybe` sert aux tests de présence ; les autres exigent la section et échouent en la nommant,
 * pour qu'un test ne passe jamais au vert sur une section disparue.
 */
const maybe = (m: ReportModel, id: string): ReportSection | null => section(m, id);
const sec = (m: ReportModel, id: string): ReportSection => {
  const found = section(m, id);
  if (found === null) throw new Error(`section « ${id} » absente du modèle`);
  return found;
};
const kpisOf = (m: ReportModel, id: string): ReportKpi[] => {
  const block = sec(m, id).block;
  return block.kind === 'kpis' ? block.kpis : [];
};
const detailsOf = (m: ReportModel, id: string): ReportKpi[] => {
  const block = sec(m, id).block;
  return block.kind === 'kpis' || block.kind === 'details' ? block.details : [];
};
const bullets = (s: ReportSection): string[] =>
  s.block.kind === 'bullets' ? [...s.block.items] : [];
const insightItems = (m: ReportModel): RenderedInsight[] => {
  const block = sec(m, 'insights').block;
  return block.kind === 'insights' ? [...block.items] : [];
};
const noteOf = (m: ReportModel, id: string): string => sec(m, id).note ?? '';
/** La phrase d'INTRODUCTION d'un tableau — l'ancienne `ReportTable.note`. */
const leadOf = (m: ReportModel, id: string): string => sec(m, id).lead ?? '';
const warningsOf = (m: ReportModel, id: string): string[] => [...sec(m, id).warnings];
const tableOf_ = (m: ReportModel, id: string): ReportTable => {
  const found = tableOf(m, id);
  if (found === null) throw new Error(`tableau « ${id} » absent du modèle`);
  return found;
};
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

  /**
   * « Période couverte » et « Année fiscale » ne disent pas la même chose, et c'est exactement ce
   * qu'un PDF détaché de l'écran qui l'a produit ne pouvait pas savoir : la première décrit le
   * grand livre entier, la seconde ne gouverne que le 2086, le 3916-bis et le DAC8.
   */
  it('sans année fiscale choisie, la page de garde n’en invente pas', () => {
    expect(fact(model, 'Année fiscale')).toBeUndefined();
    expect(model.cover.notes).toEqual([]);
  });

  it('l’année fiscale choisie figure sur la page de garde, avec ce qu’elle gouverne', () => {
    const m = buildReportModel(report, { ...opts, taxYear: 2026 });
    expect(fact(m, 'Année fiscale')).toBe('2026');
    // Le périmètre d'abord : c'est la confusion que cette note existe pour fermer.
    expect(m.cover.notes[0]).toContain('annexe 2086, comptes 3916-bis, récapitulatif DAC8');
    expect(m.cover.notes[0]).toContain('l’intégralité de vos opérations');
  });

  /**
   * Généré le 22/08/2026, un rapport sur 2026 décrit une année **en cours** — et elle se déclare
   * au printemps 2027, jamais en 2026. C'est la question que l'ancienne étiquette « Année
   * déclarée » laissait ouverte, et à laquelle le PDF doit répondre tout seul.
   */
  it('dit l’état de l’année décrite et le printemps où elle se déclare', () => {
    const current = buildReportModel(report, { ...opts, taxYear: 2026 });
    expect(current.cover.notes[0]).toContain('Année en cours — provisoire.');
    expect(current.cover.notes[0]).toContain('Elle se déclare au printemps 2027.');

    const closed = buildReportModel(report, { ...opts, taxYear: 2025 });
    expect(closed.cover.notes[0]).toContain('Année close.');
    expect(closed.cover.notes[0]).toContain('Elle se déclare au printemps 2026.');
  });

  it('indicateurs de synthèse formatés, colorés, avec leur base', () => {
    const k = kpisOf(model, 'summary');
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
    const d = detailsOf(model, 'summary');
    expect(nbsp(kpi(d, 'Apports nets (espèces)')?.value ?? '')).toBe('1 030,00 €');
    expect(nbsp(kpi(d, 'Net investi')?.value ?? '')).toBe('1 030,00 €');
    expect(kpi(d, 'Abonnements Coinhouse')?.hint).toBe('hors P&L');
    const inPnl = buildReportModel(report, { ...opts, subscriptionsInPnl: true });
    expect(kpi(detailsOf(inPnl, 'summary'), 'Abonnements Coinhouse')?.hint).toBe(
      'déduits du P&L total',
    );
    expect(kpi(kpisOf(inPnl, 'summary'), 'P&L total')?.hint).toBe('réalisé + latent − abonnements');
    // La trésorerie du compte entre dans le total sans figurer dans aucune de ses lignes : le
    // rapport affichait un total que son propre détail n'expliquait pas. Invisible tant que ce
    // poste valait zéro (décision n° 140).
    expect(kpi(d, 'Trésorerie du compte')?.hint).toBe(
      'intérêts reçus et frais de conversion, compris dans le P&L total',
    );
  });
});

describe('modèle de rapport — tableaux', () => {
  it('positions ouvertes : une ligne par actif, % avec sa base, total cohérent', () => {
    const p = tableOf_(model, 'positions');
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
    const s = tableOf_(model, 'stablecoins');
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
    expect(leadOf(model, 'stablecoins')).toContain('effet de change');
  });

  it('positions clôturées : réalisé, résidu, total, nombre et date de la dernière opération', () => {
    const c = tableOf_(model, 'closed');
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
    expect(leadOf(model, 'closed')).not.toContain('Dont résidus');
  });

  it('répartition : parts sans signe, total 100 %', () => {
    const a = tableOf_(model, 'allocation');
    expect(texts(a, 0)).toEqual(['USDC', '880,00 €', '63,8 %']);
    expect(texts(a, 1)).toEqual(['BTC', '500,00 €', '36,2 %']);
    expect(totalTexts(a)).toEqual(['Total', '1 380,00 €', '100,0 %']);
  });

  it('chaque ligne a autant de cellules que de colonnes', () => {
    for (const table of [
      tableOf_(model, 'allocation'),
      tableOf_(model, 'positions'),
      tableOf_(model, 'stablecoins'),
      tableOf_(model, 'closed'),
    ]) {
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
    const row = texts(tableOf_(buildReportModel(pepe, opts), 'positions'), 0);
    expect(row[2]).toBe('0,000003886 €');
    expect(row[3]).toBe('0,000005 €');
    // Le PRU est un prix : il reste visible en mode discret, comme le cours.
    const discreet = texts(
      tableOf_(buildReportModel(pepe, { ...opts, discreet: true }), 'positions'),
      0,
    );
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
    expect(texts(tableOf_(m, 'closed'), 0)).toEqual([
      'XYZ',
      '0,00 €',
      '−50,00 €',
      '−50,00 €',
      '1',
      '02/01/2026',
    ]);
    expect(nbsp(tableOf_(m, 'closed').rows[0]?.[0]?.sub ?? '')).toBe('résidu 1 000 XYZ');
    expect(tableOf_(m, 'closed').rows[0]?.[2]?.tone).toBe('loss');
    expect(totalTexts(tableOf_(m, 'closed'))).toEqual([
      'Total',
      '0,00 €',
      '−50,00 €',
      '−50,00 €',
      '1',
      '',
    ]);
    expect(nbsp(leadOf(m, 'closed') ?? '')).toContain(
      'Dont résidus : 1 position, latent résiduel −50,00 €.',
    );
    expect(nbsp(kpi(kpisOf(m, 'summary'), 'P&L total')?.value ?? '')).toBe('−30,00 €');
    expect(totalTexts(tableOf_(m, 'positions'))?.[8]).toBe('+20,00 €');
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
    const k = kpisOf(m, 'summary');
    expect(nbsp(kpi(k, 'Investi')?.value ?? '')).toBe('100,00 €');
    expect(nbsp(kpi(k, 'Investi')?.hint ?? '')).toBe('quantité × PRU · hors 30,00 € sans cours');
    expect(nbsp(kpi(k, 'Valeur')?.value ?? '')).toBe('120,00 €');
    expect(nbsp(kpi(k, 'Latent')?.value ?? '')).toBe('+20,00 €');
    expect(kpi(k, 'P&L total')?.hint).toBe('réalisé + latent · hors actifs sans cours');
    expect(kpi(k, 'ROI')?.hint).toContain('engagés · hors actifs sans cours');
    expect(m.cover.notes).toEqual(['1 actif sans cours, exclu de la valeur et du latent : XYZ.']);
    expect(leadOf(m, 'positions')).toContain('XYZ');
    expect(texts(tableOf_(m, 'positions'), 1).slice(3, 6)).toEqual(['—', '—', '—']);
    expect(tableOf_(m, 'positions').rows[1]?.[0]?.sub).toBeNull();
  });
});

describe('modèle de rapport — mode discret et rapport vide', () => {
  it('masque montants et quantités, conserve pourcentages, prix et PRU', () => {
    const d = buildReportModel(report, { ...opts, discreet: true });
    expect(d.meta.discreet).toBe(true);
    expect(d.cover.notes[0]).toContain('Mode discret');
    expect(kpi(kpisOf(d, 'summary'), 'Investi')?.value).toBe('••••');
    expect(kpi(kpisOf(d, 'summary'), 'P&L total')?.value).toBe('••••');
    expect(nbsp(kpi(kpisOf(d, 'summary'), 'ROI')?.value ?? '')).toBe(
      nbsp(fmtPct(report.totals.roi)),
    );
    expect(kpi(kpisOf(d, 'summary'), 'ROI')?.hint).toBe('sur •••• engagés');
    expect(texts(tableOf_(d, 'positions'), 0)).toEqual([
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
    expect(tableOf_(d, 'positions').total?.[4]?.text).toBe('••••');
    expect(texts(tableOf_(d, 'allocation'), 0)).toEqual(['USDC', '••••', '63,8 %']);
    expect(texts(tableOf_(d, 'closed'), 0)).toEqual([
      'ADA',
      '••••',
      '—',
      '••••',
      '2',
      '05/03/2026',
    ]);
  });

  it('rapport sans opération : tableaux vides, totaux absents', () => {
    const empty = buildReportModel(compute([], {}), opts);
    expect(fact(empty, 'Période couverte')).toBe('aucune opération');
    expect(fact(empty, 'Opérations')).toBe('0');
    expect(fact(empty, 'Cours')).toBe('aucun cours chargé');
    for (const table of [
      tableOf_(empty, 'allocation'),
      tableOf_(empty, 'positions'),
      tableOf_(empty, 'stablecoins'),
      tableOf_(empty, 'closed'),
    ]) {
      expect(table.rows).toEqual([]);
      expect(table.total).toBeNull();
      expect(table.emptyText.length).toBeGreaterThan(0);
    }
    expect(kpi(kpisOf(empty, 'summary'), 'ROI')?.value).toBe('—');
  });
});

describe('rendement pondéré par les capitaux (XIRR) dans la synthèse', () => {
  const XIRR = 'Rendement pondéré par les capitaux (XIRR)';

  it('présente le taux des flux du moteur selon GIPS : sous un an, celui de la PÉRIODE', () => {
    const row = detailsOf(model, 'summary').find((d) => d.label === XIRR);
    expect(row).toBeDefined();
    // Le taux vient bien de xirrEur sur report.cashFlows + valeur finale…
    const expected = xirrEur([...report.cashFlows], {
      day: '2026-08-22',
      valueEur: report.totals.value,
    });
    expect(expected.ok).toBe(true);
    // … mais l'historique court du 01/01 au 22/08 : moins d'un an. GIPS 2020, 5.A.1.b, veut alors
    // le taux NON annualisé de la période — celui que le libellé d'avant appelait « annualisé ».
    const presented = presentMoneyWeighted(expected);
    expect(presented.kind).toBe('cumulative');
    if (presented.kind !== 'none')
      expect(nbsp(row!.value)).toBe(nbsp(fmtPct(presented.value, { sign: true })));
    expect(row!.hint).toContain('sur la période, du 01/01/2026 au 22/08/2026');
    expect(row!.hint).not.toContain('par an');
  });

  it('explique pourquoi il manque quand la période est trop courte', () => {
    const shortReport = compute([buy('2026-08-20T10:00:00', 'btc', '1', '100')], {
      btc: price('btc', '250'),
    });
    const shortModel = buildReportModel(shortReport, opts);
    const row = detailsOf(shortModel, 'summary').find((d) => d.label === XIRR);
    expect(row!.value).toBe('—');
    expect(row!.hint).toContain('30 jours');
  });
});

describe('section « Constats »', () => {
  it('absente sans constat fourni, sinon reprend mot pour mot les phrases du moteur', () => {
    expect(maybe(model, 'insights')).toBeNull();

    const insights = buildInsights({ report });
    expect(insights.length).toBeGreaterThan(0);
    const withInsights = buildReportModel(report, { ...opts, insights });
    expect(maybe(withInsights, 'insights')?.title).toBe('Constats');
    // Le rapport ne reformule pas : il rend les mêmes constats, avec ses propres réglages.
    expect(insightItems(withInsights)).toEqual(
      renderInsights(insights, { discreet: false, currency: 'EUR' }),
    );
    // La note dit ce que ces observations ne sont pas (frontière information / conseil).
    expect(noteOf(withInsights, 'insights')).toContain('ni un conseil en investissement');
  });

  it('masque les montants des constats en mode discret', () => {
    const insights = buildInsights({ report });
    const discreet = buildReportModel(report, { ...opts, discreet: true, insights });
    const text = insightItems(discreet)
      .map((i) => i.detail)
      .join(' ');
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
    expect(maybe(model, 'risk')).toBeNull();
  });

  it('affiche le repli comme une baisse, avec ses dates et la mention « pas encore retrouvé »', () => {
    const risk = riskMetrics(index);
    const m = buildReportModel(report, { ...opts, risk });
    expect(maybe(m, 'risk')?.title).toBe('Risque');
    const line = detailsOf(m, 'risk').find((d) => d.label === 'Repli maximal')!;
    // Un repli s'affiche négatif : c'est une perte, pas une performance.
    expect(nbsp(line.value)).toBe(nbsp(fmtPct(D('-0.4'))));
    expect(line.tone).toBe('loss');
    expect(line.hint).toContain('du 02/01/2026 au 03/01/2026');
    expect(line.hint).toContain('pas encore retrouvé');
    // La note dit pourquoi ce chiffre ne colle pas au relevé de compte.
    expect(noteOf(m, 'risk')).toContain('apports et retraits neutralisés');
  });

  it('avoue ce qu’elle ne peut pas calculer sur une série courte', () => {
    const m = buildReportModel(report, { ...opts, risk: riskMetrics(index) });
    const volatility = detailsOf(m, 'risk').find((d) => d.label === 'Volatilité annualisée')!;
    expect(volatility.value).toBe('—');
    expect(volatility.hint).toContain('30 jours');
    expect(detailsOf(m, 'risk').find((d) => d.label === 'Ratio de Sortino')!.value).toBe('—');
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
    expect(maybe(model, 'tax')).toBeNull();
  });

  it('donne le millésime, le net, l’impôt estimé et le PTA restant', () => {
    const m = buildReportModel(report, { ...opts, tax: taxLedger });
    expect(maybe(m, 'tax')?.title).toBe('Fiscalité française (estimation)');
    const label = (name: string) => detailsOf(m, 'tax').find((d) => d.label === name)!;
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
    expect(noteOf(m, 'tax')).toContain('PORTEFEUILLE ENTIER');
    expect(noteOf(m, 'tax')).toContain('ni un conseil fiscal');
  });

  it('reste en euros même quand l’app affiche en dollars', () => {
    const usd = buildReportModel(report, { ...opts, currency: 'USD', tax: taxLedger });
    expect(detailsOf(usd, 'tax').every((d) => !d.value.includes('$'))).toBe(true);
  });

  it('avertit quand des cessions n’ont pas pu être chiffrées', () => {
    const blind = computeFrenchTax({ events: taxEvents });
    const m = buildReportModel(report, { ...opts, tax: blind });
    expect(warningsOf(m, 'tax').join(' ')).toContain(
      'valeur du portefeuille au jour de l’opération',
    );
  });
});

describe('section « Comptes à déclarer (formulaire 3916-bis) » (P66)', () => {
  const acc = (id: string, kind: Account['kind'], country?: string): Account => ({
    id,
    kind,
    label: id,
    space: 'invest',
    createdAt: '2026-01-01T00:00:00Z',
    ...(country === undefined ? {} : { country }),
  });

  it('absente sans déclarations fournies', () => {
    expect(maybe(model, 'declarations')).toBeNull();
  });

  it('absente quand aucun compte n’est concerné (tout est hors périmètre France)', () => {
    const declarations = computeDeclarations({
      accounts: [acc('ch:main', 'coinhouse'), acc('csv:fr', 'csv', 'FR')],
      events: [],
      year: 2026,
    });
    const m = buildReportModel(report, { ...opts, declarations });
    expect(maybe(m, 'declarations')).toBeNull();
  });

  it('liste les comptes concernés et avertit du risque de sanction', () => {
    const declarations = computeDeclarations({
      accounts: [acc('ch:main', 'coinhouse'), acc('csv:nl', 'csv', 'NL')],
      events: [],
      year: 2026,
    });
    const m = buildReportModel(report, { ...opts, declarations });
    expect(maybe(m, 'declarations')?.title).toBe('Comptes à déclarer (formulaire 3916-bis)');
    expect(detailsOf(m, 'declarations')).toHaveLength(1);
    expect(detailsOf(m, 'declarations')[0]?.label).toBe('csv:nl');
    expect(detailsOf(m, 'declarations')[0]?.hint).toContain('Pays-Bas');
    const warnings = warningsOf(m, 'declarations').join(' ') ?? '';
    expect(warnings).toContain('750 € par compte omis');
    expect(warnings).toContain('50 000 €');
    expect(warnings).toContain('NFT');
    // Aucun compte incertain ici : pas d'avertissement « clé détenue seul ».
    expect(warnings).not.toContain('détenez seul la clé');
    expect(noteOf(m, 'declarations')).toContain('ni déclaration, ni conseil fiscal');
    expect(noteOf(m, 'declarations')).toContain('1649 bis C');
    // Le régime de sanction sans seuil ne doit jamais s'afficher comme « 1 500 € sans condition ».
    expect(noteOf(m, 'declarations')).toContain('1 500 €');
    expect(noteOf(m, 'declarations')).toContain('50 000 €');
    // Le délai de reprise allongé, que l'étude P66 avait refusé d'écrire faute de source primaire
    // (décision n° 142) : l'article L. 169 du LPF a depuis été lu littéralement sur Légifrance.
    expect(noteOf(m, 'declarations')).toContain('trois à dix ans');
    expect(noteOf(m, 'declarations')).toContain('L. 169');
    // Il ne vaut que pour les revenus liés à l'obligation manquée, jamais pour toute l'année.
    expect(noteOf(m, 'declarations')).toContain('les seuls revenus');
    // Et la dispense des 50 000 € du délai de reprise ne couvre PAS les comptes de crypto-actifs :
    // la confondre avec le seuil de l'amende (1736 X), qui les couvre, serait rassurer à tort.
    expect(noteOf(m, 'declarations')).toContain('1649 A');
  });

  it('titre la liste avec l’année décrite, pour un PDF détaché de son écran', () => {
    // Sans l'année, un PDF de comptes à déclarer ne dit pas de quelle année il parle — et le
    // rapport la dérivait de son instant de génération (décision n° 141).
    const declarations = computeDeclarations({
      accounts: [acc('csv:nl', 'csv', 'NL')],
      events: [],
      year: 2026,
    });
    const m = buildReportModel(report, { ...opts, declarations, taxYear: 2026 });
    expect(maybe(m, 'declarations')?.title).toBe(
      'Comptes à déclarer au titre de 2026 (formulaire 3916-bis)',
    );
  });

  it('avertit spécifiquement pour un compte auto-hébergé incertain, jamais promu', () => {
    const declarations = computeDeclarations({
      accounts: [acc('oc:btc', 'onchain')],
      events: [],
      year: 2026,
    });
    const m = buildReportModel(report, { ...opts, declarations });
    expect(detailsOf(m, 'declarations')[0]?.value).toBe('Incertain (clé détenue seul)');
    expect(warningsOf(m, 'declarations').join(' ')).toContain('détenez seul la clé');
  });
});

describe('section « Veille réglementaire »', () => {
  const watchEntry = (over: Partial<WatchEntry> = {}): WatchEntry => ({
    id: 'fixture',
    title: 'Entrée de test',
    status: 'in-force',
    statusDate: '2026-01-01',
    effect: 'Effet de test.',
    source: { label: 'Source de test', url: null, official: false, checkedOn: '2026-01-01' },
    certainty: 'secondary-only',
    reviewedOn: '2026-01-01',
    topics: ['cession'],
    ...over,
  });

  it('absente quand toutes les entrées sont in-force', () => {
    expect(watchReportBlock([watchEntry(), watchEntry({ id: 'autre' })])).toBeNull();
  });

  it('absente quand la liste est vide', () => {
    expect(watchReportBlock([])).toBeNull();
  });

  it('présente dès qu’au moins une entrée n’est pas in-force, avec une ligne par entrée concernée', () => {
    const block = watchReportBlock([
      watchEntry({ id: 'a', status: 'in-force' }),
      watchEntry({ id: 'b', status: 'dropped', title: 'Retirée' }),
      watchEntry({ id: 'c', status: 'in-discussion', title: 'En discussion' }),
    ]);
    expect(block).not.toBeNull();
    expect(block!.title).toBe('Veille réglementaire');
    expect(bullets(block!)).toHaveLength(2);
    expect(bullets(block!).join(' ')).toContain('Retirée');
    expect(bullets(block!).join(' ')).toContain('En discussion');
    expect(block!.note).toContain('jamais un conseil');
  });

  it('signale les sources non officielles dans la ligne elle-même', () => {
    const block = watchReportBlock([
      watchEntry({ status: 'dropped', certainty: 'secondary-only' }),
    ]);
    expect(bullets(block!)[0]).toContain('(source non officielle)');
  });

  it('reflète la vraie table dans un rapport construit normalement', () => {
    // La table de veille réelle porte au moins une entrée qui n'est pas in-force (P67) : le bloc
    // doit donc apparaître dans un rapport ordinaire, sans configuration particulière.
    expect(maybe(model, 'watch')).not.toBeNull();
    expect(bullets(sec(model, 'watch')).length).toBeGreaterThan(0);
  });
});

describe('section « Coût réel des opérations »', () => {
  const sample = (asset: string, quote: string, i: number) => ({
    eventId: `e${i}`,
    at: `2026-0${1 + (i % 9)}-1${i % 10}T10:00:00`,
    asset,
    side: 'buy' as const,
    quoteEur: quote,
    referenceEur: '100',
    deviation: D(quote).minus('100').div('100').toString(),
    valueEur: '1000',
  });
  const estimate = (deviation: string, samples = 30) => ({
    samples,
    skipped: { noQuotePrice: 0, notEurQuoted: 0, noReference: 0 },
    medianDeviation: deviation,
    meanDeviation: deviation,
    volumeEur: '10000',
    estimatedCostEur: D(deviation).times('10000').toString(),
    reliable: samples >= 20,
    byAsset: [
      {
        asset: 'btc',
        samples,
        medianDeviation: deviation,
        volumeEur: '10000',
        estimatedCostEur: D(deviation).times('10000').toString(),
      },
    ],
    samplesDetail: [sample('btc', '101', 1)],
  });

  it('absente sans estimation fournie', () => {
    expect(maybe(model, 'spread')).toBeNull();
  });

  it('additionne commissions et spread quand le spread est défavorable', () => {
    const m = buildReportModel(report, { ...opts, spread: estimate('0.01') });
    const line = (name: string) => detailsOf(m, 'spread').find((d) => d.label === name)!;
    expect(nbsp(line('Spread implicite estimé').value)).toBe(nbsp(fmtMoney(D('100'), 'EUR')));
    const commissions = report.totals.feesEur;
    expect(nbsp(line('Coût total estimé').value)).toBe(
      nbsp(fmtMoney(commissions.plus(D('100')), 'EUR')),
    );
    expect(detailsOf(m, 'spread').some((d) => d.label === 'Actif le plus coûteux')).toBe(true);
  });

  it('ne retranche JAMAIS un spread favorable des commissions payées', () => {
    const m = buildReportModel(report, { ...opts, spread: estimate('-0.01') });
    const line = (name: string) => detailsOf(m, 'spread').find((d) => d.label === name)!;
    expect(line('Spread implicite estimé').value).toBe('—');
    expect(line('Spread implicite estimé').hint).toContain('aucun spread défavorable');
    // Les commissions ont bien été payées : le total ne descend pas en dessous.
    expect(nbsp(line('Coût total estimé').value)).toBe(
      nbsp(fmtMoney(report.totals.feesEur, 'EUR')),
    );
    // Et aucun actif ne se dit « le plus coûteux » sans coûter.
    expect(detailsOf(m, 'spread').some((d) => d.label === 'Actif le plus coûteux')).toBe(false);
  });

  it('avertit quand l’échantillon est trop petit pour conclure', () => {
    const m = buildReportModel(report, { ...opts, spread: estimate('0.01', 3) });
    expect(noteOf(m, 'spread')).toContain('reste fragile');
    // La méthode est expliquée dans tous les cas.
    expect(noteOf(m, 'spread')).toContain('MÉDIANE');
  });
});

describe('plage d’analyse (P118, décision n° 179)', () => {
  const kpiOf = (m: typeof model, label: string) =>
    [...kpisOf(m, 'summary'), ...detailsOf(m, 'summary')].find((k) => k.label === label);
  const fact = (m: typeof model, label: string) =>
    m.cover.facts.find((f) => f.label === label)?.value;

  const window = (over: Partial<ReportWindow> = {}): ReportWindow => ({
    from: '2026-07-01',
    to: '2026-08-22',
    label: 'du 01/07/2026 au 22/08/2026',
    endsToday: true,
    startValue: D('900'),
    endValue: D('1000'),
    endCost: D('700'),
    netFlows: D('50'),
    gain: D('50'),
    realized: D('12.5'),
    mwr: {
      kind: 'cumulative',
      value: D('0.051'),
      spanDays: 53,
      since: '2026-06-30',
      until: '2026-08-22',
    },
    ...over,
  });

  it('sans plage, dit « depuis l’origine » et garde la synthèse d’avant', () => {
    expect(fact(model, 'Période d’analyse')).toBe('depuis l’origine');
    expect(kpiOf(model, 'Réalisé')).toBeDefined();
    expect(kpiOf(model, 'Réalisé sur la période')).toBeUndefined();
  });

  it('sur une plage, renomme ce qui change de sens — jamais un « Réalisé » qui ne l’est plus', () => {
    const m = buildReportModel(report, { ...opts, window: window() });
    expect(fact(m, 'Période d’analyse')).toBe('du 01/07/2026 au 22/08/2026');
    expect(kpiOf(m, 'Réalisé')).toBeUndefined();
    expect(kpiOf(m, 'Réalisé sur la période')?.value).toBe(
      fmtMoney(D('12.5'), 'EUR', { sign: true }),
    );
    expect(kpiOf(m, 'Résultat sur la période')?.value).toBe(
      fmtMoney(D('50'), 'EUR', { sign: true }),
    );
    // Le ROI est un multiple depuis l'origine : sur une plage il se tait, et dit pourquoi.
    expect(kpiOf(m, 'ROI')?.value).toBe('—');
    expect(kpiOf(m, 'ROI')?.hint).toContain('sans objet sur une plage');
    // Le repère part de zéro : il comparerait une autre période.
    expect(detailsOf(m, 'summary').find((d) => d.label.startsWith('Repère'))?.hint).toContain(
      'depuis l’origine seulement',
    );
  });

  it('lit le XIRR de la plage, présenté sur la période et non « par an »', () => {
    const m = buildReportModel(report, { ...opts, window: window() });
    const row = kpiOf(m, 'Rendement pondéré par les capitaux (XIRR)');
    expect(nbsp(row!.value)).toBe(nbsp(fmtPct(D('0.051'), { sign: true })));
    expect(row!.hint).toContain('sur la période, du 30/06/2026 au 22/08/2026');
  });

  it('quand la plage finit avant le jour de génération, lit les stocks à sa fin et le dit', () => {
    const past = window({ to: '2026-07-31', endsToday: false });
    const m = buildReportModel(report, { ...opts, window: past });
    expect(kpiOf(m, 'Valeur')?.value).toBe(fmtMoney(D('1000'), 'EUR'));
    expect(kpiOf(m, 'Investi')?.value).toBe(fmtMoney(D('700'), 'EUR'));
    expect(kpiOf(m, 'Latent')?.value).toBe(fmtMoney(D('300'), 'EUR', { sign: true }));
    expect(kpiOf(m, 'Valeur')?.hint).toContain('au 31/07/2026');
    // Le tableau des positions, lui, reste celui du jour : il le dit, au lieu de se faire passer
    // pour la fin de la plage.
    expect(section(m, 'positions')?.lead).toContain('ne suit pas la fin de la plage');
    expect(m.cover.notes.join(' ')).toContain('ce tableau ne suit pas la fin de la plage');
  });

  it('présente un TWR de moins d’un an cumulé, même au-delà du plancher de 30 jours du moteur', () => {
    // GIPS 2020, 2.A.12 : le plancher de 30 jours du moteur annualisait entre un mois et un an.
    const twr = {
      ok: true as const,
      cumulative: D('0.08'),
      annualized: D('0.4'),
      since: '2026-03-01',
      until: '2026-08-22',
      days: 174,
      estimatedDays: 0,
      neutralizedDays: 0,
      index: [],
    };
    const m = buildReportModel(report, {
      ...opts,
      performance: { twr, benchmark: null, partialAssets: 0 },
    });
    const row = kpiOf(m, 'Rendement hors apports (TWR)');
    expect(nbsp(row!.value)).toBe(nbsp(fmtPct(D('0.08'), { sign: true })));
    expect(row!.hint).toContain('sur la période');
    expect(row!.hint).not.toContain('par an');
  });
});
