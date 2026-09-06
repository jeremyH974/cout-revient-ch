/**
 * Accès aux feuilles et colonnes d'un relevé eToro, **par alias bilingues**.
 *
 * Le relevé est localisé, et de façon incohérente : les onglets portent des noms français, mais
 * « Holdings » et toutes ses colonnes restent en anglais. Le même concept change de langue d'une
 * feuille à l'autre — `Stocks` dans Holdings, `Actions` dans Positions fermées. Une détection
 * calée sur une seule langue trouverait un classeur vide chez la moitié des utilisateurs.
 *
 * Les en-têtes portent aussi des sauts de ligne (« Montant⏎ en (USD) », encodés `_x000a_`) : la
 * comparaison normalise donc tous les blancs avant de chercher.
 */
import type { SheetData, Workbook } from '../xlsx/index';

export interface EtoroSheet {
  name: string;
  header: string[];
  rows: string[][];
}

/** Minuscules, blancs unifiés, bords rognés : la forme sous laquelle alias et en-têtes se comparent. */
export function canon(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Noms d'onglets acceptés, français puis anglais. */
export const SHEET_ALIASES = {
  holdings: ['holdings', 'positions ouvertes'],
  closed: ['positions fermées', 'closed positions'],
  activity: ['activité du compte', 'account activity'],
  dividends: ['dividendes', 'dividends'],
} as const;

function matches(sheet: SheetData, aliases: readonly string[]): boolean {
  const name = canon(sheet.name);
  return aliases.some((alias) => name === alias);
}

/** Première feuille dont le nom correspond à l'un des alias, en-tête séparé du corps. */
export function findSheet(book: Workbook, aliases: readonly string[]): EtoroSheet | null {
  const sheet = book.sheets.find((s) => matches(s, aliases));
  if (!sheet || sheet.rows.length < 1) return null;
  const [header = [], ...rows] = sheet.rows;
  return { name: sheet.name, header: header.map(canon), rows };
}

/** Index de la première colonne portant l'un des alias ; −1 si aucune. */
export function columnOf(header: readonly string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const at = header.indexOf(canon(alias));
    if (at !== -1) return at;
  }
  return -1;
}

/**
 * Lecteur de colonnes d'une feuille : rend la chaîne vide pour une colonne absente, et traite le
 * tiret isolé comme une absence de valeur — eToro l'emploie pour « sans objet », jamais pour zéro.
 */
export function reader(sheet: EtoroSheet, columns: Record<string, readonly string[]>) {
  const index: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(columns))
    index[key] = columnOf(sheet.header, aliases);
  return {
    index,
    missing: Object.entries(index)
      .filter(([, at]) => at === -1)
      .map(([key]) => key),
    get(row: readonly string[], key: string): string {
      const at = index[key];
      if (at === undefined || at === -1) return '';
      const value = (row[at] ?? '').trim();
      return value === '-' ? '' : value;
    },
  };
}

/** Un classeur est un relevé eToro s'il porte au moins les positions ouvertes et l'activité. */
export function detectEtoroWorkbook(book: Workbook): boolean {
  return (
    findSheet(book, SHEET_ALIASES.holdings) !== null &&
    findSheet(book, SHEET_ALIASES.activity) !== null
  );
}
