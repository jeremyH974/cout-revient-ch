/**
 * Convertisseur SwissBorg : colonnes `(CCY)` reconnues par motif (CHF et EUR testés), Buy+Sell au
 * même Time in UTC groupés en un échange, dépôt, retrait, Payouts (« yield » → reward, sinon sans
 * label), Fee Adjustment (jambe frais autonome), type inconnu, date illisible, échange non apparié,
 * `netWorth` limité à EUR/USD (jamais CHF), tolérance de 3 formats de date.
 */
import { describe, expect, it } from 'vitest';
import { parseSwissborgTime, swissborg } from './swissborg';
import { importAnyCsv } from './index';
import { parseCsvText } from '../csv';

const USD_RATE = (): string => '1.1';
const FOREIGN_HEADER = ['Timezone', 'Date', 'Time', 'Type', 'Currency', 'Amount'];

function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('brouillon introuvable');
  return x;
}

const CHF_HEADER = [
  'Local time',
  'Time in UTC',
  'Type',
  'Currency',
  'Gross amount',
  'Gross amount (CHF)',
  'Fee',
  'Fee (CHF)',
  'Net amount',
  'Net amount (CHF)',
  'Note',
];

const CHF_ROWS: string[][] = [
  // Buy + Sell au même Time in UTC → un seul échange (Sell = envoyé, Buy = reçu).
  [
    '2026-01-10 11:00:00',
    '2026-01-10 10:00:00',
    'Buy',
    'BTC',
    '0.01',
    '550',
    '0.0001',
    '5.5',
    '0.0099',
    '544.5',
    '',
  ],
  [
    '2026-01-10 11:00:00',
    '2026-01-10 10:00:00',
    'Sell',
    'CHF',
    '550',
    '550',
    '0',
    '0',
    '550',
    '550',
    '',
  ],
  // Dépôt CHF, date au format DD/MM/YYYY HH:MM (tolérance de format).
  [
    '11/01/2026 09:00',
    '11/01/2026 08:00',
    'Deposit',
    'CHF',
    '1000',
    '1000',
    '0',
    '0',
    '1000',
    '1000',
    '',
  ],
  // Retrait BTC : CHF n'est pas EUR/USD, netWorth doit rester null malgré la colonne (CHF).
  [
    '2026-01-12 09:00:00',
    '2026-01-12 08:00:00',
    'Withdrawal',
    'BTC',
    '0.02',
    '1100',
    '0.0001',
    '5.5',
    '0.0199',
    '1094.5',
    '',
  ],
  // Payouts avec "yield" dans la note → reward.
  [
    '2026-01-13 09:00:00',
    '2026-01-13 08:00:00',
    'Payouts',
    'BTC',
    '0.0005',
    '27.5',
    '0',
    '0',
    '0.0005',
    '27.5',
    'Yield payouts',
  ],
  // Payouts sans "yield" → pas de label (lecture littérale de la règle).
  [
    '2026-01-14 09:00:00',
    '2026-01-14 08:00:00',
    'Payouts',
    'BTC',
    '0.0001',
    '5.5',
    '0',
    '0',
    '0.0001',
    '5.5',
    'Referral bonus',
  ],
  // Fee Adjustment : jambe de frais autonome.
  [
    '2026-01-15 09:00:00',
    '2026-01-15 08:00:00',
    'Fee Adjustment',
    'CHF',
    '2',
    '2',
    '0',
    '0',
    '2',
    '2',
    'Monthly fee',
  ],
  // Type inconnu.
  [
    '2026-01-16 09:00:00',
    '2026-01-16 08:00:00',
    'Foobar',
    'BTC',
    '0.001',
    '55',
    '0',
    '0',
    '0.001',
    '55',
    '',
  ],
  // Date illisible.
  ['x', 'not-a-date', 'Deposit', 'CHF', '10', '10', '0', '0', '10', '10', ''],
  // Buy non apparié (pas de Sell au même Time in UTC).
  [
    '2026-01-17 09:00:00',
    '2026-01-17 08:00:00',
    'Buy',
    'ETH',
    '0.1',
    '300',
    '0',
    '0',
    '0.1',
    '300',
    '',
  ],
];

const CHF_CSV = [CHF_HEADER.join(','), ...CHF_ROWS.map((r) => r.join(','))].join('\n');

const EUR_HEADER = [
  'Local time',
  'Time in UTC',
  'Type',
  'Currency',
  'Gross amount',
  'Gross amount (EUR)',
  'Fee',
  'Fee (EUR)',
  'Net amount',
  'Net amount (EUR)',
  'Note',
];
const EUR_ROWS: string[][] = [
  [
    '2026-02-01 09:00:00',
    '2026-02-01 08:00:00',
    'Withdrawal',
    'BTC',
    '0.01',
    '550',
    '0.0001',
    '5.5',
    '0.0099',
    '544.5',
    '',
  ],
];
const EUR_CSV = [EUR_HEADER.join(','), ...EUR_ROWS.map((r) => r.join(','))].join('\n');

describe('parseSwissborgTime', () => {
  it('tolère 3 formats et rejette le reste', () => {
    expect(parseSwissborgTime('2026-01-10 08:00:00')).toBe(Date.UTC(2026, 0, 10, 8, 0, 0));
    expect(parseSwissborgTime('2026-01-10T08:00:00')).toBe(Date.UTC(2026, 0, 10, 8, 0, 0));
    expect(parseSwissborgTime('11/01/2026 08:00')).toBe(Date.UTC(2026, 0, 11, 8, 0, 0));
    expect(parseSwissborgTime('not-a-date')).toBeNull();
  });
});

describe('swissborg', () => {
  it('reconnaît les colonnes (CHF) et (EUR) par le même motif, rejette un en-tête étranger', () => {
    expect(swissborg.detect(parseCsvText(CHF_CSV).header)).toBe(true);
    expect(swissborg.detect(parseCsvText(EUR_CSV).header)).toBe(true);
    expect(swissborg.detect(FOREIGN_HEADER)).toBe(false);
  });

  it('groupe Buy+Sell, traite dépôt, retrait, Payouts (yield/sans label), Fee Adjustment, type inconnu, date illisible et échange non apparié', () => {
    const { drafts, issues, skippedInternal } = swissborg.convert(parseCsvText(CHF_CSV));
    expect(drafts).toHaveLength(6);
    expect(skippedInternal).toBe(0);
    expect(issues).toHaveLength(3);
    expect(issues.some((i) => i.message.includes('inconnu'))).toBe(true);
    expect(issues.some((i) => i.message.includes('incomplet'))).toBe(true);
    expect(issues.some((i) => i.message.includes('Time in UTC'))).toBe(true);

    const trade = must(
      drafts.find((d) => d.sent !== null && d.sent.currency === 'chf' && d.received !== null),
    );
    expect(trade.sent).toEqual({ amount: '550', currency: 'chf' });
    expect(trade.received).toEqual({ amount: '0.0099', currency: 'btc' });
    expect(trade.fee).toBeNull();
    expect(trade.description).toContain('0.0001 BTC');

    const deposit = must(drafts.find((d) => d.received !== null && d.received.currency === 'chf'));
    expect(deposit.received).toEqual({ amount: '1000', currency: 'chf' });
    expect(deposit.netWorth).toBeNull();

    const withdrawal = must(drafts.find((d) => d.sent !== null && d.sent.currency === 'btc'));
    expect(withdrawal.sent).toEqual({ amount: '0.0199', currency: 'btc' });
    expect(withdrawal.netWorth).toBeNull(); // CHF exclu de netWorth (ni EUR ni USD)

    const rewardPayout = must(drafts.find((d) => d.label === 'reward'));
    expect(rewardPayout.received).toEqual({ amount: '0.0005', currency: 'btc' });

    const plainPayout = must(
      drafts.find((d) => d.received !== null && d.received.amount === '0.0001'),
    );
    expect(plainPayout.label).toBeNull();

    const feeAdjustment = must(drafts.find((d) => d.fee !== null));
    expect(feeAdjustment.fee).toEqual({ amount: '2', currency: 'chf' });
    expect(feeAdjustment.sent).toBeNull();
    expect(feeAdjustment.received).toBeNull();
  });
});

describe('swissborg — devise de compte EUR', () => {
  it('calcule netWorth via la colonne (EUR) pour une jambe non fiat', () => {
    const { drafts, issues } = swissborg.convert(parseCsvText(EUR_CSV));
    expect(issues).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    const withdrawal = drafts[0]!;
    expect(withdrawal.sent).toEqual({ amount: '0.0099', currency: 'btc' });
    expect(withdrawal.netWorth).toEqual({ amount: '544.5', currency: 'eur' });
  });
});

describe('importAnyCsv (swissborg)', () => {
  it('reconnaît le format via le registre', () => {
    const result = importAnyCsv(CHF_CSV, {}, 'csv:swissborg', 'i1', USD_RATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.format).toBe('swissborg');
  });
});
