/**
 * Assemble les parties d'un `.xlsx` en feuilles de texte. Trois parties suffisent : le classeur
 * (noms et ordre des feuilles), sa table de relations (où trouver chaque feuille) et la table des
 * chaînes partagées. Styles, thèmes et tables mises en forme sont ignorés.
 *
 * Toute valeur est rendue **en texte, telle qu'écrite dans le fichier** : ni arrondi, ni
 * conversion, ni interprétation de date. C'est au convertisseur de plateforme d'y donner un sens —
 * la règle du dépôt veut qu'aucun `number` ne porte un montant.
 */
import { decodeXmlText, elements, joinText, type XmlElement } from './xml';
import { unzipText } from './unzip';

export interface SheetData {
  name: string;
  /** Lignes de cellules. Une cellule absente, vide ou hors plage vaut la chaîne vide. */
  rows: string[][];
}

export interface Workbook {
  sheets: SheetData[];
}

export class WorkbookError extends Error {}

/** `A` → 0, `B` → 1, `AA` → 26. Rend −1 si la référence ne commence pas par une lettre. */
export function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) n = n * 26 + (code - 64);
    else if (code >= 97 && code <= 122) n = n * 26 + (code - 96);
    else break;
  }
  return n - 1;
}

/**
 * Date sérielle Excel → horodatage naïf `YYYY-MM-DDTHH:mm:ss`. L'époque est le 30/12/1899, décalage
 * qui absorbe le bug historique d'Excel tenant 1900 pour bissextile. Rend `null` hors du domaine
 * où ce décalage vaut (Excel ne représente pas les dates antérieures à mars 1900 correctement).
 */
export function excelSerialToNaive(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 61) return null;
  const ms = Math.round((serial - 25569) * 86_400_000);
  const at = new Date(ms);
  if (Number.isNaN(at.getTime())) return null;
  return at.toISOString().slice(0, 19);
}

/** Chemin interne d'une partie référencée : les cibles eToro sont absolues (`/xl/worksheets/…`). */
function resolvePart(target: string): string {
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
}

function cellText(cell: XmlElement, shared: readonly string[]): string {
  const type = cell.attrs['t'] ?? 'n';
  if (type === 'inlineStr') return joinText(cell.inner);
  const value = elements(cell.inner, 'v')[0];
  if (!value) return '';
  const raw = decodeXmlText(value.inner);
  if (type !== 's') return raw;
  const index = Number.parseInt(raw, 10);
  return Number.isFinite(index) ? (shared[index] ?? '') : '';
}

/** Une ligne creuse ne décale pas les colonnes : chaque cellule est posée à son propre index. */
function parseSheet(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const row of elements(xml, 'row')) {
    const cells: string[] = [];
    for (const cell of elements(row.inner, 'c')) {
      const column = columnIndex(cell.attrs['r'] ?? '');
      const text = cellText(cell, shared);
      if (column < 0) cells.push(text);
      else {
        while (cells.length < column) cells.push('');
        cells[column] = text;
      }
    }
    const at = Number.parseInt(row.attrs['r'] ?? '', 10);
    if (!Number.isFinite(at) || at < 1) rows.push(cells);
    else {
      while (rows.length < at - 1) rows.push([]);
      rows[at - 1] = cells;
    }
  }
  return rows;
}

export async function readWorkbook(buffer: ArrayBuffer): Promise<Workbook> {
  const parts = await unzipText(buffer);
  const book = parts.get('xl/workbook.xml');
  if (!book)
    throw new WorkbookError("Ce fichier n'est pas un classeur : `xl/workbook.xml` absent.");

  const targets = new Map<string, string>();
  for (const rel of elements(parts.get('xl/_rels/workbook.xml.rels') ?? '', 'Relationship')) {
    const id = rel.attrs['Id'];
    const target = rel.attrs['Target'];
    if (id && target) targets.set(id, resolvePart(target));
  }

  const shared = elements(parts.get('xl/sharedStrings.xml') ?? '', 'si').map((si) =>
    joinText(si.inner),
  );

  const sheets: SheetData[] = [];
  for (const sheet of elements(book, 'sheet')) {
    const name = sheet.attrs['name'];
    const path = targets.get(sheet.attrs['r:id'] ?? '');
    const xml = path ? parts.get(path) : undefined;
    if (!name || xml === undefined) continue;
    sheets.push({ name, rows: parseSheet(xml, shared) });
  }
  if (sheets.length === 0) throw new WorkbookError('Classeur sans aucune feuille lisible.');
  return { sheets };
}
