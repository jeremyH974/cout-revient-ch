/**
 * Libellés de type de ligne Coinhouse (colonne « Type ») : ce que l'import interprète tout seul
 * (`auto`) et ce qu'il laisse **à qualifier** par l'utilisateur, avec un choix pré-sélectionné
 * (`suggest`). Les libellés « probables » viennent des fonctions annoncées par Coinhouse — staking
 * (5.8.0, juin 2026), produits de rendement (5.9.1, juillet), retraits de staking (5.12.0, août) —
 * sans export réel sous les yeux : ils ne sont jamais appliqués sans confirmation. Quand un libellé
 * réel est confirmé par un export, il passe en `auto` ici, et nulle part ailleurs
 * (docs/coinhouse-export.md, « Types de lignes »).
 */
import { D, isNegative, isPositive } from '../../domain/money';
import type { Qualification, UnqualifiedLeg } from '../../domain/types';

/** Minuscules, sans accents, espaces compactés. */
export function normalizeType(type: string): string {
  return type.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export type RowTypeKind = 'reward' | 'deposit' | 'withdrawal' | 'ignore';

export interface RowTypeHint {
  kind: RowTypeKind;
  /** `auto` : interprété à l'import (avec avertissement) ; `suggest` : à confirmer par l'utilisateur. */
  mode: 'auto' | 'suggest';
  /** Explication affichée dans l'écran de qualification. */
  note: string;
}

const REWARD_NOTE = 'Jetons reçus sans contrepartie (récompense, intérêts) : coût 0 € par défaut.';
const DEPOSIT_NOTE =
  'Jetons reçus depuis l’extérieur : indiquez leur coût d’acquisition si vous le connaissez.';
const WITHDRAWAL_NOTE = 'Jetons envoyés hors de Coinhouse : vous les détenez toujours ailleurs.';
const STAKING_NOTE =
  'Mouvement interne probable (mise en staking ou retour de staking) : l’actif reste le vôtre, rien à compter.';

/** Libellés exacts (normalisés) → interprétation. */
export const ROW_TYPE_HINTS: Readonly<Record<string, RowTypeHint>> = {
  // Confirmés par l'usage (depuis la v1) : appliqués à l'import.
  recompense: { kind: 'reward', mode: 'auto', note: REWARD_NOTE },
  recompenses: { kind: 'reward', mode: 'auto', note: REWARD_NOTE },
  reward: { kind: 'reward', mode: 'auto', note: REWARD_NOTE },
  rewards: { kind: 'reward', mode: 'auto', note: REWARD_NOTE },
  rendement: { kind: 'reward', mode: 'auto', note: REWARD_NOTE },
  interets: { kind: 'reward', mode: 'auto', note: REWARD_NOTE },
  depot: { kind: 'deposit', mode: 'auto', note: DEPOSIT_NOTE },
  deposit: { kind: 'deposit', mode: 'auto', note: DEPOSIT_NOTE },
  reception: { kind: 'deposit', mode: 'auto', note: DEPOSIT_NOTE },
  retrait: { kind: 'withdrawal', mode: 'auto', note: WITHDRAWAL_NOTE },
  withdrawal: { kind: 'withdrawal', mode: 'auto', note: WITHDRAWAL_NOTE },
  envoi: { kind: 'withdrawal', mode: 'auto', note: WITHDRAWAL_NOTE },
  // Probables (Coinhouse 2026, libellés non confirmés) : proposés, jamais appliqués seuls.
  staking: { kind: 'ignore', mode: 'suggest', note: STAKING_NOTE },
  'mise en staking': { kind: 'ignore', mode: 'suggest', note: STAKING_NOTE },
  'retrait de staking': { kind: 'ignore', mode: 'suggest', note: STAKING_NOTE },
  'retrait staking': { kind: 'ignore', mode: 'suggest', note: STAKING_NOTE },
  unstaking: { kind: 'ignore', mode: 'suggest', note: STAKING_NOTE },
  'recompense de staking': { kind: 'reward', mode: 'suggest', note: REWARD_NOTE },
  'recompenses de staking': { kind: 'reward', mode: 'suggest', note: REWARD_NOTE },
  'staking reward': { kind: 'reward', mode: 'suggest', note: REWARD_NOTE },
  'staking rewards': { kind: 'reward', mode: 'suggest', note: REWARD_NOTE },
  'revenu de staking': { kind: 'reward', mode: 'suggest', note: REWARD_NOTE },
  'produit de rendement': { kind: 'reward', mode: 'suggest', note: REWARD_NOTE },
  parrainage: { kind: 'reward', mode: 'suggest', note: REWARD_NOTE },
  referral: { kind: 'reward', mode: 'suggest', note: REWARD_NOTE },
  airdrop: { kind: 'reward', mode: 'suggest', note: REWARD_NOTE },
  cadeau: { kind: 'reward', mode: 'suggest', note: REWARD_NOTE },
  bonus: { kind: 'reward', mode: 'suggest', note: REWARD_NOTE },
};

/** Familles de mots reconnues dans un libellé inconnu (ex. « Récompense de staking SOL »). */
const PATTERNS: readonly { test: RegExp; kind: RowTypeKind; note: string }[] = [
  { test: /\b(recompense|reward|rendement|interet|interets)\b/, kind: 'reward', note: REWARD_NOTE },
  { test: /\b(staking|stake|unstak)/, kind: 'ignore', note: STAKING_NOTE },
  { test: /\b(depot|deposit|reception)\b/, kind: 'deposit', note: DEPOSIT_NOTE },
  { test: /\b(retrait|withdrawal|envoi)\b/, kind: 'withdrawal', note: WITHDRAWAL_NOTE },
];

/** Interprétation d'un libellé : exacte d'abord, puis par famille de mots (toujours `suggest`). */
export function rowTypeHint(rawType: string): RowTypeHint | null {
  const type = normalizeType(rawType);
  const exact = ROW_TYPE_HINTS[type];
  if (exact) return exact;
  const pattern = PATTERNS.find((p) => p.test.test(type));
  return pattern ? { kind: pattern.kind, mode: 'suggest', note: pattern.note } : null;
}

/** Interprétation appliquée à l'import pour une ligne isolée (`auto` seulement). */
export function autoKind(rawType: string): RowTypeKind | null {
  const hint = ROW_TYPE_HINTS[normalizeType(rawType)];
  return hint?.mode === 'auto' ? hint.kind : null;
}

/**
 * Qualification proposée pour un événement à qualifier, cohérente avec ses jambes ; `null` quand
 * rien de probable ne s'applique (l'écran laisse alors l'utilisateur choisir).
 */
export function suggestQualification(
  rawType: string,
  legs: readonly UnqualifiedLeg[],
): Qualification | null {
  const hint = rowTypeHint(rawType);
  if (!hint) return null;
  const single = legs.length === 1 ? legs[0]! : null;
  const qty = single ? D(single.signedQty) : null;
  switch (hint.kind) {
    case 'ignore':
      return { kind: 'ignore' };
    case 'reward':
      return qty && isPositive(qty) ? { kind: 'reward', fairValueEur: null } : null;
    case 'deposit':
      return qty && isPositive(qty) ? { kind: 'deposit', costEur: null } : null;
    case 'withdrawal':
      return qty && isNegative(qty) ? { kind: 'withdrawal', proceedsEur: null } : null;
  }
}
