/**
 * Rendu français du second avis (P62, décision n° 40). Le moteur
 * (`src/lib/domain/second-opinion.ts`) produit des divergences CODÉES et imputées ; c'est ici — et
 * seulement ici — qu'elles deviennent des phrases. Cinq `switch` exhaustifs (grandeur, cause,
 * méthode, motif de non-comparaison, motif de refus) : ajouter un code sans écrire sa phrase ne
 * compile pas, jamais un texte vide à l'écran (même modèle que `format/reconciliation.ts`).
 *
 * **La discipline de formulation fait partie du produit.** Une divergence avec un autre outil
 * n'est presque jamais une anomalie de sa part : le vocabulaire de l'accusation est proscrit, et
 * `second-opinion.lexicon.test.ts` fait échouer la CI si un mot proscrit réapparaît dans ce
 * fichier. Une marque n'est citée qu'en tant que **nom de format de fichier** ; elle ne figure
 * jamais dans la phrase d'un écart à examiner. C'est aussi ce qui garde la comparaison licite au
 * titre de la publicité comparative (art. L122-1 s. du code de la consommation) : on compare des
 * caractéristiques objectives et vérifiables, jamais des outils.
 *
 * Mode discret : les MONTANTS et les QUANTITÉS sont masqués, comme partout ailleurs ; les
 * compteurs, les dates et les numéros de ligne restent visibles — ce sont des contrôles, pas des
 * montants patrimoniaux.
 */
import type {
  ComparableMetric,
  CostBasisMethod,
  Divergence,
  DivergenceCause,
  InconclusiveComparison,
  InconclusiveReason,
  OperationMatchReport,
  SecondOpinionReport,
  SecondOpinionSource,
  SecondOpinionTool,
} from '../domain/second-opinion';
import { METRIC_CLASS } from '../domain/second-opinion';
import type { SecondOpinionRefusal } from '../import/second-opinion/detect';
import { D } from '../domain/money';
import type { Currency } from '../fx/types';
import { fmtDate, fmtMasked, fmtMoney, fmtPrice, fmtQty } from './fr';

const NONE = '—';

/** Écrit partout où un résultat s'affiche : ce comparatif ne se substitue à personne. */
export const SECOND_OPINION_DISCLAIMER =
  'Ce comparatif n’est pas un audit et ne remplace pas un professionnel.';

export interface RenderOptions {
  discreet: boolean;
  /** Devise d'affichage. Les grandeurs fiscales restent en euros : c'est la loi, pas un choix. */
  currency: Currency;
}

// --- Libellés élémentaires -----------------------------------------------------------------------

/**
 * Une marque, uniquement comme nom de format de fichier. Aucun de ces libellés ne qualifie l'outil
 * lui-même, et aucun n'entre dans la phrase d'une divergence.
 */
export function toolLabel(tool: SecondOpinionTool): string {
  switch (tool) {
    case 'waltio':
      return 'fichier Waltio';
    case 'cointracking':
      return 'fichier CoinTracking';
    case 'cointracker':
      return 'fichier CoinTracker';
    case 'koinly':
      return 'fichier Koinly';
    case 'blockpit':
      return 'fichier Blockpit';
    case 'unknown':
      return 'fichier';
    default: {
      const missing: never = tool;
      throw new Error(`Format de fichier sans libellé : ${String(missing)}`);
    }
  }
}

/** Nom complet d'une méthode, tel qu'on l'énonce dans une explication. */
export function methodLabel(method: CostBasisMethod): string {
  switch (method) {
    case 'wac':
      return 'le coût moyen pondéré invariant à la vente';
    case 'fifo':
      return 'FIFO (premier entré, premier sorti)';
    case 'lifo':
      return 'LIFO (dernier entré, premier sorti)';
    case 'hifo':
      return 'HIFO (le plus cher entré, premier sorti)';
    case 'acb':
      return 'le coût de base rajusté (ACB)';
    case 'opti':
      return 'la méthode optimisée (OPTI)';
    case 'fr-global':
      return 'la méthode globale de l’article 150 VH bis';
    case 'unknown':
      return 'une méthode non déclarée';
    default: {
      const missing: never = method;
      throw new Error(`Méthode sans libellé : ${String(missing)}`);
    }
  }
}

/** Forme courte, celle qu'on met après « votre outil déclare ». */
function methodShort(method: CostBasisMethod): string {
  switch (method) {
    case 'wac':
      return 'le coût moyen pondéré';
    case 'fifo':
      return 'FIFO';
    case 'lifo':
      return 'LIFO';
    case 'hifo':
      return 'HIFO';
    case 'acb':
      return 'ACB';
    case 'opti':
      return 'OPTI';
    case 'fr-global':
      return 'la méthode globale de l’article 150 VH bis';
    case 'unknown':
      return 'aucune méthode';
    default: {
      const missing: never = method;
      throw new Error(`Méthode sans forme courte : ${String(missing)}`);
    }
  }
}

export function metricLabel(metric: ComparableMetric): string {
  switch (metric) {
    case 'qty-held':
      return 'Quantité détenue';
    case 'proceeds-total':
      return 'Somme des prix de cession';
    case 'acquisitions-total':
      return 'Somme des acquisitions valorisées';
    case 'operation-count':
      return 'Nombre d’opérations';
    case 'pru':
      return 'Prix de revient unitaire';
    case 'cost-basis':
      return 'Coût des unités détenues';
    case 'realized':
      return 'Plus ou moins-value réalisée';
    case 'unrealized':
      return 'Plus ou moins-value latente';
    case 'tax-global-value':
      return 'Valeur globale du portefeuille (case 212)';
    case 'tax-proceeds':
      return 'Prix de cession net des frais (case 215)';
    case 'tax-acquisition':
      return 'Prix total d’acquisition (case 216)';
    case 'tax-gain':
      return 'Plus ou moins-value de la cession (case 220)';
    default: {
      const missing: never = metric;
      throw new Error(`Grandeur sans libellé : ${String(missing)}`);
    }
  }
}

/** Ce que la partition dit d'une grandeur, en une phrase — la clé de lecture de tout l'écran. */
export function metricClassLabel(metric: ComparableMetric): string {
  switch (METRIC_CLASS[metric]) {
    case 'invariant':
      return 'Grandeur invariante : elle ne dépend d’aucune méthode de calcul.';
    case 'method-sensitive':
      return 'Grandeur sensible à la méthode : deux méthodes donnent deux résultats.';
    case 'statutory':
      return 'Grandeur imposée par la loi : la méthode est écrite dans le code général des impôts.';
    default: {
      const missing: never = METRIC_CLASS[metric];
      throw new Error(`Classe de grandeur sans libellé : ${String(missing)}`);
    }
  }
}

// --- Montants ------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string => (n > 1 ? many : one);

/**
 * Un chiffre dans l'unité de sa grandeur. Un compte d'opérations n'est **pas** masqué en mode
 * discret : c'est un dénombrement, pas un montant patrimonial. Les grandeurs fiscales sont
 * toujours en euros, quelle que soit la devise d'affichage (décision n° 43).
 */
export function fmtMetricValue(
  metric: ComparableMetric,
  value: string | null,
  opts: RenderOptions,
): string {
  if (value === null) return NONE;
  if (metric === 'operation-count') return value;
  if (metric === 'qty-held') return opts.discreet ? fmtMasked() : fmtQty(D(value));
  const currency: Currency = METRIC_CLASS[metric] === 'statutory' ? 'EUR' : opts.currency;
  // Un prix unitaire reste lisible en mode discret (même règle que `format/reconciliation.ts`).
  if (metric === 'pru') return fmtPrice(D(value), currency);
  return opts.discreet ? fmtMasked(currency) : fmtMoney(D(value), currency);
}

// --- Phrases -------------------------------------------------------------------------------------

function scopeSentence(match: OperationMatchReport | null): string {
  if (match === null || (match.missingHere === 0 && match.extraHere === 0)) {
    return 'Écart expliqué par le périmètre : les deux fichiers ne couvrent pas les mêmes opérations.';
  }
  const parts: string[] = [];
  if (match.missingHere > 0) {
    parts.push(
      `${match.missingHere} ${plural(match.missingHere, 'opération de votre fichier n’existe pas ici', 'opérations de votre fichier n’existent pas ici')}`,
    );
  }
  if (match.extraHere > 0) {
    parts.push(
      `${match.extraHere} ${plural(match.extraHere, 'opération présente ici ne figure pas dans votre fichier', 'opérations présentes ici ne figurent pas dans votre fichier')}`,
    );
  }
  return `Écart expliqué par le périmètre : ${parts.join(', ')}.`;
}

function valuationSentence(match: OperationMatchReport | null): string {
  const n = match?.valuationMismatch ?? 0;
  if (n === 0) return 'Écart expliqué par la valorisation.';
  return `Écart expliqué par la valorisation. ${n} ${plural(n, 'opération appariée porte', 'opérations appariées portent')} la même quantité mais une contre-valeur différente.`;
}

/**
 * La phrase d'un écart à examiner. Elle ne cite **jamais** de nom d'éditeur, et n'affirme que ce
 * qui a été établi : « les deux fichiers portent sur les mêmes opérations » n'apparaît que si
 * l'appariement l'a effectivement montré.
 */
function unexplainedSentence(metric: ComparableMetric, match: OperationMatchReport | null): string {
  if (METRIC_CLASS[metric] === 'statutory') {
    return 'Écart à examiner. Sur cette ligne, la méthode de calcul est imposée par la loi : les deux calculs devraient concorder.';
  }
  const sameOperations =
    match !== null && match.missingHere === 0 && match.extraHere === 0 && match.matched > 0;
  return sameOperations
    ? 'Écart à examiner. Cette grandeur ne dépend d’aucune méthode de calcul, et les deux fichiers portent sur les mêmes opérations.'
    : 'Écart à examiner. Cette grandeur ne dépend d’aucune méthode de calcul.';
}

function causeSentence(
  cause: DivergenceCause,
  metric: ComparableMetric,
  theirMethod: CostBasisMethod,
  match: OperationMatchReport | null,
): string {
  switch (cause) {
    case 'rounding':
      return 'Écart expliqué par l’arrondi : il reste sous le seuil d’un centime.';
    case 'method':
      return `Écart expliqué par la méthode. Votre outil déclare ${methodShort(theirMethod)} ; ce moteur applique le coût moyen pondéré invariant à la vente. Sur cette grandeur, les deux résultats peuvent différer sans qu’aucun ne soit faux.`;
    case 'scope':
      return scopeSentence(match);
    case 'valuation':
      return valuationSentence(match);
    case 'unexplained':
      return unexplainedSentence(metric, match);
    default: {
      const missing: never = cause;
      throw new Error(`Cause de divergence sans phrase : ${String(missing)}`);
    }
  }
}

/** Intitulé court d'un groupe de divergences. Seul `unexplained` appelle une action. */
export function causeTitle(cause: DivergenceCause): string {
  switch (cause) {
    case 'rounding':
      return 'Écarts d’arrondi';
    case 'method':
      return 'Écarts expliqués par la méthode';
    case 'scope':
      return 'Écarts expliqués par le périmètre';
    case 'valuation':
      return 'Écarts expliqués par la valorisation';
    case 'unexplained':
      return 'Écarts à examiner';
    default: {
      const missing: never = cause;
      throw new Error(`Cause de divergence sans intitulé : ${String(missing)}`);
    }
  }
}

export function inconclusiveSentence(reason: InconclusiveReason): string {
  switch (reason) {
    case 'method-not-declared':
      return 'Méthode de calcul non déclarée : la comparaison n’est pas concluante sur cette grandeur.';
    case 'scope-not-confirmed':
      return 'Périmètre non confirmé : rien n’est comparé tant que les deux fichiers ne portent pas sur le même périmètre.';
    case 'currency-not-eur':
      return 'Montant libellé dans une devise que ce comparatif ne convertit pas : aucune conversion n’est improvisée.';
    case 'value-unreadable':
      return 'Valeur non lisible dans le fichier : rien n’est deviné à sa place.';
    case 'no-figure-of-ours':
      return 'Ce moteur ne produit pas cette grandeur ici : il n’y a rien à confronter.';
    case 'ambiguous-line':
      return 'Plusieurs cessions le même jour : ce comparatif ne saurait pas dire à quelle ligne du fichier chacune répond.';
    default: {
      const missing: never = reason;
      throw new Error(`Motif de non-comparaison sans phrase : ${String(missing)}`);
    }
  }
}

/** Ce que l'écran dit quand aucun chiffre n'est comparable, et ce qu'il propose à la place. */
export interface RenderedRefusal {
  title: string;
  detail: string;
  /** Le repli, nommé pour ce qu'il est ; `null` quand il n'y en a pas. */
  fallback: string | null;
}

/**
 * Le repli, nommé pour ce qu'il est : **ce n'est pas une comparaison de deux calculs, c'est notre
 * calcul sur leurs données.** Il détecte un périmètre différent et des opérations absentes,
 * jamais une méthode.
 */
const FALLBACK =
  'Repli possible : importez leurs opérations depuis l’écran Importer. Ce n’est pas une comparaison de deux calculs — c’est le calcul de ce moteur sur leurs données. Cela détecte un périmètre différent et des opérations absentes, jamais une méthode.';

export function renderRefusal(
  reason: SecondOpinionRefusal,
  tool: SecondOpinionTool,
  looked: readonly string[],
  found: readonly string[],
): RenderedRefusal {
  switch (reason) {
    case 'no-calculated-figures':
      return {
        title: `Aucun chiffre calculé dans ce ${toolLabel(tool)}`,
        detail:
          'Cet export contient vos opérations, et rien d’autre : il n’y a aucun chiffre calculé à confronter aux nôtres.',
        fallback: FALLBACK,
      };
    case 'pdf-only':
      return {
        title: `Rapport disponible en PDF seulement (${toolLabel(tool)})`,
        detail:
          'Le rapport complet de ce format n’existe qu’en PDF. Ce comparatif ne lit pas les PDF : y ajouter un lecteur ajouterait une dépendance à une application qui n’en veut pas.',
        fallback: FALLBACK,
      };
    case 'not-yet-comparable':
      return {
        title: `${toolLabel(tool)} reconnu`,
        detail:
          'Ce format porte bien des chiffres calculés. Leur comparaison n’est pas encore livrée : elle arrive bientôt.',
        fallback: FALLBACK,
      };
    case 'transactions-only':
      return {
        title: `Export d’opérations (${toolLabel(tool)})`,
        detail:
          'Ce fichier contient vos opérations, pas des chiffres calculés. L’écran Importer sait déjà le lire.',
        fallback: FALLBACK,
      };
    case 'unrecognised':
      return {
        title: 'Format non reconnu',
        detail: `Colonnes cherchées : ${looked.join(' · ')}. Colonnes trouvées : ${found.join(', ') || '(aucune)'}.`,
        fallback: FALLBACK,
      };
    default: {
      const missing: never = reason;
      throw new Error(`Motif de refus sans phrase : ${String(missing)}`);
    }
  }
}

// --- Divergences rendues -------------------------------------------------------------------------

export interface RenderedDivergence {
  id: string;
  metric: ComparableMetric;
  cause: DivergenceCause;
  /** Intitulé de la grandeur, avec l'actif ou la date de la ligne quand il y en a un. */
  title: string;
  /** « Votre fichier annonce X. Ce moteur calcule Y. » */
  comparison: string;
  /** L'écart chiffré ; `null` quand la soustraction ne veut rien dire (grandeur sensible). */
  deltaLabel: string | null;
  /** La phrase d'imputation. */
  detail: string;
  /** La classe de la grandeur, en une phrase. */
  classLabel: string;
  /** Le verbatim de la ligne d'origine, la preuve d'en face. */
  evidenceLabel: string;
}

export function renderDivergence(
  divergence: Divergence,
  source: SecondOpinionSource,
  opts: RenderOptions,
): RenderedDivergence {
  const gap = divergence.gap;
  const metric = divergence.metric;
  const theirLine = divergence.evidence.find((e) => e.kind === 'their-line');
  const operations = divergence.evidence.find((e) => e.kind === 'operations');
  const declared = divergence.evidence.find((e) => e.kind === 'declared-method');
  const theirMethod =
    declared?.kind === 'declared-method' ? declared.theirs : source.declaredMethod;
  const scope = gap.asset !== null ? ` · ${gap.asset.toUpperCase()}` : '';
  const at = divergence.at === null ? '' : ` · ${fmtDate(divergence.at)}`;
  return {
    id: divergence.id,
    metric,
    cause: divergence.cause,
    title: `${metricLabel(metric)}${scope}${at}`,
    comparison: `Votre fichier annonce ${fmtMetricValue(metric, gap.theirs, opts)}. Ce moteur calcule ${fmtMetricValue(metric, gap.ours, opts)}.`,
    deltaLabel: gap.delta === null ? null : `Écart : ${fmtMetricValue(metric, gap.delta, opts)}`,
    detail: causeSentence(
      divergence.cause,
      metric,
      theirMethod,
      operations?.kind === 'operations' ? operations.match : null,
    ),
    classLabel: metricClassLabel(metric),
    evidenceLabel:
      theirLine?.kind === 'their-line'
        ? `Ligne ${theirLine.line} de votre fichier : « ${theirLine.verbatim} »`
        : 'Aucune ligne citée.',
  };
}

export interface RenderedInconclusive {
  key: string;
  title: string;
  detail: string;
  evidenceLabel: string;
}

export function renderInconclusive(item: InconclusiveComparison): RenderedInconclusive {
  const scope = item.asset !== null ? ` · ${item.asset.toUpperCase()}` : '';
  const at = item.at === null ? '' : ` · ${fmtDate(item.at)}`;
  return {
    key: `${item.metric}|${item.asset ?? ''}|${item.at ?? ''}|${item.line}`,
    title: `${metricLabel(item.metric)}${scope}${at}`,
    detail: inconclusiveSentence(item.reason),
    evidenceLabel: `Ligne ${item.line} de votre fichier.`,
  };
}

/** Une phrase d'en-tête : d'où vient le fichier, sous quelle méthode, et sur quelle période. */
export function renderSource(source: SecondOpinionSource): string {
  const period =
    source.period === null
      ? ''
      : ` Période lue : du ${fmtDate(source.period.from)} au ${fmtDate(source.period.to)}.`;
  const method =
    source.declaredMethod === 'fr-global'
      ? 'Méthode imposée par la loi : la question de la méthode ne se pose pas sur ces lignes.'
      : source.declaredBy === 'file'
        ? `Méthode déclarée par le fichier : ${methodLabel(source.declaredMethod)}.`
        : `Méthode que vous avez déclarée : ${methodLabel(source.declaredMethod)}.`;
  return `${toolLabel(source.tool)}. ${method}${period}`;
}

/** Le résumé du comparatif : des dénombrements, et rien d'autre — jamais une note d'ensemble. */
export function renderCounts(report: SecondOpinionReport): string {
  const c = report.counts;
  return `${c.read} ${plural(c.read, 'grandeur lue', 'grandeurs lues')} · ${c.agreed} ${plural(c.agreed, 'concordante', 'concordantes')} · ${c.divergent} ${plural(c.divergent, 'divergente', 'divergentes')} · ${c.inconclusive} non ${plural(c.inconclusive, 'comparée', 'comparées')}.`;
}

/** Une ligne par divergence : presse-papier et résumé collable (motif `reconciliationToText`). */
export function secondOpinionToText(list: readonly RenderedDivergence[]): string {
  return list.map((d) => `- ${d.title} : ${d.comparison} ${d.detail}`).join('\n');
}
