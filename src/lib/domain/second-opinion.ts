/**
 * « Second avis » (P62) — comparer les chiffres CALCULÉS par un autre outil aux nôtres.
 *
 * Le piège que tout ce module sert à désamorcer : **une divergence avec un outil concurrent n'est
 * presque jamais une anomalie de sa part**. Elle vient d'une méthode légitimement différente —
 * coût moyen pondéré invariant à la vente (décision n° 5) contre FIFO ou HIFO, PRU par actif
 * (décision n° 10) contre méthode globale de l'article 150 VH bis (décision n° 43), frais inclus
 * ou non, récompenses à coût nul (décision n° 9), sources de prix, périmètre de portefeuille.
 * Laisser croire qu'un autre outil « se trompe » alors qu'il applique une autre méthode
 * détruirait la crédibilité que la traçabilité (décision n° 61) vient d'établir.
 *
 * Le garde-fou n'est donc **pas un avertissement, c'est une partition typée des grandeurs** :
 *
 * - **invariantes à la méthode** (`invariant`) — quantité détenue, Σ des prix de cession, Σ des
 *   acquisitions valorisées, nombre d'opérations. C'est là, et là seulement, qu'un écart
 *   « à examiner » peut naître ;
 * - **sensibles à la méthode** (`method-sensitive`) — PRU, coût des unités détenues, réalisé,
 *   latent. Dès que la méthode déclarée d'en face n'est pas la nôtre, l'écart est classé `method`
 *   **par construction** : les deux nombres sont énoncés côte à côte, mais leur soustraction n'est
 *   PAS présentée (`ValueGap.delta` volontairement `null`) — retrancher deux chiffres produits par
 *   deux méthodes différentes donne un nombre qui ne veut rien dire ;
 * - **imposées par la loi** (`statutory`) — les lignes de l'annexe 2086. La méthode y est écrite
 *   dans le code général des impôts : ces grandeurs se comparent sans réserve, et un écart y est
 *   réel.
 *
 * **Le moteur ne rejoue JAMAIS FIFO ni HIFO.** Simuler la méthode d'un tiers contredirait les
 * décisions n° 5 et n° 6 ; on préfère dire « non décidable ».
 *
 * Module pur (décision n° 40) : aucune horloge, aucun `number` porteur d'un montant ou d'une
 * quantité, aucune phrase française — le texte vit dans `src/lib/format/second-opinion.ts`. Rien
 * n'est persisté (décision n° 3) et le fichier comparé **n'entre jamais dans le grand livre** :
 * il est comparé, pas importé.
 */
import { buildValueGap, type GapMetric, type GapSource, type ValueGap } from './gap';
import type { TraceTarget } from './engine/trace';
import type { PortfolioReport, PositionReport } from './engine/report';
import { D, type Big, type DecimalString } from './money';
import type { TaxLedger } from './tax-fr';
import type { AssetCode, NaiveDateTime } from './types';

// --- Vocabulaire ---------------------------------------------------------------------------------

/** Outils dont un fichier peut être reconnu. Une marque n'est ici qu'un NOM DE FORMAT DE FICHIER. */
export type SecondOpinionTool =
  'waltio' | 'cointracking' | 'cointracker' | 'koinly' | 'blockpit' | 'unknown';

/**
 * Méthode de détermination du coût d'acquisition. `wac` est la nôtre (coût moyen pondéré invariant
 * à la vente, décision n° 5) ; `fr-global` est celle qu'impose l'article 150 VH bis pour l'annexe
 * 2086 (décision n° 43) ; `unknown` est une réponse légitime — et honorée.
 */
export type CostBasisMethod =
  'wac' | 'fifo' | 'lifo' | 'hifo' | 'acb' | 'opti' | 'fr-global' | 'unknown';

/** À quoi la divergence est imputée. Seul `unexplained` est présenté comme « à examiner ». */
export type DivergenceCause = 'method' | 'scope' | 'valuation' | 'rounding' | 'unexplained';

/** Grandeurs qu'un fichier tiers peut annoncer et que nous savons produire de notre côté. */
export type ComparableMetric =
  // Invariantes à la méthode.
  | 'qty-held'
  | 'proceeds-total'
  | 'acquisitions-total'
  | 'operation-count'
  // Sensibles à la méthode.
  | 'pru'
  | 'cost-basis'
  | 'realized'
  | 'unrealized'
  // Imposées par la loi (lignes de l'annexe 2086).
  | 'tax-global-value'
  | 'tax-proceeds'
  | 'tax-acquisition'
  | 'tax-gain';

export type MetricClass = 'invariant' | 'method-sensitive' | 'statutory';

/**
 * La partition, déclarée en UN SEUL endroit. Déplacer une grandeur d'une classe à l'autre est une
 * décision de fond : c'est cette table, et rien d'autre, qui autorise ou interdit un « écart à
 * examiner » sur une grandeur.
 */
export const METRIC_CLASS: Record<ComparableMetric, MetricClass> = {
  'qty-held': 'invariant',
  'proceeds-total': 'invariant',
  'acquisitions-total': 'invariant',
  'operation-count': 'invariant',
  pru: 'method-sensitive',
  'cost-basis': 'method-sensitive',
  realized: 'method-sensitive',
  unrealized: 'method-sensitive',
  'tax-global-value': 'statutory',
  'tax-proceeds': 'statutory',
  'tax-acquisition': 'statutory',
  'tax-gain': 'statutory',
};

export function methodSensitive(metric: ComparableMetric): boolean {
  return METRIC_CLASS[metric] === 'method-sensitive';
}

/** Clé d'une ligne fiscale : le JOUR, à minuit — la seule granularité qu'une annexe 2086 porte. */
export const taxDayKey = (at: NaiveDateTime): NaiveDateTime => `${at.slice(0, 10)}T00:00:00`;

/** Unité de la grandeur, pour `ValueGap`. Un compte d'opérations passe par `qty` (sans devise). */
const GAP_METRIC: Record<ComparableMetric, GapMetric> = {
  'qty-held': 'qty',
  'operation-count': 'qty',
  'proceeds-total': 'value-eur',
  'acquisitions-total': 'value-eur',
  realized: 'value-eur',
  unrealized: 'value-eur',
  'cost-basis': 'cost-basis-eur',
  pru: 'pru-eur',
  'tax-global-value': 'value-eur',
  'tax-proceeds': 'value-eur',
  'tax-acquisition': 'value-eur',
  'tax-gain': 'value-eur',
};

export const gapMetricOf = (metric: ComparableMetric): GapMetric => GAP_METRIC[metric];

/**
 * Seuil au-dessous duquel l'écart est de la poussière d'arrondi. Un centime pour les montants en
 * euros ; 1e-8 pour une quantité (l'unité la plus fine que les plateformes publient, même valeur
 * que le regroupement de doublons de `reconciliation.ts`) ; **zéro pour un compte d'opérations** —
 * un dénombrement est exact ou il ne l'est pas.
 */
const ROUNDING_TOLERANCE: Record<ComparableMetric, DecimalString> = {
  'qty-held': '0.00000001',
  'operation-count': '0',
  'proceeds-total': '0.01',
  'acquisitions-total': '0.01',
  realized: '0.01',
  unrealized: '0.01',
  'cost-basis': '0.01',
  pru: '0.01',
  'tax-global-value': '0.01',
  'tax-proceeds': '0.01',
  'tax-acquisition': '0.01',
  'tax-gain': '0.01',
};

export const roundingToleranceOf = (metric: ComparableMetric): DecimalString =>
  ROUNDING_TOLERANCE[metric];

/**
 * Seuil de CONCORDANCE : la moitié du seuil d'arrondi, c'est-à-dire la moitié du dernier chiffre
 * qu'un écran sait afficher. Deux chiffres qui s'accordent à ce point sont le MÊME chiffre —
 * personne ne pourrait montrer la différence. C'est ce qui distingue les deux seuils :
 *
 * - `|δ| ≤ concordance` → il n'y a pas d'écart du tout (aucune carte, rien à imputer) ;
 * - `concordance < |δ| < arrondi` → il y a un écart, imputé à l'arrondi (des arrondis successifs
 *   peuvent s'accumuler au-delà d'un demi-centime sans rien signifier de plus) ;
 * - `|δ| ≥ arrondi` → la cascade cherche vraiment.
 *
 * Sans ce premier seuil, confronter nos chiffres à pleine précision aux deux décimales d'un
 * tableur produirait une carte « écart d'arrondi » par ligne : du bruit, jamais une information.
 */
export const displayToleranceOf = (metric: ComparableMetric): Big =>
  D(ROUNDING_TOLERANCE[metric]).div('2');

/**
 * NOTRE méthode sur une grandeur. Le coût moyen pondéré partout (décision n° 5), sauf sur les
 * lignes de l'annexe 2086 où la loi impose la méthode globale (décision n° 43).
 */
export const ourMethodFor = (metric: ComparableMetric): CostBasisMethod =>
  METRIC_CLASS[metric] === 'statutory' ? 'fr-global' : 'wac';

/**
 * LEUR méthode sur une grandeur. Sur une grandeur imposée par la loi, la méthode déclarée par
 * l'utilisateur ou par le fichier **n'a pas voix au chapitre** : les deux outils appliquent
 * l'article 150 VH bis. C'est ce qui rend une ligne 2086 comparable sans réserve.
 */
export const theirMethodFor = (
  metric: ComparableMetric,
  declared: CostBasisMethod,
): CostBasisMethod => (METRIC_CLASS[metric] === 'statutory' ? 'fr-global' : declared);

// --- Ce que le fichier tiers annonce -------------------------------------------------------------

/** Pourquoi une valeur lue n'est pas comparable. Un chiffre inventé serait pire qu'un chiffre absent. */
export type ClaimIssue = 'currency-not-eur' | 'value-unreadable';

/**
 * Une grandeur annoncée par le fichier tiers, normalisée. `verbatim` conserve la ligne telle
 * qu'elle a été lue : la preuve d'une comparaison, c'est le texte d'origine, pas notre relecture.
 */
export interface SecondOpinionClaim {
  metric: ComparableMetric;
  asset: AssetCode | null;
  /** Date portée par la ligne (cession du 2086) ; `null` pour une grandeur de portefeuille. */
  at: NaiveDateTime | null;
  /** Valeur annoncée, en euros ou en unités ; `null` dès que `issue` est renseigné. */
  value: DecimalString | null;
  /** Devise lue dans le fichier ; `null` quand la ligne n'en porte aucune. */
  currency: string | null;
  issue: ClaimIssue | null;
  /** Numéro de ligne dans le fichier (1 = en-tête). */
  line: number;
  verbatim: string;
}

/** L'origine déclarée de la comparaison : d'où vient le fichier et sous quelle méthode. */
export interface SecondOpinionSource {
  tool: SecondOpinionTool;
  declaredMethod: CostBasisMethod;
  /** `file` : lue dans le fichier. `user` : déclarée à l'écran (y compris « je ne sais pas »). */
  declaredBy: 'file' | 'user';
  period: { from: NaiveDateTime; to: NaiveDateTime } | null;
}

// --- Nos chiffres --------------------------------------------------------------------------------

/**
 * Un de NOS chiffres, déjà calculé, prêt à être confronté. `trace` porte la descente
 * « Pourquoi ce chiffre ? » (décision n° 61) — sur NOTRE côté uniquement : nous ignorons d'où
 * vient le leur.
 */
export interface OurFigure {
  metric: ComparableMetric;
  asset: AssetCode | null;
  at: NaiveDateTime | null;
  value: DecimalString | null;
  trace: TraceTarget | null;
  /**
   * Vrai quand plusieurs de nos chiffres se disputent la même clé — deux cessions le même jour
   * face à une annexe 2086 qui ne date qu'au jour. Le chiffre existe, mais nous ne saurions pas
   * dire à quelle ligne du fichier il répond : la comparaison est déclarée non concluante plutôt
   * que rattachée au hasard.
   */
  ambiguous?: boolean;
}

// --- Appariement des opérations ------------------------------------------------------------------

/** Une opération réduite à ce qui permet de l'apparier : date, actif, quantité, contre-valeur. */
export interface ComparableOperation {
  at: NaiveDateTime;
  asset: AssetCode;
  qty: DecimalString;
  /** Contre-valeur en euros ; `null` quand la source ne la donne pas. */
  valueEur: DecimalString | null;
}

export interface OperationMatchReport {
  matched: number;
  /** Opérations de LEUR fichier qui n'existent pas ici. */
  missingHere: number;
  /** Opérations d'ICI absentes de leur fichier. */
  extraHere: number;
  /** Appariées sur jour + actif + quantité, mais dont la contre-valeur en euros diffère. */
  valuationMismatch: number;
}

/** Décimales conservées pour apparier deux quantités « quasi identiques » (poussière d'arrondi). */
const MATCH_QTY_DP = 8;
/** Écart de contre-valeur au-delà duquel deux opérations appariées sont dites valorisées autrement. */
const VALUATION_TOLERANCE = D('0.01');

const matchKey = (op: ComparableOperation): string =>
  `${op.at.slice(0, 10)}|${op.asset.toLowerCase()}|${D(op.qty).round(MATCH_QTY_DP).toString()}`;

/**
 * Appariement multi-ensemble par **jour + actif + quantité** — jamais par identifiant : deux outils
 * n'ont aucune raison de partager le leur. Deux opérations appariées dont les contre-valeurs
 * s'écartent de plus d'un centime comptent comme une divergence de VALORISATION, pas de périmètre.
 */
export function matchOperations(
  ours: readonly ComparableOperation[],
  theirs: readonly ComparableOperation[],
): OperationMatchReport {
  const buckets: Record<string, ComparableOperation[]> = {};
  for (const op of ours) (buckets[matchKey(op)] ??= []).push(op);
  let matched = 0;
  let missingHere = 0;
  let valuationMismatch = 0;
  for (const op of theirs) {
    const bucket = buckets[matchKey(op)];
    const mine = bucket?.shift();
    if (mine === undefined) {
      missingHere++;
      continue;
    }
    matched++;
    if (mine.valueEur !== null && op.valueEur !== null) {
      if (D(mine.valueEur).minus(D(op.valueEur)).abs().gt(VALUATION_TOLERANCE)) valuationMismatch++;
    }
  }
  let extraHere = 0;
  for (const rest of Object.values(buckets)) extraHere += rest.length;
  return { matched, missingHere, extraHere, valuationMismatch };
}

// --- La cascade d'imputation ---------------------------------------------------------------------

export interface ClassifyInput {
  metric: ComparableMetric;
  /** NOTRE chiffre et le LEUR : les deux sont renseignés, sinon il n'y a rien à imputer. */
  ours: Big;
  theirs: Big;
  ourMethod: CostBasisMethod;
  theirMethod: CostBasisMethod;
  /** Appariement des opérations ; `null` quand leur fichier n'en porte aucune. */
  operations: OperationMatchReport | null;
}

/**
 * **Ordre fixe et testé** : `rounding` → `method` → `scope` → `valuation` → `unexplained`.
 *
 * L'ordre est le fond du sujet, pas un détail d'implémentation. `rounding` d'abord : deux méthodes
 * différentes qui tombent d'accord au centime près ne « divergent par la méthode » que sur le
 * papier. `method` ensuite : sur une grandeur sensible, une méthode différente suffit à tout
 * expliquer, et rien ne justifie de chercher plus loin. `scope` avant `valuation` : des opérations
 * absentes expliquent aussi des contre-valeurs différentes, l'inverse est faux. `unexplained` en
 * dernier, et lui seul mérite un examen : la grandeur ne dépend d'aucune méthode, et les deux
 * fichiers portent sur les mêmes opérations.
 */
export function classify(input: ClassifyInput): DivergenceCause {
  const delta = input.ours.minus(input.theirs).abs();
  if (delta.lt(D(roundingToleranceOf(input.metric)))) return 'rounding';
  if (methodSensitive(input.metric) && input.theirMethod !== input.ourMethod) return 'method';
  const ops = input.operations;
  if (ops !== null && (ops.missingHere > 0 || ops.extraHere > 0)) return 'scope';
  if (ops !== null && ops.valuationMismatch > 0) return 'valuation';
  return 'unexplained';
}

// --- Divergences ---------------------------------------------------------------------------------

/** Ce qui étaye l'imputation. Des codes et des chiffres, jamais une phrase (décision n° 40). */
export type DivergenceEvidence =
  | { kind: 'their-line'; line: number; verbatim: string }
  | { kind: 'declared-method'; ours: CostBasisMethod; theirs: CostBasisMethod }
  | { kind: 'operations'; match: OperationMatchReport }
  | { kind: 'rounding-threshold'; tolerance: DecimalString };

export interface Divergence {
  id: string;
  metric: ComparableMetric;
  /**
   * Date de la ligne comparée (une cession de l'annexe 2086) ; `null` pour une grandeur de
   * portefeuille. `ValueGap` porte déjà l'actif ; sur une ligne fiscale, il n'y en a pas — c'est la
   * DATE qui distingue deux cessions, et sans elle le rendu ne saurait pas de quelle ligne il parle.
   */
  at: NaiveDateTime | null;
  gap: ValueGap;
  cause: DivergenceCause;
  evidence: readonly DivergenceEvidence[];
}

/** Pourquoi une grandeur lue n'a volontairement PAS été comparée. */
export type InconclusiveReason =
  | 'scope-not-confirmed'
  | 'method-not-declared'
  | 'currency-not-eur'
  | 'value-unreadable'
  | 'no-figure-of-ours'
  | 'ambiguous-line';

export interface InconclusiveComparison {
  metric: ComparableMetric;
  asset: AssetCode | null;
  at: NaiveDateTime | null;
  reason: InconclusiveReason;
  line: number;
  verbatim: string;
}

export interface AgreedComparison {
  metric: ComparableMetric;
  asset: AssetCode | null;
  at: NaiveDateTime | null;
  value: DecimalString;
  line: number;
}

export interface SecondOpinionReport {
  source: SecondOpinionSource;
  divergences: readonly Divergence[];
  inconclusive: readonly InconclusiveComparison[];
  agreed: readonly AgreedComparison[];
  counts: {
    read: number;
    compared: number;
    agreed: number;
    divergent: number;
    inconclusive: number;
    /** Divergences « à examiner » : le seul compteur qui appelle une action. */
    unexplained: number;
  };
}

export interface SecondOpinionInput {
  source: SecondOpinionSource;
  /** Nom du fichier comparé, tel qu'il s'affichera ; jamais son contenu. */
  label: string;
  /** Identifiant de CETTE comparaison (rien n'est persisté : il ne survit pas à la page). */
  importId: string;
  claims: readonly SecondOpinionClaim[];
  ours: readonly OurFigure[];
  /** Les opérations des deux côtés ; `null` quand leur fichier n'en porte aucune. */
  operations: {
    ours: readonly ComparableOperation[];
    theirs: readonly ComparableOperation[];
  } | null;
  /**
   * Confirmation, par l'utilisateur, que les deux fichiers portent sur le MÊME périmètre. Sans
   * elle, **aucun écart n'est produit** : un utilisateur qui suit plus de comptes chez l'autre
   * outil verrait un écart massif et parfaitement légitime.
   */
  sameScopeConfirmed: boolean;
}

const CAUSE_RANK: Record<DivergenceCause, number> = {
  unexplained: 0,
  scope: 1,
  valuation: 2,
  method: 3,
  rounding: 4,
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Clé de rapprochement d'un chiffre. Sur une grandeur imposée par la loi, la date est ramenée au
 * JOUR : une annexe 2086 ne date qu'au jour, alors que nos cessions portent l'heure de l'opération.
 */
const keyOf = (
  metric: ComparableMetric,
  asset: AssetCode | null,
  at: NaiveDateTime | null,
): string => {
  const when = at === null ? '' : METRIC_CLASS[metric] === 'statutory' ? taxDayKey(at) : at;
  return `${metric}|${asset ?? ''}|${when}`;
};

/**
 * Confronte les grandeurs annoncées aux nôtres. Trois issues par grandeur, et rien d'autre :
 * concordante (`agreed`), divergente et imputée (`divergences`), ou volontairement non comparée
 * (`inconclusive`). Une grandeur n'est JAMAIS silencieusement écartée.
 *
 * Deux seuils, et deux seulement : la **concordance** (`displayToleranceOf`, moitié du dernier
 * chiffre affichable) écarte ce que personne ne saurait montrer ; l'**arrondi**
 * (`roundingToleranceOf`, premier échelon de la cascade) nomme ce qui reste sans le faire passer
 * pour un écart à examiner.
 */
export function compareSecondOpinion(input: SecondOpinionInput): SecondOpinionReport {
  const gapSource: GapSource = {
    kind: 'external-export',
    label: input.label,
    importId: input.importId,
  };
  const mine: Record<string, OurFigure> = {};
  for (const figure of input.ours) mine[keyOf(figure.metric, figure.asset, figure.at)] = figure;
  const match =
    input.operations === null
      ? null
      : matchOperations(input.operations.ours, input.operations.theirs);

  const divergences: Divergence[] = [];
  const inconclusive: InconclusiveComparison[] = [];
  const agreed: AgreedComparison[] = [];

  for (const claim of input.claims) {
    const base = {
      metric: claim.metric,
      asset: claim.asset,
      at: claim.at,
      line: claim.line,
      verbatim: claim.verbatim,
    };
    const skip = (reason: InconclusiveReason): void => void inconclusive.push({ ...base, reason });

    // 1. Le périmètre commande tout : sans confirmation, aucun écart n'est affiché.
    if (!input.sameScopeConfirmed) {
      skip('scope-not-confirmed');
      continue;
    }
    // 2. Ce que le fichier n'a pas su livrer proprement (devise non gérée, valeur illisible).
    if (claim.issue !== null || claim.value === null) {
      skip(claim.issue === 'currency-not-eur' ? 'currency-not-eur' : 'value-unreadable');
      continue;
    }
    // 3. Méthode non déclarée : sur une grandeur sensible, la comparaison n'est pas concluante.
    const theirMethod = theirMethodFor(claim.metric, input.source.declaredMethod);
    if (methodSensitive(claim.metric) && theirMethod === 'unknown') {
      skip('method-not-declared');
      continue;
    }
    // 4. Notre propre chiffre doit exister ET être rattachable à CETTE ligne sans ambiguïté.
    const ourFigure = mine[keyOf(claim.metric, claim.asset, claim.at)];
    if (ourFigure?.ambiguous === true) {
      skip('ambiguous-line');
      continue;
    }
    if (ourFigure === undefined || ourFigure.value === null) {
      skip('no-figure-of-ours');
      continue;
    }

    const ours = D(ourFigure.value);
    const theirs = D(claim.value);
    const gap = buildValueGap(
      gapMetricOf(claim.metric),
      claim.asset,
      ours,
      theirs,
      gapSource,
      ourFigure.trace,
      displayToleranceOf(claim.metric),
    );
    if (gap === null) {
      agreed.push({ ...base, value: ourFigure.value });
      continue;
    }
    const ourMethod = ourMethodFor(claim.metric);
    const cause = classify({
      metric: claim.metric,
      ours,
      theirs,
      ourMethod,
      theirMethod,
      operations: match,
    });
    divergences.push({
      id: `second-opinion:${keyOf(claim.metric, claim.asset, claim.at)}:${claim.line}`,
      metric: claim.metric,
      at: claim.at,
      // Sur une grandeur sensible expliquée par la méthode, les deux nombres sont énoncés mais
      // leur soustraction ne l'est pas : retrancher deux chiffres produits par deux méthodes
      // différentes donne un nombre qui ne veut rien dire.
      gap: cause === 'method' ? { ...gap, delta: null } : gap,
      cause,
      evidence: evidenceFor(cause, claim, ourMethod, theirMethod, match),
    });
  }

  divergences.sort((a, b) => CAUSE_RANK[a.cause] - CAUSE_RANK[b.cause] || cmp(a.id, b.id));
  inconclusive.sort(
    (a, b) =>
      cmp(a.reason, b.reason) ||
      a.line - b.line ||
      cmp(keyOf(a.metric, a.asset, a.at), keyOf(b.metric, b.asset, b.at)),
  );
  agreed.sort(
    (a, b) =>
      a.line - b.line || cmp(keyOf(a.metric, a.asset, a.at), keyOf(b.metric, b.asset, b.at)),
  );

  return {
    source: input.source,
    divergences,
    inconclusive,
    agreed,
    counts: {
      read: input.claims.length,
      compared: divergences.length + agreed.length,
      agreed: agreed.length,
      divergent: divergences.length,
      inconclusive: inconclusive.length,
      unexplained: divergences.filter((d) => d.cause === 'unexplained').length,
    },
  };
}

function evidenceFor(
  cause: DivergenceCause,
  claim: SecondOpinionClaim,
  ourMethod: CostBasisMethod,
  theirMethod: CostBasisMethod,
  match: OperationMatchReport | null,
): DivergenceEvidence[] {
  const evidence: DivergenceEvidence[] = [
    { kind: 'their-line', line: claim.line, verbatim: claim.verbatim },
  ];
  switch (cause) {
    case 'rounding':
      evidence.push({
        kind: 'rounding-threshold',
        tolerance: roundingToleranceOf(claim.metric),
      });
      return evidence;
    case 'method':
      evidence.push({ kind: 'declared-method', ours: ourMethod, theirs: theirMethod });
      return evidence;
    case 'scope':
    case 'valuation':
      if (match !== null) evidence.push({ kind: 'operations', match });
      return evidence;
    case 'unexplained':
      // Ce qui fait d'un écart un écart À EXAMINER, c'est précisément l'appariement : mêmes
      // opérations des deux côtés. La preuve est donc l'appariement lui-même, quand il existe.
      if (match !== null) evidence.push({ kind: 'operations', match });
      return evidence;
    default: {
      const missing: never = cause;
      throw new Error(`Cause de divergence sans preuve : ${String(missing)}`);
    }
  }
}

// --- Nos chiffres, assemblés depuis les rapports déjà calculés -----------------------------------

const positionTrace = (metric: TraceTarget['metric'], asset: AssetCode): TraceTarget => ({
  metric,
  scope: { kind: 'position', asset },
});
const portfolioTrace = (metric: TraceTarget['metric']): TraceTarget => ({
  metric,
  scope: { kind: 'portfolio' },
});

const big = (value: Big | null): DecimalString | null => (value === null ? null : value.toString());

export interface OurFiguresInput {
  /** Rapport du moteur **en euros** : une comparaison de fichiers ne convertit rien. */
  report: PortfolioReport;
  /** Estimation fiscale française ; `null` tant que l'historique de prix n'est pas chargé. */
  tax: TaxLedger | null;
  /** Nombre d'opérations de notre grand livre. */
  operationCount: number;
}

/**
 * Nos chiffres, PARCOURUS et jamais recalculés (même discipline que `reconciliation.ts`).
 *
 * Les lignes de l'annexe 2086 ne portent **aucune** `TraceTarget` : `TraceScope` n'a pas de portée
 * « une cession », et pointer la trace du portefeuille entier à la place ferait descendre
 * l'utilisateur sur un autre chiffre que celui qu'il conteste. Une descente absente vaut mieux
 * qu'une descente qui ment (limite nommée dans `docs/second-avis.md`).
 */
export function ourFiguresFrom(input: OurFiguresInput): OurFigure[] {
  const out: OurFigure[] = [];
  const push = (
    metric: ComparableMetric,
    asset: AssetCode | null,
    at: NaiveDateTime | null,
    value: DecimalString | null,
    trace: TraceTarget | null,
  ): void => void out.push({ metric, asset, at, value, trace });

  const positions: PositionReport[] = [
    ...input.report.positions,
    ...input.report.stablecoins,
    ...input.report.closed,
    ...input.report.blocked,
  ];
  for (const p of positions) {
    push('qty-held', p.asset, null, p.qty.toString(), null);
    push('pru', p.asset, null, big(p.pru), positionTrace('pru', p.asset));
    push('cost-basis', p.asset, null, p.costBasis.toString(), positionTrace('cost-basis', p.asset));
    push('realized', p.asset, null, p.realized.toString(), positionTrace('realized', p.asset));
    push('unrealized', p.asset, null, big(p.unrealized), positionTrace('unrealized', p.asset));
    push(
      'acquisitions-total',
      p.asset,
      null,
      p.investedTotal.toString(),
      positionTrace('invested', p.asset),
    );
    push(
      'proceeds-total',
      p.asset,
      null,
      p.proceedsTotal.toString(),
      positionTrace('proceeds', p.asset),
    );
  }

  const totals = input.report.totals;
  push('cost-basis', null, null, totals.costBasis.toString(), portfolioTrace('cost-basis'));
  push('realized', null, null, totals.realized.toString(), portfolioTrace('realized'));
  push('unrealized', null, null, totals.unrealized.toString(), portfolioTrace('unrealized'));
  push(
    'acquisitions-total',
    null,
    null,
    totals.investedTotal.toString(),
    portfolioTrace('invested'),
  );
  push('proceeds-total', null, null, totals.proceedsTotal.toString(), portfolioTrace('proceeds'));
  push('operation-count', null, null, String(input.operationCount), null);

  // Une annexe 2086 ne date qu'au JOUR : nos cessions sont donc ramenées au jour pour être
  // rapprochées d'une ligne du fichier. Quand un jour porte plusieurs cessions, aucune des deux ne
  // peut être rattachée à une ligne précise : le jour entier est déclaré ambigu, jamais rattaché
  // au hasard (l'écran le dit — `InconclusiveReason.ambiguous-line`).
  const cessions = input.tax?.cessions ?? [];
  const perDay: Record<string, number> = {};
  for (const cession of cessions) {
    const day = taxDayKey(cession.at);
    perDay[day] = (perDay[day] ?? 0) + 1;
  }
  for (const cession of cessions) {
    const day = taxDayKey(cession.at);
    const ambiguous = (perDay[day] ?? 0) > 1;
    const add = (metric: ComparableMetric, value: DecimalString | null): void => {
      out.push(
        ambiguous
          ? { metric, asset: null, at: day, value, trace: null, ambiguous: true }
          : { metric, asset: null, at: day, value, trace: null },
      );
    };
    add('tax-global-value', cession.globalValueEur);
    add('tax-proceeds', cession.proceedsEur);
    add('tax-acquisition', cession.ptaBefore);
    add('tax-gain', cession.gainEur);
  }
  return out;
}

/**
 * Il n'existe volontairement PAS d'adaptateur « nos opérations → `ComparableOperation[]` ici.
 * Le seul format comparé en v1 — l'annexe 2086 — ne porte aucune opération : `operations` vaut
 * `null`, et les échelons `scope` et `valuation` de la cascade ne se déclenchent pas (un écart sur
 * une ligne dont la méthode est imposée par la loi reste, à juste titre, un écart à examiner).
 * Écrire l'adaptateur maintenant serait écrire du code que rien n'appelle ; il viendra avec le
 * premier format qui liste des opérations, dont il devra de toute façon épouser la forme.
 */
