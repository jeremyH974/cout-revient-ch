/**
 * Pourquoi un taux de rendement interne n'a pas pu être calculé, en quelques mots.
 *
 * La table vivait dans l'écran Prêts ; le rapport de prêts (décision n° 178) doit dire la même
 * chose au même endroit, et deux copies d'une phrase finissent par diverger. Un `Record` sur
 * l'union : une raison ajoutée au moteur sans libellé ne compile plus.
 */
import type { XirrFailure } from '../domain/xirr';

const LABELS: Readonly<Record<XirrFailure, string>> = {
  'insufficient-flows': 'pas assez de flux',
  'same-sign': 'aucun remboursement encore',
  'too-recent': 'moins de 30 jours d’historique',
  'no-convergence': 'non calculable',
};

export function xirrFailureLabel(reason: XirrFailure): string {
  return LABELS[reason];
}
