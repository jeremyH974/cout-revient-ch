/**
 * Registre des convertisseurs natifs + façade `importAnyCsv` : détecte pivot Koinly/Waltio puis
 * chaque plateforme, convertit vers des lignes pivot (clé = contenu natif, décision n° 26) et
 * réutilise l'ingestion commune. Coinhouse est essayé AVANT par l'écran d'import.
 */
import type { AccountId, EventId, Qualification, RawPivotRow, RowKey } from '../../domain/types';
import { parseCsvText } from '../csv';
import { detectPivotFormat } from '../pivot/detect';
import type { UsdRate } from '../pivot/events';
import {
  importPivotCsv,
  ingestPivotRows,
  type ImportedFormat,
  type PivotImportResult,
} from '../pivot/index';
import { binance } from './binance';
import { bitpanda } from './bitpanda';
import { bitvavo } from './bitvavo';
import { coinbase } from './coinbase';
import { draftsToPivotRows } from './drafts';
import { krakenLedgers } from './kraken';
import { ledgerLive } from './ledgerlive';
import { revolut } from './revolut';
import { swissborg } from './swissborg';
import type { PlatformConverter } from './types';

export const PLATFORM_CONVERTERS: readonly PlatformConverter[] = [
  krakenLedgers,
  coinbase,
  bitvavo,
  ledgerLive,
  revolut,
  binance,
  bitpanda,
  swissborg,
];

/** Libellés d'affichage des formats reconnus. */
export const FORMAT_LABELS: Record<ImportedFormat, string> = {
  'koinly-universal': 'CSV pivot Koinly « Universal »',
  'koinly-export': 'Export Koinly (From/To)',
  'kraken-ledgers': 'Kraken — ledgers.csv',
  'revolut-crypto': 'Revolut — relevé crypto',
  coinbase: 'Coinbase — relevé de transactions',
  bitvavo: 'Bitvavo — historique de transactions',
  'ledger-live': 'Ledger Live — historique des opérations',
  binance: 'Binance — historique (Statements ou Trade History)',
  bitpanda: 'Bitpanda — export de l’historique',
  swissborg: 'SwissBorg — relevé de compte',
  'ghostfolio-json': 'Ghostfolio — export JSON',
  'onchain-sync': 'Synchronisation on-chain',
  'mapped-csv': 'CSV apparié colonne par colonne',
};

/** Formats CSV acceptés par l'écran d'import (message d'erreur). */
export const ACCEPTED_FORMATS_HINT =
  'Formats acceptés : export Coinhouse, CSV pivot Koinly/Waltio (Universal ou From/To), ' +
  'Kraken (ledgers.csv), Revolut (relevé crypto), Coinbase (relevé de transactions), Bitvavo, ' +
  'Ledger Live, Binance (Statements ou Trade History), Bitpanda et SwissBorg, et JSON Ghostfolio. ' +
  'Tout autre CSV passe par l’appariement de colonnes, que vous confirmez avant l’import (P64).';

export function importAnyCsv(
  text: string,
  existing: Record<RowKey, RawPivotRow>,
  accountId: AccountId,
  importId: string,
  usdRate: UsdRate,
  qualifications: Record<EventId, Qualification> = {},
): PivotImportResult {
  const table = parseCsvText(text);
  if (detectPivotFormat(table.header).ok)
    return importPivotCsv(text, existing, accountId, importId, usdRate, qualifications);
  for (const converter of PLATFORM_CONVERTERS) {
    if (!converter.detect(table.header)) continue;
    const conversion = converter.convert(table);
    const parsed = draftsToPivotRows(conversion.drafts, importId, accountId);
    return ingestPivotRows(
      { rows: parsed.rows, issues: [...conversion.issues, ...parsed.issues] },
      {
        format: converter.id,
        header: table.header,
        unknownColumns: [],
        totalRows: table.rows.length,
        skippedInternal: conversion.skippedInternal,
      },
      existing,
      accountId,
      usdRate,
      qualifications,
    );
  }
  return {
    ok: false,
    error: 'Format de fichier non reconnu.',
    details: [
      ACCEPTED_FORMATS_HINT,
      `Colonnes trouvées : ${table.header.join(', ') || '(aucune)'}.`,
    ],
    header: table.header,
  };
}
