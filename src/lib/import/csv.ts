/** Lecture CSV tolérante (BOM, CRLF, délimiteur auto, champs entre guillemets) via PapaParse. */
import Papa from 'papaparse';

export interface CsvTable {
  header: string[];
  rows: string[][];
  delimiter: string;
}

export function parseCsvText(text: string): CsvTable {
  const clean = text.replace(/^\uFEFF/, '');
  const result = Papa.parse<string[]>(clean, {
    delimiter: '', // détection automatique (, ; tab |)
    dynamicTyping: false,
    skipEmptyLines: 'greedy',
    header: false,
  });
  const data = result.data.filter((row) => row.some((cell) => cell.trim() !== ''));
  const [first, ...rows] = data;
  return {
    header: (first ?? []).map((cell) => cell.trim()),
    rows,
    delimiter: result.meta.delimiter ?? ',',
  };
}
