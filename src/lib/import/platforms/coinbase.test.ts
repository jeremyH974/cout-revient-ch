/**
 * Convertisseur Coinbase : double orthographe Advanced/Advance Trade, Convert dont la jambe reçue
 * vient des Notes (avec et sans virgule de milliers), Subtotal vide → repli sur Total, variante
 * d'en-tête v3 (Spot Price Currency / Fees / Total (inclusive of fees)), types internes, migration
 * et type inconnu — et aval complet (idempotence incluse).
 */
import { describe, expect, it } from 'vitest';
import { coinbase } from './coinbase';
import { importAnyCsv } from './index';
import { parseCsvText } from '../csv';

const USD_RATE = (): string => '1.1';

const HEADER = [
  'ID',
  'Timestamp',
  'Transaction Type',
  'Asset',
  'Quantity Transacted',
  'Price Currency',
  'Price at Transaction',
  'Subtotal',
  'Total (inclusive of fees and/or spread)',
  'Fees and/or Spread',
  'Notes',
];

const ROWS: string[][] = [
  [
    'TX1',
    '2025-01-17 16:57:02 UTC',
    'Buy',
    'BTC',
    '0.01',
    'EUR',
    '€1500.00',
    '€15.00',
    '€15.75',
    '€0.75',
    '',
  ],
  [
    'TX2',
    '2025-01-18 10:00:00 UTC',
    'Advanced Trade Sell',
    'ETH',
    '0.5',
    'EUR',
    '€3000.00',
    '€1500.00',
    '€1497.00',
    '€3.00',
    '',
  ],
  [
    'TX3',
    '2025-01-19 09:00:00 UTC',
    'Advance Trade Buy',
    'SOL',
    '2',
    'EUR',
    '',
    '',
    '€200.00',
    '',
    '',
  ],
  [
    'TX4',
    '2025-01-20 12:00:00 UTC',
    'Convert',
    'BTC',
    '0.01',
    'EUR',
    '',
    '',
    '€600.00',
    '',
    'Converted 0.01 BTC to 599.50 USDC',
  ],
  [
    'TX5',
    '2025-01-21 12:00:00 UTC',
    'Convert',
    'ETH',
    '0.5',
    'EUR',
    '',
    '',
    '€1200.00',
    '',
    'Converted 0.5 ETH to 1,199.99 USDC',
  ],
  ['TX6', '2025-01-22 08:00:00 UTC', 'Send', 'ETH', '-0.2', '', '', '', '', '', ''],
  [
    'TX7',
    '2025-01-23 08:00:00 UTC',
    'Receive',
    'DOGE',
    '100',
    '',
    '',
    '',
    '',
    '',
    'Coinbase referral bonus',
  ],
  ['TX8', '2025-01-24 08:00:00 UTC', 'Receive', 'DOGE', '50', '', '', '', '', '', ''],
  // Total sans symbole : exerce le repli sur la colonne Price Currency.
  ['TX9', '2025-01-25 08:00:00 UTC', 'Staking Income', 'ADA', '5', 'EUR', '', '', '2.50', '', ''],
  [
    'TX10',
    '2025-01-26 08:00:00 UTC',
    'Subscription Rebate',
    'USDC',
    '1.99',
    'EUR',
    '',
    '',
    '€1.99',
    '',
    '',
  ],
  ['TX11', '2025-01-27 08:00:00 UTC', 'Donation', 'BTC', '0.001', '', '', '', '', '', ''],
  [
    'TX12',
    '2025-01-28 08:00:00 UTC',
    'Card Spend',
    'BTC',
    '0.0002',
    'EUR',
    '',
    '',
    '€20.00',
    '',
    '',
  ],
  ['TX13', '2025-01-29 08:00:00 UTC', 'Exchange Deposit', 'BTC', '0.01', '', '', '', '', '', ''],
  ['TX14', '2025-01-30 08:00:00 UTC', 'Asset Migration', 'BCH', '1', '', '', '', '', '', ''],
  ['TX15', '2025-01-31 08:00:00 UTC', 'Mystery Type', 'XYZ', '1', '', '', '', '', '', ''],
];

const csvField = (f: string): string => (f.includes(',') ? `"${f}"` : f);
const CSV = [HEADER.join(','), ...ROWS.map((r) => r.map(csvField).join(','))].join('\n');

describe('coinbase', () => {
  it('détecte l’en-tête v4 (Transaction Type + Quantity Transacted + Subtotal)', () => {
    expect(coinbase.detect(parseCsvText(CSV).header)).toBe(true);
  });

  it('détecte l’en-tête v3 (mêmes trois colonnes clés)', () => {
    expect(
      coinbase.detect([
        'Timestamp',
        'Transaction Type',
        'Asset',
        'Quantity Transacted',
        'Spot Price Currency',
        'Spot Price at Transaction',
        'Subtotal',
        'Total (inclusive of fees)',
        'Fees',
        'Notes',
      ]),
    ).toBe(true);
  });

  it('ne détecte pas un simple préambule sans en-tête réel (limitation connue)', () => {
    expect(coinbase.detect(['Transactions'])).toBe(false);
  });

  it('convertit achats, ventes (double orthographe), Convert, envoi/réception, revenus, interne, migration, inconnu', () => {
    const { drafts, issues, skippedInternal } = coinbase.convert(parseCsvText(CSV));
    expect(drafts).toHaveLength(12);
    expect(skippedInternal).toBe(1);
    expect(issues).toHaveLength(2);
    expect(issues.some((i) => i.message.includes('Migration'))).toBe(true);
    expect(issues.some((i) => i.message.includes('Mystery Type'))).toBe(true);

    const byId = (id: string): (typeof drafts)[number] => {
      const d = drafts.find((x) => x.txHash === id);
      if (!d) throw new Error(`draft ${id} introuvable`);
      return d;
    };

    const buy = byId('TX1');
    expect(buy.sent).toEqual({ amount: '15.00', currency: 'eur' });
    expect(buy.received).toEqual({ amount: '0.01', currency: 'btc' });
    expect(buy.fee).toEqual({ amount: '0.75', currency: 'eur' });

    const advancedSell = byId('TX2');
    expect(advancedSell.sent).toEqual({ amount: '0.5', currency: 'eth' });
    expect(advancedSell.received).toEqual({ amount: '1500.00', currency: 'eur' });
    expect(advancedSell.fee).toEqual({ amount: '3.00', currency: 'eur' });

    const advanceBuy = byId('TX3');
    expect(advanceBuy.sent).toEqual({ amount: '200.00', currency: 'eur' });
    expect(advanceBuy.received).toEqual({ amount: '2', currency: 'sol' });
    // Subtotal vide → repli sur Total, sans jambe de frais séparée.
    expect(advanceBuy.fee).toBeNull();

    const convert1 = byId('TX4');
    expect(convert1.sent).toEqual({ amount: '0.01', currency: 'btc' });
    expect(convert1.received).toEqual({ amount: '599.50', currency: 'usdc' });
    expect(convert1.netWorth).toEqual({ amount: '600.00', currency: 'eur' });

    const convert2 = byId('TX5');
    // Virgule de milliers dans les Notes : retirée avant construction du montant.
    expect(convert2.received).toEqual({ amount: '1199.99', currency: 'usdc' });
    expect(convert2.netWorth).toEqual({ amount: '1200.00', currency: 'eur' });

    const send = byId('TX6');
    expect(send.sent).toEqual({ amount: '0.2', currency: 'eth' });
    expect(send.received).toBeNull();
    expect(send.netWorth).toBeNull();

    const receiveReward = byId('TX7');
    expect(receiveReward.received).toEqual({ amount: '100', currency: 'doge' });
    expect(receiveReward.label).toBe('reward');

    const receivePlain = byId('TX8');
    expect(receivePlain.label).toBeNull();

    const staking = byId('TX9');
    // Total sans symbole (« 2.50 ») : repli sur la colonne Price Currency (EUR).
    expect(staking.netWorth).toEqual({ amount: '2.50', currency: 'eur' });
    expect(staking.label).toBe('staking');

    const rebate = byId('TX10');
    expect(rebate.received).toEqual({ amount: '1.99', currency: 'usdc' });
    expect(rebate.netWorth).toEqual({ amount: '1.99', currency: 'eur' });
    expect(rebate.label).toBe('fee refund');

    const donation = byId('TX11');
    expect(donation.sent).toEqual({ amount: '0.001', currency: 'btc' });
    expect(donation.label).toBe('donation');

    const cardSpend = byId('TX12');
    expect(cardSpend.sent).toEqual({ amount: '0.0002', currency: 'btc' });
    expect(cardSpend.netWorth).toEqual({ amount: '20.00', currency: 'eur' });
    expect(cardSpend.label).toBe('spend');
  });

  it('convertit un Buy avec l’en-tête v3 (Spot Price Currency / Fees / Total (inclusive of fees))', () => {
    const v3Header = [
      'Timestamp',
      'Transaction Type',
      'Asset',
      'Quantity Transacted',
      'Spot Price Currency',
      'Spot Price at Transaction',
      'Subtotal',
      'Total (inclusive of fees)',
      'Fees',
      'Notes',
    ].join(',');
    const v3Row = [
      '2025-02-01 09:00:00 UTC',
      'Buy',
      'BTC',
      '0.02',
      'EUR',
      '€1600.00',
      '€32.00',
      '€32.50',
      '€0.50',
      '',
    ].join(',');
    const v3Csv = [v3Header, v3Row].join('\n');
    expect(coinbase.detect(parseCsvText(v3Csv).header)).toBe(true);
    const { drafts, issues } = coinbase.convert(parseCsvText(v3Csv));
    expect(issues).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.sent).toEqual({ amount: '32.00', currency: 'eur' });
    expect(drafts[0]!.received).toEqual({ amount: '0.02', currency: 'btc' });
    expect(drafts[0]!.fee).toEqual({ amount: '0.50', currency: 'eur' });
  });

  it('Convert dont les Notes sont illisibles devient une issue explicite (ligne non importée)', () => {
    const csv = [
      HEADER.join(','),
      [
        'TXBAD',
        '2025-01-20 12:00:00 UTC',
        'Convert',
        'BTC',
        '0.01',
        'EUR',
        '',
        '',
        '€600.00',
        '',
        'texte inattendu',
      ].join(','),
    ].join('\n');
    const { drafts, issues } = coinbase.convert(parseCsvText(csv));
    expect(drafts).toHaveLength(0);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('Convert');
    expect(issues[0]!.message).toContain('non importée');
  });
});

describe('importAnyCsv (coinbase)', () => {
  it('produit les événements attendus et un ré-import idempotent', () => {
    const first = importAnyCsv(CSV, {}, 'csv:coinbase', 'i1', USD_RATE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.report.format).toBe('coinbase');
    expect(first.report.counts.unqualified).toBe(0);
    expect(first.report.counts.skippedInternal).toBe(1);
    for (const key of Object.keys(first.rows))
      expect(key.startsWith('pv:csv:coinbase:')).toBe(true);

    const again = importAnyCsv(CSV, first.rows, 'csv:coinbase', 'i2', USD_RATE);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.report.newRows).toBe(0);
    expect(again.report.duplicateRows).toBe(first.report.parsedRows);
    expect(again.report.conflictingRows).toBe(0);
  });
});
