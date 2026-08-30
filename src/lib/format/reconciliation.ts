/**
 * Rendu français de la réconciliation (P68, décision n° 40). Le moteur
 * (`src/lib/domain/reconciliation.ts`) produit des items codés et chiffrés ; c'est ici — et
 * seulement ici — qu'ils deviennent des phrases. Deux `switch` exhaustifs (sur `item.code` et sur
 * `action.code`) : ajouter un code sans écrire sa phrase, ou une action sans son intitulé, est une
 * ERREUR DE COMPILATION, jamais un texte vide à l'écran (même modèle que `format/insights.ts`).
 *
 * Mode discret : les MONTANTS et les QUANTITÉS sont masqués (même règle que `CalcTab.svelte` — un
 * prix unitaire, lui, reste lisible) ; les compteurs, dates et tickers restent visibles.
 */
import type {
  ReconciliationAction,
  ReconciliationActionCode,
  ReconciliationCode,
  ReconciliationItem,
  ReconciliationSeverity,
} from '../domain/reconciliation';
import type { GapMetric, ValueGap } from '../domain/gap';
import type { AccountId } from '../domain/types';
import { D } from '../domain/money';
import type { Currency } from '../fx/types';
import { fmtDate, fmtMasked, fmtMoney, fmtPrice, fmtQty } from './fr';

const NONE = '—';

export interface RenderOptions {
  discreet: boolean;
  currency: Currency;
  /** Libellés des comptes (`app.accountLabels`) : l'id sert de repli si le compte est inconnu. */
  accountLabels: Readonly<Record<AccountId, string>>;
}

export interface RenderedReconciliationItem {
  id: string;
  code: ReconciliationCode;
  severity: ReconciliationSeverity;
  /** Intitulé court, pour l'en-tête de carte. */
  title: string;
  /** La phrase complète du constat. */
  detail: string;
  /** Actif concerné, en majuscules ; `null` si l'item n'en cite aucun. */
  assetLabel: string | null;
  /** Compte concerné, résolu via `accountLabels` ; `null` si l'item n'en cite aucun. */
  accountLabel: string | null;
  /** Compteur de preuve, toujours visible (jamais masqué : ce n'est pas un montant). */
  evidenceLabel: string;
  /** Écart chiffré (`ValueGap`), déjà rendu ; `null` si l'item n'en porte pas. */
  gapLabel: string | null;
  /** Intitulé du bouton d'action ; `''` quand `action.code === 'none'` (aucun bouton à afficher). */
  actionLabel: string;
  action: ReconciliationAction;
}

function valueOf(item: ReconciliationItem, key: string) {
  return item.values[key];
}

function num(item: ReconciliationItem, key: string): number {
  const value = valueOf(item, key);
  return value !== undefined && value.kind === 'count' ? value.value : 0;
}

function dayOf(item: ReconciliationItem, key: string): string {
  const value = valueOf(item, key);
  return value !== undefined && value.kind === 'day' ? fmtDate(value.value) : NONE;
}

const plural = (n: number, one: string, many: string): string => (n > 1 ? many : one);

const ticker = (asset: string | null): string => (asset === null ? NONE : asset.toUpperCase());

function labelOfAccount(id: AccountId | null, opts: RenderOptions): string {
  if (id === null) return NONE;
  return opts.accountLabels[id] ?? id;
}

/**
 * Une phrase par code. Le `switch` est exhaustif : ajouter un code au moteur sans écrire sa phrase
 * ici est une ERREUR DE COMPILATION, jamais un constat vide à l'écran.
 */
function textOf(item: ReconciliationItem, opts: RenderOptions): { title: string; detail: string } {
  switch (item.code) {
    case 'unqualified-rows': {
      const n = num(item, 'count');
      return {
        title: 'Lignes à qualifier',
        detail: `${n} ${plural(n, 'opération n’est pas encore interprétée', 'opérations ne sont pas encore interprétées')} : vos totaux restent incomplets tant que ce n’est pas fait.`,
      };
    }
    case 'unpriced-asset':
      return {
        title: 'Actif sans cours',
        detail: `${ticker(item.scope.asset)} n’a pas de cours connu : sa valeur et son latent manquent aux totaux.`,
      };
    case 'balance-mismatch': {
      if (item.scope.asset !== null) {
        return item.severity === 'fail'
          ? {
              title: 'Écart de solde Coinhouse',
              detail: `Le solde ${ticker(item.scope.asset)} de l’export Coinhouse n’est pas retrouvé après chaque opération : une ligne manque ou est en double.`,
            }
          : {
              title: 'Export Coinhouse incomplet',
              detail: `L’export Coinhouse commence avec un solde ${ticker(item.scope.asset)} déjà détenu : des opérations antérieures manquent.`,
            };
      }
      return {
        title: 'Écart de solde Hyperliquid',
        detail: `L’équité du compte ${labelOfAccount(item.scope.accountId, opts)} ne se recoupe pas avec son historique (dépôts, retraits, réalisé, frais, funding, latent).`,
      };
    }
    case 'onchain-balance-gap':
      // Jamais émis par `buildReconciliation` (voir son en-tête) ; la phrase existe pour que
      // le contrôle d'exhaustivité compile, pas pour être affichée un jour sous cette forme.
      return { title: 'Solde on-chain', detail: 'Comparaison de solde on-chain non disponible.' };
    case 'unpaired-withdrawal':
      return {
        title: 'Retrait sans contrepartie',
        detail: `Un retrait ${ticker(item.scope.asset)} du ${dayOf(item, 'day')} (${labelOfAccount(item.scope.accountId, opts)}) n’a trouvé aucun dépôt correspondant : appariez-le, ou renseignez sa valeur.`,
      };
    case 'unpaired-deposit':
      return {
        title: 'Dépôt sans contrepartie',
        detail: `Un dépôt ${ticker(item.scope.asset)} du ${dayOf(item, 'day')} (${labelOfAccount(item.scope.accountId, opts)}) n’a trouvé aucun retrait correspondant : appariez-le, ou renseignez son coût.`,
      };
    case 'external-inflow-no-cost': {
      const n = num(item, 'count');
      return {
        title: 'Entrées sans coût connu',
        detail: `${n} ${plural(n, 'dépôt externe est arrivé', 'dépôts externes sont arrivés')} sans coût d’acquisition connu : votre prix total d’acquisition — donc votre plus-value future — est sous-estimé tant qu’il n’est pas renseigné.`,
      };
    }
    case 'external-outflow-unqualified': {
      const n = num(item, 'count');
      return {
        title: 'Sorties non qualifiables',
        detail: `${n} ${plural(n, 'retrait est parti', 'retraits sont partis')} vers l’extérieur sans valeur connue : un paiement en cryptoactif serait imposable, un simple transfert ne l’est pas — l’export ne permet pas de trancher.`,
      };
    }
    case 'price-gap-at-cession': {
      const n = num(item, 'count');
      return {
        title: 'Valeur manquante à la cession',
        detail: `${n} ${plural(n, 'cession n’a pas pu retrouver', 'cessions n’ont pas pu retrouver')} la valeur globale de votre portefeuille au jour de la vente : leur plus-value estimée reste incertaine. Aucun écran ne permet aujourd’hui de l’annoter.`,
      };
    }
    case 'account-missing-country':
      return {
        title: 'Pays du compte à préciser',
        detail: `Le pays de l’organisme qui tient ${labelOfAccount(item.scope.accountId, opts)} n’est pas renseigné : son statut de déclaration (3916-bis) reste indéterminé.`,
      };
    case 'duplicate-candidate': {
      const where =
        item.scope.accountId !== null
          ? `sur ${labelOfAccount(item.scope.accountId, opts)}`
          : 'sur deux comptes différents';
      return {
        title: 'Doublon possible',
        detail: `Deux opérations ${ticker(item.scope.asset)} du ${dayOf(item, 'day')} se ressemblent ${where} : peut-être la même opération comptée deux fois.`,
      };
    }
    default: {
      // Exhaustivité : un code sans phrase ne compile pas.
      const missing: never = item.code;
      throw new Error(`Item de réconciliation sans texte : ${String(missing)}`);
    }
  }
}

/**
 * Un intitulé par action. Le `switch` est exhaustif au même titre que `textOf` : une action sans
 * intitulé ne compile pas.
 */
function actionLabelOf(code: ReconciliationActionCode): string {
  switch (code) {
    case 'qualify-rows':
      return 'Qualifier ces opérations';
    case 'set-manual-price':
      return 'Saisir un prix manuel';
    case 'reimport-export':
      return 'Réimporter ou resynchroniser';
    case 'enter-opening-balance':
      return 'Saisir un solde d’ouverture';
    case 'pair-or-value-transfer':
      return 'Apparier ou valoriser';
    case 'set-account-country':
      return 'Renseigner le pays';
    case 'review-duplicate':
      return 'Examiner le doublon';
    case 'none':
      return '';
    default: {
      // Exhaustivité : un code d'action sans intitulé ne compile pas.
      const missing: never = code;
      throw new Error(`Action de réconciliation sans intitulé : ${String(missing)}`);
    }
  }
}

/** Montant/quantité dans l'unité de la métrique ; masqué en mode discret. Un prix reste lisible. */
function fmtGapValue(metric: GapMetric, value: string | null, opts: RenderOptions): string {
  if (value === null) return NONE;
  switch (metric) {
    case 'qty':
      return opts.discreet ? fmtMasked() : fmtQty(D(value));
    case 'pru-eur':
      return fmtPrice(D(value), opts.currency);
    case 'value-eur':
    case 'cost-basis-eur':
      return opts.discreet ? fmtMasked(opts.currency) : fmtMoney(D(value), opts.currency);
    default: {
      const missing: never = metric;
      throw new Error(`Métrique d'écart sans rendu : ${String(missing)}`);
    }
  }
}

function renderGap(gap: ValueGap, opts: RenderOptions): string {
  const ours = fmtGapValue(gap.metric, gap.ours, opts);
  const theirs = fmtGapValue(gap.metric, gap.theirs, opts);
  const delta = gap.delta === null ? null : fmtGapValue(gap.metric, gap.delta, opts);
  return delta === null
    ? `Nous : ${ours} · Source comparée : ${theirs}`
    : `Nous : ${ours} · Source comparée : ${theirs} · Écart : ${delta}`;
}

function evidenceLabelOf(item: ReconciliationItem): string {
  const n = Math.max(item.evidence.rowKeys.length, item.evidence.eventIds.length);
  if (n === 0) return 'Aucune ligne citée en preuve.';
  return `${n} ${plural(n, 'ligne citée en preuve', 'lignes citées en preuve')}.`;
}

export function renderReconciliationItem(
  item: ReconciliationItem,
  opts: RenderOptions,
): RenderedReconciliationItem {
  const { title, detail } = textOf(item, opts);
  return {
    id: item.id,
    code: item.code,
    severity: item.severity,
    title,
    detail,
    assetLabel: item.scope.asset === null ? null : ticker(item.scope.asset),
    accountLabel: item.scope.accountId === null ? null : labelOfAccount(item.scope.accountId, opts),
    evidenceLabel: evidenceLabelOf(item),
    gapLabel: item.evidence.gap === undefined ? null : renderGap(item.evidence.gap, opts),
    actionLabel: actionLabelOf(item.action.code),
    action: item.action,
  };
}

export function renderReconciliation(
  list: readonly ReconciliationItem[],
  opts: RenderOptions,
): RenderedReconciliationItem[] {
  return list.map((item) => renderReconciliationItem(item, opts));
}

/** Une ligne par item : presse-papier et résumé collable dans une IA (motif `insightsToText`). */
export function reconciliationToText(list: readonly RenderedReconciliationItem[]): string {
  return list.map((item) => `- ${item.title} : ${item.detail}`).join('\n');
}

/**
 * Compte rendu d'une synchronisation lancée depuis l'écran de réconciliation. C'est la seule
 * action qui ne change pas d'écran : sans message, elle passe pour un bouton mort — c'est
 * exactement le défaut qui a été signalé. Le type d'entrée est structurel et minimal : ce module
 * reste pur et n'importe rien de l'état Svelte.
 */
export interface SyncOutcome {
  error: string | null;
  truncated: boolean;
  added: number;
}

export function renderSyncReport(status: SyncOutcome | undefined): {
  text: string;
  tone: 'error' | 'info';
} {
  if (status?.error)
    return { text: `Synchronisation interrompue : ${status.error}`, tone: 'error' };
  if (status?.truncated)
    return { text: 'Synchronisation partielle : relancez pour continuer.', tone: 'info' };
  const added = status?.added ?? 0;
  if (added === 0)
    return { text: 'Aucun élément nouveau : l’écart vient d’ailleurs.', tone: 'info' };
  return {
    text: `${added} élément${added > 1 ? 's' : ''} récupéré${added > 1 ? 's' : ''}.`,
    tone: 'info',
  };
}
