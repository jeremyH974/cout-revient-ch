/**
 * Les qualifications enregistrées, rattachées aux lignes brutes qu'elles réinterprètent
 * (décision n° 94).
 *
 * C'est ce rattachement qui permet d'annuler une qualification depuis l'écran « À qualifier » : on
 * ne montre pas un identifiant technique à l'utilisateur, on lui montre la date, le libellé et les
 * numéros de ligne de ce qu'il avait qualifié.
 *
 * Deux origines coexistent et **ne se rattachent pas de la même façon** : une ligne pivot porte
 * elle-même son instant et son numéro, tandis qu'une opération Coinhouse peut s'étaler sur
 * plusieurs lignes qu'il faut retrouver par préfixe (`ch:`) puis trier. La règle vivait dans un
 * `$derived` qu'aucun test n'atteignait.
 */
import type { EventId, Qualification, RawCoinhouseRow, RawPivotRow } from '../domain/types';

export interface QualifiedSummary {
  eventId: EventId;
  qualification: Qualification;
  at: string | null;
  rawType: string | null;
  lineNumbers: number[];
}

export function qualifiedSummaries(
  qualifications: Readonly<Record<EventId, Qualification>>,
  pivotRows: Readonly<Record<string, RawPivotRow>>,
  rawRows: Readonly<Record<string, RawCoinhouseRow>>,
): QualifiedSummary[] {
  const rows = Object.values(rawRows);
  return Object.entries(qualifications).map(([eventId, qualification]) => {
    const pivotRow = pivotRows[eventId];
    if (pivotRow)
      return {
        eventId,
        qualification,
        at: pivotRow.at,
        rawType: pivotRow.label ?? 'ligne pivot',
        lineNumbers: pivotRow.lineNo > 0 ? [pivotRow.lineNo] : [],
      };
    // Une opération Coinhouse peut occuper plusieurs lignes du fichier : on les rassemble toutes,
    // dans l'ordre du fichier, pour que l'utilisateur retrouve ce qu'il a sous les yeux.
    const own = rows
      .filter((r) => (r.id ? `ch:${r.id}` === eventId : `ch:${r.key}` === eventId))
      .sort((a, b) => a.lineNo - b.lineNo);
    return {
      eventId,
      qualification,
      at: own[0]?.at ?? null,
      rawType: own[0]?.type ?? null,
      lineNumbers: own.map((r) => r.lineNo).filter((n) => n > 0),
    };
  });
}
