/** Lecture CSV tolérante (BOM, CRLF, délimiteur auto, champs entre guillemets) via PapaParse. */
import Papa from 'papaparse';

export interface CsvTable {
  header: string[];
  rows: string[][];
  /** Numéro de ligne (1 = en-tête) de chaque entrée de `rows` dans le fichier d'origine. */
  lineNumbers: number[];
  delimiter: string;
}

export function parseCsvText(text: string): CsvTable {
  const clean = text.replace(/^\uFEFF/, '');
  const result = Papa.parse<string[]>(clean, {
    delimiter: '', // détection automatique (, ; tab |)
    dynamicTyping: false,
    skipEmptyLines: false,
    header: false,
  });
  const rows: string[][] = [];
  const lineNumbers: number[] = [];
  let header: string[] = [];
  let headerSeen = false;
  result.data.forEach((row, index) => {
    if (!row.some((cell) => cell.trim() !== '')) return;
    if (!headerSeen) {
      header = row.map((cell) => cell.trim());
      headerSeen = true;
      return;
    }
    rows.push(row);
    lineNumbers.push(index + 1);
  });
  return { header, rows, lineNumbers, delimiter: result.meta.delimiter ?? ',' };
}
