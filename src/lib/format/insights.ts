/**
 * Rendu français des constats (décision n° 40). Le moteur (`src/lib/domain/insights.ts`) produit
 * des constats codés et chiffrés ; c'est ici — et seulement ici — qu'ils deviennent des phrases.
 * Traduire l'app (P18) ou changer une formulation ne touchera donc jamais au calcul.
 *
 * Mode discret : les MONTANTS sont masqués, les pourcentages, dates et compteurs restent visibles,
 * exactement comme dans le reste de l'interface (`Money` masque, `Pct` non).
 */
import type {
  Insight,
  InsightCode,
  InsightLink,
  InsightTone,
  InsightValue,
} from '../domain/insights';
import type { CoinhouseTier } from '../domain/subscription';
import { D } from '../domain/money';
import type { Currency } from '../fx/types';
import { fmtDate, fmtMasked, fmtMoney, fmtPct } from './fr';

const NONE = '—';

/** Libellés publics des offres Coinhouse (partagés avec le rapport). */
export const TIER_LABELS: Record<CoinhouseTier, string> = {
  classique: 'Classique',
  investisseur: 'Investisseur',
  'gestion-privee': 'Gestion Privée',
};

export interface RenderedInsight {
  id: string;
  code: InsightCode;
  tone: InsightTone;
  /** Intitulé court, pour la puce ou l'en-tête de carte. */
  title: string;
  /** La phrase complète et chiffrée. */
  detail: string;
  link: InsightLink | null;
}

export interface RenderOptions {
  discreet: boolean;
  currency: Currency;
}

function valueOf(insight: Insight, key: string): InsightValue | undefined {
  return insight.values[key];
}

/** Montant formaté ; masqué en mode discret. `signed` affiche le « + » des valeurs favorables. */
function money(insight: Insight, key: string, opts: RenderOptions, signed = false): string {
  const value = valueOf(insight, key);
  if (value === undefined || value.kind !== 'money') return NONE;
  if (opts.discreet) return fmtMasked(opts.currency);
  return fmtMoney(D(value.value), opts.currency, { sign: signed });
}

/** Montant en valeur absolue : la phrase porte déjà le sens (« de plus », « de moins »). */
function absMoney(insight: Insight, key: string, opts: RenderOptions): string {
  const value = valueOf(insight, key);
  if (value === undefined || value.kind !== 'money') return NONE;
  if (opts.discreet) return fmtMasked(opts.currency);
  return fmtMoney(D(value.value).abs(), opts.currency);
}

function pct(insight: Insight, key: string, signed = false): string {
  const value = valueOf(insight, key);
  if (value === undefined || value.kind !== 'ratio') return NONE;
  return fmtPct(D(value.value), { sign: signed });
}

function num(insight: Insight, key: string): number {
  const value = valueOf(insight, key);
  return value !== undefined && value.kind === 'count' ? value.value : 0;
}

function codes(insight: Insight, key: string): readonly string[] {
  const value = valueOf(insight, key);
  return value !== undefined && value.kind === 'assets' ? value.value : [];
}

/** Premier actif du constat, en majuscules (« BTC ») ; « — » s'il manque. */
function ticker(insight: Insight, key: string): string {
  return codes(insight, key)[0]?.toUpperCase() ?? NONE;
}

function tickers(insight: Insight, key: string): string {
  return codes(insight, key)
    .map((c) => c.toUpperCase())
    .join(', ');
}

function dayOf(insight: Insight, key: string): string {
  const value = valueOf(insight, key);
  return value !== undefined && value.kind === 'day' ? fmtDate(value.value) : NONE;
}

function tierOf(insight: Insight, key: string): string {
  const value = valueOf(insight, key);
  return value !== undefined && value.kind === 'tier' ? TIER_LABELS[value.value] : NONE;
}

const plural = (n: number, one: string, many: string): string => (n > 1 ? many : one);

const has = (insight: Insight, key: string): boolean => valueOf(insight, key) !== undefined;

/**
 * Une phrase par code. Le `switch` est exhaustif : ajouter un code au moteur sans écrire sa phrase
 * ici est une ERREUR DE COMPILATION (branche `default`), jamais un constat vide à l'écran.
 */
function textOf(insight: Insight, opts: RenderOptions): { title: string; detail: string } {
  switch (insight.code) {
    case 'unqualified': {
      const n = num(insight, 'count');
      return {
        title: 'Lignes à qualifier',
        detail: `${n} ${plural(n, 'opération n’est pas encore interprétée', 'opérations ne sont pas encore interprétées')} : vos totaux restent incomplets tant que ${plural(n, 'ce n’est pas fait', 'ce n’est pas fait')}.`,
      };
    }
    case 'unpriced': {
      const n = num(insight, 'count');
      return {
        title: 'Actifs sans cours',
        detail: `${n} ${plural(n, 'actif détenu n’a pas de cours connu', 'actifs détenus n’ont pas de cours connu')} (${tickers(insight, 'assets')}) : leur valeur et leur latent manquent aux totaux.`,
      };
    }
    case 'subscription-net':
      return {
        title: 'Rentabilité de l’offre',
        detail: `Sur 12 mois : ${money(insight, 'rebates', opts)} de remises obtenues, soit ${money(insight, 'amount', opts, true)} net après le coût de l’offre ${tierOf(insight, 'tier')}.`,
      };
    case 'fees-12m':
      return {
        title: 'Frais sur 12 mois',
        detail: has(insight, 'rate')
          ? `Vous avez payé ${money(insight, 'amount', opts)} de frais d’opérations sur 12 mois, soit ${pct(insight, 'rate')} du volume échangé.`
          : `Vous avez payé ${money(insight, 'amount', opts)} de frais d’opérations sur 12 mois.`,
      };
    case 'concentration':
      return {
        title: 'Concentration',
        detail: `${ticker(insight, 'assets')} représente ${pct(insight, 'share')} de la valeur de vos positions (${money(insight, 'amount', opts)}).`,
      };
    case 'top3-share':
      return {
        title: 'Vos trois premiers actifs',
        detail: `${tickers(insight, 'assets')} pèsent à eux trois ${pct(insight, 'share')} de la valeur de vos positions.`,
      };
    case 'max-drawdown':
      return {
        title: 'Repli maximal',
        detail: has(insight, 'recovered')
          ? `Votre plus forte baisse a été de ${pct(insight, 'share')}, du ${dayOf(insight, 'from')} au ${dayOf(insight, 'to')} ; le niveau précédent a été retrouvé le ${dayOf(insight, 'recovered')}.`
          : `Votre plus forte baisse a été de ${pct(insight, 'share')}, du ${dayOf(insight, 'from')} au ${dayOf(insight, 'to')} ; ce niveau n’a pas encore été retrouvé.`,
      };
    case 'xirr':
      return {
        title: 'Rendement personnel',
        detail: `Votre rendement personnel (XIRR) est de ${pct(insight, 'rate', true)} par an depuis le ${dayOf(insight, 'since')}.`,
      };
    case 'benchmark-gap':
      return {
        title: 'Repère',
        detail: `À apports identiques, votre portefeuille vaut ${absMoney(insight, 'amount', opts)} de ${insight.tone === 'positive' ? 'plus' : 'moins'} qu’un placement 100 % ${ticker(insight, 'assets')} depuis le ${dayOf(insight, 'since')}.`,
      };
    case 'realized':
      return {
        title: 'Résultat encaissé',
        detail:
          insight.tone === 'positive'
            ? `Depuis le début, vos ventes ont dégagé ${absMoney(insight, 'amount', opts)} de plus-values réalisées.`
            : `Depuis le début, vos ventes totalisent ${absMoney(insight, 'amount', opts)} de moins-values réalisées.`,
      };
    case 'contribution-top':
      return {
        title: 'Principal contributeur',
        detail: `${ticker(insight, 'assets')} est le premier contributeur à votre résultat (${money(insight, 'amount', opts, true)}).`,
      };
    case 'contribution-bottom':
      return {
        title: 'Principal frein',
        detail: `${ticker(insight, 'assets')} est celui qui pèse le plus sur votre résultat (${money(insight, 'amount', opts, true)}).`,
      };
    case 'capital-recovered': {
      const n = num(insight, 'count');
      return {
        title: 'Mise récupérée',
        detail:
          n > 1
            ? `Sur ${n} positions (${tickers(insight, 'assets')}…), vos ventes ont déjà rendu la mise de départ.`
            : `Sur ${tickers(insight, 'assets')}, vos ventes ont déjà rendu la mise de départ.`,
      };
    }
    case 'stablecoin-share':
      return {
        title: 'Part des stablecoins',
        detail: `Les stablecoins représentent ${pct(insight, 'share')} de la valeur (${money(insight, 'amount', opts)}) : cette part ne suit pas le marché.`,
      };
    default: {
      // Exhaustivité : un code sans phrase ne compile pas.
      const missing: never = insight.code;
      throw new Error(`Constat sans texte : ${String(missing)}`);
    }
  }
}

export function renderInsight(insight: Insight, opts: RenderOptions): RenderedInsight {
  const { title, detail } = textOf(insight, opts);
  return {
    id: insight.id,
    code: insight.code,
    tone: insight.tone,
    title,
    detail,
    link: insight.link,
  };
}

export function renderInsights(list: readonly Insight[], opts: RenderOptions): RenderedInsight[] {
  return list.map((insight) => renderInsight(insight, opts));
}

/** Constats en texte brut, une ligne par constat : presse-papier et résumé collable dans une IA. */
export function insightsToText(list: readonly RenderedInsight[]): string {
  return list.map((insight) => `- ${insight.title} : ${insight.detail}`).join('\n');
}
