/**
 * Convertisseur Binance : les trois formats (Statements, Trade History classique et variante
 * « statement ») sous un seul id ; regroupement des jambes Statements par compte + horodatage à
 * ±1 s (fusion achat/vente/frais, dépôt, retrait, frais isolé → coût, opération composite
 * ambiguë) ; revenu jamais regroupé ; interne et inconnu ; découpage de paire (BTCUSDT vs BTCUSD) ;
 * montants « collés » de la variante statement (zéros de tête, virgules de milliers).
 */
import { describe, expect, it } from 'vitest';
import { binance, parseGluedAmount, splitBinancePair } from './binance';
import { importAnyCsv } from './index';
import { parseCsvText } from '../csv';

const USD_RATE = (): string => '1.1';
const FOREIGN_HEADER = ['Timezone', 'Date', 'Time', 'Type', 'Currency', 'Amount'];

function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('brouillon introuvable');
  return x;
}

// --- Format 1 : Statements -----------------------------------------------------------------

const ST_HEADER = ['UTC_Time', 'Account', 'Operation', 'Coin', 'Change', 'Remark'];
const ST_ROWS: string[][] = [
  ['2025-02-01 10:00:00', 'Spot', 'Buy', 'BTC', '0.01', ''],
  ['2025-02-01 10:00:00', 'Spot', 'Sell', 'EUR', '-600', ''],
  ['2025-02-01 10:00:01', 'Spot', 'Fee', 'BNB', '-0.001', ''], // +1 s : toujours dans le groupe
  ['2025-02-02 09:00:00', 'Spot', 'Deposit', 'ETH', '0.5', ''],
  ['2025-02-03 09:00:00', 'Spot', 'Withdraw', 'ETH', '-0.2', ''],
  ['2025-02-04 09:00:00', 'Spot', 'Fee', 'BNB', '-0.0005', ''], // frais seul → coût
  ['2025-02-05 09:00:00', 'Earn', 'Staking Rewards', 'ADA', '1.5', ''],
  ['2025-02-06 09:00:00', 'Spot', 'transfer_out', 'BTC', '-0.001', ''],
  ['2025-02-06 09:05:00', 'Spot', 'Staking Purchase', 'ADA', '-10', ''],
  ['2025-02-07 09:00:00', 'Spot', 'Foobar', 'BTC', '0.01', ''],
  ['not-a-date', 'Spot', 'Buy', 'BTC', '0.01', ''],
  ['2025-02-08 09:00:00', 'Spot', 'Sell', 'EUR', '-100', ''], // + ligne suivante : composite
  ['2025-02-08 09:00:00', 'Spot', 'Sell', 'USDT', '-50', ''],
];
const ST_CSV = [ST_HEADER.join(','), ...ST_ROWS.map((r) => r.join(','))].join('\n');

describe('binance — statements', () => {
  it('détecte l’en-tête (User_ID présent ou absent) et rejette un en-tête étranger', () => {
    expect(binance.detect(parseCsvText(ST_CSV).header)).toBe(true);
    expect(binance.detect(['User_ID', ...ST_HEADER])).toBe(true);
    expect(binance.detect(FOREIGN_HEADER)).toBe(false);
  });

  it('regroupe achat+vente+frais (±1 s), dépôt, retrait, frais isolé, revenu, interne, inconnu, date illisible et composite ambigu', () => {
    const { drafts, issues, skippedInternal } = binance.convert(parseCsvText(ST_CSV));
    expect(drafts).toHaveLength(5);
    expect(skippedInternal).toBe(2);
    expect(issues).toHaveLength(3);
    expect(issues.some((i) => i.message.includes('Foobar'))).toBe(true);
    expect(issues.some((i) => i.message.includes('illisible'))).toBe(true);
    expect(issues.some((i) => i.message.includes('composite'))).toBe(true);

    const trade = must(drafts.find((d) => d.sent !== null && d.sent.currency === 'eur'));
    expect(trade.sent).toEqual({ amount: '600', currency: 'eur' });
    expect(trade.received).toEqual({ amount: '0.01', currency: 'btc' });
    expect(trade.fee).toEqual({ amount: '0.001', currency: 'bnb' });
    expect(trade.timeMs).toBe(Date.UTC(2025, 1, 1, 10, 0, 0));

    const deposit = must(drafts.find((d) => d.received !== null && d.received.currency === 'eth'));
    expect(deposit.sent).toBeNull();
    expect(deposit.received).toEqual({ amount: '0.5', currency: 'eth' });

    const withdrawal = must(drafts.find((d) => d.sent !== null && d.sent.currency === 'eth'));
    expect(withdrawal.received).toBeNull();
    expect(withdrawal.sent).toEqual({ amount: '0.2', currency: 'eth' });

    const costOnly = must(drafts.find((d) => d.label === 'cost'));
    expect(costOnly.sent).toEqual({ amount: '0.0005', currency: 'bnb' });
    expect(costOnly.received).toBeNull();
    expect(costOnly.fee).toBeNull();

    const reward = must(drafts.find((d) => d.label === 'reward'));
    expect(reward.received).toEqual({ amount: '1.5', currency: 'ada' });
    expect(reward.sent).toBeNull();
  });
});

describe('importAnyCsv (binance statements)', () => {
  it('reconnaît le format via le registre', () => {
    const result = importAnyCsv(ST_CSV, {}, 'csv:binance', 'i1', USD_RATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.format).toBe('binance');
    expect(result.report.counts.skippedInternal).toBe(2);
  });
});

// --- Format 2 : Trade History classique -----------------------------------------------------

const TC_HEADER = ['Date(UTC)', 'Market', 'Type', 'Price', 'Amount', 'Total', 'Fee', 'Fee Coin'];
const TC_ROWS: string[][] = [
  ['2025-03-01 12:00:00', 'BTCUSDT', 'BUY', '60000', '0.01', '600', '0.6', 'USDT'],
  ['2025-03-02 12:00:00', 'BTCUSD', 'SELL', '61000', '0.02', '1220', '1.22', 'USD'],
  ['2025-03-03 12:00:00', 'FOOBAR123', 'BUY', '1', '1', '1', '0', ''],
  ['2025-03-04 12:00:00', 'BTCUSDT', 'HOLD', '1', '1', '1', '0', ''],
];
const TC_CSV = [TC_HEADER.join(','), ...TC_ROWS.map((r) => r.join(','))].join('\n');

describe('binance — trade history (classique)', () => {
  it('découpe les paires collées, les plus longues devises de cotation d’abord', () => {
    expect(splitBinancePair('BTCUSDT')).toEqual({ base: 'btc', quote: 'usdt' });
    expect(splitBinancePair('BTCUSD')).toEqual({ base: 'btc', quote: 'usd' });
    expect(splitBinancePair('ETHBTC')).toEqual({ base: 'eth', quote: 'btc' });
    expect(splitBinancePair('EUR')).toBeNull();
  });

  it('détecte l’en-tête et rejette un en-tête étranger', () => {
    expect(binance.detect(parseCsvText(TC_CSV).header)).toBe(true);
    expect(binance.detect(FOREIGN_HEADER)).toBe(false);
  });

  it('convertit achat (BTCUSDT), vente (BTCUSD), paire et type inconnus', () => {
    const { drafts, issues } = binance.convert(parseCsvText(TC_CSV));
    expect(drafts).toHaveLength(2);
    expect(issues).toHaveLength(2);
    expect(issues.some((i) => i.message.includes('FOOBAR123'))).toBe(true);
    expect(issues.some((i) => i.message.includes('HOLD'))).toBe(true);

    const buy = drafts[0]!;
    expect(buy.sent).toEqual({ amount: '600', currency: 'usdt' });
    expect(buy.received).toEqual({ amount: '0.01', currency: 'btc' });
    expect(buy.fee).toEqual({ amount: '0.6', currency: 'usdt' });

    const sell = drafts[1]!;
    expect(sell.sent).toEqual({ amount: '0.02', currency: 'btc' });
    expect(sell.received).toEqual({ amount: '1220', currency: 'usd' });
    expect(sell.fee).toEqual({ amount: '1.22', currency: 'usd' });
  });
});

// --- Format 3 : Trade History « statement » ---------------------------------------------------

const TS_HEADER = ['Date(UTC)', 'Pair', 'Side', 'Price', 'Executed', 'Amount', 'Fee'];
const TS_ROWS: string[][] = [
  ['2025-04-01 08:00:00', 'BTCUSDT', 'BUY', '60000', '0.00025000BTC', '15.00USDT', '0.015USDT'],
  ['2025-04-02 08:00:00', 'ETHUSDT', 'SELL', '3000', '2.5ETH', '1,234.56USDT', '1.23USDT'],
  ['2025-04-03 08:00:00', 'BTCUSDT', 'HOLD', '60000', '0.001BTC', '60USDT', '0USDT'],
  ['2025-04-04 08:00:00', 'BTCUSDT', 'BUY', '60000', 'garbage', '60USDT', '0USDT'],
];
// Un champ contenant une virgule (milliers) doit être guillemeté en CSV, sinon le join naïf par
// virgule décale les colonnes suivantes.
const csvField = (v: string): string => (v.includes(',') ? `"${v}"` : v);
const TS_CSV = [TS_HEADER.join(','), ...TS_ROWS.map((r) => r.map(csvField).join(','))].join('\n');

describe('binance — trade history (variante « statement »)', () => {
  it('parse les montants collés (zéros de tête, virgules de milliers)', () => {
    expect(parseGluedAmount('0.00025000BTC')).toEqual({ amount: '0.00025000', currency: 'btc' });
    expect(parseGluedAmount('1,234.56USDT')).toEqual({ amount: '1234.56', currency: 'usdt' });
    expect(parseGluedAmount('garbage')).toBeNull();
  });

  it('un ticker commençant par un chiffre est tranché par la paire, pas deviné', () => {
    // Sans la paire, « 0.51INCH » se lit 0,51 INCH — faux et silencieux.
    expect(parseGluedAmount('0.51INCH')).toEqual({ amount: '0.51', currency: 'inch' });
    expect(parseGluedAmount('0.51INCH', '1INCH')).toEqual({ amount: '0.5', currency: '1inch' });
    expect(parseGluedAmount('12.31000PEPE', '1000PEPE')).toEqual({
      amount: '12.3',
      currency: '1000pepe',
    });
    // La paire attendue ne correspond pas : on retombe sur le découpage textuel plutôt qu'échouer.
    expect(parseGluedAmount('2.5ETH', '1INCH')).toEqual({ amount: '2.5', currency: 'eth' });
  });

  it('la ligne complète utilise la paire pour ses deux jambes', () => {
    const csv = [
      'Date(UTC),Pair,Side,Price,Executed,Amount,Fee',
      '2026-03-02 09:14:02,1INCHUSDT,BUY,0.42,0.51INCH,0.21USDT,0.001USDT',
    ].join('\n');
    const { drafts } = binance.convert(parseCsvText(csv));
    expect(drafts[0]!.received).toEqual({ amount: '0.5', currency: '1inch' });
    expect(drafts[0]!.sent).toEqual({ amount: '0.21', currency: 'usdt' });
  });

  it('détecte l’en-tête et rejette un en-tête étranger', () => {
    expect(binance.detect(parseCsvText(TS_CSV).header)).toBe(true);
    expect(binance.detect(FOREIGN_HEADER)).toBe(false);
  });

  it('convertit achat, vente, montant illisible et side inconnu', () => {
    const { drafts, issues } = binance.convert(parseCsvText(TS_CSV));
    expect(drafts).toHaveLength(2);
    expect(issues).toHaveLength(2);
    expect(issues.some((i) => i.message.includes('HOLD'))).toBe(true);
    expect(issues.some((i) => i.message.includes('garbage'))).toBe(true);

    const buy = drafts[0]!;
    expect(buy.sent).toEqual({ amount: '15.00', currency: 'usdt' });
    expect(buy.received).toEqual({ amount: '0.00025000', currency: 'btc' });
    expect(buy.fee).toEqual({ amount: '0.015', currency: 'usdt' });

    const sell = drafts[1]!;
    expect(sell.sent).toEqual({ amount: '2.5', currency: 'eth' });
    expect(sell.received).toEqual({ amount: '1234.56', currency: 'usdt' });
    expect(sell.fee).toEqual({ amount: '1.23', currency: 'usdt' });
  });
});
