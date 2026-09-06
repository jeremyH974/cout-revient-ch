import { describe, expect, it } from 'vitest';
import { columnIndex, excelSerialToNaive, readWorkbook, WorkbookError } from './workbook';
import { ZipError } from './unzip';

/**
 * Construit un `.xlsx` en mémoire, entrées **stockées** (méthode 0) : aucun binaire n'entre dans le
 * dépôt, et le test décrit lui-même la forme qu'il attend. Le CRC est laissé à zéro — le lecteur ne
 * le vérifie pas, et ce test le documente autant qu'il l'exploite.
 */
function makeXlsx(files: Record<string, string>): ArrayBuffer {
  const enc = new TextEncoder();
  const entries = Object.entries(files).map(([name, text]) => ({
    name: enc.encode(name),
    data: enc.encode(text),
  }));
  const total = entries.reduce((n, e) => n + 76 + e.name.length * 2 + e.data.length, 22);
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const offsets: number[] = [];
  let at = 0;
  for (const entry of entries) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.data.length, true);
    view.setUint16(at + 26, entry.name.length, true);
    bytes.set(entry.name, at + 30);
    bytes.set(entry.data, at + 30 + entry.name.length);
    at += 30 + entry.name.length + entry.data.length;
  }
  const directoryAt = at;
  entries.forEach((entry, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, entry.name.length, true);
    view.setUint32(at + 42, offsets[i]!, true);
    bytes.set(entry.name, at + 46);
    at += 46 + entry.name.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - directoryAt, true);
  view.setUint32(at + 16, directoryAt, true);
  return buffer.slice(0, at + 22);
}

// Toutes les parties portent le préfixe `x:`, comme le relevé eToro, et des cibles absolues.
const RELS =
  '<Relationships><Relationship Id="rId2" Target="/xl/worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId9" Target="/xl/sharedStrings.xml"/></Relationships>';
const BOOK =
  '<x:workbook><x:sheets><x:sheet name="Holdings" sheetId="1" r:id="rId2"/></x:sheets></x:workbook>';
const SHARED =
  '<x:sst><x:si><x:t>Asset</x:t></x:si><x:si><x:t>ISIN</x:t></x:si>' +
  '<x:si><x:r><x:t>Crypto </x:t></x:r><x:r><x:t>Currencies</x:t></x:r></x:si></x:sst>';
const SHEET =
  '<x:worksheet><x:sheetData>' +
  '<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="s"><x:v>1</x:v></x:c></x:row>' +
  '<x:row r="3"><x:c r="A3" t="s"><x:v>2</x:v></x:c><x:c r="B3"><x:v>12.5</x:v></x:c>' +
  '<x:c r="D3" t="inlineStr"><x:is><x:t>en ligne</x:t></x:is></x:c></x:row>' +
  '</x:sheetData></x:worksheet>';

const workbook = (): ArrayBuffer =>
  makeXlsx({
    'xl/workbook.xml': BOOK,
    'xl/_rels/workbook.xml.rels': RELS,
    'xl/sharedStrings.xml': SHARED,
    'xl/worksheets/sheet1.xml': SHEET,
  });

describe('lecture d’un classeur', () => {
  it('rend les feuilles nommées, dans l’ordre du classeur', async () => {
    const book = await readWorkbook(workbook());
    expect(book.sheets.map((s) => s.name)).toEqual(['Holdings']);
  });

  it('résout les chaînes partagées, y compris fragmentées', async () => {
    const [sheet] = (await readWorkbook(workbook())).sheets;
    expect(sheet?.rows[0]).toEqual(['Asset', '', 'ISIN']);
    expect(sheet?.rows[2]?.[0]).toBe('Crypto Currencies');
  });

  it('place chaque cellule à sa colonne : un trou ne décale rien', async () => {
    const [sheet] = (await readWorkbook(workbook())).sheets;
    // La ligne 2 est absente du fichier, la colonne C de la ligne 3 aussi.
    expect(sheet?.rows[1]).toEqual([]);
    expect(sheet?.rows[2]).toEqual(['Crypto Currencies', '12.5', '', 'en ligne']);
  });

  it('rend les nombres en texte, sans arrondi ni conversion', async () => {
    const [sheet] = (await readWorkbook(workbook())).sheets;
    expect(sheet?.rows[2]?.[1]).toBe('12.5');
  });

  it('refuse un fichier qui n’est pas un classeur', async () => {
    const orphan = makeXlsx({ 'autre.txt': 'bonjour' });
    await expect(readWorkbook(orphan)).rejects.toBeInstanceOf(WorkbookError);
  });

  it('refuse une archive illisible plutôt que d’en lire la moitié', async () => {
    const junk = new TextEncoder().encode('ceci n’est pas une archive').buffer;
    await expect(readWorkbook(junk as ArrayBuffer)).rejects.toBeInstanceOf(ZipError);
  });
});

describe('utilitaires de classeur', () => {
  it('convertit une référence de colonne en index', () => {
    expect([columnIndex('A1'), columnIndex('B2'), columnIndex('Z9')]).toEqual([0, 1, 25]);
    expect([columnIndex('AA1'), columnIndex('AB1')]).toEqual([26, 27]);
    expect(columnIndex('12')).toBe(-1);
  });

  it('convertit une date sérielle Excel, et refuse le domaine où le décalage ne vaut pas', () => {
    expect(excelSerialToNaive(45658)).toBe('2025-01-01T00:00:00');
    expect(excelSerialToNaive(60)).toBeNull();
    expect(excelSerialToNaive(Number.NaN)).toBeNull();
  });
});
