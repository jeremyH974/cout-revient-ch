/**
 * Traduction des LIBELLÉS DE TYPE d'un fichier inconnu vers les étiquettes que le pipeline pivot
 * lit déjà (P64).
 *
 * Apparier les colonnes ne suffit pas. Une colonne « Opération » correctement identifiée porte
 * encore « Récompense de staking », « Frais de retrait » ou « Cadeau » — des mots que
 * `pivotLedgerEvents` ne connaît pas, et qui décident pourtant du traitement : une récompense
 * entre à valeur, un cadeau sort **au coût**, une dépense sort **au prix de cession**. Un libellé
 * mal traduit ne produit pas une ligne bancale, il produit une plus-value fausse.
 *
 * Les quatre tables cibles sont **celles du moteur**, importées de `pivot/events.ts` : aucune copie
 * locale. Les trois mêmes règles que pour les colonnes — exact, synonyme, distance d'édition —
 * avec les mêmes plafonds, parce qu'un utilisateur qui a compris la confiance d'une colonne ne
 * doit pas avoir à réapprendre celle d'un libellé.
 *
 * **Un libellé non traduit n'est jamais une erreur** : il passe tel quel dans la ligne pivot, où
 * le moteur l'ignore poliment (aucune des quatre tables ne le contient) et la ligne suit son
 * traitement par défaut. C'est la même doctrine que partout : ne rien deviner vaut mieux que
 * deviner mal.
 */
import { FEE_LABELS, NEUTRAL_OUT_LABELS, REWARD_LABELS, SPEND_LABELS } from '../pivot/events';
import { normalizeHeader } from './normalize';
import { FUZZY_THRESHOLD, RULE_CAP, similarity, type MatchRule } from './score';

/** Les étiquettes cibles, dans l'ordre des quatre tables du moteur. */
export const TYPE_TARGETS: readonly string[] = [
  ...REWARD_LABELS,
  ...FEE_LABELS,
  ...NEUTRAL_OUT_LABELS,
  ...SPEND_LABELS,
];

/**
 * Synonymes français et anglais par étiquette cible. Seules les étiquettes qu'un export nomme
 * réellement autrement y figurent : `airdrop`, `staking` ou `cashback` s'écrivent partout pareil,
 * et leur inventer des synonymes n'apporterait que des collisions.
 */
export const TYPE_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  reward: ['recompense', 'recompenses', 'gain', 'rewards', 'earn', 'earnings', 'bonus'],
  staking: ['staking reward', 'recompense de staking', 'jalonnement', 'stake reward'],
  interest: ['interets', 'interet', 'rendement', 'yield'],
  dividend: ['dividende', 'dividendes'],
  mining: ['minage', 'mined'],
  cashback: ['remise', 'remboursement', 'rebate'],
  income: ['revenu', 'revenus'],
  salary: ['salaire', 'paie'],
  fee: ['frais', 'frais de retrait', 'frais de reseau', 'network fee', 'withdrawal fee'],
  cost: ['cout', 'couts', 'charge'],
  tax: ['impot', 'taxe', 'prelevement'],
  gift: ['cadeau', 'don recu', 'offert'],
  donation: ['don', 'dons', 'donation faite'],
  lost: ['perte', 'perdu', 'vol', 'stolen'],
  spend: ['depense', 'depenses', 'paiement', 'achat carte'],
  'card spend': ['paiement carte', 'depense carte', 'card payment'],
  payment: ['reglement', 'paiement sortant'],
};

interface TypeIndexEntry {
  readonly target: string;
  readonly rule: MatchRule;
}

/** Forme normalisée → étiquette cible, par la règle qui l'a produite. */
const TYPE_INDEX: ReadonlyMap<string, TypeIndexEntry> = (() => {
  const index = new Map<string, TypeIndexEntry>();
  for (const target of TYPE_TARGETS)
    index.set(normalizeHeader(target).text, { target, rule: 'exact-header' });
  for (const [target, names] of Object.entries(TYPE_SYNONYMS)) {
    if (!TYPE_TARGETS.includes(target)) continue;
    for (const name of names) {
      const key = normalizeHeader(name).text;
      // Une étiquette exacte l'emporte toujours sur un synonyme d'une autre étiquette.
      if (!index.has(key)) index.set(key, { target, rule: 'synonym' });
    }
  }
  return index;
})();

export interface TypeMatch {
  readonly target: string;
  readonly rule: MatchRule;
  readonly confidence: number;
}

/**
 * Traduit un libellé de fichier, ou rend `null` s'il ne ressemble à aucune étiquette connue —
 * ce qui est le cas normal des types d'échange (« achat », « vente », « buy », « trade ») : une
 * ligne à deux jambes n'a besoin d'aucune étiquette pour être interprétée.
 */
export function matchTypeLabel(value: string): TypeMatch | null {
  const normalized = normalizeHeader(value).text;
  if (normalized === '') return null;
  const direct = TYPE_INDEX.get(normalized);
  if (direct !== undefined)
    return { target: direct.target, rule: direct.rule, confidence: RULE_CAP[direct.rule] };
  let best: TypeMatch | null = null;
  for (const [key, entry] of TYPE_INDEX) {
    const closeness = similarity(normalized, key);
    if (closeness < FUZZY_THRESHOLD) continue;
    const confidence = RULE_CAP.fuzzy * closeness;
    if (best === null || confidence > best.confidence)
      best = { target: entry.target, rule: 'fuzzy', confidence };
  }
  return best;
}
