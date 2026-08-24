/**
 * Convertisseur Bitvavo : fuseau explicite (America/New_York) vs repli Europe/Amsterdam, statut
 * Distributed accepté au même titre que Completed, frais réseau pliés dans la quantité de retrait
 * quand ils sont dans l'actif retiré (vs. frais séparé sinon), interne, retrait annulé et type
 * inconnu signalés — et aval complet (idempotence incluse).
 */
import { describe, expect, it } from 'vitest';
import { bitvavo } from './bitvavo';
import { importAnyCsv } from './index';
import { parseCsvText } from '../csv';

const USD_RATE = (): string => '1.1';

const HEADER = [
  'Timezone',
  'Date',
  'Time',
  'Type',
  'Currency',
  'Amount',
  'Quote Currency',
  'Quote Price',
  'Received / Paid Currency',
  'Received / Paid Amount',
  'Fee currency',
  'Fee amount',
  'Status',
  'Transaction ID',
  'Address',
];

const ROWS: string[][] = [
  [
    'America/New_York',
    '2025-01-08',
    '09:15:00',
    'buy',
    'BTC',
    '0.01',
    'EUR',
    '60000',
    'EUR',
    '600',
    'EUR',
    '1.50',
    'Completed',
    'BV1',
    '',
  ],
  [
    '',
    '2025-01-10',
    '10:00:00',
    'sell',
    'BTC',
    '0.005',
    'EUR',
    '62000',
    'EUR',
    '310',
    'EUR',
    '0.80',
    'Completed',
    'BV2',
    '',
  ],
  [
    'Europe/Amsterdam',
    '2025-01-11',
    '08:00:00',
    'deposit',
    'ETH',
    '0.2',
    '',
    '',
    '',
    '',
    '',
    '',
    'Completed',
    'BV3',
    '0xExternalAddr',
  ],
  [
    'Europe/Amsterdam',
    '2025-01-12',
    '08:00:00',
    'withdrawal',
    'ETH',
    '0.5',
    '',
    '',
    '',
    '',
    'ETH',
    '0.002',
    'Completed',
    'BV4',
    '0xDestAddr',
  ],
  [
    'Europe/Amsterdam',
    '2025-01-13',
    '08:00:00',
    'withdrawal',
    'BTC',
    '0.1',
    '',
    '',
    '',
    '',
    'EUR',
    '2.00',
    'Completed',
    'BV5',
    'bc1DestAddr',
  ],
  [
    'Europe/Amsterdam',
    '2025-01-14',
    '08:00:00',
    'staking',
    'ADA',
    '2.5',
    '',
    '',
    '',
    '',
    '',
    '',
    'Distributed',
    'BV6',
    '',
  ],
  [
    'Europe/Amsterdam',
    '2025-01-15',
    '08:00:00',
    'rebate',
    'BTC',
    '0.0001',
    '',
    '',
    '',
    '',
    '',
    '',
    'Completed',
    'BV7',
    '',
  ],
  [
    'Europe/Amsterdam',
    '2025-01-16',
    '08:00:00',
    'internal_transfer',
    'BTC',
    '0.01',
    '',
    '',
    '',
    '',
    '',
    '',
    'Completed',
    'BV8',
    '',
  ],
  [
    'Europe/Amsterdam',
    '2025-01-17',
    '08:00:00',
    'withdrawal_cancelled',
    'BTC',
    '0.01',
    '',
    '',
    '',
    '',
    '',
    '',
    'Completed',
    'BV9',
    '',
  ],
  [
    'Europe/Amsterdam',
    '2025-01-18',
    '08:00:00',
    'foobar',
    'BTC',
    '0.01',
    '',
    '',
    '',
    '',
    '',
    '',
    'Completed',
    'BV10',
    '',
  ],
  [
    'Europe/Amsterdam',
    '2025-01-19',
    '08:00:00',
    'buy',
    'BTC',
    '0.01',
    'EUR',
    '50000',
    'EUR',
    '500',
    '',
    '',
    'Failed',
    'BV11',
    '',
  ],
];

const CSV = [HEADER.join(','), ...ROWS.map((r) => r.join(','))].join('\n');

describe('bitvavo', () => {
  it('détecte l’en-tête (Timezone + Received / Paid Amount)', () => {
    expect(bitvavo.detect(parseCsvText(CSV).header)).toBe(true);
    expect(bitvavo.detect(['Timezone', 'Date', 'Time'])).toBe(false);
  });

  it('convertit achat, vente, dépôt, retraits (frais pliés vs. séparés), récompenses, interne, annulé et type inconnu', () => {
    const { drafts, issues, skippedInternal } = bitvavo.convert(parseCsvText(CSV));
    expect(drafts).toHaveLength(7);
    expect(skippedInternal).toBe(1);
    // BV9 (annulé), BV10 (type inconnu), BV11 (statut Failed).
    expect(issues).toHaveLength(3);
    expect(issues.some((i) => i.message.includes('annulé'))).toBe(true);
    expect(issues.some((i) => i.message.includes('foobar'))).toBe(true);
    expect(issues.some((i) => i.message.includes('Failed'))).toBe(true);

    const byTxId = (id: string): (typeof drafts)[number] => {
      const d = drafts.find((x) => x.txHash === id);
      if (!d) throw new Error(`draft ${id} introuvable`);
      return d;
    };

    const buy = byTxId('BV1');
    expect(buy.sent).toEqual({ amount: '600', currency: 'eur' });
    expect(buy.received).toEqual({ amount: '0.01', currency: 'btc' });
    expect(buy.fee).toEqual({ amount: '1.5', currency: 'eur' });
    // 09:15 America/New_York (hiver, UTC-5) le 8 janv. 2025 = 14:15 UTC.
    expect(buy.timeMs).toBe(Date.UTC(2025, 0, 8, 14, 15, 0));

    const sell = byTxId('BV2');
    expect(sell.sent).toEqual({ amount: '0.005', currency: 'btc' });
    expect(sell.received).toEqual({ amount: '310', currency: 'eur' });
    expect(sell.fee).toEqual({ amount: '0.8', currency: 'eur' });

    const deposit = byTxId('BV3');
    expect(deposit.sent).toBeNull();
    expect(deposit.received).toEqual({ amount: '0.2', currency: 'eth' });

    const withdrawalFolded = byTxId('BV4');
    // Frais réseau (même actif que le retrait) plié dans la quantité envoyée.
    expect(withdrawalFolded.sent).toEqual({ amount: '0.502', currency: 'eth' });
    expect(withdrawalFolded.fee).toBeNull();
    expect(withdrawalFolded.description).toContain('frais réseau');

    const withdrawalNormal = byTxId('BV5');
    // Frais dans une autre devise (EUR) : jamais plié, jambe de frais séparée.
    expect(withdrawalNormal.sent).toEqual({ amount: '0.1', currency: 'btc' });
    expect(withdrawalNormal.fee).toEqual({ amount: '2', currency: 'eur' });
    expect(withdrawalNormal.description).toBeNull();

    const staking = byTxId('BV6');
    expect(staking.received).toEqual({ amount: '2.5', currency: 'ada' });
    expect(staking.label).toBe('staking');

    const rebate = byTxId('BV7');
    expect(rebate.received).toEqual({ amount: '0.0001', currency: 'btc' });
    expect(rebate.label).toBe('reward');
  });
});

describe('importAnyCsv (bitvavo)', () => {
  it('produit les événements attendus et un ré-import idempotent', () => {
    const first = importAnyCsv(CSV, {}, 'csv:bitvavo', 'i1', USD_RATE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.report.format).toBe('bitvavo');
    expect(first.report.counts.skippedInternal).toBe(1);
    for (const key of Object.keys(first.rows)) expect(key.startsWith('pv:csv:bitvavo:')).toBe(true);

    const again = importAnyCsv(CSV, first.rows, 'csv:bitvavo', 'i2', USD_RATE);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.report.newRows).toBe(0);
    expect(again.report.duplicateRows).toBe(first.report.parsedRows);
    expect(again.report.conflictingRows).toBe(0);
  });
});
