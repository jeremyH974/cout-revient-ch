import { describe, expect, it } from 'vitest';
import type { Workbook } from '../xlsx/index';
import { convertEtoroWorkbook, etoroDateToMs, leverageOf } from './convert';
import { detectEtoroWorkbook } from './sheets';

const HOLDINGS_HEADER = [
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
];
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
  'Type d’actif',
  'NWA',
];
const CLOSED_HEADER = [
  'Identifiant de position',
  'Action',
  'Long / Short',
  'Montant',
  'Unités',
  'Date d’ouverture',
  'Date de clôture',
  'Effet de levier',
  'Frais de spread (USD)',
  'Spread du marché (USD)',
  'Profit (USD)',
  'Profit (EUR)',
  'Taux de change à l’ouverture (USD)',
  'Taux de change à la clôture (USD)',
  'Taux à l’ouverture',
  'Taux à la clôture',
  'Taux Take Profit',
  'Taux Stop Loss',
  'Frais overnight et dividendes',
  'Copie de',
  'Type',
  'ISIN',
  'Remarques',
];

/** Une ligne du grand livre : c'est elle, désormais, qui fait entrer une position. */
const open = (
  date: string,
  details: string,
  amount: string,
  units: string,
  id: string,
  assetType: string,
): string[] => [
  date,
  'Position ouverte',
  details,
  amount,
  units,
  '0',
  '0',
  '0',
  id,
  assetType,
  '0',
];

/** Une ligne de photo : elle ne produit rien, elle nomme et elle contrôle. */
const snap = (
  serial: string,
  name: string,
  id: string,
  units: string,
  type: string,
  isin = 'US0378331005',
): string[] => [
  serial,
  name,
  id,
  'Long',
  '01/02/2025 10:00:00',
  'X1',
  '100',
  units,
  '110',
  '1000',
  '900',
  type,
  isin,
];

const closed = (
  id: string,
  asset: string,
  amount: string,
  units: string,
  profit: string,
  lev: string,
  type: string,
): string[] => [
  id,
  asset,
  'Long',
  amount,
  units,
  '01/02/2025 10:00:00',
  '01/06/2025 10:00:00',
  lev,
  '0',
  '0',
  profit,
  '0',
  '1',
  '1',
  '10',
  '12',
  '0',
  '0',
  '0',
  '',
  type,
  'US0378331005',
  '',
];

function book(
  activity: string[][],
  holdings: string[][] = [],
  closedRows: string[][] = [],
  names = ['Holdings', 'Activité du compte', 'Positions fermées'],
): Workbook {
  return {
    sheets: [
      { name: names[0]!, rows: [HOLDINGS_HEADER, ...holdings] },
      { name: names[1]!, rows: [ACTIVITY_HEADER, ...activity] },
      { name: names[2]!, rows: [CLOSED_HEADER, ...closedRows] },
    ],
  };
}

describe('détection d’un relevé eToro', () => {
  it('reconnaît les onglets en français comme en anglais', () => {
    expect(detectEtoroWorkbook(book([]))).toBe(true);
    expect(
      detectEtoroWorkbook(book([], [], [], ['Positions ouvertes', 'Account activity', 'X'])),
    ).toBe(true);
    expect(detectEtoroWorkbook({ sheets: [{ name: 'Feuil1', rows: [[]] }] })).toBe(false);
  });
});

describe('le grand livre est la source', () => {
  it('importe une position ouverte APRÈS la dernière photo — le défaut que la photo cachait', () => {
    // La photo (46023 = 01/01/2026) ignore tout ce qui suit ; le grand livre, non.
    const result = convertEtoroWorkbook(
      book(
        [
          open('01/02/2025 10:00:00', 'AAPL/USD', '2000', '10', 'p1', 'Actions'),
          open('15/03/2026 09:00:00', 'NOW/USD', '900', '3', 'p2', 'Actions'),
        ],
        [snap('46023', 'Apple Inc.', 'p1', '10', 'Stocks')],
      ),
    );
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts.map((d) => d.received?.currency)).toEqual(['eq:aapl', 'eq:now']);
  });

  it('lit le ticker du couple « TICKER/DEVISE », suffixes de place compris', () => {
    const result = convertEtoroWorkbook(
      book([
        open('01/02/2025 10:00:00', 'SXR8.DE/EUR', '500', '1', 'p1', 'ETF'),
        open('01/02/2025 10:00:00', 'SPCX.24-7/USD', '100', '2', 'p2', 'Actions'),
      ]),
    );
    expect(result.drafts.map((d) => d.received?.currency)).toEqual(['eq:sxr8.de', 'eq:spcx.24-7']);
  });

  it('donne à chaque actif la classe que la source déclare', () => {
    const result = convertEtoroWorkbook(
      book([
        open('01/02/2025 10:00:00', 'AAPL/USD', '2000', '10', 'p1', 'Actions'),
        open('01/02/2025 10:00:00', 'BTC/USD', '600', '2', 'p2', 'Crypto-monnaies'),
      ]),
    );
    expect(result.drafts.map((d) => d.received?.currency)).toEqual(['eq:aapl', 'btc']);
  });

  it('écarte un contrat pour différence en nommant le motif', () => {
    const result = convertEtoroWorkbook(
      book([open('01/02/2025 10:00:00', 'OIL/USD', '500', '2', 'p9', 'CFD')]),
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(result.issues[0]?.message).toContain('hors périmètre');
  });

  it('signale une ligne dont le ticker est illisible', () => {
    const result = convertEtoroWorkbook(
      book([open('01/02/2025 10:00:00', 'sans ticker', '500', '2', 'p9', 'Actions')]),
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('ticker illisible');
  });

  it('refuse un relevé sans grand livre', () => {
    const result = convertEtoroWorkbook({
      sheets: [{ name: 'Holdings', rows: [HOLDINGS_HEADER] }],
    });
    expect(result.drafts).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('activité');
  });
});

describe('positions fermées', () => {
  it('ne produit QUE la vente : l’achat est déjà dans le grand livre', () => {
    const result = convertEtoroWorkbook(
      book(
        [open('01/02/2025 10:00:00', 'AAPL/USD', '1000', '10', 'c1', 'Actions')],
        [],
        [closed('c1', 'Apple Inc. (AAPL)', '1000', '10', '250', '1', 'Actions')],
      ),
    );
    expect(result.drafts).toHaveLength(2);
    const [buy, sell] = result.drafts;
    expect(buy?.received).toEqual({ amount: '10', currency: 'eq:aapl' });
    expect(sell?.sent).toEqual({ amount: '10', currency: 'eq:aapl' });
    // Produit = montant investi + profit.
    expect(sell?.received).toEqual({ amount: '1250', currency: 'usd' });
  });

  it('écarte une position fermée à effet de levier', () => {
    const result = convertEtoroWorkbook(
      book([], [], [closed('c4', 'Tesla (TSLA)', '500', '2', '10', '2', 'Actions')]),
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('levier');
  });

  it('préfère le nom complet de la position fermée au ticker seul', () => {
    const result = convertEtoroWorkbook(
      book(
        [open('01/02/2025 10:00:00', 'DOGE/USD', '100', '5', 'c2', 'Crypto-monnaies')],
        [],
        [closed('c2', 'Dogecoin (DOGE)', '100', '5', '20', '1', 'Crypto-monnaies')],
      ),
    );
    expect(result.labels['doge']).toBe('Dogecoin');
  });
});

describe('la photo contrôle, elle ne produit plus rien', () => {
  it('ne signale rien quand la quantité reconstituée correspond', () => {
    const result = convertEtoroWorkbook(
      book(
        [open('01/02/2025 10:00:00', 'AAPL/USD', '2000', '10', 'p1', 'Actions')],
        [snap('46023', 'Apple Inc.', 'p1', '10', 'Stocks')],
      ),
    );
    expect(result.issues).toHaveLength(0);
    expect(result.labels['eq:aapl']).toBe('Apple Inc.');
  });

  it('signale un écart entre le grand livre et la photo', () => {
    const result = convertEtoroWorkbook(
      book(
        [open('01/02/2025 10:00:00', 'AAPL/USD', '2000', '10', 'p1', 'Actions')],
        [snap('46023', 'Apple Inc.', 'p1', '25', 'Stocks')],
      ),
    );
    expect(result.issues[0]?.message).toContain('quantité reconstituée diffère');
    expect(result.issues[0]?.message).toContain('eq:aapl');
  });

  it('ignore les opérations postérieures à la photo dans le contrôle', () => {
    // L'achat de 2026 ne doit pas faire croire à un écart sur la photo de 2026-01-01.
    const result = convertEtoroWorkbook(
      book(
        [
          open('01/02/2025 10:00:00', 'AAPL/USD', '2000', '10', 'p1', 'Actions'),
          open('15/03/2026 09:00:00', 'AAPL/USD', '900', '3', 'p2', 'Actions'),
        ],
        [snap('46023', 'Apple Inc.', 'p1', '10', 'Stocks')],
      ),
    );
    expect(result.issues).toHaveLength(0);
  });
});

describe('formats propres à eToro', () => {
  it('lit une date jour/mois/année', () => {
    expect(etoroDateToMs('23/12/2024 08:00:22')).toBe(Date.UTC(2024, 11, 23, 8, 0, 22));
    expect(etoroDateToMs('2024-12-23 08:00:22')).toBeNull();
    expect(etoroDateToMs('')).toBeNull();
  });

  it('lit un effet de levier écrit « X1 » comme « 1 »', () => {
    expect([leverageOf('X1'), leverageOf('1'), leverageOf('2'), leverageOf('')]).toEqual([
      1, 1, 2, 1,
    ]);
    expect(leverageOf('abc')).toBeNaN();
  });
});
