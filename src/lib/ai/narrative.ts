/**
 * Le récit narratif (P65) : la charge utile envoyée au modèle, et le pipeline **fixe** qui décide
 * si sa réponse a le droit d'être affichée. Module pur — ni DOM, ni réseau, ni horloge (l'appelant
 * fournit l'instant, comme partout ailleurs).
 *
 * ## Pourquoi les totaux sont dans l'entrée
 *
 * Le modèle n'a droit à aucune addition (décision n° 68) : si le texte cite un total, ce total
 * doit être une **ancre**, donc figurer dans le JSON qu'on lui a donné. L'alternative — le laisser
 * additionner deux constats — produirait un chiffre juste que le vérificateur refuserait, et la
 * seule manière de le faire passer serait d'autoriser l'arithmétique, c'est-à-dire de laisser
 * l'IA entrer dans le calcul. Les totaux sont donc dans l'entrée **par nécessité**, pas par
 * confort.
 *
 * ## Aucune constante de gabarit n'est accordée au modèle
 *
 * `auditText` accepte des `literals` : des nombres écrits en dur dans une phrase, déclarés par le
 * code appelant (le seuil de 305 €, la fenêtre de douze mois, le 100 % du repère — voir
 * `format/insights.ts`). C'est une dérogation réservée à **notre** rendu déterministe, dont les
 * gabarits sont relus et versionnés. L'accorder à un modèle reviendrait à blanchir d'avance un
 * nombre qu'il aurait inventé et qui tomberait, par chance, sur une constante déclarée. Ici, donc :
 * **aucun `literals`**.
 *
 * ## Le pipeline est fixe, et le refus jette le texte ENTIER
 *
 * appel → texte vide ? `empty` → lexique (les quatre domaines) → `forbidden-lexicon` → ancrage →
 * `unanchored` → étiquette. Une sortie partiellement valide n'est jamais publiée : afficher les
 * trois phrases ancrées d'un texte qui en comptait cinq, ce serait publier un résumé que personne
 * n'a écrit.
 *
 * L'ordre compte. Le lexique passe **avant** l'ancrage parce qu'une phrase de conseil parfaitement
 * ancrée reste une phrase de conseil : c'est le motif le plus grave, et c'est celui qu'on veut lire
 * dans le journal quand les deux échouent.
 */
import { ALL_LEXICONS, scanOutput } from '../format/lexicon';
import type { Currency } from '../fx/types';
import type { Insight, InsightValue } from '../domain/insights';
import type { DecimalString, NaiveDateTime } from '../domain/types';
import { auditText } from './anchor';
import {
  AI_REFUSALS,
  accept,
  buildRequest,
  label,
  refuse,
  type AiOutcome,
  type AiRefusal,
  type ModelAdapter,
} from './contract';

/** Un constat réduit à ce qui peut être raconté : son code, son ton, ses chiffres. */
export interface NarrativeInsight {
  readonly code: string;
  readonly tone: string;
  /** Valeurs à plat : chaînes décimales, compteurs, listes de codes d'actifs. */
  readonly values: Readonly<Record<string, string | number | readonly string[]>>;
}

/**
 * Les totaux du rapport. Chacun est une ANCRE : c'est ce qui autorise le modèle à citer un total
 * sans jamais l'avoir calculé. `valeur` peut manquer (aucun cours connu), et le champ est alors
 * absent de la charge plutôt que `null` — une ancre `null` n'existe pas, et un `null` dans le JSON
 * n'apprendrait rien au modèle.
 */
export interface NarrativeTotals {
  readonly valeur?: DecimalString;
  readonly investi: DecimalString;
  readonly latent: DecimalString;
  readonly realise: DecimalString;
  readonly total: DecimalString;
}

export interface NarrativeInput {
  readonly devise: Currency;
  /** Bornes de la période décrite, `AAAA-MM-JJ`. Les dates sont exclues du contrôle d'ancrage. */
  readonly periode: { readonly du: string; readonly au: string };
  readonly totaux: NarrativeTotals;
  readonly constats: readonly NarrativeInsight[];
}

/** Aplatit une valeur de constat : le JSON reste lisible, et chaque feuille devient une ancre. */
function flatten(value: InsightValue): string | number | readonly string[] {
  switch (value.kind) {
    case 'money':
    case 'ratio':
      return value.value;
    case 'count':
    case 'year':
      return value.value;
    case 'assets':
      return value.value;
    case 'day':
    case 'tier':
      return value.value;
    default: {
      const missing: never = value;
      throw new Error(`Valeur de constat sans aplatissement : ${JSON.stringify(missing)}`);
    }
  }
}

export interface NarrativeInputOptions {
  readonly devise: Currency;
  readonly periode: { readonly du: string; readonly au: string };
  readonly totaux: NarrativeTotals;
  readonly insights: readonly Insight[];
}

/**
 * La charge utile, et rien d'autre. Ce qui n'y figure pas ne peut pas partir : ni ligne
 * d'opération, ni lot, ni date d'opération, ni adresse, ni compte. La feuille de consentement
 * affiche exactement le résultat de cette fonction, réindenté.
 */
export function buildNarrativeInput(opts: NarrativeInputOptions): NarrativeInput {
  return {
    devise: opts.devise,
    periode: opts.periode,
    totaux: opts.totaux,
    constats: opts.insights.map((insight) => ({
      code: insight.code,
      tone: insight.tone,
      values: Object.fromEntries(
        Object.entries(insight.values).map(([key, value]) => [key, flatten(value)]),
      ),
    })),
  };
}

/** Découpe en phrases : le lexique rapporte alors un rang de phrase, pas un décalage de caractère. */
export const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?…:;])\s+/u);

/**
 * Le motif porté par une erreur d'adaptateur, ou `model-error`. Lu **en canard** : ce module
 * n'importe rien de `src/lib/net/`, et le harnais reste sans réseau jusque dans ses imports.
 * Un test du contrat vérifie que la lecture et l'écriture s'accordent de part et d'autre de cette
 * frontière — une duplication de trois lignes vaut mieux qu'un import qui la traverserait.
 */
export function refusalOfModelError(error: unknown): AiRefusal {
  const carried = (error as { aiRefusal?: unknown } | null)?.aiRefusal;
  return AI_REFUSALS.includes(carried as AiRefusal) ? (carried as AiRefusal) : 'model-error';
}

/**
 * Juge un texte déjà obtenu. Séparé de l'appel pour être rejouable hors ligne : c'est cette
 * fonction que le banc d'essai applique aux cassettes, et le script de capture à chacun de ses
 * trois tirages.
 *
 * `source` est le JSON réellement envoyé — la source des ancres. Il est typé `unknown` parce que
 * c'est ce que `auditText` demande : le jugement ne dépend d'aucune forme particulière, seulement
 * des feuilles décimales qu'il y trouve.
 */
export function judgeNarrative(
  text: string,
  source: unknown,
  modelId: string,
  at: NaiveDateTime,
): AiOutcome<string> {
  if (text.trim() === '') return refuse<string>('narrative', 'empty');
  // Le lexique d'abord : une phrase de conseil parfaitement ancrée reste une phrase de conseil.
  if (scanOutput(sentencesOf(text), ALL_LEXICONS).length > 0)
    return refuse<string>('narrative', 'forbidden-lexicon');
  // Aucun `literals` : les constantes de gabarit sont une dérogation réservée à notre rendu.
  return accept('narrative', text, label(modelId, at), auditText(text, source));
}

/**
 * Le récit, du premier appel à l'étiquette. `adapter === null` — pas de clé, ou consentement
 * refusé — est un refus `no-model` comme un autre : l'appelant n'a jamais à distinguer « je n'ai
 * pas appelé » de « l'appel n'a rien donné », il affiche le repli dans les deux cas.
 */
export async function runNarrative(
  adapter: ModelAdapter | null,
  input: NarrativeInput,
  at: NaiveDateTime,
): Promise<AiOutcome<string>> {
  if (adapter === null) return refuse<string>('narrative', 'no-model');
  try {
    const reply = await adapter.complete(buildRequest('narrative', input));
    return judgeNarrative(reply.text, input, reply.modelId, at);
  } catch (error) {
    return refuse<string>('narrative', refusalOfModelError(error));
  }
}
