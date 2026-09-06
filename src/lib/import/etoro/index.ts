/**
 * Import d'un relevé eToro : classeur → lignes pivot stockables. L'aval est le pipeline commun,
 * qui convertit les montants en dollars au taux BCE du jour de chaque opération et construit les
 * événements du grand livre.
 *
 * La clé de chaque ligne hache un contenu **natif et stable** (`etoro:open:<id>`,
 * `etoro:closed:buy/sell:<id>`) : réimporter le relevé du mois suivant, qui reprend tout
 * l'historique, ne crée aucun doublon (décisions n° 24 et 26).
 */
import type { AccountId } from '../../domain/types';
import { draftsToPivotRows } from '../platforms/drafts';
import type { ParsedPivotRows, PivotIssue } from '../pivot/rows';
import { readWorkbook } from '../xlsx/index';
import { convertEtoroWorkbook } from './convert';
import { detectEtoroWorkbook } from './sheets';

export { convertEtoroWorkbook, etoroDateToMs, leverageOf } from './convert';
export { detectEtoroWorkbook } from './sheets';
export type { EtoroConversion } from './convert';

export interface EtoroImport extends ParsedPivotRows {
  /** Positions volontairement hors modèle (effet de levier, contrats pour différence). */
  skipped: number;
}

export interface EtoroImportError {
  ok: false;
  error: string;
}

export type EtoroImportResult = ({ ok: true } & EtoroImport) | EtoroImportError;

/** Lit un classeur eToro et rend les lignes pivot prêtes à ingérer, ou dit pourquoi il ne peut pas. */
export async function importEtoroWorkbook(
  buffer: ArrayBuffer,
  importId: string,
  accountId: AccountId,
): Promise<EtoroImportResult> {
  let book;
  try {
    book = await readWorkbook(buffer);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Classeur illisible.' };
  }
  if (!detectEtoroWorkbook(book)) {
    return { ok: false, error: 'Ce classeur ne ressemble pas à un relevé eToro.' };
  }
  const conversion = convertEtoroWorkbook(book);
  const parsed = draftsToPivotRows(conversion.drafts, importId, accountId);
  const issues: PivotIssue[] = [...conversion.issues, ...parsed.issues];
  return { ok: true, rows: parsed.rows, issues, skipped: conversion.skipped };
}
