/**
 * Convertisseur Revolut — relevé crypto : détection anti-collision Coinbase, dates anglaises
 * AM/PM avec espace insécable (heure de Paris assumée), Value hors frais, Staking reward sans
 * valeur, Stake/Unstake internes, type inconnu signalé — et aval complet (idempotence incluse).
 */
import { describe, expect, it } from 'vitest';
import { importAnyCsv } from './index';
import { parseRevolutDate, revolut } from './revolut';
import { parseCsvText } from '../csv';

const USD_RATE = (): string => '1.1';

const CSV = [
  'Symbol,Type,Quantity,Price,Value,Fees,Date',
  'BTC,Buy,0.01000000,€1500.00,€15.00,€0.10,"Jan 8, 2025, 8:12:04 AM"',
  'BTC,Sell,0.00500000,€1600.00,€8.00,€0.00,"Jan 10, 2025, 3:45:00 PM"',
  'ETH,Receive,0.25000000,,,,"Jan 12, 2025, 12:00:00 AM"',
  'ETH,Send,0.10000000,,,,"Jan 15, 2025, 12:00:00 PM"',
  'ADA,Staking reward,4.50000000,,,,"Jan 20, 2025, 6:30:15 AM"',
  'SOL,Staking reward,0.05000000,€90.00,€4.50,,"Jan 22, 2025, 7:00:00 AM"',
  'DOT,Learn reward,2.00000000,,,,"Jan 25, 2025, 9:00:00 AM"',
  'XTZ,Stake,10.00000000,,,,"Jan 28, 2025, 10:00:00 AM"',
  'FOO,Weird,1.00000000,,,,"Jan 30, 2025, 11:00:00 AM"',
].join('\n');

describe('parseRevolutDate', () => {
  it('convertit « MMM D, YYYY, h:mm:ss AM/PM » en heure de Paris (exemple canonique)', () => {
    // 8 janv. 2025 08:12:04 Paris (hiver, UTC+1) = 07:12:04 UTC.
    expect(parseRevolutDate('Jan 8, 2025, 8:12:04 AM')).toBe(Date.UTC(2025, 0, 8, 7, 12, 4));
  });

  it('tolère un espace insécable (U+202F) avant AM/PM', () => {
    expect(parseRevolutDate('Jan 8, 2025, 8:12:04' + String.fromCharCode(0x202f) + 'AM')).toBe(
      Date.UTC(2025, 0, 8, 7, 12, 4),
    );
  });

  it('12 AM → minuit, 12 PM → midi', () => {
    expect(parseRevolutDate('Jan 12, 2025, 12:00:00 AM')).toBe(Date.UTC(2025, 0, 11, 23, 0, 0));
    expect(parseRevolutDate('Jan 15, 2025, 12:00:00 PM')).toBe(Date.UTC(2025, 0, 15, 11, 0, 0));
  });

  it('rejette une forme inconnue', () => {
    expect(parseRevolutDate('2025-01-08 08:12:04')).toBeNull();
    expect(parseRevolutDate('')).toBeNull();
  });
});

describe('revolut', () => {
  it('détecte l’en-tête Revolut, pas une collision Coinbase', () => {
    expect(revolut.detect(parseCsvText(CSV).header)).toBe(true);
    expect(
      revolut.detect([
        'ID',
        'Timestamp',
        'Transaction Type',
        'Asset',
        'Quantity Transacted',
        'Price Currency',
        'Price at Transaction',
        'Subtotal',
      ]),
    ).toBe(false);
  });

  it('convertit achat, vente, dépôt, retrait, récompenses, interne et type inconnu', () => {
    const { drafts, issues, skippedInternal } = revolut.convert(parseCsvText(CSV));
    expect(drafts).toHaveLength(7);
    expect(skippedInternal).toBe(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('Weird');

    // Value/Fees viennent de `parseMoneyText` (texte extrait tel quel, non passé par Big) ;
    // Quantity vient de `D().abs().toString()` (Big normalise les zéros de fin).
    const buy = drafts.find((d) => d.sent?.currency === 'eur')!;
    expect(buy.sent).toEqual({ amount: '15.00', currency: 'eur' });
    expect(buy.received).toEqual({ amount: '0.01', currency: 'btc' });
    expect(buy.fee).toEqual({ amount: '0.10', currency: 'eur' });

    const sell = drafts.find((d) => d.received?.currency === 'eur')!;
    expect(sell.sent).toEqual({ amount: '0.005', currency: 'btc' });
    expect(sell.received).toEqual({ amount: '8.00', currency: 'eur' });
    // Fees = €0.00 : pas de frais (règle « si > 0 »).
    expect(sell.fee).toBeNull();

    const deposit = drafts.find((d) => d.received?.currency === 'eth')!;
    expect(deposit.sent).toBeNull();
    expect(deposit.received).toEqual({ amount: '0.25', currency: 'eth' });
    expect(deposit.netWorth).toBeNull();

    const withdrawal = drafts.find((d) => d.sent?.currency === 'eth')!;
    expect(withdrawal.received).toBeNull();
    expect(withdrawal.sent).toEqual({ amount: '0.1', currency: 'eth' });
    expect(withdrawal.netWorth).toBeNull();

    const stakingNoValue = drafts.find((d) => d.received?.currency === 'ada')!;
    expect(stakingNoValue.label).toBe('staking');
    expect(stakingNoValue.netWorth).toBeNull();

    const stakingWithValue = drafts.find((d) => d.received?.currency === 'sol')!;
    expect(stakingWithValue.label).toBe('staking');
    expect(stakingWithValue.netWorth).toEqual({ amount: '4.50', currency: 'eur' });

    const learnReward = drafts.find((d) => d.received?.currency === 'dot')!;
    expect(learnReward.label).toBe('reward');
    expect(learnReward.netWorth).toBeNull();
  });
});

describe('importAnyCsv (revolut)', () => {
  it('produit les événements attendus et un ré-import idempotent', () => {
    const first = importAnyCsv(CSV, {}, 'csv:revolut', 'i1', USD_RATE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.report.format).toBe('revolut-crypto');
    expect(first.report.counts).toMatchObject({
      trades: 2,
      rewards: 3,
      deposits: 1,
      withdrawals: 1,
      unqualified: 0,
      skippedInternal: 1,
    });
    for (const key of Object.keys(first.rows)) expect(key.startsWith('pv:csv:revolut:')).toBe(true);

    const again = importAnyCsv(CSV, first.rows, 'csv:revolut', 'i2', USD_RATE);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.report.newRows).toBe(0);
    expect(again.report.duplicateRows).toBe(first.report.parsedRows);
    expect(again.report.conflictingRows).toBe(0);
  });
});
