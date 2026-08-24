/**
 * Convertisseur Kraken ledgers.csv : paires refid, codes X/Z et suffixes staking, pliage des
 * frais par jambe, mouvements internes ignorés, marge signalée — et aval complet (événements,
 * ré-import idempotent par clé de contenu natif).
 */
import { describe, expect, it } from 'vitest';
import { importAnyCsv } from './index';
import { krakenAsset, krakenLedgers } from './kraken';
import { parseCsvText } from '../csv';

const USD_RATE = (): string => '1.1';

const CSV = [
  'txid,refid,time,type,subtype,aclass,asset,wallet,amount,fee,balance',
  'L1,T1,2025-03-11 09:14:22.1180,trade,,currency,ZEUR,spot,-150.0000,0.25,842.10',
  'L2,T1,2025-03-11 09:14:22.1180,trade,,currency,XXBT,spot,0.00231500,0.00001200,0.01120000',
  'L3,T2,2025-04-02 18:02:03.4400,deposit,,currency,XETH,spot,0.50000000,0.00,3.11200000',
  'L4,T3,2025-04-05 07:40:11.0000,withdrawal,,currency,XETH,spot,-0.20000000,0.00050000,2.91150000',
  'L5,T4,2025-04-30 00:05:00.0000,earn,reward,currency,ADA.S,earn,4.552000,0.00,120.775000',
  'L6,T5,2025-05-01 10:00:00.0000,transfer,stakingtospot,currency,ADA.S,earn,-4.552000,0.00,116.223000',
  'L7,T6,2025-05-02 10:00:00.0000,margin,,currency,ZUSD,spot,12.5,0.0,100',
  'L9,T7,2025-05-03 08:00:00.0000,trade,,currency,XXBT,spot,-0.00500000,0,0.00620000',
  'L8,T7,2025-05-03 08:00:00.0000,trade,,currency,ZEUR,spot,300.00,0,1142.10',
].join('\n');

describe('krakenAsset', () => {
  it('traduit les codes historiques et retire les suffixes staking/earn', () => {
    expect(krakenAsset('XXBT')).toBe('btc');
    expect(krakenAsset('ZEUR')).toBe('eur');
    expect(krakenAsset('ADA.S')).toBe('ada');
    expect(krakenAsset('DOT28.S')).toBe('dot');
    expect(krakenAsset('ETH2.S')).toBe('eth');
    expect(krakenAsset('XBT.M')).toBe('btc');
    expect(krakenAsset('HYPE')).toBe('hype');
  });
});

describe('krakenLedgers', () => {
  it('détecte l’en-tête ledgers.csv (et pas un pivot Koinly)', () => {
    expect(krakenLedgers.detect(parseCsvText(CSV).header)).toBe(true);
    expect(krakenLedgers.detect(['Date', 'Sent Amount', 'Sent Currency', 'Received Amount'])).toBe(
      false,
    );
  });

  it('convertit paires refid, frais par jambe, staking, internes et marge', () => {
    const { drafts, issues, skippedInternal } = krakenLedgers.convert(parseCsvText(CSV));
    expect(drafts).toHaveLength(5);
    expect(skippedInternal).toBe(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('marge');

    const buy = drafts.find((d) => d.sent?.currency === 'eur')!;
    expect(buy.sent).toEqual({ amount: '150', currency: 'eur' });
    // Frais BTC plié dans la quantité reçue : 0.002315 − 0.000012.
    expect(buy.received).toEqual({ amount: '0.002303', currency: 'btc' });
    expect(buy.fee).toEqual({ amount: '0.25', currency: 'eur' });
    expect(buy.description).toContain('frais 0.000012 BTC');

    const sell = drafts.find((d) => d.received?.currency === 'eur')!;
    expect(sell.sent).toEqual({ amount: '0.005', currency: 'btc' });
    expect(sell.received).toEqual({ amount: '300', currency: 'eur' });
    expect(sell.fee).toBeNull();

    const withdrawal = drafts.find((d) => d.sent?.currency === 'eth')!;
    expect(withdrawal.sent!.amount).toBe('0.2005');

    const reward = drafts.find((d) => d.label === 'staking')!;
    expect(reward.received).toEqual({ amount: '4.552', currency: 'ada' });
  });

  it('l’heure Kraken est de l’UTC (09:14 UTC → 10:14 heure de Paris en hiver)', () => {
    const { drafts } = krakenLedgers.convert(parseCsvText(CSV));
    const buy = drafts.find((d) => d.sent?.currency === 'eur')!;
    expect(buy.timeMs).toBe(Date.UTC(2025, 2, 11, 9, 14, 22, 118));
  });
});

describe('importAnyCsv (kraken)', () => {
  it('produit les événements attendus et un ré-import idempotent', () => {
    const first = importAnyCsv(CSV, {}, 'csv:kraken', 'i1', USD_RATE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.report.format).toBe('kraken-ledgers');
    expect(first.report.counts).toMatchObject({
      trades: 2,
      rewards: 1,
      deposits: 1,
      withdrawals: 1,
      unqualified: 0,
      skippedInternal: 1,
    });
    // Toutes les clés hachent le contenu natif du fichier.
    for (const key of Object.keys(first.rows)) expect(key.startsWith('pv:csv:kraken:')).toBe(true);

    const again = importAnyCsv(CSV, first.rows, 'csv:kraken', 'i2', USD_RATE);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.report.newRows).toBe(0);
    expect(again.report.duplicateRows).toBe(first.report.parsedRows);
    expect(again.report.conflictingRows).toBe(0);
  });

  it('refuse un fichier inconnu en listant les formats acceptés', () => {
    const result = importAnyCsv('a,b,c\n1,2,3\n', {}, 'csv:x', 'i1', USD_RATE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details.join(' ')).toContain('Kraken');
  });
});
