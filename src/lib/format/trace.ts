/**
 * Rendu français d'une trace (P61). Le moteur (`domain/engine/trace.ts`) produit des rôles, des
 * opérateurs et des trous **codés** ; c'est ici — et seulement ici — qu'ils deviennent des phrases.
 * Traduire l'application ne touchera donc jamais au calcul, et changer une formulation ne peut pas
 * déplacer un centime.
 *
 * Deux règles de présentation :
 *
 * - **Tout est en euros.** Même quand l'application affiche des dollars. Convertir chaque étape
 *   ajouterait un arrondi par niveau et la somme cesserait de tomber juste ; une note le dit à
 *   l'écran plutôt que de laisser croire à une devise qui n'est pas celle du calcul.
 * - **Mode discret : les montants disparaissent, la structure reste.** Dates, numéros de ligne,
 *   type brut, jambe retenue, source et fraîcheur du cours, trous et résidu restent lisibles : ce
 *   sont des contrôles, pas des montants patrimoniaux. Comme ailleurs dans l'application, un prix
 *   unitaire n'est pas masqué (`Money` masque, `fmtPrice` non).
 */
import type {
  Trace,
  TraceGap,
  TraceMetric,
  TraceNode,
  TraceProvenance,
  TraceRole,
} from '../domain/engine/trace';
import type { EngineSettings } from '../domain/types';
import { D } from '../domain/money';
import type { Currency } from '../fx/types';
import { MASK, fmtDate, fmtMasked, fmtMoney, fmtPrice, fmtQty } from './fr';

/** Une trace est toujours calculée et rendue en euros (voir l'en-tête). */
export const TRACE_CURRENCY: Currency = 'EUR';

export interface TraceRenderOptions {
  discreet: boolean;
  /** Devise d'affichage de l'application : sert uniquement à annoncer l'écart, jamais à convertir. */
  displayCurrency: Currency;
  /** Libellés des comptes : le compte n'est annoncé que si plusieurs contribuent à la trace. */
  accountLabels?: Record<string, string>;
}

/** Une précision, en paire terme/valeur : l'écran la rend en `<dl>`, jamais en tableau large. */
export interface TraceDetail {
  term: string;
  value: string;
}

export interface RenderedTraceNode {
  id: string;
  /** Intitulé court : « Achat du 12/03/2026 », « Lot du 12/03/2026 », « Ligne 42 »… */
  label: string;
  /** Montant formaté, `''` si le nœud n'en porte pas. */
  amount: string;
  /** Précisions : compte, jambe retenue, quantité, source du cours, avertissements du moteur. */
  details: TraceDetail[];
  /** Phrase du trou porté par ce nœud, le cas échéant. */
  gap: string | null;
  /** Numéro de ligne du fichier importé : visible même en mode discret. */
  lineNo: number | null;
  children: RenderedTraceNode[];
}

export interface RenderedTrace {
  /** « D'où vient ce PRU ? » */
  title: string;
  /** La forme du calcul, en une ligne : « coût des lots restants ÷ quantité détenue ». */
  formula: string;
  amount: string;
  root: RenderedTraceNode;
  /** Phrases de cadrage : euros, PRU invariant, réglages consultés, contributions regroupées. */
  notes: string[];
  /** Une phrase par trou rencontré, sans doublon. */
  gaps: string[];
  /** Le contrôle de bouclage, toujours lisible : « les contributions retombent juste ». */
  residual: string;
}

const METRIC_TITLES: Record<TraceMetric, string> = {
  pru: 'D’où vient ce PRU ?',
  'cost-basis': 'D’où vient ce coût ?',
  invested: 'D’où vient ce total d’achats ?',
  proceeds: 'D’où vient ce total de ventes ?',
  realized: 'D’où vient ce réalisé ?',
  unrealized: 'D’où vient ce latent ?',
  fees: 'D’où viennent ces frais ?',
  value: 'D’où vient cette valeur ?',
  total: 'D’où vient ce total ?',
};

const METRIC_FORMULAS: Record<TraceMetric, string> = {
  pru: 'coût des lots encore détenus ÷ quantité détenue',
  'cost-basis': 'somme des lots encore détenus',
  invested: 'somme des acquisitions valorisées',
  proceeds: 'somme des cessions valorisées',
  realized: 'pour chaque cession : produit − coût des lots consommés',
  unrealized: 'valeur − coût des unités détenues',
  fees: 'frais bruts − remises obtenues',
  value: 'quantité détenue × cours retenu',
  total: 'réalisé + latent + récompenses valorisées',
};

const ROLE_LABELS: Record<TraceRole, string> = {
  metric: 'Résultat',
  'cost-basis': 'Coût des unités détenues',
  quantity: 'Quantité détenue',
  price: 'Prix de revient unitaire',
  value: 'Valeur au cours retenu',
  realized: 'Réalisé',
  unrealized: 'Latent',
  invested: 'Acquisitions',
  proceeds: 'Produit de la cession',
  'cost-of-sale': 'Coût de ce qui a été cédé',
  fee: 'Frais',
  rebate: 'Remises obtenues',
  'other-income': 'Récompenses valorisées',
  subscription: 'Abonnement Coinhouse',
  position: 'Position',
  lot: 'Lot',
  buy: 'Achat',
  sell: 'Vente',
  reward: 'Récompense',
  deposit: 'Dépôt',
  withdrawal: 'Retrait',
  'migration-in': 'Migration reçue',
  'migration-out': 'Migration sortante',
  'opening-balance': 'Solde d’ouverture',
  row: 'Ligne du fichier',
  quote: 'Cours retenu',
  setting: 'Réglage du moteur',
  unqualified: 'Opération à qualifier',
  omitted: 'Autres contributions',
  note: 'Remarque',
};

const GAP_TEXTS: Record<TraceGap, string> = {
  'external-quote':
    'Le cours vient d’un fournisseur extérieur : c’est la seule donnée de cette chaîne qui ne sorte pas de vos lignes.',
  'unqualified-row':
    'Des opérations ne sont pas encore interprétées : elles n’entrent dans aucun chiffre tant qu’elles ne sont pas qualifiées.',
  'missing-history':
    'L’historique d’acquisition manque : la chaîne s’arrête avant d’atteindre les lignes d’origine.',
  'carried-cost':
    'Coût reporté par une migration : le prix payé est celui de l’actif précédent, pas de celui-ci.',
  'transfer-from-other-account':
    'Virement interne : le coût d’acquisition a été repris du retrait apparié, sur un autre compte.',
  'row-unavailable': 'La ligne d’origine n’est plus présente dans les données importées.',
  truncated:
    'Contributions trop nombreuses pour être toutes détaillées : les suivantes sont regroupées en une seule, à leur montant exact.',
};

const SETTING_TEXTS: Record<keyof EngineSettings, (value: string) => string> = {
  migrationMode: (v) =>
    v === 'realize'
      ? 'Réglage : les migrations sont réalisées à leur juste valeur.'
      : 'Réglage : les migrations reportent leur coût (aucune plus-value constatée).',
  rewardValuation: (v) =>
    v === 'fair-value'
      ? 'Réglage : les récompenses sont valorisées à leur valeur de marché à la réception.'
      : 'Réglage : les récompenses entrent à un coût d’acquisition nul.',
  includeSubscriptionsInPnl: (v) =>
    v === 'true'
      ? 'Réglage : les abonnements Coinhouse sont déduits du P&L.'
      : 'Réglage : les abonnements Coinhouse restent hors du P&L.',
};

const ORIGIN_TEXTS: Record<string, string> = {
  purchase: 'achat',
  reward: 'récompense',
  deposit: 'dépôt',
  migration: 'migration',
  'opening-balance': 'solde d’ouverture',
};

const LEG_TEXTS: Record<string, string> = {
  'counter-leg': 'jambe contrepartie retenue',
  'asset-leg': 'jambe actif (contre-valeur exprimée dans la devise de règlement)',
  fee: 'frais',
  single: 'ligne de l’opération',
};

const EVENT_KIND_TEXTS: Record<string, string> = {
  trade: 'échange',
  migration: 'migration',
  fee: 'frais',
  reward: 'récompense',
  deposit: 'dépôt',
  withdrawal: 'retrait',
  'opening-balance': 'solde d’ouverture',
  unqualified: 'à qualifier',
};

/** Montant dans l'unité du nœud : masqué s'il s'agit d'un euro ou d'une quantité, jamais d'un prix. */
function amountText(node: TraceNode, opts: TraceRenderOptions): string {
  if (node.amount === null) return '';
  switch (node.unit) {
    case 'eur':
      // Pas de « + » sur les contributions positives : dans un arbre où tout s'additionne, seul
      // le signe moins d'une branche soustraite porte une information.
      return opts.discreet ? fmtMasked(TRACE_CURRENCY) : fmtMoney(node.amount, TRACE_CURRENCY);
    case 'qty':
      return opts.discreet ? MASK : fmtQty(node.amount);
    case 'price':
      return fmtPrice(node.amount, TRACE_CURRENCY);
    case 'ratio':
      return node.amount;
  }
}

const VALUE_SOURCE_TEXTS: Record<string, string> = {
  'counter-leg': 'contre-valeur de la jambe contrepartie',
  manual: 'montant saisi à la main',
  'carry-cost': 'coût reporté',
};

const lines = (n: number): string => `${n} ligne${n > 1 ? 's' : ''}`;

/** Le seul endroit qui décrit une provenance : un `switch` exhaustif, sinon la compilation échoue. */
function detailsOf(
  provenance: TraceProvenance,
  opts: TraceRenderOptions,
  showAccount: boolean,
): TraceDetail[] {
  switch (provenance.kind) {
    case 'raw-row': {
      const details: TraceDetail[] = [];
      if (provenance.lineNo > 0)
        details.push({ term: 'Ligne du fichier', value: String(provenance.lineNo) });
      details.push({ term: 'Date', value: fmtDate(provenance.at) });
      if (provenance.rawType) details.push({ term: 'Type brut', value: provenance.rawType });
      details.push({
        term: 'Quantité',
        value: `${opts.discreet ? MASK : fmtQty(provenance.signedQty, { sign: true })} ${provenance.asset.toUpperCase()}`,
      });
      if (provenance.valueEur !== null)
        details.push({
          term: 'Contre-valeur au fichier',
          value: opts.discreet
            ? fmtMasked(TRACE_CURRENCY)
            : fmtMoney(provenance.valueEur, TRACE_CURRENCY, { sign: true }),
        });
      details.push({ term: 'Jambe', value: LEG_TEXTS[provenance.role] ?? provenance.role });
      return details;
    }
    case 'event': {
      const details: TraceDetail[] = [
        { term: 'Nature', value: EVENT_KIND_TEXTS[provenance.eventKind] ?? provenance.eventKind },
        { term: 'Date', value: fmtDate(provenance.at) },
      ];
      if (showAccount)
        details.push({
          term: 'Compte',
          value: opts.accountLabels?.[provenance.accountId] ?? provenance.accountId,
        });
      if (provenance.valueEurSource !== null)
        details.push({
          term: 'Montant retenu',
          value: VALUE_SOURCE_TEXTS[provenance.valueEurSource] ?? provenance.valueEurSource,
        });
      details.push({ term: 'Lignes brutes', value: lines(provenance.rowKeys.length) });
      for (const warning of provenance.warnings)
        details.push({ term: 'Avertissement', value: warning });
      return details;
    }
    case 'lot':
      return [
        { term: 'Ouvert le', value: fmtDate(provenance.openedAt) },
        { term: 'Origine', value: ORIGIN_TEXTS[provenance.origin] ?? provenance.origin },
      ];
    case 'quote':
      return [
        { term: 'Source', value: provenance.source },
        { term: 'Cours du', value: fmtDate(provenance.at.slice(0, 10)) },
        { term: 'Fraîcheur', value: provenance.stale ? 'périmé' : 'à jour' },
      ];
    case 'setting':
      return [{ term: 'Réglage', value: SETTING_TEXTS[provenance.key](provenance.value) }];
    case 'unqualified':
      return [
        { term: 'Type brut', value: provenance.rawType || 'type inconnu' },
        { term: 'Raison', value: provenance.reason },
        { term: 'Lignes brutes', value: lines(provenance.rowKeys.length) },
      ];
    case 'derived':
      return [];
  }
}

function labelOf(node: TraceNode, metric: TraceMetric): string {
  if (node.role === 'metric') return METRIC_HEADS[metric];
  if (node.role === 'position' && node.asset) return node.asset.toUpperCase();
  if (node.provenance.kind === 'raw-row' && node.provenance.lineNo > 0)
    return `Ligne ${node.provenance.lineNo}`;
  if (node.role === 'lot' && node.at) return `Lot du ${fmtDate(node.at)}`;
  const base = ROLE_LABELS[node.role];
  return node.at && OPERATION_ROLES.has(node.role) ? `${base} du ${fmtDate(node.at)}` : base;
}

const OPERATION_ROLES: ReadonlySet<TraceRole> = new Set<TraceRole>([
  'buy',
  'sell',
  'reward',
  'deposit',
  'withdrawal',
  'migration-in',
  'migration-out',
  'opening-balance',
  'proceeds',
  'unqualified',
]);

/** Intitulé court de la métrique, pour la racine de l'arbre (le titre, lui, pose la question). */
const METRIC_HEADS: Record<TraceMetric, string> = {
  pru: 'PRU',
  'cost-basis': 'Coût des unités détenues',
  invested: 'Somme des achats',
  proceeds: 'Somme des ventes',
  realized: 'Réalisé',
  unrealized: 'Latent',
  fees: 'Frais nets',
  value: 'Valeur',
  total: 'Total',
};

function renderNode(
  node: TraceNode,
  metric: TraceMetric,
  opts: TraceRenderOptions,
  showAccount: boolean,
): RenderedTraceNode {
  return {
    id: node.id,
    label: labelOf(node, metric),
    amount: amountText(node, opts),
    details: detailsOf(node.provenance, opts, showAccount),
    gap: node.gap === null ? null : GAP_TEXTS[node.gap],
    lineNo: node.provenance.kind === 'raw-row' ? node.provenance.lineNo : null,
    children: node.children.map((child) => renderNode(child, metric, opts, showAccount)),
  };
}

/** Le compte n'est annoncé que si plusieurs ont contribué : sinon c'est du bruit sur chaque ligne. */
function severalAccounts(node: TraceNode): boolean {
  const ids = new Set<string>();
  const walk = (n: TraceNode): void => {
    if (n.provenance.kind === 'event') ids.add(n.provenance.accountId);
    for (const child of n.children) walk(child);
  };
  walk(node);
  return ids.size > 1;
}

/** Le résidu reste chiffré même en mode discret : c'est un contrôle, pas un montant patrimonial. */
function residualText(trace: Trace): string {
  if (D(trace.residual).eq('0'))
    return 'Contrôle : les contributions retombent exactement sur le montant affiché.';
  return `Contrôle : ${fmtMoney(trace.residual, TRACE_CURRENCY, { sign: true })} restent inexpliqués — voir les réserves ci-dessous.`;
}

export function renderTrace(trace: Trace, opts: TraceRenderOptions): RenderedTrace {
  const metric = trace.target.metric;
  const notes: string[] = [];
  if (opts.displayCurrency !== TRACE_CURRENCY)
    notes.push(
      'Cette fiche est en euros, même si l’application affiche une autre devise : convertir chaque étape ajouterait un arrondi et la somme cesserait de tomber juste.',
    );
  if (metric === 'pru')
    notes.push(
      'Une seule lecture du PRU : celle des lots encore détenus. Il ne change qu’à l’achat — en afficher un second « au moment de la vente » contredirait ce socle.',
    );
  for (const setting of trace.settings) notes.push(SETTING_TEXTS[setting.key](setting.value));
  if (trace.omitted > 0)
    notes.push(
      `${trace.omitted} contributions ne sont pas détaillées une à une ; leur total exact figure sur la ligne « ${ROLE_LABELS.omitted} ».`,
    );
  return {
    title: METRIC_TITLES[metric],
    formula: METRIC_FORMULAS[metric],
    amount: amountText(trace.root, opts),
    root: renderNode(trace.root, metric, opts, severalAccounts(trace.root)),
    notes,
    gaps: trace.gaps.map((gap) => GAP_TEXTS[gap]),
    residual: residualText(trace),
  };
}

/** Trace en texte brut, une ligne par nœud : presse-papier, capture d'écran impossible à falsifier. */
export function traceToText(rendered: RenderedTrace): string {
  const lines: string[] = [`${rendered.title} (${rendered.formula})`];
  const walk = (node: RenderedTraceNode, depth: number): void => {
    const indent = '  '.repeat(depth);
    const parts = [node.label];
    if (node.amount) parts.push(node.amount);
    if (node.details.length > 0)
      parts.push(node.details.map((d) => `${d.term} : ${d.value}`).join(' · '));
    lines.push(`${indent}- ${parts.join(' : ')}`);
    if (node.gap) lines.push(`${indent}  ⚠ ${node.gap}`);
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(rendered.root, 0);
  lines.push(rendered.residual);
  for (const note of rendered.notes) lines.push(note);
  return lines.join('\n');
}
