/**
 * Génère `tests/fixtures/etoro/releve-demo.xlsx` : un relevé eToro **entièrement inventé**, jamais
 * dérivé d'un fichier réel, même transformé (décision n° 17).
 *
 * La fixture reproduit volontairement les trois particularités du format réel, sans quoi elle ne
 * prouverait rien (décisions n° 105 et 106) :
 *   — les éléments XML portent le préfixe `x:`, comme le relevé d'eToro et non comme Excel ;
 *   — les chaînes passent par la table partagée, et l'une est fragmentée en plusieurs `<x:t>` ;
 *   — les feuilles sont référencées par chemin **absolu** dans la table de relations.
 * S'y ajoute ce que le convertisseur doit savoir écarter : deux instantanés empilés, une position
 * à effet de levier, un contrat pour différence.
 *
 * Usage : `node --import ./scripts/ts-resolve.mjs scripts/generate-etoro-fixture.ts`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// --- Écriture d'archive ------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** CRC32 : notre lecteur ne le vérifie pas, mais un tableur qui ouvrirait la fixture, si. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Archive aux entrées **stockées** : une fixture doit rester lisible sans rien décompresser. */
function zip(files: { name: string; text: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const entries = files.map((f) => ({ name: enc.encode(f.name), data: enc.encode(f.text) }));
  const size = entries.reduce((n, e) => n + 76 + e.name.length * 2 + e.data.length, 22);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let at = 0;
  for (const entry of entries) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint32(at + 14, crc32(entry.data), true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.data.length, true);
    view.setUint16(at + 26, entry.name.length, true);
    out.set(entry.name, at + 30);
    out.set(entry.data, at + 30 + entry.name.length);
    at += 30 + entry.name.length + entry.data.length;
  }
  const directoryAt = at;
  entries.forEach((entry, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint32(at + 16, crc32(entry.data), true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, entry.name.length, true);
    view.setUint32(at + 42, offsets[i]!, true);
    out.set(entry.name, at + 46);
    at += 46 + entry.name.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - directoryAt, true);
  view.setUint32(at + 16, directoryAt, true);
  return out.subarray(0, at + 22);
}

// --- Écriture du classeur ----------------------------------------------------------------------

const escapeXml = (raw: string): string =>
  raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;');

const columnName = (index: number): string => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
};

export interface FixtureSheet {
  name: string;
  rows: (string | number)[][];
}

/** Table des chaînes partagées ; la première est volontairement fragmentée en deux `<x:t>`. */
function sharedStrings(values: string[]): string {
  const items = values.map((value, i) => {
    if (i !== 0) return `<x:si><x:t>${escapeXml(value)}</x:t></x:si>`;
    const cut = Math.ceil(value.length / 2);
    return (
      `<x:si><x:r><x:t xml:space="preserve">${escapeXml(value.slice(0, cut))}</x:t></x:r>` +
      `<x:r><x:t xml:space="preserve">${escapeXml(value.slice(cut))}</x:t></x:r></x:si>`
    );
  });
  return `<?xml version="1.0" encoding="utf-8"?><x:sst count="${values.length}">${items.join('')}</x:sst>`;
}

function sheetXml(rows: (string | number)[][], index: Map<string, number>): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          if (typeof value === 'number') return `<x:c r="${ref}"><x:v>${value}</x:v></x:c>`;
          if (value === '') return '';
          return `<x:c r="${ref}" t="s"><x:v>${index.get(value)}</x:v></x:c>`;
        })
        .join('');
      return `<x:row r="${r + 1}">${cells}</x:row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><x:worksheet><x:sheetData>${body}</x:sheetData></x:worksheet>`;
}

export function buildWorkbook(sheets: FixtureSheet[]): Uint8Array {
  const values: string[] = [];
  const index = new Map<string, number>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        if (typeof cell === 'string' && cell !== '' && !index.has(cell)) {
          index.set(cell, values.length);
          values.push(cell);
        }
      }
    }
  }
  const files = [
    {
      name: '[Content_Types].xml',
      text:
        '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="xml" ContentType="application/xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      text:
        '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      text:
        '<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets>' +
        sheets
          .map(
            (s, i) =>
              `<x:sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 2}"/>`,
          )
          .join('') +
        '</x:sheets></x:workbook>',
    },
    {
      // Cibles ABSOLUES, comme le relevé réel : un chemin relatif serait une fixture complaisante.
      name: 'xl/_rels/workbook.xml.rels',
      text:
        '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="/xl/sharedStrings.xml"/>' +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        '</Relationships>',
    },
    { name: 'xl/sharedStrings.xml', text: sharedStrings(values) },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      text: sheetXml(s.rows, index),
    })),
  ];
  return zip(files);
}

export function writeWorkbook(path: string, sheets: FixtureSheet[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buildWorkbook(sheets));
}

// --- Le relevé de démonstration ----------------------------------------------------------------

/** 45838 = 30/06/2025, 46023 = 01/01/2026 : deux photos, la seconde suivie d'autres opérations. */
const OLD_SNAPSHOT = 45838;
const LAST_SNAPSHOT = 46023;

const ACTIVITY_HEADER = [
  'Date',
  'Type',
  'Détails',
  'Montant',
  'Unités',
  'Variation Fonds propres réalisés',
  'Équité réalisée',
  'Solde',
  'Identifiant de position',
  "Type d'actif",
  'NWA (fonds non retirables)',
];

/**
 * Le grand livre : c'est lui qui fait entrer les positions. Il porte volontairement une ouverture
 * **postérieure à la dernière photo** — le défaut que la photo dissimulait —, un contrat pour
 * différence à écarter, et des frais hors modèle. Les libellés sont des couples `TICKER/DEVISE`,
 * comme dans le relevé réel.
 */
const ACTIVITY: FixtureSheet = {
  name: 'Activité du compte',
  rows: [
    ACTIVITY_HEADER,
    ['01/02/2025 08:00:00', 'Dépôt', 'Virement', 5000, '-', 0, 0, 5000, '', '-', 0],
    [
      '05/01/2025 10:00:00',
      'Position ouverte',
      'DEMO/USD',
      200,
      5,
      0,
      0,
      4800,
      'p-201',
      'Actions',
      0,
    ],
    [
      '12/02/2025 09:30:00',
      'Position ouverte',
      'DEMO/USD',
      400,
      10,
      0,
      0,
      4600,
      'p-101',
      'Actions',
      0,
    ],
    [
      '03/03/2025 11:00:00',
      'Position ouverte',
      'IDX.DE/EUR',
      450,
      5,
      0,
      0,
      4150,
      'p-102',
      'ETF',
      0,
    ],
    [
      '20/05/2025 16:45:00',
      'Position ouverte',
      'BTC/USD',
      600,
      2,
      0,
      0,
      3550,
      'p-103',
      'Crypto-monnaies',
      0,
    ],
    ['02/06/2025 10:00:00', 'Position ouverte', 'OIL/USD', 60, 3, 0, 0, 3490, 'p-104', 'CFD', 0],
    ['15/07/2025 12:00:00', 'Frais overnight', 'OIL/USD', -2, '-', 0, 0, 3488, 'p-104', 'CFD', 0],
    // Fractionnement postérieur à la photo : la quantité double, le coût ne bouge pas.
    [
      '30/06/2026 06:00:00',
      'corp action: Split',
      'DEMO/USD 1:2',
      0,
      '-',
      0,
      0,
      0,
      'p-101',
      'Actions',
      0,
    ],
    // Après la dernière photo : invisible d'un import qui lirait la photo, présente ici.
    [
      '14/04/2026 14:20:00',
      'Position ouverte',
      'NEWCO/USD',
      300,
      4,
      0,
      0,
      3190,
      'p-301',
      'Actions',
      0,
    ],
  ],
};

/**
 * Les photos. Elles ne produisent plus aucune opération : elles **nomment** les instruments et
 * **contrôlent** les quantités à leur propre date. Onglet et colonnes restés anglais, comme chez
 * eToro, alors que les autres feuilles sont traduites.
 */
const HOLDINGS: FixtureSheet = {
  name: 'Holdings',
  rows: [
    [
      'Snapshot Date',
      'Asset',
      'Position ID',
      'Direction',
      'Open Date',
      'Leverage',
      'Open Rate',
      'Units',
      'Current Rate',
      'Value in USD',
      'Value in EUR',
      'Type',
      'ISIN',
    ],
    [
      OLD_SNAPSHOT,
      'Demo Industries Inc.',
      'p-101',
      'Long',
      '12/02/2025 09:30:00',
      'X1',
      40,
      10,
      45,
      450,
      410,
      'Stocks',
      'XX0000000001',
    ],
    [
      OLD_SNAPSHOT,
      'Indice Monde UCITS ETF',
      'p-102',
      'Long',
      '03/03/2025 11:00:00',
      'X1',
      90,
      5,
      95,
      475,
      432,
      'ETF',
      'XX0000000002',
    ],
    [
      LAST_SNAPSHOT,
      'Demo Industries Inc.',
      'p-101',
      'Long',
      '12/02/2025 09:30:00',
      'X1',
      40,
      10,
      52,
      520,
      470,
      'Stocks',
      'XX0000000001',
    ],
    [
      LAST_SNAPSHOT,
      'Indice Monde UCITS ETF',
      'p-102',
      'Long',
      '03/03/2025 11:00:00',
      'X1',
      90,
      5,
      101,
      505,
      456,
      'ETF',
      'XX0000000002',
    ],
    [
      LAST_SNAPSHOT,
      'Bitcoin',
      'p-103',
      'Long',
      '20/05/2025 16:45:00',
      'X1',
      300,
      2,
      350,
      700,
      633,
      'Crypto Currencies',
      '-',
    ],
  ],
};

/** Positions fermées : la vente seule en sort, l'achat étant déjà au grand livre. */
const CLOSED: FixtureSheet = {
  name: 'Positions fermées',
  rows: [
    [
      'Identifiant de position',
      'Action',
      'Long / Short',
      'Montant',
      'Unités',
      "Date d'ouverture",
      'Date de clôture',
      'Effet de levier',
      'Frais de spread (USD)',
      'Spread du marché (USD)',
      'Profit (USD)',
      'Profit (EUR)',
      "Taux de change à l'ouverture (USD)",
      'Taux de change à la clôture (USD)',
      "Taux à l'ouverture",
      'Taux à la clôture',
      'Taux Take Profit',
      'Taux Stop Loss',
      'Frais overnight et dividendes',
      'Copie de',
      'Type',
      'ISIN',
      'Remarques',
    ],
    [
      'p-201',
      'Demo Industries Inc. (DEMO)',
      'Long',
      200,
      5,
      '05/01/2025 10:00:00',
      '10/04/2025 15:00:00',
      '1',
      0,
      0,
      40,
      36,
      1,
      1,
      40,
      48,
      0,
      0,
      0,
      '',
      'Actions',
      'XX0000000001',
      '',
    ],
    [
      'p-202',
      'Pétrole (OIL)',
      'Long',
      100,
      1,
      '06/01/2025 10:00:00',
      '11/04/2025 15:00:00',
      '2',
      0,
      0,
      5,
      4,
      1,
      1,
      100,
      105,
      0,
      0,
      0,
      '',
      'CFD',
      'XX0000000005',
      '',
    ],
  ],
};

const SUMMARY: FixtureSheet = {
  name: 'Récapitulatif du compte',
  rows: [
    ['Nom', 'Totaux'],
    ['Deposits', 5000],
    // En-tête à saut de ligne encodé, comme le « Montant⏎ en (USD) » du relevé réel.
    ['Récapitulatif du compte (USD)', 'Total\n en (USD)'],
  ],
};

const PATH = 'tests/fixtures/etoro/releve-demo.xlsx';
writeWorkbook(PATH, [SUMMARY, HOLDINGS, CLOSED, ACTIVITY]);
console.log(`Relevé eToro de démonstration écrit : ${PATH}`);
console.log(
  '  grand livre de 9 lignes ; 2 photos empilées ; 1 ouverture et 1 fractionnement postérieurs ;',
);
console.log('  1 CFD et 1 position à levier à écarter.');
