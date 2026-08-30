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
 * Tâches confiables à un modèle. Deux aujourd'hui ; P69 (assistant) ajoutera la sienne, avec son
 * repli.
 */
export type AiTask = 'narrative' | 'column-mapping';

/**
 * Le repli est une propriété de la TÂCHE, pas du motif de refus : le récit narratif retombe sur
 * `insightsToText`, l'appariement de colonnes sur sa proposition déterministe (la voie que 100 %
 * des utilisateurs ont, avec ou sans clé), un assistant conversationnel n'aura rien sur quoi
 * retomber.
 */
export const TASK_FALLBACK: Record<AiTask, 'deterministic' | 'none'> = {
  narrative: 'deterministic',
  'column-mapping': 'deterministic',
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
    /*
     * Consigne du récit narratif (P65). Chaque phrase répond à un échec observé du vérificateur,
     * pas à une intention générale :
     *
     * - « aucune somme, aucune différence » ferme explicitement le total recomposé — la faute la
     *   plus tentante, parce que le résultat est JUSTE et que rien, dans le texte, ne trahit
     *   l'addition. Le vérificateur la refuse ; le prompt évite d'avoir à la refuser.
     * - « Si un chiffre te manque, ne l'écris pas » vaut mieux que « n'invente pas » : elle dit
     *   quoi FAIRE, ce qui est la seule forme de consigne qu'un modèle puisse suivre sans marge.
     * - « Tu n'attribues jamais un chiffre à un autre actif » vise la limite que l'ancrage NE PEUT
     *   PAS attraper (`anchor.ts`, en-tête). Le prompt ne la comble pas — rien ne la comble —,
     *   mais il ne la laisse pas non plus sans instruction.
     * - « sans titre, sans liste, sans emoji » : la carte a déjà son titre, et une liste de puces
     *   se confondrait avec les constats qu'elle surmonte.
     *
     * La changer invalide toutes les cassettes (la clé est `sha256(system ‖ user ‖ modelId)`) :
     * c'est voulu — un prompt modifié est un autre modèle.
     */
    case 'narrative':
      return [
        'Tu rédiges en français un court récit — trois à six phrases — à partir de constats',
        'DÉJÀ CALCULÉS, fournis en JSON.',
        'Tu ne calcules rien : aucune somme, aucune différence, aucun pourcentage, aucun',
        'arrondi, aucune conversion de devise. Additionner deux constats, même juste, est',
        'une faute.',
        'Tout nombre de ta réponse doit apparaître tel quel dans le JSON fourni. Si un',
        'chiffre te manque, ne l’écris pas.',
        'Tu décris ce qui s’est passé : tu ne recommandes rien (ni acheter, ni vendre, ni',
        'arbitrer), tu ne prédis rien, tu ne garantis rien, tu ne classes rien.',
        'Tu n’attribues jamais un chiffre à un autre actif que celui de son constat.',
        'Écris au passé et au présent, sans titre, sans liste, sans emoji.',
      ].join('\n');
    /*
     * Consigne de l'appariement de colonnes (P64). Elle diffère de la précédente sur un point de
     * fond : le modèle ne rédige pas, il **cite**. Chaque phrase ferme une manière de fabriquer
     * une valeur plutôt qu'une manière de mal écrire.
     *
     * - « Tu ne vois aucune valeur de cellule, et tu n'en demandes aucune » dit ce qu'il a, et lui
     *   ôte l'idée d'en réclamer davantage. La charge utile ne contient pas de cellules ; sans
     *   cette phrase, un modèle poli répondrait « donnez-moi un extrait ».
     * - Le JSON est décrit **par sa forme exacte**, avec ses clés, parce qu'une sortie qui dévie
     *   d'un caractère est jetée par le contrôle 0 — autant que la forme attendue soit sous ses
     *   yeux plutôt que devinée.
     * - « recopié CARACTÈRE POUR CARACTÈRE » est la condition de l'ancrage : un libellé
     *   reformulé, même mieux écrit, ne se retrouve pas dans l'envoi et fait tomber la réponse
     *   entière. La majuscule est là pour ça.
     * - « Si tu hésites, n'apparie pas cette colonne » donne la consigne UTILE : une absence se
     *   corrige d'un clic, une erreur se propage à tout le fichier.
     * - « Tu ne calcules rien » vaut ici comme ailleurs : l'IA n'entre jamais dans le calcul.
     */
    case 'column-mapping':
      return [
        'Tu apparies les colonnes d’un fichier de transactions à un schéma cible. Tu ne vois',
        'aucune valeur de cellule, et tu n’en demandes aucune.',
        'Tu réponds UNIQUEMENT par un objet JSON, sans texte avant ni après, sans commentaire,',
        'sans bloc de code, de la forme exacte :',
        '{"colonnes":[{"i":<entier>,"champ":"<nom du schéma cible>","confiance":<0 à 1>}],',
        ' "types":[{"libelle":"<repris tel quel>","cible":"<nom de type>"}]}',
        'Tout « i » est l’index d’une colonne fournie. Tout « champ » et tout « cible »',
        'appartiennent aux listes fournies. Tout « libelle » est recopié CARACTÈRE POUR',
        'CARACTÈRE depuis la liste fournie. Tu n’inventes ni index, ni nom, ni libellé.',
        'Un champ au plus par colonne, une colonne au plus par champ.',
        'Si tu hésites, n’apparie pas cette colonne : une absence se corrige, une erreur se',
        'propage à tout le fichier.',
        'Tu ne calcules rien, tu ne décris rien, tu ne conseilles rien.',
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
