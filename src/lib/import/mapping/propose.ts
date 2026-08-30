/**
 * La proposition déterministe (P64) — **la voie qui compte**.
 *
 * C'est celle que 100 % des utilisateurs auront : elle fonctionne sans clé, sans réseau, sans
 * modèle. Le modèle, quand il existe, ne fait que **combler ses trous** (`verify.ts`, contrôle 5) ;
 * il ne peut jamais écraser ce que cette fonction a décidé avec confiance.
 *
 * Elle ne décide d'ailleurs rien seule : elle **propose**. Rien n'est importé sans confirmation
 * ligne à ligne, avec la confiance et la provenance de chaque appariement affichées.
 */
import { isFiat, normalizeAssetCode } from '../../domain/assets';
import { tickerInfo } from '../../pricing/tickers';
import type { CsvTable } from '../csv';
import { normalizeHeader, type NormalizedHeader } from './normalize';
import { matchTypeLabel } from './labels';
import { assign, scorePairs, type MatchRule } from './score';
import {
  danglingHalves,
  isAdmissible,
  TARGET_SCHEMA,
  type ConfirmedMapping,
  type MappingTarget,
} from './schema';
import { inferShape, type ShapeInfo } from './shape';
import { isBalanceHeader } from './synonyms';

/** D'où vient un appariement : la voie déterministe, ou une proposition du modèle. */
export type MappingSource = 'deterministic' | 'model';

/** Ce qui a produit un appariement : une des quatre règles, ou la proposition d'un modèle. */
export type AssignmentRule = MatchRule | 'model';

export interface ColumnAssignment {
  readonly column: number;
  readonly field: MappingTarget;
  readonly confidence: number;
  readonly rule: AssignmentRule;
  readonly source: MappingSource;
}

export interface TypeAssignment {
  /** Le libellé du fichier, en minuscules — jamais réécrit : c'est lui qu'on montre. */
  readonly value: string;
  /** L'étiquette pivot retenue, ou `null` : un libellé non traduit passe tel quel. */
  readonly target: string | null;
  readonly confidence: number;
  readonly rule: AssignmentRule | null;
  readonly source: MappingSource;
}

/**
 * La forme que la v1 ne traite pas, **nommée**. `signed-single-leg` : un fichier à montant unique
 * signé (négatif pour une sortie, positif pour une entrée). Reconnue et refusée en le disant,
 * plutôt qu'un « format non reconnu » qui n'apprendrait rien.
 */
export type UnsupportedForm = 'signed-single-leg';

export interface MappingProposal {
  readonly headers: readonly NormalizedHeader[];
  readonly shapes: readonly ShapeInfo[];
  readonly columns: readonly ColumnAssignment[];
  /** Libellés distincts de la colonne de type retenue, appariés. Vide sans colonne de type. */
  readonly typeLabels: readonly TypeAssignment[];
  /** Devises lues dans un en-tête plutôt que dans une colonne (`Contre-valeur (EUR)`). */
  readonly impliedCurrencies: Readonly<Partial<Record<MappingTarget, string>>>;
  /** Colonne de solde du fichier, s'il en porte une (`verify.ts`, contrôle 4d). */
  readonly balanceColumn: number | null;
  readonly unsupported: UnsupportedForm | null;
  /** Vrai si l'appariement pré-coché suffit à écrire des lignes (`date` + une paire complète). */
  readonly admissible: boolean;
  /** Moitiés de paire orphelines : un montant sans sa devise, ou l'inverse. */
  readonly dangling: readonly MappingTarget[];
}

/** Au plus autant de valeurs distinctes rapportées pour la colonne de type. */
const MAX_TYPE_VALUES = 200;

const columnCells = (table: CsvTable, index: number): string[] =>
  table.rows.map((row) => row[index] ?? '');

/** Valeurs distinctes d'une colonne, en minuscules, dans l'ordre de première apparition. */
export function distinctValues(table: CsvTable, index: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of table.rows) {
    const value = (row[index] ?? '').trim().toLowerCase();
    if (value === '' || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_TYPE_VALUES) break;
  }
  return out;
}

export function proposeMapping(table: CsvTable): MappingProposal {
  const headers = table.header.map((h) => normalizeHeader(h));
  const shapes = headers.map((_, index) => inferShape(columnCells(table, index)));
  const columns: ColumnAssignment[] = assign(scorePairs(headers, shapes)).map((pair) => ({
    column: pair.column,
    field: pair.field,
    confidence: pair.confidence,
    rule: pair.rule,
    source: 'deterministic',
  }));

  const byField = new Map(columns.map((c) => [c.field, c]));
  const labelColumn = byField.get('label')?.column ?? null;
  const typeLabels: TypeAssignment[] =
    labelColumn === null
      ? []
      : distinctValues(table, labelColumn).map((value) => {
          const match = matchTypeLabel(value);
          return match === null
            ? { value, target: null, confidence: 0, rule: null, source: 'deterministic' as const }
            : {
                value,
                target: match.target,
                confidence: match.confidence,
                rule: match.rule,
                source: 'deterministic' as const,
              };
        });

  const balanceColumn = headers.findIndex((h) => isBalanceHeader(h.text));
  const mapped: Partial<Record<MappingTarget, number>> = {};
  for (const column of columns) mapped[column.field] = column.column;
  const impliedCurrencies = readImpliedCurrencies(headers, mapped);

  /*
   * La forme non prise en charge se reconnaît à UNE jambe de montant, signée. Le cas est plus
   * dangereux que l'absence d'appariement : une colonne signée affectée à `sentAmount` produirait
   * un fichier entier de sorties, dont les entrées auraient changé de sens sans qu'aucun contrôle
   * de forme ne s'en aperçoive. On le dit avant d'importer, jamais après.
   */
  const amountColumns = (['sentAmount', 'receivedAmount'] as const)
    .map((field) => mapped[field])
    .filter((column): column is number => column !== undefined);
  const signedSomewhere = shapes.some((s) => s.shape === 'signed-decimal');
  const singleSignedLeg =
    amountColumns.length === 1 && shapes[amountColumns[0]!]?.shape === 'signed-decimal';
  const admissible = isAdmissible(mapped);
  const unsupported: UnsupportedForm | null =
    singleSignedLeg || (!admissible && signedSomewhere) ? 'signed-single-leg' : null;

  return {
    headers,
    shapes,
    columns,
    typeLabels,
    impliedCurrencies,
    balanceColumn: balanceColumn >= 0 ? balanceColumn : null,
    unsupported,
    admissible,
    dangling: danglingHalves(mapped, impliedCurrencies),
  };
}

/**
 * Les devises portées par un en-tête plutôt que par une colonne : `Contre-valeur (EUR)`,
 * `Gross Amount (EUR)`. L'indice entre parenthèses n'est retenu que s'il **nomme un actif connu**
 * — sans quoi `Date (UTC)` déclarerait une devise « utc », et `Montant (CCY)` une devise « ccy ».
 * Un indice qu'on ne sait pas lire ne devient jamais une donnée.
 */
function readImpliedCurrencies(
  headers: readonly NormalizedHeader[],
  mapped: Partial<Record<MappingTarget, number>>,
): Partial<Record<MappingTarget, string>> {
  const implied: Partial<Record<MappingTarget, string>> = {};
  for (const spec of TARGET_SCHEMA) {
    if (spec.pairedWith === undefined) continue;
    const currencyField = spec.pairedWith;
    if (!currencyField.endsWith('Currency')) continue;
    const amountColumn = mapped[spec.field];
    if (amountColumn === undefined || mapped[currencyField] !== undefined) continue;
    const hints = headers[amountColumn]?.hints ?? [];
    for (const hint of hints) {
      const code = normalizeAssetCode(hint);
      if (isFiat(code) || tickerInfo(code) !== null) {
        implied[currencyField] = code.toUpperCase();
        break;
      }
    }
  }
  return implied;
}

/**
 * Ce que l'écran pré-coche : les appariements retenus, avec leur traduction de libellés. La
 * confiance ne filtre PAS ici — un appariement à 0,55 est pré-affiché avec sa mention « à
 * confirmer », parce que le cacher obligerait l'utilisateur à le retrouver seul.
 */
export function confirmedMapping(proposal: MappingProposal): ConfirmedMapping {
  const columns: Partial<Record<MappingTarget, number>> = {};
  for (const assignment of proposal.columns) columns[assignment.field] = assignment.column;
  const typeLabels: Record<string, string> = {};
  for (const label of proposal.typeLabels)
    if (label.target !== null) typeLabels[label.value] = label.target;
  return { columns, typeLabels, impliedCurrencies: proposal.impliedCurrencies };
}
