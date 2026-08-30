/**
 * La cible typée de l'appariement assisté (P64) : les **douze champs pivot existants**, chacun
 * avec son rôle et les formes de valeur qu'il admet.
 *
 * Aucun treizième champ n'est inventé. La cible est celle que `parsePivotRows` et
 * `draftsToPivotRows` consomment déjà (`PivotField`, `src/lib/import/pivot/detect.ts`) : tout ce
 * que produit cet appariement retombe donc dans le pipeline pivot inchangé — valorisation EUR,
 * « à qualifier », virements appariés, moteur. Ajouter une cible reviendrait à ajouter une
 * sémantique que rien, en aval, ne saurait lire.
 *
 * ## Trois rôles, et ils ne se valent pas
 *
 * - `required` — sans lui, il n'y a pas de ligne (`date`).
 * - `paired` — un montant et sa devise ne s'appareillent qu'ENSEMBLE. Une quantité sans son unité
 *   n'est pas une demi-information, c'est un chiffre faux en puissance : le contrôle
 *   d'admissibilité exige la paire complète, jamais l'une des deux moitiés.
 * - `optional` — utile, jamais nécessaire (frais, contre-valeur, étiquette, description, hachage).
 *
 * ## La forme non prise en charge est NOMMÉE
 *
 * La v1 n'écrit que des paires envoyé/reçu (`two-legs`). Un fichier à **montant unique signé**
 * (négatif pour une sortie, positif pour une entrée) est reconnu — `shape.ts` le classe
 * `signed-decimal` — et refusé **en le disant**, plutôt que par un « format non reconnu ».
 * Les convertisseurs natifs (Kraken, Bitvavo…) traitent déjà cette forme pour les plateformes qui
 * l'emploient ; la reproduire ici doublerait le périmètre pour un gain marginal.
 */
import type { PivotField } from '../pivot/detect';
import type { ValueShape } from './shape';

/** La cible d'un appariement : exactement les champs pivot, ni plus, ni moins. */
export type MappingTarget = PivotField;

export type TargetRole = 'required' | 'paired' | 'optional';

export interface TargetSpec {
  readonly field: MappingTarget;
  readonly role: TargetRole;
  /** Formes admises pour ce champ ; une forme hors de cette liste PÉNALISE, elle n'interdit pas. */
  readonly shapes: readonly ValueShape[];
  /** Le champ jumeau : montant ↔ devise. Absent pour les champs qui vont seuls. */
  readonly pairedWith?: MappingTarget;
}

const TIME: readonly ValueShape[] = ['iso-datetime', 'dmy-datetime', 'epoch-s', 'epoch-ms'];
const AMOUNT: readonly ValueShape[] = ['decimal-dot', 'decimal-comma', 'signed-decimal'];
/**
 * Une colonne de devise est le plus souvent `asset-code` ; elle retombe en `enum-small` quand ses
 * tickers sont absents de la table de l'app (voir `shape.ts`). Les deux sont donc admises : perdre
 * le signal ne doit jamais fermer la possibilité.
 */
const CURRENCY: readonly ValueShape[] = ['asset-code', 'enum-small'];
const TEXT: readonly ValueShape[] = ['free-text', 'enum-small', 'asset-code'];

/**
 * L'ordre de déclaration est **stable et significatif** : il départage les égalités de score dans
 * l'affectation gloutonne (`score.ts`). Les champs qui portent le sens de l'opération viennent
 * donc avant ceux qui l'annotent.
 */
export const TARGET_SCHEMA: readonly TargetSpec[] = [
  { field: 'date', role: 'required', shapes: TIME },
  { field: 'sentAmount', role: 'paired', shapes: AMOUNT, pairedWith: 'sentCurrency' },
  { field: 'sentCurrency', role: 'paired', shapes: CURRENCY, pairedWith: 'sentAmount' },
  { field: 'receivedAmount', role: 'paired', shapes: AMOUNT, pairedWith: 'receivedCurrency' },
  { field: 'receivedCurrency', role: 'paired', shapes: CURRENCY, pairedWith: 'receivedAmount' },
  { field: 'feeAmount', role: 'optional', shapes: AMOUNT, pairedWith: 'feeCurrency' },
  { field: 'feeCurrency', role: 'optional', shapes: CURRENCY, pairedWith: 'feeAmount' },
  { field: 'netWorthAmount', role: 'optional', shapes: AMOUNT, pairedWith: 'netWorthCurrency' },
  {
    field: 'netWorthCurrency',
    role: 'optional',
    shapes: CURRENCY,
    pairedWith: 'netWorthAmount',
  },
  { field: 'label', role: 'optional', shapes: ['enum-small', 'free-text', 'asset-code'] },
  { field: 'description', role: 'optional', shapes: TEXT },
  { field: 'txHash', role: 'optional', shapes: ['hash-hex', 'free-text'] },
];

export const TARGET_FIELDS: readonly MappingTarget[] = TARGET_SCHEMA.map((t) => t.field);

const BY_FIELD = new Map<MappingTarget, TargetSpec>(TARGET_SCHEMA.map((t) => [t.field, t]));

export function targetSpec(field: MappingTarget): TargetSpec {
  const spec = BY_FIELD.get(field);
  if (spec === undefined) throw new Error(`Champ cible inconnu : ${String(field)}`);
  return spec;
}

export const isMappingTarget = (value: unknown): value is MappingTarget =>
  typeof value === 'string' && BY_FIELD.has(value as MappingTarget);

/** Un appariement confirmé : les colonnes retenues, et la traduction des libellés de type. */
export interface ConfirmedMapping {
  /** Champ → index de colonne dans l'en-tête du fichier. */
  readonly columns: Partial<Record<MappingTarget, number>>;
  /** Libellé du fichier (minuscules, verbatim) → étiquette pivot (`reward`, `fee`, `gift`…). */
  readonly typeLabels: Readonly<Record<string, string>>;
  /**
   * Devise portée par l'EN-TÊTE plutôt que par une colonne : `Contre-valeur (EUR)`,
   * `Gross Amount (EUR)`, `Montant (USD)`. Clé = le champ de devise, valeur = le code lu.
   *
   * Sans cela, un montant dont la devise est dans le titre serait « un montant sans devise » et sa
   * ligne entière partirait à la poubelle — sur des fichiers où l'information est pourtant là,
   * lisible, à quelques caractères de son montant. Une colonne de devise réelle l'emporte
   * toujours : l'indice ne comble qu'un trou.
   */
  readonly impliedCurrencies?: Readonly<Partial<Record<MappingTarget, string>>>;
}

/** `date` et une paire complète : le minimum sans lequel aucune ligne ne peut être écrite. */
export function isAdmissible(columns: ConfirmedMapping['columns']): boolean {
  if (columns.date === undefined) return false;
  const sent = columns.sentAmount !== undefined && columns.sentCurrency !== undefined;
  const received = columns.receivedAmount !== undefined && columns.receivedCurrency !== undefined;
  return sent || received;
}

/**
 * Un montant sans sa devise (ou l'inverse) : la moitié de paire qui manque, s'il y en a une. Une
 * devise portée par l'en-tête (`Contre-valeur (EUR)`) comble le trou et n'est donc pas signalée.
 */
export function danglingHalves(
  columns: ConfirmedMapping['columns'],
  implied: ConfirmedMapping['impliedCurrencies'] = {},
): MappingTarget[] {
  const missing: MappingTarget[] = [];
  for (const spec of TARGET_SCHEMA) {
    if (spec.pairedWith === undefined) continue;
    if (
      columns[spec.field] !== undefined &&
      columns[spec.pairedWith] === undefined &&
      implied[spec.pairedWith] === undefined
    )
      missing.push(spec.pairedWith);
  }
  return missing;
}
