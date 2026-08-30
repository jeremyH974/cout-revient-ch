/**
 * Rendu français des états d'une fonction d'IA : le motif d'un refus, et l'étiquette obligatoire.
 *
 * Même partage que pour les constats (décision n° 40) : le contrat (`src/lib/ai/contract.ts`)
 * ignore la langue et ne connaît que des codes ; le français vit ici. Un écran qui écrirait ses
 * propres phrases de refus finirait par en avoir une de plus que les autres, et par en oublier une.
 *
 * Les phrases de ce module passent elles-mêmes les quatre lexiques proscrits
 * (`src/lib/format/lexicon.ts`) — un test l'exige. Ce n'est pas une coquetterie : le mot
 * « erreur » y est interdit, et c'est précisément celui qu'on écrit sans y penser pour parler d'un
 * appel qui n'a pas abouti.
 */
import type { AiLabel, AiRefusal } from '../ai/contract';
import { fmtDate } from './fr';

/**
 * Ce qu'on dit à l'utilisateur, motif par motif. `Record` exhaustif : ajouter un motif au contrat
 * sans écrire sa phrase ne compile pas.
 *
 * Chaque phrase dit **ce qui se passe maintenant**, jamais seulement ce qui a échoué : un refus
 * n'est pas une panne, c'est le repli déterministe qui prend la main.
 */
export const AI_REFUSAL_TEXT: Record<AiRefusal, string> = {
  'no-model': 'Aucune clé n’est en mémoire, ou l’envoi n’a pas été confirmé.',
  'model-error':
    'Le modèle n’a pas pu répondre : clé refusée, service indisponible, ou requête bloquée par le navigateur.',
  quota: 'Le plafond d’appels de votre compte est atteint. Réessayez plus tard.',
  timeout: 'Le modèle n’a pas répondu dans le délai imparti.',
  empty: 'La réponse est vide ou coupée : il n’y avait rien à afficher.',
  unanchored:
    'Un nombre de la réponse ne se retrouve pas dans les constats fournis. Le texte est écarté en entier — jamais publié à moitié.',
  'forbidden-lexicon':
    'La réponse emploie un vocabulaire que cette application s’interdit. Le texte est écarté en entier.',
};

/** La phrase complète affichée à la place d'un récit refusé, repli compris. */
export function refusalText(reason: AiRefusal, fallback: 'deterministic' | 'none'): string {
  const tail = fallback === 'deterministic' ? ' Voici le résumé calculé par l’application.' : '';
  return `${AI_REFUSAL_TEXT[reason]}${tail}`;
}

/**
 * L'étiquette en une ligne. Elle **préfixe le presse-papier** : une mention qui ne survit pas au
 * copier-coller ne protège que l'écran, c'est-à-dire le seul endroit où l'utilisateur savait déjà.
 */
export function aiLabelLine(labelled: AiLabel): string {
  const day = fmtDate(labelled.at.slice(0, 10));
  return `[Texte généré par IA — ${labelled.modelId}, le ${day}] ${labelled.notice}`;
}

/** La pastille courte affichée sur la carte (l'étiquette longue vit dans l'infobulle et le presse-papier). */
export const AI_BADGE = 'généré par IA';
