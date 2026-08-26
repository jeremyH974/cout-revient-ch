/**
 * Modèle de rapport indépendant de la mise en page.
 *
 * Tout le texte, l'ordre des sections et le formatage des montants sont décidés ici ; les rendus
 * (PDF via jsPDF, vue HTML imprimable) ne font qu'afficher ce modèle. Le mode discret remplace
 * montants et quantités par « •••• » ; les prix, PRU et pourcentages restent visibles (ce sont
 * des prix, pas des montants). Les montants passent par un seul point de formatage
 * (`Formatter.money`) pour préparer la bascule de devise.
 */
import type { PortfolioReport, PositionReport } from '../domain/engine';
import { D, ZERO, type Big, type DecimalString } from '../domain/money';
import type { SubscriptionAnalysis } from '../domain/subscription';
import type { AssetCode, NaiveDateTime } from '../domain/types';
import type { BenchmarkResult } from '../domain/benchmark';
import type { TwrResult } from '../domain/twr';
import { xirrEur, XIRR_MIN_SPAN_DAYS } from '../domain/xirr';
import type { Insight } from '../domain/insights';
import { RISK_MIN_DAYS, type RiskMetrics } from '../domain/risk';
import { MIN_SPREAD_SAMPLES, type SpreadEstimate } from '../domain/spread';
import { EXEMPTION_THRESHOLD, type TaxLedger } from '../domain/tax-fr';
import {
  MASK,
  fmtDate,
  fmtMoney,
  fmtPct,
  fmtPrice,
  fmtQty,
  fmtRatio,
  roundsToZero,
} from '../format/fr';
import { TIER_LABELS, renderInsights, type RenderedInsight } from '../format/insights';
import { msToParisDay } from '../import/time';
import type { Currency } from '../fx/types';
import { assetName } from '../pricing/tickers';

export const APP_NAME = 'Coût de revient CH';
export const REPORT_TITLE = 'Rapport de portefeuille';
export const DISCLAIMER =
  'Outil indépendant, non affilié à Coinhouse. Les indicateurs de ce rapport sont des aides à la ' +
  'gestion : ils ne constituent ni un conseil en investissement, ni un calcul fiscal (la plus-value ' +
  'imposable en France suit la méthode globale de l’article 150 VH bis du CGI).';

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
  /**
   * Constats (décision n° 40), déjà rendus en français : l'écran et le PDF affichent EXACTEMENT
   * les mêmes phrases, calculées une seule fois.
   */
  insights: { title: string; note: string; items: RenderedInsight[] } | null;
  /** Risque : repli maximal, volatilité, régularité — mesurés sur l'indice de performance. */
  risk: { title: string; details: ReportKpi[]; note: string } | null;
  /** Fiscalité française : estimation par millésime, méthode globale de l'article 150 VH bis. */
  tax: { title: string; details: ReportKpi[]; note: string; warnings: string[] } | null;
  /** Coût réel des opérations : commissions payées et spread implicite estimé. */
  spread: { title: string; details: ReportKpi[]; note: string } | null;
  /** Abonnement Coinhouse : offre déduite de l'export, gains réels, contrefactuel Classique. */
  subscription: { title: string; details: ReportKpi[]; note: string } | null;
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
  /**
   * Performance calculée à partir de l'historique des prix (TWR et repère). Optionnelle : le
   * modèle reste pur et calculable sans historique chargé — les lignes affichent alors « — ».
   */
  performance?: ReportPerformance | undefined;
  /** Analyse de l'abonnement Coinhouse (décision n° 39), calculée par l'appelant sur ses événements. */
  subscription?: SubscriptionAnalysis | undefined;
  /** Constats du moteur de règles (décision n° 40), calculés par l'appelant. */
  insights?: readonly Insight[] | undefined;
  /** Mesures de risque sur l'indice de performance (décision n° 41), calculées par l'appelant. */
  risk?: RiskMetrics | null | undefined;
  /** Estimation fiscale française (décision n° 43), calculée par l'appelant. Toujours en euros. */
  tax?: TaxLedger | null | undefined;
  /** Spread implicite estimé (décision n° 48), calculé par l'appelant sur l'historique de prix. */
  spread?: SpreadEstimate | null | undefined;
}

/** TWR du portefeuille et repère « mêmes apports sur un seul actif », calculés par l'appelant. */
export interface ReportPerformance {
  twr: TwrResult;
  benchmark: BenchmarkResult | null;
  /** Actifs détenus dont l'historique de prix est incomplet (avertissement de fenêtre). */
  partialAssets: number;
}

interface Formatter {
  money(value: Big | null, sign?: boolean): string;
  qty(value: Big | null): string;
  price(value: Big | null): string;
  pct(value: Big | null, sign?: boolean): string;
}

function createFormatter(discreet: boolean, currency: Currency): Formatter {
  return {
    // Le signe est décidé par `fmtMoney` sur la valeur arrondie : « 0,00 € » n'est jamais signé.
    money: (value, sign = false) => {
      if (value === null) return NONE;
      if (discreet) return MASK;
      return fmtMoney(value, currency, { sign });
    },
    qty: (value) => (value === null ? NONE : discreet ? MASK : fmtQty(value)),
    price: (value) => (value === null ? NONE : fmtPrice(value, currency)),
    pct: (value, sign = true) => (value === null ? NONE : fmtPct(value, { sign })),
  };
}

/** Ton d'une valeur telle qu'affichée : neutre si elle s'arrondit à zéro (`dp` = 3 pour un ratio). */
const toneOf = (value: Big | null, dp = 2): Tone =>
  value === null || roundsToZero(value, dp) ? 'neutral' : value.lt(ZERO) ? 'loss' : 'gain';

const cell = (text: string, tone: Tone = 'neutral', sub: string | null = null): ReportCell => ({
  text,
  sub,
  tone,
});

function assetCell(code: AssetCode, extra: string | null = null): ReportCell {
  const ticker = code.toUpperCase();
  const name = assetName(code);
  const sub = [name === ticker ? null : name, extra].filter((s): s is string => s !== null);
  return cell(ticker, 'neutral', sub.length > 0 ? sub.join(' · ') : null);
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
  { label: 'Latent % vs PRU', align: 'right' },
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
    // Le PRU est un prix (décimales adaptées, visible en mode discret), pas un montant.
    cell(f.price(p.pru)),
    cell(f.price(p.price ? D(p.price.priceEur) : null)),
    cell(f.money(p.value)),
    cell(f.money(p.unrealized, true), toneOf(p.unrealized)),
    cell(f.pct(p.unrealizedPct), toneOf(p.unrealizedPct, 3)),
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
            cell(f.pct(pct), toneOf(pct, 3)),
            cell(f.money(realized, true), toneOf(realized)),
            cell(f.money(total, true), toneOf(total)),
          ]
        : null,
    emptyText,
  };
}

function closedTable(items: PositionReport[], f: Formatter): ReportTable {
  // Une position « poussière » (résidu < 0,01 €) reste valorisée par le moteur : son latent
  // résiduel compte dans le P&L total, il est donc montré ici pour que la somme des tableaux
  // égale la synthèse.
  const residual = (p: PositionReport): Big | null => (p.dust ? p.unrealized : null);
  const pnl = (p: PositionReport): Big => p.total ?? p.realized;
  const sorted = [...items].sort((a, b) => pnl(b).cmp(pnl(a)) || a.asset.localeCompare(b.asset));
  const rows = sorted.map((p) => [
    assetCell(p.asset, p.dust ? `résidu ${f.qty(p.qty)} ${p.asset.toUpperCase()}` : null),
    cell(f.money(p.realized, true), toneOf(p.realized)),
    cell(f.money(residual(p), true), toneOf(residual(p))),
    cell(f.money(pnl(p), true), toneOf(pnl(p))),
    cell(String(p.history.length)),
    // L'historique est antichronologique : la première entrée est la dernière opération.
    cell(p.history[0] ? fmtDate(p.history[0].at) : NONE),
  ]);
  const realized = sumBy(items, (p) => p.realized);
  const residuals = sumBy(items, residual);
  const total = sumBy(items, pnl);
  const dust = items.filter((p) => p.dust);
  const operations = items.reduce((n, p) => n + p.history.length, 0);
  const notes = [
    'Positions entièrement cédées, ou dont le résidu vaut moins de 0,01 € (« poussière ») : ce ' +
      'résidu reste valorisé et son latent compte dans le P&L total.',
    dust.length > 0
      ? `Dont résidus : ${plural(dust.length, 'position', 'positions')}, latent résiduel ${f.money(residuals, true)}.`
      : null,
  ].filter((n): n is string => n !== null);
  return {
    kind: 'closed',
    title: 'Positions clôturées',
    note: notes.join(' '),
    columns: [
      { label: 'Actif', align: 'left' },
      { label: 'Réalisé', align: 'right' },
      { label: 'Résidu latent', align: 'right' },
      { label: 'Total', align: 'right' },
      { label: 'Opérations', align: 'right' },
      { label: 'Dernière opération', align: 'right' },
    ],
    rows,
    total:
      rows.length > 0
        ? [
            cell('Total'),
            cell(f.money(realized, true), toneOf(realized)),
            cell(
              dust.length > 0 ? f.money(residuals, true) : NONE,
              toneOf(dust.length > 0 ? residuals : null),
            ),
            cell(f.money(total, true), toneOf(total)),
            cell(String(operations)),
            cell(''),
          ]
        : null,
    emptyText: 'Aucune position clôturée.',
  };
}

function allocationTable(report: PortfolioReport, f: Formatter): ReportTable {
  // Seules les positions valorisées comptent (le moteur peut lister des clôturées à 0).
  const rows = [...report.allocation]
    .sort((a, b) => b.share.cmp(a.share))
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

/** Ligne « Rendement hors apports » : annualisé au-delà de 30 jours, cumulé en dessous. */
function twrKpi(performance: ReportPerformance | undefined, f: Formatter): ReportKpi {
  const twr = performance?.twr;
  if (!twr || !twr.ok)
    return {
      label: 'Rendement hors apports (TWR)',
      value: NONE,
      tone: 'neutral',
      hint:
        twr === undefined
          ? 'nécessite l’historique des prix, en cours de chargement'
          : 'pas encore assez de jours valorisés',
    };
  const rate = twr.annualized ?? twr.cumulative;
  const notes = [
    twr.annualized === null
      ? `cumulé sur ${twr.days} jours (trop court pour annualiser)`
      : `annualisé, depuis le ${fmtDate(twr.since)}`,
    'insensible à la date de vos apports',
  ];
  if (twr.estimatedDays > 0)
    notes.push(`${twr.estimatedDays} jour(s) sans cotation, valorisés au coût`);
  if (twr.neutralizedDays > 0) notes.push(`${twr.neutralizedDays} jour(s) sans capital engagé`);
  if (performance && performance.partialAssets > 0)
    notes.push(`${performance.partialAssets} actif(s) à l’historique incomplet`);
  return {
    label: 'Rendement hors apports (TWR)',
    value: f.pct(rate),
    tone: toneOf(rate, 3),
    hint: notes.join(' · '),
  };
}

/** Ligne « Repère » : le même calendrier d'apports, mais entièrement sur un seul actif. */
function benchmarkKpi(
  performance: ReportPerformance | undefined,
  portfolioValue: Big,
  f: Formatter,
): ReportKpi {
  const benchmark = performance?.benchmark ?? null;
  const label = `Repère : mêmes apports en ${benchmark ? benchmark.asset.toUpperCase() : 'BTC'}`;
  if (!benchmark)
    return {
      label,
      value: NONE,
      tone: 'neutral',
      hint: 'nécessite l’historique des prix du repère',
    };
  const gap = portfolioValue.minus(benchmark.valueEur);
  const notes = [
    `vous : ${f.money(portfolioValue)} · écart ${f.money(gap, true)}`,
    `mêmes montants aux mêmes dates depuis le ${fmtDate(benchmark.since)}`,
  ];
  if (benchmark.skippedFlows > 0)
    notes.push(`${benchmark.skippedFlows} flux hors profondeur de cotation, écartés`);
  if (benchmark.clampedEur.gt(ZERO))
    notes.push(`${f.money(benchmark.clampedEur)} de retraits impossibles, rognés`);
  return { label, value: f.money(benchmark.valueEur), tone: toneOf(gap), hint: notes.join(' · ') };
}

const METHODOLOGY: ReportParagraph[] = [
  {
    title: 'Abonnement Coinhouse',
    text:
      'L’offre est déduite de l’export, jamais demandée : les lignes « Abonnement » facturées ' +
      'disent si une offre est payée (et laquelle, par leur montant sur 12 mois glissants) ; la ' +
      'colonne de remises dit ce que l’offre a réellement fait gagner. La rentabilité affichée ' +
      'est « remises obtenues − abonnements payés » sur la même fenêtre. Le contrefactuel ' +
      '« grille Classique » applique la grille Particuliers du 18/08/2026 aux mêmes opérations, ' +
      'achat supposé par virement SEPA (l’export ne distingue pas la carte) : c’est une ' +
      'estimation prudente, pas une facture.',
  },
  {
    title: 'Rendement hors apports (TWR)',
    text:
      'Rendement pondéré par le temps : on découpe l’historique en journées, on mesure la ' +
      'performance de chacune indépendamment des apports qu’elle contient (un apport ne compte ' +
      'dans le capital de la journée qu’au prorata du temps qui lui reste), puis on enchaîne. ' +
      'Résultat : un taux insensible au calendrier de vos versements, qui mesure vos choix quand ' +
      'le XIRR mesure ce que votre argent a rapporté. Les deux se lisent ensemble : leur écart, ' +
      'c’est l’effet du « moment » de vos apports. Il se calcule sur la fenêtre réellement ' +
      'couverte par les cotations disponibles, et les journées où une position détenue n’a aucun ' +
      'cours sont valorisées à leur coût, donc comptées à rendement nul.',
  },
  {
    title: 'Repère « mêmes apports en BTC »',
    text:
      'On rejoue vos apports et vos retraits réels — mêmes montants, mêmes dates — comme s’ils ' +
      'avaient tous porté sur le bitcoin, au cours de chaque date. Un retrait ne peut pas vendre ' +
      'plus que ce que ce repère détient : l’excédent est signalé plutôt qu’ignoré. C’est un ' +
      'calcul arithmétique sur des prix passés, à titre de comparaison : les performances ' +
      'passées ne préjugent pas des performances futures et rien ici ne constitue un conseil en ' +
      'investissement.',
  },
  {
    title: 'Rendement annualisé (XIRR)',
    text:
      'Taux de rendement interne à dates irrégulières (méthode d’Excel, base 365 jours) : le taux ' +
      'annuel qui égalise tous vos flux datés — achats et frais en sortie, produits en entrée — ' +
      'et la valeur actuelle du portefeuille. Il est pondéré par les montants ET par le temps : ' +
      'c’est le rendement « pour vous », sensible au moment de vos apports. Les récompenses ne ' +
      'sont pas des apports (elles enrichissent la valeur finale) et un virement interne apparié ' +
      'se neutralise. Affiché seulement au-delà de 30 jours d’historique.',
  },
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
      'Latent = valeur actuelle − quantité détenue × PRU ; le « % vs PRU » rapporte ce latent à ' +
      'l’investi (quantité × PRU). Total = réalisé + latent (+ récompenses valorisées, ' +
      '− abonnements, selon les réglages). ROI = total ÷ capital maximal engagé, c’est-à-dire le ' +
      'plus d’euros que vous ayez eu investis en même temps (apports − retraits au plus haut pour ' +
      'le portefeuille ; achats − produits au plus haut pour un actif) : vendre puis racheter ' +
      'n’augmente pas la base, et un euro qui passe par l’USDC n’est compté qu’une fois.',
  },
  {
    title: 'Positions clôturées et résidus',
    text:
      'Une position dont le résidu vaut moins de 0,01 € est classée clôturée ; ce résidu reste ' +
      'valorisé et son latent (proche de −coût) compte dans le P&L total : il apparaît dans la ' +
      'colonne « Résidu latent » et dans le sous-total « dont résidus ».',
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
    title: 'Apports nets (espèces)',
    text:
      'Espèces réellement entrées (achats payés en euros) moins espèces réellement sorties (ventes ' +
      'encaissées en euros), dans la devise du rapport. Les échanges crypto contre crypto ou via ' +
      'stablecoin ne comptent pas : aucun euro n’a bougé.',
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

/**
 * Risque (décision n° 41). Toutes ces mesures portent sur l'INDICE de performance, apports et
 * retraits neutralisés : un virement ne doit jamais ressembler à une perte. La note le dit, parce
 * qu'un repli affiché sans cette précision se compare à tort au relevé de compte.
 */
function riskSection(risk: RiskMetrics | null | undefined, f: Formatter): ReportModel['risk'] {
  if (!risk) return null;
  const drawdown = risk.maxDrawdown;
  const details: ReportKpi[] = [
    {
      label: 'Repli maximal',
      // Un repli est une baisse : on l'affiche négatif, comme une perte.
      value: drawdown === null ? NONE : f.pct(drawdown.depth.times('-1')),
      tone: drawdown === null ? 'neutral' : 'loss',
      hint:
        drawdown === null
          ? 'l’indice n’a jamais reculé sur la période'
          : `du ${fmtDate(drawdown.peakDay)} au ${fmtDate(drawdown.troughDay)} · ${
              drawdown.recoveredDay === null
                ? 'niveau pas encore retrouvé'
                : `retrouvé le ${fmtDate(drawdown.recoveredDay)}`
            }`,
    },
    {
      label: 'Repli en cours',
      value: f.pct(risk.currentDrawdown.times('-1')),
      tone: toneOf(risk.currentDrawdown.times('-1'), 3),
      hint: 'écart avec le plus haut atteint',
    },
    {
      label: 'Volatilité annualisée',
      value: f.pct(risk.volatilityAnnual, false),
      tone: 'neutral',
      hint:
        risk.volatilityAnnual === null
          ? `moins de ${RISK_MIN_DAYS} jours de recul`
          : 'écart-type des variations quotidiennes, × √365',
    },
    {
      label: 'Ratio de Sortino',
      value: risk.sortino === null ? NONE : fmtRatio(risk.sortino),
      tone: risk.sortino === null ? 'neutral' : toneOf(risk.sortino, 2),
      hint:
        risk.sortino === null
          ? 'demande un rendement annualisé et des jours de baisse'
          : 'rendement annualisé ÷ volatilité des seules baisses (cible 0 %)',
    },
    {
      label: 'Jours gagnants',
      value: `${risk.positiveDays} / ${risk.days}`,
      tone: 'neutral',
      hint: plural(risk.negativeDays, 'jour perdant', 'jours perdants'),
    },
  ];
  const extremes =
    risk.bestDay && risk.worstDay
      ? ` Meilleur jour ${f.pct(risk.bestDay.ret)} (${fmtDate(risk.bestDay.day)}), pire jour ${f.pct(risk.worstDay.ret)} (${fmtDate(risk.worstDay.day)}).`
      : '';
  return {
    title: 'Risque',
    details,
    note:
      'Mesuré sur l’indice de performance (apports et retraits neutralisés) : un virement ne compte ' +
      'pas comme une baisse, à la différence de ce que montre un solde de compte.' +
      extremes,
  };
}

/**
 * Coût réel des opérations (décision n° 48) : la commission facturée, que l'export donne, PLUS le
 * spread implicite, qu'il faut estimer. La note porte la précaution méthodologique — sans elle, un
 * pourcentage sorti d'une comparaison à un cours quotidien passerait pour une mesure.
 */
function spreadSection(
  spread: SpreadEstimate | null | undefined,
  report: PortfolioReport,
  f: Formatter,
): ReportModel['spread'] {
  if (!spread) return null;
  const commissions = report.totals.feesEur;
  const estimated = D(spread.estimatedCostEur);
  // Un spread NÉGATIF veut dire que les prix relevés ont été plus favorables que la référence : ce
  // n'est pas un gain à déduire des commissions, qui ont bien été payées. On ne retranche jamais.
  const favourable = estimated.lt(ZERO);
  const details: ReportKpi[] = [
    {
      label: 'Commissions payées',
      value: f.money(commissions),
      tone: 'neutral',
      hint: 'montant facturé, lu dans l’export — ce n’est pas une estimation',
    },
    {
      label: 'Spread implicite estimé',
      value: spread.samples === 0 || favourable ? NONE : f.money(estimated),
      tone: 'neutral',
      hint:
        spread.samples === 0
          ? 'aucune opération comparable à un cours de référence'
          : favourable
            ? `aucun spread défavorable mesuré : les prix relevés ont été en moyenne plus favorables que le cours de référence (${f.pct(D(spread.medianDeviation ?? '0'), true)} sur ${plural(spread.samples, 'opération', 'opérations')})`
            : `${f.pct(D(spread.medianDeviation ?? '0'), false)} de ${plural(spread.samples, 'opération comparée', 'opérations comparées')}, appliqué à ${f.money(D(spread.volumeEur))} de volume`,
    },
    {
      label: 'Coût total estimé',
      value: f.money(
        spread.samples === 0 || favourable ? commissions : commissions.plus(estimated),
      ),
      tone: 'neutral',
      hint:
        spread.samples === 0 || favourable
          ? 'commissions facturées seules — un spread favorable ne s’en retranche pas'
          : 'commissions facturées + spread estimé',
    },
  ];
  const top = spread.byAsset[0];
  // Ne se dit « le plus coûteux » que s'il coûte : sinon la ligne contredit son propre libellé.
  if (top && D(top.estimatedCostEur).gt(ZERO))
    details.push({
      label: 'Actif le plus coûteux',
      value: top.asset.toUpperCase(),
      tone: 'neutral',
      hint: `${f.pct(D(top.medianDeviation), false)} sur ${plural(top.samples, 'opération', 'opérations')}, soit ${f.money(D(top.estimatedCostEur))} estimés`,
    });

  const skipped =
    spread.skipped.noQuotePrice + spread.skipped.notEurQuoted + spread.skipped.noReference;
  return {
    title: 'Coût réel des opérations (estimation)',
    details,
    note:
      'Le spread est l’écart entre le prix affiché par la plateforme et le cours de référence du ' +
      'marché : un coût réel, absent de la grille tarifaire comme du relevé. Il est estimé ici en ' +
      'comparant chaque opération au cours de CLÔTURE de sa journée, ce qui mêle au spread le ' +
      'mouvement du marché pendant la journée — souvent plus grand que lui. C’est pourquoi aucun ' +
      'chiffre par opération n’est affiché : seule la MÉDIANE est retenue, parce que le bruit ' +
      'journalier s’annule à peu près et qu’un écart systématiquement défavorable, lui, subsiste. ' +
      (spread.reliable
        ? ''
        : `Avec ${plural(spread.samples, 'opération comparée', 'opérations comparées')} seulement, l’estimation reste fragile : elle demande au moins ${MIN_SPREAD_SAMPLES} opérations pour valoir quelque chose. `) +
      (skipped > 0
        ? `${plural(skipped, 'opération n’a pas pu être comparée', 'opérations n’ont pas pu être comparées')} (cotation absente, cotation dans une autre devise, ou cours du jour manquant).`
        : ''),
  };
}

/**
 * Fiscalité française (décision n° 43) — **estimation**, et rien d'autre. Les montants restent en
 * EUROS même si l'app affiche en dollars : c'est une obligation française. Le mode discret masque
 * quand même les montants, ce sont des montants.
 */
function taxSection(tax: TaxLedger | null | undefined, discreet: boolean): ReportModel['tax'] {
  if (!tax || tax.years.length === 0) return null;
  const eur = (value: DecimalString | Big, sign = false): string =>
    discreet ? MASK : fmtMoney(D(value), 'EUR', { sign });
  const details: ReportKpi[] = [];
  // Les trois derniers millésimes suffisent à un rapport : au-delà, c'est de l'archive.
  for (const year of tax.years.slice(0, 3)) {
    details.push({
      label: `${year.year} · cessions imposables`,
      value: eur(year.proceedsEur),
      tone: 'neutral',
      hint: `${plural(year.cessionCount, 'cession', 'cessions')} vers une monnaie ayant cours légal${
        year.exempt ? ` · sous le seuil de ${EXEMPTION_THRESHOLD} €, exonéré` : ''
      }`,
    });
    details.push({
      label: `${year.year} · résultat net`,
      value: eur(year.netEur, true),
      tone: toneOf(D(year.netEur)),
      hint: `${eur(year.gainsEur)} de plus-values, ${eur(year.lossesEur)} de moins-values (imputables sur la seule année ${year.year})`,
    });
    details.push({
      label: `${year.year} · impôt estimé`,
      value: eur(year.taxEur),
      tone: 'neutral',
      hint: year.exempt
        ? 'exonéré : total des cessions sous le seuil'
        : D(year.netEur).lte(ZERO)
          ? 'année nette perdante : rien à payer, et la perte ne se reporte pas'
          : `prélèvement forfaitaire unique ${year.rateLabel}`,
    });
  }
  details.push({
    label: 'Prix total d’acquisition restant',
    value: eur(tax.ptaAfter),
    tone: 'neutral',
    hint: 'base de la prochaine cession — celui du PORTEFEUILLE, sans rapport avec le PRU par actif',
  });

  const warnings: string[] = [];
  if (tax.unknownGlobalValue > 0)
    warnings.push(
      `${plural(tax.unknownGlobalValue, 'cession n’a pas pu être chiffrée', 'cessions n’ont pas pu être chiffrées')} : la valeur du portefeuille au jour de l’opération est inconnue (historique de prix trop court).`,
    );
  if (tax.externalInflows > 0)
    warnings.push(
      `${plural(tax.externalInflows, 'entrée venue de l’extérieur est sans coût connu', 'entrées venues de l’extérieur sont sans coût connu')} : le prix d’acquisition est sous-estimé, donc la plus-value surestimée.`,
    );
  if (tax.externalOutflows > 0)
    warnings.push(
      `${plural(tax.externalOutflows, 'sortie vers l’extérieur n’est pas classée', 'sorties vers l’extérieur ne sont pas classées')} : un simple transfert n’est pas imposable, un paiement en crypto l’est — un export ne permet pas de les distinguer.`,
    );
  if (tax.rewards > 0)
    warnings.push(
      `${plural(tax.rewards, 'récompense reçue', 'récompenses reçues')} : leur régime propre n’est pas traité ici.`,
    );

  return {
    title: 'Fiscalité française (estimation)',
    details,
    note:
      'Estimation calculée selon la méthode globale de l’article 150 VH bis du CGI : plus-value = ' +
      'prix de cession − prix total d’acquisition × (prix de cession ÷ valeur globale du portefeuille ' +
      'au jour de la cession). Seules les sorties vers l’euro sont imposables ; les échanges entre ' +
      'actifs numériques, stablecoins compris, bénéficient du sursis. Deux hypothèses commandent le ' +
      'résultat : ce portefeuille est supposé être VOTRE PORTEFEUILLE ENTIER (des avoirs détenus ' +
      'ailleurs changeraient le calcul), et la valeur globale de chaque jour est reconstituée à ' +
      'partir des cours de clôture. **Ce n’est ni une déclaration, ni un conseil fiscal** : faites ' +
      'vérifier votre situation par un professionnel.',
    warnings,
  };
}

/**
 * Constats : le rapport ne les recalcule pas, il rend en français ceux que l'appelant a produits
 * (mêmes phrases qu'à l'écran d'accueil, mêmes réglages de devise et de mode discret).
 */
function insightsSection(
  list: readonly Insight[] | undefined,
  discreet: boolean,
  currency: Currency,
): ReportModel['insights'] {
  if (list === undefined || list.length === 0) return null;
  return {
    title: 'Constats',
    note:
      'Observations calculées à partir de vos seules données, à la date de ce rapport. Elles ' +
      'décrivent votre portefeuille : ce ne sont ni des recommandations d’achat ou de vente, ni ' +
      'un conseil en investissement.',
    items: renderInsights(list, { discreet, currency }),
  };
}

/**
 * Section « Abonnement Coinhouse » (décision n° 39) : tout est DÉDUIT de l'export — lignes
 * d'abonnement facturées, colonne de remises — jamais demandé à l'utilisateur. Masquée sans
 * opération Coinhouse ; le contrefactuel Classique est une estimation prudente et le dit.
 */
function subscriptionSection(
  s: SubscriptionAnalysis | undefined,
  f: Formatter,
): ReportModel['subscription'] {
  if (!s || (s.tradeCount === 0 && s.subscriptionCount === 0)) return null;
  const details: ReportKpi[] = [
    {
      label: 'Offre détectée',
      value: TIER_LABELS[s.detectedTier],
      tone: 'neutral',
      hint: s.detectionNote,
    },
  ];
  if (s.detectedTier === 'classique') {
    details.push(
      {
        label: 'Frais payés (12 derniers mois)',
        value: f.money(D(s.feesNet12m)),
        tone: 'neutral',
        hint: `volume d'opérations sur 12 mois : ${f.money(D(s.volume12m))} ; depuis le début : ${f.money(D(s.feesNet))} de frais`,
      },
      {
        label: 'Seuil de rentabilité de l’offre Investisseur',
        value:
          s.breakEvenAnnualVolume === null
            ? NONE
            : `≈ ${f.money(D(s.breakEvenAnnualVolume))} d'opérations par an`,
        tone: 'neutral',
        hint: 'abonnement 118,80 €/an (grille du 18/08/2026), hypothèse « frais offerts sur ce volume » — vérifiez les conditions de l’offre',
      },
    );
  } else {
    details.push(
      {
        label: 'Abonnements payés (12 derniers mois)',
        value: f.money(D(s.subscriptions12m)),
        tone: 'neutral',
        hint: `depuis le début de l'export : ${f.money(D(s.subscriptionsTotal))}`,
      },
      {
        label: 'Remises de frais obtenues (12 derniers mois)',
        value: f.money(D(s.rebates12m)),
        tone: 'neutral',
        hint: `depuis le début : ${f.money(D(s.rebates))} de remises, pour ${f.money(D(s.feesGross))} de frais bruts (${f.money(D(s.feesNet))} réellement payés)`,
      },
      {
        label: 'Rentabilité de l’offre (12 derniers mois)',
        value: f.money(D(s.netOfSubscription12m ?? '0'), true),
        tone: toneOf(D(s.netOfSubscription12m ?? '0')),
        hint:
          'remises obtenues − abonnements payés : positif, l’offre s’est remboursée ; ' +
          `depuis le début : ${f.money(D(s.netOfSubscription ?? '0'), true)}`,
      },
      {
        label: 'Économies vs grille Classique (estimation)',
        value: f.money(D(s.savedVsClassique), true),
        tone: toneOf(D(s.savedVsClassique)),
        hint: 'mêmes opérations aux frais Classique du 18/08/2026, achat supposé par virement — estimation',
      },
    );
  }
  return {
    title: 'Abonnement Coinhouse',
    details,
    note:
      'Déduit de votre export : lignes d’abonnement facturées et remises de frais. Les montants ' +
      'suivent la devise d’affichage ; la fenêtre « 12 derniers mois » se termine à votre ' +
      'dernière opération Coinhouse. Les grilles et offres évoluent — vérifiez la vôtre.',
  };
}

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
  if (opts.discreet)
    notes.push(
      `Mode discret : les montants et quantités sont masqués (${MASK}) ; prix, PRU et pourcentages restent lisibles.`,
    );
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

  // Les actifs sans cours sont hors « Investi », « Latent », « P&L total » et « ROI » : on le dit
  // à côté de chaque chiffre concerné, pas seulement sous « Valeur ».
  const unpriced = t.unpricedAssets.length;
  const unpricedHint = unpriced > 0 ? ' · hors actifs sans cours' : '';
  const kpis: ReportKpi[] = [
    {
      label: 'Investi',
      value: f.money(t.costBasis),
      tone: 'neutral',
      hint:
        unpriced > 0
          ? `quantité × PRU · hors ${f.money(t.unpricedCostBasis)} sans cours`
          : 'quantité détenue × PRU',
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
      hint:
        'réalisé + latent' +
        (t.otherIncome.gt(ZERO) ? ' + récompenses valorisées' : '') +
        (opts.subscriptionsInPnl ? ' − abonnements' : '') +
        unpricedHint,
    },
    {
      label: 'ROI',
      value: f.pct(t.roi),
      tone: toneOf(t.roi, 3),
      hint: `sur ${f.money(t.roiBase)} engagés${unpricedHint}`,
    },
  ];

  const xirr = xirrEur(report.cashFlows, {
    day: msToParisDay(Date.parse(opts.generatedAt)),
    valueEur: t.value,
  });
  const xirrHint = xirr.ok
    ? `pondéré par les flux, depuis le ${fmtDate(xirr.since)}${unpricedHint}` +
      (report.blocked.length > 0 ? ' · historique bloqué exclu de la valeur' : '')
    : xirr.reason === 'too-recent'
      ? `moins de ${XIRR_MIN_SPAN_DAYS} jours d’historique : annualiser n’aurait pas de sens`
      : xirr.reason === 'no-convergence'
        ? 'non calculable sur ces flux'
        : 'pas encore assez de flux datés (au moins un apport et une valeur)';

  const details: ReportKpi[] = [
    {
      label: 'Rendement annualisé (XIRR)',
      value: xirr.ok ? f.pct(xirr.rate) : NONE,
      tone: xirr.ok ? toneOf(xirr.rate, 3) : 'neutral',
      hint: xirrHint,
    },
    twrKpi(opts.performance, f),
    benchmarkKpi(opts.performance, t.value, f),
    {
      label: 'Apports nets (espèces)',
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
      hint: opts.subscriptionsInPnl ? 'déduits du P&L total' : 'hors P&L',
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
    insights: insightsSection(opts.insights, opts.discreet, currency),
    risk: riskSection(opts.risk, f),
    tax: taxSection(opts.tax, opts.discreet),
    spread: spreadSection(opts.spread, report, f),
    subscription: subscriptionSection(opts.subscription, f),
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
