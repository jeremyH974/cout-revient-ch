/**
 * Le rapport de trading (P116, décision n° 178).
 *
 * Même contrat que le rapport de patrimoine : il rend un `ReportModel`, une liste ordonnée de
 * sections que les deux rendus itèrent sans en connaître le nom (décision n° 174). Il n'ajoute ni
 * branche à `pdf.ts`, ni bloc au markup — seulement une forme de tableau, déclarée dans
 * `TableKind`, dont le compilateur exige les largeurs.
 *
 * **Il ne calcule rien.** Les totaux viennent du moteur de trading (`domain/trading/compute.ts`),
 * les statistiques de `computeStats` (`domain/trading/stats.ts`) ; l'écran les convertit dans la
 * devise d'affichage avant de les passer ici. Le modèle met en mots — et dit ce qu'il ne sait pas.
 *
 * **Deux populations, et le rapport le dit.** La synthèse se calcule sur **tous les fills** : le
 * réalisé d'une position encore ouverte y figure. Les statistiques se calculent sur les **seuls
 * aller-retours clos**. Leurs deux « résultats nets » diffèrent donc, et c'est normal ; les imprimer
 * côte à côte sans le dire ferait croire à une erreur, ou en cacherait une.
 *
 * **Ce que la littérature dit des petits échantillons, et ce qu'on en retient.** Le seuil de
 * 30 trades clos est le plancher couramment cité, 100 et plus la pratique recommandée (Tradervue,
 * *Report Statistics* ; TraderSync). Sous 30, l'application le disait déjà à l'écran : le rapport le
 * dit aussi, à côté des ratios. Et l'application ne calcule **pas** de ratio de Sharpe : sur des
 * rendements autocorrélés il s'annualise mal (Lo, *The Statistics of Sharpe Ratios*, FAJ 2002, repris
 * par D. Kidd pour le CFA Institute, 2012). Un rapport n'est pas l'endroit pour en inventer un.
 */
import type { Big } from '../domain/money';
import type { TradingStats } from '../domain/trading/stats';
import type { Currency } from '../fx/types';
import {
  APP_NAME,
  NONE,
  cell,
  createFormatter,
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

export const TRADING_REPORT_TITLE = 'Rapport de trading';

export const TRADING_DISCLAIMER =
  'Outil indépendant. Ce rapport met en forme vos propres relevés de trading : il vaut ce qu’ils ' +
  'valent. Il ne constitue ni un conseil en investissement, ni un document fiscal — le régime des ' +
  'contrats perpétuels n’y est pas chiffré.';

/** Un compte de trading, montants déjà dans la devise d'affichage ; `null` = non convertible. */
export interface TradingReportAccount {
  label: string;
  /** Valeur du compte ; `null` sans instantané — un solde non mesuré n'est pas un solde nul. */
  equity: Big | null;
  net: Big | null;
  realized: Big | null;
  fees: Big | null;
  funding: Big | null;
  netFlows: Big | null;
  fills: number;
}

export interface TradingReportInput {
  /** Réalisé net de tous les comptes : `réalisé − frais perps + funding`. */
  net: Big | null;
  realized: Big | null;
  /** Frais des seuls fills perps, rebates déduits — la part qui touche l'équité. */
  fees: Big | null;
  funding: Big | null;
  unrealized: Big | null;
  /** Valeur totale des comptes ; `null` dès qu'un compte n'a pas d'instantané. */
  equity: Big | null;
  /** Apports nets : dépôts, retraits et transferts signés. */
  netFlows: Big | null;
  accounts: readonly TradingReportAccount[];
  /** Comptes sans instantané, sous leur libellé : ceux qui rendent `equity` nulle. */
  unvalued: readonly string[];
  /** Frais payés dans un autre jeton que la devise de cotation (ex. HYPE), non convertis. */
  nativeFeeTokens: readonly string[];
  /** Statistiques des aller-retours clos, déjà dans la devise d'affichage. */
  stats: TradingStats;
}

export interface TradingReportOptions {
  discreet: boolean;
  currency?: Currency | undefined;
  /** Instant de génération, ISO 8601. */
  generatedAt: string;
  version: string;
  timeZone?: string | undefined;
}

/** `réalisé net + latent`, ou `null` si l'un des deux manque : on n'additionne pas un inconnu. */
function resultOf(input: TradingReportInput): Big | null {
  return input.net === null || input.unrealized === null ? null : input.net.plus(input.unrealized);
}

/** Un ratio de statistiques de trading, tel que l'écran « Statistiques » l'écrit. */
const ratio = (value: Big | null): string =>
  value === null ? NONE : value.toFixed(2).replace('.', ',');

function accountsTable(input: TradingReportInput, f: Formatter): ReportTable {
  const rows: ReportCell[][] = input.accounts.map((a) => [
    cell(
      a.label,
      'neutral',
      a.equity === null ? 'sans instantané' : plural(a.fills, 'fill', 'fills'),
    ),
    cell(f.money(a.equity)),
    cell(f.money(a.net, true), toneOf(a.net)),
    cell(f.money(a.fees === null ? null : a.fees.neg(), true), toneOf(a.fees?.neg() ?? null)),
    cell(f.money(a.funding, true), toneOf(a.funding)),
    cell(f.money(a.netFlows, true)),
  ]);
  return {
    kind: 'tradingAccounts',
    columns: [
      { label: 'Compte', align: 'left' },
      { label: 'Valeur', align: 'right' },
      { label: 'Réalisé net', align: 'right' },
      { label: 'Frais', align: 'right' },
      { label: 'Funding', align: 'right' },
      { label: 'Apports nets', align: 'right' },
    ],
    rows,
    total:
      input.accounts.length > 1
        ? [
            cell('Total'),
            cell(f.money(input.equity)),
            cell(f.money(input.net, true), toneOf(input.net)),
            cell(
              f.money(input.fees === null ? null : input.fees.neg(), true),
              toneOf(input.fees?.neg() ?? null),
            ),
            cell(f.money(input.funding, true), toneOf(input.funding)),
            cell(f.money(input.netFlows, true)),
          ]
        : null,
    emptyText: 'Aucun compte de trading.',
  };
}

function statsSection(s: TradingStats, f: Formatter): ReportSection {
  const kpis: ReportKpi[] = [
    {
      label: 'Trades clos',
      value: String(s.closed),
      tone: 'neutral',
      hint: `${s.wins} gagnés · ${s.losses} perdus · ${s.breakeven} neutres`,
    },
    {
      label: 'Taux de réussite',
      value: f.pct(s.winRate, false),
      tone: 'neutral',
      hint: 'gagnés ÷ (gagnés + perdus)',
    },
    {
      label: 'Profit factor',
      value: ratio(s.profitFactor),
      tone: 'neutral',
      hint: 'Σ gains ÷ |Σ pertes|',
    },
    {
      label: 'Espérance',
      value: f.money(s.expectancy, true),
      tone: toneOf(s.expectancy),
      hint: 'P&L net moyen par trade clos',
    },
  ];
  const details: ReportKpi[] = [
    {
      label: 'Payoff',
      value: ratio(s.payoff),
      tone: 'neutral',
      hint: 'gain moyen ÷ perte moyenne',
    },
    {
      label: 'Espérance en R',
      value: s.expectancyR === null ? NONE : `${ratio(s.expectancyR)} R`,
      tone: toneOf(s.expectancyR, 3),
      hint: `sur ${plural(s.nR, 'trade', 'trades')} dont le risque était planifié`,
    },
    {
      label: 'Drawdown maximal',
      value: f.money(s.maxDrawdown === null ? null : s.maxDrawdown.neg(), true),
      tone: toneOf(s.maxDrawdown === null ? null : s.maxDrawdown.neg()),
      hint: 'pire creux du P&L net cumulé des trades clos',
    },
    {
      label: 'Meilleur · pire trade',
      value: `${f.money(s.best, true)} · ${f.money(s.worst, true)}`,
      tone: 'neutral',
      hint: 'P&L net',
    },
    {
      label: 'Plus longues séries',
      value: `${s.longestWinStreak} gagnés · ${s.longestLossStreak} perdus`,
      tone: 'neutral',
      hint: 'consécutifs',
    },
  ];
  const warnings: string[] = [];
  if (s.smallSample)
    warnings.push(
      `${plural(s.closed, 'trade clos', 'trades clos')} seulement : sous 30, ces ratios décrivent le ` +
        'passé sans permettre d’en conclure quoi que ce soit.',
    );
  if (s.excluded > 0)
    warnings.push(
      `${plural(s.excluded, 'trade clos n’a', 'trades clos n’ont')} pas pu être converti dans la ` +
        'devise d’affichage : exclu des sommes, compté dans les effectifs.',
    );
  return {
    id: 'stats',
    title: 'Statistiques des trades clos',
    block: { kind: 'kpis', kpis, details },
    lead:
      `Sur ${plural(s.closed, 'aller-retour clos', 'allers-retours clos')}, et eux seuls : ` +
      `un trade encore ouvert n'a pas de résultat à compter.`,
    note: null,
    warnings,
    breakBefore: false,
  };
}

function coverageSection(input: TradingReportInput): ReportSection {
  const items: string[] = [];
  if (input.unvalued.length > 0)
    items.push(
      `${plural(input.unvalued.length, 'compte n’a', 'comptes n’ont')} pas d’instantané ` +
        `(${input.unvalued.join(', ')}) : la valeur totale n’est pas mesurée, et elle ne compte pas ` +
        'pour zéro.',
    );
  if (input.nativeFeeTokens.length > 0)
    items.push(
      `Des frais ont été payés en ${input.nativeFeeTokens.join(', ')} : ils ne sont pas convertis, et ` +
        'ne figurent donc dans aucun total ci-dessus.',
    );
  if (input.stats.open > 0)
    items.push(
      `${plural(input.stats.open, 'trade est encore ouvert', 'trades sont encore ouverts')} : son ` +
        'latent est dans la synthèse, pas dans les statistiques.',
    );
  items.push(
    'Le régime fiscal des contrats perpétuels n’est pas chiffré : aucune source primaire ne le ' +
      'qualifie aujourd’hui, et un chiffre sans fondement serait pire qu’une absence.',
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
    title: 'Réalisé net, latent, résultat',
    text:
      'Le réalisé net est le résultat des positions clôturées, frais des contrats déduits et ' +
      'funding compris. Le latent est celui des positions encore ouvertes, au dernier instantané. ' +
      'Leur somme est le résultat : aucun des trois n’est modélisé.',
  },
  {
    title: 'Daté à la réalisation',
    text:
      'Un gain compte le jour où il se réalise, jamais le jour où la position se referme : une ' +
      'position close en plusieurs fois répartit son résultat sur les jours de ses clôtures ' +
      'partielles.',
  },
  {
    title: 'Deux populations',
    text:
      'La synthèse porte sur tous les fills ; les statistiques, sur les seuls allers-retours clos. ' +
      'Un trade ouvert a déjà du réalisé si on l’a allégé, mais pas encore de résultat final : il ' +
      'entre dans la première, pas dans la seconde. Les deux totaux ne se recoupent donc pas, à ' +
      'dessein.',
  },
  {
    title: 'Des statistiques, pas une prédiction',
    text:
      'Taux de réussite, profit factor et espérance décrivent des trades passés. Sous 30 trades clos, ' +
      'ils ne permettent aucune conclusion ; la pratique en recommande plus de cent. Aucun ratio de ' +
      'Sharpe n’est calculé : sur des rendements qui se suivent, il s’annualise mal et flatte le ' +
      'risque.',
  },
];

/** Le modèle du rapport de trading. */
export function buildTradingReportModel(
  input: TradingReportInput,
  opts: TradingReportOptions,
): ReportModel {
  const currency: Currency = opts.currency ?? 'EUR';
  const f = createFormatter(opts.discreet, currency);
  const generated = localDateTime(opts.generatedAt, opts.timeZone);
  const result = resultOf(input);

  const facts: ReportFact[] = [
    { label: 'Généré le', value: generated.label },
    { label: 'Devise', value: currency },
    { label: 'Comptes', value: String(input.accounts.length) },
    { label: 'Trades clos', value: String(input.stats.closed) },
  ];

  const notes: string[] = [];
  if (opts.discreet)
    notes.push(
      'Mode discret : les montants sont masqués ; les ratios et les effectifs restent lisibles.',
    );
  if (input.equity === null && input.accounts.length > 0)
    notes.push(
      'Valeur des comptes NON MESURÉE : un compte au moins n’a pas d’instantané. Voir « Ce que ce document ne dit pas ».',
    );

  const kpis: ReportKpi[] = [
    {
      label: 'Réalisé net',
      value: f.money(input.net, true),
      tone: toneOf(input.net),
      hint: 'frais déduits, funding compris',
    },
    {
      label: 'Latent',
      value: f.money(input.unrealized, true),
      tone: toneOf(input.unrealized),
      hint: 'positions ouvertes, au dernier instantané',
    },
    {
      label: 'Résultat',
      value: f.money(result, true),
      tone: toneOf(result),
      hint: 'réalisé net + latent',
    },
    {
      label: 'Valeur des comptes',
      value: f.money(input.equity),
      tone: 'neutral',
      hint: input.equity === null ? 'non mesurée' : 'équité des contrats + avoirs libres',
    },
  ];
  const details: ReportKpi[] = [
    {
      label: 'Réalisé brut',
      value: f.money(input.realized, true),
      tone: toneOf(input.realized),
      hint: 'avant frais et funding',
    },
    {
      label: 'Frais',
      value: f.money(input.fees === null ? null : input.fees.neg(), true),
      tone: toneOf(input.fees === null ? null : input.fees.neg()),
      hint: 'contrats perpétuels, rebates déduits',
    },
    {
      label: 'Funding',
      value: f.money(input.funding, true),
      tone: toneOf(input.funding),
      hint: 'reçu (+) ou payé (−)',
    },
    {
      label: 'Apports nets',
      value: f.money(input.netFlows, true),
      tone: 'neutral',
      hint: 'dépôts − retraits, transferts compris',
    },
  ];

  const hasTrades = input.stats.closed > 0 || input.stats.open > 0;
  const sections: (ReportSection | null)[] = [
    {
      id: 'summary',
      title: 'Synthèse',
      block: { kind: 'kpis', kpis, details },
      lead: 'Réalisé net + latent = résultat : les trois premiers chiffres sont une seule identité.',
      note: null,
      warnings: [],
      breakBefore: false,
    },
    hasTrades ? statsSection(input.stats, f) : null,
    tableSection(
      'accounts',
      'Comptes',
      'Ce que chaque compte porte. Un compte sans instantané n’a pas de valeur, et le dit.',
      accountsTable(input, f),
    ),
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
      title: TRADING_REPORT_TITLE,
      version: opts.version,
      generatedAt: opts.generatedAt,
      generatedLabel: generated.label,
      currency,
      discreet: opts.discreet,
      dateStamp: generated.stamp,
      fileSlug: 'trading',
    },
    cover: {
      title: TRADING_REPORT_TITLE,
      subtitle: 'Réalisé, latent, statistiques — compte par compte',
      facts,
      notes,
      disclaimer: TRADING_DISCLAIMER,
    },
    sections: sections.filter((s): s is ReportSection => s !== null),
    footer: {
      left: `${APP_NAME} · version ${opts.version} · rapport de trading`,
      right: `Généré le ${generated.label}`,
    },
  };
}
