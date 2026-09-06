import { describe, expect, it } from 'vitest';
import type { Workbook } from '../xlsx';
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

/** Une ligne de positions : instantané, symbole, identifiant, date, levier, quantité, classe. */
const hold = (
  snapshot: string,
  asset: string,
  id: string,
  open: string,
  lev: string,
  units: string,
  type: string,
): string[] => [
  snapshot,
  asset,
  id,
  'Long',
  open,
  lev,
  '100',
  units,
  '110',
  '1000',
  '900',
  type,
  'IE00B4L5Y983',
];

const act = (id: string, amount: string, type = 'Position ouverte'): string[] => [
  '01/02/2025 10:00:00',
  type,
  'achat',
  amount,
  '-',
  '0',
  '0',
  '0',
  id,
  'Actions',
  '0',
];

function book(
  holdings: string[][],
  activity: string[][],
  names = ['Holdings', 'Activité du compte'],
): Workbook {
  return {
    sheets: [
      { name: names[0]!, rows: [HOLDINGS_HEADER, ...holdings] },
      { name: names[1]!, rows: [ACTIVITY_HEADER, ...activity] },
    ],
  };
}

describe('détection d’un relevé eToro', () => {
  it('reconnaît les onglets en français comme en anglais', () => {
    expect(detectEtoroWorkbook(book([], []))).toBe(true);
    expect(detectEtoroWorkbook(book([], [], ['Positions ouvertes', 'Account activity']))).toBe(
      true,
    );
    expect(detectEtoroWorkbook({ sheets: [{ name: 'Feuil1', rows: [[]] }] })).toBe(false);
  });
});

describe('conversion d’un relevé eToro', () => {
  it('ne retient que le dernier instantané : un relevé empile plusieurs photos', () => {
    // Trois photos du même portefeuille. Tout lire compterait la position trois fois.
    const result = convertEtoroWorkbook(
      book(
        [
          hold('45838', 'AAPL', 'p1', '01/02/2025 10:00:00', 'X1', '10', 'Stocks'),
          hold('46022', 'AAPL', 'p1', '01/02/2025 10:00:00', 'X1', '10', 'Stocks'),
          hold('46023', 'AAPL', 'p1', '01/02/2025 10:00:00', 'X1', '10', 'Stocks'),
        ],
        [act('p1', '2000')],
      ),
    );
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.received).toEqual({ amount: '10', currency: 'eq:aapl' });
    expect(result.drafts[0]?.sent).toEqual({ amount: '2000', currency: 'usd' });
  });

  it('donne à chaque actif la classe que la source déclare', () => {
    const result = convertEtoroWorkbook(
      book(
        [
          hold('46023', 'AAPL', 'p1', '01/02/2025 10:00:00', 'X1', '10', 'Stocks'),
          hold('46023', 'IWDA', 'p2', '01/02/2025 10:00:00', 'X1', '5', 'ETF'),
          hold('46023', 'SOL', 'p3', '01/02/2025 10:00:00', 'X1', '3', 'Crypto Currencies'),
        ],
        [act('p1', '2000'), act('p2', '500'), act('p3', '300')],
      ),
    );
    expect(result.drafts.map((d) => d.received?.currency)).toEqual(['eq:aapl', 'eq:iwda', 'sol']);
  });

  it('écarte une position à effet de levier en nommant le motif', () => {
    const result = convertEtoroWorkbook(
      book(
        [hold('46023', 'TSLA', 'p9', '01/02/2025 10:00:00', 'X2', '4', 'Stocks')],
        [act('p9', '900')],
      ),
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(result.issues[0]?.message).toContain('levier');
  });

  it('écarte un contrat pour différence, qui n’a pas de quantité détenue', () => {
    const result = convertEtoroWorkbook(
      book(
        [hold('46023', 'OIL', 'p8', '01/02/2025 10:00:00', 'X1', '4', 'CFD')],
        [act('p8', '900')],
      ),
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('hors périmètre');
  });

  it('signale une position ouverte avant le relevé plutôt que d’inventer son coût', () => {
    const result = convertEtoroWorkbook(
      book([hold('46023', 'MSFT', 'vieux', '23/12/2024 08:00:22', 'X1', '2', 'Stocks')], []),
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('avant le début du relevé');
  });

  it('traite le tiret isolé comme une absence de valeur, jamais comme un zéro', () => {
    const result = convertEtoroWorkbook(
      book(
        [hold('46023', 'AAPL', 'p1', '01/02/2025 10:00:00', 'X1', '-', 'Stocks')],
        [act('p1', '2000')],
      ),
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('Quantité');
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

const withClosed = (rows: string[][]): Workbook => ({
  sheets: [
    { name: 'Holdings', rows: [HOLDINGS_HEADER] },
    { name: 'Activité du compte', rows: [ACTIVITY_HEADER] },
    { name: 'Positions fermées', rows: [CLOSED_HEADER, ...rows] },
  ],
});

describe('positions fermées', () => {
  it('produit un achat daté de l’ouverture et une vente datée de la clôture', () => {
    const r = convertEtoroWorkbook(
      withClosed([closed('c1', 'AAPL', '1000', '10', '250', '1', 'Actions')]),
    );
    expect(r.drafts).toHaveLength(2);
    const [buy, sell] = r.drafts;
    expect(buy?.timeMs).toBe(Date.UTC(2025, 1, 1, 10, 0, 0));
    expect(buy?.sent).toEqual({ amount: '1000', currency: 'usd' });
    expect(buy?.received).toEqual({ amount: '10', currency: 'eq:aapl' });
    expect(sell?.timeMs).toBe(Date.UTC(2025, 5, 1, 10, 0, 0));
    expect(sell?.sent).toEqual({ amount: '10', currency: 'eq:aapl' });
  });

  it('le produit de la vente est le montant investi augmenté du profit', () => {
    const gain = convertEtoroWorkbook(
      withClosed([closed('c1', 'AAPL', '1000', '10', '250', '1', 'Actions')]),
    );
    expect(gain.drafts[1]?.received).toEqual({ amount: '1250', currency: 'usd' });
    const loss = convertEtoroWorkbook(
      withClosed([closed('c2', 'BTC', '1000', '1', '-400', '1', 'Crypto-monnaies')]),
    );
    expect(loss.drafts[1]?.received).toEqual({ amount: '600', currency: 'usd' });
    expect(loss.drafts[1]?.sent).toEqual({ amount: '1', currency: 'btc' });
  });

  it('écarte un contrat pour différence fermé, et le compte', () => {
    const r = convertEtoroWorkbook(withClosed([closed('c3', 'OIL', '500', '2', '10', '1', 'CFD')]));
    expect(r.drafts).toHaveLength(0);
    expect(r.skipped).toBe(1);
    expect(r.issues[0]?.message).toContain('hors périmètre');
  });

  it('écarte une position fermée à effet de levier', () => {
    const r = convertEtoroWorkbook(
      withClosed([closed('c4', 'TSLA', '500', '2', '10', '2', 'Actions')]),
    );
    expect(r.drafts).toHaveLength(0);
    expect(r.issues[0]?.message).toContain('levier');
  });
});
