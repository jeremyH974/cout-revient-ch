/**
 * Le rapport de prêts (P116, décision n° 178).
 *
 * **Il reprend l'écran Prêts, ni plus ni moins.** Ce qu'un rapport de prêts doit contenir au-delà
 * de l'écran est une décision du propriétaire, rangée comme telle depuis la proposition du
 * 20/09/2026 : ni la session qui l'a écrite ni celle-ci ne l'ont prise à sa place. Deux ajouts sont
 * sur la table, et aucun n'est ici — un taux de défaut personnel calqué sur l'article 20 du
 * règlement (UE) 2020/1503, et une version « douze derniers mois » du recyclage.
 *
 * **Il ne calcule rien.** Les grandeurs viennent de `lendingSummary`, du TRI (`lendingPerformance`)
 * et de la concentration du moteur de prêts ; l'écran les convertit dans la devise d'affichage.
 *
 * **Une métrique maison, dite comme telle.** Le « recyclage » — capital prêté cumulé ÷ apports
 * nets — n'a aucun nom établi : la recherche du 21/09/2026 n'en a trouvé dans aucune documentation
 * de plateforme ni aucun texte, seulement une analogie imparfaite avec le *capital recycling* du
 * capital-investissement. Son dénominateur est cumulé, son numérateur aussi : il grossit
 * mécaniquement avec le temps. Le rapport le montre, comme l'écran, et dit ce qu'il est.
 */
import { D, ZERO, type Big } from '../domain/money';
import type { XirrResult } from '../domain/xirr';
import { fmtPct } from '../format/fr';
import { xirrFailureLabel } from '../format/xirr';
import type { Currency } from '../fx/types';
import {
  APP_NAME,
  NONE,
  cell,
  createFormatter,
  detailsSection,
  localDateTime,
  plural,
  tableSection,
  toneOf,
  type Formatter,
  type ReportCell,
  type ReportFact,
  type ReportKpi,
  type ReportModel,
  type ReportParagraph,
  type ReportSection,
  type ReportTable,
} from './report-model';

export const LENDING_REPORT_TITLE = 'Rapport de prêts';

export const LENDING_DISCLAIMER =
  'Outil indépendant. Ce rapport met en forme vos propres relevés de prêts : il vaut ce qu’ils ' +
  'valent. Il ne constitue ni un conseil en investissement, ni un document fiscal.';

/** Un emprunteur parmi les plus exposés, montant déjà dans la devise d'affichage. */
export interface LendingRiskRow {
  key: string;
  outstanding: Big | null;
  /** Poids dans l'encours, ratio. */
  weight: Big;
}

/** Montants déjà convertis dans la devise d'affichage ; `null` = non convertible. */
export interface LendingReportInput {
  netContributions: Big | null;
  result: Big | null;
  value: Big | null;
  deposits: Big | null;
  withdrawals: Big | null;
  bonus: Big | null;
  principalLent: Big | null;
  outstanding: Big | null;
  accrued: Big | null;
  cash: Big | null;
  interestGross: Big | null;
  withheld: Big | null;
  interestNet: Big | null;
  taxDebitedFromWallet: Big | null;
  writtenOff: Big | null;
  /** Ratios : ils ne se convertissent pas. */
  recycling: Big | null;
  returnOnContributions: Big | null;
  xirrNet: XirrResult;
  xirrGross: XirrResult;
  /** Prêts dont l'intérêt couru n'est pas calculable (ni taux ni convention de jours). */
  accrualUnavailable: number;
  concentration: {
    /** Indice de Herfindahl-Hirschman, dans `[0, 1]`. */
    index: Big | null;
    effectiveCount: Big | null;
    top: readonly LendingRiskRow[];
  };
}

export interface LendingReportOptions {
  discreet: boolean;
  currency?: Currency | undefined;
  generatedAt: string;
  version: string;
  timeZone?: string | undefined;
}

/** Le TRI comme l'écran l'écrit : un taux « par an », ou la raison de son absence. */
const tri = (r: XirrResult): string =>
  r.ok ? `${fmtPct(r.rate, { sign: false })} par an` : xirrFailureLabel(r.reason);

/**
 * La concentration en mots, avec les seuils de l'écran : ceux des autorités de concurrence
 * (indice ramené à l'échelle 0–10 000 ; sous 1 500 dispersé, sous 2 500 modérément concentré).
 */
function spreadLabel(index: Big | null): string {
  if (index === null) return 'Non mesurable';
  const hhi = index.times(D('10000'));
  if (hhi.lt(D('1500'))) return 'Dispersé';
  if (hhi.lt(D('2500'))) return 'Modérément concentré';
  return 'Fortement concentré';
}

function riskTable(input: LendingReportInput, f: Formatter): ReportTable {
  const rows: ReportCell[][] = input.concentration.top
    .slice(0, 5)
    .map((row) => [cell(row.key), cell(f.money(row.outstanding)), cell(f.pct(row.weight, false))]);
  return {
    kind: 'lendingRisk',
    columns: [
      { label: 'Emprunteur', align: 'left' },
      { label: 'Encours', align: 'right' },
      { label: 'Part', align: 'right' },
    ],
    rows,
    total: null,
    emptyText: 'Aucun prêt en cours.',
  };
}

function riskLead(input: LendingReportInput): string {
  const c = input.concentration;
  const effective =
    c.effectiveCount === null
      ? ''
      : ` · ${c.effectiveCount.toFixed(1).replace('.', ',')} emprunteurs effectifs`;
  return (
    `${spreadLabel(c.index)}${effective}. « Emprunteurs effectifs » : le nombre de lignes de poids ` +
    'égal qui donnerait la même concentration.'
  );
}

function coverageSection(input: LendingReportInput): ReportSection {
  const items: string[] = [];
  if (input.accrualUnavailable > 0)
    items.push(
      `Les intérêts courus non échus ne sont pas comptés sur ` +
        `${plural(input.accrualUnavailable, 'prêt', 'prêts')} : l’export ne porte ni taux ni ` +
        'convention de jours. La valeur est donc légèrement sous-estimée, et le TRI prudent.',
    );
  items.push(
    'Le recyclage est une métrique propre à cette application, sans équivalent établi : capital ' +
      'prêté cumulé ÷ apports nets. Ses deux termes sont cumulés, il croît donc mécaniquement avec ' +
      'le temps.',
  );
  if (input.taxDebitedFromWallet !== null && !input.taxDebitedFromWallet.eq(ZERO))
    items.push(
      'L’impôt débité du portefeuille est montré pour information : les prélèvements ventilés par ' +
        'prêt font foi, et il n’est additionné à rien.',
    );
  return {
    id: 'coverage',
    title: 'Ce que ce document ne dit pas',
    block: { kind: 'bullets', items },
    lead: null,
    note: null,
    warnings: [],
    breakBefore: false,
  };
}

const METHODOLOGY: ReportParagraph[] = [
  {
    title: 'Une identité, pas une estimation',
    text:
      'Apports nets + résultat = valeur. Les apports nets sont ce que vous avez versé moins ce que ' +
      'vous avez retiré ; la valeur est l’encours, plus les intérêts courus, plus la trésorerie non ' +
      'prêtée ; le résultat est la différence.',
  },
  {
    title: 'Le capital prêté n’est pas un apport',
    text:
      'Un euro remboursé puis reprêté est compté deux fois dans le capital prêté, une seule fois ' +
      'dans vos apports. C’est pourquoi le capital prêté dépasse vos apports, et pourquoi le ' +
      'rendement se rapporte toujours aux apports.',
  },
  {
    title: 'Deux rendements, deux questions',
    text:
      'Le TRI répond à « combien par an, compte tenu du calendrier de mes versements ». Le ' +
      'rendement sur apports répond à « combien au total, depuis l’origine » : il n’est pas ' +
      'annualisé. Le TRI net est calculé après les prélèvements retenus à la source.',
  },
];

/** Le modèle du rapport de prêts. */
export function buildLendingReportModel(
  input: LendingReportInput,
  opts: LendingReportOptions,
): ReportModel {
  const currency: Currency = opts.currency ?? 'EUR';
  const f = createFormatter(opts.discreet, currency);
  const generated = localDateTime(opts.generatedAt, opts.timeZone);

  const facts: ReportFact[] = [
    { label: 'Généré le', value: generated.label },
    { label: 'Devise', value: currency },
    { label: 'Emprunteurs en cours', value: String(input.concentration.top.length) },
    // « Apports nets + résultat = valeur » est une identité depuis l'origine : la plage d'analyse
    // ne la gouverne pas, pas plus qu'elle ne gouverne l'écran Prêts (décision n° 179).
    { label: 'Période d’analyse', value: 'depuis l’origine' },
  ];
  const notes: string[] = [];
  if (opts.discreet)
    notes.push(
      'Mode discret : les montants sont masqués ; les taux et les parts restent lisibles.',
    );

  const kpis: ReportKpi[] = [
    {
      label: 'Apports nets',
      value: f.money(input.netContributions),
      tone: 'neutral',
      hint: 'versé − retiré',
    },
    {
      label: 'Résultat',
      value: f.money(input.result, true),
      tone: toneOf(input.result),
      hint: 'valeur − apports nets',
    },
    {
      label: 'Valeur du portefeuille',
      value: f.money(input.value),
      tone: 'neutral',
      hint: 'encours + courus + trésorerie',
    },
    {
      label: 'TRI net',
      value: tri(input.xirrNet),
      tone: 'neutral',
      hint: 'après prélèvements à la source',
    },
  ];
  const details: ReportKpi[] = [
    { label: 'TRI brut', value: tri(input.xirrGross), tone: 'neutral', hint: 'avant prélèvements' },
    {
      label: 'Rendement sur apports',
      value: f.pct(input.returnOnContributions),
      tone: toneOf(input.returnOnContributions, 3),
      hint: 'résultat ÷ apports nets, cumulé, non annualisé',
    },
    { label: 'Dépôts', value: f.money(input.deposits), tone: 'neutral', hint: null },
    { label: 'Retraits', value: f.money(input.withdrawals), tone: 'neutral', hint: null },
  ];

  const account: ReportKpi[] = [
    {
      label: 'Capital prêté',
      value: f.money(input.principalLent),
      tone: 'neutral',
      hint: 'cumulé — le même argent, plusieurs fois',
    },
    {
      label: 'Encours',
      value: f.money(input.outstanding),
      tone: 'neutral',
      hint: 'capital restant dû',
    },
    {
      label: 'Intérêts courus',
      value: f.money(input.accrued),
      tone: 'neutral',
      hint: 'non échus, calculables',
    },
    {
      label: 'Trésorerie non prêtée',
      value: f.money(input.cash),
      tone: 'neutral',
      hint: 'disponible sur la plateforme',
    },
    {
      label: 'Recyclage',
      value:
        input.recycling === null
          ? NONE
          : `${input.recycling.toFixed(2).replace('.', ',')} fois vos apports`,
      tone: 'neutral',
      hint: 'capital prêté ÷ apports nets — métrique maison',
    },
  ];

  const income: ReportKpi[] = [
    {
      label: 'Intérêts bruts encaissés',
      value: f.money(input.interestGross),
      tone: 'neutral',
      hint: null,
    },
    {
      label: 'Prélèvements retenus à la source',
      value: f.money(input.withheld === null ? null : input.withheld.neg(), true),
      tone: toneOf(input.withheld === null ? null : input.withheld.neg()),
      hint: 'ventilés prêt par prêt',
    },
    {
      label: 'Intérêts nets',
      value: f.money(input.interestNet),
      tone: 'neutral',
      hint: null,
    },
    {
      label: 'Bonus de la plateforme',
      value: f.money(input.bonus),
      tone: 'neutral',
      hint: 'un gain, jamais un apport',
    },
    {
      label: 'Capital passé en perte',
      value: f.money(input.writtenOff === null ? null : input.writtenOff.neg(), true),
      tone: toneOf(input.writtenOff === null ? null : input.writtenOff.neg()),
      hint: null,
    },
  ];

  const sections: ReportSection[] = [
    {
      id: 'summary',
      title: 'Synthèse',
      block: { kind: 'kpis', kpis, details },
      lead: 'Apports nets + résultat = valeur : les trois premiers chiffres sont une seule identité.',
      note: null,
      warnings: [],
      breakBefore: false,
    },
    detailsSection('account', 'Détails du compte', account, null),
    // Pas d'identité imprimée ici : « intérêts nets + bonus − pertes = résultat » ne tient que
    // sans intérêts courus, qui entrent dans la valeur. Le bandeau porte déjà l'identité vérifiée.
    detailsSection('income', 'Revenus et pertes', income, null),
    tableSection('risk', 'Répartition du risque', riskLead(input), riskTable(input, f)),
    coverageSection(input),
    {
      id: 'methodology',
      title: 'Méthodologie',
      block: { kind: 'paragraphs', items: METHODOLOGY },
      lead: null,
      note: null,
      warnings: [],
      breakBefore: true,
    },
  ];

  return {
    meta: {
      appName: APP_NAME,
      title: LENDING_REPORT_TITLE,
      version: opts.version,
      generatedAt: opts.generatedAt,
      generatedLabel: generated.label,
      currency,
      discreet: opts.discreet,
      dateStamp: generated.stamp,
      fileSlug: 'prets',
    },
    cover: {
      title: LENDING_REPORT_TITLE,
      subtitle: 'Apports, valeur, revenus et risque — le financement participatif',
      facts,
      notes,
      disclaimer: LENDING_DISCLAIMER,
    },
    sections,
    footer: {
      left: `${APP_NAME} · version ${opts.version} · rapport de prêts`,
      right: `Généré le ${generated.label}`,
    },
  };
}
