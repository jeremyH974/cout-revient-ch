/**
 * Modèle de rapport indépendant de la mise en page.
 *
 * Tout le texte, l'ordre des sections et le formatage des montants sont décidés ici ; les rendus
 * (PDF via jsPDF, vue HTML imprimable) ne font qu'afficher ce modèle. Le mode discret remplace
 * montants et quantités par « •••• ». Les montants passent par un seul point de formatage
 * (`Formatter.money`) pour préparer la bascule de devise.
 */
import type { PortfolioReport, PositionReport } from '../domain/engine';
import { D, ZERO, type Big } from '../domain/money';
import type { AssetCode, NaiveDateTime } from '../domain/types';
import { fmtDate, fmtMoney, fmtPct, fmtPrice, fmtQty } from '../format/fr';
import type { Currency } from '../fx/types';
import { assetName } from '../pricing/tickers';

export const APP_NAME = 'Coût de revient CH';
export const REPORT_TITLE = 'Rapport de portefeuille';
export const DISCLAIMER =
  'Outil indépendant, non affilié à Coinhouse. Les indicateurs de ce rapport sont des aides à la ' +
  'gestion : ils ne constituent ni un conseil en investissement, ni un calcul fiscal (la plus-value ' +
  'imposable en France suit la méthode globale de l’article 150 VH bis du CGI).';

const MASK = '••••';
const NONE = '—';

export type Tone = 'neutral' | 'gain' | 'loss';
export type Align = 'left' | 'right';
export type TableKind = 'allocation' | 'positions' | 'stablecoins' | 'closed';

export interface ReportCell {
  text: string;
  /** Ligne secondaire (nom complet de l'actif), null sinon. */
  sub: string | null;
  tone: Tone;
}

export interface ReportColumn {
  label: string;
  align: Align;
}

export interface ReportTable {
  kind: TableKind;
  title: string;
  note: string | null;
  columns: ReportColumn[];
  rows: ReportCell[][];
  /** Ligne de total (autant de cellules que `columns`), null si le tableau est vide. */
  total: ReportCell[] | null;
  emptyText: string;
}

export interface ReportFact {
  label: string;
  value: string;
}

export interface ReportKpi {
  label: string;
  value: string;
  tone: Tone;
  hint: string | null;
}

export interface ReportParagraph {
  title: string;
  text: string;
}

export interface ReportModel {
  meta: {
    appName: string;
    title: string;
    version: string;
    /** ISO 8601. */
    generatedAt: string;
    /** « 22/08/2026 à 18:05 » (heure locale). */
    generatedLabel: string;
    currency: string;
    discreet: boolean;
    /** AAAA-MM-JJ (date locale de génération), pour le nom de fichier. */
    dateStamp: string;
  };
  cover: {
    title: string;
    subtitle: string;
    facts: ReportFact[];
    notes: string[];
    disclaimer: string;
  };
  summary: { title: string; kpis: ReportKpi[]; details: ReportKpi[] };
  allocation: ReportTable;
  positions: ReportTable;
  stablecoins: ReportTable;
  closed: ReportTable;
  methodology: { title: string; items: ReportParagraph[] };
  footer: { left: string; right: string };
}

export interface ReportModelOptions {
  discreet: boolean;
  /** Devise d'affichage des montants (EUR par défaut). */
  currency?: Currency | undefined;
  /** Instant de génération, ISO 8601. */
  generatedAt: string;
  version: string;
  /** Réglage moteur « abonnements inclus dans le P&L » (false par défaut). */
  subscriptionsInPnl?: boolean | undefined;
  /** Fuseau d'affichage des dates de génération (tests) ; celui du navigateur par défaut. */
  timeZone?: string | undefined;
}

interface Formatter {
  money(value: Big | null, sign?: boolean): string;
  qty(value: Big | null): string;
  price(value: Big | null): string;
  pct(value: Big | null, sign?: boolean): string;
}

function createFormatter(discreet: boolean, currency: Currency): Formatter {
  return {
    money: (value, sign = false) => {
      if (value === null) return NONE;
      if (discreet) return MASK;
      return fmtMoney(value, currency, { sign: sign && !value.eq(ZERO) });
    },
    qty: (value) => (value === null ? NONE : discreet ? MASK : fmtQty(value)),
    price: (value) => (value === null ? NONE : fmtPrice(value, currency)),
    pct: (value, sign = true) => (value === null ? NONE : fmtPct(value, { sign })),
  };
}

const toneOf = (value: Big | null): Tone =>
  value === null || value.eq(ZERO) ? 'neutral' : value.lt(ZERO) ? 'loss' : 'gain';

const cell = (text: string, tone: Tone = 'neutral', sub: string | null = null): ReportCell => ({
  text,
  sub,
  tone,
});

function assetCell(code: AssetCode): ReportCell {
  const ticker = code.toUpperCase();
  const name = assetName(code);
  return cell(ticker, 'neutral', name === ticker ? null : name);
}

const sumBy = (items: PositionReport[], pick: (p: PositionReport) => Big | null): Big =>
  items.reduce((acc, p) => acc.plus(pick(p) ?? ZERO), ZERO);

const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

const tickers = (codes: AssetCode[]): string => codes.map((c) => c.toUpperCase()).join(', ');

/** Date et heure locales d'un instant ISO : libellé « JJ/MM/AAAA à HH:MM » et tampon AAAA-MM-JJ. */
function localDateTime(
  iso: string,
  timeZone: string | undefined,
): { label: string; stamp: string } {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return { label: iso, stamp: iso.slice(0, 10) };
  const tz: Intl.DateTimeFormatOptions = timeZone === undefined ? {} : { timeZone };
  const date = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...tz,
  }).format(ms);
  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...tz,
  }).format(ms);
  const [d = '', m = '', y = ''] = date.split('/');
  return { label: `${date} à ${time}`, stamp: `${y}-${m}-${d}` };
}

function coveredPeriod(all: PositionReport[]): { from: NaiveDateTime; to: NaiveDateTime } | null {
  let from: NaiveDateTime | null = null;
  let to: NaiveDateTime | null = null;
  for (const p of all) {
    for (const h of p.history) {
      if (from === null || h.at < from) from = h.at;
      if (to === null || h.at > to) to = h.at;
    }
  }
  return from !== null && to !== null ? { from, to } : null;
}

const POSITION_COLUMNS: ReportColumn[] = [
  { label: 'Actif', align: 'left' },
  { label: 'Quantité', align: 'right' },
  { label: 'PRU', align: 'right' },
  { label: 'Prix', align: 'right' },
  { label: 'Valeur', align: 'right' },
  { label: 'Latent', align: 'right' },
  { label: 'Latent %', align: 'right' },
  { label: 'Réalisé', align: 'right' },
  { label: 'Total', align: 'right' },
];

function positionsTable(
  kind: TableKind,
  title: string,
  note: string | null,
  items: PositionReport[],
  f: Formatter,
  emptyText: string,
): ReportTable {
  const rows = items.map((p) => [
    assetCell(p.asset),
    cell(f.qty(p.qty)),
    cell(f.money(p.pru)),
    cell(f.price(p.price ? D(p.price.priceEur) : null)),
    cell(f.money(p.value)),
    cell(f.money(p.unrealized, true), toneOf(p.unrealized)),
    cell(f.pct(p.unrealizedPct), toneOf(p.unrealizedPct)),
    cell(f.money(p.realized, true), toneOf(p.realized)),
    cell(f.money(p.total, true), toneOf(p.total)),
  ]);
  // Mêmes conventions que les totaux du moteur : valeur et latent sur les actifs cotés seulement.
  const priced = items.filter((p) => p.value !== null);
  const value = sumBy(priced, (p) => p.value);
  const unrealized = sumBy(priced, (p) => p.unrealized);
  const costBasis = sumBy(priced, (p) => p.costBasis);
  const realized = sumBy(items, (p) => p.realized);
  const total = realized.plus(unrealized).plus(sumBy(items, (p) => p.otherIncome));
  const pct = costBasis.gt(ZERO) ? unrealized.div(costBasis) : null;
  const unpriced = items.filter((p) => p.value === null).map((p) => p.asset);
  const notes = [
    note,
    unpriced.length > 0
      ? `Sans cours (valeur et latent non calculés) : ${tickers(unpriced)}.`
      : null,
  ].filter((n): n is string => n !== null);
  return {
    kind,
    title,
    note: notes.length > 0 ? notes.join(' ') : null,
    columns: POSITION_COLUMNS,
    rows,
    total:
      rows.length > 0
        ? [
            cell('Total'),
            cell(''),
            cell(''),
            cell(''),
            cell(f.money(value)),
            cell(f.money(unrealized, true), toneOf(unrealized)),
            cell(f.pct(pct), toneOf(pct)),
            cell(f.money(realized, true), toneOf(realized)),
            cell(f.money(total, true), toneOf(total)),
          ]
        : null,
    emptyText,
  };
}

function closedTable(items: PositionReport[], f: Formatter): ReportTable {
  const sorted = [...items].sort(
    (a, b) => b.realized.cmp(a.realized) || a.asset.localeCompare(b.asset),
  );
  const rows = sorted.map((p) => [
    assetCell(p.asset),
    cell(f.money(p.realized, true), toneOf(p.realized)),
    cell(String(p.history.length)),
    // L'historique est antichronologique : la première entrée est la dernière opération.
    cell(p.history[0] ? fmtDate(p.history[0].at) : NONE),
  ]);
  const realized = sumBy(items, (p) => p.realized);
  const operations = items.reduce((n, p) => n + p.history.length, 0);
  return {
    kind: 'closed',
    title: 'Positions clôturées',
    note: 'Positions entièrement cédées (ou résidu inférieur à 0,01 €) : seul le réalisé subsiste.',
    columns: [
      { label: 'Actif', align: 'left' },
      { label: 'Réalisé', align: 'right' },
      { label: 'Opérations', align: 'right' },
      { label: 'Dernière opération', align: 'right' },
    ],
    rows,
    total:
      rows.length > 0
        ? [
            cell('Total'),
            cell(f.money(realized, true), toneOf(realized)),
            cell(String(operations)),
            cell(''),
          ]
        : null,
    emptyText: 'Aucune position clôturée.',
  };
}

function allocationTable(report: PortfolioReport, f: Formatter): ReportTable {
  // Seules les positions valorisées comptent (le moteur peut lister des clôturées à 0).
  const rows = report.allocation
    .filter((a) => a.value.gt(ZERO))
    .map((a) => [assetCell(a.asset), cell(f.money(a.value)), cell(f.pct(a.share, false))]);
  const unpriced = report.totals.unpricedAssets;
  return {
    kind: 'allocation',
    title: 'Répartition',
    note:
      unpriced.length > 0
        ? `Part de chaque actif dans la valeur actuelle (stablecoins compris), hors ${plural(unpriced.length, 'actif', 'actifs')} sans cours : ${tickers(unpriced)}.`
        : 'Part de chaque actif dans la valeur actuelle du portefeuille (stablecoins compris).',
    columns: [
      { label: 'Actif', align: 'left' },
      { label: 'Valeur', align: 'right' },
      { label: 'Part', align: 'right' },
    ],
    rows,
    total:
      rows.length > 0
        ? [cell('Total'), cell(f.money(report.totals.value)), cell(f.pct(D('1'), false))]
        : null,
    emptyText: 'Aucune position valorisée.',
  };
}

const METHODOLOGY: ReportParagraph[] = [
  {
    title: 'Coût de revient (PRU)',
    text:
      'Coût moyen pondéré « all-in » d’une unité détenue : coût total des acquisitions (spread et ' +
      'frais inclus, c’est-à-dire la contre-valeur en euros réellement débitée) divisé par la ' +
      'quantité acquise. Il ne change qu’à l’achat ; une cession ne le modifie jamais.',
  },
  {
    title: 'Réalisé, latent, total et ROI',
    text:
      'Réalisé = produit net de chaque cession − quantité cédée × PRU au moment de la cession. ' +
      'Latent = valeur actuelle − quantité détenue × PRU. Total = réalisé + latent (+ récompenses ' +
      'valorisées, le cas échéant). ROI = total ÷ somme de toutes les acquisitions à titre onéreux.',
  },
  {
    title: 'Lots',
    text:
      'Chaque acquisition ouvre un lot. Une cession consomme tous les lots ouverts au prorata de ' +
      'leur quantité restante (et non selon l’ordre d’entrée) : la somme des latents des lots est ' +
      'égale au latent de la position.',
  },
  {
    title: 'Stablecoins',
    text:
      'Les stablecoins (USDC, USDT…) sont suivis comme des positions à part entière. Un achat payé ' +
      'en USDC est une cession d’USDC (à leur PRU) et une acquisition de crypto à la contre-valeur ' +
      'en euros des USDC dépensés ; leur gain ou perte est l’effet de change.',
  },
  {
    title: 'Migrations et récompenses',
    text:
      'Un delisting suivi d’une migration (par exemple MKR vers SKY) reporte le coût d’acquisition ' +
      'sur le nouvel actif sans constater de plus-value, sauf réglage contraire. Les récompenses ' +
      '(staking, airdrops) entrent à coût nul par défaut et n’entrent pas dans le dénominateur du ROI.',
  },
  {
    title: 'Apports nets',
    text:
      'Euros réellement entrés (achats payés en euros) moins euros réellement sortis (ventes ' +
      'encaissées en euros). Les échanges crypto contre crypto ou via stablecoin ne comptent pas : ' +
      'aucun euro n’a bougé.',
  },
  {
    title: 'Limites',
    text:
      'Les valeurs sont calculées en arithmétique décimale exacte et arrondies à l’affichage ' +
      'seulement. Les cours proviennent de CoinGecko ou Coinbase, ou d’une saisie manuelle, à la ' +
      'date indiquée en page de garde ; les actifs sans cours sont exclus de la valeur et du latent. ' +
      'Ce rapport n’est pas un calcul fiscal : la plus-value imposable en France suit la méthode ' +
      'globale de l’article 150 VH bis du CGI (prix total d’acquisition du portefeuille), ' +
      'différente du PRU par actif.',
  },
];

export function buildReportModel(report: PortfolioReport, opts: ReportModelOptions): ReportModel {
  const currency: Currency = opts.currency ?? 'EUR';
  const f = createFormatter(opts.discreet, currency);
  const t = report.totals;
  const all = [...report.positions, ...report.stablecoins, ...report.closed, ...report.blocked];
  const period = coveredPeriod(all);
  const operations = new Set(all.flatMap((p) => p.history.map((h) => h.eventId))).size;
  const generated = localDateTime(opts.generatedAt, opts.timeZone);
  const priced = report.pricedAt ? localDateTime(report.pricedAt, opts.timeZone) : null;
  const openCount = report.positions.length + report.stablecoins.length;

  const facts: ReportFact[] = [
    { label: 'Généré le', value: generated.label },
    { label: 'Devise', value: currency },
    {
      label: 'Période couverte',
      value: period ? `du ${fmtDate(period.from)} au ${fmtDate(period.to)}` : 'aucune opération',
    },
    { label: 'Opérations', value: String(operations) },
    {
      label: 'Positions',
      value: `${plural(openCount, 'ouverte', 'ouvertes')} · ${plural(report.closed.length, 'clôturée', 'clôturées')}`,
    },
    { label: 'Cours', value: priced ? `au ${priced.label}` : 'aucun cours chargé' },
  ];

  const notes: string[] = [];
  if (opts.discreet) notes.push(`Mode discret : les montants et quantités sont masqués (${MASK}).`);
  if (t.unpricedAssets.length > 0) {
    notes.push(
      `${plural(t.unpricedAssets.length, 'actif sans cours, exclu', 'actifs sans cours, exclus')} de la valeur et du latent : ${tickers(t.unpricedAssets)}.`,
    );
  }
  if (report.blocked.length > 0) {
    notes.push(
      `${plural(report.blocked.length, 'position ignorée', 'positions ignorées')} faute d’historique d’achat suffisant : ${tickers(report.blocked.map((p) => p.asset))}.`,
    );
  }
  if (report.unqualified.length > 0) {
    notes.push(
      `${plural(report.unqualified.length, 'opération non interprétée', 'opérations non interprétées')} (à qualifier dans l’application), hors calcul.`,
    );
  }

  const kpis: ReportKpi[] = [
    {
      label: 'Investi',
      value: f.money(t.costBasis),
      tone: 'neutral',
      hint: 'quantité détenue × PRU',
    },
    {
      label: 'Valeur',
      value: f.money(t.value),
      tone: 'neutral',
      hint:
        t.unpricedAssets.length > 0
          ? `hors ${plural(t.unpricedAssets.length, 'actif', 'actifs')} sans cours`
          : priced
            ? `cours au ${priced.label}`
            : null,
    },
    {
      label: 'Latent',
      value: f.money(t.unrealized, true),
      tone: toneOf(t.unrealized),
      hint: 'valeur − investi',
    },
    {
      label: 'Réalisé',
      value: f.money(t.realized, true),
      tone: toneOf(t.realized),
      hint: 'encaissé sur les cessions',
    },
    {
      label: 'P&L total',
      value: f.money(t.total, true),
      tone: toneOf(t.total),
      hint: t.otherIncome.gt(ZERO)
        ? 'réalisé + latent + récompenses valorisées'
        : 'réalisé + latent',
    },
    {
      label: 'ROI',
      value: f.pct(t.roi),
      tone: toneOf(t.roi),
      hint: `sur ${f.money(t.investedTotal)} achetés`,
    },
  ];

  const details: ReportKpi[] = [
    {
      label: 'Apports nets en euros',
      value: f.money(t.netCash),
      tone: 'neutral',
      hint: `${f.money(t.cashIn)} entrés − ${f.money(t.cashOut)} sortis`,
    },
    {
      label: 'Net investi',
      value: f.money(t.netInvested),
      tone: 'neutral',
      hint: 'achats − ventes ; négatif = capital récupéré',
    },
    {
      label: 'Frais',
      value: f.money(t.feesEur),
      tone: 'neutral',
      hint: 'déjà compris dans le coût all-in des opérations',
    },
    { label: 'Remises sur frais', value: f.money(t.rebatesEur), tone: 'neutral', hint: null },
    {
      label: 'Abonnements Coinhouse',
      value: f.money(t.subscriptionsEur),
      tone: 'neutral',
      hint: opts.subscriptionsInPnl ? 'inclus dans le P&L total' : 'hors P&L',
    },
  ];

  return {
    meta: {
      appName: APP_NAME,
      title: REPORT_TITLE,
      version: opts.version,
      generatedAt: opts.generatedAt,
      generatedLabel: generated.label,
      currency,
      discreet: opts.discreet,
      dateStamp: generated.stamp,
    },
    cover: {
      title: REPORT_TITLE,
      subtitle: 'Prix de revient, plus et moins-values réalisées et latentes par actif',
      facts,
      notes,
      disclaimer: DISCLAIMER,
    },
    summary: { title: 'Synthèse', kpis, details },
    allocation: allocationTable(report, f),
    positions: positionsTable(
      'positions',
      'Positions ouvertes',
      null,
      report.positions,
      f,
      'Aucune position ouverte.',
    ),
    stablecoins: positionsTable(
      'stablecoins',
      'Stablecoins',
      'Cash en attente, valorisé au cours de l’euro : le gain ou la perte d’un stablecoin est l’effet de change.',
      report.stablecoins,
      f,
      'Aucun stablecoin détenu.',
    ),
    closed: closedTable(report.closed, f),
    methodology: { title: 'Méthodologie', items: METHODOLOGY },
    footer: {
      left: `${APP_NAME} · version ${opts.version} · outil indépendant, non affilié à Coinhouse`,
      right: `Généré le ${generated.label}`,
    },
  };
}
