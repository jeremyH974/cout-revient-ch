/**
 * Carte de partage (P9, décision n° 53) — modèle pur, sans rendu ni DOM.
 *
 * Ce module décide **quoi** montrer et **comment le formuler** ; le canvas et l'écran ne font
 * qu'afficher ce modèle, sur le patron de `report-model.ts`. Il est donc entièrement testable sans
 * navigateur, ce qui compte : c'est ici que se joue la promesse de vie privée.
 *
 * **Des pourcentages, pas des montants.** Une carte destinée à un salon Discord ne doit rien dire
 * de la taille du portefeuille. Les montants n'existent que si l'appelant fournit `amounts`, ce
 * qu'il ne fait que sur une bascule explicite de l'utilisateur — et cette bascule n'est pas
 * mémorisée : un réglage qui se souvient finit par publier ce qu'on ne voulait publier qu'une fois.
 *
 * **La promesse est vérifiée par une propriété, pas par une relecture.** Chercher les chiffres d'un
 * montant dans le texte serait fragile — un pourcentage peut fortuitement les contenir.
 * `share-card.test.ts` tire donc des montants au hasard et vérifie que les activer **n'ajoute que
 * les lignes de montants** : tout le reste de la carte, titre et résumé compris, reste rigoureusement
 * identique. Aucune grandeur affichée par défaut n'est donc dérivée d'un montant, ni ne peut en
 * trahir un. Une relecture attentive, elle, ne prouve rien sur les données qu'elle n'a pas vues.
 *
 * **Le résumé texte n'est pas une commodité.** Une image est illisible pour un lecteur d'écran, et
 * un `alt` de dix mots ne remplace pas des chiffres : `text` porte les mêmes nombres, dans le même
 * ordre, et sert à la fois d'équivalent accessible et de contenu du bouton « Copier ».
 */
import { D, ZERO, type Big } from '../domain/money';
import type { AssetCode } from '../domain/types';
import { fmtMoney, fmtPct } from '../format/fr';
import type { Currency } from '../fx/types';
import { TICKERS } from '../pricing/tickers';

/** Nombre d'actifs cités : au-delà, la carte devient un tableau et cesse d'être lisible d'un coup. */
export const TOP_ASSETS = 3;

export const SHARE_SIGNATURE = 'Coût de revient CH';
export const SHARE_URL = 'jeremyh974.github.io/cout-revient-ch';

export interface ShareAllocation {
  asset: AssetCode;
  /** Part relative du portefeuille, en ratio (0,42 = 42 %). */
  share: Big;
}

/**
 * Montants — fournis **uniquement** quand l'utilisateur les a explicitement demandés. `null` est
 * le défaut, et c'est ce défaut que la propriété de test verrouille.
 */
export interface ShareAmounts {
  netWorth: Big;
  /** Résultat total (réalisé + latent). */
  total: Big;
}

export interface ShareCardInput {
  /** Libellé de période, décidé par l'appelant (« 1 mois », « depuis le début »). */
  periodLabel: string;
  /** Performance hors apports sur la période, en ratio ; `null` si non calculable. */
  twr: Big | null;
  /** Rendement annualisé (XIRR), en ratio. */
  xirr: Big | null;
  /** Repère « mêmes apports sur un seul actif » : sa performance, pas la vôtre. */
  benchmark: { label: string; twr: Big } | null;
  /** Parts relatives ; le modèle trie et coupe lui-même. */
  allocation: readonly ShareAllocation[];
  /** Nombre de lignes ouvertes. */
  positions: number;
  amounts: ShareAmounts | null;
  currency: Currency;
}

export type ShareTone = 'gain' | 'loss' | 'neutral';

export interface ShareRow {
  label: string;
  value: string;
  tone: ShareTone;
}

export interface ShareCard {
  title: string;
  subtitle: string;
  rows: readonly ShareRow[];
  /** Équivalent accessible de l'image, et contenu du bouton « Copier un résumé texte ». */
  text: string;
  footer: string;
  /** Vrai si des montants figurent sur la carte : l'interface doit le dire avant le partage. */
  hasAmounts: boolean;
}

function toneOf(value: Big | null): ShareTone {
  if (value === null) return 'neutral';
  if (value.gt(ZERO)) return 'gain';
  if (value.lt(ZERO)) return 'loss';
  return 'neutral';
}

/** Nom lisible d'un actif, sinon son ticker en majuscules. */
function assetLabel(asset: AssetCode): string {
  return TICKERS[asset]?.name ?? asset.toUpperCase();
}

function topAssets(allocation: readonly ShareAllocation[]): ShareAllocation[] {
  return [...allocation]
    .filter((a) => a.share.gt(ZERO))
    .sort((a, b) => b.share.cmp(a.share))
    .slice(0, TOP_ASSETS);
}

export function shareCardModel(input: ShareCardInput): ShareCard {
  const rows: ShareRow[] = [];

  rows.push({
    label: `Performance ${input.periodLabel}`,
    value: fmtPct(input.twr),
    tone: toneOf(input.twr),
  });

  if (input.benchmark) {
    rows.push({
      // Le repère porte le nom de l'actif : sans lui, deux pourcentages côte à côte
      // se lisent comme deux mesures du même portefeuille.
      label: `Mêmes apports en ${input.benchmark.label}`,
      value: fmtPct(input.benchmark.twr),
      tone: toneOf(input.benchmark.twr),
    });
  }

  if (input.xirr !== null) {
    rows.push({
      label: 'Rendement annualisé',
      value: fmtPct(input.xirr),
      tone: toneOf(input.xirr),
    });
  }

  const top = topAssets(input.allocation);
  if (top.length > 0) {
    rows.push({
      label: top.length === 1 ? 'Première ligne' : `${top.length} premières lignes`,
      value: top
        .map((a) => `${assetLabel(a.asset)} ${fmtPct(a.share, { sign: false })}`)
        .join(' · '),
      tone: 'neutral',
    });
  }

  rows.push({
    label: 'Lignes ouvertes',
    value: String(input.positions),
    tone: 'neutral',
  });

  // Les montants viennent EN DERNIER et seulement s'ils ont été demandés : ainsi une carte
  // tronquée en hauteur perd le montant avant de perdre la performance.
  if (input.amounts) {
    rows.push({
      label: 'Valeur nette',
      value: fmtMoney(input.amounts.netWorth, input.currency),
      tone: 'neutral',
    });
    rows.push({
      label: 'Résultat total',
      value: fmtMoney(input.amounts.total, input.currency, { sign: true }),
      tone: toneOf(input.amounts.total),
    });
  }

  const title = 'Mon portefeuille crypto';
  const subtitle = `Performance hors apports · ${input.periodLabel}`;
  const footer = `${SHARE_SIGNATURE} · ${SHARE_URL}`;

  return {
    title,
    subtitle,
    rows,
    footer,
    text: [
      `${title} — ${subtitle}`,
      ...rows.map((r) => `${r.label} : ${r.value}`),
      '',
      // Sans cette phrase, un pourcentage posté seul se lit comme une performance de marché.
      'Performance hors apports : un virement ne compte ni comme gain ni comme perte.',
      footer,
    ].join('\n'),
    hasAmounts: input.amounts !== null,
  };
}

/** Part relative d'un actif à partir d'une valeur et d'un total ; `0` si le total est nul. */
export function shareOf(value: Big, total: Big): Big {
  return total.gt(ZERO) ? value.div(total) : D('0');
}
