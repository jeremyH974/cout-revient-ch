/**
 * Import pivot : détection des deux en-têtes Koinly, mapping vers les événements du grand livre
 * (règles de valeur EUR de l'app), idempotence du ré-import, qualification des lignes ambiguës.
 */
import { describe, expect, it } from 'vitest';
import type { DepositEvent, RewardEvent, TradeEvent, WithdrawalEvent } from '../../domain/types';
import { parseCsvText } from '../csv';
import { detectPivotFormat } from './detect';
import { pivotLedgerEvents, type UsdRate } from './events';
import { importPivotCsv } from './index';
import { parsePivotRows } from './rows';

const UNIVERSAL_HEADER =
  'Date,Sent Amount,Sent Currency,Received Amount,Received Currency,Fee Amount,Fee Currency,Net Worth Amount,Net Worth Currency,Label,Description,TxHash';

/** Taux BCE EUR→USD constant pour les tests : 1 EUR = 1.25 USD. */
const usdRate: UsdRate = () => '1.25';
const noRate: UsdRate = () => null;

function universal(lines: string[]): string {
  return [UNIVERSAL_HEADER, ...lines].join('\n');
}

function eventsOf(csv: string, rate: UsdRate = usdRate) {
  const table = parseCsvText(csv);
  const detection = detectPivotFormat(table.header);
  if (!detection.ok) throw new Error('détection attendue');
  const { rows, issues } = parsePivotRows(table, detection.columns, 'i1', 'csv:a');
  return { ...pivotLedgerEvents(rows, {}, rate), rows, issues };
}

describe('detectPivotFormat', () => {
  it('reconnaît l’en-tête Universal et l’export interne From/To', () => {
    const u = detectPivotFormat(UNIVERSAL_HEADER.split(','));
    expect(u.ok && u.format).toBe('koinly-universal');
    const e = detectPivotFormat([
      'ID',
      'Date (UTC)',
      'Type',
      'Tag',
      'From Wallet ID',
      'From Amount',
      'From Currency',
      'To Wallet ID',
      'To Amount',
      'To Currency',
      'Fee Amount',
      'Fee Currency',
      'Net Worth Amount',
      'Net Worth Currency',
      'TxHash',
      'Description',
    ]);
    expect(e.ok && e.format).toBe('koinly-export');
    if (e.ok) expect(e.unknownColumns).toEqual([]);
  });

  it('refuse un en-tête sans date ni jambes', () => {
    const d = detectPivotFormat(['foo', 'bar']);
    expect(d.ok).toBe(false);
  });
});

describe('pivotLedgerEvents — mapping', () => {
  it('achat EUR → crypto : coût all-in frais compris, contre-jambe', () => {
    const { events } = eventsOf(
      universal(['2026-01-05 10:00:00,1000,EUR,0.02,BTC,2.5,EUR,,,,,0xaa']),
    );
    expect(events).toHaveLength(1);
    const t = events[0] as TradeEvent;
    expect(t.kind).toBe('trade');
    expect(t.out).toEqual({ asset: 'eur', qty: '1000' });
    expect(t.in).toEqual({ asset: 'btc', qty: '0.02' });
    expect(t.valueEur).toBe('1002.5');
    expect(t.valueEurSource).toBe('counter-leg');
    // Date UTC hiver → Paris = UTC+1.
    expect(t.at).toBe('2026-01-05T11:00:00');
  });

  it('vente crypto → USDC : produit net de frais, converti au taux BCE (décision n° 18)', () => {
    const { events } = eventsOf(universal(['2026-01-06 09:00:00,0.01,BTC,500,USDC,5,USDC,,,,,']));
    const t = events[0] as TradeEvent;
    expect(t.kind).toBe('trade');
    // (500 − 5) USDC ÷ 1.25 = 396 EUR.
    expect(t.valueEur).toBe('396');
  });

  it('échange crypto-crypto : Net Worth sinon « à qualifier »', () => {
    const withWorth = eventsOf(
      universal(['2026-01-07 08:00:00,1,ETH,20000,DOGE,,,2500,USD,swap,,']),
    ).events[0] as TradeEvent;
    expect(withWorth.kind).toBe('trade');
    expect(withWorth.valueEur).toBe('2000');
    const without = eventsOf(universal(['2026-01-07 08:00:00,1,ETH,20000,DOGE,,,,,,,'])).events[0]!;
    expect(without.kind).toBe('unqualified');
  });

  it('taux BCE manquant : la ligne part à qualifier plutôt qu’un chiffre inventé', () => {
    const { events } = eventsOf(
      universal(['2026-01-06 09:00:00,0.01,BTC,500,USDC,,,,,,,']),
      noRate,
    );
    expect(events[0]!.kind).toBe('unqualified');
  });

  it('réception étiquetée staking → récompense, sinon dépôt à apparier', () => {
    const { events } = eventsOf(
      universal([
        '2026-02-01 00:00:00,,,0.5,SOL,,,60,EUR,staking,,',
        '2026-02-02 00:00:00,,,0.3,BTC,,,,,,,0xbb',
      ]),
    );
    const reward = events[0] as RewardEvent;
    expect(reward.kind).toBe('reward');
    expect(reward.fairValueEur).toBe('60');
    const deposit = events[1] as DepositEvent;
    expect(deposit.kind).toBe('deposit');
    expect(deposit.costEur).toBeNull();
  });

  it('envoi seul → retrait à apparier ; étiquette gift annotée ; stablecoin auto-valorisé', () => {
    const { events } = eventsOf(
      universal([
        '2026-02-03 00:00:00,0.1,BTC,,,,,,,,,',
        '2026-02-04 00:00:00,0.2,ETH,,,,,,,gift,,',
        '2026-02-05 00:00:00,250,USDC,,,,,,,,,',
      ]),
    );
    const plain = events[0] as WithdrawalEvent;
    expect(plain.kind).toBe('withdrawal');
    expect(plain.proceedsEur).toBeNull();
    const gift = events[1] as WithdrawalEvent;
    expect(gift.proceedsEur).toBeNull();
    expect(gift.warnings.join(' ')).toContain('gift');
    const stable = events[2] as WithdrawalEvent;
    expect(stable.proceedsEur).toBe('200');
  });

  it('sortie fiat étiquetée cost → frais hors opération ; lignes 100 % fiat ignorées', () => {
    const { events, skippedCash } = eventsOf(
      universal([
        '2026-02-06 00:00:00,12,EUR,,,,,,,cost,,',
        '2026-02-07 00:00:00,,,300,EUR,,,,,,,',
        '2026-02-08 00:00:00,100,EUR,125,USD,,,,,,,',
      ]),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('fee');
    expect(skippedCash).toBe(2);
  });

  it('qualification d’une ligne ambiguë : réinterprétée en échange à la valeur donnée', () => {
    const csv = universal(['2026-01-07 08:00:00,1,ETH,20000,DOGE,,,,,,,']);
    const table = parseCsvText(csv);
    const detection = detectPivotFormat(table.header);
    if (!detection.ok) throw new Error('détection attendue');
    const { rows } = parsePivotRows(table, detection.columns, 'i1', 'csv:a');
    const pending = pivotLedgerEvents(rows, {}, usdRate).events[0]!;
    expect(pending.kind).toBe('unqualified');
    const done = pivotLedgerEvents(
      rows,
      { [pending.id]: { kind: 'trade', valueEur: '1800' } },
      usdRate,
    ).events[0] as TradeEvent;
    expect(done.kind).toBe('trade');
    expect(done.valueEur).toBe('1800');
  });
});

describe('importPivotCsv — façade', () => {
  const csv = universal([
    '2026-01-05 10:00:00,1000,EUR,0.02,BTC,,,,,,,0xaa',
    '2026-02-02 00:00:00,,,0.3,BTC,,,,,,,0xbb',
  ]);

  it('rapporte, dédoublonne et reste idempotent au ré-import', () => {
    const first = importPivotCsv(csv, {}, 'csv:a', 'i1', usdRate);
    if (!first.ok) throw new Error(first.error);
    expect(first.report.newRows).toBe(2);
    expect(first.report.counts.trades).toBe(1);
    expect(first.report.counts.deposits).toBe(1);
    expect(first.report.period).toEqual({ from: '2026-01-05T11:00:00', to: '2026-02-02T01:00:00' });
    const again = importPivotCsv(csv, first.rows, 'csv:a', 'i2', usdRate);
    if (!again.ok) throw new Error(again.error);
    expect(again.report.newRows).toBe(0);
    expect(again.report.duplicateRows).toBe(2);
    expect(Object.keys(again.rows)).toHaveLength(2);
  });

  it('le même fichier importé dans un AUTRE compte crée des lignes distinctes', () => {
    const first = importPivotCsv(csv, {}, 'csv:a', 'i1', usdRate);
    if (!first.ok) throw new Error(first.error);
    const other = importPivotCsv(csv, first.rows, 'csv:b', 'i2', usdRate);
    if (!other.ok) throw new Error(other.error);
    expect(other.report.newRows).toBe(2);
    expect(Object.keys(other.rows)).toHaveLength(4);
  });

  it('deux lignes identiques dans un même fichier = deux opérations (suffixe déterministe)', () => {
    const twin = universal([
      '2026-01-05 10:00:00,100,EUR,0.002,BTC,,,,,,,',
      '2026-01-05 10:00:00,100,EUR,0.002,BTC,,,,,,,',
    ]);
    const result = importPivotCsv(twin, {}, 'csv:a', 'i1', usdRate);
    if (!result.ok) throw new Error(result.error);
    expect(result.report.newRows).toBe(2);
    expect(result.report.counts.trades).toBe(2);
  });

  it('refuse un fichier étranger avec des détails utiles', () => {
    const result = importPivotCsv('a;b;c\n1;2;3', {}, 'csv:a', 'i1', usdRate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.join(' ')).toContain('Colonnes manquantes');
  });
});
