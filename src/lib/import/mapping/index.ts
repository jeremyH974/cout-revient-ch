/**
 * Façade de l'appariement assisté (P64) : d'un CSV inconnu à des lignes pivot, par un appariement
 * **confirmé par l'utilisateur**.
 *
 * L'import lui-même n'a rien de particulier : `draftsToPivotRows` puis `ingestPivotRows`, comme
 * les huit convertisseurs natifs. Ce qui est nouveau est en amont — savoir quelle colonne est
 * quoi —, et cela ne franchit jamais cette fonction sans avoir été confirmé.
 */
import type { AccountId, EventId, Qualification, RawPivotRow, RowKey } from '../../domain/types';
import { parseCsvText } from '../csv';
import { draftsToPivotRows } from '../platforms/drafts';
import type { UsdRate } from '../pivot/events';
import { ingestPivotRows, type PivotImportResult } from '../pivot/index';
import { mappedDrafts } from './apply';
import { proposeMapping } from './propose';
import type { ConfirmedMapping } from './schema';

export { normalizeHeader, segmentGlued, type NormalizedHeader } from './normalize';
export {
  inferShape,
  readDecimalShape,
  VALUE_SHAPES,
  type ShapeInfo,
  type ValueShape,
} from './shape';
export {
  TARGET_SCHEMA,
  TARGET_FIELDS,
  targetSpec,
  isAdmissible,
  isMappingTarget,
  danglingHalves,
  type ConfirmedMapping,
  type MappingTarget,
  type TargetRole,
  type TargetSpec,
} from './schema';
export { SYNONYMS, SYNONYM_INDEX, BALANCE_SYNONYMS, isBalanceHeader } from './synonyms';
export {
  assign,
  bestRule,
  damerauLevenshtein,
  scorePairs,
  similarity,
  CANDIDATE_THRESHOLD,
  CONFIRM_THRESHOLD,
  COMPETITOR_PENALTY,
  FUZZY_THRESHOLD,
  MATCH_RULES,
  RULE_CAP,
  SHAPE_CONTRADICTION,
  type MatchRule,
  type ScoredPair,
} from './score';
export { matchTypeLabel, TYPE_TARGETS, TYPE_SYNONYMS } from './labels';
export {
  confirmedMapping,
  distinctValues,
  proposeMapping,
  type AssignmentRule,
  type ColumnAssignment,
  type MappingProposal,
  type MappingSource,
  type TypeAssignment,
  type UnsupportedForm,
} from './propose';
export { mappedDrafts, readAmount, readInstant } from './apply';
export {
  buildColumnMappingInput,
  filterTypeLabels,
  payloadKeysByLevel,
  MAX_TYPE_LABELS,
  MAX_TYPE_LABEL_LENGTH,
  PAYLOAD_KEYS,
  type BuiltMappingInput,
  type ColumnMappingInput,
  type MappingColumnInput,
  type MappingTargetInput,
} from './payload';
export {
  mergeModelMapping,
  MODEL_CONFIDENCE_CAP,
  type MergeReport,
  type ModelColumn,
  type ModelMapping,
  type ModelType,
} from './merge';
export {
  contextOf,
  firstFailure,
  verifyMapping,
  THRESHOLDS,
  type MappingCheck,
  type MappingCheckId,
  type MappingCheckStatus,
  type MappingVerdict,
  type VerifyContext,
} from './verify';

/**
 * Importe un CSV inconnu avec un appariement confirmé. Le format déclaré est `mapped-csv` : le
 * rapport doit dire que ce fichier a été lu par un appariement, pas par un convertisseur — c'est
 * ce qui permet de le distinguer plus tard, dans le journal des imports comme dans le diagnostic.
 */
export function importMappedCsv(
  text: string,
  mapping: ConfirmedMapping,
  existing: Record<RowKey, RawPivotRow>,
  accountId: AccountId,
  importId: string,
  usdRate: UsdRate,
  qualifications: Record<EventId, Qualification> = {},
): PivotImportResult {
  const table = parseCsvText(text);
  const { shapes } = proposeMapping(table);
  const conversion = mappedDrafts(table, mapping, shapes);
  const parsed = draftsToPivotRows(conversion.drafts, importId, accountId);
  return ingestPivotRows(
    { rows: parsed.rows, issues: [...conversion.issues, ...parsed.issues] },
    {
      format: 'mapped-csv',
      header: table.header,
      unknownColumns: table.header.filter(
        (_, index) => !Object.values(mapping.columns).includes(index),
      ),
      totalRows: table.rows.length,
      warnings: [],
    },
    existing,
    accountId,
    usdRate,
    qualifications,
  );
}
