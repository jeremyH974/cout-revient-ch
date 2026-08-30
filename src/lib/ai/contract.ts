/**
 * Contrat des fonctions d'IA (P70) : ce qu'une sortie de modèle doit porter pour avoir le droit
 * d'être affichée, et ce qui se passe quand elle ne l'a pas. Module pur — ni DOM, ni réseau, ni
 * horloge (l'appelant fournit l'instant, comme partout ailleurs dans ce dépôt).
 *
 * **Il n'existe aucun modèle dans ce code.** P70 ne livre pas une fonction d'IA, il livre le
 * harnais qui rendra sûres celles à venir : le récit narratif (P65), l'appariement de colonnes
 * (P64), l'assistant (P69). La règle de fond ne change pas : **l'IA n'entre jamais dans le
 * calcul ; elle entre dans la compréhension, la qualification et la distribution** — et cette
 * règle n'est une garantie que parce qu'une fonction la vérifie, pas parce qu'un prompt la promet.
 *
 * ## Le refus est un état rendu de première classe
 *
 * Une sortie non ancrée est **jetée entière** et remplacée par le rendu déterministe. Jamais un
 * texte partiel, jamais une dégradation silencieuse : afficher les trois phrases valides d'un
 * texte qui en contenait cinq, c'est publier un résumé que personne n'a écrit.
 *
 * Deux invariants, tenus par construction plutôt que par discipline :
 * `ok ⟹ label présent` (le type l'impose) et `ok ⟹ audit.unanchored.length === 0`
 * (`accept()` refuse de construire l'autre cas).
 */
import type { NaiveDateTime } from '../domain/types';
import type { AnchorReport } from './anchor';

/**
 * Étiquette obligatoire de tout texte produit par un modèle. L'article 50 du règlement (UE)
 * 2024/1689 impose depuis le 02/08/2026 que l'utilisateur sache qu'il lit une sortie de machine ;
 * `notice` est la mention visible, portée par la donnée elle-même pour qu'elle survive à l'export,
 * au PDF et au presse-papier. Le marquage **lisible par machine** n'a, lui, aucune norme technique
 * stabilisée — voir l'entrée `ai-act-marquage` de `src/lib/watch/entries.ts`.
 */
export interface AiLabel {
  readonly generated: true;
  readonly modelId: string;
  readonly at: NaiveDateTime;
  readonly notice: string;
}

/**
 * La mention visible, en français. C'est la seule phrase de ce module : elle voyage avec la sortie
 * (écran, rapport, PDF, MCP), donc elle ne peut pas vivre dans la couche d'affichage.
 */
export const AI_NOTICE =
  'Texte rédigé par un modèle de langage à partir de chiffres déjà calculés par l’application. ' +
  'Aucun montant n’a été calculé par le modèle.';

export type AiRefusal =
  'no-model' | 'model-error' | 'unanchored' | 'forbidden-lexicon' | 'empty' | 'quota' | 'timeout';

/** Les motifs de refus, dans l'ordre déclaré — pour les tests d'exhaustivité. */
export const AI_REFUSALS: readonly AiRefusal[] = [
  'no-model',
  'model-error',
  'unanchored',
  'forbidden-lexicon',
  'empty',
  'quota',
  'timeout',
];

/**
 * D'où vient le refus. La distinction n'est pas cosmétique : elle sépare « le modèle n'a rien
 * dit » de « le modèle a dit quelque chose et nous l'avons rejeté » — c'est-à-dire, dans le banc
 * d'essai, un cas **à recapturer** d'un cas **bloquant**.
 */
export type RefusalOrigin = 'model-unavailable' | 'output-rejected';

/** `switch` exhaustif : ajouter un motif sans le classer ne compile pas. */
export function refusalOrigin(reason: AiRefusal): RefusalOrigin {
  switch (reason) {
    case 'no-model':
    case 'model-error':
    case 'quota':
    case 'timeout':
      return 'model-unavailable';
    case 'unanchored':
    case 'forbidden-lexicon':
    case 'empty':
      return 'output-rejected';
    default: {
      const missing: never = reason;
      throw new Error(`Motif de refus sans origine : ${String(missing)}`);
    }
  }
}

/**
 * Tâches confiables à un modèle. Une seule aujourd'hui ; P64 (appariement de colonnes) et P69
 * (assistant) ajouteront les leurs, avec leur repli.
 */
export type AiTask = 'narrative';

/**
 * Le repli est une propriété de la TÂCHE, pas du motif de refus : le récit narratif retombe sur
 * `insightsToText`, un assistant conversationnel n'aura rien sur quoi retomber.
 */
export const TASK_FALLBACK: Record<AiTask, 'deterministic' | 'none'> = {
  narrative: 'deterministic',
};

export type AiOutcome<T> =
  | {
      readonly status: 'ok';
      readonly value: T;
      readonly label: AiLabel;
      readonly audit: AnchorReport;
    }
  | {
      readonly status: 'refused';
      readonly reason: AiRefusal;
      readonly fallback: 'deterministic' | 'none';
    };

export interface ModelRequest {
  readonly system: string;
  readonly user: string;
}

export interface ModelReply {
  readonly modelId: string;
  readonly text: string;
}

export interface ModelAdapter {
  readonly id: string;
  complete(request: ModelRequest): Promise<ModelReply>;
}

export function label(modelId: string, at: NaiveDateTime, notice: string = AI_NOTICE): AiLabel {
  return { generated: true, modelId, at, notice };
}

export function refuse<T>(task: AiTask, reason: AiRefusal): AiOutcome<T> {
  return { status: 'refused', reason, fallback: TASK_FALLBACK[task] };
}

/**
 * Seule porte d'entrée du succès : un audit non vide **devient un refus**, ici et pas ailleurs.
 * L'invariant « `ok` implique zéro nombre non ancré » cesse ainsi d'être une convention à tenir.
 */
export function accept<T>(
  task: AiTask,
  value: T,
  labelled: AiLabel,
  audit: AnchorReport,
): AiOutcome<T> {
  if (audit.unanchored.length > 0) return refuse<T>(task, 'unanchored');
  return { status: 'ok', value, label: labelled, audit };
}

/** Sérialisation canonique (clés triées) : le même JSON produit toujours la même requête. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Consigne système d'une tâche. Elle fait partie de la clé de cassette : la changer invalide les
 * enregistrements, ce qui est exactement le comportement voulu — un prompt modifié est un modèle
 * différent.
 */
export function systemPrompt(task: AiTask): string {
  switch (task) {
    case 'narrative':
      return [
        'Tu rédiges en français un court récit à partir de constats DÉJÀ CALCULÉS, fournis en JSON.',
        'Tu ne calcules rien : aucun total, aucune somme, aucun arrondi, aucune conversion.',
        'Tout nombre de ta réponse doit apparaître tel quel dans le JSON fourni.',
        'Tu décris, tu ne recommandes jamais : ni acheter, ni vendre, ni arbitrer.',
      ].join('\n');
    default: {
      const missing: never = task;
      throw new Error(`Tâche sans consigne : ${String(missing)}`);
    }
  }
}

/** La requête d'une tâche sur une entrée : déterministe, donc rejouable hors ligne. */
export function buildRequest(task: AiTask, input: unknown): ModelRequest {
  return { system: systemPrompt(task), user: canonicalJson(input) };
}
