/**
 * Le français de l'appariement de colonnes (P64).
 *
 * Même partage que pour les constats (décision n° 40) et les états d'IA (`format/ai.ts`) : le
 * moteur ne connaît que des **codes** (`blocked=btc,eth`, `rows-kept=0.87<0.90`), le français vit
 * ici. Un écran qui écrirait ses propres phrases finirait par en avoir une de plus que les autres,
 * et par en oublier une.
 *
 * Les phrases de ce module passent les quatre lexiques proscrits (`format/lexicon.ts`) — un test
 * l'exige. Ce n'est pas une coquetterie : « erreur » y est interdit, et c'est le mot qu'on écrit
 * sans y penser pour parler d'un appariement refusé. Un appariement refusé n'est pas une panne :
 * c'est la proposition déterministe qui reste en place.
 */
import type { MappingCheckId, MappingCheckStatus } from '../import/mapping/verify';
import type { AssignmentRule, MappingSource, UnsupportedForm } from '../import/mapping/propose';
import type { MappingTarget } from '../import/mapping/schema';

/** Le nom affiché de chaque champ cible. `Record` exhaustif : un champ sans nom ne compile pas. */
export const TARGET_LABELS: Record<MappingTarget, string> = {
  date: 'Date de l’opération',
  sentAmount: 'Quantité envoyée',
  sentCurrency: 'Actif envoyé',
  receivedAmount: 'Quantité reçue',
  receivedCurrency: 'Actif reçu',
  feeAmount: 'Montant des frais',
  feeCurrency: 'Actif des frais',
  netWorthAmount: 'Contre-valeur',
  netWorthCurrency: 'Devise de la contre-valeur',
  label: 'Type d’opération',
  description: 'Description',
  txHash: 'Hachage de transaction',
};

/**
 * D'où vient un appariement, en toutes lettres. La provenance est affichée par **pastille ET
 * texte** : jamais par la seule couleur (WCAG 2.2 AA, critère 1.4.1). Ce module fournit le texte ;
 * le composant fournit la pastille.
 */
export const SOURCE_LABELS: Record<MappingSource, string> = {
  deterministic: 'trouvé par l’application',
  model: 'proposé par le modèle',
};

/** Ce qui a produit l'appariement : la règle exacte, dite sans jargon. */
export const RULE_LABELS: Record<AssignmentRule, string> = {
  'exact-header': 'en-tête déjà connu',
  synonym: 'synonyme connu',
  fuzzy: 'en-tête approchant',
  'shape-only': 'forme des valeurs',
  model: 'proposition du modèle',
};

/** Le niveau de confiance, en trois mots plutôt qu'en un pourcentage nu. */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'confiance élevée';
  if (confidence >= 0.5) return 'à confirmer';
  return 'non apparié';
}

/** Le pourcentage, pour l'afficher À CÔTÉ du mot — jamais à sa place. */
export const confidencePercent = (confidence: number): string =>
  `${Math.round(confidence * 100)} %`;

/** Ce que chaque contrôle du vérificateur vérifie, en une ligne. */
export const CHECK_LABELS: Record<MappingCheckId, string> = {
  admissible: 'Colonnes indispensables',
  'dry-run': 'Lecture à blanc du fichier',
  shapes: 'Dates, montants et devises',
  invariant: 'Cohérence comptable',
  blocked: 'Sens des opérations',
  unqualified: 'Opérations interprétées',
  balance: 'Écart de solde',
};

/** Le statut, en toutes lettres — « non applicable » n'est jamais « vert ». */
export const STATUS_LABELS: Record<MappingCheckStatus, string> = {
  pass: 'vérifié',
  fail: 'refusé',
  'not-applicable': 'non applicable',
};

/**
 * Le motif d'un refus, en français, à partir de son code. Le préfixe suffit à choisir la phrase :
 * ce qui suit le `=` est un détail chiffré, montré tel quel après la phrase.
 */
export function checkReason(code: string): string {
  if (code.startsWith('missing-date-or-pair'))
    return 'Il manque la date, ou bien la quantité et l’actif d’au moins une jambe.';
  if (code.startsWith('rows-kept'))
    return 'Trop de lignes du fichier restent illisibles avec cet appariement.';
  if (code.startsWith('issues'))
    return 'Trop de lignes du fichier posent question avec cet appariement.';
  if (code.startsWith('dates-read')) return 'Des dates ne se lisent pas dans la colonne choisie.';
  if (code.startsWith('amounts-read'))
    return 'Des montants ne se lisent pas dans les colonnes choisies.';
  if (code.startsWith('currencies-known'))
    return 'Trop d’actifs de la colonne choisie sont inconnus de l’application.';
  if (code.startsWith('invariant-off'))
    return 'Le rapport obtenu ne se recoupe pas : signalez-le avec le diagnostic.';
  if (code.startsWith('blocked'))
    return 'Cet appariement céderait des actifs qui n’ont jamais été acquis : les jambes envoyée et reçue sont probablement inversées.';
  if (code.startsWith('unqualified')) return 'Trop de lignes resteraient à qualifier une par une.';
  if (code.startsWith('balance-off'))
    return 'Les soldes du fichier ne se retrouvent pas après les opérations lues.';
  if (code.startsWith('no-balance-column'))
    return 'Ce fichier ne porte pas de colonne de solde : ce contrôle ne peut pas s’appliquer.';
  if (code.startsWith('balance-ambiguous'))
    return 'La colonne de solde de ce fichier ne désigne pas un actif unique : ce contrôle ne peut pas s’appliquer.';
  return 'Cet appariement n’a pas passé les contrôles.';
}

/** Les formes que la v1 ne traite pas — reconnues et NOMMÉES, plutôt qu'un « format inconnu ». */
export const UNSUPPORTED_LABELS: Record<UnsupportedForm, string> = {
  'signed-single-leg':
    'Ce fichier a une seule colonne de montant, dont le signe indique le sens (négatif = sortie). ' +
    'Cette forme n’est pas encore prise en charge par l’appariement : passez par le format pivot ' +
    'Koinly/Waltio, ou par l’export natif de la plateforme si elle en a un.',
};
