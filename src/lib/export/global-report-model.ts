/**
 * Le rapport de patrimoine : le consolidé, tous espaces confondus.
 *
 * Il rend le **même `ReportModel`** que le rapport d'investissement, et c'est tout l'intérêt : depuis
 * la décision n° 174, le modèle est une liste ordonnée de sections dont aucun rendu ne connaît le
 * nom. Un second périmètre n'ajoute donc ni branche à `pdf.ts`, ni bloc `{#if}` au markup — il
 * réemploie les six formes de `ReportBlock`. Ce fichier est la première mise à l'épreuve de ce
 * contrat ; s'il avait fallu toucher aux rendus, le remaniement aurait échoué.
 *
 * **Il ne calcule rien.** Tout vient de `reconcileNetWorth` (`history/net-worth.ts`), qui pose
 * `apports nets + résultat = patrimoine` et le déplie producteur par producteur. Le modèle met en
 * mots, formate, et — surtout — **dit ce qu'il ne sait pas** : une part non valorisée ne compte pas
 * pour zéro, une part qui ne se recoupe pas ne rend aucun résultat, et un espace sans donnée se
 * nomme au lieu de disparaître.
 *
 * Trois choix de vocabulaire sont adossés à des sources, parce qu'ils étaient discutables :
 *
 * - « **contribution** », pas « attribution ». L'attribution décompose un écart à un indice de
 *   référence en effets d'allocation et de sélection ; il n'y a pas d'indice par espace ici. Une
 *   ligne par producteur avec son résultat est une analyse de contribution, et rien d'autre.
 * - le **rapport résultat ÷ apports nets** est un multiple sur capital investi (MOIC/TVPI dans les
 *   gabarits ILPA). Il est pondéré par les montants, donc **non comparable** au TWR du rapport
 *   d'investissement, qui neutralise exprès le calendrier des apports. C'est dit en méthodologie.
 *   Et un dénominateur nul rend le multiple **indéfini** — jamais 0,0×, jamais 0 %.
 * - un **périmètre vide se dit**. Les normes de présentation statistique distinguent « non
 *   disponible » de « zéro » par des symboles dédiés, précisément pour qu'une absence ne se lise
 *   pas comme une valeur nulle ; et faire disparaître une ligne d'un consolidé est une agrégation
 *   qui masque de l'information. D'où `emptyScopes`.
 */
import { D, ZERO, type Big } from '../domain/money';
import { fmtDate } from '../format/fr';
import type { Currency } from '../fx/types';
import type { NetWorthReconciliation, ReconciliationLine } from '../history/net-worth';
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

export const GLOBAL_REPORT_TITLE = 'Rapport de patrimoine';

/**
 * L'avertissement du rapport d'investissement nomme Coinhouse : il n'a rien à faire sur un document
 * qui couvre aussi le trading et les prêts. Celui-ci ne nomme aucune plateforme.
 */
export const GLOBAL_DISCLAIMER =
  'Outil indépendant. Ce rapport consolide vos propres relevés : il vaut ce qu’ils valent, et les ' +
  'valeurs portées au coût faute de cotation y sont signalées comme telles. Il ne constitue ni un ' +
  'conseil en investissement, ni un document fiscal.';

export interface GlobalReportOptions {
  discreet: boolean;
  /** Devise d'affichage des montants (EUR par défaut). */
  currency?: Currency | undefined;
  /** Instant de génération, ISO 8601. */
  generatedAt: string;
  version: string;
  /** Fuseau d'affichage des dates de génération (tests) ; celui du navigateur par défaut. */
  timeZone?: string | undefined;
  /**
   * Périmètres attendus dont **aucun** producteur n'a de donnée, sous leur libellé d'affichage.
   *
   * Ils sont nommés dans la section de couverture plutôt qu'omis : dans un consolidé, une ligne qui
   * disparaît se lit comme une ligne à zéro, et les deux ne veulent pas dire la même chose. C'est
   * l'appelant qui les connaît — lui seul sait quels espaces existent.
   */
  emptyScopes?: readonly string[] | undefined;
}

/** Part d'une ligne dans le total, ou `null` si le total n'est pas strictement positif. */
const shareOf = (line: ReconciliationLine, net: Big): Big | null =>
  net.gt(ZERO) ? line.value.div(net) : null;

/**
 * Pourquoi une ligne ne rend pas de résultat, en trois mots — ou `null` si elle en rend un.
 *
 * Le tableau affiche « — » dans la colonne Résultat ; sans cette mention, le lecteur ne saurait pas
 * s'il s'agit d'un zéro, d'un oubli, ou d'un refus motivé. C'est un refus motivé (décision n° 97).
 */
function silenceOf(line: ReconciliationLine): string | null {
  if (line.unavailable) return 'non valorisable';
  if (line.unreconciled) return 'ne se recoupe pas';
  return null;
}

function contributionTable(r: NetWorthReconciliation, f: Formatter): ReportTable {
  const rows: ReportCell[][] = r.lines.map((line) => [
    cell(line.label, 'neutral', silenceOf(line)),
    cell(f.money(line.value)),
    cell(f.money(line.contributed)),
    cell(f.money(line.gain, true), toneOf(line.gain)),
    cell(f.pct(shareOf(line, r.net), false)),
  ]);
  return {
    kind: 'contribution',
    columns: [
      { label: 'Espace', align: 'left' },
      { label: 'Valeur', align: 'right' },
      { label: 'Apports nets', align: 'right' },
      { label: 'Résultat', align: 'right' },
      { label: 'Part', align: 'right' },
    ],
    rows,
    total:
      r.lines.length > 0
        ? [
            cell('Patrimoine'),
            cell(f.money(r.net)),
            cell(f.money(r.contributed)),
            cell(f.money(r.gain, true), toneOf(r.gain)),
            cell(r.net.gt(ZERO) ? f.pct(D('1'), false) : NONE),
          ]
        : null,
    emptyText: 'Aucun producteur de valeur : rien à consolider.',
  };
}

/** Les parts que le total ne peut pas exploiter, nommées. */
const namesOf = (lines: readonly ReconciliationLine[], pick: (l: ReconciliationLine) => boolean) =>
  lines.filter(pick).map((l) => l.label);

/**
 * « Ce que ce document ne dit pas » — la section qu'un rapport qui circule doit porter.
 *
 * Un écran a un panneau d'auto-vérifications sous la main ; un PDF transmis ou archivé n'a que
 * lui-même. Les deux drapeaux de la réconciliation deviennent donc des phrases, jamais des
 * silences : c'est la seule façon qu'une part non valorisée ne se lise pas comme un zéro.
 */
function coverageSection(
  r: NetWorthReconciliation,
  f: Formatter,
  emptyScopes: readonly string[],
): ReportSection {
  const items: string[] = [];
  const unavailable = namesOf(r.lines, (l) => l.unavailable);
  const unreconciled = namesOf(r.lines, (l) => l.unreconciled);
  const estimated = r.lines.filter((l) => l.estimated);

  if (unavailable.length > 0)
    items.push(
      `${plural(unavailable.length, 'part n’a pas pu être valorisée', 'parts n’ont pas pu être valorisées')} ` +
        `(${unavailable.join(', ')}) : le patrimoine ci-dessus est INCOMPLET, il n’est pas approché. ` +
        `Ces parts ne comptent pas pour zéro — elles ne comptent pas.`,
    );
  if (unreconciled.length > 0)
    items.push(
      `${plural(unreconciled.length, 'part ne se recoupe pas', 'parts ne se recoupent pas')} ` +
        `avec le grand livre dont elle sort (${unreconciled.join(', ')}) : sa valeur est affichée, ` +
        `aucun résultat n’en est déduit, et le résultat total en hérite.`,
    );
  if (estimated.length > 0) {
    const atCost = estimated.reduce((acc, l) => acc.plus(l.estimatedValue), ZERO);
    const assets = [...new Set(estimated.flatMap((l) => l.estimatedAssets))];
    items.push(
      `${f.money(atCost)} ${r.net.gt(ZERO) ? `(${f.pct(atCost.div(r.net), false)} du patrimoine) ` : ''}` +
        `${estimated.length > 1 ? 'sont portés' : 'est porté'} au coût faute de cotation` +
        `${assets.length > 0 ? ` : ${assets.join(', ')}` : ''}.`,
    );
  }
  for (const scope of emptyScopes)
    items.push(
      `${scope} : aucune donnée. Cette absence est constatée, elle n’est pas une omission.`,
    );

  items.push(
    'La somme des parts refait le patrimoine, au centime : l’application le vérifie en continu, ' +
      'et le tableau ci-dessus vous permet de le refaire à la main.',
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
      'Apports nets + résultat = patrimoine. Les apports nets sont ce que vous avez versé moins ce ' +
      'que vous avez retiré, cumulé depuis l’origine ; le résultat est tout le reste. Aucun des ' +
      'trois chiffres n’est modélisé : le troisième est la différence des deux autres.',
  },
  {
    title: 'Contribution, et non attribution',
    text:
      'Chaque ligne dit ce qu’un espace apporte au total. Ce n’est pas une attribution de ' +
      'performance : celle-ci décomposerait un écart à un indice de référence en effets ' +
      'd’allocation et de sélection, et aucun indice par espace n’existe ici.',
  },
  {
    title: 'Le rapport aux apports n’est pas un rendement',
    text:
      'Résultat ÷ apports nets est un multiple sur capital investi. Il est pondéré par les montants ' +
      'et insensible à la durée : 30 % en un an et 30 % en dix ans s’y écrivent pareil. Il ne se ' +
      'compare donc pas au rendement hors apports (TWR) du rapport d’investissement, qui neutralise ' +
      'exprès le calendrier des versements. Sans aucun apport, le multiple n’est pas défini — le ' +
      'rapport affiche alors « — », et non zéro.',
  },
  {
    title: 'Ce qui n’est pas valorisé ne vaut pas zéro',
    text:
      'Quand une part ne peut pas être valorisée, le total est déclaré incomplet plutôt que ' +
      'rapproché d’un chiffre propre. Quand une valeur servie par une plateforme ne se recoupe pas ' +
      'avec le grand livre recalculé, elle est affichée sans qu’aucun résultat n’en soit déduit : ' +
      'l’écart serait un symptôme, pas un gain.',
  },
];

/**
 * Le modèle du rapport de patrimoine.
 *
 * `reconciliation` n'est pas optionnel : un rapport consolidé sans rien à consolider ne s'ouvre pas.
 * C'est à l'appelant de ne pas l'offrir — le registre de P116 portera cette disponibilité.
 */
export function buildGlobalReportModel(
  reconciliation: NetWorthReconciliation,
  opts: GlobalReportOptions,
): ReportModel {
  const currency: Currency = opts.currency ?? 'EUR';
  const f = createFormatter(opts.discreet, currency);
  const generated = localDateTime(opts.generatedAt, opts.timeZone);
  const r = reconciliation;
  const sumOfParts = r.lines.reduce((acc, l) => acc.plus(l.value), ZERO);

  const facts: ReportFact[] = [
    { label: 'Généré le', value: generated.label },
    { label: 'Devise', value: currency },
    // La date d'arrêté, et non « période couverte » : un patrimoine est un STOCK, il se lit à une
    // date. Les flux, eux, se lisent sur une période — la distinction est celle d'un bilan et d'un
    // compte de résultat, et elle décide de la moitié des libellés de ce fichier.
    { label: 'Arrêté au', value: fmtDate(r.day) },
    { label: 'Espaces', value: String(r.lines.length) },
  ];

  const notes: string[] = [];
  if (opts.discreet)
    notes.push(
      'Mode discret : les montants sont masqués ; les pourcentages et les parts restent lisibles.',
    );
  if (r.incomplete)
    notes.push(
      'Patrimoine INCOMPLET : une part au moins n’a pas pu être valorisée. Voir « Ce que ce document ne dit pas ».',
    );
  if (r.unreconciled)
    notes.push(
      'Une part au moins ne se recoupe pas avec son grand livre : le résultat total en hérite le doute.',
    );

  const kpis: ReportKpi[] = [
    {
      label: 'Apports nets',
      value: f.money(r.contributed),
      tone: 'neutral',
      hint: 'versé − retiré, cumulé depuis l’origine',
    },
    {
      label: 'Résultat',
      value: f.money(r.gain, true),
      tone: toneOf(r.gain),
      hint: 'patrimoine − apports nets',
    },
    {
      label: 'Patrimoine',
      value: f.money(r.net),
      tone: 'neutral',
      hint: `valeur nette au ${fmtDate(r.day)}`,
    },
    {
      label: 'Résultat ÷ apports',
      value: f.pct(r.roi),
      tone: toneOf(r.roi, 3),
      hint:
        r.roi === null
          ? 'aucun apport : le rapport n’est pas défini'
          : 'multiple sur capital investi · insensible à la durée',
    },
  ];

  const details: ReportKpi[] = [
    {
      label: 'Somme des parts',
      value: f.money(sumOfParts),
      tone: 'neutral',
      hint: 'doit égaler le patrimoine, au centime',
    },
    {
      label: 'Parts sans résultat',
      value: String(r.lines.filter((l) => l.gain === null).length),
      tone: 'neutral',
      hint: 'non valorisables ou non recoupées',
    },
  ];

  return {
    meta: {
      appName: APP_NAME,
      title: GLOBAL_REPORT_TITLE,
      version: opts.version,
      generatedAt: opts.generatedAt,
      generatedLabel: generated.label,
      currency,
      discreet: opts.discreet,
      dateStamp: generated.stamp,
    },
    cover: {
      title: GLOBAL_REPORT_TITLE,
      subtitle: 'Apports nets, résultat et patrimoine — espace par espace',
      facts,
      notes,
      disclaimer: GLOBAL_DISCLAIMER,
    },
    // L'ordre, écrit une fois : les deux rendus itèrent cette liste (décision n° 174).
    sections: [
      {
        id: 'summary',
        title: 'Synthèse',
        block: { kind: 'kpis' as const, kpis, details },
        // Le bandeau EST le pont : apports nets, puis résultat, puis patrimoine, dans cet ordre.
        // Une figure en cascade dirait la même chose ; elle demanderait une septième forme de bloc
        // aux deux rendus, pour un gain de lecture que trois chiffres alignés donnent déjà.
        lead: 'Apports nets + résultat = patrimoine : les trois premiers chiffres sont une seule identité, lue de gauche à droite.',
        note: null,
        warnings: [],
        breakBefore: false,
      },
      tableSection(
        'contribution',
        'Contribution par espace',
        'Ce que chaque espace apporte au total. La somme des parts refait le patrimoine ; une part sans résultat dit pourquoi.',
        contributionTable(r, f),
      ),
      coverageSection(r, f, opts.emptyScopes ?? []),
      {
        id: 'methodology',
        title: 'Méthodologie',
        block: { kind: 'paragraphs' as const, items: METHODOLOGY },
        lead: null,
        note: null,
        warnings: [],
        breakBefore: true,
      },
    ] satisfies ReportSection[],
    footer: {
      left: `${APP_NAME} · version ${opts.version} · rapport de patrimoine consolidé`,
      right: `Arrêté au ${fmtDate(r.day)} · généré le ${generated.label}`,
    },
  };
}
